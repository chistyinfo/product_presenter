<?php
require_once 'config.php'; // Includes PDO connection and helpers

// --- CORS Headers ---
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

// URL Parsing: /api/products/{id} OR /api/products?background_id={id}
$request_uri_parts = explode('/', trim($_SERVER['REQUEST_URI'], '/'));
// Remove empty parts and reindex
$request_uri_parts = array_values(array_filter($request_uri_parts));

$background_id = null;
$product_id = null;
$action = '';

// Check for background_id in query parameter (easier routing)
if (isset($_GET['background_id']) && is_numeric($_GET['background_id'])) {
    $background_id = (int)$_GET['background_id'];
    $action = 'background_products';
}

// Look for numeric ID in URL path for direct product access
foreach ($request_uri_parts as $part) {
    if (is_numeric($part)) {
        $product_id = (int)$part;
        if (!$action) { // if action was not already set by background_id
            $action = 'product_direct';
        }
        break;
    }
}

// Fallback: if no action determined but we have background_id, assume background_products
if (!$action && $background_id) {
    $action = 'background_products';
}

// --- ROUTING ---
if ($action === 'background_products') {
    if ($method === 'GET' && !$product_id) { // Ensure product_id is not set for this route
        getProductsByBackground($pdo, $background_id);
    } elseif ($method === 'POST' && !$product_id) { // Ensure product_id is not set for this route
        createProductForBackground($pdo, $background_id);
    } else {
        send_json_response(array('error' => 'Invalid request for background products.'), 405);
    }
} elseif ($action === 'product_direct') {
    if ($method === 'GET' && $product_id) {
        getProductById($pdo, $product_id);
    } elseif ($method === 'PUT' && $product_id) {
        updateProduct($pdo, $product_id);
    } elseif ($method === 'DELETE' && $product_id) {
        deleteProduct($pdo, $product_id);
    } else {
        send_json_response(array('error' => 'Invalid request or method not allowed for direct product access.'), 405);
    }
} else {
    send_json_response(array('error' => 'Invalid product API endpoint. Use ?background_id={id} for background-specific operations or /api/products/{id} for direct product access.'), 400);
}

// --- CONTROLLER FUNCTIONS ---

function getProductsByBackground($pdo, $background_id) {
    $stmt = $pdo->prepare("SELECT id FROM Backgrounds WHERE id = ?");
    $stmt->execute(array($background_id));
    if (!$stmt->fetch(PDO::FETCH_ASSOC)) {
        send_json_response(array('error' => 'Background not found'), 404);
        return;
    }

    $stmt = $pdo->prepare("SELECT * FROM Products WHERE background_id = ? ORDER BY created_at DESC");
    $stmt->execute(array($background_id));
    $products = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($products as &$prod) { // Pass by reference
        if (isset($prod['image_filename'])) {
            $prod['imageUrl'] = UPLOADS_BASE_URL . '/products/' . $prod['image_filename'];
        }
    }
    unset($prod); // Unset reference
    send_json_response($products);
}

function getProductById($pdo, $product_id) {
    $stmt = $pdo->prepare("SELECT * FROM Products WHERE id = ?");
    $stmt->execute(array($product_id));
    $product = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($product) {
        if (isset($product['image_filename'])) {
            $product['imageUrl'] = UPLOADS_BASE_URL . '/products/' . $product['image_filename'];
        }
        send_json_response($product);
    } else {
        send_json_response(array('error' => 'Product not found'), 404);
    }
}

function createProductForBackground($pdo, $background_id) {
    $stmt = $pdo->prepare("SELECT id FROM Backgrounds WHERE id = ?");
    $stmt->execute(array($background_id));
    if (!$stmt->fetch(PDO::FETCH_ASSOC)) {
        send_json_response(array('error' => 'Cannot add product: Background not found'), 404);
        return;
    }

    $name = isset($_POST['name']) && !empty($_POST['name']) ? $_POST['name'] : 'Untitled Product';
    $description = isset($_POST['description']) ? $_POST['description'] : '';

    if (empty($_FILES['productImage']) || $_FILES['productImage']['error'] !== UPLOAD_ERR_OK) {
        send_json_response(array('error' => 'Product image is required or upload failed.'), 400);
        return;
    }

    $file = $_FILES['productImage'];
    
    $allowedTypes = array('image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp');
    if (!in_array($file['type'], $allowedTypes)) {
        send_json_response(array('error' => 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), 400);
        return;
    }
    
    // Ensure generate_unique_filename and PRODUCT_UPLOADS_DIR are defined in config.php
    $image_filename = generate_unique_filename($file['name'], PRODUCT_UPLOADS_DIR);
    $uploadPath = PRODUCT_UPLOADS_DIR . '/' . $image_filename;

    if (move_uploaded_file($file['tmp_name'], $uploadPath)) {
        try {
            $sql = "INSERT INTO Products (background_id, name, description, image_filename)
                    VALUES (?, ?, ?, ?)";
            $stmt = $pdo->prepare($sql);
            $stmt->execute(array($background_id, $name, $description, $image_filename));
            $newProductId = $pdo->lastInsertId();

            getProductById($pdo, $newProductId); 
        } catch (PDOException $e) {
            if (file_exists($uploadPath)) {
                unlink($uploadPath);
            }
            send_json_response(array('error' => 'Failed to create product: ' . $e->getMessage()), 500);
        }
    } else {
        send_json_response(array('error' => 'Failed to move uploaded product file.'), 500);
    }
}

