<?php
/**
 * api/v1/index.php - Versioned JSON API for the Product Placement Visualizer.
 * ---------------------------------------------------------------------------
 * Clean, stable URLs for the Android app and any future client.
 * Placement is expressed ONLY as percentages of the rendered background image
 * box, with a fixed 2-decimal precision.
 *
 * Routes
 *   GET    /api/v1/backgrounds
 *   GET    /api/v1/backgrounds/{id}/products
 *   GET    /api/v1/products                      (catalog + assigned background ids)
 *   GET    /api/v1/products/{id}
 *   POST   /api/v1/backgrounds/{id}/products                      assign / upsert
 *   PUT    /api/v1/backgrounds/{id}/products/{productId}          update placement
 *   DELETE /api/v1/backgrounds/{id}/products/{productId}          unassign
 *
 * The same routes also work as /api/v1/index.php/... when mod_rewrite is off.
 */

require_once __DIR__ . '/../api_helpers.php'; // $pdo, UPLOADS_BASE_URL, pv_json/pv_error, CORS

pv_send_cors();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to 2 decimals as a float (stable JSON output, no float noise). */
function v1_round2($value) {
    if (!is_numeric($value)) { return 0.0; }
    return round((float) $value, 2);
}

/** Absolute URL for a stored filename in uploads/<folder>/. */
function v1_image_url($folder, $filename) {
    if (!$filename) { return null; }
    return UPLOADS_BASE_URL . '/' . $folder . '/' . rawurlencode($filename);
}

/**
 * Natural pixel size of an image, cached in the DB columns.
 * Falls back to reading the file and persisting the result.
 */
function v1_image_size(PDO $pdo, $table, $rowId, $folder, $filename, $w, $h) {
    if (!empty($w) && !empty($h)) {
        return array((int) $w, (int) $h);
    }
    if (!$filename) { return array(null, null); }

    $const = ($folder === 'backgrounds') ? 'BACKGROUND_UPLOADS_DIR' : 'PRODUCT_UPLOADS_DIR';
    $path  = (defined($const) ? constant($const) : '') . '/' . $filename;
    if (!is_file($path)) { return array(null, null); }

    $info = @getimagesize($path);
    if ($info === false || empty($info[0]) || empty($info[1])) { return array(null, null); }

    $iw = (int) $info[0];
    $ih = (int) $info[1];
    if ($table === 'backgrounds') {
        $up = $pdo->prepare("UPDATE backgrounds SET image_width = ?, image_height = ? WHERE id = ?");
    } else {
        $up = $pdo->prepare("UPDATE products SET image_width = ?, image_height = ? WHERE id = ?");
    }
    $up->execute(array($iw, $ih, $rowId));

    return array($iw, $ih);
}

/** Product detail rows, normalized for the API. */
function v1_fetch_details(PDO $pdo, $productId) {
    $out = array();
    try {
        $stmt = $pdo->prepare("
            SELECT id, detail_type, detail_label, detail_value, display_order,
                   sticker_image_filename, sticker_position
            FROM product_details
            WHERE product_id = ?
            ORDER BY display_order ASC, id ASC
        ");
        $stmt->execute(array($productId));
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $d) {
            $out[] = array(
                'id'                => (int) $d['id'],
                'type'              => $d['detail_type'],
                'label'             => $d['detail_label'],
                'value'             => $d['detail_value'],
                'display_order'     => (int) $d['display_order'],
                'sticker_image_url' => v1_image_url('stickers', $d['sticker_image_filename']),
                'sticker_position'  => $d['sticker_position'],
            );
        }
    } catch (PDOException $e) {
        error_log('v1_fetch_details: ' . $e->getMessage());
    }
    return $out;
}

/** Normalize one placement row into the documented placement object. */
function v1_placement($row) {
    return array(
        'x'       => v1_round2($row['x_percent']),
        'y'       => v1_round2($row['y_percent']),
        'w'       => v1_round2($row['w_percent']),
        'h'       => v1_round2($row['h_percent']),
        'padding' => v1_round2($row['padding_percent']),
        'z_index' => (int) $row['z_index'],
    );
}

/**
 * Validate a placement. Returns an error string, or null when valid.
 * Rules: 0 <= x,y ; x+w <= 100 ; y+h <= 100 ; w,h > 0 ; padding >= 0.
 */
