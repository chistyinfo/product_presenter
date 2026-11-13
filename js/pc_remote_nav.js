/**
 * pc_remote_nav.js — PC-side listener for the Android "DoorSoft PV remote".
 *
 * Included by BOTH PC pages (product_viz.html and individual-product.html) so
 * the remote can move the display between them in either direction:
 *
 *   remote "Details"    -> this page navigates to individual-product.html?id=<id>
 *   remote "Visualize"  -> this page navigates to product_viz.html?id=<id>
 *
 * Transport: the SAME document the rest of the remote already uses,
 * `api/state.php`, read with a 1 s GET poll (no new channel). Two additive
 * pieces of that contract matter here:
 *
 *   - state.nav_seq / nav_target / nav_product_id
 *       A one-shot command. `nav_seq` is incremented by the SERVER, so the PC
 *       can execute "everything newer than the seq I last ran" exactly once.
 *       The last executed seq is kept in sessionStorage, which survives the
 *       location.replace() navigation, so a reload never re-fires a command.
 *
 *   - state.pc_online / POST {"heartbeat":true}
 *       The heartbeat is what lets the phone refuse to send a command to a
 *       display that is not there. It does not bump `rev`.
 *
 * Paths are relative on purpose: the viz page is served from 192.168.0.113,
 * so a hardcoded "localhost" would break. No absolute URLs anywhere below.
 */
