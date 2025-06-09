// Product Search JavaScript - Redesigned for below product image
class ProductSearch {
    constructor() {
        this.products = [];
        this.searchResults = [];
        this.init();
    }

    init() {
        // Wait for the product viewer to initialize
        setTimeout(() => {
            this.setupSearchSection();
            this.setupEventListeners();
            this.loadAllProducts();
        }, 500);
    }

    setupSearchSection() {
        // Create search section HTML
        const searchSection = document.createElement('div');
        searchSection.className = 'product-search-section';
        // Add auto-hide class by default
        searchSection.classList.add('search-hidden');
        searchSection.innerHTML = `
            <div class="search-container">
                <input type="text" id="product-search-input" class="search-input" placeholder="Search products by name...">
                <button id="product-search-button" class="search-button">
                    <i class="fas fa-search"></i>
                </button>
            </div>
            <div id="product-search-results" class="product-search-results">
                <!-- Products will be loaded here -->
                <div id="search-loading" style="display: none; width: 100%; text-align: center; padding: 1rem;">
                    <i class="fas fa-spinner fa-spin"></i> Loading products...
                </div>
            </div>
            <div id="no-search-results" class="no-search-results" style="display: none;">
                <i class="fas fa-search"></i>
                <p>No products found matching your search.</p>
            </div>
        `;

        // Append search section to the bottom of product-details-section
        const productDetailsSection = document.querySelector('.product-details-section');
        if (productDetailsSection) {
            productDetailsSection.appendChild(searchSection);
            
            // Add hover event listeners for visibility
            productDetailsSection.addEventListener('mouseenter', () => {
                searchSection.classList.remove('search-hidden');
            });
            
            productDetailsSection.addEventListener('mouseleave', () => {
                // Only hide if not actively being used (no focus in search input)
                if (!document.getElementById('product-search-input').matches(':focus')) {
                    searchSection.classList.add('search-hidden');
                }
            });
            
            // Keep visible when interacting with search
            const searchInput = searchSection.querySelector('#product-search-input');
            if (searchInput) {
                searchInput.addEventListener('focus', () => {
                    searchSection.classList.remove('search-hidden');
                });
                
                searchInput.addEventListener('blur', () => {
                    // Only hide if mouse is not over the product details section
                    if (!productDetailsSection.matches(':hover')) {
                        searchSection.classList.add('search-hidden');
                    }
                });
            }
        }
    }

    setupEventListeners() {
        // Add event listener for search input
        const searchInput = document.getElementById('product-search-input');
        const searchButton = document.getElementById('product-search-button');
        
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.filterProducts(searchInput.value);
            });
            
            // Add enter key support
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.filterProducts(searchInput.value);
                }
            });
        }
        
        if (searchButton) {
            searchButton.addEventListener('click', () => {
                if (searchInput) {
                    this.filterProducts(searchInput.value);
                }
            });
        }
    }

    async loadAllProducts() {
        try {
            this.showSearchLoading();
            
            // Using the list_products.php endpoint for product listing
            const apiUrl = 'list_products.php';
            
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data || !data.success) {
                throw new Error(data.error || 'Failed to load products');
            }
            
            // Remove duplicates at the data level before storing
            this.products = this.removeDuplicateProducts(data.products || []);
            this.renderSearchResults(this.products, 6);
            
        } catch (error) {
            console.error('Error loading products:', error);
            this.showNoSearchResults('Failed to load products. Please try again later.');
        } finally {
            this.hideSearchLoading();
        }
    }

    removeDuplicateProducts(products) {
        const uniqueProducts = [];
        const seenNames = new Set();
        
        products.forEach(product => {
            // Use product name for deduplication (case-insensitive)
            const productName = product.name ? product.name.toLowerCase().trim() : '';
            if (productName && !seenNames.has(productName)) {
                seenNames.add(productName);
                uniqueProducts.push(product);
            }
        });
        
        return uniqueProducts;
    }

    filterProducts(searchTerm) {
        searchTerm = searchTerm.toLowerCase().trim();
        
        if (!searchTerm) {
            this.searchResults = [...this.products];
        } else {
            this.searchResults = this.products.filter(product => 
                product.name.toLowerCase().includes(searchTerm) || 
                (product.description && product.description.toLowerCase().includes(searchTerm))
            );
        }
        
        // Apply deduplication to search results as well
        this.searchResults = this.removeDuplicateProducts(this.searchResults);
        this.renderSearchResults(this.searchResults, 5);
    }

    renderSearchResults(products, maxProducts = 5) {
        const resultsContainer = document.getElementById('product-search-results');
        const noResults = document.getElementById('no-search-results');
        
        if (!resultsContainer || !noResults) return;
        
        // Clear previous results except loading indicator
        const loadingElement = document.getElementById('search-loading');
        resultsContainer.innerHTML = '';
        if (loadingElement) {
            resultsContainer.appendChild(loadingElement);
        }
        
        if (products.length === 0) {
            resultsContainer.style.display = 'none';
            noResults.style.display = 'flex';
            return;
        }
        
        resultsContainer.style.display = 'flex';
        noResults.style.display = 'none';
        
        // Get current product ID to avoid showing it in results
        const currentProductId = String(this.getCurrentProductId());
        
        let displayedCount = 0;
        const displayedProductNames = new Set(); // Track displayed product names to prevent duplicates
        
        products.forEach(product => {
            const productId = String(product.id);
            const productName = product.name ? product.name.toLowerCase().trim() : '';
            
            // Skip current product in results
            if (productId === currentProductId) return;
            
            // Skip if this product name has already been displayed (prevent duplicates)
            if (displayedProductNames.has(productName)) return;
            
            // Skip products without valid names
            if (!productName) return;
            
            // Limit the number of products displayed
            if (displayedCount >= maxProducts) return;
            
            const productElement = this.createSearchResultElement(product);
            resultsContainer.appendChild(productElement);
            displayedProductNames.add(productName); // Mark this product name as displayed
            displayedCount++;
        });
    }

    createSearchResultElement(product) {
        const productItem = document.createElement('a');
        productItem.className = 'product-search-item';
        productItem.href = `individual-product.html?id=${product.id}`;
        productItem.setAttribute('data-id', product.id);
        
        const imageUrl = product.image_filename ? 
            `uploads/products/${product.image_filename}` : 
            'https://via.placeholder.com/100?text=No+Image';
        
        productItem.innerHTML = `
            <div class="product-search-image-container">
                <img src="${imageUrl}" alt="${this.escapeHtml(product.name)}" class="product-search-image">
            </div>
            <div class="product-search-name">${this.escapeHtml(product.name)}</div>
        `;
        
        return productItem;
    }

    getCurrentProductId() {
        // Get current product ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('id');
    }

    showSearchLoading() {
        const loadingElement = document.getElementById('search-loading');
        if (loadingElement) {
            loadingElement.style.display = 'block';
        }
    }

    hideSearchLoading() {
        const loadingElement = document.getElementById('search-loading');
        if (loadingElement) {
            loadingElement.style.display = 'none';
        }
    }

    showNoSearchResults(message = 'No products found matching your search.') {
        const noResults = document.getElementById('no-search-results');
        const resultsContainer = document.getElementById('product-search-results');
        
        if (noResults) {
            const messageElement = noResults.querySelector('p');
            if (messageElement) {
                messageElement.textContent = message;
            }
            noResults.style.display = 'flex';
        }
        
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
        }
    }

    escapeHtml(text) {
        if (typeof text !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the product search when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ProductSearch();
});
