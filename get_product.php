<?php
ob_start(); // Start output buffering

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Function to send JSON response and exit
function sendJsonResponse($data, $statusCode = 200) {
    ob_end_clean(); // Discard any previous output
    http_response_code($statusCode);
    echo json_encode($data); // Removed JSON_PRETTY_PRINT
    exit;
}

// Database configuration
$host = 'localhost';
$dbname = 'productvisualizerdb';
$username = 'root'; // Change according to your setup
$password = '';     // Change according to your setup

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch(PDOException $e) {
    sendJsonResponse(['success' => false, 'error' => 'Database connection failed: ' . $e->getMessage()], 500);
}

// Determine the product ID to fetch
$product_id = isset($_GET['id']) ? filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT) : 0;
$fetch_latest = (!$product_id || $product_id <= 0); // Flag to indicate if we need the latest

try {
    if ($fetch_latest) {
        // Query to get the ID of the most recently created product
        $latestProductQuery = "SELECT id FROM products ORDER BY created_at DESC, id DESC LIMIT 1";
        $stmtLatest = $pdo->prepare($latestProductQuery);
        $stmtLatest->execute();
        $latestProduct = $stmtLatest->fetch(PDO::FETCH_ASSOC);

        if ($latestProduct) {
            $product_id = (int)$latestProduct['id'];
        } else {
            sendJsonResponse(['success' => false, 'error' => 'No products found in the database.'], 404);
        }
    }

    // Now $product_id holds either the requested ID or the latest ID

    // Get product with background information
    $productQuery = "
        SELECT 
            p.id, p.name, p.description, p.image_filename, p.created_at,
            b.id as background_id, b.name as background_name, b.image_filename as background_image,
            b.marking_top_percent, b.marking_left_percent, b.marking_width_percent, b.marking_height_percent
        FROM products p
        LEFT JOIN backgrounds b ON p.background_id = b.id
        WHERE p.id = :product_id
    ";
    
    $stmt = $pdo->prepare($productQuery);
    $stmt->bindParam(':product_id', $product_id, PDO::PARAM_INT);
    $stmt->execute();
    
    $product = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$product) {
        $error_message = $fetch_latest ? 'Latest product could not be retrieved.' : 'Product not found for ID: ' . $product_id;
        sendJsonResponse(['success' => false, 'error' => $error_message], 404);
    }
    
    // Get product details
    $detailsQuery = "
        SELECT 
            id, detail_type, detail_label, detail_value, display_order,
            sticker_image_filename, sticker_position
        FROM product_details 
        WHERE product_id = :product_id 
        ORDER BY display_order ASC, id ASC
    ";
    
    $stmt = $pdo->prepare($detailsQuery);
    $stmt->bindParam(':product_id', $product_id, PDO::PARAM_INT);
    $stmt->execute();
    
    $details = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Organize details and stickers
    $organizedDetails = [];
    $stickers = [];
    foreach ($details as $detail) {
        $organizedDetails[] = [
            'id' => $detail['id'],
            'type' => $detail['detail_type'],
            'label' => $detail['detail_label'],
            'value' => $detail['detail_value'],
            'order' => $detail['display_order']
        ];
        if (!empty($detail['sticker_image_filename'])) {
            $stickers[] = [
                'filename' => $detail['sticker_image_filename'],
                'position' => $detail['sticker_position'] ?: 'top-right',
                'detail_id' => $detail['id']
            ];
        }
    }
    
    // Prepare the final response
    $response = [
        'success' => true,
        'product' => [
            'id' => $product['id'],
            'name' => $product['name'],
            'description' => $product['description'] ?: 'No description available',
            'image' => $product['image_filename'],
            'created_at' => $product['created_at']
        ],
        'background' => [
            'id' => $product['background_id'],
            'name' => $product['background_name'],
            'image' => $product['background_image'],
            'marking' => [
                'top' => (float)$product['marking_top_percent'],
                'left' => (float)$product['marking_left_percent'],
                'width' => (float)$product['marking_width_percent'],
                'height' => (float)$product['marking_height_percent']
            ]
        ],
        'details' => $organizedDetails,
        'stickers' => $stickers,
        'total_details' => count($organizedDetails)
    ];
    
    sendJsonResponse($response);
    
} catch(PDOException $e) {
    $error_context = $fetch_latest ? " (while fetching latest product)" : " (for product ID: $product_id)";
    sendJsonResponse(['success' => false, 'error' => 'Database query failed' . $error_context . ': ' . $e->getMessage()], 500);
}

ob_end_flush(); // Flush the output buffer (although sendJsonResponse already exited)
?>