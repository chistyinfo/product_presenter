/**
 * js/product_viz.js - Standalone fullscreen product viewer.
 * ---------------------------------------------------------------------------
 * Renders EXACTLY what the settings page stores: a placement expressed as
 * percentages of the background image box, drawn by the SAME shared renderer
 * (js/pv_render.js). The result is identical on a phone, tablet, PC or TV.
 *
 * Data comes from the versioned API:
 *   GET /api/v1/products/{id}                 -> placements (per background)
 *   GET /api/v1/backgrounds/{id}/products     -> siblings in the same room
 *
 * The page also follows api/state.php so the Android remote can drive it:
 *   - state.product_id  -> which product to display
 *   - state.room        -> which background to show it on
 * pc_remote_nav.js handles navigation commands and presence heartbeats.
 */
class ProductVizViewer {
    constructor() {
        this.API_V1 = "api/v1";
        this.STATE_URL = "api/state.php";

        this.productId = this.getProductIdFromUrl();
        this.productData = null;
        this.currentProductId = null;

        this.placements = [];          // all placements for the product
        this.currentBgId = null;       // background currently shown
        this.currentRoomName = null;
        this.siblings = [];            // products in the same background
        this.siblingIndex = -1;

        this.scene = null;             // PVRender handle
        this.showInfo = true;

        // Shared-state sync
        this.lastRev = -1;
        this.syncInFlight = false;
        this.desiredRoomName = null;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.startStateSync();
    }

    getProductIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const id = params.get("id");
        if (id) return id;
        const parts = window.location.pathname.split("/");
        const i = parts.indexOf("product");
        if (i !== -1 && parts[i + 1]) return parts[i + 1];
        return null;
    }

    isValidProductId(id) {
        if (id === null || id === undefined) return false;
        const s = String(id).trim();
        if (s === "") return false;
        const n = parseInt(s, 10);
        return !isNaN(n) && n > 0 && String(n) === s;
    }

    setupEventListeners() {
        const exitBtn = document.getElementById("exit-button");
        if (exitBtn) exitBtn.addEventListener("click", () => window.history.back());

        const infoBtn = document.getElementById("info-toggle");
        if (infoBtn) infoBtn.addEventListener("click", () => this.toggleProductInfo());

        const fsBtn = document.getElementById("fullscreen-toggle");
        if (fsBtn) fsBtn.addEventListener("click", () => this.toggleFullscreen());

        const prev = document.getElementById("prev-product-btn");
        const next = document.getElementById("next-product-btn");
        if (prev) prev.addEventListener("click", () => this.navigateSibling(-1));
        if (next) next.addEventListener("click", () => this.navigateSibling(1));

        document.addEventListener("fullscreenchange", () => {
            if (this.scene && this.scene.refit) this.scene.refit();
        });

        document.addEventListener("keydown", (e) => {
            switch (e.key) {
                case "Escape":
                    if (document.fullscreenElement) this.exitFullscreen();
                    else window.history.back();
                    break;
                case "i": case "I":
                    this.toggleProductInfo();
                    break;
                case "f": case "F":
                    this.toggleFullscreen();
                    break;
                case "ArrowLeft":
                    this.navigateSibling(-1);
                    break;
                case "ArrowRight":
                    this.navigateSibling(1);
                    break;
            }
        });
    }

    // ======================================================================
    // SHARED STATE SYNC
    // ======================================================================
    startStateSync() {
        this.syncOnce();
        setInterval(() => { if (!document.hidden) this.syncOnce(); }, 1000);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) this.syncOnce();
        });
    }

    async syncOnce() {
        if (this.syncInFlight) return;
        this.syncInFlight = true;
        try {
            let state;
            try {
                const res = await fetch(this.STATE_URL, {
                    method: "GET",
                    headers: { "Accept": "application/json" },
                    cache: "no-store"
                });
                if (!res.ok) throw new Error("HTTP " + res.status);
                state = await res.json();
            } catch (err) {
                // API unavailable: fall back to the ?id= URL once.
                this.loadFromUrlFallback();
                return;
            }
            this.applyState(state);
        } finally {
            this.syncInFlight = false;
        }
    }

    applyState(state) {
        if (!state || typeof state.rev !== "number") {
            this.loadFromUrlFallback();
            return;
        }
        if (state.rev < this.lastRev) return;
        this.lastRev = state.rev;

        const productId = state.product_id != null ? String(state.product_id) : null;
        this.desiredRoomName = state.room != null ? String(state.room) : null;

        if (productId && this.isValidProductId(productId)) {
            if (productId !== this.currentProductId) {
                this.loadProduct(productId);
            } else if (this.desiredRoomName && this.desiredRoomName !== this.currentRoomName) {
                this.selectRoom(this.desiredRoomName);
            }
        } else if (!this.currentProductId) {
            this.loadFromUrlFallback();
        }
    }

    loadFromUrlFallback() {
        if (!this.productId) { this.showError("No product selected. Open with ?id=<product id>."); return; }
        if (!this.isValidProductId(this.productId)) {
            this.showError('"' + this.productId + '" is not a valid product id.');
            return;
        }
        if (this.currentProductId === this.productId) return;
        this.loadProduct(this.productId);
    }

    // ======================================================================
    // DATA LOADING
    // ======================================================================
    async loadProduct(productId) {
        const id = String(productId);
        if (!this.isValidProductId(id)) { this.showError("Invalid product id."); return; }

        if (!this.productData) this.showLoading();

        try {
            const data = await this.getJson(this.API_V1 + "/products/" + encodeURIComponent(id));
            this.productData = data;
            this.placements = data.placements || [];
            this.currentProductId = id;

            document.getElementById("product-name").textContent = data.name || "Product";
            document.getElementById("product-description").textContent = data.description || "";

            // Choose the requested room if it exists, else the first placement.
            let target = null;
            if (this.desiredRoomName) {
                target = this.placements.find(p => p.background_name === this.desiredRoomName);
            }
            if (!target) target = this.placements[0] || null;

            if (!target) {
                this.showError("This product is not assigned to any background.");
                return;
            }

            this.currentBgId = target.background_id;
            this.currentRoomName = target.background_name;

            await this.renderRoom();
            this.hideLoading();
            document.getElementById("pv-stage-host").style.display = "block";
            document.title = (data.name || "Product") + " - Visualization";
        } catch (err) {
            console.error("loadProduct:", err);
            this.showError("Failed to load product. " + err.message);
        }
    }

    /** Render the current product on the current background, via PVRender. */
    async renderRoom() {
        const placement = this.placements.find(p => p.background_id === this.currentBgId);
        if (!placement) { this.showError("Placement not found for this room."); return; }

        // Load siblings (all products in this background) for arrow navigation.
        try {
            const roomData = await this.getJson(this.API_V1 + "/backgrounds/" + this.currentBgId + "/products");
            this.siblings = (roomData && roomData.products) ? roomData.products : [];
            this.siblingIndex = this.siblings.findIndex(s => String(s.product_id) === String(this.currentProductId));
            this.updateNavButtons();
        } catch (e) {
            this.siblings = [];
        }

        const host = document.getElementById("pv-stage-host");
        if (this.scene && this.scene.detach) this.scene.detach();

        this.scene = PVRender.renderScene(host, {
            backgroundUrl: placement.background_image_url,
            backgroundName: placement.background_name,
            backgroundWidth: placement.background_width,
            backgroundHeight: placement.background_height,
            products: [{
                id: this.currentProductId,
                url: this.productData.image_url,
                name: this.productData.name,
                x: placement.placement.x,
                y: placement.placement.y,
                w: placement.placement.w,
                h: placement.placement.h,
                padding: placement.placement.padding,
                z_index: placement.placement.z_index
            }],
            editor: false
        });
    }

    selectRoom(roomName) {
        const target = this.placements.find(p => p.background_name === roomName);
        if (!target) return false;
        this.currentBgId = target.background_id;
        this.currentRoomName = target.background_name;
        this.renderRoom();
        return true;
    }

    // ======================================================================
    // SIBLING NAVIGATION (arrows)
    // ======================================================================
    async navigateSibling(dir) {
        if (this.siblings.length <= 1) return;
        let idx = this.siblingIndex;
        if (idx === -1) idx = 0;
        idx = (idx + dir + this.siblings.length) % this.siblings.length;
        const next = this.siblings[idx];
        if (!next) return;

        // Same background, different product: swap in place, no reload.
        this.currentProductId = String(next.product_id);
        const prodData = await this.getJson(this.API_V1 + "/products/" + next.product_id);
        this.productData = prodData;
        this.placements = prodData.placements || [];

        document.getElementById("product-name").textContent = prodData.name || "Product";
        document.getElementById("product-description").textContent = prodData.description || "";

        this.siblingIndex = idx;
        this.updateNavButtons();
        this.renderRoom();
    }

    updateNavButtons() {
        const prev = document.getElementById("prev-product-btn");
        const next = document.getElementById("next-product-btn");
        const multi = this.siblings.length > 1;
        if (prev) prev.classList.toggle("hidden", !multi);
        if (next) next.classList.toggle("hidden", !multi);
    }

    // ======================================================================
    // UI HELPERS
    // ======================================================================
    toggleProductInfo() {
        const el = document.getElementById("product-info");
        this.showInfo = !this.showInfo;
        if (el) el.classList.toggle("hidden", !this.showInfo);
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) this.enterFullscreen();
        else this.exitFullscreen();
    }
    enterFullscreen() {
        const el = document.getElementById("pv-stage-host");
        if (el.requestFullscreen) el.requestFullscreen();
    }
    exitFullscreen() {
        if (document.exitFullscreen) document.exitFullscreen();
    }

    showLoading() {
        const lo = document.getElementById("loading-overlay");
        if (lo) lo.style.display = "flex";
    }
    hideLoading() {
        const lo = document.getElementById("loading-overlay");
        if (lo) lo.style.display = "none";
    }
    showError(message) {
        const el = document.getElementById("error-message");
        if (el) {
            const p = el.querySelector("p");
            if (p) p.textContent = message;
            el.style.display = "block";
        }
        this.hideLoading();
    }

    async getJson(url) {
        const res = await fetch(url, { headers: { "Accept": "application/json" } });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
            const msg = (data && data.error && (data.error.message || data.error)) || text || res.status;
            throw new Error(typeof msg === "string" ? msg : "HTTP " + res.status);
        }
        return data;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    window.pvViewer = new ProductVizViewer();
});