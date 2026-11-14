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

// URL Parsing: /api/backgrounds/{id}
$request_uri_parts = explode('/', trim($_SERVER['REQUEST_URI'], '/'));
$request_uri_parts = array_values(array_filter($request_uri_parts)); // Reindex after filter
$background_id = null;

// Simple routing - look for numeric ID in URL
foreach ($request_uri_parts as $part) {
    if (is_numeric($part)) {
        $background_id = (int)$part;
        break;
    }
}

// Also check for id parameter in query string
if (!$background_id && isset($_GET['id']) && is_numeric($_GET['id'])) {
    $background_id = (int)$_GET['id'];
}

// --- ROUTING ---
switch ($method) {
    case 'GET':
        if ($background_id) {
            getBackgroundById($pdo, $background_id);
        } else {
            getAllBackgrounds($pdo);
        }
        break;
    case 'POST':
        createBackground($pdo);
        break;
    case 'PUT':
        if ($background_id) {
            updateBackground($pdo, $background_id);
        } else {
            send_json_response(array('error' => 'Background ID required for update'), 400);
        }
        break;
    case 'DELETE':
        if ($background_id) {
            deleteBackground($pdo, $background_id);
        } else {
            send_json_response(array('error' => 'Background ID required for deletion'), 400);
        }
        break;
    default:
        send_json_response(array('error' => 'Method not allowed'), 405);
}

// --- CONTROLLER FUNCTIONS ---

function getAllBackgrounds($pdo) {
    try {
        $stmt = $pdo->prepare("
            SELECT b.*, COUNT(p.id) as product_count
            FROM Backgrounds b
            LEFT JOIN Products p ON b.id = p.background_id
            GROUP BY b.id
            ORDER BY b.created_at DESC
        ");
        $stmt->execute();
        $backgrounds = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($backgrounds as &$bg) { // Pass by reference
            if (isset($bg['image_filename'])) {
                $bg['imageUrl'] = UPLOADS_BASE_URL . '/backgrounds/' . $bg['image_filename'];
            }

            $productStmt = $pdo->prepare("SELECT * FROM Products WHERE background_id = ? ORDER BY created_at DESC");
            $productStmt->execute(array($bg['id']));
            $products = $productStmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($products as &$product) { // Pass by reference
                if (isset($product['image_filename'])) {
                    $product['imageUrl'] = UPLOADS_BASE_URL . '/products/' . $product['image_filename'];
                }
            }
            unset($product); // Unset reference
            $bg['products'] = $products;
        }
        unset($bg); // Unset reference

        send_json_response($backgrounds);
    } catch (PDOException $e) {
        send_json_response(array('error' => 'Failed to fetch backgrounds: ' . $e->getMessage()), 500);
    }
}

function getBackgroundById($pdo, $background_id) {
    try {
        $stmt = $pdo->prepare("SELECT * FROM Backgrounds WHERE id = ?");
        $stmt->execute(array($background_id));
        $background = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$background) {
            send_json_response(array('error' => 'Background not found'), 404);
            return;
        }

        if (isset($background['image_filename'])) {
            $background['imageUrl'] = UPLOADS_BASE_URL . '/backgrounds/' . $background['image_filename'];
        }

        $productStmt = $pdo->prepare("SELECT * FROM Products WHERE background_id = ? ORDER BY created_at DESC");
        $productStmt->execute(array($background_id));
        $products = $productStmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($products as &$product) { // Pass by reference
            if (isset($product['image_filename'])) {
                $product['imageUrl'] = UPLOADS_BASE_URL . '/products/' . $product['image_filename'];
            }
        }
        unset($product); // Unset reference
        $background['products'] = $products;

        send_json_response($background);
    } catch (PDOException $e) {
        send_json_response(array('error' => 'Failed to fetch background: ' . $e->getMessage()), 500);
    }
}

