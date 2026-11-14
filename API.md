# Product Placement Visualizer — API v1

Versioned JSON API for the web editor and the Android app.
Base URL (LAN example): `http://192.168.0.113/product_presenter/api/v1`

- **CORS:** enabled for all origins (`Access-Control-Allow-Origin: *`).
- **Content type:** `application/json; charset=utf-8`.
- **Image URLs:** always **absolute**.
- **Placement numbers:** always **2-decimal** fixed (`40.6`, `5.5`, `18.8`, `77.2`, `0`).
- **Auth:** unchanged. If the server sets a non-empty `PV_TOKEN`, **POST / PUT / DELETE** require the header `X-PV-Token: <token>`. GET is never gated.
- **Routing:** both `/api/v1/backgrounds` and `/api/v1/index.php/backgrounds` work (the latter is used when `mod_rewrite` is unavailable).

---

## Placement math (read this before rendering on Android)

A placement is stored **only** as percentages of the **rendered background image box**, never as pixels.

```
x, y          top-left corner of the product box      (% of background width/height)
w, h          size of the product box                 (% of background width/height)
padding       inset of the product image inside box   (% of box WIDTH, all four sides)
z_index       stacking order (higher = on top)
```

Render order (identical to the web viewer, `js/pv_render.js`):

1. **Fit the background (contain).** Compute the largest rectangle with the
   background's aspect ratio (`image_width / image_height`) that fits the screen,
   centred, letterboxed. Call this the **stage**. Never crop, never stretch.
2. **Draw the background** filling the whole stage.
3. **For each product**, place a box at:
   - `left   = x%` of stage width
   - `top    = y%` of stage height
   - `width  = w%` of stage width
   - `height = h%` of stage height
   - inset the image by `padding%` of the **box width** on all four sides
   - draw the product image with **`object-fit: contain`** (keep its own aspect
     ratio; never distort).

Because step 1 pins the stage to the background's aspect ratio, and step 3 uses
percentages **of that stage**, the product lands on the exact same relative spot
at any resolution. A 320 px phone preview and a 3840 px TV show the same scene.

**Validation rule (rejected with HTTP 422 otherwise):**
`x ≥ 0`, `y ≥ 0`, `w > 0`, `h > 0`, `x + w ≤ 100`, `y + h ≤ 100`, `padding ≥ 0`.

---

## Endpoints

### 1. `GET /backgrounds`

```json
[
  {
    "id": 9,
    "name": "living-room5",
    "image_url": "http://192.168.0.113/product_presenter/uploads/backgrounds/a0d1ae239f79342e.png",
    "image_width": 1920,
    "image_height": 1080,
    "product_count": 2
  }
]
```

`product_count` counts **active assignments** (products placed on this background).

---

### 2. `GET /backgrounds/{id}/products`

Only products **assigned to that background and active** are returned.

```json
{
  "background": {
    "id": 9,
    "name": "living-room5",
    "image_url": "http://192.168.0.113/product_presenter/uploads/backgrounds/a0d1ae239f79342e.png",
    "image_width": 1920,
    "image_height": 1080
  },
  "products": [
    {
      "product_id": 46,
      "name": "218",
      "description": "CERTIFIED SERIES",
      "image_url": "http://192.168.0.113/product_presenter/uploads/products/577c8be778cd96cc.png",
      "image_width": 350,
      "image_height": 750,
      "details": [
        {
          "id": 15,
          "type": "feature",
          "label": "Size",
          "value": "Door Size: Height – 7 feet , Width – 2.5/3/3.5 feet.",
          "display_order": 0,
          "sticker_image_url": "http://192.168.0.113/product_presenter/uploads/stickers/6846f9543e8ae.png",
          "sticker_position": "top-right"
        }
      ],
      "placement": { "x": 40.6, "y": 5.5, "w": 18.8, "h": 77.2, "padding": 0, "z_index": 0 }
    }
  ]
}
```

---

### 3. `GET /products`

Full catalog, plus which backgrounds each product is assigned to.

```json
{
  "products": [
    {
      "id": 46,
      "name": "218",
      "description": "CERTIFIED SERIES",
      "image_url": "http://192.168.0.113/product_presenter/uploads/products/577c8be778cd96cc.png",
      "image_width": 350,
      "image_height": 750,
      "background_ids": [9],
      "created_at": "2025-06-09 15:18:20"
    }
  ],
  "count": 12
}
```

