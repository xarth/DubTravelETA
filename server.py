"""Flask server for Dublin Bus real-time tracker (all routes)."""
import json
import math
import os
import time
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

load_dotenv()

app = Flask(__name__, static_folder="public", static_url_path="")

NTA_API_KEY = os.getenv("NTA_API_KEY", "")
TRIP_UPDATES_URL = "https://api.nationaltransport.ie/gtfsr/v2/TripUpdates?format=json"
VEHICLES_URL = "https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json"
CACHE_TTL = int(os.getenv("CACHE_TTL_SECONDS", "30"))

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
ROUTES_DIR = os.path.join(DATA_DIR, "routes")

# In-memory caches
_trip_cache = {"data": None, "timestamp": 0}
_vehicle_cache = {"data": None, "timestamp": 0}
_route_cache = {}  # route_name -> {"data": ..., "timestamp": ...}

# Routes index (loaded once on startup)
_routes_index = None


def load_routes_index():
    """Load routes-index.json on startup."""
    global _routes_index
    index_path = os.path.join(DATA_DIR, "routes-index.json")
    if not os.path.isfile(index_path):
        print("WARNING: data/routes-index.json not found.")
        print("  Run: python scripts/download_gtfs.py && python scripts/parse_gtfs.py")
        _routes_index = []
        return
    with open(index_path, "r", encoding="utf-8") as f:
        _routes_index = json.load(f)
    print(f"Loaded routes index: {len(_routes_index)} routes available")


