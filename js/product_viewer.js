// Product Viewer JavaScript
class ProductViewer {
    constructor() {
        this.productId = this.getProductIdFromUrl(); // Can be null if no ID in URL
        this.initialProductId = this.productId;      // What ?id= said when the page opened
        this.currentProductId = null;                // Product actually on screen
        this.productData = null;
        this.isZoomMode = false; // Track if zoom mode is active
        this.currentScale = 1; // Track current zoom level
        this.minScale = 0.5; // Minimum zoom level
        this.maxScale = 3; // Maximum zoom level
        this.scaleStep = 0.1; // Zoom step per scroll

        // --- Shared-state sync (Android remote -> this page) -------------------
        // product_viz.html always followed api/state.php, but this page used to load
        // ?id= once and then ignore every later change. That is why Prev / Next on the
        // phone appeared to "do nothing" while the details page was on screen. The fields
        // below let this page follow the same document, exactly like the visualizer does.
        this.lastStateProductId = null; // last product_id observed in api/state.php
        this.syncInFlight = false;      // guard so slow polls cannot stack up
        this.syncTimer = null;          // setInterval handle
        this.loadingFor = null;         // id currently being fetched
        this.loadToken = 0;             // incremented per load, discards stale responses

        this.init();
    }

    init() {
        // No longer show error if productId is null, just proceed to load
        // The loadProduct method will handle fetching the latest if ID is missing
        console.log("Initializing ProductViewer. Product ID from URL:", this.productId);
        this.loadProduct(this.productId);
        this.setupEventListeners();
        this.startStateSync();
    }

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

