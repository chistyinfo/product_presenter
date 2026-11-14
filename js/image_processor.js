/**
 * js/image_processor.js - Client-side product image pipeline.
 * ---------------------------------------------------------------------------
 * Turns any uploaded product picture into a clean, distortion-free PNG that
 * fits a marking area, using nothing but the Canvas API (no libraries, no
 * server round-trips).
 *
 * Public API (window.ImageProcessor):
 *   validateFile(file)                            -> { ok, error? }
 *   probeImage(file)                              -> Promise<info>
 *   processProductImage(file, markingArea, opts)  -> Promise<Blob>  (PNG)
 *
 * markingArea accepts { width, height } | { aspect } | { w, h, bgAspect }.
 *
 * options: fitMode ('contain'|'cover'|'stretch'), removeBackground (bool),
 *          padding (ratio), maxSide, trimTolerance, colorTolerance, onAnalyze.
 */
(function (global) {
    'use strict';

    var ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    var ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;
    var MAX_BYTES = 10 * 1024 * 1024;   // 10 MB (source file ceiling)
    var MAX_SIDE = 2048;                // downscale ceiling
    // Many PHP installs ship upload_max_filesize=2M. A transparent PNG can be
    // far larger than its source, so the exported blob is shrink-fitted to stay
    // safely under the smallest limit we expect to meet in the wild.
    var TARGET_BYTES = 1.5 * 1024 * 1024;  // 1.5 MB
    var MIN_SIDE = 256;
    var ALPHA_BG = 8;                   // alpha at/below this counts as clear
    var CORNER_OPAQUE = 240;            // alpha needed for a "solid" corner

    // -- Helpers ---------------------------------------------------------
    function normalizeFit(mode) {
        return (mode === 'cover' || mode === 'stretch') ? mode : 'contain';
    }

    function clamp(v, lo, hi) {
        v = Number(v);
        if (!isFinite(v)) v = lo;
        return Math.min(Math.max(v, lo), hi);
    }

    function makeCanvas(w, h) {
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w || 1));
        c.height = Math.max(1, Math.round(h || 1));
        return c;
    }

    function fitWithin(w, h, maxSide) {
        var scale = Math.min(1, maxSide / Math.max(w, h));
        return {
            width: Math.max(1, Math.round(w * scale)),
            height: Math.max(1, Math.round(h * scale))
        };
    }

    /** Aspect ratio (w/h) described by a markingArea object. */
    function markingAspectOf(area) {
        if (!area) return 0;
        if (Number(area.aspect) > 0) return Number(area.aspect);
        if (Number(area.width) > 0 && Number(area.height) > 0) {
            return Number(area.width) / Number(area.height);
        }
        var bgAspect = Number(area.bgAspect) > 0 ? Number(area.bgAspect) : 1;
        if (Number(area.w) > 0 && Number(area.h) > 0) {
            return (Number(area.w) / Number(area.h)) * bgAspect;
        }
        if (Number(area.widthPercent) > 0 && Number(area.heightPercent) > 0) {
            return (Number(area.widthPercent) / Number(area.heightPercent)) * bgAspect;
        }
        return 0;
    }

    /** Guard against degenerate marking boxes (e.g. 1% x 100%). */
    function safeAspect(aspect, fallback) {
        aspect = Number(aspect);
        if (!isFinite(aspect) || aspect <= 0) return fallback;
        return Math.min(Math.max(aspect, 1 / 16), 16);
    }

    /** File type / size validation. Never throws. */
    function validateFile(file) {
        if (!file) return { ok: false, error: 'No file selected.' };
        var type = String(file.type || '').toLowerCase();
        var allowed = ALLOWED_MIME.indexOf(type) !== -1 ||
            (!type && ALLOWED_EXT.test(file.name || ''));
        if (!allowed) {
            return { ok: false, error: 'Unsupported format. Use JPG, PNG or WEBP.' };
        }
        if (Number(file.size) > MAX_BYTES) {
            return { ok: false, error: 'Image is larger than 10 MB.' };
        }
        return { ok: true };
    }

    /**
     * Decode a file into an <img>. Returns { img, url }. The caller owns the
     * object URL and MUST revoke it.
     */
    function loadImage(file) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () { resolve({ img: img, url: url }); };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('Could not decode this image.'));
            };
            img.src = url;
        });
    }

    function canvasToBlob(canvas, type) {
        var mime = type || 'image/png';
        return new Promise(function (resolve, reject) {
            if (typeof canvas.toBlob === 'function') {
                canvas.toBlob(function (blob) {
                    if (blob) resolve(blob);
                    else reject(new Error('Could not export the processed image.'));
                }, mime);
                return;
            }
            try {
                var data = canvas.toDataURL(mime);
                var binary = atob(data.split(',')[1]);
                var bytes = new Uint8Array(binary.length);
                for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                resolve(new Blob([bytes], { type: mime }));
            } catch (e) {
                reject(e);
            }
        });
    }

    // -- Pixel analysis ---------------------------------------------------
    function sampleCorners(data, w, h) {
        var pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
        return pts.map(function (p) {
            var i = (p[1] * w + p[0]) * 4;
            return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
        });
    }

    function isBackgroundPixel(r, g, b, a, bg, tol) {
        if (a <= ALPHA_BG) return true;             // transparent
        if (!bg) return false;                      // nothing to compare against
        return bg.a >= CORNER_OPAQUE &&
            Math.abs(r - bg.r) <= tol &&
            Math.abs(g - bg.g) <= tol &&
            Math.abs(b - bg.b) <= tol;
    }

    /**
     * Detect the background (transparent OR solid corner colour) and find the
     * bounding box of the actual product pixels.
     */
    function analyzePixels(data, w, h, options) {
        var tol = Number(options && options.trimTolerance);
        if (!isFinite(tol) || tol < 0) tol = 28;

        var corners = sampleCorners(data, w, h);
        var transparent = corners.every(function (c) { return c.a <= ALPHA_BG; });
        var solid = false;
        var bg = null;

        if (!transparent) {
            var first = corners[0];
            solid = corners.every(function (c) {
                return c.a >= CORNER_OPAQUE &&
                    Math.abs(c.r - first.r) <= tol &&
                    Math.abs(c.g - first.g) <= tol &&
                    Math.abs(c.b - first.b) <= tol;
            });
            if (solid) bg = { r: first.r, g: first.g, b: first.b, a: 255 };
        }

        // Bounding box of non-background pixels. Fall back to the full frame
        // when the whole image looks like background (or nothing is uniform).
        var minX = w, minY = h, maxX = -1, maxY = -1;
        if (transparent || solid) {
            for (var y = 0; y < h; y++) {
                var row = y * w * 4;
                for (var x = 0; x < w; x++) {
                    var i = row + x * 4;
                    if (!isBackgroundPixel(data[i], data[i + 1], data[i + 2], data[i + 3], bg, tol)) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
        }

        var box;
        if (maxX >= minX && maxY >= minY) {
            box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
        } else {
            box = { x: 0, y: 0, w: w, h: h };
        }

        return {
            width: w,
            height: h,
            solidBackground: solid,
            transparentBackground: transparent,
            backgroundColor: bg,
            contentBox: box,
            trimmedWidth: box.w,
            trimmedHeight: box.h,
            sourceAspect: box.w / box.h
        };
    }

    /** Knock out a solid colour using a tolerance, in place. */
    function removeBackgroundColor(ctx, w, h, bg, tol) {
        if (!bg) return;
        var imageData;
        try { imageData = ctx.getImageData(0, 0, w, h); } catch (e) { return; }
        var d = imageData.data;
        for (var i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 0) continue;
            if (Math.abs(d[i] - bg.r) <= tol &&
                Math.abs(d[i + 1] - bg.g) <= tol &&
                Math.abs(d[i + 2] - bg.b) <= tol) {
                d[i + 3] = 0;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // -- Composition ------------------------------------------------------
    function composeCanvas(source, srcW, srcH, aspect, fitMode, maxSide) {
        var ratio = aspect > 0 ? aspect : (srcW / srcH);
        var outW, outH;

        // Start from a box that keeps the product at (at least) its pixel size,
        // then clamp the longest side to maxSide.
        if (ratio >= 1) {
            outW = Math.max(srcW, srcH * ratio);
            outH = outW / ratio;
        } else {
            outH = Math.max(srcH, srcW / ratio);
            outW = outH * ratio;
        }
        var scale = Math.min(1, maxSide / Math.max(outW, outH));
        outW = Math.max(1, Math.round(outW * scale));
        outH = Math.max(1, Math.round(outH * scale));

        var canvas = makeCanvas(outW, outH);
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, outW, outH);
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';

        if (fitMode === 'stretch') {
            ctx.drawImage(source, 0, 0, outW, outH);
        } else if (fitMode === 'cover') {
            var coverScale = Math.max(outW / srcW, outH / srcH);
            var cw = srcW * coverScale;
            var ch = srcH * coverScale;
            ctx.drawImage(source, (outW - cw) / 2, (outH - ch) / 2, cw, ch);
        } else {
            var scaleFit = Math.min(outW / srcW, outH / srcH);
            var fw = srcW * scaleFit;
            var fh = srcH * scaleFit;
            ctx.drawImage(source, (outW - fw) / 2, (outH - fh) / 2, fw, fh);
        }
        return canvas;
    }

    // -- Public: probe (fast structural analysis, no export) --------------
    function probeImage(file) {
        var check = validateFile(file);
        if (!check.ok) return Promise.reject(new Error(check.error));

        return loadImage(file).then(function (loaded) {
            var img = loaded.img;
            try {
                var natW = img.naturalWidth || img.width;
                var natH = img.naturalHeight || img.height;
                if (!natW || !natH) throw new Error('Image has no pixels.');

                var work = fitWithin(natW, natH, 512);
                var canvas = makeCanvas(work.width, work.height);
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, work.width, work.height);
                var data = ctx.getImageData(0, 0, work.width, work.height).data;
                var analysis = analyzePixels(data, work.width, work.height, {});
                canvas.width = canvas.height = 0;

                return {
                    width: natW,
                    height: natH,
                    aspect: natW / natH,
                    solidBackground: analysis.solidBackground,
                    transparentBackground: analysis.transparentBackground,
                    backgroundColor: analysis.backgroundColor
                };
            } finally {
                URL.revokeObjectURL(loaded.url);
            }
        });
    }

    // -- Public: the main pipeline ----------------------------------------
    function processProductImage(file, markingArea, options) {
        options = options || {};
        var check = validateFile(file);
        if (!check.ok) return Promise.reject(new Error(check.error));

        var maxSide = Number(options.maxSide) > 0 ? Number(options.maxSide) : MAX_SIDE;
        var fitMode = normalizeFit(options.fitMode);
        var padRatio = (options.padding == null) ? 0.02 : clamp(options.padding, 0, 0.25);

        return loadImage(file).then(function (loaded) {
            var img = loaded.img;
            var workCanvas = null;
            var cropCanvas = null;
            try {
                var natW = img.naturalWidth || img.width;
                var natH = img.naturalHeight || img.height;
                if (!natW || !natH) throw new Error('Image has no pixels.');

                // 1. Downscale into a working canvas (also caps getImageData cost).
                var work = fitWithin(natW, natH, maxSide);
                workCanvas = makeCanvas(work.width, work.height);
                var wctx = workCanvas.getContext('2d');
                if ('imageSmoothingQuality' in wctx) wctx.imageSmoothingQuality = 'high';
                wctx.drawImage(img, 0, 0, work.width, work.height);

                // 2. Analyse + trim to the content bounding box.
                var data = wctx.getImageData(0, 0, work.width, work.height).data;
                var analysis = analyzePixels(data, work.width, work.height, options);
                analysis.sourceWidth = natW;
                analysis.sourceHeight = natH;
                analysis.markingAspect = safeAspect(markingAspectOf(markingArea), analysis.sourceAspect);
                if (typeof options.onAnalyze === 'function') {
                    try { options.onAnalyze(analysis); } catch (e) { /* non-fatal */ }
                }

                var box = analysis.contentBox;
                var pad = Math.round(Math.min(work.width, work.height) * padRatio);
                var sx = Math.max(0, box.x - pad);
                var sy = Math.max(0, box.y - pad);
                var sw = Math.min(work.width - sx, box.w + pad * 2);
                var sh = Math.min(work.height - sy, box.h + pad * 2);
                if (!(sw > 0) || !(sh > 0)) { sx = 0; sy = 0; sw = work.width; sh = work.height; }

                cropCanvas = makeCanvas(sw, sh);
                var cctx = cropCanvas.getContext('2d');
                if ('imageSmoothingQuality' in cctx) cctx.imageSmoothingQuality = 'high';
                cctx.drawImage(workCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

                // 3. Optional solid-background removal.
                if (options.removeBackground && analysis.backgroundColor) {
                    var colorTol = Number(options.colorTolerance);
                    if (!isFinite(colorTol) || colorTol < 0) colorTol = 32;
                    removeBackgroundColor(cctx, sw, sh, analysis.backgroundColor, colorTol);
                }

                // 4. Fit to the marking area and export as a transparent PNG.
                //    Retry at a smaller size when the PNG would exceed the
                //    server's upload limit (PHP often allows only 2 MB).
                var aspect = analysis.markingAspect || (sw / sh);
                var budget = Number(options.targetBytes) > 0
                    ? Number(options.targetBytes) : TARGET_BYTES;

                function exportAt(side) {
                    var outCanvas = composeCanvas(cropCanvas, sw, sh, aspect, fitMode, side);
                    return canvasToBlob(outCanvas, 'image/png').then(function (blob) {
                        outCanvas.width = outCanvas.height = 0;
                        return blob;
                    });
                }

                function attempt(side) {
                    return exportAt(side).then(function (blob) {
                        if (blob.size <= budget || side <= MIN_SIDE) return blob;
                        var next = Math.max(MIN_SIDE, Math.round(side * Math.sqrt(budget / blob.size) * 0.9));
                        if (next >= side) next = Math.round(side * 0.75);
                        if (next >= side) return blob;
                        return attempt(next);
                    });
                }

                return attempt(maxSide);
            } finally {
                URL.revokeObjectURL(loaded.url);
                if (workCanvas) workCanvas.width = workCanvas.height = 0;
                if (cropCanvas) cropCanvas.width = cropCanvas.height = 0;
            }
        });
    }

    global.ImageProcessor = {
        ALLOWED_MIME: ALLOWED_MIME.slice(),
        MAX_BYTES: MAX_BYTES,
        MAX_SIDE: MAX_SIDE,
        validateFile: validateFile,
        probeImage: probeImage,
        processProductImage: processProductImage,
        markingAspectOf: markingAspectOf,
        safeAspect: safeAspect
    };
})(window);
