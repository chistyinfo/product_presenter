# Prompt for the Android Studio Agent — DoorSoft PV Remote

**Paste everything below the line into the Android Studio AI agent.**
Dated **2026-11-13 22:25 (+06:00)**, updated **2026-11-13 23:15 (+06:00)**.
The web/server side is already deployed and verified; only the app changes are missing.

> **READ SECTION 0 FIRST.** It is a *newer* fix than the rest of this document and it is the
> one that makes the product details page actually follow the remote.

---

## 0. UPDATE 2 (2026-11-13 23:15) — Prev / Next must publish `product_id`, always

### What was broken

The PC has two pages and **both now follow `api/state.php`**:

- `product_viz.html` — always did.
- `individual-product.html?id=<id>` — **fixed today**. It now polls `api/state.php` every
  second and swaps in the product named by `state.product_id`. It also accepts an in-place
  `pvViewer.showProduct(id)` call.

So the rule on the app side is simple and unforgiving:

> **Every Prev / Next press must POST the new `product_id` to `api/state.php`, every time,
> including when the press happens while the PC is showing the details page.**

If a Prev / Next press only updates a local variable or a local list, the PC will not move.
That is exactly the reported bug: `individual-product.html?id=46` loaded fine, but pressing
**Prev** / **Next** on the phone changed nothing on the PC.

### 0.1 What to verify / change in the app

1. **Prev / Next must POST** — on every single press, no debounce that swallows repeats:

```kotlin
private fun sendProduct(productId: Int) {
    lifecycleScope.launch {
        try {
            // Same endpoint, same shape the app already uses for the transform.
            api.updateState(PV_TOKEN.takeIf { it.isNotBlank() }, mapOf("product_id" to productId))
            // Nothing navigates. Both PC pages follow state.product_id on their own.
        } catch (e: HttpException) {
            if (e.code() == 409) toast("PC not connected") else toast("Failed to reach PC")
        } catch (e: IOException) {
            toast("PC not connected")
        }
    }
}

fun onNextClicked() { sendProduct(nextProductId()) }   // +1 with wraparound
fun onPrevClicked() { sendProduct(prevProductId()) }   // -1 with wraparound
```

2. **Do not keep the "Now showing" label in a private list.** After every successful POST,
   bind the label to the `product_id` the server echoes back in the response — not to the
   value the app *intended* to send. The server is the single source of truth for both the
   phone's label and the PC's screen.

3. **`space` and `room` must stay out of a plain Prev / Next POST** unless the room genuinely
   changes. Sending `room` with every press makes the PC bounce between rooms.

4. **Details after Prev / Next must use the id the app is showing**, which is
   `state.product_id` from the latest response (see section 2). Never reuse an id captured
   when the Remote screen was opened.

5. **Details on an already-open details page no longer needs a page load.** The PC swaps the
   product in place, so the accepted behaviour is: no flash, no reload, no history entry.
   Do not "fix" that by adding a query parameter or a reload.

### 0.2 Why no new endpoint is needed

The details page runs the same 1 s poll as the visualizer:

```
GET  api/state.php                          -> { rev, product_id, room, ... }
POST api/state.php  {"product_id": 46}      -> bumps rev; both PC pages follow
POST api/state.php  {"nav":{"target":"details","product_id":46}}  -> switches PAGE
```

- **Prev / Next** → `{"product_id": N}` only. The page on screen stays the same page.
- **Details / Visualize** → `{"nav": {...}}` only. The page changes, the product does not.

### 0.3 Acceptance tests for this fix

| # | Action | Expected |
|---|---|---|
| 1 | PC on `individual-product.html?id=46`, phone shows 46 | both agree |
| 2 | Press **Next** on the phone | within ~1 s the PC details page shows the next product; URL becomes `?id=<new>` via `replaceState`; **no reload, no spinner** |
| 3 | Press **Prev** twice quickly | the PC ends on the correct product (only the newest response paints) |
| 4 | Press **Next** while the PC is on `product_viz.html` | the visualizer swaps product, details page (if closed) is untouched |
| 5 | Open `individual-product.html?id=46` by hand while the phone shows a different product, then press **Next** | the page follows the phone from that press onward (the deep link is not hijacked before it) |
| 6 | Close the PC browser, wait ~10 s, press **Next** | toast "PC not connected", `rev` unchanged, nothing jumps later |
| 7 | Press **Details** for the product already on screen | PC does not reload or flash |

---

## ROLE

You are working on the existing Android app **"DoorSoft PV remote"** in this repository.
This is a **maintenance change to an existing feature**, not a new app. Read the current
implementation of the Remote screen before writing code, then make the targeted changes below.

## CONTEXT — what the app already does (do not rebuild it)

The Remote screen shows **"Now showing 803"** with **Prev**, **Next**, **Details**,
**Visualize**, a **room selector**, **Scale**, **Position** controls, and a **"Live"**
connection indicator.

Prev / Next / Room / Scale / Position already drive the PC web app in real time by POSTing
to `api/state.php` and reading it back. **Keep using that same HTTP relay. Do not add
WebSockets, Firebase, MQTT, deep links, or any new channel.**

