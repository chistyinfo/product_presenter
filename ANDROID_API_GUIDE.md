# product_presenter — Android API Integration Guide

This document is the contract for the Android client. It was written **after** the API
was audited and completed, and every endpoint below was verified with real HTTP calls
(returning valid JSON with the documented status codes).

---

## 1. Base URL & environment

The server is a standard Apache + PHP app (PHP 7.1.9). The API lives in `/product_presenter/api/`.

| Environment | Base URL |
|---|---|
| Emulator (host loopback) | `http://10.0.2.2/product_presenter/api/` |
| Physical device on same Wi-Fi (LAN) | `http://192.168.0.113/product_presenter/api/` |
| Local machine | `http://localhost/product_presenter/api/` |

> **IMPORTANT — image URLs are host-relative.**
> Every `imageUrl` is generated on the server from the incoming request's `Host` header
> (e.g. `http://192.168.0.113/product_presenter/uploads/backgrounds/xxxx.png`).
> Therefore the client **must call the API using the same host it wants to download images from.**
> If you call via `192.168.0.113`, the images will be `http://192.168.0.113/...` and will work
> from the device. Do not rewrite hosts client-side; just pick the correct base URL once.

### Android cleartext-HTTP requirement
The API is plain **HTTP** (not HTTPS). Android 9+ blocks cleartext by default. Add one of:

`AndroidManifest.xml` (application tag):
```xml
<application android:usesCleartextTraffic="true" ... >
```
or a network security config (`res/xml/network_security_config.xml`):
```xml
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">192.168.0.113</domain>
    <domain includeSubdomains="true">10.0.2.2</domain>
    <domain includeSubdomains="true">localhost</domain>
  </domain-config>
</network-security-config>
```

---

## 2. Common conventions (apply to every endpoint)

- **Response content type:** `application/json; charset=utf-8`
- **CORS:** `Access-Control-Allow-Origin: *`, methods `GET, POST, PUT, DELETE, OPTIONS`,
  allowed headers `Content-Type, Authorization, X-PV-Token`. (CORS is irrelevant to native
  Android, but `OPTIONS` preflight returns `200`.)
- **Character set:** all text is UTF-8.
- **PHP notices/warnings are suppressed** in API output (logged server-side instead), so
  responses are always clean JSON.

### 2.1 Error envelope (all NEW endpoints)
On any non-2xx response the body is:
```json
{ "ok": false, "error": { "code": "not_found", "message": "Human readable message" } }
```

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `bad_request` | Missing/invalid parameters or body |
| 401 | `unauthorized` | `X-PV-Token` required but missing/wrong (POST only) |
| 404 | `not_found` | Resource does not exist |
| 405 | `method_not_allowed` | Wrong HTTP verb for that route |
| 500 | `server_error` | Unexpected server failure |

> Note: two **legacy** web-UI endpoints (`backgrounds.php` and the legacy `products.php`
> routes) still return the older shape `{"error":"..."}` instead of the envelope. See each
> endpoint's note. New code (`ping`, `rooms`, `state`, and the products full-catalog call)
> uses the envelope above. Parse both defensively: if a body has `error.code` use it, else
> read the string `error`.

### 2.2 Optional authentication (`X-PV-Token`)
- A server-side constant `PV_TOKEN` in `api/config.php` controls auth.
- **Default is empty → all requests allowed** (current state of this server).
- When an admin sets it to a non-empty value:
  - It is checked **only on `POST` requests**.
  - Header required: `X-PV-Token: <token>`.
  - Missing/wrong → `401 {"ok":false,"error":{"code":"unauthorized","message":"A valid X-PV-Token header is required."}}`
- **GET requests never require a token.**

**Recommendation:** expose a build-config flag `PV_TOKEN`. If set, send it on every POST.

---

## 3. Endpoints

### 3.1 `GET ping.php` — health check
Detects reachability / API version. No DB dependency.

