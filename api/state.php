<?php
// api/state.php
// Persists a single "presentation state" document in api/data/state.json.
// Shape (matches the existing data/state.json):
//   { "rev":int, "product_id":int|null, "room":string|null,
//     "scale":number, "x":number, "y":number, "flip":bool,
//     "updated_at":ISO-8601|null }
//
// GET  -> returns the current state object, plus "pc_online"/"pc_seen_at"
//         describing whether the PC display is currently polling.
// POST -> applies a partial update (any subset of the fields above), bumps
//         `rev`, refreshes `updated_at`, writes atomically and returns the
//         new state. Optional X-PV-Token gate applies to POST only.
//
// Additive POST kinds used by the Android remote (see ANDROID_API_GUIDE.md):
//   {"nav":{"target":"details"|"viz","product_id":<id>}}
//       One-shot navigation command for the PC browser. Increments the
//       server-controlled `nav_seq` so the PC acts exactly once. Rejected with
//       409 `pc_offline` when no PC heartbeat is recent, and in that case
//       NOTHING is written (otherwise the PC would act the moment it returned).
//   {"heartbeat":true}
//       Sent by the PC browser so the phone can tell whether the display is
//       connected. Does NOT bump `rev` (a repeating beat must never disturb
//       the transform sync) and touches no presentation field.

require_once __DIR__ . '/api_helpers.php';

pv_send_cors();

$stateFile    = __DIR__ . '/data/state.json';
$presenceFile = __DIR__ . '/data/presence.json';

// How long a PC heartbeat stays valid. The PC beats every 3 s, so this
// tolerates two missed beats before the phone is told the display is gone.
if (!defined('PV_PC_ONLINE_WINDOW')) {
    define('PV_PC_ONLINE_WINDOW', 10);
}

/**
 * Load the persisted state, falling back to defaults when the file is absent
 * or unreadable/corrupt. Never throws.
 */
function pv_state_load($path) {
    $default = array(
        'rev'        => 0,
        'product_id' => null,
        'room'       => null,
        'scale'      => 1,
        'x'          => 0,
        'y'          => 0,
        'flip'           => false,
        'nav_seq'        => 0,
        'nav_target'     => null,
        'nav_product_id' => null,
        'updated_at'     => null
    );

    if (!is_file($path)) {
        return $default;
    }
    $raw = @file_get_contents($path);
    if ($raw === false || trim($raw) === '') {
        return $default;
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return $default;
    }

    // Merge onto defaults so missing keys are always present.
    return array_merge($default, $decoded);
}

/**
 * Unix timestamp of the newest PC heartbeat, or 0 when none is recorded.
 */
function pv_presence_seen_at($path) {
    if (!is_file($path)) {
        return 0;
    }
    $raw = @file_get_contents($path);
    if ($raw === false || trim($raw) === '') {
        return 0;
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded) || !isset($decoded['seen_at'])) {
        return 0;
    }
    return (int) $decoded['seen_at'];
}

/**
 * Record a PC heartbeat. Returns true when the file was written.
 */
function pv_presence_touch($path) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $payload = json_encode(array(
        'seen_at'     => time(),
        'seen_at_iso' => gmdate('c')
    ));
    if ($payload === false) {
        return false;
    }
    return @file_put_contents($path, $payload, LOCK_EX) !== false;
}

/**
 * Whether a PC display has heartbeated inside the tolerance window.
 */
function pv_pc_online($presencePath) {
    $seenAt = pv_presence_seen_at($presencePath);
    if ($seenAt <= 0) {
        return false;
    }
    return (time() - $seenAt) <= PV_PC_ONLINE_WINDOW;
}

/**
 * Decorate the stored state with the live PC-presence fields for output.
 * These are NOT persisted: they describe right now, not the presentation.
 */
function pv_state_with_presence($state, $presencePath) {
    $seenAt = pv_presence_seen_at($presencePath);
    $state['pc_online']  = pv_pc_online($presencePath);
    $state['pc_seen_at'] = $seenAt > 0 ? gmdate('c', $seenAt) : null;
    return $state;
}

/**
 * Create the data directory and persist the state document.
 */
function pv_state_save($path, $state) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    $encoded = json_encode($state);
    if ($encoded === false) {
        pv_error(500, 'server_error', 'Failed to encode state.');
    }

    $written = @file_put_contents($path, $encoded, LOCK_EX);
    if ($written === false) {
        error_log('state.php: failed to write ' . $path);
        pv_error(500, 'server_error', 'Failed to persist state.');
    }
    return true;
}

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

// ---------------------------------------------------------------------------
// GET: return current state
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $state = pv_state_load($stateFile);
    pv_json(pv_state_with_presence($state, $presenceFile));
}