The PC web app lives at `http://192.168.0.113/product_presenter/` and has two pages:
- `product_viz.html` — the full-screen room visualizer
- `individual-product.html?id=<product_id>` — the product details page (e.g. `?id=37`)

## GOAL

Tapping **Details** on the phone must open the product details page **on the PC browser**.
Nothing opens or navigates on the phone; the app stays on the Remote screen.
**Visualize** must send the PC back to `product_viz.html`.

The server + PC listener are already implemented. The PC polls `api/state.php` every second
and navigates **by itself** when it sees a new `nav_seq`. The app's only job is to POST the
command.

## HARD CONSTRAINTS — read these twice

1. **Never call `startActivity`, `Intent.ACTION_VIEW`, `CustomTabsIntent`, or
   `WebView.loadUrl` from the Details or Visualize handlers.** The phone must not navigate.
2. **Do not create a new communication channel.** Use `POST api/state.php`.
3. **Do not POST `heartbeat` from the app.** Only the PC browser sends heartbeats. Posting it
   from the phone would make `pc_online` lie.
4. **Do not change** the existing Prev / Next / Room / Scale / Position POST bodies or
   behaviour. They must keep working exactly as they do today.
5. Only a short toast/message is allowed on failure. The screen stays put.

## API CONTRACT (already live — verified with real calls)

Base URL: `http://192.168.0.113/product_presenter/api/` (already configured in the app).

### GET `state.php` — new fields added

```json
{
  "rev": 617,
  "product_id": 37,
  "room": "living-room7",
  "scale": 0.9929162,
  "x": 0.09508112,
  "y": 0.487366,
  "flip": false,
  "nav_seq": 3,
  "nav_target": "details",
  "nav_product_id": 37,
  "updated_at": "2026-11-13T16:26:31+00:00",
  "pc_online": true,
  "pc_seen_at": "2026-11-13T16:26:31+00:00"
}
```

| Field | Type | Meaning |
|---|---|---|
| `rev` | int | unchanged behaviour |
| `product_id` | int\|null | the product currently showing on the PC |
| `room` | string\|null | the room **name** currently showing |
| `nav_seq` | int | server-controlled counter, +1 per nav command. **Never send it.** |
| `nav_target` | string\|null | last command: `"details"`, `"viz"` or `null` |
| `nav_product_id` | int\|null | product the last command referred to |
| `pc_online` | bool | **authoritative "is the PC connected?" flag** (heartbeat < 10 s old) |
| `pc_seen_at` | string\|null | ISO-8601 of the newest PC heartbeat; `null` = never seen |

### POST `state.php` — Details

```json
{ "nav": { "target": "details", "product_id": 37 } }
```

### POST `state.php` — Visualize

```json
{ "nav": { "target": "viz", "product_id": 37 } }
```

- `product_id` is optional; omit it and the server uses the current `state.product_id`.
- Success → **HTTP 200** with the full updated state (note `nav_seq` incremented).
- **HTTP 409** `{"ok":false,"error":{"code":"pc_offline","message":"..."}}`
  → the PC is not connected. **Nothing was stored**, so nothing will jump later.
  Show `"PC not connected"` and open nothing.
- **HTTP 400** `bad_request` → bad target / bad id. Show `"Invalid product for details"`.
- Auth: if a non-blank `PV_TOKEN` build flag exists, keep sending `X-PV-Token` on POST as today.

### GET `products.php?name=…` — name → id resolver (new, optional for you)

Only needed if a screen has the display **name** ("803") but no id.
**Names are NOT unique in this database** — "803" exists as id **37** (room `living-room01`)
and id **36** (room `3`). Always narrow by room when you can:

```http
GET products.php?name=803&room=living-room01      # room NAME, from state.room
GET products.php?name=803&background_id=1         # or the numeric room id
```

```json
{
  "products": [ { "id": 37, "background_id": 1, "name": "803", "description": "",
                  "image_filename": "590bf6801af63f6a.png", "...": "..." } ],
  "count": 1,
  "match": "exact",
  "query": "803",
  "ambiguous": false
}
```

Selection rule, in order:
1. `ambiguous == false && count == 1` → use `products[0].id`.
2. `ambiguous == true` → prefer the row whose `id` equals `state.product_id`.
3. Otherwise → show `"Product not found"` and **do not send** a nav command.

`match` is `"exact"` or `"contains"` (a `LIKE` fallback). A `contains` result with
`ambiguous: true` is a loose match — treat it as unreliable.

> Real data check: `?name=803` returns **2 rows** (`ambiguous: true`), while
> `?name=803&room=living-room01` returns exactly **1 row → id 37**. Use that to test.

## CHANGES TO MAKE

### 1. Extend the state model

All new fields **nullable with defaults**, so old/changed payloads still parse:

```kotlin
data class PresentationState(
    val rev: Int,
    val product_id: Int?,
    val room: String?,
    val scale: Double,
    val x: Double,
    val y: Double,
    val flip: Boolean,
    val updated_at: String?,
    val nav_seq: Int? = null,
    val nav_target: String? = null,
    val nav_product_id: Int? = null,
    val pc_online: Boolean? = null,
    val pc_seen_at: String? = null
)
```

