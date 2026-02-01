/**
 * Main application - route browser, favorites, dynamic switching, auto-refresh.
 */
(function () {
    const REFRESH_MS = 30000;

    let allRoutes = [];           // routes index from server
    let activeRouteData = null;   // full data for currently selected route
    let activeRouteName = null;   // e.g. "69"
    let activeStopId = null;      // currently selected stop ID
    let refreshTimer = null;
    let _walkingTimeMinutes = null;
    let _lastArrivalsData = null;

    // ── Initialization ──────────────────────────────────────────────

    async function init() {
        MapModule.init();
        LocationModule.init(MapModule.getMap());
        MapModule.onStopClick(handleStopClick);

        setupTabs();
        setupSearch();
        setupFavButton();
        setupStopSelect();
        setupLocationControls();

        LocationModule.onLocationChange(handleLocationChange);

        try {
            const resp = await fetch("/api/routes");
            allRoutes = await resp.json();
            renderRoutesList(allRoutes);
        } catch (err) {
            console.error("Failed to load routes:", err);
        }

        renderFavorites();

        // Auto-load route 69 + stop 1471 as default if no favorites
        const favs = Favorites.getAll();
        if (favs.length > 0) {
            await selectRoute(favs[0].routeName, favs[0].stopId);
        } else {
            await selectRoute("69", "8220DB001471");
        }

        window.addEventListener("resize", () => MapModule.resize());
    }

    // ── Tab switching ───────────────────────────────────────────────

    function setupTabs() {
        document.querySelectorAll(".nav-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
                document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
                tab.classList.add("active");
                document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
            });
        });
    }

    // ── Route search ────────────────────────────────────────────────

    function setupSearch() {
        const input = document.getElementById("route-search");
        input.addEventListener("input", () => {
            const q = input.value.trim().toLowerCase();
            if (!q) {
                renderRoutesList(allRoutes);
                return;
            }
            const filtered = allRoutes.filter(
                (r) =>
                    r.routeShortName.toLowerCase().includes(q) ||
                    r.routeLongName.toLowerCase().includes(q)
            );
            renderRoutesList(filtered);
        });
    }

    // ── Routes list rendering ───────────────────────────────────────

    function renderRoutesList(routes) {
        const container = document.getElementById("routes-list");
        container.innerHTML = "";

        routes.forEach((r) => {
            const div = document.createElement("div");
            div.className = "route-list-item";
            if (r.routeShortName === activeRouteName) div.classList.add("active");

            const dirs = r.directions.map((d) => d.headsign).join(" / ");
            div.innerHTML = `
                <span class="route-badge">${escapeHtml(r.routeShortName)}</span>
                <div class="route-list-info">
                    <span class="route-list-name">${escapeHtml(r.routeLongName)}</span>
                    <span class="route-list-dirs">${escapeHtml(dirs)}</span>
                </div>
            `;
            div.addEventListener("click", () => selectRoute(r.routeShortName));
            container.appendChild(div);
        });
    }

    // ── Favorites rendering ─────────────────────────────────────────

    function renderFavorites() {
        const container = document.getElementById("favorites-list");
        const favs = Favorites.getAll();

        if (favs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No favorites yet</p>
                    <p class="hint">Browse routes and click the star to add favorites</p>
                </div>
            `;
            return;
        }

        container.innerHTML = "";
        favs.forEach((fav) => {
            const div = document.createElement("div");
            div.className = "fav-item";
            if (fav.routeName === activeRouteName && fav.stopId === activeStopId) {
                div.classList.add("active");
            }
            div.innerHTML = `
                <span class="route-badge">${escapeHtml(fav.routeName)}</span>
                <div class="fav-info">
                    <span class="fav-stop-name">${escapeHtml(fav.stopName)}</span>
                    <span class="fav-stop-code">Stop ${escapeHtml(fav.stopCode || "")}</span>
                </div>
                <button class="fav-remove" title="Remove favorite">&times;</button>
            `;
            div.querySelector(".fav-remove").addEventListener("click", (e) => {
                e.stopPropagation();
                Favorites.remove(fav.routeName, fav.stopId);
                renderFavorites();
                updateFavButton();
            });
            div.addEventListener("click", () => selectRoute(fav.routeName, fav.stopId));
            container.appendChild(div);
        });
    }

    // ── Favorite button (in sidebar header) ─────────────────────────

    function setupFavButton() {
        document.getElementById("fav-btn").addEventListener("click", toggleFavorite);
    }

    function toggleFavorite() {
        if (!activeRouteName || !activeStopId || !activeRouteData) return;

        // Find stop details
        let stopInfo = null;
        for (const d of activeRouteData.directions) {
            for (const s of d.stops) {
                if (s.stopId === activeStopId) {
                    stopInfo = s;
                    break;
                }
            }
            if (stopInfo) break;
        }
        if (!stopInfo) return;

        if (Favorites.isFavorite(activeRouteName, activeStopId)) {
            Favorites.remove(activeRouteName, activeStopId);
        } else {
            Favorites.add({
                routeName: activeRouteName,
                routeLongName: activeRouteData.route.routeLongName,
                stopId: activeStopId,
                stopName: stopInfo.stopName,
                stopCode: stopInfo.stopCode || "",
            });
        }
        updateFavButton();
        renderFavorites();
    }

    function updateFavButton() {
        const btn = document.getElementById("fav-btn");
        if (activeRouteName && activeStopId && Favorites.isFavorite(activeRouteName, activeStopId)) {
            btn.innerHTML = "&#9733;"; // filled star
            btn.classList.add("is-fav");
        } else {
            btn.innerHTML = "&#9734;"; // empty star
            btn.classList.remove("is-fav");
        }
    }

    // ── Stop selector dropdown ──────────────────────────────────────

    function setupStopSelect() {
        document.getElementById("stop-select").addEventListener("change", (e) => {
            const stopId = e.target.value;
            if (stopId) {
                activeStopId = stopId;
                MapModule.showRoute(activeRouteData, activeStopId);
                updateFavButton();
                refreshArrivals();
                updateWalkingTime();
            }
        });
    }

    function populateStopSelect(routeData, selectedStopId) {
        const select = document.getElementById("stop-select");
        select.innerHTML = "";

        routeData.directions.forEach((dir) => {
            const group = document.createElement("optgroup");
            group.label = `Towards ${dir.headsign}`;

            dir.stops.forEach((stop) => {
                const opt = document.createElement("option");
                opt.value = stop.stopId;
                opt.textContent = `${stop.stopName} (${stop.stopCode || stop.stopId})`;
                if (stop.stopId === selectedStopId) opt.selected = true;
                group.appendChild(opt);
            });
            select.appendChild(group);
        });
    }

    // ── Location controls ──────────────────────────────────────────

    function setupLocationControls() {
        document.getElementById("gps-btn").addEventListener("click", async () => {
            const btn = document.getElementById("gps-btn");
            btn.disabled = true;
            const origHtml = btn.innerHTML;
            btn.textContent = "Locating...";
            try {
                await LocationModule.requestGPS();
                showLocationStatus("GPS location set");
            } catch (err) {
                showLocationStatus(err, true);
            } finally {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        });

        document.getElementById("map-locate-btn").addEventListener("click", () => {
            MapModule.enableMapClickMode((lat, lon) => {
                LocationModule.setLocationFromMapClick(lat, lon);
                showLocationStatus("Location set from map");
            });
            showLocationStatus("Click on the map to set your location...");
        });

        document.getElementById("clear-location-btn").addEventListener("click", () => {
            LocationModule.clearLocation();
            showLocationStatus("");
        });
    }

    function handleLocationChange(location) {
        const clearBtn = document.getElementById("clear-location-btn");
        if (location) {
            clearBtn.classList.remove("hidden");
            updateWalkingTime();
        } else {
            clearBtn.classList.add("hidden");
            _walkingTimeMinutes = null;
            if (_lastArrivalsData) {
                ArrivalsModule.render(_lastArrivalsData, activeRouteName, null);
            }
            updateWalkingSummary(null);
        }
    }

    function updateWalkingTime() {
        if (!activeStopId || !activeRouteData) {
            _walkingTimeMinutes = null;
            updateWalkingSummary(null);
            return;
        }

        let stopLat = null, stopLon = null;
        for (const d of activeRouteData.directions) {
            for (const s of d.stops) {
                if (s.stopId === activeStopId) {
                    stopLat = s.lat;
                    stopLon = s.lon;
                    break;
                }
            }
            if (stopLat !== null) break;
        }

        if (stopLat === null) {
            _walkingTimeMinutes = null;
            updateWalkingSummary(null);
            return;
        }

        const walkMins = LocationModule.getWalkingTimeMinutes(stopLat, stopLon);
        _walkingTimeMinutes = walkMins;
        updateWalkingSummary(walkMins);

        if (_lastArrivalsData) {
            ArrivalsModule.render(_lastArrivalsData, activeRouteName, _walkingTimeMinutes);
        }
    }

    function updateWalkingSummary(minutes) {
        const el = document.getElementById("walking-time-summary");
        const text = document.getElementById("walk-time-text");
        if (minutes == null) {
            el.classList.add("hidden");
        } else {
            el.classList.remove("hidden");
            text.textContent = minutes + " min walk";
        }
    }

    function showLocationStatus(message, isError) {
        const el = document.getElementById("location-status");
        el.textContent = message;
        el.className = "location-status" + (isError ? " location-error" : "");
        if (message && !isError) {
            setTimeout(() => { el.textContent = ""; }, 3000);
        }
    }

    // ── Route selection ─────────────────────────────────────────────

    async function selectRoute(routeName, stopId) {
        // Clear refresh timer
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }

        activeRouteName = routeName;
        ArrivalsModule.showLoading();

        try {
            const resp = await fetch(`/api/route/${encodeURIComponent(routeName)}`);
            if (!resp.ok) throw new Error("Route not found");
            activeRouteData = await resp.json();
        } catch (err) {
            console.error("Failed to load route:", err);
            ArrivalsModule.showEmpty("Failed to load route data");
            return;
        }

        // Pick the stop: use provided stopId, or first stop of first direction
        if (!stopId || !routeHasStop(activeRouteData, stopId)) {
            const firstDir = activeRouteData.directions[0];
            stopId = firstDir ? firstDir.stops[0].stopId : null;
        }
        activeStopId = stopId;

        // Update UI
        document.getElementById("route-header").classList.remove("hidden");
        document.getElementById("stop-select-panel").classList.remove("hidden");
        document.getElementById("location-panel").classList.remove("hidden");
        document.getElementById("active-route-badge").textContent = routeName;
        document.getElementById("active-route-name").textContent =
            activeRouteData.route.routeLongName;

        populateStopSelect(activeRouteData, activeStopId);
        updateFavButton();
        renderFavorites();
        renderRoutesList(allRoutes); // Update active highlight

        // Map
        MapModule.showRoute(activeRouteData, activeStopId);

        // Arrivals + walking time
        await refreshArrivals();
        updateWalkingTime();

        // Start auto-refresh
        refreshTimer = setInterval(refresh, REFRESH_MS);
    }

    function routeHasStop(routeData, stopId) {
        for (const d of routeData.directions) {
            for (const s of d.stops) {
                if (s.stopId === stopId) return true;
            }
        }
        return false;
    }

    // ── Handle stop click on map ────────────────────────────────────

    function handleStopClick(stop, dir) {
        activeStopId = stop.stopId;
        document.getElementById("stop-select").value = stop.stopId;
        MapModule.showRoute(activeRouteData, activeStopId);
        updateFavButton();
        refreshArrivals();
        updateWalkingTime();
    }

    // ── Refresh real-time data ──────────────────────────────────────

    async function refresh() {
        await refreshArrivals();
        await refreshVehicles();
    }

    async function refreshArrivals() {
        if (!activeRouteName || !activeStopId) return;

        try {
            const resp = await fetch(
                `/api/realtime/${encodeURIComponent(activeRouteName)}/${encodeURIComponent(activeStopId)}`
            );
            if (resp.ok) {
                const data = await resp.json();
                _lastArrivalsData = data;
                ArrivalsModule.render(data, activeRouteName, _walkingTimeMinutes);

                if (data.stale) {
                    showError("Using cached data - real-time feed temporarily unavailable");
                } else {
                    hideError();
                }
            }
        } catch (err) {
            console.error("Refresh error:", err);
            showError("Connection error - retrying...");
        }

        updateTimestamp();
    }

    async function refreshVehicles() {
        if (!activeRouteName) return;

        try {
            const resp = await fetch(`/api/vehicles/${encodeURIComponent(activeRouteName)}`);
            if (resp.ok) {
                const data = await resp.json();
                MapModule.updateBusPositions(data.vehicles || [], activeRouteName);
            }
        } catch {
            // Non-critical, ignore
        }
    }

    // ── UI helpers ──────────────────────────────────────────────────

    function updateTimestamp() {
        const now = new Date();
        document.getElementById("last-updated").textContent =
            "Updated " +
            now.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }

    function showError(msg) {
        const banner = document.getElementById("error-banner");
        banner.textContent = msg;
        banner.classList.remove("hidden");
        document.querySelector(".live-dot").classList.add("error");
    }

    function hideError() {
        document.getElementById("error-banner").classList.add("hidden");
        document.querySelector(".live-dot").classList.remove("error");
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str || "";
        return div.innerHTML;
    }

    document.addEventListener("DOMContentLoaded", init);
})();
