
// Product Viewer JavaScript
class ProductViewer {
    constructor() {
        this.productId = this.getProductIdFromUrl(); // Can be null if no ID in URL
        this.productData = null;
        this.isZoomMode = false; // Track if zoom mode is active
        this.currentScale = 1; // Track current zoom level
        this.minScale = 0.5; // Minimum zoom level
        this.maxScale = 3; // Maximum zoom level
        this.scaleStep = 0.1; // Zoom step per scroll
        this.init();
    }

    init() {
        // No longer show error if productId is null, just proceed to load
        // The loadProduct method will handle fetching the latest if ID is missing
        console.log("Initializing ProductViewer. Product ID from URL:", this.productId);
        this.loadProduct();
        this.setupEventListeners();
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

    async loadProduct() {
        try {
            this.showLoading();

            // Construct API URL: Fetch specific ID or latest if ID is null/invalid
            let apiUrl = "get_product.php";
            if (this.productId) {
                apiUrl += `?id=${this.productId}`;
                console.log(`Fetching specific product with ID: ${this.productId}`);
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

            if (!data || !data.success || !data.product) {
                throw new Error(
                    data.error ||
                    "Failed to load product data or product data is incomplete."
                );
            }

            this.productData = data;
            // If we fetched the latest, update the URL for clarity/bookmarking (optional)
            if (!this.productId && data.product && data.product.id) {
                this.productId = data.product.id.toString(); // Store the actual ID loaded
                // Update URL without reloading page
                const newUrl = `${window.location.pathname}?id=${this.productId}${window.location.hash}`;
                window.history.replaceState({ path: newUrl }, '', newUrl);
                console.log(`Loaded latest product (ID: ${this.productId}). URL updated.`);
            }
            
            this.renderProduct();

        } catch (error) {
            console.error("Error loading product:", error);
            this.showError(`Failed to load product details. ${error.message}`);
        } finally {
            // Ensure loading is hidden unless an error is explicitly shown.
            if (document.getElementById("error-message").style.display !== "flex") {
                this.hideLoading();
            }
        }
    }

    renderProduct() {
        const { product, background, details, stickers } = this.productData;

        document.getElementById("product-name").textContent =
            product.name || "Product Name";
        document.getElementById("product-description").textContent =
            product.description || "Product description goes here.";

        const productImage = document.getElementById("product-image");
        const imagePath = `uploads/products/${product.image}`;
        console.log("Setting product image path:", imagePath);
        productImage.src = imagePath;
        productImage.alt = product.name || "Product Image";

        this.renderDetails(details);
        this.renderStickers(stickers);

        if (background && background.marking) {
            this.createProductMarking();
        }

        document.title = `${product.name || "Product"} - Product Visualizer`;
        this.hideLoading(); // Hide loading after all rendering is set up.
        document.getElementById("main-content").style.display = "flex"; // Show main content
    }

    renderDetails(details) {
        const detailsGrid = document.getElementById("details-grid");
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
                if (modal.style.display === "flex") {
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
        document.getElementById("loading-spinner").style.display = "flex";
        document.getElementById("main-content").style.display = "none";
        document.getElementById("error-message").style.display = "none";
    }

    hideLoading() {
        document.getElementById("loading-spinner").style.display = "none";
        // Main content visibility is handled in renderProduct after successful load
    }

    showError(message) {
        this.hideLoading(); // Hide loading spinner first
        const errorContainer = document.getElementById("error-message");
        const errorMessageElement = errorContainer.querySelector("p");
        if (errorMessageElement) {
            errorMessageElement.textContent = message;
        }
        errorContainer.style.display = "flex";
        document.getElementById("main-content").style.display = "none"; // Hide main content on error
    }

    escapeHtml(unsafe) {
        if (unsafe === null || unsafe === undefined) return '';
        return unsafe
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
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
});

