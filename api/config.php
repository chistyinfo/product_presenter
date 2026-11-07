<?php

// --- Polyfill for random_bytes() for PHP < 7.0 ---
if (!function_exists('random_bytes')) {
    /**
     * Polyfill for random_bytes() for PHP < 7.0.
     * Tries to use openssl_random_pseudo_bytes if available, otherwise falls back
     * to a less secure method using mt_rand.
     * For cryptographically secure random bytes in PHP 5, consider installing
     * the paragonie/random_compat library.
     *
     * @param int $length The number of random bytes to generate.
     * @return string|false The generated random string, or false on failure.
     * @throws Exception If a strong source of randomness is not available (if mcrypt was used and failed).
     */
    function random_bytes($length) {
        if (!is_int($length)) {
            trigger_error('random_bytes(): $length must be an integer', E_USER_WARNING);
            return false;
        }
        if ($length <= 0) {
            trigger_error('random_bytes(): Length must be a positive integer', E_USER_WARNING);
            return false;
        }

        // Try OpenSSL
        if (function_exists('openssl_random_pseudo_bytes')) {
            $bytes = openssl_random_pseudo_bytes($length, $strong);
            if ($strong === true && $bytes !== false && strlen($bytes) === $length) {
                return $bytes;
            }
        }
        
        // Fallback to mt_rand (NOT cryptographically secure, but will work for filename generation)
        // This is a last resort.
        $bytes = '';
        for ($i = 0; $i < $length; $i++) {
            $bytes .= chr(mt_rand(0, 255));
        }

        if (strlen($bytes) !== $length) {
             trigger_error('random_bytes polyfill: Could not generate requested number of bytes.', E_USER_WARNING);
             return false; // Or throw an exception
        }
        
        // Optionally, you could add a notice here that a less secure method was used.
        // E.g., trigger_error('random_bytes polyfill: Using mt_rand as a fallback. For secure random bytes, upgrade PHP or install paragonie/random_compat.', E_USER_NOTICE);

        return $bytes;
    }
}
// --- End Polyfill ---


// --- Configuration ---
define('DB_HOST', 'localhost'); // Or your DB host
define('DB_NAME', 'productvisualizerdb'); // Your database name
define('DB_USER', 'root');    // Your database username
define('DB_PASS', ''); // Your database password
define('DB_CHARSET', 'utf8mb4');

// --- Optional API Token ---
// When set to a non-empty string, write (POST) requests to the newer JSON
// endpoints must send a matching `X-PV-Token` header. GET requests are never
// gated. Leave empty to allow all requests (current behaviour).
if (!defined('PV_TOKEN')) {
    define('PV_TOKEN', '');
}

// --- Uploads Configuration ---
define('UPLOADS_DIR', __DIR__ . '/../uploads'); // Absolute path to uploads directory
define('BACKGROUND_UPLOADS_DIR', UPLOADS_DIR . '/backgrounds');
define('PRODUCT_UPLOADS_DIR', UPLOADS_DIR . '/products');
define('BASE_URL', (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://" . $_SERVER['HTTP_HOST']);
define('UPLOADS_BASE_URL', BASE_URL . '/product_presenter/uploads'); // Base URL for accessing uploads

// Ensure upload directories exist
if (!is_dir(BACKGROUND_UPLOADS_DIR)) {
    mkdir(BACKGROUND_UPLOADS_DIR, 0775, true);
}
if (!is_dir(PRODUCT_UPLOADS_DIR)) {
    mkdir(PRODUCT_UPLOADS_DIR, 0775, true);
}

// --- Database Connection (PDO) ---
$dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;
// For SQLite: $dsn = "sqlite:" . __DIR__ . "/your_database_file.sqlite";

$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION, // Throw exceptions on error
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,       // Fetch associative arrays
    PDO::ATTR_EMULATE_PREPARES   => false,                  // Use native prepared statements
];

try {
    $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
} catch (\PDOException $e) {
    // In a real app, log this error and show a generic message to the user
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

// --- Helper Functions ---
function send_json_response($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function get_input_data() {
    // For POST, PUT, PATCH with JSON body
    if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH']) &&
        stripos($_SERVER['CONTENT_TYPE'], 'application/json') !== false) {
        return json_decode(file_get_contents('php://input'), true);
    }
    // For form-data (including file uploads) or x-www-form-urlencoded
    return $_POST;
}

// Simple function to generate a unique filename
function generate_unique_filename($originalName, $uploadDir) {
    $extension = pathinfo($originalName, PATHINFO_EXTENSION);
    $basename = bin2hex(random_bytes(8)); // Random name - NOW USES POLYFILL IF NEEDED
    $filename = $basename . '.' . $extension;
    $counter = 0;
    while (file_exists($uploadDir . '/' . $filename)) {
        $counter++;
        $filename = $basename . '_' . $counter . '.' . $extension;
    }
    return $filename;
}

?>