function updateProduct($pdo, $product_id) {
    // Ensure get_input_data() is PHP 5.6 compatible and defined in config.php
    $data = get_input_data(); 

    $stmt = $pdo->prepare("SELECT id FROM Products WHERE id = ?");
    $stmt->execute(array($product_id));
    if (!$stmt->fetch(PDO::FETCH_ASSOC)) {
        send_json_response(array('error' => 'Product not found for update'), 404);
        return;
    }

    $fieldsToUpdate = array();
    $params = array();
    if (isset($data['name'])) { $fieldsToUpdate[] = "name = ?"; $params[] = $data['name']; }
    if (isset($data['description'])) { $fieldsToUpdate[] = "description = ?"; $params[] = $data['description']; }

    if (empty($fieldsToUpdate)) {
        send_json_response(array('error' => 'No fields to update provided for product.'), 400);
        return;
    }

    $sql = "UPDATE Products SET " . implode(', ', $fieldsToUpdate) . ", updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    $params[] = $product_id;

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        getProductById($pdo, $product_id);
    } catch (PDOException $e) {
        send_json_response(array('error' => 'Failed to update product: ' . $e->getMessage()), 500);
    }
}

function deleteProduct($pdo, $product_id) {
    // Define product upload directory (ensure this constant is defined in config.php)
    if (!defined("PRODUCT_UPLOADS_DIR")) {
        send_json_response(array("error" => "Product upload directory constant not defined."), 500);
        return;
    }

    $product_image_filename = null;

    try {
        // 1. Get product image filename BEFORE deleting the record
        $stmt = $pdo->prepare("SELECT image_filename FROM Products WHERE id = ?");
        $stmt->execute(array($product_id));
        $product = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$product) {
            send_json_response(array("error" => "Product not found for deletion"), 404);
            return;
        }
        $product_image_filename = $product["image_filename"];

        // 2. Delete the product record from the database
        $pdo->beginTransaction(); // Start transaction for DB operation
        $deleteStmt = $pdo->prepare("DELETE FROM Products WHERE id = ?");
        $deleteStmt->execute(array($product_id));
        $rowCount = $deleteStmt->rowCount();
        $pdo->commit(); // Commit DB changes

        // 3. Check if deletion was successful and delete the file
        if ($rowCount > 0) {
            $file_deleted = false;
            $file_message = "";

            if ($product_image_filename) {
                $product_filepath = PRODUCT_UPLOADS_DIR . "/" . $product_image_filename;
                if (file_exists($product_filepath)) {
                    if (@unlink($product_filepath)) {
                        $file_deleted = true;
                        $file_message = "Associated product file deleted successfully.";
                    } else {
                        $file_message = "Failed to delete associated product file.";
                        // Log this error server-side
                        error_log("Failed to delete product file: " . $product_filepath);
                    }
                } else {
                    $file_message = "Associated product file not found, skipping deletion.";
                }
            } else {
                $file_message = "No associated product file to delete.";
            }

            // Send success response including file deletion status
            send_json_response(array(
                "message" => "Product record deleted successfully from database. " . $file_message
            ));
        } else {
            // This case might occur if the product was deleted between the check and the delete operation (race condition)
            send_json_response(array("error" => "Product record could not be deleted, it might have been removed already."), 404);
        }

    } catch (PDOException $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack(); // Rollback DB changes on error
        }
        // Log the detailed error internally
        error_log("Failed to delete product ID $product_id (DB operation): " . $e->getMessage());
        send_json_response(array("error" => "Failed to delete product record from database: " . $e->getMessage()), 500);
    } catch (Exception $e) { // Catch potential file operation errors
        // DB operation might have succeeded, but file deletion failed
        error_log("Error during file deletion for product ID $product_id: " . $e->getMessage());
        // Send a response indicating partial success/failure if DB delete was successful but file op failed
        // This part depends on whether the DB commit happened before the exception
        // Assuming the DB commit succeeded if we reach here after a file error
        send_json_response(array(
            "message" => "Product record deleted successfully from database, but an error occurred during file deletion.",
            "error_details" => $e->getMessage()
        ), 500); // Or a 207 Multi-Status if appropriate
    }
}
?>