(function () {
    "use strict";

    var STATE_URL     = "api/state.php";
    var POLL_MS       = 1000;   // how often we read the shared state
    var HEARTBEAT_MS  = 3000;   // how often we tell the phone we are alive
    var SEQ_KEY       = "pvLastNavSeq";       // sessionStorage: last executed seq
    var SKIP_LOGO_KEY = "pvSkipLogoOverlay";  // sessionStorage: skip the splash

    var lastNavSeq        = null;  // null = not read yet
    var pollInFlight      = false;
    var heartbeatInFlight = false;
    var lastHeartbeatAt   = 0;
    var pcOnline          = false;

    /**
     * Read a sessionStorage integer, tolerating disabled storage.
     * @returns {number} the stored seq, or 0 when absent/unreadable
     */
    function readStoredSeq() {
        try {
            var raw = window.sessionStorage.getItem(SEQ_KEY);
            if (raw === null || raw === "") return 0;
            var parsed = parseInt(raw, 10);
            return isNaN(parsed) || parsed < 0 ? 0 : parsed;
        } catch (e) {
            return 0;
        }
    }

    /**
     * Persist the newest executed seq. Best effort: private browsing modes can
     * throw on write, in which case the command may re-fire after a reload
     * rather than break the page.
     */
    function storeSeq(seq) {
        try {
            window.sessionStorage.setItem(SEQ_KEY, String(seq));
        } catch (e) { /* storage unavailable: degrade to per-load execution */ }
    }

    /**
     * Current page file name, e.g. "product_viz.html".
     */
    function currentPage() {
        var path = window.location.pathname || "";
        var slash = path.lastIndexOf("/");
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    /**
     * The ?id= currently in the address bar, as a string, or null.
     */
    function currentIdFromUrl() {
        try {
            var id = new URLSearchParams(window.location.search).get("id");
            if (!id) return null;
            var num = parseInt(id, 10);
            return (!isNaN(num) && num > 0) ? String(num) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Validate a product id coming off the wire: positive whole number only.
     */
    function isValidId(id) {
        if (id === null || id === undefined) return false;
        var str = String(id).trim();
        if (str === "") return false;
        if (!/^\d+$/.test(str)) return false;
        return parseInt(str, 10) > 0;
    }

    /**
     * Ask the *other* page to skip its intro animation. The details page shows a
     * 3-second brand splash on first visit; when the remote just told the display
     * to jump there, the audience should see the product, not a logo reel.
     */
    function requestSkipLogoOverlay() {
        try {
            window.sessionStorage.setItem(SKIP_LOGO_KEY, "1");
        } catch (e) { /* not fatal */ }
    }

    /**
     * Execute a navigation command once.
     *
     * Uses location.replace() so the remote does not pile up history entries:
     * pressing Back on the PC should leave the presentation, not step through
     * every product the phone happened to open.
     */
    function runNavigation(target, productId) {
        if (!isValidId(productId)) {
            console.warn("[pc_remote_nav] Ignoring nav with invalid product id:", productId);
            return false;
        }

        var id = String(parseInt(productId, 10));
        var page = currentPage();
        var urlId = currentIdFromUrl();

        if (target === "details") {
            // Already showing this exact product's details: nothing to do.
            if (page === "individual-product.html" && urlId === id) return true;
            requestSkipLogoOverlay();
            window.location.replace("individual-product.html?id=" + encodeURIComponent(id));
            return true;
        }

        if (target === "viz") {
            if (page === "product_viz.html" && urlId === id) return true;
            window.location.replace("product_viz.html?id=" + encodeURIComponent(id));
            return true;
        }

        console.warn("[pc_remote_nav] Unknown nav target:", target);
        return false;
    }

    /**
     * Apply the navigation fields of a state document.
     */
    function handleNavigation(state) {
        var seq = (typeof state.nav_seq === "number") ? state.nav_seq : parseInt(state.nav_seq, 10);
        if (isNaN(seq) || seq <= 0) return;

        if (lastNavSeq === null) {
            // First read in this browser session.
            var stored = readStoredSeq();
            if (stored > 0) {
                // We were navigated here by an earlier command: continue from it so
                // the page we just landed on does not immediately re-navigate.
                lastNavSeq = stored;
            } else {
                // Nothing executed in this session yet. A command that was sent
                // while no display was open is stale -- it described a moment that
                // has passed -- so adopt the current seq WITHOUT acting on it.
                // Only commands that arrive from now on are executed.
                lastNavSeq = seq;
                storeSeq(seq);
                return;
            }
        }

        if (seq <= lastNavSeq) return; // already executed (or older than what we ran)

        // Mark executed BEFORE navigating so the replace + reload cannot re-fire.
        lastNavSeq = seq;
        storeSeq(seq);

        var target = state.nav_target ? String(state.nav_target).toLowerCase() : "";
        var productId = (state.nav_product_id !== null && state.nav_product_id !== undefined)
            ? state.nav_product_id
            : state.product_id;

        runNavigation(target, productId);
    }

    /**
     * One GET of the shared state: handles presence bookkeeping and navigation.
     */
    function poll() {
        if (pollInFlight) return;
        if (document.hidden) return; // a hidden tab has nothing to display

        pollInFlight = true;

        fetch(STATE_URL, {
            method: "GET",
            headers: { "Accept": "application/json" },
            cache: "no-store"
        })
            .then(function (response) {
                if (!response.ok) throw new Error("HTTP " + response.status);
                return response.json();
            })
            .then(function (state) {
                if (!state || typeof state !== "object") return;

                pcOnline = state.pc_online === true;

                // If the phone cannot see us, beat immediately instead of waiting
                // for the next interval, so "PC not connected" clears within ~1 s.
                if (!pcOnline && !heartbeatInFlight &&
                    (Date.now() - lastHeartbeatAt) > 500) {
                    sendHeartbeat();
                }

                handleNavigation(state);
            })
            .catch(function (error) {
                // Unreachable API must never break the display. product_viz.js has
                // its own fallback; here we simply try again on the next tick.
                console.warn("[pc_remote_nav] state poll failed:", error.message);
            })
            .then(function () {
                pollInFlight = false;
            });
    }

    /**
     * Tell the server a display is present. Never bumps `rev`.
     */
    function sendHeartbeat() {
        if (heartbeatInFlight) return;
        heartbeatInFlight = true;
        lastHeartbeatAt = Date.now();

        fetch(STATE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            cache: "no-store",
            body: JSON.stringify({ heartbeat: true })
        })
            .then(function (response) {
                pcOnline = response.ok;
                if (!response.ok) throw new Error("HTTP " + response.status);
                return response.json();
            })
            .then(function (state) {
                if (state && typeof state === "object") {
                    pcOnline = state.pc_online === true;
                    // A heartbeat response can carry a newer nav_seq too; acting on
                    // it here shaves up to a second off the round trip.
                    handleNavigation(state);
                }
            })
            .catch(function (error) {
                pcOnline = false;
                console.warn("[pc_remote_nav] heartbeat failed:", error.message);
            })
            .then(function () {
                heartbeatInFlight = false;
            });
    }

    /**
     * Public surface, also usable by the page's own buttons.
     */
    var api = {
        isPcOnline: function () { return pcOnline; },

        /**
         * Open the details page for a product (id optional: defaults to the id
         * in the address bar, then to the product on screen).
         */
        openDetails: function (productId) {
            var id = productId || currentIdFromUrl() ||
                (window.pvViewer && window.pvViewer.currentProductId) || null;
            return runNavigation("details", id);
        },

        /**
         * Return the display to the visualizer for a product.
         */
        showVisualization: function (productId) {
            var id = productId || currentIdFromUrl() ||
                (window.pvViewer && window.pvViewer.currentProductId) || null;
            return runNavigation("viz", id);
        }
    };

    window.pvRemoteNav = api;

    function start() {
        poll();
        sendHeartbeat();
        setInterval(poll, POLL_MS);
        setInterval(sendHeartbeat, HEARTBEAT_MS);

        // Catch up the moment the tab is shown again.
        document.addEventListener("visibilitychange", function () {
            if (!document.hidden) {
                poll();
                sendHeartbeat();
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();