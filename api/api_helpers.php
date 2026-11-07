<?php
// api/api_helpers.php
// Shared scaffolding for the newer JSON endpoints (ping/rooms/state and the
// full-catalog route of products.php). Keeps headers, error envelope and the
// optional token check consistent without touching the legacy endpoints.

if (!defined('PV_API_HELPERS_LOADED')) {
    define('PV_API_HELPERS_LOADED', true);

    // The DB connection, PV_TOKEN constant and upload URLs live in config.php.
    // It is a pure include (no output), so including it here is safe.
    require_once __DIR__ . '/config.php';

    // Never let PHP notices/warnings corrupt the JSON body.
    ini_set('display_errors', '0');
    error_reporting(E_ALL);

    /**
     * Send the standard CORS headers used across the API and short-circuit
     * pre-flight OPTIONS requests.
     */
    function pv_send_cors() {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-PV-Token');
        if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            http_response_code(200);
            exit;
        }
    }

    /**
     * Emit a JSON success payload (2xx) with the UTF-8 content type.
     */
    function pv_json($data, $statusCode = 200) {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data);
        exit;
    }

    /**
     * Emit the standard JSON error envelope described in the API contract:
     * {"ok":false,"error":{"code":"<snake_case>","message":"<human readable>"}}
     */
    function pv_error($statusCode, $code, $message) {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(array(
            'ok' => false,
            'error' => array(
                'code' => $code,
                'message' => $message
            )
        ));
        exit;
    }

    /**
     * Optional auth gate: only enforced on POST requests, and only when a
     * non-empty PV_TOKEN is configured server-side. GET is never gated.
     */
    function pv_check_optional_token() {
        if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') {
            return; // Never gate non-POST requests.
        }
        $configured = defined('PV_TOKEN') ? trim((string) PV_TOKEN) : '';
        if ($configured === '') {
            return; // No token configured -> allow everyone.
        }

        $provided = '';
        if (isset($_SERVER['HTTP_X_PV_TOKEN'])) {
            $provided = (string) $_SERVER['HTTP_X_PV_TOKEN'];
        } elseif (function_exists('getallheaders')) {
            foreach (getallheaders() as $hName => $hValue) {
                if (strcasecmp($hName, 'X-PV-Token') === 0) {
                    $provided = (string) $hValue;
                    break;
                }
            }
        }

        if ($provided === '' || !hash_equals($configured, $provided)) {
            pv_error(401, 'unauthorized', 'A valid X-PV-Token header is required.');
        }
    }
}