        // Return the ID (string) or null if not found
        // Validate it's a positive integer before using it in loadProduct
        const parsedId = productId ? parseInt(productId, 10) : null;
        return (parsedId && parsedId > 0) ? parsedId.toString() : null;
    }

    // =========================================================================
    // Shared-state sync (Android remote -> this page)
    // =========================================================================

    /**
     * Poll api/state.php and follow the product the remote is showing.
     *
     * The visualizer page has always done this; the details page did not, so pressing
     * Prev / Next on the phone changed `state.product_id` and only the visualizer moved.
     * Polling (1 s, same document, no new channel) keeps the two pages consistent.
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
     * One read of the shared state.
     */
    async syncOnce() {
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
                // An unreachable API must not break the page: the ?id= product stays on screen.
                console.warn("state.php unavailable, keeping the product on screen:", error.message);
                return;
            }

            this.applyState(state);
        } finally {
            this.syncInFlight = false;
        }
    }

    /**
     * Apply a state document to this page.
     *
     * Reacts to *changes* of `state.product_id`, not to its absolute value: a page opened
     * from a shared ?id= link keeps that product until the remote actually presses
     * Prev / Next, at which point the value changes and this page follows.
     */
    applyState(state) {
        if (!state || typeof state !== "object") return;

        const incoming = (state.product_id != null) ? String(state.product_id) : null;
        if (!incoming || !/^\d+$/.test(incoming)) return;

        if (this.lastStateProductId === null) {
            // First read in this session: adopt whatever the presentation is showing as the
            // baseline instead of acting on it (a stale command must never hijack a deep link).
            this.lastStateProductId = incoming;
            if (!this.initialProductId && incoming !== this.currentProductId) {
                // Opened without ?id=: there is no product of our own, so show the remote's.
                this.loadProduct(incoming);
            }
            return;
        }

        if (incoming === this.lastStateProductId) return; // nothing changed
        this.lastStateProductId = incoming;

        if (incoming === this.currentProductId) return;  // already on screen
        // The remote's nav command and this poll can name the same product in the same
        // second; without this guard the page would fetch it twice.
        if (this.loadingFor === incoming) return;
        console.log(`Remote switched the product to ${incoming}; updating this page.`);
        this.loadProduct(incoming);
    }

    /**
     * Show a product by id without a page reload. Used by pc_remote_nav.js so tapping
     * "Details" for a different product on an already-open details page swaps in place.
     *
     * @param {string|number} productId
     * @returns {boolean} true when the request was valid
     */
    showProduct(productId) {
        if (productId === null || productId === undefined) return false;
        const target = String(productId).trim();
        if (!/^\d+$/.test(target) || parseInt(target, 10) <= 0) return false;
        if (target === this.currentProductId) return true;
        this.loadProduct(target);
        return true;
    }

    async loadProduct(productId) {
        // Accept an explicit id so the state sync can swap products without a page reload.
        const requestedId = (productId != null && String(productId) !== "")
            ? String(productId)
            : this.productId;

        // Every load gets a token: if the remote skips several products quickly, only the
        // newest response is allowed to paint, so a slow reply cannot overwrite a newer one.
        const token = ++this.loadToken;

        try {
            // Only blank the page for the very first paint. A Prev / Next from the remote
            // should swap the product in place instead of flashing the spinner.
            if (!this.currentProductId) this.showLoading();

            this.loadingFor = requestedId;

            // Construct API URL: Fetch specific ID or latest if ID is null/invalid
            let apiUrl = "get_product.php";
            if (requestedId) {
                apiUrl += `?id=${encodeURIComponent(requestedId)}`;
                console.log(`Fetching specific product with ID: ${requestedId}`);
            } else {
                console.log("No product ID in URL. Fetching the latest product.");
                // No ID parameter needed, backend handles this
            }

            console.log("Fetching from:", apiUrl);

            const response = await fetch(apiUrl, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
            });

            console.log("Response status:", response.status);

            if (!response.ok) {
                let errorText = "Unknown error";
                try {
                    errorText = await response.text();
                } catch (e) { /* Ignore if text cannot be read */ }
                console.error("Error response text:", errorText);
                // Try to parse JSON error message from backend
                let errorMessage = `HTTP error! status: ${response.status}.`;
                try {
                    const errorJson = JSON.parse(errorText);
                    if (errorJson && errorJson.error) {
                        errorMessage += ` Server says: ${errorJson.error}`;
                    }
                } catch (e) {
                    errorMessage += ` Server response: ${errorText.substring(0, 200)}`;
                }
                throw new Error(errorMessage);
            }

            const data = await response.json();
            console.log("Received data:", data);

            // A newer load started while this request was in flight: drop this result.
            if (token !== this.loadToken) return;

            if (!data || !data.success || !data.product) {
                throw new Error(
                    data.error ||
                    "Failed to load product data or product data is incomplete."
                );
            }

            this.productData = data;

            // Remember which product is actually on screen (also used by pc_remote_nav.js).
            this.currentProductId = (data.product.id != null)
                ? String(data.product.id)
                : (requestedId || null);
            this.productId = this.currentProductId;

            if (this.currentProductId) {
                // Keep the address bar in step so Share / refresh / Back all describe the
                // product being shown. replaceState never adds a history entry.
                const desiredSearch = `?id=${this.currentProductId}`;
                if (window.location.search !== desiredSearch) {
                    const newUrl = `${window.location.pathname}${desiredSearch}${window.location.hash}`;
                    window.history.replaceState({ path: newUrl }, "", newUrl);
                }
            }

            // Make sure the "Product Not Found" panel is not covering a good render.
            const errorContainer = document.getElementById("error-message");
            if (errorContainer && errorContainer.style.display === "flex") {
                errorContainer.style.display = "none";
            }

            this.renderProduct();

        } catch (error) {
            // A superseded request must not paint an error over the product that replaced it.
            if (token !== this.loadToken) return;
            // Log the real error with its stack so the failing line is visible even
            // though the panel below can only show one sentence.
            console.error(`Error loading product ${requestedId || "(latest)"}:`, error,
                error && error.stack ? "\n" + error.stack : "");
            this.showError(`Failed to load product details. ${error && error.message ? error.message : error}`);
        } finally {
            if (token === this.loadToken) this.loadingFor = null;
            // Ensure loading is hidden unless an error is explicitly shown.
            // Guarded: this used to dereference .style on a missing element, which
            // threw inside finally() and replaced the real error with
            // "Cannot read properties of null (reading 'style')".
            const overlay = document.getElementById("error-message");
            if (!overlay || overlay.style.display !== "flex") {
                this.hideLoading();
            }
        }
    }

    renderProduct() {
        const { product, background, details, stickers } = this.productData;

        const nameEl = document.getElementById("product-name");
        if (nameEl) nameEl.textContent = product.name || "Product Name";
        const descEl = document.getElementById("product-description");
        if (descEl) descEl.textContent = product.description || "Product description goes here.";

        // A page without #product-image (or a render that races a navigation) must
        // not take down the whole view: log it and keep the text/marking rendering.
        const productImage = document.getElementById("product-image");
        if (!productImage) {
            console.error("[product_viewer] #product-image is missing; cannot show the product photo.");
        } else {
            const imagePath = `uploads/products/${product.image}`;
            console.log("Setting product image path:", imagePath);
            // Drop any zoom left over from the previous product so the swap starts clean.
            this.isZoomMode = false;
            this.currentScale = 1;
            productImage.style.transform = "";
            productImage.src = imagePath;
            productImage.alt = product.name || "Product Image";
        }

        this.renderDetails(details);
        this.renderStickers(stickers);

        if (background && background.marking) {
            this.createProductMarking();
        }

        document.title = `${product.name || "Product"} - Product Visualizer`;
        this.hideLoading(); // Hide loading after all rendering is set up.
        const main = document.getElementById("main-content");
        if (main) main.style.display = "flex"; // Show main content
    }

    renderDetails(details) {
        const detailsGrid = document.getElementById("details-grid");
        if (!detailsGrid) return; // page without a details grid: nothing to draw
        detailsGrid.innerHTML = ""; // Clear existing example details

        if (!details || details.length === 0) {
            detailsGrid.innerHTML = `
                <div class="detail-item">
                    <div class="detail-content">
                        <div class="detail-label">Information</div>
                        <div class="detail-value">No additional details available for this product.</div>
                    </div>
                </div>
            `;
            return;
        }

        details.forEach((detail, index) => {
            const detailElement = this.createDetailElement(detail, index);
            detailsGrid.appendChild(detailElement);
        });
    }

    createDetailElement(detail, index) {
        const detailDiv = document.createElement("div");
        detailDiv.className = "detail-item";
        detailDiv.setAttribute("data-type", detail.type);

        detailDiv.style.animationDelay = `${index * 0.07}s`;

        const iconMap = {
            technology: "fas fa-cogs",
            detection: "fas fa-search-location",
            specification: "fas fa-cog",
            feature: "fas fa-star",
            dimension: "fas fa-ruler-combined",
            size: "fas fa-expand-arrows-alt",
            material: "fas fa-cubes",
            quality: "fas fa-award",
            warranty: "fas fa-headset",
            coverage: "fas fa-shield-alt",
            color: "fas fa-palette",
            weight: "fas fa-weight-hanging",
            brand: "fas fa-tag",
            model: "fas fa-barcode",
            price: "fas fa-dollar-sign",
            default: "fas fa-info-circle",
        };

        const iconClass =
            iconMap[detail.type.toLowerCase()] || iconMap["default"];

        detailDiv.innerHTML = `
            <div class="detail-icon">
                <i class="${iconClass}"></i>
            </div>
            <div class="detail-content">
                <div class="detail-label">${this.escapeHtml(detail.label)}</div>
                <div class="detail-value">${this.escapeHtml(detail.value)}</div>
            </div>
        `;

        return detailDiv;
    }

    renderStickers(stickers) {
        const stickersContainer = document.getElementById("stickers-container");
        if (!stickersContainer) return;
        stickersContainer.innerHTML = ""; // Clear existing example stickers

        if (!stickers || stickers.length === 0) {
            return;
        }

        stickers.forEach((sticker) => {
            const stickerElement = this.createStickerElement(sticker);
            stickersContainer.appendChild(stickerElement);
        });
    }

    createStickerElement(sticker) {
        const stickerImg = document.createElement("img");
        stickerImg.src = `uploads/stickers/${sticker.filename}`;
        stickerImg.alt = sticker.alt_text || "Product Sticker";
        stickerImg.className = "product-sticker";
        return stickerImg;
    }

    setupEventListeners() {
        const productImageContainer = document.querySelector(
            ".product-image-container"
        );
        const imageZoomButton = document.querySelector(".image-zoom-button");

        if (imageZoomButton) {
            imageZoomButton.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleZoomMode();
            });
        }

        if (productImageContainer) {
            productImageContainer.addEventListener("click", (e) => {
                if (!this.isZoomMode && !e.target.closest(".image-zoom-button")) {
                    this.openImageModal();
                }
            });
        }

        document.addEventListener(
            "wheel",
            (e) => {
                if (this.isZoomMode) {
                    const rect = productImageContainer.getBoundingClientRect();
                    if (
                        e.clientX >= rect.left &&
                        e.clientX <= rect.right &&
                        e.clientY >= rect.top &&
                        e.clientY <= rect.bottom
                    ) {
                        e.preventDefault();
                        this.handleZoom(e);
                    }
                }
            },
            { passive: false }
        );

        const modal = document.getElementById("image-modal");
        if (modal) {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) {
                    this.closeImageModal();
                }
            });
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                if (modal && modal.style.display === "flex") {
                    this.closeImageModal();
                } else if (this.isZoomMode) {
                    this.exitZoomMode();
                }
            }
        });

        const detailsGrid = document.getElementById("details-grid");
        if (detailsGrid) {
            detailsGrid.addEventListener(
                "mouseenter",
                (e) => {
                    const item = e.target.closest(".detail-item");
                    if (item) this.handleDetailHover(item);
                },
                true
            );
            detailsGrid.addEventListener(
                "mouseleave",
                (e) => {
                    const item = e.target.closest(".detail-item");
                    if (item) this.handleDetailLeave(item);
                },
                true
            );
        }
    }

    toggleZoomMode() {
        if (this.isZoomMode) {
            this.exitZoomMode();
        } else {
            this.enterZoomMode();
        }
    }

    enterZoomMode() {
        this.isZoomMode = true;
        const zoomButton = document.querySelector(".image-zoom-button");
        const productImageContainer = document.querySelector(
            ".product-image-container"
        );

        if (zoomButton) {
            zoomButton.innerHTML =
                '<i class="fas fa-search-minus"></i><span>Exit zoom</span>';
            zoomButton.classList.add("active");
        }

        if (productImageContainer) {
            productImageContainer.classList.add("zoom-mode");
            productImageContainer.style.cursor = "zoom-in";
        }

        this.currentScale = 1;
        this.applyZoom();
        console.log("Zoom mode activated");
    }

    exitZoomMode() {
        this.isZoomMode = false;
        const zoomButton = document.querySelector(".image-zoom-button");
        const productImageContainer = document.querySelector(
            ".product-image-container"
        );

        if (zoomButton) {
            zoomButton.innerHTML =
                '<i class="fas fa-search-plus"></i><span>Click to zoom</span>';
            zoomButton.classList.remove("active");
        }

        if (productImageContainer) {
            productImageContainer.classList.remove("zoom-mode");
            productImageContainer.style.cursor = "";
        }

        this.currentScale = 1;
        this.applyZoom();
        console.log("Zoom mode deactivated");
    }

    handleZoom(e) {
        const delta = e.deltaY;
        const productImageContainer = document.querySelector(
            ".product-image-container"
        );

        if (delta < 0) {
            this.currentScale = Math.min(
                this.currentScale + this.scaleStep,
                this.maxScale
            );
            if (productImageContainer) productImageContainer.style.cursor = "zoom-in";
        } else {
            this.currentScale = Math.max(
                this.currentScale - this.scaleStep,
                this.minScale
            );
             if (productImageContainer) productImageContainer.style.cursor = "zoom-out";
        }

        this.applyZoom();
        console.log("Zoom level:", this.currentScale);
    }

    applyZoom() {
        const productImage = document.getElementById("product-image");
        if (productImage) {
            productImage.style.transform = `scale(${this.currentScale})`;
            productImage.style.transition = "transform 0.2s ease";
        }
    }

    handleDetailHover(element) {
        element.style.transform = "translateY(-3px) scale(1.02)";
        element.style.boxShadow = "0 6px 18px rgba(0,0,0,0.1)";
    }

    handleDetailLeave(element) {
        element.style.transform = "translateY(0) scale(1)";
        element.style.boxShadow = "";
    }

    openImageModal() {
        const modal = document.getElementById("image-modal");
        const modalImage = document.getElementById("modal-image");
        const productImage = document.getElementById("product-image");

        if (modal && modalImage && productImage && productImage.src) {
            modalImage.src = productImage.src;
            modalImage.alt = productImage.alt;
            modal.style.display = "flex";
            document.body.style.overflow = "hidden";

            if (this.isZoomMode) {
                this.exitZoomMode();
            }
        }
    }

    closeImageModal() {
        const modal = document.getElementById("image-modal");
        if (modal) {
            modal.style.display = "none";
            document.body.style.overflow = "auto";
        }
    }

    showLoading() {
        const spinner = document.getElementById("loading-spinner");
        if (spinner) spinner.style.display = "flex";
        const main = document.getElementById("main-content");
        if (main) main.style.display = "none";
        const err = document.getElementById("error-message");
        if (err) err.style.display = "none";
    }

    hideLoading() {
        const spinner = document.getElementById("loading-spinner");
        if (spinner) spinner.style.display = "none";
        // Main content visibility is handled in renderProduct after successful load
    }

    /**
     * Show the error panel. Every step is guarded: a missing panel must never
     * throw from inside another error path (which is how the real message used
     * to be replaced by "Cannot read properties of null (reading 'style')").
     */
    showError(message) {
        this.hideLoading(); // Hide loading spinner first
        const errorContainer = document.getElementById("error-message");
        if (errorContainer) {
            const errorMessageElement = errorContainer.querySelector("p");
            if (errorMessageElement) {
                errorMessageElement.textContent = message;
            }
            errorContainer.style.display = "flex";
        }
        const main = document.getElementById("main-content");
        if (main) main.style.display = "none"; // Hide main content on error
    }

    escapeHtml(unsafe) {
        if (unsafe === null || unsafe === undefined) return '';
        // Entities are assembled from their pieces so no editor/transfer step can turn
        // these literals back into the characters they are supposed to escape.
        const AMP = "&" + "amp;";
        const LT = "&" + "lt;";
        const GT = "&" + "gt;";
        const QUOT = "&" + "quot;";
        const APOS = "&" + "#039;";
        return unsafe
            .toString()
            .replace(/&/g, AMP)
            .replace(/</g, LT)
            .replace(/>/g, GT)
            .replace(/"/g, QUOT)
            .replace(/'/g, APOS);
    }
    
    // Placeholder for marking creation if needed based on background data
    createProductMarking() {
        // Implementation depends on how marking should be displayed
        // Example: Add a div overlay on the product image
        console.log("Marking data available:", this.productData.background.marking);
        // Add logic here to visually represent the marking area
    }
}

// Global functions (if needed, e.g., for HTML onclick attributes)
function openImageModal() {
    // This might need to be tied to the instance if state is involved
    // For now, assuming a single ProductViewer instance
    if (window.productViewerInstance) {
        window.productViewerInstance.openImageModal();
    }
}

function closeImageModal() {
    if (window.productViewerInstance) {
        window.productViewerInstance.closeImageModal();
    }
}

function shareProduct() {
    // Basic share functionality
    if (navigator.share) {
        navigator.share({
            title: document.title,
            text: `Check out this product: ${document.getElementById('product-name').textContent}`,
            url: window.location.href
        }).then(() => console.log('Successful share'))
          .catch((error) => console.log('Error sharing', error));
    } else {
        // Fallback for browsers that don't support navigator.share
        alert(`Share this link: ${window.location.href}`);
    }
}

function redirectToProductViz() {
    // Send the display back to the visualizer for the product being viewed.
    // Relative on purpose: the app is served from 192.168.0.113 on the LAN, so a
    // hardcoded "localhost" would resolve to the visitor's own machine.
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    if (productId) {
        window.location.href = `product_viz.html?id=${encodeURIComponent(productId)}`;
    } else if (window.pvRemoteNav) {
        // No ?id= available: let the shared listener use the product on screen.
        window.pvRemoteNav.showVisualization();
    } else {
        window.location.href = 'product_viz.html';
    }
}


// Initialize the viewer when the DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    // Create an instance and optionally store it globally if needed by onclick handlers
    window.productViewerInstance = new ProductViewer();
    // pc_remote_nav.js looks for `window.pvViewer` (same name the visualizer uses) so it
    // can swap the product in place instead of reloading this page.
    window.pvViewer = window.productViewerInstance;
});