---

### 4. `GET /products/{id}`

Full product details and **every** placement it has.

```json
{
  "id": 28,
  "name": "301",
  "description": "",
  "image_url": "http://192.168.0.113/product_presenter/uploads/products/ee01788e7c5f187f.png",
  "image_width": 350,
  "image_height": 750,
  "created_at": "2025-05-31 02:33:29",
  "updated_at": "2026-11-14 08:35:35",
  "details": [],
  "placements": [
    {
      "background_id": 1,
      "background_name": "living-room01",
      "background_image_url": "http://192.168.0.113/product_presenter/uploads/backgrounds/11fd99fb3e769aa8.png",
      "background_width": 1920,
      "background_height": 1080,
      "placement": { "x": 40.6, "y": 5.5, "w": 18.8, "h": 77.2, "padding": 0, "z_index": 0 }
    }
  ]
}
```

---

### 5. `POST /backgrounds/{id}/products` — assign or update a placement

Body (JSON):

```json
{ "product_id": 28, "x": 40.6, "y": 5.5, "w": 18.8, "h": 77.2, "padding": 0, "z_index": 0 }
```

Response:

```json
{
  "ok": true,
  "background_id": 1,
  "product_id": 28,
  "placement": { "x": 40.6, "y": 5.5, "w": 18.8, "h": 77.2, "padding": 0, "z_index": 0 },
  "is_active": true
}
```

Idempotent: repeating the call updates the existing assignment (UNIQUE
`background_id, product_id`). Invalid placement → **422** with
`{ "ok": false, "error": { "code": "invalid_placement", "message": "..." } }`.

---

### 6. `PUT /backgrounds/{id}/products/{productId}` — update placement fields

Same body as POST (all fields optional; omitted fields keep their value).

---

### 7. `DELETE /backgrounds/{id}/products/{productId}` — remove from this background

Soft-deletes the assignment (`is_active = 0`). **The product itself is kept** and
remains on any other backgrounds it was assigned to.

```json
{ "ok": true, "background_id": 1, "product_id": 28, "unassigned": true }
```

---

## Error envelope

```json
{ "ok": false, "error": { "code": "not_found", "message": "Background not found." } }
```

| HTTP | code | meaning |
|------|------|---------|
| 400 | `bad_request` | missing/invalid field |
| 401 | `unauthorized` | `PV_TOKEN` configured and header missing/wrong |
| 404 | `not_found` | unknown background/product/placement |
| 422 | `invalid_placement` | violates the bounds rule |
| 500 | `server_error` | database/server failure |

---

## Android quick-start

```kotlin
// 1. Rooms list
GET  /api/v1/backgrounds

// 2. Products on a room (already sorted by z_index, sort_order)
GET  /api/v1/backgrounds/9/products

// 3. Product details for a "view details" screen
GET  /api/v1/products/46

// 4. (admin) move a door
POST /api/v1/backgrounds/9/products
     {"product_id":46,"x":40.6,"y":5.5,"w":18.8,"h":77.2,"padding":0,"z_index":0}
```

To draw a scene on Android:

1. Decode the background; compute its aspect ratio from `image_width/image_height`.
2. Lay out a `FrameLayout` (the **stage**) inside your screen with that aspect
   ratio, centred (letterbox the rest). This is your coordinate space.
3. For each product, add an `ImageView` sized/positioned as percentages of the
   stage, using `scaleType = FIT_CENTER` (the native equivalent of
   `object-fit: contain`), and apply the `padding` inset.
4. Order children by `z_index`.

---

## Database model (for reference)

`background_products` is the mapping table (one row per background+product):

| column | type | notes |
|--------|------|-------|
| id | INT PK | |
| background_id | INT FK → backgrounds | ON DELETE CASCADE |
| product_id | INT FK → products | ON DELETE CASCADE |
| x_percent, y_percent, w_percent, h_percent, padding_percent | DECIMAL(5,2) | placement |
| z_index | INT | stacking |
| sort_order | INT | ordering in lists |
| is_active | TINYINT(1) | soft delete / visibility |
| created_at, updated_at | TIMESTAMP | |

`UNIQUE(background_id, product_id)` prevents duplicate assignments.
Product **details** (`product_details`) stay linked to the product, never to the
placement.