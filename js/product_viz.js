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
        
        this.init();
    }

    /**
     * Initialize the viewer
     */
    init() {
        if (!this.productId) {
            this.showError("No product ID provided in URL");
            return;
        }
        
        this.setupEventListeners();
        this.loadProduct();
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

    /**
     * Load product data (including all linked backgrounds) from API
     */
    async loadProduct() {
        try {
            this.showLoading();
            
            if (!this.productId || isNaN(parseInt(this.productId)) || parseInt(this.productId) <= 0) {
                throw new Error("Invalid Product ID");
            }

            const apiUrl = `get_product_fullscreen.php?id=${this.productId}`;
            
            const response = await fetch(apiUrl, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}. Server response: ${errorText.substring(0, 200)}`);
            }
            
            const data = await response.json();
            
            if (!data || !data.success || !data.product) {
                throw new Error(data.error || "Failed to load product data");
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
            
            // Render the product and the initial background
            this.renderVisualization();
            
        } catch (error) {
            console.error("Error loading product:", error);
            this.showError(`Failed to load product details. ${error.message}`);
        }
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
        
        // Update active state in selector (if UI were visible)
        // const options = document.querySelectorAll(".background-option");
        // options.forEach((option, i) => {
        //     option.classList.toggle("active", i === index);
        // });
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

// Initialize the viewer when the DOM is ready
document.addEventListener(
    "DOMContentLoaded",
    () => {
        new ProductVizViewer();
    }
);