/**
 * Product Visualization Fullscreen Viewer
 * Displays a product with its associated backgrounds (if multiple) in fullscreen mode,
 * allowing switching between linked backgrounds using arrow keys.
 */
class ProductVizViewer {
    constructor() {
        this.productId = this.getProductIdFromUrl();
        this.productData = null;
        this.backgrounds = []; // Array to hold all linked backgrounds
        this.currentBackgroundIndex = 0; // Index for the currently displayed background
        this.isFullscreen = false;
        this.showInfo = true;
        // Background selector UI is not re-enabled by default, only arrow key switching

        // --- Shared-state sync -------------------------------------------------
        // When this page is driven by the Android remote (api/state.php), it follows
        // that document instead of the ?id= URL parameter. See startStateSync().
        this.syncEnabled = false;      // true once a state document has been read
        this.lastRev = -1;             // newest rev applied; -1 = nothing yet
        this.currentProductId = null;  // product actually on screen
        this.syncProductId = null;     // last product id pulled from the server
        this.currentRoomName = null;   // background name actually on screen
        this.loadingFor = null;        // id currently being fetched, to avoid duplicate loads
        this.syncTimer = null;         // setInterval handle
        this.syncInFlight = false;     // guard so slow polls cannot stack up
        this.lastState = null;         // newest state document applied
        this.desiredRoomName = null;    // room requested by the remote, applied per product

        this.init();
    }

    /**
     * Initialize the viewer
     */
    init() {
        this.setupEventListeners();

        // Always start in remote-driven mode. The API is on the same origin, so no CORS
        // concerns and no configuration needed. If the state document cannot be read the
        // page falls back to the ?id= URL parameter behaviour it always had.
        this.startStateSync();
    }

    /**
     * Get product ID from URL parameters
     * @returns {string} Product ID
     */
    getProductIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        let productId = urlParams.get("id");
        
        if (!productId) {
            const pathParts = window.location.pathname.split("/");
            const productIndex = pathParts.indexOf("product");
            if (productIndex !== -1 && pathParts[productIndex + 1]) {
                productId = pathParts[productIndex + 1];
            }
        }
        