function v1_validate_placement($x, $y, $w, $h, $padding) {
    if ($w <= 0 || $h <= 0) {
        return 'w and h must be greater than 0.';
    }
    if ($x < 0 || $y < 0) {
        return 'x and y must be greater than or equal to 0.';
    }
    if ($padding < 0) {
        return 'padding must be greater than or equal to 0.';
    }
    if (($x + $w) > 100.0000001) {
        return 'x + w must not exceed 100.';
    }
    if (($y + $h) > 100.0000001) {
        return 'y + h must not exceed 100.';
    }
    return null;
}

/** Read a numeric field from a request body with a default. */
function v1_body_num($body, $key, $default) {
    if (is_array($body) && array_key_exists($key, $body) && is_numeric($body[$key])) {
        return (float) $body[$key];
    }
    return (float) $default;
}

/** Parse a JSON (or form) request body. */
function v1_read_body() {
    $contentType = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
    if (stripos($contentType, 'application/json') !== false) {
        $raw = file_get_contents('php://input');
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : array();
    }
    return $_POST;
}

/** Extract the path segments that follow "/v1". */
function v1_path_segments() {
    if (!empty($_SERVER['PATH_INFO'])) {
        $path = $_SERVER['PATH_INFO'];
    } else {
        $uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
        $uri = strtok($uri, '?'); // drop query string
        $pos = strpos($uri, '/v1');
        if ($pos !== false) {
            $path = substr($uri, $pos + 3);
        } else {
            $path = $uri;
        }
        $path = preg_replace('#^/index\.php#', '', $path);
    }
    $segments = explode('/', trim($path, '/'));
    return array_values(array_filter($segments, function ($s) { return $s !== ''; }));
}

$segments = v1_path_segments();
$method   = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
$resource = isset($segments[0]) ? strtolower($segments[0]) : '';

