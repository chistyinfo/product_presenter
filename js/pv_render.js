/**
 * js/pv_render.js - ONE renderer for settings, fullscreen and (mirrored on) Android.
 * ---------------------------------------------------------------------------
 * The whole point: a placement is stored ONLY as percentages (x, y, w, h,
 * padding) of the *rendered background image box*. This module turns such a
 * placement into identical pixels in any container, at any screen size, by:
 *
 *   1. Building a "stage" element whose width:height equals the background
 *      image's natural aspect ratio (letterboxed with `contain` inside the
 *      host, so nothing is ever cropped or stretched).
 *   2. Laying the background <img> across the full stage.
 *   3. Placing each product box at left:x% / top:y% / width:w% / height:h% of
 *      the stage, with the image centred inside via object-fit:contain and an
 *      `inset: padding%` respect of the stored padding.
 *
 * Because step 1 keeps the stage's aspect ratio fixed and step 3 uses
 * percentages of that stage, the product lands on the exact same relative spot
 * in a 320px-wide phone preview or a 2560px-wide TV fullscreen.
 *
 * Android/iOS port: see API.md "Placement math". The same three steps apply.
 */
(function (global) {
    'use strict';

    /** Clamp helper. */
    function clamp(v, lo, hi) {
        if (!isFinite(v)) return lo;
        return Math.min(Math.max(v, lo), hi);
    }

    /**
     * Largest rectangle with the image's aspect ratio that fits inside the
     * available box (CSS `object-fit: contain` geometry).
     *
     * @param {number} availW  available width  (px)
     * @param {number} availH  available height (px)
     * @param {number} imgW    natural image width  (px)
     * @param {number} imgH    natural image height (px)
     * @returns {{width:number,height:number,left:number,top:number}}
     */
    function computeFit(availW, availH, imgW, imgH) {
        availW = Number(availW) || 0;
        availH = Number(availH) || 0;
        imgW = Number(imgW) || 0;
        imgH = Number(imgH) || 0;

        // Degenerate input: fall back to filling the host so nothing vanishes.
        if (availW <= 0 || availH <= 0) {
            return { width: 0, height: 0, left: 0, top: 0 };
        }
        if (imgW <= 0 || imgH <= 0) {
            return { width: availW, height: availH, left: 0, top: 0 };
        }

        const scale = Math.min(availW / imgW, availH / imgH);
        const width = imgW * scale;
        const height = imgH * scale;
        return {
            width: Math.round(width * 100) / 100,
            height: Math.round(height * 100) / 100,
            left: Math.round(((availW - width) / 2) * 100) / 100,
            top: Math.round(((availH - height) / 2) * 100) / 100
        };
    }

    /**
     * Inline style string for a product box.
     * Percentages are relative to the stage (the background image box).
     *
     * @param {{x:number,y:number,w:number,h:number,padding:number,z_index:number}} p
     * @returns {string}
     */
    function placementStyle(p) {
        const x = Number(p && p.x) || 0;
        const y = Number(p && p.y) || 0;
        const w = Number(p && p.w) || 0;
        const h = Number(p && p.h) || 0;
        const pad = Number(p && p.padding) || 0;
        const z = Number(p && p.z_index) || 0;
        return [
            'position:absolute',
            'left:' + x + '%',
            'top:' + y + '%',
            'width:' + w + '%',
            'height:' + h + '%',
            'padding:' + pad + '%',
            'box-sizing:border-box',
            'z-index:' + (5 + z)
        ].join(';');
    }

    /**
     * Build a stage element for a background + product list.
     * The caller is responsible for sizing/centering the stage inside its host
     * (see fitStageToHost). The returned element is `position:relative`.
     *
     * @param {Object} opts
     * @param {string} opts.backgroundUrl
     * @param {{x,y,w,h,padding,z_index,url,name,id}} opts.products
     * @param {boolean} [opts.editor]  reserve space for handles / classes
     * @returns {HTMLElement}
     */
    function buildStage(opts) {
        const stage = document.createElement('div');
        stage.className = 'pv-stage';
        stage.style.position = 'relative';
        stage.style.overflow = 'hidden';

        // A product can exist with no (or a broken) background image. A neutral
        // surface keeps the text and the product image legible instead of letting
        // the whole scene fail; the <img> is only added when there is a URL,
        // because `src=""` would re-request the page itself.
        stage.style.background = '#111';

        if (opts.backgroundUrl) {
            // Background fills the whole stage (aspect ratio already matches).
            const bg = document.createElement('img');
            bg.className = 'pv-stage-bg';
            bg.alt = opts.backgroundName || 'Background';
            bg.style.position = 'absolute';
            bg.style.inset = '0';
            bg.style.width = '100%';
            bg.style.height = '100%';
            bg.style.objectFit = 'fill'; // stage already has the image's ratio
            bg.style.display = 'block';
            bg.draggable = false;
            // A 404 / unreadable file must not leave a broken-image icon across
            // the whole stage: drop the img and let the solid stage show through.
            bg.addEventListener('error', function () {
                console.error('[pv_render] background image failed to load:', bg.src);
                if (bg.parentNode) bg.parentNode.removeChild(bg);
            });
            bg.src = opts.backgroundUrl;
            stage.appendChild(bg);
        } else {
            console.warn('[pv_render] no background image URL; using a solid stage.');
        }

        (opts.products || []).forEach(function (prod) {
            const box = document.createElement('div');
            box.className = 'pv-product-box';
            box.dataset.productId = prod.id != null ? prod.id : '';
            box.setAttribute('style', placementStyle(prod));

            const img = document.createElement('img');
            img.className = 'pv-product-img';
            img.alt = prod.name || 'Product';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain'; // never distort the door
            img.style.display = 'block';
            img.draggable = false;
            // A product row can legitimately have no image; skip `src=""` (it
            // requests the current page) and keep the empty box rather than
            // throwing away the whole scene.
            if (prod.url) {
                img.addEventListener('error', function () {
                    console.error('[pv_render] product image failed to load:', img.src);
                    img.style.visibility = 'hidden';
                });
                img.src = prod.url;
            }
            box.appendChild(img);

            stage.appendChild(box);
        });

        return stage;
    }

    /**
     * Size a stage so it fits (contain) inside a host element, centred, and
     * return the computed box. Call again on resize.
     *
     * @param {HTMLElement} stage
     * @param {HTMLElement} host
     * @param {number} imgW natural background width
     * @param {number} imgH natural background height
     * @returns {{width:number,height:number,left:number,top:number}}
     */
    function fitStageToHost(stage, host, imgW, imgH) {
        const rect = host.getBoundingClientRect();
        const fit = computeFit(rect.width, rect.height, imgW, imgH);

        stage.style.width = fit.width + 'px';
        stage.style.height = fit.height + 'px';
        stage.style.position = 'absolute';
        stage.style.left = fit.left + 'px';
        stage.style.top = fit.top + 'px';
        return fit;
    }

    /**
     * Convenience: render a complete scene into a host and keep it fitted on
     * resize. Returns { stage, detach }.
     *
     * @param {HTMLElement} host      positioned container (position:relative)
     * @param {Object} scene
     * @param {string} scene.backgroundUrl
     * @param {number} scene.backgroundWidth
     * @param {number} scene.backgroundHeight
     * @param {Array}  scene.products
     */
    function renderScene(host, scene) {
        // A missing host used to surface as "Cannot read properties of null
        // (reading 'style')" from getComputedStyle()/host.style below. Fail loudly
        // and return an inert handle so callers (and their catch blocks) never
        // have to dereference null.
        if (!host) {
            console.error('[pv_render] renderScene called without a host element.');
            return { stage: null, refit: function () {}, detach: function () {} };
        }

        host.innerHTML = '';
        // Only establish a positioning context when the host does not already
        // provide one. #pv-host (settings) is position:absolute and
        // #pv-stage-host (fullscreen) is position:fixed; forcing `relative`
        // here would collapse them to zero height.
        var computedPos = window.getComputedStyle(host).position;
        if (computedPos === 'static' || computedPos === '') {
            host.style.position = 'relative';
        }
        host.style.overflow = 'hidden';
        // Host must be allowed to shrink; let the caller size it.

        const stage = buildStage({
            backgroundUrl: scene.backgroundUrl,
            backgroundName: scene.backgroundName,
            products: scene.products || [],
            editor: !!scene.editor
        });
        host.appendChild(stage);

        const imgW = scene.backgroundWidth || 0;
        const imgH = scene.backgroundHeight || 0;

        function refit() {
            // If natural size is unknown, let the bg image tell us once loaded.
            const w = stage.__naturalW || imgW;
            const h = stage.__naturalH || imgH;
            fitStageToHost(stage, host, w, h);
        }

        const bgImg = stage.querySelector('.pv-stage-bg');
        if (bgImg) {
            const applyNatural = function () {
                if (bgImg.naturalWidth && bgImg.naturalHeight) {
                    stage.__naturalW = bgImg.naturalWidth;
                    stage.__naturalH = bgImg.naturalHeight;
                }
                refit();
            };
            bgImg.addEventListener('load', applyNatural);
            if (bgImg.complete && bgImg.naturalWidth) {
                applyNatural();
            }
        }

        refit();

        const ro = (typeof ResizeObserver !== 'undefined')
            ? new ResizeObserver(refit)
            : null;
        if (ro) ro.observe(host);
        window.addEventListener('resize', refit);

        return {
            stage: stage,
            refit: refit,
            detach: function () {
                if (ro) ro.disconnect();
                window.removeEventListener('resize', refit);
            }
        };
    }

    global.PVRender = {
        computeFit: computeFit,
        placementStyle: placementStyle,
        buildStage: buildStage,
        fitStageToHost: fitStageToHost,
        renderScene: renderScene
    };
})(window);