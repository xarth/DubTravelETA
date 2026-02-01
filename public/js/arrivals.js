/**
 * Arrivals module - renders the real-time arrival board.
 */
const ArrivalsModule = (() => {
    function render(data, routeName, walkingTimeMinutes) {
        const container = document.getElementById("arrivals-list");

        if (data.error && (!data.arrivals || data.arrivals.length === 0)) {
            container.innerHTML = `<div class="error-message">${escapeHtml(data.error)}</div>`;
            return;
        }

        if (!data.arrivals || data.arrivals.length === 0) {
            container.innerHTML =
                '<div class="no-arrivals">No upcoming arrivals at this time</div>';
            return;
        }

        container.innerHTML = "";

        data.arrivals.forEach((arrival) => {
            const delayClass = getDelayClass(arrival.delaySeconds);
            const isDue = arrival.minutesAway <= 1;
            const etaText = formatEta(arrival.minutesAway);
            const arrivalTime = formatTime(arrival.estimatedArrival);
            const delayText = formatDelay(arrival.delaySeconds);
            const headsign = arrival.headsign || routeName;

            let finalEtaHtml = "";
            if (arrival.finalStopEta) {
                const finalTime = formatTime(arrival.finalStopEta);
                const finalName = arrival.finalStopName || "Final stop";
                finalEtaHtml = `<span class="final-eta">Arr. ${escapeHtml(finalName)}: ${finalTime}</span>`;
            }

            // Walking feasibility
            let walkHtml = "";
            let walkMissed = false;
            if (walkingTimeMinutes != null) {
                const canMakeIt = arrival.minutesAway >= (walkingTimeMinutes + 1);
                walkMissed = !canMakeIt;
                if (canMakeIt) {
                    walkHtml = `<div class="walk-verdict walk-yes"><span class="walk-icon-small">&#10003;</span> ${walkingTimeMinutes} min walk</div>`;
                } else {
                    walkHtml = `<div class="walk-verdict walk-no"><span class="walk-icon-small">&#10007;</span> ${isDue ? "Too late" : "Need " + walkingTimeMinutes + " min"}</div>`;
                }
            }

            const div = document.createElement("div");
            div.className = `arrival-item ${delayClass}${walkMissed ? " walk-missed" : ""}`;
            div.innerHTML = `
                <div class="arrival-eta ${isDue ? "due" : ""}">
                    ${etaText}
                    ${isDue ? "" : '<span class="unit">min</span>'}
                </div>
                <div class="arrival-details">
                    <span class="route-badge">${escapeHtml(routeName)}</span>
                    <span class="arrival-headsign">${escapeHtml(headsign)}</span>
                    <div class="arrival-meta">
                        <span>at ${arrivalTime}</span>
                        &middot;
                        <span class="delay-text ${delayClass}">${delayText}</span>
                    </div>
                    ${finalEtaHtml}
                    ${walkHtml}
                </div>
            `;
            container.appendChild(div);
        });
    }

    function showLoading() {
        document.getElementById("arrivals-list").innerHTML =
            '<div class="loading-message">Fetching real-time data...</div>';
    }

    function showEmpty(message) {
        document.getElementById("arrivals-list").innerHTML =
            `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;
    }

    function getDelayClass(seconds) {
        if (!seconds || seconds <= 60) return "";
        if (seconds <= 300) return "slight-delay";
        return "delayed";
    }

    function formatEta(minutes) {
        if (minutes <= 1) return "DUE";
        return String(minutes);
    }

    function formatTime(epoch) {
        const d = new Date(epoch * 1000);
        return d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });
    }

    function formatDelay(seconds) {
        if (!seconds || seconds <= 60) return "On time";
        const mins = Math.round(seconds / 60);
        return `${mins} min late`;
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str || "";
        return div.innerHTML;
    }

    return { render, showLoading, showEmpty };
})();
