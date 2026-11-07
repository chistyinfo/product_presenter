<?php
// Database connection parameters
$host = 'localhost';
$dbname = 'productvisualizerdb';
$username = 'root';
$password = '';

// Set headers for JSON response
header('Content-Type: application/json; charset=utf-8');

/**
 * Recursively walk a value and drop/replace any byte sequence that is not valid UTF-8.
 *
 * This is the safety net for the class of bug that broke this endpoint: rows were being
 * read over a latin1 connection, so a UTF-8 en-dash came back as the single byte 0x96.
 * json_encode() refuses the whole document in that case and returns false, and
 * `echo false` writes an *empty* body with a 200 status, which is what made the browser
 * throw "JSON.parse: unexpected end of data at line 1 column 1".
 */
function pv_json_scrub_utf8($value) {
    if (is_array($value)) {
        foreach ($value as $k => $v) {
            $value[$k] = pv_json_scrub_utf8($v);
        }
        return $value;
    }
    if (is_string($value)) {
        if (!mb_check_encoding($value, 'UTF-8')) {
            // Same-encoding conversion replaces invalid sequences with U+FFFD.
            $value = mb_convert_encoding($value, 'UTF-8', 'UTF-8');
        }
    }
    return $value;
}

/**
 * Encode the response as JSON and guarantee a non-empty body.
 *
 * Returns the JSON string, or a valid JSON error document if even the scrubbed data
 * cannot be encoded (so callers never emit an empty response).
 */
function pv_json_encode_safe($data) {
    $json = json_encode($data);
    if ($json !== false) {
        return $json;
    }

    // Retry once with invalid byte sequences stripped.
    $json = json_encode(pv_json_scrub_utf8($data));
    if ($json !== false) {
        return $json;
    }

    // Last resort: a well-formed error document rather than a blank body.
    return json_encode([
        'success' => false,
        'error'   => 'Failed to encode response as JSON: ' . json_last_error_msg(),
    ]);
}

// Get product ID from request
$productId = isset($_GET['id']) ? intval($_GET['id']) : 0;

// Validate product ID
if ($productId <= 0) {
    http_response_code(400);
    echo pv_json_encode_safe([
        'success' => false,
        'error' => 'Invalid product ID'
    ]);
    exit;
}

try {
    // Connect to database. charset=utf8mb4 is required: without it the connection defaults
    // to latin1 and non-ASCII characters (e.g. the en-dash in product_details) are returned
    // as bytes that are not valid UTF-8, which makes json_encode() fail and empty the body.
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // 1. Get primary product data (including name) using the provided ID
    $stmt = $pdo->prepare("
        SELECT p.* 
        FROM products p
        WHERE p.id = :id
    ");
    $stmt->bindParam(':id', $productId, PDO::PARAM_INT);
    $stmt->execute();
    $primaryProductData = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$primaryProductData) {
        http_response_code(404);
        echo pv_json_encode_safe([
            'success' => false,
            'error' => 'Product not found'
        ]);
        exit;
    }

    $productName = $primaryProductData['name']; // Get the product name

    // Format primary product data (we'll use the image from the first instance found)
    $product = [
        'id' => $primaryProductData['id'], // Use the requested ID
        'name' => $primaryProductData['name'],
        'description' => $primaryProductData['description'],
        'image_filename' => $primaryProductData['image_filename'], // Use image from the specific product ID requested
        'created_at' => $primaryProductData['created_at'],
        'updated_at' => $primaryProductData['updated_at']
    ];

    // 2. Find all background IDs associated with this product NAME
    $stmt = $pdo->prepare("
        SELECT DISTINCT p.background_id 
        FROM products p
        WHERE p.name = :name AND p.background_id IS NOT NULL
    ");
    $stmt->bindParam(':name', $productName, PDO::PARAM_STR);
    $stmt->execute();
    $backgroundIds = $stmt->fetchAll(PDO::FETCH_COLUMN, 0);

    // 3. Fetch full background details for these IDs
    $backgrounds = [];
    $backgroundsById = []; // Defined here so the primary-background lookup below is safe even when empty
    if (!empty($backgroundIds)) {
        // Create placeholders for the IN clause
        $placeholders = implode(',', array_fill(0, count($backgroundIds), '?'));
        
        $stmt = $pdo->prepare("
            SELECT * 
            FROM backgrounds b
            WHERE b.id IN ($placeholders)
        ");
        $stmt->execute($backgroundIds);
        $backgroundsData = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Format background data and store in an associative array for easy lookup
        foreach ($backgroundsData as $bg) {
             $backgroundsById[$bg['id']] = [
                'id' => $bg['id'],
                'name' => $bg['name'],
                'image_filename' => $bg['image_filename'],
                'marking_top_percent' => (float)$bg['marking_top_percent'],
                'marking_left_percent' => (float)$bg['marking_left_percent'],
                'marking_width_percent' => (float)$bg['marking_width_percent'],
                'marking_height_percent' => (float)$bg['marking_height_percent'],
                'marking_padding_percent' => (float)$bg['marking_padding_percent']
            ];
        }
        // Ensure the backgrounds are in the order of the IDs found
        foreach ($backgroundIds as $bgId) {
            if (isset($backgroundsById[$bgId])) {
                $backgrounds[] = $backgroundsById[$bgId];
            }
        }
    }

    // Determine the primary background (the one linked to the specific product ID requested)
    $primaryBackground = null;
    if ($primaryProductData['background_id'] && isset($backgroundsById[$primaryProductData['background_id']])) {
        $primaryBackground = $backgroundsById[$primaryProductData['background_id']];
    }
    
    // Get product details (if table exists)
    $details = [];
    try {
        $stmt = $pdo->prepare("SELECT * FROM product_details WHERE product_id = :id");
        $stmt->bindParam(':id', $productId, PDO::PARAM_INT);
        $stmt->execute();
        $details = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        error_log("Product details query failed: " . $e->getMessage());
    }
    
    // Get product stickers (if table exists)
    $stickers = [];
    try {
        $stmt = $pdo->prepare("SELECT * FROM product_stickers WHERE product_id = :id");
        $stmt->bindParam(':id', $productId, PDO::PARAM_INT);
        $stmt->execute();
        $stickers = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        error_log("Product stickers query failed: " . $e->getMessage());
    }
    
    // Prepare response
    $response = [
        'success' => true,
        'product' => $product,
        'background' => $primaryBackground, // The specific background linked to the product ID
        'backgrounds' => $backgrounds, // All backgrounds linked to the product NAME
        'details' => $details,
        'stickers' => $stickers
    ];
    
    // Never echo the raw json_encode() result: on failure it is `false`, and `echo false`
    // produces an empty body that the browser cannot parse.
    echo pv_json_encode_safe($response);
    
} catch (PDOException $e) {
    error_log("get_product_fullscreen.php DB error: " . $e->getMessage());
    http_response_code(500);
    echo pv_json_encode_safe([
        'success' => false,
        'error' => 'Database error: ' . $e->getMessage()
    ]);
}
?>