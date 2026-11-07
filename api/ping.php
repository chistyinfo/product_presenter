<?php
// api/ping.php
// Lightweight health probe for the Android client. Deliberately does NOT
// include config.php so it cannot fail on a database hiccup.

ini_set('display_errors', '0'); // Keep warnings out of the JSON payload
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-PV-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(array(
        'ok' => false,
        'error' => array(
            'code' => 'method_not_allowed',
            'message' => 'Only GET is allowed for this endpoint.'
        )
    ));
    exit;
}

http_response_code(200);
echo json_encode(array(
    'ok' => true,
    'app' => 'product_presenter',
    'version' => 1,
    'time' => gmdate('c') // ISO 8601, e.g. 2026-11-07T15:32:37+00:00
));