function createBackground($pdo) {
    $name = isset($_POST['name']) && !empty($_POST['name']) ? $_POST['name'] : 'Untitled Background';

    // Check if the file exists in $_FILES and if there was an upload error
    if (empty($_FILES["backgroundImage"]) || $_FILES["backgroundImage"]["error"] !== UPLOAD_ERR_OK) {
        // Determine a more specific error message based on the error code
        $upload_error_message = "Background image is required or upload failed."; // Default message
        if (isset($_FILES["backgroundImage"]["error"])) {
            switch ($_FILES["backgroundImage"]["error"]) {
                case UPLOAD_ERR_INI_SIZE:
                    $upload_error_message = "The uploaded file exceeds the upload_max_filesize directive in php.ini.";
                    break;
                case UPLOAD_ERR_FORM_SIZE:
                    $upload_error_message = "The uploaded file exceeds the MAX_FILE_SIZE directive that was specified in the HTML form.";
                    break;
                case UPLOAD_ERR_PARTIAL:
                    $upload_error_message = "The uploaded file was only partially uploaded.";
                    break;
                case UPLOAD_ERR_NO_FILE:
                    $upload_error_message = "No file was uploaded.";
                    break;
                case UPLOAD_ERR_NO_TMP_DIR:
                    $upload_error_message = "Missing a temporary folder for storing uploaded files.";
                    break;
                case UPLOAD_ERR_CANT_WRITE:
                    $upload_error_message = "Failed to write file to disk.";
                    break;
                case UPLOAD_ERR_EXTENSION:
                    $upload_error_message = "A PHP extension stopped the file upload.";
                    break;
                default:
                    $upload_error_message = "An unknown upload error occurred. Code: " . $_FILES["backgroundImage"]["error"];
            }
        } elseif (empty($_FILES["backgroundImage"])) {             $upload_error_message = 'No file data received in the request (empty $_FILES["backgroundImage"]). Check form encoding and field name.';        }

        send_json_response(array("error" => $upload_error_message), 400);
        return;
    }

    // Corrected marking area data handling for PHP 5.6
    $marking_top_percent    = isset($_POST['marking_top_percent'])    ? floatval($_POST['marking_top_percent'])    : 0.0;
    $marking_left_percent   = isset($_POST['marking_left_percent'])   ? floatval($_POST['marking_left_percent'])   : 0.0;
    $marking_width_percent  = isset($_POST['marking_width_percent'])  ? floatval($_POST['marking_width_percent'])  : 100.0;
    $marking_height_percent = isset($_POST['marking_height_percent']) ? floatval($_POST['marking_height_percent']) : 100.0;
    $marking_padding_percent = isset($_POST['marking_padding_percent']) ? floatval($_POST['marking_padding_percent']) : 0.0;

    // Validate ranges
    $marking_top_percent = max(0, min(100, $marking_top_percent));
    $marking_left_percent = max(0, min(100, $marking_left_percent));
    $marking_width_percent = max(1, min(100, $marking_width_percent));
    $marking_height_percent = max(1, min(100, $marking_height_percent));
    $marking_padding_percent = max(0, min(50, $marking_padding_percent));

    $file = $_FILES['backgroundImage'];

    $allowedTypes = array('image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp');
    if (!in_array($file['type'], $allowedTypes)) {
        send_json_response(array('error' => 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), 400);
        return;
    }

    // Ensure BACKGROUND_UPLOADS_DIR and generate_unique_filename are defined in config.php
    $image_filename = generate_unique_filename($file['name'], BACKGROUND_UPLOADS_DIR);
    $uploadPath = BACKGROUND_UPLOADS_DIR . '/' . $image_filename;

    if (move_uploaded_file($file['tmp_name'], $uploadPath)) {
        try {
            // Record the natural pixel size so every client (web + Android) can
            // reproduce the exact same geometry. NULL is tolerated; v1 reads it
            // from the file on demand when it is missing.
            $image_width = null;
            $image_height = null;
            $size = @getimagesize($uploadPath);
            if ($size !== false && !empty($size[0]) && !empty($size[1])) {
                $image_width = (int) $size[0];
                $image_height = (int) $size[1];
            }

            $sql = "INSERT INTO Backgrounds (name, image_filename, image_width, image_height,
                    marking_top_percent, marking_left_percent,
                    marking_width_percent, marking_height_percent, marking_padding_percent)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
            $stmt = $pdo->prepare($sql);
            $stmt->execute(array(
                $name,
                $image_filename,
                $image_width,
                $image_height,
                $marking_top_percent,
                $marking_left_percent,
                $marking_width_percent,
                $marking_height_percent,
                $marking_padding_percent
            ));

            $newBackgroundId = $pdo->lastInsertId();
            getBackgroundById($pdo, $newBackgroundId);

        } catch (PDOException $e) {
            if (file_exists($uploadPath)) {
                unlink($uploadPath);
            }
            send_json_response(array('error' => 'Failed to create background: ' . $e->getMessage()), 500);
        }
    } else {
        send_json_response(array('error' => 'Failed to move uploaded background file.'), 500);
    }
}