### 2. Details button — replace the old handler

Find the current Details handler (it currently opens something on the phone — remove that).
It becomes:

```kotlin
// No Intent. No startActivity. The PC does the navigation.
fun onDetailsClicked() {
    val id = state.productId
        ?: resolveIdByName(state.productName, state.room, state.productId)
    if (id == null) { toast("Product not found"); return }
    sendNav("details", id)
}
```

### 3. Visualize button

```kotlin
fun onVisualizeClicked() {
    val id = state.productId
        ?: resolveIdByName(state.productName, state.room, state.productId)
    // id may be null: the server falls back to state.product_id
    sendNav("viz", id)
}
```

### 4. The shared sender

```kotlin
private fun sendNav(target: String, productId: Int?) {
    lifecycleScope.launch {
        try {
            val body = mapOf("nav" to mapOf("target" to target, "product_id" to productId))
            val newState = api.updateState(PV_TOKEN.takeIf { it.isNotBlank() }, body)
            Log.i("PV", "nav=$target id=$productId -> nav_seq=${newState.nav_seq}")
            // Success: the PC navigates within ~1 s. Stay on the Remote screen.
        } catch (e: HttpException) {
            when (e.code()) {
                409 -> toast("PC not connected")
                400 -> toast("Invalid product for details")
                else -> toast("Failed to reach PC")
            }
        } catch (e: IOException) {
            toast("PC not connected")
        }
    }
}
```

Optional: debounce the button ~1 s to avoid duplicate POSTs on a double tap. The server
deduplicates by `nav_seq` anyway, so this is polish, not correctness.

### 5. Name → id helper and Retrofit method

```kotlin
@GET("products.php")
suspend fun productsByName(
    @Query("name") name: String,
    @Query("room") room: String? = null,
    @Query("background_id") backgroundId: Int? = null
): ProductsByNameResponse

data class ProductsByNameResponse(
    val products: List<Product>,
    val count: Int,
    val match: String?,
    val ambiguous: Boolean
)

private suspend fun resolveIdByName(name: String?, room: String?, currentId: Int?): Int? {
    if (name.isNullOrBlank()) return null
    return try {
        val res = api.productsByName(name, room)
        when {
            !res.ambiguous && res.products.size == 1 -> res.products[0].id
            currentId != null && res.products.any { it.id == currentId } -> currentId
            else -> null
        }
    } catch (e: Exception) { null }
}
```

### 6. "Live" indicator — bind it to `pc_online` (recommended)

On the Remote screen, poll `state.php` every 2–3 s (the screen likely already does this):

- `pc_online == true` → show **"Live"**
- `pc_online == false` → show **"PC not connected"**
- Also use `pc_online` to grey out **Details** / **Visualize** while the PC is offline.
  The 409 toast is the safety net, not the primary signal.

## WHAT NOT TO TOUCH

- The Prev / Next / Room / Scale / Position POST bodies and their optimistic UI.
- The base URL / token configuration.
- Anything about image loading or the room thumbnails.

## ACCEPTANCE TESTS

Run with a browser showing `http://192.168.0.113/product_presenter/product_viz.html`
and the remote showing **803** (`state.product_id == 37`).

| # | Action | Expected |
|---|---|---|
| 1 | Open the Remote screen with the PC page open | Indicator reads **Live** |
| 2 | Tap **Details** | Within ~1 s the **PC browser** is on `individual-product.html?id=37`; the **phone stays on the Remote screen**; no browser/intent opens on the phone |
| 3 | Check the PC's Back button | One press leaves the presentation — history was not filled with details pages |
| 4 | `GET state.php` after step 2 | `nav_seq` increased by exactly 1, `nav_target == "details"` |
| 5 | Tap **Details** again for the same product | The PC does not reload or flash |
| 6 | Tap **Next** on the phone, then **Details** | The PC opens the details page for the **new** product's id (not 37) |
| 7 | Tap **Visualize** | The PC returns to `product_viz.html?id=<current>` |
| 8 | Close the PC browser, wait ~10 s, tap **Details** | Toast **"PC not connected"**; nothing navigates; `nav_seq` is **unchanged** |
| 9 | Re-open the PC browser | It loads cleanly and does **not** auto-jump to details (stale commands are ignored) |
| 10 | Use Prev / Next / Scale / Position after all of this | They still work exactly as before |

## TROUBLESHOOTING

| Symptom | Cause | Fix |
|---|---|---|
| PC never navigates | PC page has an old cached `pc_remote_nav.js` | hard-refresh the PC page (Ctrl+F5) |
| Phone always shows "PC not connected" | PC page closed, tab hidden >10 s, or `api/data/presence.json` not writable | keep the viz tab visible; check that file exists on the server |
| PC jumps to the **wrong** product | name-only lookup was ambiguous (803 exists twice) | pass `room`/`background_id`, or always use `state.product_id` |
| Details still opens on the **phone** | old handler branch not removed | delete the `Intent` / `startActivity` call entirely |
| `409` on every tap | `heartbeat` is being POSTed from the app | remove it — only the PC sends heartbeats |