<?php
// api/state.php
// Persists a single "presentation state" document in api/data/state.json.
// Shape (matches the existing data/state.json):
//   { "rev":int, "product_id":int|null, "room":string|null,
//     "scale":number, "x":number, "y":number, "flip":bool,
//     "updated_at":ISO-8601|null }
//
// GET  -> returns the current state object.
// POST -> applies a partial update (any subset of the fields above), bumps
//         `rev`, refreshes `updated_at`, writes atomically and returns the
//         new state. Optional X-PV-Token gate applies to POST only.

require_once __DIR__ . '/api_helpers.php';

pv_send_cors();

$stateFile = __DIR__ . '/data/state.json';

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
        'flip'       => false,
        'updated_at' => null
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

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

// ---------------------------------------------------------------------------
// GET: return current state
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $state = pv_state_load($stateFile);
    pv_json($state);
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

    $state = pv_state_load($stateFile);
    $currentRev = isset($state['rev']) ? (int) $state['rev'] : 0;

    // Optional optimistic-concurrency guard.
    if (isset($body['expected_rev'])) {
        $expected = (int) $body['expected_rev'];
        if ($expected !== $currentRev) {
            pv_error(400, 'bad_request', 'State revision conflict: expected_rev does not match the current revision.');
        }
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

    // Ensure the data directory exists and write atomically enough for our use.
    $dir = dirname($stateFile);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    $encoded = json_encode($state);
    if ($encoded === false) {
        pv_error(500, 'server_error', 'Failed to encode state.');
    }

    $written = @file_put_contents($stateFile, $encoded, LOCK_EX);
    if ($written === false) {
        error_log('state.php: failed to write ' . $stateFile);
        pv_error(500, 'server_error', 'Failed to persist state.');
    }

    pv_json($state);
}

// ---------------------------------------------------------------------------
// Anything else is not allowed.
// ---------------------------------------------------------------------------
pv_error(405, 'method_not_allowed', 'Only GET and POST are allowed for this endpoint.');