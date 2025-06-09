// Product Detail Modal Functionality
document.addEventListener('DOMContentLoaded', function() {
    const addProductDetailBtn = document.getElementById("add-product-detail-btn");
    const productDetailModal = document.getElementById('product-detail-modal');
    const productDetailForm = document.getElementById('productDetailForm');
    const cancelBtn = document.getElementById('cancel-product-detail-btn');
    const messageDiv = document.getElementById('product-detail-message');
    const productIdInput = document.getElementById('product_id');
    const suggestionsDiv = document.getElementById("product_suggestions");

    // Function to fetch product suggestions from the PHP script
    async function fetchProductSuggestions(query) {
        try {
            const response = await fetch(`get_product_suggestions.php?search=${encodeURIComponent(query)}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (data.success) {
                return data.suggestions;
            } else {
                console.error("Error from PHP script:", data.error);
                return [];
            }
        } catch (error) {
            console.error("Fetch error:", error);
            return [];
        }
    }

    // Open modal when new button is clicked
    if (addProductDetailBtn) {
        addProductDetailBtn.addEventListener("click", function(e) {
            e.preventDefault();
            openProductDetailModal();
        });
    }

    // Close modal functionality
    function closeProductDetailModal() {
        productDetailModal.style.display = 'none';
        productDetailForm.reset();
        messageDiv.style.display = 'none';
        suggestionsDiv.style.display = 'none';
    }

    // Open modal functionality
    function openProductDetailModal() {
        productDetailModal.style.display = 'flex';
        productIdInput.focus();
    }

    // Close modal when clicking X or cancel button
    productDetailModal.addEventListener('click', function(e) {
        if (e.target.classList.contains('close-modal') || e.target === productDetailModal) {
            closeProductDetailModal();
        }
    });

    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeProductDetailModal);
    }

    // Autocomplete functionality for product ID
    let currentSuggestionIndex = -1;

    productIdInput.addEventListener("input", async function() {
        const query = this.value.trim();
        
        if (query.length < 1) {
            suggestionsDiv.style.display = "none";
            return;
        }

        const filteredProducts = await fetchProductSuggestions(query);

        if (filteredProducts.length > 0) {
            suggestionsDiv.innerHTML = filteredProducts.map((product, index) => `
                <div class="autocomplete-suggestion" data-index="${index}" data-id="${product.id}">
                    <div class="suggestion-id">${product.id}</div>
                    <div class="suggestion-name">${product.name}</div>
                </div>
            `).join("");
            suggestionsDiv.style.display = "block";
            currentSuggestionIndex = -1;
        } else {
            suggestionsDiv.style.display = "none";
        }
    });

    // Handle suggestion clicks
    suggestionsDiv.addEventListener('click', function(e) {
        const suggestion = e.target.closest('.autocomplete-suggestion');
        if (suggestion) {
            const productId = suggestion.getAttribute('data-id');
            productIdInput.value = productId;
            suggestionsDiv.style.display = 'none';
        }
    });

    // Handle keyboard navigation in suggestions
    productIdInput.addEventListener('keydown', function(e) {
        const suggestions = suggestionsDiv.querySelectorAll('.autocomplete-suggestion');
        
        if (suggestions.length === 0) return;

        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                currentSuggestionIndex = Math.min(currentSuggestionIndex + 1, suggestions.length - 1);
                updateSuggestionHighlight(suggestions);
                break;
            case 'ArrowUp':
                e.preventDefault();
                currentSuggestionIndex = Math.max(currentSuggestionIndex - 1, -1);
                updateSuggestionHighlight(suggestions);
                break;
            case 'Enter':
                if (currentSuggestionIndex >= 0) {
                    e.preventDefault();
                    const selectedSuggestion = suggestions[currentSuggestionIndex];
                    const productId = selectedSuggestion.getAttribute('data-id');
                    productIdInput.value = productId;
                    suggestionsDiv.style.display = 'none';
                }
                break;
            case 'Escape':
                suggestionsDiv.style.display = 'none';
                currentSuggestionIndex = -1;
                break;
        }
    });

    function updateSuggestionHighlight(suggestions) {
        suggestions.forEach((suggestion, index) => {
            suggestion.classList.toggle('highlighted', index === currentSuggestionIndex);
        });
    }

    // Hide suggestions when clicking outside
    document.addEventListener('click', function(e) {
        if (!productIdInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.style.display = 'none';
        }
    });

    // Form submission
    productDetailForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const formData = new FormData(this);
        
        // Show loading state
        const submitBtn = this.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
        submitBtn.disabled = true;

        try {
            const response = await fetch('add_product_detail.php', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
                showMessage(result.message || 'Product detail added successfully!', 'success');
                
                // Reset form after successful submission
                setTimeout(() => {
                    closeProductDetailModal();
                }, 1500);
            } else {
                showMessage(result.message || 'Error adding product detail. Please try again.', 'error');
            }
            
        } catch (error) {
            console.error('Error:', error);
            showMessage('Network error. Please check your connection and try again.', 'error');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });

    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = `message ${type}`;
        messageDiv.style.display = 'block';
    }

    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && productDetailModal.style.display === 'flex') {
            closeProductDetailModal();
        }
    });
});

