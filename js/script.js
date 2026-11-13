document.addEventListener("DOMContentLoaded", () => {
    // --- Elements ---
    // ... (your existing element selections) ...
    const sceneBackground = document.getElementById("scene-background");
    const insertedProduct = document.getElementById("inserted-product");
    const markingArea = document.getElementById("marking-area");
    const sceneContainer = document.querySelector(".scene-container");
    const body = document.body;
    const fullscreenToggleBtn = document.getElementById("fullscreen-toggle");
    const presentationWrapper = document.getElementById("presentation-wrapper");
    const backgroundThumbnails = document.getElementById("background-thumbnails");
    const productGallery = document.getElementById("product-gallery");
    const addBackgroundBtn = document.getElementById("add-background-btn");
    const uploadProductBtn = document.getElementById("upload-product-btn");
    const backgroundUploadInput = document.getElementById("background-upload");
    const productUploadInput = document.getElementById("product-upload");
    const warningModal = document.getElementById("warning-modal");
    const warningMessage = document.getElementById("warning-message");
    const resizeImageBtn = document.getElementById("resize-image-btn");
    const cancelUploadBtn = document.getElementById("cancel-upload-btn");
    const backgroundSetupModal = document.getElementById("background-setup-modal");
    const backgroundNameInput = document.getElementById("background-name");
    const confirmBackgroundBtn = document.getElementById("confirm-background-btn");
    const cancelBackgroundBtn = document.getElementById("cancel-background-btn");
    const markingWidthInput = document.getElementById("marking-width");
    const markingHeightInput = document.getElementById("marking-height");
    const markingLeftInput = document.getElementById("marking-left");
    const markingTopInput = document.getElementById("marking-top");
    const markingPaddingInput = document.getElementById("marking-padding");
    const markingDimensions = document.getElementById("marking-dimensions");
    const saveMarkingBtn = document.getElementById("save-marking-btn");
    const exitFullscreenBtn = document.createElement("button");
    exitFullscreenBtn.id = "exit-fullscreen-btn";
    exitFullscreenBtn.innerHTML = "×";
    exitFullscreenBtn.title = "Exit Fullscreen (ESC)";
    body.appendChild(exitFullscreenBtn);

    const prevProductBtn = document.getElementById("prev-product-btn");
    const nextProductBtn = document.getElementById("next-product-btn");
    const fullscreenHelpBtn = document.getElementById("fullscreen-help-btn");
    const productInfoBtn = document.getElementById("product-info-btn");
    const productInfoOverlay = document.getElementById("product-info-overlay");
    const productInfoTitle = document.getElementById("product-info-title");
    const productInfoDesc = document.getElementById("product-info-desc");
    const keyboardShortcutsModal = document.getElementById("keyboard-shortcuts-modal");

    const closeButtons = document.querySelectorAll(".close-modal");
    closeButtons.forEach(button => {
        button.addEventListener("click", () => {
            warningModal.style.display = "none";
            backgroundSetupModal.style.display = "none";
            keyboardShortcutsModal.style.display = "none";
        });
    });

    // --- API Configuration ---
    // Relative on purpose: the app is served from 192.168.0.113 on the LAN, so a
    // hardcoded "localhost" would resolve to the viewer's own machine.
    const API_BASE_URL = "api";

    // --- State Variables ---
    let currentProductServerId = null;
    let currentBackgroundServerId = null;
    let currentProductIndex = -1;
    let tempBackgroundFile = null;
    let tempBackgroundDataUrl = null;
    let isSettingMarkingArea = false;
    let isProductInfoVisible = false;
    let isDragging = false;
    let isResizing = false;
    let resizeHandle = "";
    let dragStartX = 0, dragStartY = 0;
    let markingStartLeft = 0, markingStartTop = 0;
    let markingStartWidth = 0, markingStartHeight = 0;
    let containerWidth = 0, containerHeight = 0;
    let clientBackgroundsData = {};

    // NEW State Variables for background navigation
    let orderedBackgroundIds = [];
    let currentBackgroundIndex = -1;

    // --- Helper: Handle Fetch Response Errors ---
    async function handleFetchError(response, contextMessage) {
        let errorText = `${contextMessage}: HTTP error! status: ${response.status}`;
        try {
            const text = await response.text();
            try {
                const errorData = JSON.parse(text);
                errorText += ` - ${errorData.error || 'Unknown server error'}`;
            } catch (jsonError) {
                errorText += ` - Server returned non-JSON response: ${text.substring(0, 150)}...`;
            }
        } catch (readError) {
            errorText += ` - Failed to read error response body.`;
        }
        return new Error(errorText);
    }

    // --- Helper: Show Error/Warning Message ---
    function showGlobalWarning(message, isError = true) {
        warningMessage.textContent = message;
        warningModal.style.display = "block";
        resizeImageBtn.style.display = 'none';
        cancelUploadBtn.textContent = 'OK';
        cancelUploadBtn.onclick = () => warningModal.style.display = 'none';
        console.error("Global Warning/Error:", message);
    }

    // --- Image Size Validation ---
    const STANDARD_ASPECT_RATIO = 16 / 9;
    function validateImageDimensionsForPreview(imageDataUrl, type) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const width = img.width;
                const height = img.height;
                if (height === 0) {
                    resolve({ valid: false, width, height, message: "Image height is zero." });
                    return;
                }

                if (type === "background") {
                    const aspectRatio = width / height;
                    const aspectRatioValid = Math.abs(aspectRatio - STANDARD_ASPECT_RATIO) < 0.1;
                    resolve({
                        valid: aspectRatioValid,
                        width,
                        height,
                        message: aspectRatioValid ? "" : `Preview aspect ratio (${aspectRatio.toFixed(2)}) differs significantly from standard 16:9. This may cause display issues.`
                    });
                } else if (type === "product") {
                    if (!currentBackgroundServerId || !clientBackgroundsData[currentBackgroundServerId] || !clientBackgroundsData[currentBackgroundServerId].marking_width_percent) {
                        resolve({ valid: true, width, height, message: "" });
                        return;
                    }
                    const currentBgData = clientBackgroundsData[currentBackgroundServerId];
                    const markingWidth = parseFloat(currentBgData.marking_width_percent);
                    const markingHeight = parseFloat(currentBgData.marking_height_percent);

                    if (markingHeight === 0) {
                        resolve({ valid: true, width, height, message: "" });
                        return;
                    }
                    const markingAspectRatio = markingWidth / markingHeight;
                    const productAspectRatio = width / height;
                    const aspectRatioValid = Math.abs(productAspectRatio - markingAspectRatio) < 0.1;
                    resolve({
                        valid: aspectRatioValid,
                        width,
                        height,
                        message: aspectRatioValid ? "" : `Product preview aspect ratio (${productAspectRatio.toFixed(2)}) differs from marking area (${markingAspectRatio.toFixed(2)}). Product may appear distorted.`
                    });
                }
            };
            img.onerror = () => resolve({ valid: false, width: 0, height: 0, message: "Failed to load image for validation." });
            img.src = imageDataUrl;
        });
    }

    function showImageSizeWarningModal(message, onProceedAnyway, onCancel) {
        warningMessage.textContent = message + " Proceed with original image or cancel?";
        warningModal.style.display = "block";
        resizeImageBtn.style.display = 'none';
        cancelUploadBtn.textContent = 'Cancel Upload';

        const existingProceedBtn = warningModal.querySelector('.proceed-anyway-btn');
        if (existingProceedBtn) existingProceedBtn.remove();

        const proceedBtn = document.createElement('button');
        proceedBtn.textContent = 'Proceed Anyway';
        proceedBtn.className = 'action-button proceed-anyway-btn';
        proceedBtn.onclick = () => {
            onProceedAnyway();
            warningModal.style.display = 'none';
            proceedBtn.remove();
        };

        let modalButtonsDiv = warningModal.querySelector('.modal-buttons');
        if (!modalButtonsDiv) {
            modalButtonsDiv = document.createElement('div');
            modalButtonsDiv.className = 'modal-buttons';
            warningModal.querySelector('.modal-content').appendChild(modalButtonsDiv);
        }
        modalButtonsDiv.insertBefore(proceedBtn, cancelUploadBtn);

        cancelUploadBtn.onclick = () => {
            onCancel();
            warningModal.style.display = 'none';
            proceedBtn.remove();
        };
    }

    // --- File Upload Handlers ---
    addBackgroundBtn.addEventListener("click", () => backgroundUploadInput.click());
    backgroundUploadInput.addEventListener("change", async (event) => {
        if (event.target.files && event.target.files[0]) {
            const file = event.target.files[0];
            tempBackgroundFile = file;

            const reader = new FileReader();
            reader.onload = async (e) => {
                tempBackgroundDataUrl = e.target.result;
                const validation = await validateImageDimensionsForPreview(tempBackgroundDataUrl, "background");
                if (!validation.valid && validation.message) {
                    showImageSizeWarningModal(
                        validation.message,
                        () => { showBackgroundSetupModal(tempBackgroundDataUrl); },
                        () => {
                            tempBackgroundFile = null;
                            tempBackgroundDataUrl = null;
                            backgroundUploadInput.value = "";
                        }
                    );
                } else {
                    showBackgroundSetupModal(tempBackgroundDataUrl);
                }
            };
            reader.onerror = () => {
                showGlobalWarning("Failed to read background file.");
                tempBackgroundFile = null;
                tempBackgroundDataUrl = null;
                backgroundUploadInput.value = "";
            };
            reader.readAsDataURL(file);
        }
    });

    uploadProductBtn.addEventListener("click", () => {
        if (!currentBackgroundServerId) {
            showGlobalWarning("Please select or add a background first before uploading a product.");
            return;
        }
        productUploadInput.click();
    });
    productUploadInput.addEventListener("change", async (event) => {
        if (!currentBackgroundServerId) {
            showGlobalWarning("Error: No background selected for product upload.");
            productUploadInput.value = "";
            return;
        }
        if (event.target.files && event.target.files[0]) {
            const file = event.target.files[0];
            const reader = new FileReader();
            reader.onload = async (e) => {
                const productDataUrl = e.target.result;
                const validation = await validateImageDimensionsForPreview(productDataUrl, "product");
                if (!validation.valid && validation.message) {
                     showImageSizeWarningModal(
                        validation.message,
                        async () => { await uploadProductToServer(file, currentBackgroundServerId); },
                        () => { productUploadInput.value = ""; }
                    );
                } else {
                    await uploadProductToServer(file, currentBackgroundServerId);
                }
            };
             reader.onerror = () => {
                showGlobalWarning("Failed to read product file.");
                productUploadInput.value = "";
            };
            reader.readAsDataURL(file);
        }
    });

    // --- Background Setup Modal ---
    function showBackgroundSetupModal(previewDataUrl) {
        backgroundNameInput.value = tempBackgroundFile ? tempBackgroundFile.name.replace(/\.[^/.]+$/, "") : "";
        backgroundSetupModal.style.display = "block";
        sceneBackground.src = previewDataUrl;
        markingArea.style.display = "none";
        isSettingMarkingArea = true;
        markingWidthInput.value = "15";
        markingHeightInput.value = "60";
        markingLeftInput.value = "25";
        markingTopInput.value = "32";
        markingPaddingInput.value = "0";
        updateMarkingArea();
        markingArea.style.display = "block";
    }

    confirmBackgroundBtn.addEventListener("click", async () => {
        if (!tempBackgroundFile) {
            showGlobalWarning("No background image selected for setup.");
            return;
        }
        const backgroundName = backgroundNameInput.value.trim() || `Background ${Date.now()}`;
        const formData = new FormData();
        console.log("Attempting to append file:", tempBackgroundFile); // DEBUGGING
        formData.append("backgroundImage", tempBackgroundFile);
        formData.append('name', backgroundName);
        formData.append('marking_top_percent', markingTopInput.value);
        formData.append('marking_left_percent', markingLeftInput.value);
        formData.append('marking_width_percent', markingWidthInput.value);
        formData.append('marking_height_percent', markingHeightInput.value);
        formData.append('marking_padding_percent', markingPaddingInput.value);

        try {
            const response = await fetch(`${API_BASE_URL}/backgrounds.php`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw await handleFetchError(response, "Failed to create background");
            }

            let newBackground;
            try {
                 newBackground = await response.json();
            } catch (jsonError) {
                console.error("JSON Parsing Error on background create:", jsonError);
                const responseText = await response.text();
                throw new Error(`Failed to parse server response after creating background: ${responseText.substring(0, 200)}...`);
            }

            if (!newBackground || !newBackground.id) {
                throw new Error("Received invalid data from server after creating background.");
            }

            clientBackgroundsData[newBackground.id] = newBackground;
            addBackgroundThumbnailToUI(newBackground);
            
            // MODIFICATION: Add to ordered list and select
            if (!orderedBackgroundIds.includes(String(newBackground.id))) {
                orderedBackgroundIds.push(String(newBackground.id));
            }
            selectBackgroundById(newBackground.id); // This will update currentBackgroundIndex

            backgroundSetupModal.style.display = "none";
            isSettingMarkingArea = false;
            tempBackgroundFile = null;
            tempBackgroundDataUrl = null;
            backgroundUploadInput.value = "";

        } catch (error) {
            console.error("Failed to create background:", error);
            showGlobalWarning(`${error.message}`);
            backgroundSetupModal.style.display = "none";
            isSettingMarkingArea = false;
        }
    });

    cancelBackgroundBtn.addEventListener("click", () => {
        backgroundSetupModal.style.display = "none";
        isSettingMarkingArea = false;
        tempBackgroundFile = null;
        tempBackgroundDataUrl = null;
        backgroundUploadInput.value = "";
    });

    // --- Marking Area Controls ---
    markingWidthInput.addEventListener("input", updateMarkingArea);
    markingHeightInput.addEventListener("input", updateMarkingArea);
    markingLeftInput.addEventListener("input", updateMarkingArea);
    markingTopInput.addEventListener("input", updateMarkingArea);
    markingPaddingInput.addEventListener("input", updateMarkingArea);

    function updateMarkingArea() {
        const width = parseFloat(markingWidthInput.value);
        const height = parseFloat(markingHeightInput.value);
        const left = parseFloat(markingLeftInput.value);
        const top = parseFloat(markingTopInput.value);
        const padding = parseFloat(markingPaddingInput.value);

        markingArea.style.width = `${width}%`;
        markingArea.style.height = `${height}%`;
        markingArea.style.left = `${left}%`;
        markingArea.style.top = `${top}%`;
        markingArea.style.padding = `${padding}%`;

        // Update dimensions display
        const containerRect = sceneContainer.getBoundingClientRect();
        const markingRect = markingArea.getBoundingClientRect();
        const markingWidthPx = markingRect.width;
        const markingHeightPx = markingRect.height;
        markingDimensions.textContent = `${Math.round(markingWidthPx)} x ${Math.round(markingHeightPx)} px`;
    }

    saveMarkingBtn.addEventListener("click", async () => {
        if (!currentBackgroundServerId) {
            showGlobalWarning("No background selected to save marking area for.");
            return;
        }
        const dataToSave = {
            marking_top_percent: parseFloat(markingTopInput.value),
            marking_left_percent: parseFloat(markingLeftInput.value),
            marking_width_percent: parseFloat(markingWidthInput.value),
            marking_height_percent: parseFloat(markingHeightInput.value),
            marking_padding_percent: parseFloat(markingPaddingInput.value)
        };

        try {
            const response = await fetch(`${API_BASE_URL}/backgrounds.php/${currentBackgroundServerId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataToSave)
            });

            if (!response.ok) {
                throw await handleFetchError(response, "Failed to save marking area");
            }

            const updatedBackground = await response.json();
            clientBackgroundsData[currentBackgroundServerId] = { ...clientBackgroundsData[currentBackgroundServerId], ...updatedBackground };
            if (currentProductServerId) {
                const productData = clientBackgroundsData[currentBackgroundServerId].products.find(p => p.id == currentProductServerId);
                if (productData) {
                     applyProductPlacement(updatedBackground, productData.imageUrl);
                }
            }
            saveMarkingBtn.textContent = "Saved!";
            setTimeout(() => { saveMarkingBtn.textContent = "Save Marking Area"; }, 1500);
        } catch (error) {
            console.error("Failed to save marking area:", error);
            showGlobalWarning(`${error.message}`);
            saveMarkingBtn.textContent = "Save Failed";
            setTimeout(() => { saveMarkingBtn.textContent = "Save Marking Area"; }, 2000);
        }
    });

    // --- Background Management (Server Interaction) ---
    async function loadAllBackgroundsFromServer() {
        try {
            const response = await fetch(`${API_BASE_URL}/backgrounds.php`);
            if (!response.ok) throw await handleFetchError(response, "Failed to load backgrounds");

            let responseText = "";
            let serverBackgrounds;
            try {
                responseText = await response.text();
                serverBackgrounds = JSON.parse(responseText);
            } catch (parseError) {
                console.error("JSON Parsing Error on load backgrounds:", parseError);
                throw new Error(`Failed to parse backgrounds JSON. Server responded with: ${responseText.substring(0, 200)}...`);
            }

            backgroundThumbnails.innerHTML = '';
            clientBackgroundsData = {};
            orderedBackgroundIds = []; // MODIFICATION: Reset here

            if (serverBackgrounds && Array.isArray(serverBackgrounds) && serverBackgrounds.length > 0) {
                let firstValidBgId = null;
                serverBackgrounds.forEach(bgData => {
                    if (bgData && typeof bgData === 'object' && bgData.id && bgData.imageUrl) {
                        clientBackgroundsData[bgData.id] = bgData;
                        addBackgroundThumbnailToUI(bgData);
                        orderedBackgroundIds.push(String(bgData.id)); // MODIFICATION: Add to ordered list (as string for consistency)
                        if (!firstValidBgId) firstValidBgId = String(bgData.id);
                    } else {
                        console.warn("Received invalid background data object:", bgData);
                    }
                });

                if (firstValidBgId) {
                    let idToSelect = (currentBackgroundServerId && clientBackgroundsData[currentBackgroundServerId]) ? currentBackgroundServerId : firstValidBgId;
                    selectBackgroundById(idToSelect); // This will set currentBackgroundIndex
                } else {
                    sceneBackground.src = "";
                    sceneBackground.alt = "No valid backgrounds found.";
                    markingArea.style.display = "none";
                    productGallery.innerHTML = '';
                    currentBackgroundServerId = null;
                    currentBackgroundIndex = -1;
                }
            } else {
                sceneBackground.src = "";
                sceneBackground.alt = "No backgrounds found. Add one to begin.";
                markingArea.style.display = "none";
                productGallery.innerHTML = '';
                currentBackgroundServerId = null;
                currentBackgroundIndex = -1;
            }
            
            // Check for product ID in sessionStorage after backgrounds are loaded
            checkForSelectedProductId();
            
        } catch (error) {
            console.error("Could not fetch backgrounds:", error);
            showGlobalWarning(`${error.message}`);
            currentBackgroundServerId = null;
            currentBackgroundIndex = -1;
        }
    }

    function addBackgroundThumbnailToUI(bgData) {
        const thumbDiv = document.createElement("div");
        thumbDiv.className = "thumbnail background-thumbnail";
        thumbDiv.dataset.backgroundServerId = bgData.id;
        thumbDiv.title = `${bgData.name} (${bgData.product_count || 0} products)`;

        const img = document.createElement("img");
        img.src = bgData.imageUrl;
        img.alt = bgData.name;
        img.className = "background-thumbnail-img";
        thumbDiv.appendChild(img);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn background-delete-btn";
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.title = "Delete Background";
        deleteBtn.onclick = (event) => {
            event.stopPropagation();
            if (confirm(`Are you sure you want to delete the background \"${bgData.name}\"? This will remove all associated products as well.`)) {
                deleteBackgroundFromServer(bgData.id);
            }
        };
        thumbDiv.appendChild(deleteBtn);

        thumbDiv.addEventListener("click", () => {
            selectBackgroundById(bgData.id);
        });

        backgroundThumbnails.appendChild(thumbDiv);
    }

    async function deleteBackgroundFromServer(backgroundId) {
        try {
            const response = await fetch(`${API_BASE_URL}/backgrounds.php/${backgroundId}`, {
                method: 'DELETE'
            });

            if (!response.ok) throw await handleFetchError(response, "Failed to delete background");

            // Remove from UI
            const thumbToRemove = backgroundThumbnails.querySelector(`.background-thumbnail[data-background-server-id="${backgroundId}"]`);
            if (thumbToRemove) thumbToRemove.remove();

            // Remove from client data
            delete clientBackgroundsData[backgroundId];
            
            // Remove from ordered list
            const indexToRemove = orderedBackgroundIds.indexOf(String(backgroundId));
            if (indexToRemove !== -1) {
                orderedBackgroundIds.splice(indexToRemove, 1);
            }

            // If this was the current background, select another one
            if (currentBackgroundServerId === backgroundId) {
                if (orderedBackgroundIds.length > 0) {
                    selectBackgroundById(orderedBackgroundIds[0]);
                } else {
                    // No backgrounds left
                    currentBackgroundServerId = null;
                    currentBackgroundIndex = -1;
                    sceneBackground.src = "";
                    sceneBackground.alt = "No backgrounds available.";
                    markingArea.style.display = "none";
                    productGallery.innerHTML = '';
                }
            }
        } catch (error) {
            console.error("Failed to delete background:", error);
            showGlobalWarning(`${error.message}`);
        }
    }

    function selectBackgroundById(backgroundId) {
        if (!backgroundId || !clientBackgroundsData[backgroundId]) {
            console.error("Invalid background ID for selection:", backgroundId);
            return;
        }

        // Update UI for background selection
        const allThumbs = backgroundThumbnails.querySelectorAll('.background-thumbnail');
        allThumbs.forEach(thumb => thumb.classList.remove('selected'));
        const selectedThumb = backgroundThumbnails.querySelector(`.background-thumbnail[data-background-server-id="${backgroundId}"]`);
        if (selectedThumb) selectedThumb.classList.add('selected');

        // Update state
        currentBackgroundServerId = backgroundId;
        
        // Update currentBackgroundIndex for navigation
        currentBackgroundIndex = orderedBackgroundIds.indexOf(String(backgroundId));

        // Update scene with background
        const bgData = clientBackgroundsData[backgroundId];
        sceneBackground.src = bgData.imageUrl;
        sceneBackground.alt = bgData.name;

        // Update marking area
        markingArea.style.display = "block";
        markingWidthInput.value = bgData.marking_width_percent || 15;
        markingHeightInput.value = bgData.marking_height_percent || 60;
        markingLeftInput.value = bgData.marking_left_percent || 25;
        markingTopInput.value = bgData.marking_top_percent || 32;
        markingPaddingInput.value = bgData.marking_padding_percent || 0;
        updateMarkingArea();

        // Load products for this background
        loadProductsForBackgroundUI(bgData);

        // If we have a temporary flag for product selection by name (used during background navigation)
        if (window.lastSelectedProductNameForCycling) {
            const productName = window.lastSelectedProductNameForCycling;
            delete window.lastSelectedProductNameForCycling; // Clear the flag
            
            // Find product with matching name in this background
            const matchingProduct = bgData.products?.find(p => p.name === productName);
            if (matchingProduct) {
                selectProductByServerId(matchingProduct.id);
            }
            // If no matching product, the default selection in loadProductsForBackgroundUI will apply
        }
    }

    // --- Product Management (Server Interaction & UI) ---
    async function uploadProductToServer(productFile, backgroundId) {
        const formData = new FormData();
        formData.append('productImage', productFile);
        formData.append('background_id', backgroundId);
        formData.append('name', productFile.name.replace(/\.[^/.]+$/, "") || `Product ${Date.now()}`);
        formData.append('description', '');

        try {
            const response = await fetch(`${API_BASE_URL}/products.php?background_id=${backgroundId}`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw await handleFetchError(response, "Failed to upload product");
            
            let newProduct;
            try { newProduct = await response.json(); }
            catch (jsonError) {
                const responseText = await response.text();
                throw new Error(`Failed to parse server response after uploading product: ${responseText.substring(0, 200)}...`);
            }

             if (!newProduct || !newProduct.id) throw new Error("Received invalid data from server after uploading product.");

            if (clientBackgroundsData[backgroundId]) {
                if (!clientBackgroundsData[backgroundId].products) clientBackgroundsData[backgroundId].products = [];
                if (!clientBackgroundsData[backgroundId].products.some(p => p.id === newProduct.id)) {
                    clientBackgroundsData[backgroundId].products.push(newProduct);
                }
                // Update product count in background data and thumbnail title
                clientBackgroundsData[backgroundId].product_count = clientBackgroundsData[backgroundId].products.length;
                const bgThumb = backgroundThumbnails.querySelector(`.background-thumbnail[data-background-server-id="${backgroundId}"]`);
                if (bgThumb) {
                    bgThumb.title = `${clientBackgroundsData[backgroundId].name} (${clientBackgroundsData[backgroundId].product_count} products)`;
                }

                loadProductsForBackgroundUI(clientBackgroundsData[backgroundId]);
                selectProductByServerId(newProduct.id);
            }
            productUploadInput.value = "";
        } catch (error) {
            console.error("Failed to upload product:", error);
            showGlobalWarning(`${error.message}`);
            productUploadInput.value = "";
        }
    }

    function loadProductsForBackgroundUI(bgData) {
        productGallery.innerHTML = '';
        currentProductServerId = null;
        currentProductIndex = -1;
        insertedProduct.style.display = "none";
        productInfoOverlay.classList.remove('visible');
        isProductInfoVisible = false;
        productInfoBtn.classList.remove('active');

        const productsArray = bgData.products || [];

        if (productsArray.length > 0) {
            let firstProductId = null;
            productsArray.forEach((productData) => {
                 if (productData && productData.id && productData.imageUrl) {
                    addProductThumbnailToUI(productData);
                    if (!firstProductId) firstProductId = productData.id;
                 } else {
                    console.warn("Received invalid product data object:", productData);
                 }
            });
            if (firstProductId) {
                selectProductByServerId(firstProductId);
            }
        }
    }

    function addProductThumbnailToUI(productData) {
        const thumbDiv = document.createElement("div");
        thumbDiv.className = "thumbnail product-thumbnail-container";
        thumbDiv.dataset.productServerId = productData.id;

        const img = document.createElement("img");
        img.src = productData.imageUrl;
        img.alt = productData.name;
        img.className = "product-thumbnail";
        img.dataset.description = productData.description || '';
        img.title = productData.name;
        thumbDiv.appendChild(img);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn product-delete-btn";
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.title = "Delete Product";
        deleteBtn.onclick = (event) => {
            event.stopPropagation();
            if (confirm(`Are you sure you want to delete the product \"${productData.name}\"? This will remove the record from the database (but not the image file).`)) {
                deleteProductFromServer(productData.id);
            }
        };
        thumbDiv.appendChild(deleteBtn);

        thumbDiv.addEventListener("click", () => {
            selectProductByServerId(productData.id);
        });

        productGallery.appendChild(thumbDiv);
    }

    async function deleteProductFromServer(productId) {
        try {
            const response = await fetch(`${API_BASE_URL}/products.php/${productId}`, {
                method: 'DELETE'
            });

            if (!response.ok) throw await handleFetchError(response, "Failed to delete product");

            // Remove from UI
            const thumbToRemove = productGallery.querySelector(`.product-thumbnail-container[data-product-server-id="${productId}"]`);
            if (thumbToRemove) thumbToRemove.remove();

            // Remove from client data
            if (currentBackgroundServerId && clientBackgroundsData[currentBackgroundServerId]) {
                const bgData = clientBackgroundsData[currentBackgroundServerId];
                if (bgData.products) {
                    const productIndex = bgData.products.findIndex(p => p.id == productId);
                    if (productIndex !== -1) {
                        bgData.products.splice(productIndex, 1);
                        bgData.product_count = bgData.products.length;
                        
                        // Update background thumbnail title
                        const bgThumb = backgroundThumbnails.querySelector(`.background-thumbnail[data-background-server-id="${currentBackgroundServerId}"]`);
                        if (bgThumb) {
                            bgThumb.title = `${bgData.name} (${bgData.product_count} products)`;
                        }
                    }
                }
            }

            // If this was the current product, select another one
            if (currentProductServerId === productId) {
                const remainingProducts = productGallery.querySelectorAll('.product-thumbnail-container');
                if (remainingProducts.length > 0) {
                    const firstProductId = remainingProducts[0].dataset.productServerId;
                    selectProductByServerId(firstProductId);
                } else {
                    // No products left
                    currentProductServerId = null;
                    currentProductIndex = -1;
                    insertedProduct.style.display = "none";
                    productInfoOverlay.classList.remove('visible');
                    isProductInfoVisible = false;
                    productInfoBtn.classList.remove('active');
                }
            }
        } catch (error) {
            console.error("Failed to delete product:", error);
            showGlobalWarning(`${error.message}`);
        }
    }

    function selectProductByServerId(productId) {
        if (!productId || !currentBackgroundServerId || !clientBackgroundsData[currentBackgroundServerId]) {
            console.error("Cannot select product: Invalid product ID or no background selected");
            return;
        }

        const bgData = clientBackgroundsData[currentBackgroundServerId];
        const productData = bgData.products?.find(p => String(p.id) === String(productId));
        
        if (!productData) {
            console.error(`Product with ID ${productId} not found in current background`);
            return;
        }

        // Update UI for product selection
        const allThumbs = productGallery.querySelectorAll('.product-thumbnail-container');
        allThumbs.forEach(thumb => thumb.classList.remove('selected'));
        const selectedThumb = productGallery.querySelector(`.product-thumbnail-container[data-product-server-id="${productId}"]`);
        if (selectedThumb) {
            selectedThumb.classList.add('selected');
            
            // Update currentProductIndex for navigation
            const thumbs = Array.from(productGallery.querySelectorAll('.product-thumbnail-container'));
            currentProductIndex = thumbs.indexOf(selectedThumb);
        }

        // Update state
        currentProductServerId = String(productId);

        // Apply product to scene
        applyProductPlacement(bgData, productData.imageUrl);

        // Update product info
        productInfoTitle.textContent = productData.name || 'Product';
        productInfoDesc.textContent = productData.description || 'No description available.';
    }

    function applyProductPlacement(bgData, productImageUrl) {
        if (!bgData || !productImageUrl) {
            console.error("Cannot apply product placement: Missing background data or product image URL");
            return;
        }

        // Set product image
        insertedProduct.src = productImageUrl;
        insertedProduct.style.display = "block";

        // Position product within marking area
        const markingWidth = parseFloat(bgData.marking_width_percent || 15);
        const markingHeight = parseFloat(bgData.marking_height_percent || 60);
        const markingLeft = parseFloat(bgData.marking_left_percent || 25);
        const markingTop = parseFloat(bgData.marking_top_percent || 32);
        const markingPadding = parseFloat(bgData.marking_padding_percent || 0);

        // Calculate available space within marking area (accounting for padding)
        const availableWidth = markingWidth - (2 * markingPadding);
        const availableHeight = markingHeight - (2 * markingPadding);

        // Position product to fill available space within marking area
        insertedProduct.style.width = `${availableWidth}%`;
        insertedProduct.style.height = `${availableHeight}%`;
        insertedProduct.style.left = `${markingLeft + markingPadding}%`;
        insertedProduct.style.top = `${markingTop + markingPadding}%`;
    }

    // --- Navigation Controls ---
    function navigateProducts(direction) {
        if (!currentBackgroundServerId || !clientBackgroundsData[currentBackgroundServerId]) return;
        
        const thumbs = Array.from(productGallery.querySelectorAll('.product-thumbnail-container'));
        if (thumbs.length === 0) return;
        
        let newIndex = currentProductIndex + direction;
        
        // Wrap around
        if (newIndex < 0) newIndex = thumbs.length - 1;
        else if (newIndex >= thumbs.length) newIndex = 0;
        
        if (newIndex !== currentProductIndex && thumbs[newIndex]) {
            const productId = thumbs[newIndex].dataset.productServerId;
            selectProductByServerId(productId);
        }
    }

    prevProductBtn.addEventListener("click", () => navigateProducts(-1));
    nextProductBtn.addEventListener("click", () => navigateProducts(1));

    // --- Fullscreen Mode ---
    fullscreenToggleBtn.addEventListener("click", toggleFullscreen);
    exitFullscreenBtn.addEventListener("click", exitFullscreen);

    function toggleFullscreen() {
        if (!body.classList.contains("fullscreen-active")) {
            enterFullscreen();
        } else {
            exitFullscreen();
        }
    }

    function enterFullscreen() {
        body.classList.add("fullscreen-active");
        exitFullscreenBtn.style.display = "block";
    }

    function exitFullscreen() {
        body.classList.remove("fullscreen-active");
        exitFullscreenBtn.style.display = "none";
        keyboardShortcutsModal.style.display = "none";
    }

    // --- Product Info Toggle ---
    productInfoBtn.addEventListener("click", toggleProductInfo);

    function toggleProductInfo() {
        if (!currentProductServerId) return;
        
        isProductInfoVisible = !isProductInfoVisible;
        if (isProductInfoVisible) {
            productInfoOverlay.classList.add('visible');
            productInfoBtn.classList.add('active');
        } else {
            productInfoOverlay.classList.remove('visible');
            productInfoBtn.classList.remove('active');
        }
    }

    // --- Keyboard Shortcuts ---
    fullscreenHelpBtn.addEventListener("click", () => {
        keyboardShortcutsModal.style.display = "block";
    });

    document.addEventListener("keydown", (e) => {
        // Only handle keyboard shortcuts in fullscreen mode
        if (!body.classList.contains("fullscreen-active")) return;
        
        switch (e.key) {
            case "ArrowLeft":
                navigateProducts(-1);
                break;
            case "ArrowRight":
                navigateProducts(1);
                break;
            case "ArrowUp":
                navigateBackground(-1);
                break;
            case "ArrowDown":
                navigateBackground(1);
                break;
            case "i":
            case "I":
                toggleProductInfo();
                break;
            case "h":
            case "H":
                if (keyboardShortcutsModal.style.display === "block") {
                    keyboardShortcutsModal.style.display = "none";
                } else {
                    keyboardShortcutsModal.style.display = "block";
                }
                break;
            case "Escape":
                if (keyboardShortcutsModal.style.display === "block") {
                    keyboardShortcutsModal.style.display = "none";
                } else if (productInfoOverlay.classList.contains('visible')) {
                    toggleProductInfo();
                } else {
                    exitFullscreen();
                }
                break;
        }
    });


    // REVISED FUNCTION: Navigate Backgrounds (Only those with the *same named* product)
    function navigateBackground(direction) {
        if (!body.classList.contains("fullscreen-active")) return;
        if (!currentProductServerId || !currentBackgroundServerId) {
            console.log("Cannot navigate backgrounds: No product or background currently selected.");
            return;
        }

        // 1. Get the name of the currently selected product
        const currentBgProducts = clientBackgroundsData[currentBackgroundServerId]?.products || [];
        const currentProductData = currentBgProducts.find(p => String(p.id) === currentProductServerId);
        if (!currentProductData || !currentProductData.name) {
            console.log("Cannot navigate backgrounds: Current product name not found.");
            return;
        }
        const currentProductName = currentProductData.name;
        // Store the name globally temporarily so selectBackgroundById can use it
        window.lastSelectedProductNameForCycling = currentProductName;

        // 2. Filter all available backgrounds to find those containing a product with the same name
        const backgroundIdsWithMatchingProduct = orderedBackgroundIds.filter(bgId => {
            const bgData = clientBackgroundsData[bgId];
            if (!bgData || !bgData.products || bgData.products.length === 0) {
                return false;
            }
            return bgData.products.some(p => p.name === currentProductName);
        });

        if (backgroundIdsWithMatchingProduct.length === 0) {
            console.log(`No other backgrounds found with a product named "${currentProductName}".`);
            delete window.lastSelectedProductNameForCycling; // Clean up temp flag
            return;
        }
        if (backgroundIdsWithMatchingProduct.length === 1) {
            // console.log(`Only one background found with product "${currentProductName}".`); // Optional log
            // Ensure the single one is selected if not already
            if (currentBackgroundServerId !== backgroundIdsWithMatchingProduct[0]) {
                 selectBackgroundById(backgroundIdsWithMatchingProduct[0]);
            } else {
                 delete window.lastSelectedProductNameForCycling; // Clean up temp flag if no navigation happens
            }
            return;
        }

        // 3. Find the current index within the *filtered* list
        let currentFilteredIndex = backgroundIdsWithMatchingProduct.indexOf(currentBackgroundServerId);

        // If the current background isn't in the filtered list (shouldn't happen if logic is correct, but handle defensively)
        if (currentFilteredIndex === -1) {
             console.warn(`Current background ${currentBackgroundServerId} not found in filtered list for product ${currentProductName}. Defaulting to index 0.`);
             currentFilteredIndex = 0;
             // Select the first one immediately if navigating
             if (direction !== 0) {
                 selectBackgroundById(backgroundIdsWithMatchingProduct[currentFilteredIndex]);
                 // selectBackgroundById will handle clearing the temp flag
                 return;
             }
        }

        // 4. Calculate the new index within the *filtered* list
        let newFilteredIndex = currentFilteredIndex + direction;

        if (newFilteredIndex < 0) {
            newFilteredIndex = backgroundIdsWithMatchingProduct.length - 1; // Wrap to last
        } else if (newFilteredIndex >= backgroundIdsWithMatchingProduct.length) {
            newFilteredIndex = 0; // Wrap to first
        }

        // 5. Select the background using the ID from the filtered list at the new index
        const nextBackgroundId = backgroundIdsWithMatchingProduct[newFilteredIndex];
        if (nextBackgroundId !== undefined && nextBackgroundId !== currentBackgroundServerId) {
             selectBackgroundById(nextBackgroundId);
             // selectBackgroundById will handle clearing the temp flag
        } else if (nextBackgroundId === undefined) {
             console.error("Error navigating background. New filtered index:", newFilteredIndex, "Filtered IDs:", backgroundIdsWithMatchingProduct);
             delete window.lastSelectedProductNameForCycling; // Clean up temp flag
             // Fallback if something went wrong
             if (backgroundIdsWithMatchingProduct.length > 0 && backgroundIdsWithMatchingProduct[0] !== undefined) {
                  selectBackgroundById(backgroundIdsWithMatchingProduct[0]);
             }
        } else {
            // No navigation needed (e.g., same ID after wrapping)
            delete window.lastSelectedProductNameForCycling; // Clean up temp flag
        }
    }


    // --- Drag and Resize Logic for Marking Area ---
    function initDragAndResize() {
        const handles = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
        const resizeHandlesContainer = document.createElement("div");
        resizeHandlesContainer.className = "resize-handles";
        handles.forEach(direction => {
            const handle = document.createElement("div");
            handle.className = `resize-handle ${direction}`;
            handle.dataset.direction = direction;
            resizeHandlesContainer.appendChild(handle);
            handle.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                startResize(e, direction);
            });
        });
        markingArea.appendChild(resizeHandlesContainer);

        markingArea.addEventListener("mousedown", (e) => {
            if (e.target === markingArea || e.target.classList.contains('resize-handle')) {
                e.preventDefault();
                if (!e.target.classList.contains('resize-handle')) {
                    startDrag(e);
                }
            }
        });

        document.addEventListener("mousemove", (e) => {
            if (isDragging) {
                drag(e);
            } else if (isResizing) {
                resize(e);
            }
        });

        document.addEventListener("mouseup", () => {
            isDragging = false;
            isResizing = false;
            document.body.style.cursor = "default";
        });
    }

    function startDrag(e) {
        // Removed isSettingMarkingArea check to allow dragging anytime marking area is visible
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        markingStartLeft = parseFloat(markingLeftInput.value);
        markingStartTop = parseFloat(markingTopInput.value);
        containerWidth = sceneContainer.offsetWidth;
        containerHeight = sceneContainer.offsetHeight;
        document.body.style.cursor = "move";
    }

    function drag(e) {
        if (!isDragging) return;
        
        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;
        
        // Convert pixel movement to percentage
        const deltaXPercent = (deltaX / containerWidth) * 100;
        const deltaYPercent = (deltaY / containerHeight) * 100;
        
        // Calculate new position
        let newLeft = markingStartLeft + deltaXPercent;
        let newTop = markingStartTop + deltaYPercent;
        
        // Constrain to container
        newLeft = Math.max(0, Math.min(100 - parseFloat(markingWidthInput.value), newLeft));
        newTop = Math.max(0, Math.min(100 - parseFloat(markingHeightInput.value), newTop));
        
        // Update inputs and marking area
        markingLeftInput.value = newLeft.toFixed(1);
        markingTopInput.value = newTop.toFixed(1);
        updateMarkingArea();
    }

    function startResize(e, direction) {
        // Removed isSettingMarkingArea check to allow resizing anytime marking area is visible
        isResizing = true;
        resizeHandle = direction;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        markingStartWidth = parseFloat(markingWidthInput.value);
        markingStartHeight = parseFloat(markingHeightInput.value);
        markingStartLeft = parseFloat(markingLeftInput.value);
        markingStartTop = parseFloat(markingTopInput.value);
        containerWidth = sceneContainer.offsetWidth;
        containerHeight = sceneContainer.offsetHeight;
        
        // Set cursor based on resize direction
        document.body.style.cursor = direction + "-resize";
    }

    function resize(e) {
        if (!isResizing) return;
        
        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;
        
        // Convert pixel movement to percentage
        const deltaXPercent = (deltaX / containerWidth) * 100;
        const deltaYPercent = (deltaY / containerHeight) * 100;
        
        let newWidth = markingStartWidth;
        let newHeight = markingStartHeight;
        let newLeft = markingStartLeft;
        let newTop = markingStartTop;
        
        // Apply resize based on handle direction
        if (resizeHandle.includes('e')) {
            newWidth = markingStartWidth + deltaXPercent;
        }
        if (resizeHandle.includes('w')) {
            const widthChange = -deltaXPercent;
            newWidth = markingStartWidth + widthChange;
            newLeft = markingStartLeft - widthChange;
        }
        if (resizeHandle.includes('s')) {
            newHeight = markingStartHeight + deltaYPercent;
        }
        if (resizeHandle.includes('n')) {
            const heightChange = -deltaYPercent;
            newHeight = markingStartHeight + heightChange;
            newTop = markingStartTop - heightChange;
        }
        
        // Constrain to minimum size and container bounds
        newWidth = Math.max(5, Math.min(100 - newLeft, newWidth));
        newHeight = Math.max(5, Math.min(100 - newTop, newHeight));
        newLeft = Math.max(0, Math.min(100 - 5, newLeft));
        newTop = Math.max(0, Math.min(100 - 5, newTop));
        
        // Update inputs and marking area
        markingWidthInput.value = newWidth.toFixed(1);
        markingHeightInput.value = newHeight.toFixed(1);
        markingLeftInput.value = newLeft.toFixed(1);
        markingTopInput.value = newTop.toFixed(1);
        updateMarkingArea();
    }
    
    // --- New function to check for selected product ID in sessionStorage ---
    function checkForSelectedProductId() {
        // Check if there's a selected product ID in sessionStorage
        const selectedProductId = sessionStorage.getItem('selectedProductIdForViz');
        
        if (selectedProductId) {
            console.log('Found selected product ID in sessionStorage:', selectedProductId);
            
            // Clear it immediately to prevent reuse on page refresh
            sessionStorage.removeItem('selectedProductIdForViz');
            
            // Find the background that contains this product
            let foundBackground = null;
            let foundProduct = null;
            
            // Search through all backgrounds for the product
            for (const bgId in clientBackgroundsData) {
                const bgData = clientBackgroundsData[bgId];
                if (bgData && bgData.products && Array.isArray(bgData.products)) {
                    const product = bgData.products.find(p => String(p.id) === String(selectedProductId));
                    if (product) {
                        foundBackground = bgId;
                        foundProduct = product;
                        break;
                    }
                }
            }
            
            // If found, select the background and then the product
            if (foundBackground && foundProduct) {
                console.log('Found product in background:', foundBackground);
                
                // First select the background
                selectBackgroundById(foundBackground);
                
                // Then select the product (with a small delay to ensure background is loaded)
                setTimeout(() => {
                    selectProductByServerId(foundProduct.id);
                }, 100);
            } else {
                console.log('Product not found in any background');
            }
        }
    }

    // Modified drag function - Remove boundary constraints
