<?php
require_once 'config.php'; // Includes PDO connection and helpers

// Keep PHP notices/warnings out of the JSON body.
ini_set('display_errors', '0');
error_reporting(E_ALL);

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
$product_name = null;

// Check for background_id in query parameter (easier routing)
if (isset($_GET['background_id']) && is_numeric($_GET['background_id'])) {
    $background_id = (int)$_GET['background_id'];
    $action = 'background_products';
}

// Name lookup: lets the Android remote resolve a display name ("803") to the
// database ids it needs for nav commands. Additive; legacy routes unaffected.
if (isset($_GET['name']) && trim((string)$_GET['name']) !== '') {
    $product_name = trim((string)$_GET['name']);
    $action = 'products_by_name';
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
if ($action === 'products_by_name') {
    if ($method === 'GET') {
        getProductsByName($pdo, $product_name);
    } else {
        send_json_response(array('error' => 'Only GET is allowed for name lookups.'), 405);
    }
} elseif ($action === 'background_products') {
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
    // No ?background_id and no numeric path segment => full catalog.
    // Additive: legacy callers always pass one of the above, so they are unaffected.
    if ($method === 'GET') {
        getAllProducts($pdo);
    } else {
        send_json_response(array('error' => 'Invalid product API endpoint. Use ?background_id={id} for background-specific operations or /api/products/{id} for direct product access.'), 400);
    }
}

// --- CONTROLLER FUNCTIONS ---

function getAllProducts($pdo) {
    try {
        $stmt = $pdo->prepare("SELECT * FROM Products ORDER BY created_at DESC");
        $stmt->execute();
        $products = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($products as &$prod) { // Pass by reference
            if (isset($prod['image_filename'])) {
                $prod['imageUrl'] = UPLOADS_BASE_URL . '/products/' . $prod['image_filename'];
            }
        }
        unset($prod); // Unset reference

        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(array(
            'products' => $products,
            'count' => count($products)
        ));
        exit;
    } catch (PDOException $e) {
        error_log('products.php full catalog failed: ' . $e->getMessage());
        send_json_response(array('error' => 'Failed to fetch products'), 500);
    }
}

/**
 * GET /api/products.php?name=<display name>[&background_id=<id>|&room=<name>][&limit=n]
 *
 * Resolve a product display name (what the remote shows, e.g. "803") to rows
 * carrying the numeric id needed to build an individual-product.html?id= URL.
 *
 * Names are ONLY unique per room in this database ("803" exists twice, in two
 * different backgrounds), so callers should narrow the search whenever they can:
 *   - &background_id=8   the room id the display is on
 *   - &room=living-room5 the room NAME (from state.room) when only that is known
 * If several rows still match, `ambiguous` is true and the client must pick --
 * normally by preferring the product_id already present in api/state.php.
 *
 * Exact matches are returned first; if there are none, a "contains" search runs
 * so "80" still finds "803".
 */
function getProductsByName($pdo, $name) {
    $limit = 25;
    if (isset($_GET['limit']) && is_numeric($_GET['limit'])) {
        $limit = max(1, min(100, (int)$_GET['limit']));
    }

    // Optional room narrowing: numeric id or room name.
    $whereExtra = '';
    $extraParams = array();
    $roomFilter = isset($_GET['room']) ? trim((string)$_GET['room']) : '';
    if (isset($_GET['background_id']) && is_numeric($_GET['background_id'])) {
        $whereExtra = ' AND background_id = ?';
        $extraParams[] = (int)$_GET['background_id'];
    } elseif ($roomFilter !== '') {
        // Resolve the room name to its id(s); Backgrounds.name is what state.room carries.
        $bgStmt = $pdo->prepare("SELECT id FROM Backgrounds WHERE name = ?");
        $bgStmt->execute(array($roomFilter));
        $roomIds = array();
        while ($bgRow = $bgStmt->fetch(PDO::FETCH_ASSOC)) {
            $roomIds[] = (int)$bgRow['id'];
        }
        if (count($roomIds) === 0) {
            $roomIds[] = -1; // unknown room -> deliberately no matches
        }
        $whereExtra = ' AND background_id IN (' . implode(',', array_fill(0, count($roomIds), '?')) . ')';
        $extraParams = $roomIds;
    }

    try {
        $stmt = $pdo->prepare("SELECT * FROM Products WHERE name = ?" . $whereExtra . " ORDER BY created_at DESC LIMIT " . $limit);
        $stmt->execute(array_merge(array($name), $extraParams));
        $products = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $match = 'exact';

        if (count($products) === 0) {
            $match = 'contains';
            $stmt = $pdo->prepare("SELECT * FROM Products WHERE name LIKE ?" . $whereExtra . " ORDER BY created_at DESC LIMIT " . $limit);
            $stmt->execute(array_merge(array('%' . $name . '%'), $extraParams));
            $products = $stmt->fetchAll(PDO::FETCH_ASSOC);
        }

        foreach ($products as &$prod) {
            if (isset($prod['image_filename'])) {
                $prod['imageUrl'] = UPLOADS_BASE_URL . '/products/' . $prod['image_filename'];
            }
        }
        unset($prod);

        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(array(
            'products'  => $products,
            'count'     => count($products),
            'match'     => $match,
            'query'     => $name,
            // true => the name is duplicated across rooms; the caller must
            // choose (usually the product_id currently in state.php).
            'ambiguous' => count($products) > 1
        ));
        exit;
    } catch (PDOException $e) {
        error_log('products.php name lookup failed: ' . $e->getMessage());
        send_json_response(array('error' => 'Failed to look up products by name'), 500);
    }
}

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
            // Natural pixel size (needed by the editor to lock aspect ratio and
            // by v1 to reproduce geometry). NULL is tolerated.
            $image_width = null;
            $image_height = null;
            $size = @getimagesize($uploadPath);
            if ($size !== false && !empty($size[0]) && !empty($size[1])) {
                $image_width = (int) $size[0];
                $image_height = (int) $size[1];
            }

            $sql = "INSERT INTO Products (background_id, name, description, image_filename, image_width, image_height)
                    VALUES (?, ?, ?, ?, ?, ?)";
            $stmt = $pdo->prepare($sql);
            $stmt->execute(array($background_id, $name, $description, $image_filename, $image_width, $image_height));
            $newProductId = $pdo->lastInsertId();

            // Auto-assign the new product to its background so "upload" implies
            // "it belongs here" (the editor still lets you unassign later).
            $bgStmt = $pdo->prepare("SELECT image_width, image_height, marking_left_percent, marking_top_percent, marking_width_percent, marking_height_percent, marking_padding_percent FROM Backgrounds WHERE id = ?");
            $bgStmt->execute(array($background_id));
            $bg = $bgStmt->fetch(PDO::FETCH_ASSOC);

            $hPct = 70.0;
            $wPct = 20.0;
            $xPct = 40.0;
            $yPct = 15.0;
            $padPct = 0.0;
            if ($bg && $image_width && $image_height && !empty($bg['image_width']) && !empty($bg['image_height'])) {
                $bgAspect = $bg['image_width'] / $bg['image_height'];
                $prodAspect = $image_width / $image_height;
                $wPct = $hPct * $prodAspect / $bgAspect;
                $wPct = max(1.0, min(100.0, $wPct));
                $xPct = max(0.0, (100.0 - $wPct) / 2.0);
                $yPct = max(0.0, (100.0 - $hPct) / 2.0);
            } elseif ($bg) {
                // No natural sizes: fall back to the legacy marking rectangle.
                $wPct = max(1.0, min(100.0, floatval($bg['marking_width_percent'])));
                $hPct = max(1.0, min(100.0, floatval($bg['marking_height_percent'])));
                $xPct = max(0.0, min(100.0, floatval($bg['marking_left_percent'])));
                $yPct = max(0.0, min(100.0, floatval($bg['marking_top_percent'])));
                $padPct = max(0.0, floatval($bg['marking_padding_percent']));
            }

            $asg = $pdo->prepare("
                INSERT INTO background_products
                    (background_id, product_id, x_percent, y_percent, w_percent, h_percent,
                     padding_percent, z_index, sort_order, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1)
                ON DUPLICATE KEY UPDATE is_active = 1
            ");
            $asg->execute(array(
                $background_id, $newProductId,
                round($xPct, 2), round($yPct, 2), round($wPct, 2), round($hPct, 2),
                round($padPct, 2)
            ));

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