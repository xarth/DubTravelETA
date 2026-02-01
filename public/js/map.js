/**
 * Map module - Leaflet map with dynamic route/stop rendering.
 */
const MapModule = (() => {
    let map = null;
    let routeLayer = null;
    let busMarkerLayer = null;
    let stopClickCallback = null;
    let activeStopId = null;
    let mapClickMode = false;
    let mapClickCallback = null;

    function init() {
        // Center on Dublin
        map = L.map("map").setView([53.3498, -6.2603], 13);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 18,
        }).addTo(map);

        routeLayer = L.layerGroup().addTo(map);
        busMarkerLayer = L.layerGroup().addTo(map);

        map.on("click", (e) => {
            if (mapClickMode && mapClickCallback) {
                mapClickCallback(e.latlng.lat, e.latlng.lng);
                disableMapClickMode();
            }
        });

        setTimeout(() => map.invalidateSize(), 200);
    }

    function onStopClick(callback) {
        stopClickCallback = callback;
    }

    function showRoute(routeData, selectedStopId) {
        routeLayer.clearLayers();
        busMarkerLayer.clearLayers();
        activeStopId = selectedStopId;

        if (!routeData || !routeData.directions) return;

        const allBounds = [];

        routeData.directions.forEach((dir) => {
            if (!dir.shape || dir.shape.length === 0) return;

            // Route polyline
            const line = L.polyline(dir.shape, {
                color: "#00A1DE",
                weight: 4,
                opacity: 0.7,
            });
            routeLayer.addLayer(line);
            allBounds.push(...dir.shape);

            // Stop markers
            dir.stops.forEach((stop) => {
                const isActive = stop.stopId === selectedStopId;

                if (isActive) {
                    // Special pulsing marker for selected stop
                    const icon = L.divIcon({
                        className: "",
                        html: '<div class="target-stop-marker"></div>',
                        iconSize: [16, 16],
                        iconAnchor: [8, 8],
                    });
                    const marker = L.marker([stop.lat, stop.lon], { icon });
                    marker.bindPopup(
                        `<b>${escapeHtml(stop.stopName)}</b><br>Stop ${stop.stopCode || stop.stopId}`
                    );
                    marker.on("click", () => {
                        if (stopClickCallback) stopClickCallback(stop, dir);
                    });
                    routeLayer.addLayer(marker);
                } else {
                    const cm = L.circleMarker([stop.lat, stop.lon], {
                        radius: 5,
                        fillColor: "#00A1DE",
                        color: "#fff",
                        weight: 1.5,
                        fillOpacity: 0.8,
                    });
                    cm.bindPopup(
                        `<b>${escapeHtml(stop.stopName)}</b><br>Stop ${stop.stopCode || stop.stopId}`
                    );
                    cm.on("click", () => {
                        if (stopClickCallback) stopClickCallback(stop, dir);
                    });
                    routeLayer.addLayer(cm);
                }
            });
        });

        // Fit bounds
        if (allBounds.length > 0) {
            map.fitBounds(L.latLngBounds(allBounds).pad(0.08));
        }
    }

    function highlightStop(stopId) {
        // Re-render with new active stop without refetching
        activeStopId = stopId;
    }

    function updateBusPositions(vehicles, routeName) {
        busMarkerLayer.clearLayers();

        vehicles.forEach((v) => {
            const icon = L.divIcon({
                className: "",
                html: `<div class="bus-marker-icon">${escapeHtml(routeName)}</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
            });

            L.marker([v.lat, v.lon], { icon })
                .addTo(busMarkerLayer)
                .bindPopup(`Route ${escapeHtml(routeName)}`);
        });
    }

    function getMap() {
        return map;
    }

    function enableMapClickMode(callback) {
        mapClickMode = true;
        mapClickCallback = callback;
        map.getContainer().style.cursor = "crosshair";
    }

    function disableMapClickMode() {
        mapClickMode = false;
        mapClickCallback = null;
        map.getContainer().style.cursor = "";
    }

    function resize() {
        if (map) map.invalidateSize();
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str || "";
        return div.innerHTML;
    }

    return { init, onStopClick, showRoute, highlightStop, updateBusPositions, resize, getMap, enableMapClickMode, disableMapClickMode };
})();