function updateBackground($pdo, $background_id) {
    // Ensure get_input_data() is PHP 5.6 compatible and defined in config.php
    $data = get_input_data();

    $stmt = $pdo->prepare("SELECT id FROM Backgrounds WHERE id = ?");
    $stmt->execute(array($background_id));
    if (!$stmt->fetch(PDO::FETCH_ASSOC)) {
        send_json_response(array('error' => 'Background not found for update'), 404);
        return;
    }

    $fieldsToUpdate = array();
    $params = array();

    if (isset($data['name'])) {
        $fieldsToUpdate[] = "name = ?";
        $params[] = $data['name'];
    }

    if (isset($data['marking_top_percent'])) {
        $fieldsToUpdate[] = "marking_top_percent = ?";
        $params[] = max(0, min(100, floatval($data['marking_top_percent'])));
    }
    if (isset($data['marking_left_percent'])) {
        $fieldsToUpdate[] = "marking_left_percent = ?";
        $params[] = max(0, min(100, floatval($data['marking_left_percent'])));
    }
    if (isset($data['marking_width_percent'])) {
        $fieldsToUpdate[] = "marking_width_percent = ?";
        $params[] = max(1, min(100, floatval($data['marking_width_percent'])));
    }
    if (isset($data['marking_height_percent'])) {
        $fieldsToUpdate[] = "marking_height_percent = ?";
        $params[] = max(1, min(100, floatval($data['marking_height_percent'])));
    }
    if (isset($data['marking_padding_percent'])) {
        $fieldsToUpdate[] = "marking_padding_percent = ?";
        $params[] = max(0, min(50, floatval($data['marking_padding_percent'])));
    }

    if (empty($fieldsToUpdate)) {
        send_json_response(array('error' => 'No fields to update provided for background.'), 400);
        return;
    }

    $sql = "UPDATE Backgrounds SET " . implode(', ', $fieldsToUpdate) . ", updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    $params[] = $background_id;

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        getBackgroundById($pdo, $background_id);
    } catch (PDOException $e) {
        send_json_response(array('error' => 'Failed to update background: ' . $e->getMessage()), 500);
    }
}