// ---------------------------------------------------------------------------
// GET /backgrounds
// ---------------------------------------------------------------------------
if ($resource === 'backgrounds' && !isset($segments[1]) && $method === 'GET') {
    try {
        $stmt = $pdo->query("
            SELECT b.id, b.name, b.image_filename, b.image_width, b.image_height,
                   COUNT(bp.id) AS product_count
            FROM backgrounds b
            LEFT JOIN background_products bp
                   ON bp.background_id = b.id AND bp.is_active = 1
            GROUP BY b.id
            ORDER BY b.created_at DESC, b.id DESC
        ");
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        error_log('v1 backgrounds: ' . $e->getMessage());
        pv_error(500, 'server_error', 'Failed to load backgrounds.');
    }

    $out = array();
    foreach ($rows as $b) {
        list($iw, $ih) = v1_image_size($pdo, 'backgrounds', $b['id'], 'backgrounds',
            $b['image_filename'], $b['image_width'], $b['image_height']);
        $out[] = array(
            'id'            => (int) $b['id'],
            'name'          => $b['name'],
            'image_url'     => v1_image_url('backgrounds', $b['image_filename']),
            'image_width'   => $iw,
            'image_height'  => $ih,
            'product_count' => (int) $b['product_count'],
        );
    }
    pv_json($out);
}

// ---------------------------------------------------------------------------
// GET /backgrounds/{id}/products
// ---------------------------------------------------------------------------
if ($resource === 'backgrounds' && isset($segments[1]) && isset($segments[2])
    && strtolower($segments[2]) === 'products' && $method === 'GET') {

    $backgroundId = (int) $segments[1];

    try {
        $stmt = $pdo->prepare("SELECT * FROM backgrounds WHERE id = ?");
        $stmt->execute(array($backgroundId));
        $bg = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        error_log('v1 bg products: ' . $e->getMessage());
        pv_error(500, 'server_error', 'Failed to load background.');
    }

    if (!$bg) {
        pv_error(404, 'not_found', 'Background not found.');
    }

    list($iw, $ih) = v1_image_size($pdo, 'backgrounds', $bg['id'], 'backgrounds',
        $bg['image_filename'], $bg['image_width'], $bg['image_height']);

    try {
        $stmt = $pdo->prepare("
            SELECT bp.*, p.name, p.description, p.image_filename,
                   p.image_width, p.image_height
            FROM background_products bp
            JOIN products p ON p.id = bp.product_id
            WHERE bp.background_id = ? AND bp.is_active = 1
            ORDER BY bp.z_index ASC, bp.sort_order ASC, bp.id ASC
        ");
        $stmt->execute(array($backgroundId));
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        error_log('v1 bg products join: ' . $e->getMessage());
        pv_error(500, 'server_error', 'Failed to load products for the background.');
    }

    $products = array();
    foreach ($rows as $r) {
        list($pw, $ph) = v1_image_size($pdo, 'products', $r['product_id'], 'products',
            $r['image_filename'], $r['image_width'], $r['image_height']);

        $products[] = array(
            'product_id'   => (int) $r['product_id'],
            'name'         => $r['name'],
            'description'  => $r['description'],
            'image_url'    => v1_image_url('products', $r['image_filename']),
            'image_width'  => $pw,
            'image_height' => $ph,
            'details'      => v1_fetch_details($pdo, $r['product_id']),
            'placement'    => v1_placement($r),
        );
    }

    pv_json(array(
        'background' => array(
            'id'           => (int) $bg['id'],
            'name'         => $bg['name'],
            'image_url'    => v1_image_url('backgrounds', $bg['image_filename']),
            'image_width'  => $iw,
            'image_height' => $ih,
        ),
        'products' => $products,
    ));
}

// ---------------------------------------------------------------------------
// GET /products  (catalog + which backgrounds each product is on)
// ---------------------------------------------------------------------------
if ($resource === 'products' && !isset($segments[1]) && $method === 'GET') {
    try {
        $stmt = $pdo->query("
            SELECT id, name, description, image_filename, image_width, image_height,
                   created_at
            FROM products
            ORDER BY created_at DESC, id DESC
        ");
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $map = array();
        $assignStmt = $pdo->query("
            SELECT product_id, background_id
            FROM background_products
            WHERE is_active = 1
        ");
        foreach ($assignStmt->fetchAll(PDO::FETCH_ASSOC) as $a) {
            $pid = (int) $a['product_id'];
            if (!isset($map[$pid])) { $map[$pid] = array(); }
            $map[$pid][] = (int) $a['background_id'];
        }
    } catch (PDOException $e) {
        error_log('v1 products catalog: ' . $e->getMessage());
        pv_error(500, 'server_error', 'Failed to load product catalog.');
    }

    $out = array();
    foreach ($rows as $p) {
        list($pw, $ph) = v1_image_size($pdo, 'products', $p['id'], 'products',
            $p['image_filename'], $p['image_width'], $p['image_height']);
        $out[] = array(
            'id'             => (int) $p['id'],
            'name'           => $p['name'],
            'description'    => $p['description'],
            'image_url'      => v1_image_url('products', $p['image_filename']),
            'image_width'    => $pw,
            'image_height'   => $ph,
            'background_ids' => isset($map[(int) $p['id']]) ? $map[(int) $p['id']] : array(),
            'created_at'     => $p['created_at'],
        );
    }
    pv_json(array('products' => $out, 'count' => count($out)));
}

// ---------------------------------------------------------------------------
// GET /products/{id}
// ---------------------------------------------------------------------------
if ($resource === 'products' && isset($segments[1]) && $method === 'GET') {
    $productId = (int) $segments[1];

    try {
        $stmt = $pdo->prepare("SELECT * FROM products WHERE id = ?");
        $stmt->execute(array($productId));
        $p = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        error_log('v1 product detail: ' . $e->getMessage());
        pv_error(500, 'server_error', 'Failed to load product.');
    }

    if (!$p) {
        pv_error(404, 'not_found', 'Product not found.');
    }

    list($pw, $ph) = v1_image_size($pdo, 'products', $p['id'], 'products',
        $p['image_filename'], $p['image_width'], $p['image_height']);

    $placements = array();
    try {
        $stmt = $pdo->prepare("
            SELECT bp.*, b.name AS background_name, b.image_filename AS background_filename,
                   b.image_width AS bg_w, b.image_height AS bg_h
            FROM background_products bp
            JOIN backgrounds b ON b.id = bp.background_id
            WHERE bp.product_id = ? AND bp.is_active = 1
            ORDER BY bp.background_id ASC
        ");
        $stmt->execute(array($productId));
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $placements[] = array(
                'background_id'        => (int) $row['background_id'],
                'background_name'      => $row['background_name'],
                'background_image_url' => v1_image_url('backgrounds', $row['background_filename']),
                'background_width'     => $row['bg_w'] ? (int) $row['bg_w'] : null,
                'background_height'    => $row['bg_h'] ? (int) $row['bg_h'] : null,
                'placement'            => v1_placement($row),
            );
        }
    } catch (PDOException $e) {
        error_log('v1 product placements: ' . $e->getMessage());
    }

    pv_json(array(
        'id'           => (int) $p['id'],
        'name'         => $p['name'],
        'description'  => $p['description'],
        'image_url'    => v1_image_url('products', $p['image_filename']),
        'image_width'  => $pw,
        'image_height' => $ph,
        'created_at'   => $p['created_at'],
        'updated_at'   => $p['updated_at'],
        'details'      => v1_fetch_details($pdo, $productId),
        'placements'   => $placements,
    ));
}

// ---------------------------------------------------------------------------
// POST /backgrounds/{id}/products  -> assign or upsert placement
// ---------------------------------------------------------------------------
if ($resource === 'backgrounds' && isset($segments[1]) && isset($segments[2])
    && strtolower($segments[2]) === 'products' && $method === 'POST') {

    pv_check_optional_token();

    $backgroundId = (int) $segments[1];
    $body = v1_read_body();

    $productId = isset($body['product_id']) && is_numeric($body['product_id'])
        ? (int) $body['product_id'] : 0;
    if ($productId <= 0) {
        pv_error(400, 'bad_request', 'product_id is required.');
    }

    try {
        $stmt = $pdo->prepare("SELECT id FROM backgrounds WHERE id = ?");
        $stmt->execute(array($backgroundId));
        if (!$stmt->fetch(PDO::FETCH_ASSOC)) {
            pv_error(404, 'not_found', 'Background not found.');
        }
        $stmt = $pdo->prepare("SELECT id FROM products WHERE id = ?");
        $stmt->execute(array($productId));
        if (!$stmt->fetch(PDO::FETCH_ASSOC)) {
            pv_error(404, 'not_found', 'Product not found.');
        }
    } catch (PDOException $e) {
        error_log('v1 assign existence: ' . $e->getMessage());
        pv_error(500, 'server_error', 'Failed to verify background/product.');
    }

    $x = v1_body_num($body, 'x', 0);
    $y = v1_body_num($body, 'y', 0);
    $w = v1_body_num($body, 'w', 20);
    $h = v1_body_num($body, 'h', 70);
    $padding = v1_body_num($body, 'padding', 0);
    $zIndex = isset($body['z_index']) && is_numeric($body['z_index']) ? (int) $body['z_index'] : 0;
    $sortOrder = isset($body['sort_order']) && is_numeric($body['sort_order']) ? (int) $body['sort_order'] : 0;
    $isActive = array_key_exists('is_active', $body)
        ? (filter_var($body['is_active'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0) : 1;

    $err = v1_validate_placement($x, $y, $w, $h, $padding);
    if ($err !== null) {
        pv_error(422, 'invalid_placement', $err);
    }

    try {
        $sql = "
            INSERT INTO background_products
                (background_id, product_id, x_percent, y_percent, w_percent, h_percent,
                 padding_percent, z_index, sort_order, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                x_percent = VALUES(x_percent),
                y_percent = VALUES(y_percent),
                w_percent = VALUES(w_percent),
                h_percent = VALUES(h_percent),
                padding_percent = VALUES(padding_percent),
                z_index = VALUES(z_index),
                sort_order = VALUES(sort_order),
                is_active = VALUES(is_active),
                updated_at = CURRENT_TIMESTAMP
        ";
        $stmt = $pdo->prepare($sql);
        $stmt->execute(array(
            $backgroundId, $productId,
            v1_round2($x), v1_round2($y), v1_round2($w), v1_round2($h),
            v1_round2($padding), $zIndex, $sortOrder, $isActive
        ));

        $stmt = $pdo->prepare("SELECT * FROM background_products WHERE background_id = ? AND product_id = ?");
        $stmt->execute(array($backgroundId, $productId));
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        error_log('v1 assign: ' . $e->getMessage());
        pv_error(500, 'server_error', 'Failed to save placement.');
    }

    pv_json(array(
        'ok'            => true,
        'background_id' => $backgroundId,
        'product_id'    => $productId,
        'placement'     => v1_placement($row),
        'is_active'     => (bool) $row['is_active'],
    ));
}

// ---------------------------------------------------------------------------
// PUT /backgrounds/{id}/products/{productId}  -> update placement fields
// ---------------------------------------------------------------------------
if ($resource === 'backgrounds' && isset($segments[1]) && isset($segments[2])
    && strtolower($segments[2]) === 'products' && isset($segments[3]) && $method === 'PUT') {

    pv_check_optional_token();

    $backgroundId = (int) $segments[1];
    $productId    = (int) $segments[3];
    $body = v1_read_body();

    try {
        $stmt = $pdo->prepare("SELECT * FROM background_products WHERE background_id = ? AND product_id = ?");
        $stmt->execute(array($backgroundId, $productId));
        $existing = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        error_log('v1 update fetch: ' . $e->getMessage());
        pv_error(500, 'server_error', 'Failed to load placement.');
    }

    if (!$existing) {
        pv_error(404, 'not_found', 'Placement not found for this background/product.');
    }

    $x = v1_body_num($body, 'x', $existing['x_percent']);
    $y = v1_body_num($body, 'y', $existing['y_percent']);
    $w = v1_body_num($body, 'w', $existing['w_percent']);
    $h = v1_body_num($body, 'h', $existing['h_percent']);
    $padding = v1_body_num($body, 'padding', $existing['padding_percent']);

    $err = v1_validate_placement($x, $y, $w, $h, $padding);
    if ($err !== null) {
        pv_error(422, 'invalid_placement', $err);
    }

    $zIndex = array_key_exists('z_index', $body) && is_numeric($body['z_index'])
        ? (int) $body['z_index'] : (int) $existing['z_index'];
    $sortOrder = array_key_exists('sort_order', $body) && is_numeric($body['sort_order'])
        ? (int) $body['sort_order'] : (int) $existing['sort_order'];
    $isActive = array_key_exists('is_active', $body)
        ? (filter_var($body['is_active'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0)
        : (int) $existing['is_active'];

    try {
        $stmt = $pdo->prepare("
            UPDATE background_products
            SET x_percent = ?, y_percent = ?, w_percent = ?, h_percent = ?,
                padding_percent = ?, z_index = ?, sort_order = ?, is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE background_id = ? AND product_id = ?
        ");
        $stmt->execute(array(
            v1_round2($x), v1_round2($y), v1_round2($w), v1_round2($h),
            v1_round2($padding), $zIndex, $sortOrder, $isActive,
            $backgroundId, $productId
        ));

        $stmt = $pdo->prepare("SELECT * FROM background_products WHERE background_id = ? AND product_id = ?");
        $stmt->execute(array($backgroundId, $productId));
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        error_log('v1 update: ' . $e->getMessage());
        pv_error(500, 'server_error', 'Failed to update placement.');
    }

    pv_json(array(
        'ok'            => true,
        'background_id' => $backgroundId,
        'product_id'    => $productId,
        'placement'     => v1_placement($row),
        'is_active'     => (bool) $row['is_active'],
    ));
}

// ---------------------------------------------------------------------------
// DELETE /backgrounds/{id}/products/{productId}  -> unassign (soft delete)
// ---------------------------------------------------------------------------
if ($resource === 'backgrounds' && isset($segments[1]) && isset($segments[2])
    && strtolower($segments[2]) === 'products' && isset($segments[3]) && $method === 'DELETE') {

    pv_check_optional_token();

    $backgroundId = (int) $segments[1];
    $productId    = (int) $segments[3];

    try {
        $stmt = $pdo->prepare("
            UPDATE background_products
            SET is_active = 0, updated_at = CURRENT_TIMESTAMP
            WHERE background_id = ? AND product_id = ?
        ");
        $stmt->execute(array($backgroundId, $productId));

        if ($stmt->rowCount() === 0) {
            pv_error(404, 'not_found', 'Placement not found for this background/product.');
        }
    } catch (PDOException $e) {
        error_log('v1 unassign: ' . $e->getMessage());
        pv_error(500, 'server_error', 'Failed to remove product from background.');
    }

    pv_json(array(
        'ok'            => true,
        'background_id' => $backgroundId,
        'product_id'    => $productId,
        'unassigned'    => true,
    ));
}

// ---------------------------------------------------------------------------
// Nothing matched.
// ---------------------------------------------------------------------------
pv_error(404, 'not_found', 'Unknown API route. See API.md for the supported endpoints.');