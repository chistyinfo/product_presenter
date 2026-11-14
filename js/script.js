/**
 * js/script.js - Settings editor for the Product Placement Visualizer.
 * ---------------------------------------------------------------------------
 * Goals implemented here:
 *   - Placement is edited and stored ONLY as percentages of the rendered
 *     background image box (x, y, w, h, padding) via /api/v1.
 *   - Products are assigned PER BACKGROUND (background_products table).
 *   - The centre stage is rendered by js/pv_render.js, the SAME renderer the
 *     fullscreen viewer uses, so the editor and the customer view are identical.
 */
document.addEventListener("DOMContentLoaded", () => {
    // --- API bases ---------------------------------------------------------
    const API = "api";             // legacy endpoints (upload, backgrounds list)
    const API_V1 = "api/v1";       // versioned JSON API

    // --- Elements ----------------------------------------------------------
    const pvHost = document.getElementById("pv-host");
    const stageMeta = document.getElementById("stage-meta");
    const backgroundThumbnails = document.getElementById("background-thumbnails");
    const productAssignment = document.getElementById("product-assignment");
    const productsHeading = document.getElementById("products-heading");
    const productsHint = document.getElementById("products-hint");

    const addBackgroundBtn = document.getElementById("add-background-btn");
    const uploadProductBtn = document.getElementById("upload-product-btn");
    const backgroundUploadInput = document.getElementById("background-upload");
    const productUploadInput = document.getElementById("product-upload");

    const fitModeInput = document.getElementById("fit-mode");
    const removeBackgroundInput = document.getElementById("remove-background");

    const backgroundSetupModal = document.getElementById("background-setup-modal");
    const backgroundNameInput = document.getElementById("background-name");
    const confirmBackgroundBtn = document.getElementById("confirm-background-btn");
    const cancelBackgroundBtn = document.getElementById("cancel-background-btn");

    const markingLeftInput = document.getElementById("marking-left");
    const markingTopInput = document.getElementById("marking-top");
    const markingWidthInput = document.getElementById("marking-width");
    const markingHeightInput = document.getElementById("marking-height");
    const markingPaddingInput = document.getElementById("marking-padding");
    const markingDimensions = document.getElementById("marking-dimensions");
    const lockAspectInput = document.getElementById("lock-aspect");
    const saveMarkingBtn = document.getElementById("save-marking-btn");
    const removeFromBgBtn = document.getElementById("remove-from-background-btn");
    const selectionHint = document.getElementById("editor-selection-hint");

    const fullscreenToggleBtn = document.getElementById("fullscreen-toggle");
    const prevProductBtn = document.getElementById("prev-product-btn");
    const nextProductBtn = document.getElementById("next-product-btn");
    const fullscreenHelpBtn = document.getElementById("fullscreen-help-btn");
    const productInfoBtn = document.getElementById("product-info-btn");
    const productInfoOverlay = document.getElementById("product-info-overlay");
    const productInfoTitle = document.getElementById("product-info-title");
    const productInfoDesc = document.getElementById("product-info-desc");
    const keyboardShortcutsModal = document.getElementById("keyboard-shortcuts-modal");
    const body = document.body;

    // Exit-fullscreen button (created once).
    const exitFullscreenBtn = document.createElement("button");
    exitFullscreenBtn.id = "exit-fullscreen-btn";
    exitFullscreenBtn.innerHTML = "×";
    exitFullscreenBtn.title = "Exit Fullscreen (ESC)";
    body.appendChild(exitFullscreenBtn);

    // --- State -------------------------------------------------------------
    const state = {
        backgrounds: [],        // [{id,name,image_url,image_width,image_height,product_count}]
        catalog: [],            // [{id,name,image_url,image_width,image_height,background_ids}]
        currentBgId: null,
        currentBg: null,
        assignments: [],        // [{product_id, name, image_url, image_width, image_height, placement}]
        selectedProductId: null,
        scene: null,            // PVRender handle
        isProductInfoVisible: false,
        bgNavIndex: -1,
        // Images being processed client-side, shown as spinner rows in the
        // PRODUCTS panel until the processed PNG has been uploaded.
        pendingUploads: []
    };

    // Requests in flight, keyed by product id. They stop a double-click (or the
    // checkbox's change plus the row's click firing together) from sending two
    // writes for the same product, so the second cannot fail with a 404.
    const assignInFlight = new Set();
    const removalInFlight = new Set();
    // Permanent deletes in flight, keyed by product id. Stops a double-click
    // from firing two DELETEs (the second would 404).
    const deleteInFlight = new Set();

    // Neutral Marking Area values (same as the markup defaults). The panel is
    // reset to these whenever nothing is selected, so a product that was just
    // removed leaves no stale X / Y / W / H / Padding behind.
    const DEFAULT_MARKING = { x: 25, y: 32, w: 15, h: 60, padding: 0 };

    // --- Helpers -----------------------------------------------------------
    function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
    function clamp(n, lo, hi) { return Math.min(Math.max(Number(n) || 0, lo), hi); }

    function productAspect(prod) {
        const w = Number(prod && prod.image_width) || 0;
        const h = Number(prod && prod.image_height) || 0;
        return (w > 0 && h > 0) ? (w / h) : 0;
    }
    function bgAspect() {
        const bg = state.currentBg;
        const w = Number(bg && bg.image_width) || 0;
        const h = Number(bg && bg.image_height) || 0;
        return (w > 0 && h > 0) ? (w / h) : (16 / 9);
    }

    /**
     * The marking area currently described by the inspector inputs, expressed
     * as stage percentages plus the background aspect. ImageProcessor turns
     * this into the target pixel aspect ratio.
     */
    function currentMarkingArea() {
        const w = parseFloat(markingWidthInput.value) || 15;
        const h = parseFloat(markingHeightInput.value) || 60;
        return { w: w, h: h, bgAspect: bgAspect() };
    }

    /**
     * A sensible default placement for a newly assigned product:
     * door-height 70% of the image, width derived so the box matches the
     * product's own aspect ratio (no letterboxing), horizontally centred.
     */
    function defaultPlacement(prod) {
        const h = 70;
        const pa = productAspect(prod);
        let w = 20;
        if (pa > 0) {
            // wPct/stageW = (hPct/stageH * pa)  ->  wPct = hPct * pa / bgAspect
            w = h * pa / bgAspect();
        }
        w = clamp(w, 1, 100);
        const x = clamp((100 - w) / 2, 0, 100 - w);
        const y = clamp((100 - h) / 2, 0, 100 - h);
        return { x: round2(x), y: round2(y), w: round2(w), h: round2(h), padding: 0, z_index: 0 };
    }

    function showToast(message, isError) {
        let t = document.getElementById("pv-toast");
        if (!t) {
            t = document.createElement("div");
            t.id = "pv-toast";
            t.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);" +
                "padding:10px 18px;border-radius:8px;color:#fff;font-size:14px;z-index:2000;" +
                "box-shadow:0 6px 20px rgba(0,0,0,.25);transition:opacity .25s;pointer-events:none;";
            document.body.appendChild(t);
        }
        t.style.background = isError ? "#dc2626" : "#16a34a";
        t.textContent = message;
        t.style.opacity = "1";
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.opacity = "0"; }, 2200);
    }

    async function fetchJson(url, options) {
        const opts = Object.assign({}, options);
        const method = String(opts.method || "GET").toUpperCase();
        if (method === "GET") {
            // Never let the browser serve a stale list: a freshly uploaded
            // background/product must appear immediately and after a reload.
            opts.cache = "no-store";
            const sep = url.indexOf("?") === -1 ? "?" : "&";
            url = url + sep + "_ts=" + Date.now();
        }
        const res = await fetch(url, opts);
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

        if (!res.ok) {
            // PHP aborts oversized POSTs before our code runs: the body is empty
            // or an HTML error page, so there is no JSON `error` to report.
            // Turn that into a message the user can actually act on.
            if (data == null && (res.status === 413 || res.status === 500 ||
                text === "" || /<html/i.test(text))) {
                throw new Error("The server rejected the upload (HTTP " + res.status +
                    "). The image may be too large for this server's limits.");
            }
            const msg = (data && (data.error && (data.error.message || data.error) || data.error)) || text || res.status;
            const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
            // Callers need the status: a 404 on DELETE means "already gone",
            // which is a success for an idempotent unassign.
            err.status = res.status;
            throw err;
        }
        if (data == null && text !== "") {
            throw new Error("The server returned an unexpected response. Check the server error log.");
        }
        return data;
    }

    // ======================================================================
    // LOADING
    // ======================================================================
    async function loadBackgrounds() {
        const list = await fetchJson(`${API_V1}/backgrounds`);
        state.backgrounds = Array.isArray(list) ? list : [];
        backgroundThumbnails.innerHTML = "";
        state.backgrounds.forEach(bg => addBackgroundThumbnail(bg));
        if (state.backgrounds.length > 0) {
            const preferred = state.backgrounds.some(b => b.id === state.currentBgId)
                ? state.currentBgId : state.backgrounds[0].id;
            await selectBackground(preferred);
        } else {
            state.currentBgId = null;
            state.currentBg = null;
            state.assignments = [];
            renderStage();
            renderAssignmentList();
        }
    }

    async function loadCatalog() {
        try {
            const data = await fetchJson(`${API_V1}/products`);
            state.catalog = (data && data.products) ? data.products : [];
        } catch (e) {
            state.catalog = [];
            console.warn("Could not load product catalog:", e.message);
        }
    }

    function addBackgroundThumbnail(bg) {
        const div = document.createElement("div");
        div.className = "thumbnail background-thumbnail";
        div.dataset.bgId = bg.id;
        div.title = `${bg.name} (${bg.product_count || 0} products)`;

        const img = document.createElement("img");
        img.src = bg.image_url;
        img.alt = bg.name;
        img.className = "background-thumbnail-img";
        div.appendChild(img);

        const del = document.createElement("button");
        del.className = "delete-btn background-delete-btn";
        del.innerHTML = '<i class="fas fa-trash-alt"></i>';
        del.title = "Delete Background";
        del.onclick = async (ev) => {
            ev.stopPropagation();
            if (!confirm(`Delete background "${bg.name}"? All its placements will be removed.`)) return;
            try {
                await fetchJson(`${API}/backgrounds.php/${bg.id}`, { method: "DELETE" });
                state.backgrounds = state.backgrounds.filter(b => b.id !== bg.id);
                if (state.currentBgId === bg.id) state.currentBgId = null;
                await loadCatalog();
                await loadBackgrounds();
                showToast("Background deleted");
            } catch (e) { showToast(e.message, true); }
        };
        div.appendChild(del);

        div.addEventListener("click", () => selectBackground(bg.id));
        backgroundThumbnails.appendChild(div);
    }

    async function selectBackground(bgId) {
        bgId = Number(bgId);
        const bg = state.backgrounds.find(b => b.id === bgId);
        if (!bg) return;

        state.currentBgId = bgId;
        state.currentBg = bg;
        state.bgNavIndex = state.backgrounds.findIndex(b => b.id === bgId);
        state.selectedProductId = null;

        // Highlight thumbnail.
        backgroundThumbnails.querySelectorAll(".background-thumbnail").forEach(t => {
            t.classList.toggle("selected", Number(t.dataset.bgId) === bgId);
        });

        productsHeading.textContent = `Products in "${bg.name}"`;
        productsHint.textContent = "Tick a product to assign it to this background, then position it.";

        await loadAssignments(bgId);
        await loadCatalog();          // ensure background_ids are fresh
        renderAssignmentList();
        renderStage();
        updateEditorInputs();
    }

    async function loadAssignments(bgId) {
        try {
            const data = await fetchJson(`${API_V1}/backgrounds/${bgId}/products`);
            const products = (data && data.products) ? data.products : [];
            state.assignments = products.map(p => ({
                product_id: p.product_id,
                name: p.name,
                image_url: p.image_url,
                image_width: p.image_width,
                image_height: p.image_height,
                placement: {
                    x: p.placement.x, y: p.placement.y, w: p.placement.w,
                    h: p.placement.h, padding: p.placement.padding, z_index: p.placement.z_index
                }
            }));
        } catch (e) {
            state.assignments = [];
            showToast("Could not load placements: " + e.message, true);
        }
    }

    // ======================================================================
    // ASSIGNMENT LIST (left panel)
    // ======================================================================
    function isAssigned(productId) {
        return state.assignments.some(a => Number(a.product_id) === Number(productId));
    }

    /**
     * Spinner rows for images that are still being processed / uploaded.
     * They appear at the top of the PRODUCTS panel so the processed thumbnail
     * is visible immediately, before the server round-trip completes.
     */
    function renderPendingUploads() {
        state.pendingUploads.forEach(p => {
            const row = document.createElement("div");
            row.className = "assign-row is-pending";
            row.dataset.pendingId = p.id;

            const thumb = document.createElement("div");
            thumb.className = "assign-thumb assign-thumb-pending";
            if (p.previewUrl) {
                const img = document.createElement("img");
                img.src = p.previewUrl;
                img.alt = p.name || "Processing";
                thumb.appendChild(img);
            }
            const spinner = document.createElement("span");
            spinner.className = "assign-spinner";
            spinner.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
            thumb.appendChild(spinner);
            row.appendChild(thumb);

            const meta = document.createElement("div");
            meta.className = "assign-meta";
            const nameEl = document.createElement("div");
            nameEl.className = "assign-name";
            nameEl.textContent = p.name || "Processing image…";
            const subEl = document.createElement("div");
            subEl.className = "assign-sub";
            subEl.textContent = p.status === "uploading" ? "Uploading…" : "Processing image…";
            meta.appendChild(nameEl);
            meta.appendChild(subEl);
            row.appendChild(meta);

            productAssignment.appendChild(row);
        });
    }

    function dropPendingUpload(pending) {
        state.pendingUploads = state.pendingUploads.filter(p => p !== pending);
        if (pending && pending.previewUrl) {
            URL.revokeObjectURL(pending.previewUrl);
            pending.previewUrl = null;
        }
        renderAssignmentList();
    }

    /**
     * Placement rectangle of the marking area shown in the inspector. The
     * processed PNG already has this exact aspect ratio, so the product fills
     * the box without letterboxing or distortion.
     */
    function markingPlacement() {
        const w = clamp(parseFloat(markingWidthInput.value) || 15, 1, 100);
        const h = clamp(parseFloat(markingHeightInput.value) || 60, 1, 100);
        const x = clamp(parseFloat(markingLeftInput.value) || 0, 0, 100 - w);
        const y = clamp(parseFloat(markingTopInput.value) || 0, 0, 100 - h);
        const padding = clamp(parseFloat(markingPaddingInput.value) || 0, 0, 50);
        return { x: round2(x), y: round2(y), w: round2(w), h: round2(h), padding: round2(padding), z_index: 0 };
    }

    function renderAssignmentList() {
        productAssignment.innerHTML = "";
        renderPendingUploads();

        if (!state.currentBg) {
            if (state.pendingUploads.length === 0) {
                productAssignment.innerHTML = '<div class="assign-empty">No background selected.</div>';
            }
            return;
        }
        if (state.catalog.length === 0 && state.pendingUploads.length === 0) {
            productAssignment.innerHTML = '<div class="assign-empty">No products yet. Use Upload.</div>';
            return;
        }

        state.catalog.forEach(prod => {
            const assigned = isAssigned(prod.id);
            const row = document.createElement("div");
            row.className = "assign-row" + (assigned ? "" : " is-unassigned")
                + (Number(prod.id) === Number(state.selectedProductId) ? " is-selected" : "");
            row.dataset.productId = prod.id;

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = assigned;
            // stopPropagation() must be on "click", not only on "change": the
            // click still bubbled up to the row handler, which called
            // assignProduct() a second time (two POSTs, placement reset).
            cb.addEventListener("click", (ev) => ev.stopPropagation());
            cb.addEventListener("change", async (ev) => {
                ev.stopPropagation();
                if (cb.checked) await assignProduct(prod);
                else await unassignProduct(prod.id);
            });
            row.appendChild(cb);

            const thumb = document.createElement("img");
            thumb.className = "assign-thumb";
            thumb.src = prod.image_url;
            thumb.alt = prod.name;
            row.appendChild(thumb);

            const meta = document.createElement("div");
            meta.className = "assign-meta";
            const nameEl = document.createElement("div");
            nameEl.className = "assign-name";
            nameEl.textContent = prod.name || ("#" + prod.id);
            const subEl = document.createElement("div");
            subEl.className = "assign-sub";
            const bgCount = (prod.background_ids || []).length;
            subEl.textContent = "ID " + prod.id + (bgCount ? ` · in ${bgCount} background(s)` : "");
            meta.appendChild(nameEl);
            meta.appendChild(subEl);
            row.appendChild(meta);

            if (assigned) {
                const rm = document.createElement("button");
                rm.className = "assign-remove";
                rm.title = "Remove from this background";
                rm.innerHTML = '<i class="fas fa-unlink"></i>';
                rm.onclick = async (ev) => { ev.stopPropagation(); await unassignProduct(prod.id); };
                row.appendChild(rm);
            }

            // Permanent delete: removes the product from EVERY background (and
            // deletes its image file). Distinct from the unlink above, which
            // only detaches it from the current background.
            const del = document.createElement("button");
            del.className = "assign-delete";
            del.title = "Delete product";
            del.innerHTML = '<i class="fas fa-trash-alt"></i>';
            del.onclick = async (ev) => {
                // Do not toggle the row checkbox / re-select the row.
                ev.stopPropagation();
                await deleteProduct(prod);
            };
            row.appendChild(del);

            row.addEventListener("click", () => {
                const pid = Number(prod.id);
                // A removal for this product is running: ignore the click so it
                // cannot re-select the row that is about to disappear.
                if (removalInFlight.has(pid)) return;
                // Read isAssigned() live rather than the render-time snapshot:
                // the snapshot goes stale as soon as an async assign lands, so a
                // click on the freshly ticked row used to POST the product again.
                if (isAssigned(pid)) selectProduct(pid);
                else assignProduct(prod);
            });

            productAssignment.appendChild(row);
        });
    }

    async function assignProduct(prod, forcedPlacement) {
        const bgId = state.currentBgId;
        if (!bgId) return;
        const pid = Number(prod.id);

        // Ignore repeats from duplicate UI events, and never start an assign
        // while a removal of the same product is still running.
        if (assignInFlight.has(pid) || removalInFlight.has(pid)) return;
        // Already on this background and no explicit placement asked for: this
        // is a stray second call. Select it instead of re-POSTing, which would
        // overwrite the placement the user may have just fine-tuned.
        if (!forcedPlacement && isAssigned(pid)) { selectProduct(pid); return; }

        assignInFlight.add(pid);
        const placement = forcedPlacement || defaultPlacement(prod);
        try {
            await fetchJson(`${API_V1}/backgrounds/${bgId}/products`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.assign({ product_id: pid }, placement))
            });
            await loadAssignments(bgId);
            await loadCatalog();
            // The user switched backgrounds while this was in flight: refresh
            // the list but do not stamp this assignment onto the new background.
            if (Number(state.currentBgId) !== bgId) { renderAssignmentList(); return; }
            state.selectedProductId = pid;
            renderAssignmentList();
            renderStage();
            updateEditorInputs();
            showToast(`Added "${prod.name}" to this background`);
        } catch (e) {
            showToast("Assign failed: " + e.message, true);
        } finally {
            assignInFlight.delete(pid);
        }
    }

    /**
     * Unassign a product from the CURRENT background only.
     * Idempotent: a repeated click, or a 404 because the mapping was already
     * deleted, still ends in a clean "removed" state instead of a red error.
     */
    async function unassignProduct(productId) {
        const bgId = state.currentBgId;
        const pid = Number(productId);
        if (!bgId || !pid) return;
        // A removal for this product is already running: let it finish so the
        // second click cannot fire a duplicate DELETE (which would 404).
        if (removalInFlight.has(pid)) return;
        removalInFlight.add(pid);
        removeFromBgBtn.disabled = true;

        try {
            try {
                await fetchJson(`${API_V1}/backgrounds/${bgId}/products/${pid}`, { method: "DELETE" });
            } catch (e) {
                // 404 == the mapping no longer exists (double click, or removed
                // elsewhere). The DB is already in the wanted state, so this is
                // a success, not an error.
                if (e.status !== 404) throw e;
            }

            // Background switched while the request was in flight: refresh the
            // counters but do not overwrite the new background's placements.
            if (Number(state.currentBgId) !== bgId) {
                await loadCatalog();
                renderAssignmentList();
                showToast("Removed from this background");
                return;
            }

            await loadAssignments(bgId);
            await loadCatalog();

            // Clear the selection only when it is the product we just removed.
            if (Number(state.selectedProductId) === pid) state.selectedProductId = null;

            renderAssignmentList();
            renderStage();            // removes the bounding box from the canvas
            updateEditorInputs();     // resets the Marking Area panel
            showToast("Removed from this background");
        } catch (e) {
            showToast("Remove failed: " + e.message, true);
        } finally {
            removalInFlight.delete(pid);
            updateEditorInputs();     // re-derive the button state
        }
    }

    /**
     * Permanently delete a product: removes it from every background, deletes
     * its image file, and updates the list in place (no page reload). If the
     * product was open in the Marking Area, the panel is cleared.
     */
    async function deleteProduct(prod) {
        const pid = Number(prod.id);
        if (!pid) return;
        if (deleteInFlight.has(pid)) return;

        const label = prod.name || ("#" + pid);
        if (!confirm(`Delete product "${label}"? It will be removed from all backgrounds. This cannot be undone.`)) return;

        deleteInFlight.add(pid);
        try {
            await fetchJson(`${API_V1}/products/${pid}`, { method: "DELETE" });

            // Was it shown on the current background's stage? (needed below)
            const wasAssigned = isAssigned(pid);
            const wasSelected = Number(state.selectedProductId) === pid;

            // Drop the product from local state.
            state.catalog = state.catalog.filter(p => Number(p.id) !== pid);
            state.assignments = state.assignments.filter(a => Number(a.product_id) !== pid);

            // If it was open in the Marking Area, clear the selection.
            if (wasSelected) state.selectedProductId = null;

            // Remove the row from the list directly (no full reload).
            const row = productAssignment.querySelector(
                `.assign-row[data-product-id="${pid}"]`);
            if (row) row.remove();

            // Repaint the stage so a box for the deleted product disappears,
            // and reset the Marking Area panel if it was editing this product.
            if (wasAssigned) renderStage();
            if (wasSelected) updateEditorInputs();

            showToast("Product deleted");
        } catch (e) {
            showToast("Delete failed: " + e.message, true);
        } finally {
            deleteInFlight.delete(pid);
        }
    }

    // ======================================================================
    // STAGE RENDERING (shared renderer)
    // ======================================================================
    function currentAssignment(productId) {
        return state.assignments.find(a => Number(a.product_id) === Number(productId)) || null;
    }

    function buildSceneProducts() {
        return state.assignments.map(a => ({
            id: a.product_id,
            url: a.image_url,
            name: a.name,
            x: a.placement.x,
            y: a.placement.y,
            w: a.placement.w,
            h: a.placement.h,
            padding: a.placement.padding,
            z_index: a.placement.z_index
        }));
    }

    function renderStage() {
        if (state.scene && state.scene.detach) state.scene.detach();
        state.scene = null;

        if (!state.currentBg) {
            pvHost.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;' +
                'width:100%;height:100%;color:#9ca3af;font-size:15px;">Select a background to begin</div>';
            stageMeta.textContent = "No background selected";
            return;
        }

        state.scene = PVRender.renderScene(pvHost, {
            backgroundUrl: state.currentBg.image_url,
            backgroundName: state.currentBg.name,
            backgroundWidth: state.currentBg.image_width,
            backgroundHeight: state.currentBg.image_height,
            products: buildSceneProducts(),
            editor: true
        });

        stageMeta.textContent =
            `${state.currentBg.name} · ${state.currentBg.image_width || "?"}×${state.currentBg.image_height || "?"} px`;

        decorateStage();
    }

    function boxForProduct(productId) {
        const stage = pvHost.querySelector(".pv-stage");
        if (!stage) return null;
        return stage.querySelector(`.pv-product-box[data-product-id="${productId}"]`);
    }

    function decorateStage() {
        const stage = pvHost.querySelector(".pv-stage");
        if (!stage) return;

        stage.querySelectorAll(".pv-product-box").forEach(box => {
            const pid = Number(box.dataset.productId);
            box.classList.toggle("selected", pid === Number(state.selectedProductId));
            // Remove any old handles.
            box.querySelectorAll(".pv-resize-handle").forEach(h => h.remove());
            box.style.cursor = "move";

            // Attach interaction listeners only ONCE per box. decorateStage() is
            // called again on every selection change, so without this guard the
            // same box would accumulate duplicate mousedown/click handlers.
            if (!box.dataset.pvBound) {
                box.dataset.pvBound = "1";
                box.addEventListener("mousedown", onBoxMouseDown);
                box.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    selectProduct(Number(box.dataset.productId));
                });
            }

            if (pid === Number(state.selectedProductId)) {
                ["nw", "ne", "sw", "se"].forEach(dir => {
                    const h = document.createElement("div");
                    h.className = "pv-resize-handle " + dir;
                    h.dataset.dir = dir;
                    h.addEventListener("mousedown", (ev) => onHandleMouseDown(ev, pid, dir));
                    box.appendChild(h);
                });
            }
        });
    }

    function selectProduct(productId) {
        if (!isAssigned(productId)) return;
        state.selectedProductId = Number(productId);

        // Reflect selection in the list.
        productAssignment.querySelectorAll(".assign-row").forEach(r => {
            r.classList.toggle("is-selected", Number(r.dataset.productId) === state.selectedProductId);
        });

        decorateStage();
        updateEditorInputs();

        const a = currentAssignment(productId);
        if (a) {
            productInfoTitle.textContent = a.name || "Product";
            productInfoDesc.textContent = "";
        }
    }

    // ======================================================================
    // EDITOR INPUTS <-> PLACEMENT
    // ======================================================================
    /** Neutral values for the Marking Area when nothing is selected. */
    function clearEditorInputs() {
        markingLeftInput.value = DEFAULT_MARKING.x;
        markingTopInput.value = DEFAULT_MARKING.y;
        markingWidthInput.value = DEFAULT_MARKING.w;
        markingHeightInput.value = DEFAULT_MARKING.h;
        markingPaddingInput.value = DEFAULT_MARKING.padding;
        markingDimensions.textContent = "0 x 0 px";
    }

    function updateEditorInputs() {
        const a = currentAssignment(state.selectedProductId);
        if (!a) {
            selectionHint.textContent = state.currentBg
                ? "Select a product on the stage or in the list."
                : "No background selected.";
            // Nothing selected: wipe the previous product's geometry so a
            // removed product leaves no stale X / Y / W / H / Padding, and
            // disable the actions that need a selection.
            clearEditorInputs();
            saveMarkingBtn.disabled = true;
            removeFromBgBtn.disabled = true;
            return;
        }
        saveMarkingBtn.disabled = false;
        // Keep the button disabled while that product's removal is in flight.
        removeFromBgBtn.disabled = removalInFlight.has(Number(a.product_id));
        selectionHint.textContent = `Editing: ${a.name} (ID ${a.product_id})`;

        markingLeftInput.value = round2(a.placement.x);
        markingTopInput.value = round2(a.placement.y);
        markingWidthInput.value = round2(a.placement.w);
        markingHeightInput.value = round2(a.placement.h);
        markingPaddingInput.value = round2(a.placement.padding);
        updateDimensionsDisplay();
    }

    function readInputsIntoPlacement() {
        return {
            x: round2(parseFloat(markingLeftInput.value) || 0),
            y: round2(parseFloat(markingTopInput.value) || 0),
            w: round2(parseFloat(markingWidthInput.value) || 0),
            h: round2(parseFloat(markingHeightInput.value) || 0),
            padding: round2(parseFloat(markingPaddingInput.value) || 0),
            z_index: (currentAssignment(state.selectedProductId) || { placement: { z_index: 0 } }).placement.z_index || 0
        };
    }

    function updateDimensionsDisplay() {
        const stage = pvHost.querySelector(".pv-stage");
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        const p = readInputsIntoPlacement();
        const wPx = Math.round(rect.width * p.w / 100);
        const hPx = Math.round(rect.height * p.h / 100);
        markingDimensions.textContent = `${wPx} x ${hPx} px`;
    }

    /** Apply the current inputs to the selected box live (no save). */
    function applyInputsLive() {
        const a = currentAssignment(state.selectedProductId);
        if (!a) return;
        const p = readInputsIntoPlacement();
        // Keep values within bounds while typing.
        p.x = clamp(p.x, 0, Math.max(0, 100 - p.w));
        p.y = clamp(p.y, 0, Math.max(0, 100 - p.h));
        p.w = clamp(p.w, 1, 100 - p.x);
        p.h = clamp(p.h, 1, 100 - p.y);

        a.placement.x = p.x; a.placement.y = p.y;
        a.placement.w = p.w; a.placement.h = p.h;
        a.placement.padding = p.padding;

        const box = boxForProduct(a.product_id);
        if (box) box.setAttribute("style", PVRender.placementStyle(a.placement));
        updateDimensionsDisplay();
    }

    [markingLeftInput, markingTopInput, markingWidthInput, markingHeightInput, markingPaddingInput]
        .forEach(inp => inp.addEventListener("input", applyInputsLive));

    // ======================================================================
    // DRAG TO MOVE
    // ======================================================================
    let dragCtx = null;
    function onBoxMouseDown(ev) {
        // Ignore when starting on a resize handle.
        if (ev.target.classList.contains("pv-resize-handle")) return;
        const pid = Number(ev.currentTarget.dataset.productId);
        const a = currentAssignment(pid);
        if (!a) return;
        if (Number(state.selectedProductId) !== pid) {
            selectProduct(pid);
        }

        const stage = pvHost.querySelector(".pv-stage");
        const rect = stage.getBoundingClientRect();
        dragCtx = {
            pid: pid,
            startX: ev.clientX,
            startY: ev.clientY,
            start: Object.assign({}, a.placement),
            rect: rect
        };
        ev.preventDefault();
        document.body.style.cursor = "move";
        document.addEventListener("mousemove", onDragMove);
        document.addEventListener("mouseup", onDragUp);
    }

    function onDragMove(ev) {
        if (!dragCtx) return;
        const a = currentAssignment(dragCtx.pid);
        if (!a) return;
        const dxPct = (ev.clientX - dragCtx.startX) / dragCtx.rect.width * 100;
        const dyPct = (ev.clientY - dragCtx.startY) / dragCtx.rect.height * 100;

        let x = dragCtx.start.x + dxPct;
        let y = dragCtx.start.y + dyPct;
        x = clamp(x, 0, 100 - a.placement.w);
        y = clamp(y, 0, 100 - a.placement.h);

        a.placement.x = round2(x);
        a.placement.y = round2(y);

        const box = boxForProduct(dragCtx.pid);
        if (box) box.setAttribute("style", PVRender.placementStyle(a.placement));
        markingLeftInput.value = a.placement.x;
        markingTopInput.value = a.placement.y;
        updateDimensionsDisplay();
    }

    function onDragUp() {
        dragCtx = null;
        document.body.style.cursor = "default";
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragUp);
    }

    // ======================================================================
    // RESIZE (with optional aspect lock)
    // ======================================================================
    let resizeCtx = null;
    function onHandleMouseDown(ev, productId, dir) {
        ev.preventDefault();
        ev.stopPropagation();
        const a = currentAssignment(productId);
        if (!a) return;
        const stage = pvHost.querySelector(".pv-stage");
        const rect = stage.getBoundingClientRect();
        resizeCtx = {
            pid: productId,
            dir: dir,
            startX: ev.clientX,
            startY: ev.clientY,
            start: Object.assign({}, a.placement),
            rect: rect,
            aspect: bgAspect()  // stage W/H
        };
        document.body.style.cursor = dir + "-resize";
        document.addEventListener("mousemove", onResizeMove);
        document.addEventListener("mouseup", onResizeUp);
    }

    function onResizeMove(ev) {
        if (!resizeCtx) return;
        const a = currentAssignment(resizeCtx.pid);
        if (!a) return;
        const rect = resizeCtx.rect;
        const dxPct = (ev.clientX - resizeCtx.startX) / rect.width * 100;
        const dyPct = (ev.clientY - resizeCtx.startY) / rect.height * 100;

        let x = resizeCtx.start.x, y = resizeCtx.start.y;
        let w = resizeCtx.start.w, h = resizeCtx.start.h;
        const dir = resizeCtx.dir;

        if (dir.includes("e")) w = resizeCtx.start.w + dxPct;
        if (dir.includes("s")) h = resizeCtx.start.h + dyPct;
        if (dir.includes("w")) { w = resizeCtx.start.w - dxPct; x = resizeCtx.start.x + dxPct; }
        if (dir.includes("n")) { h = resizeCtx.start.h - dyPct; y = resizeCtx.start.y + dyPct; }

        const lock = lockAspectInput.checked;
        if (lock) {
            const pa = productAspect(a) || (w / h); // product pixel aspect
            // Derive h from w so the box pixel aspect == product aspect.
            // wPct = hPct * pa / bgAspect  =>  hPct = wPct * bgAspect / pa
            if (dir === "e" || dir === "w" || dir === "ne" || dir === "se" ||
                dir === "nw" || dir === "sw") {
                // Bias towards the dominant axis of the drag.
                if (Math.abs(dxPct) >= Math.abs(dyPct) || dir === "e" || dir === "w") {
                    const newH = w * resizeCtx.aspect / pa;
                    if (dir.includes("n")) {
                        // Keep the bottom edge fixed.
                        const bottom = y + h;
                        h = newH;
                        y = bottom - h;
                    } else {
                        h = newH;
                    }
                } else {
                    const newW = h * pa / resizeCtx.aspect;
                    if (dir.includes("w")) {
                        const right = x + w;
                        w = newW;
                        x = right - w;
                    } else {
                        w = newW;
                    }
                }
            }
        }

        // Minimum + bounds.
        w = clamp(w, 1, 100);
        h = clamp(h, 1, 100);
        x = clamp(x, 0, 100 - w);
        y = clamp(y, 0, 100 - h);
        w = clamp(w, 1, 100 - x);
        h = clamp(h, 1, 100 - y);

        a.placement.x = round2(x);
        a.placement.y = round2(y);
        a.placement.w = round2(w);
        a.placement.h = round2(h);

        const box = boxForProduct(resizeCtx.pid);
        if (box) box.setAttribute("style", PVRender.placementStyle(a.placement));

        markingLeftInput.value = a.placement.x;
        markingTopInput.value = a.placement.y;
        markingWidthInput.value = a.placement.w;
        markingHeightInput.value = a.placement.h;
        updateDimensionsDisplay();
    }

    function onResizeUp() {
        resizeCtx = null;
        document.body.style.cursor = "default";
        document.removeEventListener("mousemove", onResizeMove);
        document.removeEventListener("mouseup", onResizeUp);
    }

    // ======================================================================
    // SAVE
    // ======================================================================
    saveMarkingBtn.addEventListener("click", async () => {
        const a = currentAssignment(state.selectedProductId);
        if (!a || !state.currentBgId) {
            showToast("Select a product first", true);
            return;
        }
        const p = a.placement;

        // Client-side validation (mirrors the server).
        if (p.w <= 0 || p.h <= 0 || p.x < 0 || p.y < 0 || (p.x + p.w) > 100.01 || (p.y + p.h) > 100.01) {
            showToast("Invalid placement: keep x+w ≤ 100 and y+h ≤ 100", true);
            return;
        }

        saveMarkingBtn.disabled = true;
        try {
            const payload = { x: p.x, y: p.y, w: p.w, h: p.h, padding: p.padding };
            await fetchJson(`${API_V1}/backgrounds/${state.currentBgId}/products/${a.product_id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            await loadAssignments(state.currentBgId);
            renderStage();
            updateEditorInputs();
            showToast("Saved");
        } catch (e) {
            showToast("Save failed: " + e.message, true);
        } finally {
            saveMarkingBtn.disabled = false;
        }
    });

    removeFromBgBtn.addEventListener("click", async () => {
        // Snapshot the selection BEFORE the blocking confirm() so the id we act
        // on cannot be swapped by a pending re-render while the dialog is open.
        const pid = state.selectedProductId;
        if (!pid) return;
        if (removalInFlight.has(Number(pid))) return;   // already removing
        if (!confirm("Remove this product from the current background? (The product itself is kept.)")) return;
        await unassignProduct(pid);
    });

    // ======================================================================
    // UPLOADS
    // ======================================================================
    addBackgroundBtn.addEventListener("click", () => backgroundUploadInput.click());

    backgroundUploadInput.addEventListener("change", (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        backgroundNameInput.value = file.name.replace(/\.[^/.]+$/, "");
        backgroundSetupModal.style.display = "flex";
    });

    cancelBackgroundBtn.addEventListener("click", closeBackgroundModal);

    confirmBackgroundBtn.addEventListener("click", async () => {
        const file = backgroundUploadInput.files && backgroundUploadInput.files[0];
        if (!file) { closeBackgroundModal(); return; }
        const name = backgroundNameInput.value.trim() || `Background ${Date.now()}`;

        const fd = new FormData();
        fd.append("backgroundImage", file);
        fd.append("name", name);

        confirmBackgroundBtn.disabled = true;
        try {
            const created = await fetchJson(`${API}/backgrounds.php`, { method: "POST", body: fd });

            // The server returns the new row; select it right away so the
            // editor jumps to the background the user just uploaded.
            const newId = created && (created.id || created.background_id);
            if (newId != null) state.currentBgId = Number(newId);

            showToast("Background uploaded");
        } catch (e) {
            showToast("Upload failed: " + e.message, true);
        } finally {
            // Always dismiss the dialog, whatever the outcome, so the app is
            // never left with a stuck modal.
            confirmBackgroundBtn.disabled = false;
            closeBackgroundModal();
        }

        // Refresh from the server (not cached) so the new background appears
        // in the list immediately and still appears after a page reload.
        try {
            await loadBackgrounds();
        } catch (e) {
            console.warn("Could not refresh backgrounds:", e.message);
        }
    });

    function closeBackgroundModal() {
        backgroundSetupModal.style.display = "none";
        backgroundUploadInput.value = "";
        backgroundNameInput.value = "";
    }

    uploadProductBtn.addEventListener("click", () => {
        if (!state.currentBgId) { showToast("Select a background first", true); return; }
        productUploadInput.click();
    });

    /**
     * Product upload: validate -> process (trim/remove bg/fit) -> upload PNG.
     * Runs automatically, with no aspect-ratio modal and no blocking dialog.
     */
    productUploadInput.addEventListener("change", async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        productUploadInput.value = "";
        if (!file) return;
        if (!state.currentBgId) { showToast("Select a background first", true); return; }

        // Defensive: if the pipeline did not load (stale cache), upload the
        // original file rather than blocking the user.
        if (typeof ImageProcessor === "undefined") {
            console.warn("ImageProcessor unavailable - uploading the original file.");
            await uploadOriginalProduct(file, state.currentBgId);
            return;
        }

        const check = ImageProcessor.validateFile(file);
        if (!check.ok) { showToast(check.error, true); return; }

        const bgId = state.currentBgId;
        const baseName = file.name.replace(/\.[^/.]+$/, "") || `Product ${Date.now()}`;
        const pending = {
            id: "p" + Date.now() + Math.random().toString(36).slice(2, 7),
            name: baseName,
            previewUrl: null,
            status: "processing"
        };
        state.pendingUploads.push(pending);
        renderAssignmentList();

        const markingArea = currentMarkingArea();
        const fitMode = normalizeFitMode(fitModeInput ? fitModeInput.value : "contain");
        const removeBg = !!(removeBackgroundInput && removeBackgroundInput.checked);
        const fitHint = document.getElementById("fit-hint");

        try {
            const blob = await ImageProcessor.processProductImage(file, markingArea, {
                fitMode: fitMode,
                removeBackground: removeBg,
                onAnalyze: function (info) {
                    if (!fitHint) return;
                    if (info.solidBackground && !removeBg) {
                        fitHint.textContent = "Solid background detected. Tick “Remove background” and upload again to drop it.";
                    } else if (info.transparentBackground) {
                        fitHint.textContent = "Transparent background detected — trimmed automatically.";
                    } else {
                        fitHint.textContent = "Images are auto-trimmed and fitted to the marking area on upload.";
                    }
                }
            });

            // Show the processed result in the PRODUCTS panel right away.
            pending.previewUrl = URL.createObjectURL(blob);
            pending.status = "uploading";
            renderAssignmentList();

            const safeName = baseName.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "product";

            const fd = new FormData();
            // Third argument gives the upload a .png filename so the server
            // stores a proper extension; the blob carries image/png as its type.
            fd.append("productImage", blob, safeName + ".png");
            fd.append("background_id", bgId);
            fd.append("name", baseName);
            fd.append("description", "");

            const newProduct = await fetchJson(`${API}/products.php?background_id=${bgId}`, {
                method: "POST", body: fd
            });

            // The blob URL is no longer needed - the server now serves the PNG.
            if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl);
            pending.previewUrl = null;
            state.pendingUploads = state.pendingUploads.filter(p => p !== pending);
            await loadCatalog();

            if (Number(state.currentBgId) === Number(bgId)) {
                const prod = state.catalog.find(p => Number(p.id) === Number(newProduct.id)) || {
                    id: newProduct.id,
                    name: newProduct.name,
                    image_url: newProduct.imageUrl || newProduct.image_url,
                    image_width: newProduct.image_width,
                    image_height: newProduct.image_height
                };
                // Place it exactly over the marking area (aspect already matches).
                await assignProduct(prod, markingPlacement());
            } else {
                renderAssignmentList();
                showToast(`Added "${baseName}" to the background`);
            }
        } catch (e) {
            console.error("Image processing failed:", e);
            dropPendingUpload(pending);
            showToast("Couldn't process this image. Try another file.", true);
        }
    });

    function normalizeFitMode(mode) {
        return (mode === "cover" || mode === "stretch") ? mode : "contain";
    }

    /** Fallback used only when the Canvas pipeline is unavailable. */
    async function uploadOriginalProduct(file, bgId) {
        const baseName = file.name.replace(/\.[^/.]+$/, "") || `Product ${Date.now()}`;
        const fd = new FormData();
        fd.append("productImage", file);
        fd.append("background_id", bgId);
        fd.append("name", baseName);
        fd.append("description", "");
        try {
            const newProduct = await fetchJson(`${API}/products.php?background_id=${bgId}`, {
                method: "POST", body: fd
            });
            await loadCatalog();
            const prod = state.catalog.find(p => Number(p.id) === Number(newProduct.id)) || {
                id: newProduct.id,
                name: newProduct.name,
                image_url: newProduct.imageUrl || newProduct.image_url,
                image_width: newProduct.image_width,
                image_height: newProduct.image_height
            };
            await assignProduct(prod);
        } catch (e) {
            showToast("Couldn't process this image. Try another file.", true);
        }
    }

    // ======================================================================
    // FULLSCREEN
    // ======================================================================
    fullscreenToggleBtn.addEventListener("click", toggleFullscreen);
    exitFullscreenBtn.addEventListener("click", exitFullscreen);

    function toggleFullscreen() {
        if (!body.classList.contains("fullscreen-active")) enterFullscreen();
        else exitFullscreen();
    }
    function enterFullscreen() {
        body.classList.add("fullscreen-active");
        exitFullscreenBtn.style.display = "flex";
        // ResizeObserver inside PVRender refits the stage automatically, but
        // call once explicitly for browsers without it.
        if (state.scene && state.scene.refit) setTimeout(state.scene.refit, 50);
    }
    function exitFullscreen() {
        body.classList.remove("fullscreen-active");
        exitFullscreenBtn.style.display = "none";
        keyboardShortcutsModal.style.display = "none";
        if (state.scene && state.scene.refit) setTimeout(state.scene.refit, 50);
    }

    prevProductBtn.addEventListener("click", () => navigateProducts(-1));
    nextProductBtn.addEventListener("click", () => navigateProducts(1));

    function navigateProducts(dir) {
        if (state.assignments.length === 0) return;
        let idx = state.assignments.findIndex(a => Number(a.product_id) === Number(state.selectedProductId));
        if (idx === -1) idx = 0;
        idx = (idx + dir + state.assignments.length) % state.assignments.length;
        selectProduct(state.assignments[idx].product_id);
    }

    function productInfoToggle() {
        state.isProductInfoVisible = !state.isProductInfoVisible;
        productInfoOverlay.classList.toggle("visible", state.isProductInfoVisible);
        productInfoBtn.classList.toggle("active", state.isProductInfoVisible);
    }
    productInfoBtn.addEventListener("click", productInfoToggle);
    fullscreenHelpBtn.addEventListener("click", () => {
        keyboardShortcutsModal.style.display = "block";
    });

    document.addEventListener("keydown", (e) => {
        if (keyboardShortcutsModal.style.display === "block") {
            if (e.key === "Escape" || e.key === "h" || e.key === "H") {
                keyboardShortcutsModal.style.display = "none";
            }
            return;
        }
        if (!body.classList.contains("fullscreen-active")) return;
        switch (e.key) {
            case "ArrowLeft": navigateProducts(-1); break;
            case "ArrowRight": navigateProducts(1); break;
            case "i": case "I": productInfoToggle(); break;
            case "h": case "H": keyboardShortcutsModal.style.display = "block"; break;
            case "Escape":
                if (productInfoOverlay.classList.contains("visible")) productInfoToggle();
                else exitFullscreen();
                break;
        }
    });

    // Close buttons for modals.
    document.querySelectorAll(".close-modal").forEach(btn => {
        btn.addEventListener("click", () => {
            backgroundSetupModal.style.display = "none";
            keyboardShortcutsModal.style.display = "none";
        });
    });

    // ======================================================================
    // BOOT
    // ======================================================================
    (async function boot() {
        try {
            await loadCatalog();
            await loadBackgrounds();
        } catch (e) {
            showToast("Failed to load: " + e.message, true);
            console.error(e);
        }
    })();
});