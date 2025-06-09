<?php
ob_start(); // Start output buffering

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Function to send JSON response and exit
function sendJsonResponse($data, $statusCode = 200) {
    ob_end_clean(); // Discard any previous output
    http_response_code($statusCode);
    echo json_encode($data);
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

try {
    // Get search query parameter
    $search = isset($_GET['search']) ? trim($_GET['search']) : '';
    
    // Base query to get products with ID and name
    $query = "SELECT id, name FROM products";
    $params = [];
    
    // Add search filter if provided
    if (!empty($search)) {
        $query .= " WHERE (id LIKE :search OR name LIKE :search_name)";
        $params[':search'] = '%' . $search . '%';
        $params[':search_name'] = '%' . $search . '%';
    }
    
    // Order by ID for consistent results
    $query .= " ORDER BY id ASC";
    
    // Limit results to prevent overwhelming the frontend
    $query .= " LIMIT 50";
    
    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    
    $products = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Format the response
    $suggestions = [];
    foreach ($products as $product) {
        $suggestions[] = [
            'id' => (int)$product['id'],
            'name' => $product['name'],
            'display' => $product['id'] . ' - ' . $product['name']
        ];
    }
    
    sendJsonResponse([
        'success' => true,
        'suggestions' => $suggestions,
        'total' => count($suggestions)
    ]);
    
} catch(PDOException $e) {
    sendJsonResponse(['success' => false, 'error' => 'Database query failed: ' . $e->getMessage()], 500);
}

ob_end_flush();
?>