function deleteBackground($pdo, $background_id) {
    // Define upload directories (ensure these constants are defined in config.php)
    // Assuming BACKGROUND_UPLOADS_DIR and PRODUCT_UPLOADS_DIR are defined globally or in config.php
    if (!defined('BACKGROUND_UPLOADS_DIR') || !defined('PRODUCT_UPLOADS_DIR')) {
         send_json_response(array('error' => 'Upload directory constants not defined.'), 500);
         return;
    }

    $background_image_filename = null;
    $product_image_filenames = array();

    try {
        $pdo->beginTransaction();

        // 1. Get background image filename
        $stmtBg = $pdo->prepare("SELECT image_filename FROM Backgrounds WHERE id = ?");
        $stmtBg->execute(array($background_id));
        $background = $stmtBg->fetch(PDO::FETCH_ASSOC);

        if (!$background) {
            $pdo->rollBack(); // Rollback before sending response
            send_json_response(array('error' => 'Background not found for deletion'), 404);
            return;
        }
        $background_image_filename = $background['image_filename'];

        // 2. Decide what happens to the products that were placed here.
        //
        // In the per-background model a product may also live on OTHER
        // backgrounds. Because products.background_id is a legacy NOT NULL FK
        // with ON DELETE CASCADE, deleting this background would otherwise wipe
        // any product that happens to share the room. To avoid that data loss:
        //   - products ALSO assigned elsewhere  -> re-point their legacy
        //     background_id to that other background so the cascade misses them
        //   - products ONLY in this background  -> left to cascade (truly orphaned)
        $sharedProducts = array();
        $stmtShared = $pdo->prepare("
            SELECT bp.product_id, MIN(other.background_id) AS rescue_bg
            FROM background_products bp
            JOIN background_products other
                 ON other.product_id = bp.product_id
                AND other.background_id <> bp.background_id
                AND other.is_active = 1
            WHERE bp.background_id = ?
            GROUP BY bp.product_id
        ");
        $stmtShared->execute(array($background_id));
        foreach ($stmtShared->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!empty($row['rescue_bg'])) {
                $sharedProducts[(int) $row['product_id']] = (int) $row['rescue_bg'];
            }
        }
        if (!empty($sharedProducts)) {
            $repoint = $pdo->prepare("UPDATE Products SET background_id = ? WHERE id = ?");
            foreach ($sharedProducts as $pid => $rescueBg) {
                $repoint->execute(array($rescueBg, $pid));
            }
        }

        // 3. Only collect the image files of products that will actually be
        //    removed (i.e. NOT shared). Shared products keep their files.
        $stmtProd = $pdo->prepare("SELECT id, image_filename FROM Products WHERE background_id = ?");
        $stmtProd->execute(array($background_id));
        $products = $stmtProd->fetchAll(PDO::FETCH_ASSOC);
        foreach ($products as $product) {
            if (isset($sharedProducts[(int) $product['id']])) {
                continue; // rescuing this product; keep its file
            }
            if (!empty($product['image_filename'])) {
                $product_image_filenames[] = $product['image_filename'];
            }
        }

        // 3b. Remove the product rows that live ONLY in this background.
        //     background_products assignments for this background are removed
        //     by ON DELETE CASCADE when the background row is deleted below.
        $deleteOrphans = $pdo->prepare("
            DELETE FROM Products
            WHERE background_id = ?
              AND id NOT IN (
                  SELECT product_id FROM background_products
                  WHERE background_id <> ? AND is_active = 1
              )
        ");
        $deleteOrphans->execute(array($background_id, $background_id));

        // 4. Delete the background record
        $deleteBackgroundStmt = $pdo->prepare("DELETE FROM Backgrounds WHERE id = ?");
        $deleteBackgroundStmt->execute(array($background_id));

        // 5. Commit the transaction (Database changes are now permanent)
        $pdo->commit();

        // 6. Delete files AFTER successful commit
        $deleted_files_count = 0;
        $failed_files_count = 0;
        $messages = array();

        // Delete background image file
        if ($background_image_filename) {
            $background_filepath = BACKGROUND_UPLOADS_DIR . '/' . $background_image_filename;
            if (file_exists($background_filepath)) {
                if (@unlink($background_filepath)) { // Use @ to suppress warnings if permissions fail etc.
                    $deleted_files_count++;
                    $messages[] = "Deleted background file: " . $background_image_filename;
                } else {
                    $failed_files_count++;
                    $messages[] = "Failed to delete background file: " . $background_image_filename;
                    // Log this error server-side if possible
                    error_log("Failed to delete background file: " . $background_filepath);
                }
            } else {
                 $messages[] = "Background file not found, skipping deletion: " . $background_image_filename;
            }
        }

        // Delete product image files
        foreach ($product_image_filenames as $filename) {
            $product_filepath = PRODUCT_UPLOADS_DIR . '/' . $filename;
            if (file_exists($product_filepath)) {
                if (@unlink($product_filepath)) {
                    $deleted_files_count++;
                    $messages[] = "Deleted product file: " . $filename;
                } else {
                    $failed_files_count++;
                    $messages[] = "Failed to delete product file: " . $filename;
                    // Log this error server-side if possible
                    error_log("Failed to delete product file: " . $product_filepath);
                }
            } else {
                 $messages[] = "Product file not found, skipping deletion: " . $filename;
            }
        }

        // Send success response
        $final_message = 'Background record and associated product records deleted successfully from database. ';
        $final_message .= "Attempted to delete " . ($deleted_files_count + $failed_files_count) . " associated files. ";
        $final_message .= "Successfully deleted: " . $deleted_files_count . ". Failed: " . $failed_files_count . ".";

        send_json_response(array(
            'message' => $final_message,
            'details' => $messages // Optionally include detailed messages
        ));

    } catch (PDOException $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        // Log the detailed error internally if possible, provide a generic error to the client
        error_log("Failed to delete background ID $background_id (DB operation): " . $e->getMessage());
        send_json_response(array('error' => 'Failed to delete background record from database: ' . $e->getMessage()), 500);
    } catch (Exception $e) { // Catch potential file operation errors if not suppressed
         if ($pdo->inTransaction()) {
            $pdo->rollBack(); // Ensure rollback even if DB commit succeeded but file ops failed before response
        }
        error_log("Error during file deletion for background ID $background_id: " . $e->getMessage());
        send_json_response(array('error' => 'Database records deleted, but error occurred during file deletion: ' . $e->getMessage()), 500); // Indicate partial success/failure
    }
}
?>