document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('productDetailForm');
    const messageDiv = document.getElementById('message');
    const productIdInput = document.getElementById('product_id');
    const suggestionsDiv = document.getElementById('product_suggestions');
    
    let selectedProductId = null;
    let currentHighlightIndex = -1;
    let suggestions = [];
    let debounceTimer = null;

    // Autocomplete functionality
    productIdInput.addEventListener('input', function() {
        const query = this.value.trim();
        
        // Clear previous timer
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        
        // Debounce the search to avoid too many requests
        debounceTimer = setTimeout(() => {
            if (query.length >= 1) {
                fetchProductSuggestions(query);
            } else {
                hideSuggestions();
            }
        }, 300);
        
        // Reset selected product if user is typing
        selectedProductId = null;
    });

    // Handle keyboard navigation
    productIdInput.addEventListener('keydown', function(e) {
        const suggestionItems = suggestionsDiv.querySelectorAll('.autocomplete-suggestion');
        
        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                currentHighlightIndex = Math.min(currentHighlightIndex + 1, suggestionItems.length - 1);
                updateHighlight(suggestionItems);
                break;
            case 'ArrowUp':
                e.preventDefault();
                currentHighlightIndex = Math.max(currentHighlightIndex - 1, -1);
                updateHighlight(suggestionItems);
                break;
            case 'Enter':
                if (currentHighlightIndex >= 0 && suggestionItems[currentHighlightIndex]) {
                    e.preventDefault();
                    selectSuggestion(suggestions[currentHighlightIndex]);
                }
                break;
            case 'Escape':
                hideSuggestions();
                break;
        }
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', function(e) {
        if (!productIdInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            hideSuggestions();
        }
    });

    function fetchProductSuggestions(query) {
        fetch(`get_product_suggestions.php?search=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    suggestions = data.suggestions;
                    displaySuggestions(suggestions);
                } else {
                    console.error('Error fetching suggestions:', data.error);
                    hideSuggestions();
                }
            })
            .catch(error => {
                console.error('Error:', error);
                hideSuggestions();
            });
    }

    function displaySuggestions(suggestions) {
        if (suggestions.length === 0) {
            hideSuggestions();
            return;
        }

        suggestionsDiv.innerHTML = '';
        currentHighlightIndex = -1;

        suggestions.forEach((suggestion, index) => {
            const suggestionItem = document.createElement('div');
            suggestionItem.className = 'autocomplete-suggestion';
            suggestionItem.innerHTML = `
                <div class="suggestion-id">${suggestion.id}</div>
                <div class="suggestion-name">${suggestion.name}</div>
            `;
            
            suggestionItem.addEventListener('click', () => {
                selectSuggestion(suggestion);
            });
            
            suggestionItem.addEventListener('mouseenter', () => {
                currentHighlightIndex = index;
                updateHighlight(suggestionsDiv.querySelectorAll('.autocomplete-suggestion'));
            });

            suggestionsDiv.appendChild(suggestionItem);
        });

        suggestionsDiv.style.display = 'block';
    }

    function updateHighlight(suggestionItems) {
        suggestionItems.forEach((item, index) => {
            if (index === currentHighlightIndex) {
                item.classList.add('highlighted');
            } else {
                item.classList.remove('highlighted');
            }
        });
    }

    function selectSuggestion(suggestion) {
        productIdInput.value = suggestion.id;
        selectedProductId = suggestion.id;
        hideSuggestions();
        
        // Trigger validation
        validateField(productIdInput);
    }

    function hideSuggestions() {
        suggestionsDiv.style.display = 'none';
        currentHighlightIndex = -1;
    }

    // Original form submission logic
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Clear previous messages
        messageDiv.style.display = 'none';
        messageDiv.className = 'message';
        
        // Validate form
        if (!validateForm()) {
            return;
        }
        
        // Create FormData object to handle file upload
        const formData = new FormData(form);
        
        // Show loading state
        const submitButton = form.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;
        submitButton.textContent = 'Adding...';
        submitButton.disabled = true;
        
        // Send AJAX request
        fetch('add_product_detail.php', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showMessage('Product detail added successfully!', 'success');
                form.reset();
                selectedProductId = null;
            } else {
                showMessage('Error: ' + data.message, 'error');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showMessage('An error occurred while adding the product detail.', 'error');
        })
        .finally(() => {
            // Reset button state
            submitButton.textContent = originalText;
            submitButton.disabled = false;
        });
    });

    function validateForm() {
        const productId = document.getElementById('product_id').value;
        const detailLabel = document.getElementById('detail_label').value;
        const detailValue = document.getElementById('detail_value').value;
        
        if (!productId || productId <= 0) {
            showMessage('Please enter a valid Product ID.', 'error');
            return false;
        }
        
        if (!detailLabel.trim()) {
            showMessage('Please enter a Detail Label.', 'error');
            return false;
        }
        
        if (!detailValue.trim()) {
            showMessage('Please enter a Detail Value.', 'error');
            return false;
        }
        
        // Validate file if uploaded
        const fileInput = document.getElementById('sticker_image_filename');
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
            
            if (!allowedTypes.includes(file.type)) {
                showMessage('Please upload a valid image file (JPEG, PNG, or GIF).', 'error');
                return false;
            }
            
            // Check file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                showMessage('Image file size should be less than 5MB.', 'error');
                return false;
            }
        }
        
        return true;
    }

    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = 'message ' + type;
        messageDiv.style.display = 'block';
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                messageDiv.style.display = 'none';
            }, 5000);
        }
    }

    // Add real-time validation feedback
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('blur', function() {
            validateField(this);
        });
    });

    function validateField(field) {
        const value = field.value.trim();
        
        // Remove previous error styling
        field.style.borderColor = '#ddd';
        
        switch(field.id) {
            case 'product_id':
                if (!value || value <= 0) {
                    field.style.borderColor = '#d9534f';
                } else {
                    field.style.borderColor = '#5cb85c';
                }
                break;
            case 'detail_label':
            case 'detail_value':
                if (!value) {
                    field.style.borderColor = '#d9534f';
                } else {
                    field.style.borderColor = '#5cb85c';
                }
                break;
        }
    }

    // Add character counter for detail_value textarea
    const detailValueTextarea = document.getElementById('detail_value');
    const charCounter = document.createElement('div');
    charCounter.style.fontSize = '12px';
    charCounter.style.color = '#666';
    charCounter.style.textAlign = 'right';
    charCounter.style.marginTop = '-10px';
    charCounter.style.marginBottom = '15px';
    detailValueTextarea.parentNode.insertBefore(charCounter, detailValueTextarea.nextSibling);

    detailValueTextarea.addEventListener('input', function() {
        const length = this.value.length;
        charCounter.textContent = length + ' characters';
        
        if (length > 1000) {
            charCounter.style.color = '#d9534f';
        } else {
            charCounter.style.color = '#666';
        }
    });
});

