<?php
// api/rooms.php
// Returns the list of "rooms" for the Android client. A room is simply an
// existing background row; every background field is preserved (id, name,
// imageUrl, marking_*_percent, created_at, updated_at, product_count) so the
// client can use either representation. Nested products are intentionally
// omitted (fetch them via products.php?background_id=N when needed).

require_once __DIR__ . '/api_helpers.php';

pv_send_cors();

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

if ($method !== 'GET') {
    pv_error(405, 'method_not_allowed', 'Only GET is allowed for this endpoint.');
}

try {
    $stmt = $pdo->prepare("
        SELECT b.*, COUNT(p.id) AS product_count
        FROM Backgrounds b
        LEFT JOIN Products p ON b.id = p.background_id
        GROUP BY b.id
        ORDER BY b.created_at DESC
    ");
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    error_log('rooms.php query failed: ' . $e->getMessage());
    pv_error(500, 'server_error', 'Failed to load rooms.');
}

$rooms = array();
foreach ($rows as $bg) {
    // For each room keep every scalar field from backgrounds.php, but drop the
    // nested products[] array (not part of the rooms payload).
    $room = array(
        'id'                     => isset($bg['id']) ? (int) $bg['id'] : null,
        'name'                   => isset($bg['name']) ? $bg['name'] : null,
        'image_filename'         => isset($bg['image_filename']) ? $bg['image_filename'] : null,
        'imageUrl'               => isset($bg['image_filename']) ? UPLOADS_BASE_URL . '/backgrounds/' . $bg['image_filename'] : null,
        'marking_top_percent'    => isset($bg['marking_top_percent']) ? $bg['marking_top_percent'] : null,
        'marking_left_percent'   => isset($bg['marking_left_percent']) ? $bg['marking_left_percent'] : null,
        'marking_width_percent'  => isset($bg['marking_width_percent']) ? $bg['marking_width_percent'] : null,
        'marking_height_percent' => isset($bg['marking_height_percent']) ? $bg['marking_height_percent'] : null,
        'marking_padding_percent'=> isset($bg['marking_padding_percent']) ? $bg['marking_padding_percent'] : null,
        'created_at'             => isset($bg['created_at']) ? $bg['created_at'] : null,
        'updated_at'             => isset($bg['updated_at']) ? $bg['updated_at'] : null,
        'product_count'          => isset($bg['product_count']) ? (int) $bg['product_count'] : 0
    );

    // Preserve any extra columns that may exist in the table in the future.
    foreach ($bg as $key => $value) {
        if (!array_key_exists($key, $room) && $key !== 'products') {
            $room[$key] = $value;
        }
    }

    $rooms[] = $room;
}

pv_json(array('rooms' => $rooms));