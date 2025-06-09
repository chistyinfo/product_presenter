<?php
// Database connection parameters
$host = 'localhost';
$dbname = 'productvisualizerdb';
$username = 'root';
$password = '';

// Set headers for JSON response
header('Content-Type: application/json');

// Get product ID from request
$productId = isset($_GET['id']) ? intval($_GET['id']) : 0;

// Validate product ID
if ($productId <= 0) {
    echo json_encode([
        'success' => false,
        'error' => 'Invalid product ID'
    ]);
    exit;
}

try {
    // Connect to database
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
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
        echo json_encode([
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
        $backgroundsById = [];
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
    
    echo json_encode($response);
    
} catch (PDOException $e) {
    echo json_encode([
        'success' => false,
        'error' => 'Database error: ' . $e->getMessage()
    ]);
}
?>