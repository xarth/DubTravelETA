"""Parse Dublin Bus GTFS data for ALL routes.

Outputs:
  data/routes-index.json          - List of all routes with basic metadata
  data/routes/{short_name}.json   - Full detail per route (stops, shapes, trip IDs)
"""
import csv
import json
import os
import sys
from collections import defaultdict

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
GTFS_DIR = os.path.join(DATA_DIR, "gtfs")
ROUTES_DIR = os.path.join(DATA_DIR, "routes")
INDEX_PATH = os.path.join(DATA_DIR, "routes-index.json")


def read_csv(filename):
    path = os.path.join(GTFS_DIR, filename)
    with open(path, "r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def stream_csv(filename):
    path = os.path.join(GTFS_DIR, filename)
    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            yield row


def main():
    os.makedirs(ROUTES_DIR, exist_ok=True)

    # ── Step 1: Read all routes ──────────────────────────────────────
    print("Reading routes.txt...")
    routes_raw = read_csv("routes.txt")

    # Group by route_short_name (a single route number may have multiple route_ids)
    routes_by_name = defaultdict(list)
    for r in routes_raw:
        name = r.get("route_short_name", "").strip()
        if name:
            routes_by_name[name].append(r)

    print(f"  Found {len(routes_by_name)} unique route names")

    # ── Step 2: Read all trips, group by route_id ────────────────────
    print("Reading trips.txt...")
    trips_raw = read_csv("trips.txt")

    trips_by_route_id = defaultdict(list)
    trip_id_to_route_name = {}
    all_trip_ids = set()

    for name, route_entries in routes_by_name.items():
        route_ids = set(r["route_id"] for r in route_entries)
        for t in trips_raw:
            if t["route_id"] in route_ids:
                trips_by_route_id[name].append(t)
                trip_id_to_route_name[t["trip_id"]] = name
                all_trip_ids.add(t["trip_id"])

    print(f"  Mapped {len(all_trip_ids)} trips across {len(trips_by_route_id)} routes")

    # ── Step 3: Read all stops ───────────────────────────────────────
    print("Reading stops.txt...")
    stops_raw = read_csv("stops.txt")
    stops_by_id = {s["stop_id"]: s for s in stops_raw}

    # Build stop_code → stop_id lookup
    stop_code_to_id = {}
    for s in stops_raw:
        code = s.get("stop_code", "").strip()
        if code:
            stop_code_to_id[code] = s["stop_id"]

    # ── Step 4: Stream stop_times.txt (single pass for ALL routes) ───
    print("Streaming stop_times.txt (this is the big one)...")
    # For each route, we only need ONE representative trip per direction.
    # But we don't know which trips have stop_times until we read them.
    # Strategy: collect stop_times for a sample of trips per route+direction.
    # We'll pick the first trip per (route_name, direction_id) pair.

    # First, identify one representative trip per route+direction
    rep_trips = {}  # (route_name, direction_id) -> trip_id
    for name, trips in trips_by_route_id.items():
        for t in trips:
            d = t.get("direction_id", "0")
            key = (name, d)
            if key not in rep_trips:
                rep_trips[key] = t["trip_id"]

    rep_trip_ids = set(rep_trips.values())
    print(f"  Collecting stop sequences for {len(rep_trip_ids)} representative trips...")

    stop_sequences = {}  # trip_id -> [rows]
    count = 0
    for row in stream_csv("stop_times.txt"):
        tid = row["trip_id"]
        if tid in rep_trip_ids:
            if tid not in stop_sequences:
                stop_sequences[tid] = []
            stop_sequences[tid].append({
                "stop_id": row["stop_id"],
                "stop_sequence": int(row["stop_sequence"]),
                "arrival_time": row.get("arrival_time", ""),
                "departure_time": row.get("departure_time", ""),
            })
        count += 1
        if count % 1_000_000 == 0:
            print(f"    ...processed {count // 1_000_000}M rows")

    print(f"  Done. Processed {count} rows, got sequences for {len(stop_sequences)} trips")

    # ── Step 5: Read shapes (only for representative trips) ──────────
    print("Reading shapes for representative trips...")
    needed_shape_ids = set()
    for name, trips in trips_by_route_id.items():
        for t in trips:
            key = (name, t.get("direction_id", "0"))
            if rep_trips.get(key) == t["trip_id"]:
                sid = t.get("shape_id", "")
                if sid:
                    needed_shape_ids.add(sid)

    shapes_data = defaultdict(list)
    for row in stream_csv("shapes.txt"):
        if row["shape_id"] in needed_shape_ids:
            shapes_data[row["shape_id"]].append({
                "seq": int(row.get("shape_pt_sequence", 0)),
                "lat": float(row["shape_pt_lat"]),
                "lon": float(row["shape_pt_lon"]),
            })

    # Sort shape points
    for sid in shapes_data:
        shapes_data[sid] = [
            [p["lat"], p["lon"]]
            for p in sorted(shapes_data[sid], key=lambda x: x["seq"])
        ]

    print(f"  Loaded {len(shapes_data)} shapes")

    # ── Step 6: Build per-route JSON files ───────────────────────────
    print("Building route files...")
    routes_index = []

    for name in sorted(routes_by_name.keys(), key=lambda x: (not x.isdigit(), x.zfill(5) if x.isdigit() else x)):
        route_entries = routes_by_name[name]
        route_ids = list(set(r["route_id"] for r in route_entries))
        long_name = route_entries[0].get("route_long_name", "")
        trips = trips_by_route_id.get(name, [])

        if not trips:
            continue

        # All trip IDs for this route (for real-time matching)
        route_trip_ids = [t["trip_id"] for t in trips]

        # Build directions
        trips_by_dir = defaultdict(list)
        for t in trips:
            trips_by_dir[t.get("direction_id", "0")].append(t)

        directions = []
        for d_id in sorted(trips_by_dir.keys()):
            key = (name, d_id)
            rep_tid = rep_trips.get(key)
            if not rep_tid or rep_tid not in stop_sequences:
                continue

            seq = sorted(stop_sequences[rep_tid], key=lambda x: x["stop_sequence"])

            # Build stop list
            dir_stops = []
            for entry in seq:
                sid = entry["stop_id"]
                s = stops_by_id.get(sid)
                if s:
                    dir_stops.append({
                        "stopId": sid,
                        "stopName": s.get("stop_name", ""),
                        "stopCode": s.get("stop_code", ""),
                        "lat": float(s.get("stop_lat", 0)),
                        "lon": float(s.get("stop_lon", 0)),
                        "stopSequence": entry["stop_sequence"],
                        "arrivalTime": entry.get("arrival_time", ""),
                        "departureTime": entry.get("departure_time", ""),
                    })

            if not dir_stops:
                continue

            final = dir_stops[-1]

            # Find shape for this direction's representative trip
            rep_trip_obj = None
            for t in trips_by_dir[d_id]:
                if t["trip_id"] == rep_tid:
                    rep_trip_obj = t
                    break
            shape_id = rep_trip_obj.get("shape_id", "") if rep_trip_obj else ""
            shape = shapes_data.get(shape_id, [])

            headsign = ""
            if rep_trip_obj:
                headsign = rep_trip_obj.get("trip_headsign", final["stopName"])

            directions.append({
                "directionId": d_id,
                "headsign": headsign,
                "stops": dir_stops,
                "shape": shape,
                "finalStop": final,
            })

        if not directions:
            continue

        route_data = {
            "route": {
                "routeIds": route_ids,
                "routeShortName": name,
                "routeLongName": long_name,
            },
            "directions": directions,
            "tripIds": route_trip_ids,
        }

        # Write individual route file
        route_file = os.path.join(ROUTES_DIR, f"{name}.json")
        with open(route_file, "w", encoding="utf-8") as f:
            json.dump(route_data, f)

        # Build index entry
        all_stops_flat = []
        for d in directions:
            for s in d["stops"]:
                all_stops_flat.append(s["stopCode"])

        routes_index.append({
            "routeShortName": name,
            "routeLongName": long_name,
            "directions": [
                {"directionId": d["directionId"], "headsign": d["headsign"]}
                for d in directions
            ],
        })

    # ── Step 7: Write routes index ───────────────────────────────────
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(routes_index, f, indent=2)

    print(f"\nDone! Generated {len(routes_index)} route files in {ROUTES_DIR}")
    print(f"Routes index: {INDEX_PATH}")


if __name__ == "__main__":
    main()
