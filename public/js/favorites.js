/**
 * Favorites module - persists favorite route+stop combos in localStorage.
 *
 * Each favorite is: { routeName, routeLongName, stopId, stopName, stopCode }
 */
const Favorites = (() => {
    const STORAGE_KEY = "dublinbus_favorites";

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function save(favs) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
    }

    function add(fav) {
        const favs = load();
        // Avoid duplicates
        if (favs.some((f) => f.routeName === fav.routeName && f.stopId === fav.stopId)) {
            return favs;
        }
        favs.push(fav);
        save(favs);
        return favs;
    }

    function remove(routeName, stopId) {
        let favs = load();
        favs = favs.filter((f) => !(f.routeName === routeName && f.stopId === stopId));
        save(favs);
        return favs;
    }

    function isFavorite(routeName, stopId) {
        return load().some((f) => f.routeName === routeName && f.stopId === stopId);
    }

    function getAll() {
        return load();
    }

    return { add, remove, isFavorite, getAll };
})();
