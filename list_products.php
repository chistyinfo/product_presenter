<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Database configuration
$host = 'localhost';
$dbname = 'productvisualizerdb';
$username = 'root'; // Change according to your setup
$password = '';     // Change according to your setup

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch(PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

// Get search term if provided
$searchTerm = isset($_GET['search']) ? $_GET['search'] : '';

try {
    if (!empty($searchTerm)) {
        // Search products by name or description
        $products = searchProducts($pdo, $searchTerm);
    } else {
        // Get all products
        $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50; // Default to 50 products
        $products = getAllProducts($pdo, $page, $limit);
    }
    
    // Prepare the response
    $response = [
        'success' => true,
        'products' => $products,
        'total' => count($products)
    ];
    
    echo json_encode($response, JSON_PRETTY_PRINT);
    
} catch(PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database query failed: ' . $e->getMessage()]);
}

/**
 * Get all products with pagination
 */
function getAllProducts($pdo, $page = 1, $limit = 50) {
    $offset = ($page - 1) * $limit;
    
    $query = "
        SELECT 
            p.id,
            p.name,
            p.description,
            p.image_filename,
            b.name as background_name
        FROM products p
        LEFT JOIN backgrounds b ON p.background_id = b.id
        ORDER BY p.created_at DESC
        LIMIT :limit OFFSET :offset
    ";
    
    $stmt = $pdo->prepare($query);
    $stmt->bindParam(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindParam(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * Search products by name or description
 */
function searchProducts($pdo, $searchTerm) {
    $searchTerm = '%' . $searchTerm . '%';
    
    $query = "
        SELECT 
            p.id,
            p.name,
            p.description,
            p.image_filename,
            b.name as background_name
        FROM products p
        LEFT JOIN backgrounds b ON p.background_id = b.id
        WHERE p.name LIKE :search OR p.description LIKE :search
        ORDER BY p.created_at DESC
    ";
    
    $stmt = $pdo->prepare($query);
    $stmt->bindParam(':search', $searchTerm, PDO::PARAM_STR);
    $stmt->execute();
    
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}
?>