// ---------------------------------------------------------------------------
// POST: partial update
// ---------------------------------------------------------------------------
if ($method === 'POST') {
    pv_check_optional_token(); // Only enforced when PV_TOKEN is configured.

    // Parse the request body (JSON preferred, form fallback).
    $contentType = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
    $body = null;
    if (stripos($contentType, 'application/json') !== false) {
        $rawBody = file_get_contents('php://input');
        $body = json_decode($rawBody, true);
        if (!is_array($body)) {
            pv_error(400, 'bad_request', 'Request body must be a JSON object.');
        }
    } else {
        $body = $_POST;
        if (!is_array($body)) {
            $body = array();
        }
    }

    // -----------------------------------------------------------------------
    // Heartbeat: the PC browser saying "I am alive". Deliberately does not bump
    // `rev`: the display polls every second and a rev change would make it
    // re-apply the transform on every beat.
    // -----------------------------------------------------------------------
    if (array_key_exists('heartbeat', $body) && filter_var($body['heartbeat'], FILTER_VALIDATE_BOOLEAN)) {
        $written = pv_presence_touch($presenceFile);
        if (!$written) {
            pv_error(500, 'server_error', 'Failed to record heartbeat.');
        }
        $state = pv_state_load($stateFile);
        $state['pc_online']  = true;
        $state['pc_seen_at'] = gmdate('c');
        pv_json($state);
    }

    $state = pv_state_load($stateFile);
    $currentRev = isset($state['rev']) ? (int) $state['rev'] : 0;

    // Optional optimistic-concurrency guard.
    if (isset($body['expected_rev'])) {
        $expected = (int) $body['expected_rev'];
        if ($expected !== $currentRev) {
            pv_error(400, 'bad_request', 'State revision conflict: expected_rev does not match the current revision.');
        }
    }

    // -----------------------------------------------------------------------
    // Navigation command (Android remote -> PC browser).
    //
    // Handled BEFORE any write so a command aimed at an offline display leaves
    // the document untouched. Otherwise the PC would "catch up" and navigate
    // the moment it came back, which is exactly what the user does not want.
    // -----------------------------------------------------------------------
    if (array_key_exists('nav', $body)) {
        $nav = $body['nav'];
        if (!is_array($nav)) {
            pv_error(400, 'bad_request', 'The "nav" field must be an object.');
        }

        if (!pv_pc_online($presenceFile)) {
            pv_error(409, 'pc_offline', 'PC not connected: no display has reported in recently, so nothing was sent.');
        }

        $target = isset($nav['target']) ? strtolower(trim((string) $nav['target'])) : '';
        if ($target !== 'details' && $target !== 'viz') {
            pv_error(400, 'bad_request', 'nav.target must be either "details" or "viz".');
        }

        $navProductId = null;
        if (array_key_exists('product_id', $nav) && $nav['product_id'] !== null && $nav['product_id'] !== '') {
            $rawNavId = trim((string) $nav['product_id']);
            if (!ctype_digit($rawNavId) || (int) $rawNavId <= 0) {
                pv_error(400, 'bad_request', 'nav.product_id must be a positive whole number.');
            }
            $navProductId = (int) $rawNavId;
        } else {
            // Fall back to whatever product is currently showing.
            if (!isset($state['product_id']) || $state['product_id'] === null) {
                pv_error(400, 'bad_request', 'No product_id supplied and no product is currently showing.');
            }
            $navProductId = (int) $state['product_id'];
        }

        $state['nav_seq']        = (isset($state['nav_seq']) ? (int) $state['nav_seq'] : 0) + 1;
        $state['nav_target']     = $target;
        $state['nav_product_id'] = $navProductId;

        // Bump the revision/timestamp so any consumer sees a newer document.
        $state['rev'] = $currentRev + 1;
        $state['updated_at'] = gmdate('c');

        pv_state_save($stateFile, $state);

        pv_json(pv_state_with_presence($state, $presenceFile));
    }

    // Apply a whitelist of updatable fields.
    if (array_key_exists('product_id', $body)) {
        $val = $body['product_id'];
        $state['product_id'] = ($val === null || $val === '') ? null : (int) $val;
    }
    if (array_key_exists('room', $body)) {
        $val = $body['room'];
        $state['room'] = ($val === null) ? null : (string) $val;
    }
    if (array_key_exists('scale', $body) && is_numeric($body['scale'])) {
        $state['scale'] = (float) $body['scale'];
    }
    if (array_key_exists('x', $body) && is_numeric($body['x'])) {
        $state['x'] = (float) $body['x'];
    }
    if (array_key_exists('y', $body) && is_numeric($body['y'])) {
        $state['y'] = (float) $body['y'];
    }
    if (array_key_exists('flip', $body)) {
        $state['flip'] = filter_var($body['flip'], FILTER_VALIDATE_BOOLEAN);
    }

    // Bump revision + timestamp.
    $state['rev'] = $currentRev + 1;
    $state['updated_at'] = gmdate('c');

    pv_state_save($stateFile, $state);

    pv_json(pv_state_with_presence($state, $presenceFile));
}

// ---------------------------------------------------------------------------
// Anything else is not allowed.
// ---------------------------------------------------------------------------
pv_error(405, 'method_not_allowed', 'Only GET and POST are allowed for this endpoint.');