- **Method:** GET (only; others → 405 with envelope)
- **URL:** `{base}/ping.php`
- **Response 200:**
```json
{ "ok": true, "app": "product_presenter", "version": 1, "time": "2026-11-07T15:47:23+00:00" }
```
| Field | Type | Notes |
|---|---|---|
| `ok` | bool | always `true` on success |
| `app` | string | always `"product_presenter"` |
| `version` | int | API contract version (currently `1`) |
| `time` | string | ISO-8601 UTC (`gmdate('c')`) — optional/extra |

Use this on app start / settings screen to validate the Base URL.

---

### 3.2 `GET rooms.php` — list rooms (backgrounds)
A "room" is a background row. Returns all rooms **without** nested products.

- **Method:** GET (others → 405)
- **URL:** `{base}/rooms.php`
- **Response 200:**
```json
{
  "rooms": [
    {
      "id": 9,
      "name": "living-room5",
      "image_filename": "a0d1ae239f79342e.png",
      "imageUrl": "http://192.168.0.113/product_presenter/uploads/backgrounds/a0d1ae239f79342e.png",
      "marking_top_percent": "5.40",
      "marking_left_percent": "46.10",
      "marking_width_percent": "18.80",
      "marking_height_percent": "77.20",
      "marking_padding_percent": "0.00",
      "created_at": "2025-06-09 19:23:54",
      "updated_at": "2026-11-07 13:37:55",
      "product_count": 2
    }
  ]
}
```

**Room object = a `Room` model on Android:**

| Field | Type | Notes |
|---|---|---|
| `id` | int | primary key |
| `name` | string | display name |
| `image_filename` | string | raw filename (rarely needed) |
| `imageUrl` | string | **absolute URL** to load the background image |
| `marking_top_percent` | string(decimal) | 0–100, **comes as a string** e.g. `"5.40"` |
| `marking_left_percent` | string(decimal) | 0–100 |
| `marking_width_percent` | string(decimal) | 1–100 |
| `marking_height_percent` | string(decimal) | 1–100 |
| `marking_padding_percent` | string(decimal) | 0–50 |
| `created_at` | string | `YYYY-MM-DD HH:MM:SS` (server time) |
| `updated_at` | string | `YYYY-MM-DD HH:MM:SS` |
| `product_count` | int | number of products attached |

> **Marking area:** `marking_*_percent` describe a rectangle **as percentages** of the
> background image, used to place a product. Convert to pixels with:
> `x = marking_left_percent/100 * imageWidth`, etc. Always parse these as `float`
> (they arrive as strings — do **not** bind directly to an `Int` field in Gson/Moshi).

---

### 3.3 `GET products.php` — products (three modes)

`products.php` is polymorphic. Choose the mode that fits:

#### Mode A — Full catalog (NEW): `GET {base}/products.php`
Returns every product across all rooms.
- **Response 200:**
```json
{
  "products": [ { ...product... }, ... ],
  "count": 11
}
```
- Use this to pre-cache / search everything.

#### Mode B — By room (legacy, web UI): `GET {base}/products.php?background_id={id}`
Returns a **plain JSON array** of that room's products (no wrapper).
- **Response 200:** `[ { ...product... }, ... ]`
- If the room does not exist → `404 {"error":"Background not found"}` (legacy shape).

#### Mode C — Single product (legacy): `GET {base}/products.php/{id}`
Returns one product object.
- **Response 200:** `{ ...product... }`
- Not found → `404 {"error":"Product not found"}` (legacy shape).

**Product object = `Product` model:**

| Field | Type | Notes |
|---|---|---|
| `id` | int | primary key |
| `background_id` | int | owning room id |
| `name` | string | display name |
| `description` | string | may be empty/null |
| `image_filename` | string | raw filename |
| `imageUrl` | string | **absolute URL** to load the product image |
| `created_at` | string | `YYYY-MM-DD HH:MM:SS` |
| `updated_at` | string | `YYYY-MM-DD HH:MM:SS` |

> **Parsing tip:** Modes A and B return the *same* product objects but differ in wrapper
> (`{products,count}` vs bare array). Point Retrofit at two different endpoints or parse
> the raw `ResponseBody` and branch on the first non-space char (`{` vs `[`).

