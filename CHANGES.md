# Changes — Fullscreen Parity + Per-Background Products + Clean API

## TL;DR

1. **Fullscreen now matches the settings page exactly.** Placement is stored only
   as percentages of the *rendered background image box*, and **one shared
   renderer** (`js/pv_render.js`) draws both the editor and the fullscreen viewer.
2. **Products are assigned per background** through a new `background_products`
   table. A door can sit on many rooms, each with its own placement.
3. **A clean, versioned JSON API** (`/api/v1/…`) is ready for the Android app,
   documented in `API.md`.

---

## What changed, file by file

### Database
- **`db/migrations/20261114_background_products.sql`** — reference DDL: adds
  `image_width`/`image_height` to `backgrounds` and `products`, and creates the
  `background_products` mapping table.
- **`db/migrate_to_background_products.php`** — idempotent migration runner. It
  adds the columns/table only if missing, backfills natural image sizes with
  `getimagesize()`, and **copies every legacy placement** from the old
  `marking_*_percent` columns into `background_products` with `INSERT IGNORE`
  (no saved placement is lost, safe to re-run). **Already run:** 12 legacy
  placements migrated, 6 backgrounds + 12 products sized.

### API (new, versioned)
- **`api/v1/index.php`** — the v1 router/controller:
  - `GET  /api/v1/backgrounds`
  - `GET  /api/v1/backgrounds/{id}/products`
  - `GET  /api/v1/products` and `GET /api/v1/products/{id}`
  - `POST /api/v1/backgrounds/{id}/products` (assign / upsert placement)
  - `PUT  /api/v1/backgrounds/{id}/products/{productId}` (update)
  - `DELETE /api/v1/backgrounds/{id}/products/{productId}` (unassign, soft delete)
  - Absolute image URLs, CORS, 2-decimal placement values, bounds validation
    (422 on violation), consistent error envelope.
- **`api/v1/.htaccess`** — pretty URLs via `mod_rewrite`; the same routes also
  work as `/api/v1/index.php/...` when rewrite is off.
- **`API.md`** — full documentation + placement math for the Android agent.

### Shared renderer (the parity fix)
- **`js/pv_render.js`** — `PVRender.computeFit/buildStage/placementStyle/
  fitStageToHost/renderScene`. It letterboxes a *stage* with the background's
  aspect ratio, then places product boxes at `x% / y% / w% / h%` of that stage.
  Used by **both** the editor and the fullscreen viewer, so they cannot diverge.
- **`css/style.css`** — styles for `.pv-stage`, `.pv-product-box`,
  editor-only outlines/handles (hidden in fullscreen), the assignment list, and
  the new center-panel layout.

### Settings page (Goal 2 workflow)
- **`index.html`** — rebuilt center panel (single shared stage), rebuilt Products
  panel (per-background assignment checklist with checkboxes and a remove
  button), added a "Lock product aspect ratio while resizing" toggle and a
  "Remove from this background" button.
- **`js/script.js`** — rewritten to:
  - load backgrounds and products from `/api/v1`,
  - assign/unassign a product to the selected background (per-background),
  - drag/resize the selected product **in percentage space**, with live numeric
    inputs and aspect-ratio lock,
  - save via `PUT /api/v1/backgrounds/{id}/products/{productId}`,
  - render through `PVRender` (same code as fullscreen).

### Fullscreen viewer
- **`product_viz.html`** + **`js/product_viz.js`** — rewritten to render through
  `PVRender` from `/api/v1` data, still following `api/state.php` for the Android
  remote and `pc_remote_nav.js` for navigation.
- **`product_viz.html`** letterboxes the stage (`contain`) and never crops.

### Uploads (keep data consistent)
- **`api/backgrounds.php`** — records natural `image_width/height` on upload;
  background deletion no longer cascades away products that are shared with other
  backgrounds (it re-points them and only deletes truly orphaned ones).
- **`api/products.php`** — records natural `image_width/height` and **auto-assigns**
  a freshly uploaded product to its background with a sensible default placement.

### Config
- **`api/config.php`** — `BASE_URL` is now CLI-safe (falls back to `localhost`
  when `HTTP_HOST` is absent, e.g. when running the migration from PHP CLI).

---

## Test checklist

### A. Fullscreen parity (Goal 1)
- [ ] Open the settings page, assign a product to a background, set
      **X 40.60, Y 5.50, W 18.80, H 77.20**, click **Save Changes**.
- [ ] Click **Fullscreen**. The door is at the identical spot on the background.
- [ ] Resize the browser / use DevTools device mode (phone portrait, tablet,
      landscape, 4K). The door stays on the same relative spot; background is
      letterboxed, never cropped or stretched; door never distorted.
- [ ] Open `product_viz.html?id=<productId>` (or via the remote). Same result.
- [ ] Confirm no red border, no resize handles, no rulers in fullscreen.
- [ ] (Proven) Unit test: the placement math yields `40.6 / 5.5 / 18.8 / 77.2`
      at 320×568, 768×1024, 1366×768, 1920×1080, 3840×2160, 1024×768.

### B. Per-background assignment (Goal 2)
- [ ] Assign product A to background 1. It appears only on background 1.
- [ ] Switch to background 2 → product A is **not** shown there.
- [ ] Tick product A on background 2 → now it exists on both, each with its own
      placement.
- [ ] "Remove from this background" removes it from the current background only;
      it still exists on the other background and in the catalog.
- [ ] Uploading a new product auto-assigns it to the current background.
- [ ] Save validation: entering X+W > 100 is clamped in the editor and rejected
      by the API (422).

### C. API (Goal 3)
- [ ] `GET /api/v1/backgrounds` returns `product_count` per background.
- [ ] `GET /api/v1/backgrounds/2/products` returns only background 2's products.
- [ ] `GET /api/v1/products/{id}` returns details + all placements.
- [ ] `POST /api/v1/backgrounds/1/products` with the acceptance values returns
      `{"ok":true,...,"placement":{"x":40.6,"y":5.5,"w":18.8,"h":77.2,...}}`.
- [ ] Posting an out-of-bounds placement returns **422**.
- [ ] `DELETE` unassigns without deleting the product globally.
- [ ] Both `/api/v1/backgrounds` and `/api/v1/index.php/backgrounds` respond.

### D. Regressions
- [ ] `individual-product.html?id=<id>` still loads product details.
- [ ] Android remote Prev/Next, Details/Visualize still work (`state.php`).
- [ ] Re-running `db/migrate_to_background_products.php` changes nothing (idempotent).

---

## Notes for the Android agent

The placement contract is in **`API.md` → "Placement math"**. In short: fit the
background with `contain` into a stage that has the background's aspect ratio,
then position each product as percentages of that stage with the image in
`FIT_CENTER` and `padding%` of the box width applied on all sides. Order by
`z_index`. That reproduces the web output pixel-for-pixel at any resolution.