def get_route_data(route_name):
    """Load route data from disk, with in-memory caching."""
    if route_name in _route_cache:
        return _route_cache[route_name]

    route_file = os.path.join(ROUTES_DIR, f"{route_name}.json")
    if not os.path.isfile(route_file):
        return None

    with open(route_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    _route_cache[route_name] = data
    return data


def fetch_nta(url, cache):
    """Fetch from NTA API with caching."""
    now = time.time()
    if cache["data"] and (now - cache["timestamp"]) < CACHE_TTL:
        return cache["data"], False

    if not NTA_API_KEY:
        return None, True

    try:
        resp = requests.get(
            url,
            headers={"x-api-key": NTA_API_KEY},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        cache["data"] = data
        cache["timestamp"] = now
        return data, False
    except Exception as e:
        print(f"NTA API error: {e}")
        if cache["data"]:
            return cache["data"], True
        return None, True


# ── Static routes ────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("public", "index.html")


@app.route("/api/routes")
def routes_list():
    """Return the routes index (all available routes)."""
    return jsonify(_routes_index or [])


@app.route("/api/route/<route_name>")
def route_detail(route_name):
    """Return full data for a single route (stops, shapes, trip IDs)."""
    data = get_route_data(route_name)
    if data is None:
        return jsonify({"error": f"Route '{route_name}' not found"}), 404
    return jsonify(data)


# ── Helpers for real-time matching ────────────────────────────────────

def _parse_gtfs_time(time_str):
    """Parse a GTFS time like '14:25:30' into total seconds from midnight.
    GTFS times can exceed 24:00:00 for trips past midnight."""
    parts = time_str.split(":")
    if len(parts) != 3:
        return None
    try:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(float(parts[2]))
    except (ValueError, TypeError):
        return None


def _build_schedule_lookup(route_data, stop_id):
    """Build lookup data for a specific stop on a route.

    Returns a dict with:
      - direction: the direction dict that contains this stop
      - target_stop: the stop dict
      - target_seq: stop_sequence of target stop
      - target_offset_secs: scheduled arrival offset from trip start (seconds)
      - start_offset_secs: scheduled departure of first stop (seconds from midnight)
      - final_stop: the final stop dict
      - final_offset_secs: scheduled arrival offset of final stop (seconds)
    Or None if stop not found.
    """
    for d in route_data["directions"]:
        stops = d["stops"]
        if not stops:
            continue

        # Find our target stop
        target = None
        for s in stops:
            if s["stopId"] == stop_id:
                target = s
                break
        if not target:
            continue

        # First stop departure time (trip start reference)
        first_stop = stops[0]
        start_secs = _parse_gtfs_time(first_stop.get("departureTime", first_stop.get("arrivalTime", "")))
        if start_secs is None:
            continue

        # Target stop arrival time
        target_secs = _parse_gtfs_time(target.get("arrivalTime", target.get("departureTime", "")))
        if target_secs is None:
            continue

        target_offset = target_secs - start_secs

        # Final stop
        final_stop = d.get("finalStop") or stops[-1]
        final_secs = _parse_gtfs_time(final_stop.get("arrivalTime", final_stop.get("departureTime", "")))
        final_offset = (final_secs - start_secs) if final_secs is not None else None

        return {
            "direction": d,
            "target_stop": target,
            "target_seq": target.get("stopSequence", 0),
            "target_offset_secs": target_offset,
            "start_offset_secs": start_secs,
            "final_stop": final_stop,
            "final_offset_secs": final_offset,
        }

    return None


def _get_best_delay(stop_time_updates, target_seq):
    """Extract the best delay estimate from stop_time_update entries.

    Uses the entry closest to (but not after) the target stop_sequence.
    If all entries are after the target, the bus has already passed.
    Returns (delay_seconds, passed_target: bool).
    """
    best_delay = 0
    best_seq = -1
    min_seq_in_feed = 999999

    for stu in stop_time_updates:
        seq = stu.get("stop_sequence", 0)
        if seq < min_seq_in_feed:
            min_seq_in_feed = seq

        # Get delay from arrival or departure
        arr = stu.get("arrival", {})
        dep = stu.get("departure", {})
        delay = arr.get("delay") if arr.get("delay") is not None else dep.get("delay")
        if delay is None:
            # If there's an absolute time but no delay, we can't easily use it
            # for propagation, skip this entry for delay extraction
            continue

        # Pick the entry with highest stop_sequence that is <= target
        if seq <= target_seq and seq > best_seq:
            best_seq = seq
            best_delay = delay

    # If we found no entry before/at our stop, use the earliest available
    # (the bus hasn't reached any stop near ours yet - use its current delay)
    if best_seq == -1:
        for stu in stop_time_updates:
            seq = stu.get("stop_sequence", 0)
            arr = stu.get("arrival", {})
            dep = stu.get("departure", {})
            delay = arr.get("delay") if arr.get("delay") is not None else dep.get("delay")
            if delay is not None:
                best_delay = delay
                best_seq = seq
                break

    # Check if the bus has already passed our stop
    # (all reported stops are after our target)
    passed = min_seq_in_feed > target_seq if min_seq_in_feed < 999999 else False

    return best_delay, passed


# ── Real-time routes ────────────────────────────────────────────────

@app.route("/api/realtime/<route_name>/<stop_id>")
def realtime(route_name, stop_id):
    """Return real-time arrivals for a specific stop on a specific route."""
    route_data = get_route_data(route_name)
    if route_data is None:
        return jsonify({"error": f"Route '{route_name}' not found", "arrivals": []}), 404

    if not NTA_API_KEY:
        return jsonify({"error": "NTA_API_KEY not configured", "arrivals": []}), 200

    feed, is_stale = fetch_nta(TRIP_UPDATES_URL, _trip_cache)
    if feed is None:
        return jsonify({"error": "Unable to fetch NTA data", "arrivals": []}), 200

    # Build schedule lookup for this stop
    sched = _build_schedule_lookup(route_data, stop_id)
    if not sched:
        return jsonify({"error": "Stop not found in route data", "arrivals": []}), 200

    route_ids = set(route_data["route"]["routeIds"])
    all_trip_ids = set(route_data.get("tripIds", []))
    target_seq = sched["target_seq"]
    target_offset = sched["target_offset_secs"]
    final_offset = sched["final_offset_secs"]
    direction_id = sched["direction"].get("directionId")

    now_epoch = time.time()
    arrivals = []

    entities = feed.get("entity", feed.get("Entity", []))
    for entity in entities:
        tu = entity.get("tripUpdate", entity.get("trip_update"))
        if not tu:
            continue

        trip = tu.get("trip", {})
        trip_route_id = trip.get("routeId", trip.get("route_id", ""))
        trip_id = trip.get("tripId", trip.get("trip_id", ""))

        # Filter by route
        if trip_route_id not in route_ids and trip_id not in all_trip_ids:
            continue

        # Filter by direction (if available)
        feed_dir = trip.get("direction_id", trip.get("directionId"))
        if direction_id is not None and feed_dir is not None:
            if str(feed_dir) != str(direction_id):
                continue

        stop_time_updates = tu.get("stopTimeUpdate", tu.get("stop_time_update", []))
        if not stop_time_updates:
            continue

        # Get the trip's start date and time
        start_date = trip.get("start_date", trip.get("startDate", ""))
        start_time_str = trip.get("start_time", trip.get("startTime", ""))
        if not start_date or not start_time_str:
            continue

        # Parse trip start into epoch
        try:
            # start_date is "YYYYMMDD", start_time is "HH:MM:SS"
            dt = datetime.strptime(start_date, "%Y%m%d")
            start_secs = _parse_gtfs_time(start_time_str)
            if start_secs is None:
                continue
            # Dublin is UTC+0 or UTC+1 (IST), use Europe/Dublin
            # For simplicity, compute from midnight UTC of that date
            # and let the offset handle it
            trip_start_epoch = dt.replace(tzinfo=timezone.utc).timestamp() + start_secs
        except (ValueError, TypeError):
            continue

        # Compute scheduled arrival at our stop
        scheduled_arrival = trip_start_epoch + target_offset

        # Get delay from the feed's stop_time_updates
        delay_secs, passed = _get_best_delay(stop_time_updates, target_seq)

        if passed:
            # Bus has already passed our stop
            continue

        # Estimated arrival = scheduled + delay
        estimated_arrival = scheduled_arrival + delay_secs

        # Skip if already in the past (more than 2 min ago)
        if estimated_arrival < now_epoch - 120:
            continue

        minutes_away = max(0, math.ceil((estimated_arrival - now_epoch) / 60))

        # Skip very far future (more than 2 hours)
        if minutes_away > 120:
            continue

        headsign = trip.get("trip_headsign", trip.get("tripHeadsign", ""))
        if not headsign:
            headsign = sched["direction"].get("headsign", "")

        arrival_entry = {
            "tripId": trip_id,
            "routeId": trip_route_id,
            "routeShortName": route_name,
            "estimatedArrival": int(estimated_arrival),
            "delaySeconds": delay_secs,
            "minutesAway": minutes_away,
            "headsign": headsign,
        }

        # Final stop ETA
        if final_offset is not None:
            final_eta = trip_start_epoch + final_offset + delay_secs
            arrival_entry["finalStopEta"] = int(final_eta)
            arrival_entry["finalStopName"] = sched["final_stop"].get("stopName", "")

        arrivals.append(arrival_entry)

    arrivals.sort(key=lambda a: a["estimatedArrival"])

    return jsonify({
        "timestamp": int(now_epoch),
        "stale": is_stale,
        "arrivals": arrivals,
    })


@app.route("/api/vehicles/<route_name>")
def vehicles(route_name):
    """Return vehicle positions for a specific route."""
    route_data = get_route_data(route_name)
    if route_data is None:
        return jsonify({"error": f"Route '{route_name}' not found", "vehicles": []}), 404

    if not NTA_API_KEY:
        return jsonify({"error": "NTA_API_KEY not configured", "vehicles": []}), 200

    feed, is_stale = fetch_nta(VEHICLES_URL, _vehicle_cache)
    if feed is None:
        return jsonify({"error": "Unable to fetch NTA data", "vehicles": []}), 200

    all_trip_ids = set(route_data.get("tripIds", []))
    route_ids = set(route_data["route"]["routeIds"])
    vehicles_list = []

    entities = feed.get("entity", feed.get("Entity", []))
    for entity in entities:
        vp = entity.get("vehicle", entity.get("vehiclePosition"))
        if not vp:
            continue

        trip = vp.get("trip", {})
        trip_route_id = trip.get("routeId", trip.get("route_id", ""))
        trip_id = trip.get("tripId", trip.get("trip_id", ""))

        if trip_route_id not in route_ids and trip_id not in all_trip_ids:
            continue

        position = vp.get("position", {})
        lat = position.get("latitude", position.get("lat"))
        lon = position.get("longitude", position.get("lon"))

        if lat and lon:
            vehicles_list.append({
                "tripId": trip_id,
                "lat": float(lat),
                "lon": float(lon),
                "bearing": position.get("bearing"),
            })

    return jsonify({
        "timestamp": int(time.time()),
        "stale": is_stale,
        "vehicles": vehicles_list,
    })


load_routes_index()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "3000"))
    print(f"\nStarting server on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