        return productId;
    }

    /**
     * Whether an id is usable for the product API.
     *
     * The API keys products by a positive integer. This mirrors the server-side check so a
     * bad id fails here with a friendly message instead of hitting the network.
     *
     * @param {*} id
     * @returns {boolean}
     */
    isValidProductId(id) {
        if (id === null || id === undefined) return false;
        const str = String(id).trim();
        if (str === "") return false;
        const num = parseInt(str, 10);
        return !isNaN(num) && num > 0 && String(num) === str;
    }

    /**
     * Set up event listeners for UI controls
     */
    setupEventListeners() {
        // Exit button
        document.getElementById("exit-button").addEventListener("click", () => {
            window.history.back();
        });
        
        // Info toggle button
        document.getElementById("info-toggle").addEventListener("click", () => {
            this.toggleProductInfo();
        });
        
        // Backgrounds toggle button - Keep hidden unless UI is explicitly requested/re-added
        const backgroundsToggle = document.getElementById("backgrounds-toggle");
        if (backgroundsToggle) {
            backgroundsToggle.style.display = "none"; 
        }
        
        // Fullscreen toggle button
        document.getElementById("fullscreen-toggle").addEventListener("click", () => {
            this.toggleFullscreen();
        });
        
        // Keyboard shortcuts
        document.addEventListener("keydown", (e) => {
            switch (e.key) {
                case "Escape":
                    if (this.isFullscreen) {
                        this.exitFullscreen();
                    } else {
                        window.history.back();
                    }
                    break;
                case "i":
                    this.toggleProductInfo();
                    break;
                // case "b": // Background toggle UI not active
                //     this.toggleBackgroundSelector(); 
                //     break;
                case "f":
                    this.toggleFullscreen();
                    break;
                case "ArrowUp": // Use ArrowUp for previous background
                    this.previousBackground();
                    break;
                case "ArrowDown": // Use ArrowDown for next background
                    this.nextBackground();
                    break;
            }
        });
        
        // Handle fullscreen change events
        document.addEventListener("fullscreenchange", () => {
            this.isFullscreen = !!document.fullscreenElement;
            this.updateFullscreenButton();
        });
    }

    // =========================================================================
    // Shared-state sync (Android remote -> this page)
    // =========================================================================

    /**
     * Start polling api/state.php and following whatever it says.
     *
     * Polling (rather than a push channel) is deliberate: it needs no extra server code, it
     * survives the Apache worker being recycled, and on a LAN one request per second is
     * negligible. The loop stops itself while the tab is hidden.
     */
    startStateSync() {
        this.syncOnce();
        this.syncTimer = setInterval(() => {
            if (!document.hidden) this.syncOnce();
        }, 1000);

        // Catch up immediately when the tab becomes visible again.
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) this.syncOnce();
        });
    }

    /**
     * Read the shared state once and apply it.
     */
    async syncOnce() {
        // The poll fires every second; a slow request must not stack up a queue of them.
        if (this.syncInFlight) return;
        this.syncInFlight = true;

        try {
            let state;
            try {
                const response = await fetch("api/state.php", {
                    method: "GET",
                    headers: { "Accept": "application/json" },
                    cache: "no-store",
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                state = await response.json();
            } catch (error) {
                // The API being unreachable must not break the page. Fall back to ?id= once.
                if (!this.syncEnabled) {
                    console.warn("state.php unavailable, falling back to URL product:", error.message);
                    this.loadFromUrlFallback();
                }
                return;
            }

            this.syncEnabled = true;
            this.applyState(state);
        } finally {
            this.syncInFlight = false;
        }
    }

    /**
     * Load the product named in the URL, used only when the shared state is unavailable or
     * empty. Preserves the page's original standalone behaviour.
     */
    loadFromUrlFallback() {
        if (!this.productId) {
            this.showError(
                "No product selected. Open this page with ?id=<product id>, " +
                "or pick a product from the Remote screen in the app."
            );
            return;
        }
        if (!this.isValidProductId(this.productId)) {
            this.showError(
                `"${this.productId}" is not a valid product id. Expected a whole number greater than 0.`
            );
            return;
        }
        if (this.currentProductId === this.productId) return;
        this.loadProductById(this.productId);
    }

    /**
     * Apply a state document to the page.
     *
     * Product changes require a fetch (the state only carries an id); scale/position/flip are
     * pure CSS and are applied on every revision, which is what makes the sliders feel live.
     */
    applyState(state) {
        if (!state || typeof state.rev !== "number") return;

        // Older revision than what we already applied: ignore (a late response overtook).
        if (state.rev < this.lastRev) return;

        // Same revision: nothing changed, but a product load kicked off by the *previous*
        // poll may have just finished and needs the transform re-applied. Cheap and idempotent.
        if (state.rev === this.lastRev) {
            this.lastState = state;
            this.applyTransform(state);
            return;
        }

        const productId = state.product_id != null ? String(state.product_id) : null;
        this.desiredRoomName = state.room != null ? String(state.room) : null;

        // Stored before any async work so a product load completing later can re-apply it.
        this.lastState = state;
        this.lastRev = state.rev;

        // A product in the shared state always wins over the URL parameter.
        const productChanging = productId && this.currentProductId !== productId;
        if (productId) {
            this.syncProductId = productId;
            if (productChanging && this.loadingFor !== productId) {
                // The room is reconciled by loadProduct() once the new product's backgrounds
                // arrive, because a room only makes sense against a specific product.
                this.loadProductById(productId);
            }
        } else if (!this.currentProductId) {
            // State exists but names no product yet: keep the URL one so the screen isn't blank.
            this.loadFromUrlFallback();
        }

        // Apply the room against whatever product is currently on screen. If it is not among
        // that product's backgrounds, keep the product's own primary rather than a stale value.
        this.selectRoom(this.desiredRoomName);

        this.applyTransform(state);
        this.hideLoading();
    }

    /**
     * Switch to the background matching [roomName] for the product currently loaded.
     *
     * Returns true when the room was found. When it is not found (a room that belongs to a
     * different product, or none named at all) the current background is left untouched and
     * [currentRoomName] is kept in sync with what is actually displayed.
     */
    selectRoom(roomName) {
        if (this.backgrounds.length === 0) return false;

        if (!roomName) {
            const current = this.backgrounds[this.currentBackgroundIndex];
            this.currentRoomName = current ? current.name : null;
            return false;
        }

        const index = this.backgrounds.findIndex((bg) => bg.name === roomName);
        if (index === -1) {
            // This product does not exist in the requested room (products are per-room rows).
            // Show the product's own room rather than a blank screen, but say so in the
            // console: otherwise the phone claims one room while the display shows another.
            const current = this.backgrounds[this.currentBackgroundIndex];
            this.currentRoomName = current ? current.name : null;
            console.info(
                `Room "${roomName}" has no product ${this.currentProductId}; ` +
                `showing "${this.currentRoomName}" instead.`
            );
            return false;
        }

        this.currentRoomName = roomName;
        if (index !== this.currentBackgroundIndex) {
            this.currentBackgroundIndex = index;
            this.renderBackground();
            this.renderProduct();
        }
        return true;
    }

    /**
     * Map the remote's normalized x/y/scale/flip onto the product.
     *
     * The marking rectangle from the room is the *apperture*: it stays where the room says the
     * door belongs, at the size the room says. The remote's `scale` changes how large the
     * product is drawn **within** that aperture, and `x`/`y` slide it around inside it. That
     * keeps the product on the wall rather than letting a large scale push the door out of the
     * room, and it means the same state looks correct in every differently-shaped room.
     *
     * `x`/`y` are 0..1 with 0.5 as the centre (state.php's defaults), left-to-right and
     * top-to-bottom. They translate the product by up to half the aperture in either
     * direction, so the product can never travel completely out of view.
     */
    applyTransform(state) {
        const vizMarkingArea = document.getElementById("viz-marking-area");
        const productContainer = document.getElementById("product-container");
        if (!vizMarkingArea || !productContainer) return;
        if (!this.productData || !this.productData.product) return;

        // No state yet (first paint before the first poll landed): renderProduct() will already
        // have applied the room's own marking rectangle, so leave it alone.
        if (!state) return;

        const background = this.backgrounds.length > 0
            ? this.backgrounds[this.currentBackgroundIndex]
            : null;

        // Without a background there is no marking rectangle: keep the original full-bleed layout.
        if (!background) return;

        const baseTop = Number(background.marking_top_percent) || 0;
        const baseLeft = Number(background.marking_left_percent) || 0;
        const baseWidth = Number(background.marking_width_percent) || 100;
        const baseHeight = Number(background.marking_height_percent) || 100;
        const padding = Number(background.marking_padding_percent) || 0;

        // Pin the aperture to the room's rectangle; the product moves inside it.
        vizMarkingArea.style.position = "absolute";
        vizMarkingArea.style.top = `${baseTop}%`;
        vizMarkingArea.style.left = `${baseLeft}%`;
        vizMarkingArea.style.width = `${baseWidth}%`;
        vizMarkingArea.style.height = `${baseHeight}%`;
        vizMarkingArea.style.padding = `${padding}%`;
        vizMarkingArea.style.overflow = "visible";

        // A non-positive or non-finite scale would make the product vanish; fall back to 1.
        const scale = (typeof state.scale === "number" && isFinite(state.scale) && state.scale > 0)
            ? state.scale
            : 1;
        const x = (typeof state.x === "number" && isFinite(state.x)) ? state.x : 0.5;
        const y = (typeof state.y === "number" && isFinite(state.y)) ? state.y : 0.5;
        const flip = state.flip === true;

        // translate() runs first in the list, so shift then scale: the offset stays in aperture
        // units and does not get magnified along with the product. Rounded because raw float
        // arithmetic produces values like -4.000000000000001%, which is noise in a CSS string.
        const offsetX = round2((x - 0.5) * 50);   // -25% .. +25% of the aperture
        const offsetY = round2((y - 0.5) * 50);
        const flipPart = flip ? " scaleX(-1)" : "";

        productContainer.style.position = "relative";
        productContainer.style.width = "100%";
        productContainer.style.height = "100%";
        productContainer.style.display = "flex";
        productContainer.style.alignItems = "center";
        productContainer.style.justifyContent = "center";
        productContainer.style.transformOrigin = "center center";
        productContainer.style.transform =
            `translate(${offsetX}%, ${offsetY}%) scale(${scale})${flipPart}`;
        productContainer.style.transition = "transform 120ms linear";
    }

    /**
     * Load product data (including all linked backgrounds) from API
     *
     * @param {string|number} [productId] id to load; defaults to the one in the URL.
     */
    async loadProduct(productId) {
        const id = productId != null ? String(productId) : this.productId;
        try {
            // Never blank the screen when swapping products on a live display: the loading
            // overlay is only shown for the very first paint.
            if (!this.productData) this.showLoading();

            if (!this.isValidProductId(id)) {
                throw new Error("Invalid Product ID");
            }

            this.loadingFor = id;
            const apiUrl = `get_product_fullscreen.php?id=${encodeURIComponent(id)}`;

            const response = await fetch(apiUrl, {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                }
            });

            // Read the body as text FIRST. response.json() throws an opaque
            // "unexpected end of data" error on an empty body (which is exactly what a
            // server-side json_encode() failure used to produce), so we need the raw
            // text to detect and diagnose that case ourselves.
            let rawText = "";
            try {
                rawText = await response.text();
            } catch (readError) {
                throw new Error(`Could not read response body: ${readError.message}`);
            }

            console.debug(
                `[product_viz] GET ${apiUrl} -> ${response.status} ` +
                `(${rawText.length} bytes)`
            );

            const snippet = rawText.length > 200 ? rawText.substring(0, 200) + "…" : rawText;

            // A non-2xx status is an error even if the body happens to be JSON.
            if (!response.ok) {
                // The server may still send a {"success":false,"error":"..."} document.
                let serverError = null;
                try { serverError = JSON.parse(rawText); } catch (_) { /* not JSON */ }
                const detail = (serverError && serverError.error)
                    ? serverError.error
                    : (snippet || "empty response");
                throw new Error(`HTTP ${response.status} ${response.statusText || ""}`.trim() + ` – ${detail}`);
            }

            // An empty 200 body is never valid: fail with a clear, actionable message
            // instead of letting response.json() throw a cryptic parse error.
            if (!rawText || rawText.trim() === "") {
                throw new Error(`Empty response from server (HTTP ${response.status}). Expected JSON.`);
            }

            let data;
            try {
                data = JSON.parse(rawText);
            } catch (parseError) {
                console.error("[product_viz] Invalid JSON from server:", rawText);
                throw new Error(
                    `Server returned invalid JSON (HTTP ${response.status}): ` +
                    `${parseError.message}. Raw response: ${snippet}`
                );
            }

            if (!data || !data.success || !data.product) {
                throw new Error((data && data.error) || "Failed to load product data");
            }
            
            this.productData = data;
            this.backgrounds = data.backgrounds || []; // Store the array of linked backgrounds

            // Find the index of the primary background (the one linked to the specific product ID)
            this.currentBackgroundIndex = 0; // Default to first background
            if (data.background && this.backgrounds.length > 0) {
                const primaryBackgroundId = data.background.id;
                const index = this.backgrounds.findIndex(bg => bg.id === primaryBackgroundId);
                if (index !== -1) {
                    this.currentBackgroundIndex = index;
                }
            }

            if (this.backgrounds.length === 0) {
                 console.warn("Product loaded but no backgrounds are associated with it.");
                 // Handle case with no backgrounds if necessary
            }

            this.currentProductId = id;
            this.currentRoomName = this.backgrounds.length > 0
                ? this.backgrounds[this.currentBackgroundIndex].name
                : null;

            // Render the product and the initial background
            this.renderVisualization();

            // Now that this product's backgrounds are known, honour the room the remote asked
            // for. Doing it here (rather than before the fetch) is what makes "switch product
            // and room together" land in one step instead of two.
            if (this.desiredRoomName && this.desiredRoomName !== this.currentRoomName) {
                this.selectRoom(this.desiredRoomName);
            }
            this.applyTransform(this.lastState);

        } catch (error) {
            console.error("Error loading product:", error);
            this.showError(`Failed to load product details. ${error.message}`);
        } finally {
            this.loadingFor = null;
        }
    }

    /**
     * Shorthand used by the state sync: load a product named by the shared state.
     */
    loadProductById(id) {
        return this.loadProduct(id);
    }

    /**
     * Render the product visualization
     */
    renderVisualization() {
        const { product } = this.productData;
        
        // Set product info
        document.getElementById("product-name").textContent = product.name || "Product";
        document.getElementById("product-description").textContent = product.description || "";
        
        // Render the current background (based on index)
        this.renderBackground();
        
        // Render the product image
        this.renderProduct();
        
        // Hide background selector UI elements (as only arrow keys are used)
        const backgroundsToggle = document.getElementById("backgrounds-toggle");
        if (backgroundsToggle) backgroundsToggle.style.display = "none";
        const backgroundSelector = document.getElementById("background-selector");
        if (backgroundSelector) backgroundSelector.style.display = "none";
        
        // Show the visualization container
        document.getElementById("fullscreen-container").style.display = "block";
        
        // Hide loading overlay
        this.hideLoading();
        
        // Set page title
        document.title = `${product.name || "Product"} - Visualization`;
    }

    /**
     * Render the current background based on the index
     */
    renderBackground() {
        const backgroundContainer = document.getElementById("background-container");
        
        if (this.backgrounds.length === 0 || !this.backgrounds[this.currentBackgroundIndex]) {
            console.warn("Attempting to render background, but no background data is available at index", this.currentBackgroundIndex);
            backgroundContainer.innerHTML = 
                '<div style="width:100%;height:100%;background-color:#222; display:flex; align-items:center; justify-content:center; color:grey;"><span>No Background Available</span></div>';
            return;
        }
        
        const background = this.backgrounds[this.currentBackgroundIndex];
        
        backgroundContainer.innerHTML = `
            <img src="uploads/backgrounds/${background.image_filename}" 
                 alt="${this.escapeHtml(background.name) || "Background"}" 
                 class="background-image">
        `;
    }

    /**
     * Render the product image with proper positioning within the current background's marking area.
     */
    renderProduct() {
        const vizMarkingArea = document.getElementById("viz-marking-area");
        const productContainer = document.getElementById("product-container");
        const { product } = this.productData;
        
        if (!product || !product.image_filename) {
            vizMarkingArea.style.display = "none";
            return;
        }

        vizMarkingArea.style.display = "block";

        productContainer.innerHTML = `
            <img src="uploads/products/${product.image_filename}" 
                 alt="${this.escapeHtml(product.name) || "Product"}" 
                 class="product-image">
        `;

        // Position based on the CURRENT background
        const background = this.backgrounds.length > 0 ? this.backgrounds[this.currentBackgroundIndex] : null;

        if (background) {
            const top = background.marking_top_percent || 0;
            const left = background.marking_left_percent || 0;
            const width = background.marking_width_percent || 100;
            const height = background.marking_height_percent || 100;
            const padding = background.marking_padding_percent || 0;

            vizMarkingArea.style.position = "absolute";
            vizMarkingArea.style.top = `${top}%`;
            vizMarkingArea.style.left = `${left}%`;
            vizMarkingArea.style.width = `${width}%`;
            vizMarkingArea.style.height = `${height}%`;
            vizMarkingArea.style.padding = `${padding}%`;

            productContainer.style.position = "relative";
            productContainer.style.width = "100%";
            productContainer.style.height = "100%";
            productContainer.style.top = "auto";
            productContainer.style.left = "auto";
            productContainer.style.padding = "0";
            productContainer.style.display = "flex";
            productContainer.style.alignItems = "center";
            productContainer.style.justifyContent = "center";
        } else {
            // Fallback if no background data
            vizMarkingArea.style.position = "absolute";
            vizMarkingArea.style.top = "0";
            vizMarkingArea.style.left = "0";
            vizMarkingArea.style.width = "100%";
            vizMarkingArea.style.height = "100%";
            vizMarkingArea.style.padding = "0";
            
            productContainer.style.position = "relative";
            productContainer.style.width = "100%";
            productContainer.style.height = "100%";
            productContainer.style.display = "flex";
            productContainer.style.alignItems = "center";
            productContainer.style.justifyContent = "center";
        }

        // Re-apply the remote's scale/position/flip. Without this, replacing the <img> (or
        // switching room) would reset the transform to the background's default marking area
        // and the display would jump until the next poll.
        this.applyTransform(this.lastState);
    }

    /**
     * Set the current background by index and re-render
     * @param {number} index - Background index in the this.backgrounds array
     */
    setBackground(index) {
        if (index < 0 || index >= this.backgrounds.length || index === this.currentBackgroundIndex) {
            return; // Ignore invalid or same index
        }
        
        this.currentBackgroundIndex = index;
        this.renderBackground();
        this.renderProduct(); // Re-render product for potentially different marking area

        // Keep the sync bookkeeping in step with manual arrow-key navigation. Without this the
        // next poll would see a room mismatch and snap the display back to the remote's room,
        // making the keyboard unusable while the app is connected.
        const bg = this.backgrounds[index];
        if (bg) {
            this.currentRoomName = bg.name;
            this.desiredRoomName = bg.name;
        }
    }

    /**
     * Switch to the next background in the list
     */
    nextBackground() {
        if (this.backgrounds.length <= 1) return;
        
        let nextIndex = this.currentBackgroundIndex + 1;
        if (nextIndex >= this.backgrounds.length) {
            nextIndex = 0; // Wrap around to the beginning
        }
        
        this.setBackground(nextIndex);
    }

    /**
     * Switch to the previous background in the list
     */
    previousBackground() {
        if (this.backgrounds.length <= 1) return;
        
        let prevIndex = this.currentBackgroundIndex - 1;
        if (prevIndex < 0) {
            prevIndex = this.backgrounds.length - 1; // Wrap around to the end
        }
        
        this.setBackground(prevIndex);
    }

    /**
     * Toggle product info visibility
     */
    toggleProductInfo() {
        const infoElement = document.getElementById("product-info");
        this.showInfo = !this.showInfo;
        infoElement.classList.toggle("hidden", !this.showInfo);
    }

    // toggleBackgroundSelector is not needed as UI is hidden

    /**
     * Toggle fullscreen mode
     */
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            this.enterFullscreen();
        } else {
            this.exitFullscreen();
        }
    }

    /**
     * Enter fullscreen mode
     */
    enterFullscreen() {
        const container = document.getElementById("fullscreen-container");
        if (container.requestFullscreen) container.requestFullscreen();
        else if (container.mozRequestFullScreen) container.mozRequestFullScreen(); // Firefox
        else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen(); // Chrome, Safari, Opera
        else if (container.msRequestFullscreen) container.msRequestFullscreen(); // IE/Edge
    }

    /**
     * Exit fullscreen mode
     */
    exitFullscreen() {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
    }

    /**
     * Update fullscreen button icon based on current state
     */
    updateFullscreenButton() {
        const button = document.getElementById("fullscreen-toggle");
        if (this.isFullscreen) {
            button.innerHTML = 
                '<i class="fas fa-compress"></i>';
            button.title = "Exit Fullscreen";
        } else {
            button.innerHTML = 
                '<i class="fas fa-expand"></i>';
            button.title = "Enter Fullscreen";
        }
    }

    /**
     * Show loading overlay
     */
    showLoading() {
        document.getElementById("loading-overlay").style.display = "flex";
        document.getElementById("fullscreen-container").style.display = "none";
        document.getElementById("error-message").style.display = "none";
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        document.getElementById("loading-overlay").style.display = "none";
    }

    /**
     * Show error message
     * @param {string} message - Error message to display
     */
    showError(message) {
        const errorElement = document.getElementById("error-message");
        const errorMessage = errorElement.querySelector("p");
        errorMessage.textContent = message;
        errorElement.style.display = "flex";
        this.hideLoading(); // Hide loading if error occurs
        document.getElementById("fullscreen-container").style.display = "none";
    }

    /**
     * Escape HTML characters
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>\'"/]/g, function (s) {
            const entityMap = {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                "\"": "&quot;",
                "'": "&#39;",
                "/": "&#x2F;",
            };
            return entityMap[s];
        });
    }
}

/**
 * Constrain a number to a range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    if (!isFinite(value)) return min;
    return Math.min(Math.max(value, min), max);
}

/**
 * Round to two decimals, for tidy CSS values.
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
    return Math.round(value * 100) / 100;
}

// Initialize the viewer when the DOM is ready
document.addEventListener(
    "DOMContentLoaded",
    () => {
        window.pvViewer = new ProductVizViewer();
    }
);