> **Mutations (POST/PUT/DELETE)** exist for the web admin UI and require `multipart/form-data`
> for uploads. An Android *viewer* app does not need them; they are documented in code
> (`products.php`, `backgrounds.php`) if you later add admin features.

---

### 3.4 `GET / POST state.php` — single shared presentation state
Shared "current presentation" document stored in `api/data/state.json`. Use it to sync the
selected product + transform across devices.

**State object (`PresentationState`):**

| Field | Type | Default | Notes |
|---|---|---|---|
| `rev` | int | 0 | monotonically increasing revision; bumps on each POST |
| `product_id` | int \| null | null | selected product id |
| `room` | string \| null | null | room name (or id-as-string) |
| `scale` | number | 1 | product scale factor |
| `x` | number | 0 | horizontal position (0..1 normalized) |
| `y` | number | 0 | vertical position (0..1 normalized) |
| `flip` | bool | false | mirror the product |
| `updated_at` | string \| null | null | ISO-8601 UTC set by server on each POST |

#### `GET {base}/state.php`
- **Response 200:** the current state object (example):
```json
{ "rev":1, "product_id":28, "room":"living-room01", "scale":1, "x":0.79, "y":0.56, "flip":false, "updated_at":"2026-11-07T15:32:37+00:00" }
```

#### `POST {base}/state.php`
Applies a **partial update** (send any subset of fields). Server merges, bumps `rev`,
sets `updated_at`, persists, and returns the **new full state**.

- **Headers:** `Content-Type: application/json` (recommended) and `X-PV-Token` **only if configured**.
- **Body (all fields optional):**
```json
{ "product_id": 47, "room": "living-room5", "scale": 1.2, "x": 0.33, "y": 0.42, "flip": true }
```
- **Response 200:** the updated state object:
```json
{ "rev":2, "product_id":47, "room":"living-room5", "scale":1.2, "x":0.33, "y":0.42, "flip":true, "updated_at":"2026-11-07T15:45:46+00:00" }
```

Field handling rules:
- `product_id`: `null`/`""` clears it; number sets it.
- `room`: `null` clears; string sets.
- `scale`,`x`,`y`: only applied if numeric (otherwise ignored).
- `flip`: parsed as boolean (`true/false`, `1/0`, `"true"`).
- **Optimistic concurrency (optional):** include `"expected_rev": <int>`. If it does not equal
  the current `rev`, the server returns `400 bad_request` (conflict) and performs no change.
  Example conflict message: `"State revision conflict: expected_rev does not match the current revision."`
- `rev` and `updated_at` are **server-controlled**; do not send them.

- **Error responses:** `400 bad_request` (non-JSON body or rev conflict), `401 unauthorized`
  (token configured + missing/wrong), `405 method_not_allowed` (any verb other than GET/POST),
  `500 server_error` (disk write failure).

**Polling / sync pattern:** GET on open and after returning to foreground; POST on user change;
compare `rev` to detect remote updates from another device.

---

## 4. Endpoint summary

| Verb | Path | Auth | Success | Purpose |
|---|---|---|---|---|
| GET | `ping.php` | – | `{ok,app,version,time}` | health / base-url check |
| GET | `rooms.php` | – | `{rooms:[Room]}` | list rooms |
| GET | `products.php` | – | `{products:[Product],count}` | full catalog |
| GET | `products.php?background_id={id}` | – | `[Product]` | products in a room |
| GET | `products.php/{id}` | – | `Product` | single product |
| GET | `state.php` | – | `PresentationState` | read shared state |
| POST | `state.php` | token* | `PresentationState` | partial update + bump rev |
| OPTIONS | any | – | 200 | CORS preflight |

\* token only enforced when `PV_TOKEN` is configured on the server.

---

## 5. Suggested Retrofit setup (Kotlin)

