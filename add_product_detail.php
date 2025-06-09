<?php
// Database configuration
$host = 'localhost';
$dbname = 'productvisualizerdb';
$username = 'root';  // Change this to your database username
$password = '';      // Change this to your database password

// Set content type to JSON
header('Content-Type: application/json');

// Enable CORS for cross-origin requests
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Only allow POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

try {
    // Create PDO connection
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Validate required fields
    $required_fields = ['product_id', 'detail_type', 'detail_label', 'detail_value'];
    foreach ($required_fields as $field) {
        if (!isset($_POST[$field]) || empty(trim($_POST[$field]))) {
            throw new Exception("Field '$field' is required");
        }
    }
    
    // Sanitize and validate input data
    $product_id = filter_var($_POST['product_id'], FILTER_VALIDATE_INT);
    if ($product_id === false || $product_id <= 0) {
        throw new Exception('Invalid product ID');
    }
    
    $detail_type = trim($_POST['detail_type']);
    $allowed_types = ['specification', 'feature', 'dimension', 'material', 'warranty'];
    if (!in_array($detail_type, $allowed_types)) {
        throw new Exception('Invalid detail type');
    }
    
    $detail_label = trim($_POST['detail_label']);
    if (strlen($detail_label) > 100) {
        throw new Exception('Detail label must be 100 characters or less');
    }
    
    $detail_value = trim($_POST['detail_value']);
    if (empty($detail_value)) {
        throw new Exception('Detail value cannot be empty');
    }
    
    $display_order = isset($_POST['display_order']) ? filter_var($_POST['display_order'], FILTER_VALIDATE_INT) : 0;
    if ($display_order === false) {
        $display_order = 0;
    }
    
    $sticker_position = isset($_POST['sticker_position']) ? trim($_POST['sticker_position']) : 'top-right';
    $allowed_positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];
    if (!in_array($sticker_position, $allowed_positions)) {
        $sticker_position = 'top-right';
    }
    
    // Check if product exists
    $stmt = $pdo->prepare("SELECT id FROM products WHERE id = ?");
    $stmt->execute([$product_id]);
    if (!$stmt->fetch()) {
        throw new Exception('Product with ID ' . $product_id . ' does not exist');
    }
    
    // Handle file upload
    $sticker_image_filename = null;
    if (isset($_FILES['sticker_image_filename']) && $_FILES['sticker_image_filename']['error'] === UPLOAD_ERR_OK) {
        $upload_dir = 'uploads/stickers/';
        
        // Create upload directory if it doesn't exist
        if (!is_dir($upload_dir)) {
            mkdir($upload_dir, 0755, true);
        }
        
        $file = $_FILES['sticker_image_filename'];
        $file_info = pathinfo($file['name']);
        $extension = strtolower($file_info['extension']);
        
        // Validate file type
        $allowed_extensions = ['jpg', 'jpeg', 'png', 'gif'];
        if (!in_array($extension, $allowed_extensions)) {
            throw new Exception('Invalid file type. Only JPG, PNG, and GIF files are allowed');
        }
        
        // Validate file size (max 5MB)
        if ($file['size'] > 5 * 1024 * 1024) {
            throw new Exception('File size too large. Maximum size is 5MB');
        }
        
        // Generate unique filename
        $sticker_image_filename = uniqid() . '.' . $extension;
        $upload_path = $upload_dir . $sticker_image_filename;
        
        // Move uploaded file
        if (!move_uploaded_file($file['tmp_name'], $upload_path)) {
            throw new Exception('Failed to upload file');
        }
    }
    
    // Insert into database
    $sql = "INSERT INTO product_details (product_id, detail_type, detail_label, detail_value, display_order, sticker_image_filename, sticker_position) 
            VALUES (?, ?, ?, ?, ?, ?, ?)";
    
    $stmt = $pdo->prepare($sql);
    $result = $stmt->execute([
        $product_id,
        $detail_type,
        $detail_label,
        $detail_value,
        $display_order,
        $sticker_image_filename,
        $sticker_position
    ]);
    
    if ($result) {
        $insert_id = $pdo->lastInsertId();
        echo json_encode([
            'success' => true,
            'message' => 'Product detail added successfully',
            'id' => $insert_id
        ]);
    } else {
        throw new Exception('Failed to insert product detail');
    }
    
} catch (PDOException $e) {
    error_log('Database error: ' . $e->getMessage());
    echo json_encode([
        'success' => false,
        'message' => 'Database error occurred'
    ]);
} catch (Exception $e) {
    echo json_encode([
        'success' => false,
        'message' => $e->getMessage()
    ]);
}
?>

