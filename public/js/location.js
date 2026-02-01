/**
 * Location module - user location, walking time estimate, map marker.
 */
const LocationModule = (() => {
    const STORAGE_KEY = "dublinbus_user_location";
    const WALK_SPEED_KMH = 4.0;      // conservative walking speed
    const DETOUR_FACTOR = 1.5;        // street grid detour vs straight-line
    const MAX_WALK_DISTANCE_KM = 10;

    let _map = null;
    let _userLocation = null; // { lat, lon }
    let _markerLayer = null;
    let _changeCallbacks = [];

    function init(leafletMap) {
        _map = leafletMap;
        _markerLayer = L.layerGroup().addTo(_map);
        _restoreLocation();
    }

    function requestGPS() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject("Geolocation is not supported by this browser");
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                    _setLocation(loc, pos.coords.accuracy);
                    resolve(loc);
                },
                (err) => {
                    switch (err.code) {
                        case err.PERMISSION_DENIED:
                            reject("Location permission denied. Use the map button instead.");
                            break;
                        case err.POSITION_UNAVAILABLE:
                            reject("Location unavailable. Try the map button.");
                            break;
                        case err.TIMEOUT:
                            reject("Location request timed out. Try again.");
                            break;
                        default:
                            reject("Could not get your location.");
                    }
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
            );
        });
    }

    function setLocationFromMapClick(lat, lon) {
        _setLocation({ lat, lon });
    }

    function clearLocation() {
        _userLocation = null;
        _markerLayer.clearLayers();
        localStorage.removeItem(STORAGE_KEY);
        _fireCallbacks(null);
    }

    function getLocation() {
        return _userLocation;
    }

    function getWalkingTime(stopLat, stopLon) {
        if (!_userLocation) return null;

        const straightKm = _haversine(_userLocation.lat, _userLocation.lon, stopLat, stopLon);
        if (straightKm > MAX_WALK_DISTANCE_KM) return null;

        const walkKm = straightKm * DETOUR_FACTOR;
        const durationSecs = (walkKm / WALK_SPEED_KMH) * 3600;

        return { durationSecs, distanceMeters: walkKm * 1000 };
    }

    function getWalkingTimeMinutes(stopLat, stopLon) {
        const result = getWalkingTime(stopLat, stopLon);
        if (!result) return null;
        return Math.ceil(result.durationSecs / 60);
    }

    function onLocationChange(callback) {
        _changeCallbacks.push(callback);
    }

    // ── Private ───────────────────────────────────────────────────────

    function _setLocation(loc, accuracy) {
        _userLocation = loc;
        _updateMapMarker(loc.lat, loc.lon, accuracy);
        _persistLocation(loc);
        _fireCallbacks(loc);
    }

    function _updateMapMarker(lat, lon, accuracy) {
        _markerLayer.clearLayers();

        const icon = L.divIcon({
            className: "",
            html: '<div class="user-location-marker"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
        });

        L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(_markerLayer);

        // Accuracy circle for GPS
        if (accuracy && accuracy < 1000) {
            L.circle([lat, lon], {
                radius: accuracy,
                className: "user-accuracy-circle",
                fillOpacity: 0.1,
                weight: 1,
                color: "rgba(66, 133, 244, 0.3)",
                fillColor: "rgba(66, 133, 244, 0.1)",
            }).addTo(_markerLayer);
        }
    }

    function _persistLocation(loc) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
        } catch (e) {
            // Silently ignore storage errors
        }
    }

    function _restoreLocation() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const loc = JSON.parse(stored);
                if (loc && typeof loc.lat === "number" && typeof loc.lon === "number") {
                    _setLocation(loc);
                }
            }
        } catch (e) {
            // Silently ignore
        }
    }

    function _fireCallbacks(loc) {
        _changeCallbacks.forEach((cb) => cb(loc));
    }

    function _haversine(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
                Math.cos((lat2 * Math.PI) / 180) *
                Math.sin(dLon / 2) *
                Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    return {
        init,
        requestGPS,
        setLocationFromMapClick,
        clearLocation,
        getLocation,
        getWalkingTime,
        getWalkingTimeMinutes,
        onLocationChange,
    };
})();