```kotlin
// DTOs — note marking_* are String (decimals arrive as strings)
data class Room(
    val id: Int,
    val name: String,
    val image_filename: String?,
    val imageUrl: String,
    val marking_top_percent: String?,
    val marking_left_percent: String?,
    val marking_width_percent: String?,
    val marking_height_percent: String?,
    val marking_padding_percent: String?,
    val created_at: String?,
    val updated_at: String?,
    val product_count: Int
)

data class Product(
    val id: Int,
    val background_id: Int,
    val name: String,
    val description: String?,
    val image_filename: String?,
    val imageUrl: String,
    val created_at: String?,
    val updated_at: String?
)

data class RoomsResponse(val rooms: List<Room>)
data class ProductsResponse(val products: List<Product>, val count: Int)

data class PresentationState(
    val rev: Int,
    val product_id: Int?,
    val room: String?,
    val scale: Double,
    val x: Double,
    val y: Double,
    val flip: Boolean,
    val updated_at: String?
)

data class PingResponse(val ok: Boolean, val app: String, val version: Int, val time: String?)
data class ApiErrorEnvelope(val ok: Boolean, val error: ApiError)
data class ApiError(val code: String, val message: String)
```

```kotlin
interface PvApi {
    @GET("ping.php")    suspend fun ping(): PingResponse
    @GET("rooms.php")   suspend fun rooms(): RoomsResponse

    @GET("products.php")                        // Mode A full catalog
    suspend fun allProducts(): ProductsResponse

    @GET("products.php")                        // Mode B by room
    suspend fun productsByRoom(@Query("background_id") id: Int): List<Product>

    @GET("products.php/{id}")                   // Mode C single
    suspend fun product(@Path("id") id: Int): Product

    @GET("state.php")   suspend fun getState(): PresentationState

    @POST("state.php")  suspend fun updateState(
        @Header("X-PV-Token") token: String?,     // null-safe: omit when no token
        @Body patch: Map<String, @JvmSuppressWildcards Any?>
    ): PresentationState
}
```

### Error handling
Write a single parser: if `response.isSuccessful` decode the success type; else read the body
and try `ApiErrorEnvelope` first (`error.code`, `error.message`); if that fails, try the legacy
`{ "error": "..." }` root and use the string.

### Token interceptor (only relevant if PV_TOKEN is configured)
```kotlin
val client = OkHttpClient.Builder().addInterceptor { chain ->
    val b = chain.request().newBuilder()
    // Only POST needs the token; simplest is to add it to all requests.
    if (!PV_TOKEN.isNullOrEmpty()) b.header("X-PV-Token", PV_TOKEN)
    chain.proceed(b.build())
}.build()
```

---

## 6. Manual verification (cURL)

Replace host as needed (LAN = `192.168.0.113`).

```bash
# Health
curl http://192.168.0.113/product_presenter/api/ping.php

# Rooms
curl http://192.168.0.113/product_presenter/api/rooms.php

# Full catalog
curl http://192.168.0.113/product_presenter/api/products.php

# Products in room 8 (plain array)
curl "http://192.168.0.113/product_presenter/api/products.php?background_id=8"

# Single product
curl http://192.168.0.113/product_presenter/api/products.php/47

# State read
curl http://192.168.0.113/product_presenter/api/state.php

# State update (POST JSON) — add -H "X-PV-Token: ..." only if configured
curl -X POST -H "Content-Type: application/json" \
     -d '{"product_id":47,"room":"living-room5","x":0.33,"y":0.42,"flip":true}' \
     http://192.168.0.113/product_presenter/api/state.php
```

---

## 7. Gotchas / checklist

- [ ] Use matching host base URL so `imageUrl` downloads work from the device.
- [ ] Enable cleartext HTTP for that host (Android 9+).
- [ ] Parse `marking_*_percent` as **floats from strings**, not ints.
- [ ] Handle **both** error shapes: new envelope `{ok,error{code,message}}` and legacy `{error:"..."}`.
- [ ] Modes A/B/C of `products.php` differ in wrapper — parse accordingly.
- [ ] Token (`X-PV-Token`) is **POST-only** and only when the server enables it; GET never needs it.
- [ ] `state.php` POST returns the **full updated state** (use the returned `rev`).
- [ ] Timestamps from DB are `YYYY-MM-DD HH:MM:SS` (server local); `state.updated_at` is ISO-8601 UTC — keep them separate in your models.