function drag(e) {
    if (!isDragging) return;
    
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    // Convert pixel movement to percentage
    const deltaXPercent = (deltaX / containerWidth) * 100;
    const deltaYPercent = (deltaY / containerHeight) * 100;
    
    // Calculate new position without constraints
    let newLeft = markingStartLeft + deltaXPercent;
    let newTop = markingStartTop + deltaYPercent;
    
    // Optional: Add reasonable limits to prevent marking area from going too far off-screen
    // You can adjust these values or remove them entirely for unlimited movement
    const maxOffset = 50; // Allow 50% beyond container boundaries
    newLeft = Math.max(-maxOffset, Math.min(100 + maxOffset, newLeft));
    newTop = Math.max(-maxOffset, Math.min(100 + maxOffset, newTop));
    
    // Update inputs and marking area
    markingLeftInput.value = newLeft.toFixed(1);
    markingTopInput.value = newTop.toFixed(1);
    updateMarkingArea();
}

// Modified resize function - Remove boundary constraints
function resize(e) {
    if (!isResizing) return;
    
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    // Convert pixel movement to percentage
    const deltaXPercent = (deltaX / containerWidth) * 100;
    const deltaYPercent = (deltaY / containerHeight) * 100;
    
    let newWidth = markingStartWidth;
    let newHeight = markingStartHeight;
    let newLeft = markingStartLeft;
    let newTop = markingStartTop;
    
    // Apply resize based on handle direction
    if (resizeHandle.includes('e')) {
        newWidth = markingStartWidth + deltaXPercent;
    }
    if (resizeHandle.includes('w')) {
        const widthChange = -deltaXPercent;
        newWidth = markingStartWidth + widthChange;
        newLeft = markingStartLeft - widthChange;
    }
    if (resizeHandle.includes('s')) {
        newHeight = markingStartHeight + deltaYPercent;
    }
    if (resizeHandle.includes('n')) {
        const heightChange = -deltaYPercent;
        newHeight = markingStartHeight + heightChange;
        newTop = markingStartTop - heightChange;
    }
    
    // Only constrain to minimum size, remove boundary constraints
    newWidth = Math.max(5, newWidth); // Minimum width of 5%
    newHeight = Math.max(5, newHeight); // Minimum height of 5%
    
    // Optional: Add reasonable limits to prevent marking area from becoming too large
    const maxSize = 200; // Allow up to 200% size
    newWidth = Math.min(maxSize, newWidth);
    newHeight = Math.min(maxSize, newHeight);
    
    // Optional: Add reasonable position limits
    const maxOffset = 50; // Allow 50% beyond container boundaries
    newLeft = Math.max(-maxOffset, Math.min(100 + maxOffset, newLeft));
    newTop = Math.max(-maxOffset, Math.min(100 + maxOffset, newTop));
    
    // Update inputs and marking area
    markingWidthInput.value = newWidth.toFixed(1);
    markingHeightInput.value = newHeight.toFixed(1);
    markingLeftInput.value = newLeft.toFixed(1);
    markingTopInput.value = newTop.toFixed(1);
    updateMarkingArea();
}

// Optional: Also modify the updateMarkingArea function to handle negative values properly
function updateMarkingArea() {
    const width = parseFloat(markingWidthInput.value);
    const height = parseFloat(markingHeightInput.value);
    const left = parseFloat(markingLeftInput.value);
    const top = parseFloat(markingTopInput.value);
    const padding = parseFloat(markingPaddingInput.value);

    markingArea.style.width = `${width}%`;
    markingArea.style.height = `${height}%`;
    markingArea.style.left = `${left}%`;
    markingArea.style.top = `${top}%`;
    markingArea.style.padding = `${padding}%`;

    // Update dimensions display
    const containerRect = sceneContainer.getBoundingClientRect();
    const markingRect = markingArea.getBoundingClientRect();
    const markingWidthPx = markingRect.width;
    const markingHeightPx = markingRect.height;
    markingDimensions.textContent = `${Math.round(markingWidthPx)} x ${Math.round(markingHeightPx)} px`;
    
    // Optional: Show position info when marking area is outside boundaries
    if (left < 0 || top < 0 || left + width > 100 || top + height > 100) {
        markingDimensions.textContent += ` (Outside boundaries)`;
    }
}

    // --- Initialize ---
    initDragAndResize();
    loadAllBackgroundsFromServer();
});
