<?php
/**
 * db/migrate_to_background_products.php
 * ---------------------------------------------------------------------------
 * Idempotent migration for the "products are assigned per background" model.
 *
 * Run from the browser or CLI:
 *     http://localhost/product_presenter/db/migrate_to_background_products.php
 *     php db/migrate_to_background_products.php
 *
 * What it does (safe to re-run any number of times):
 *   1. Adds `image_width` / `image_height` to `backgrounds` when missing.
 *   2. Adds `image_width` / `image_height` to `products` when missing.
 *   3. Creates the `background_products` mapping table when missing.
 *   4. Reads the natural pixel size of every existing image file that does not
 *      have dimensions recorded yet (getimagesize()).
 *   5. Backfills one `background_products` row per legacy product using the
 *      legacy `backgrounds.marking_*_percent` values, so NO SAVED PLACEMENT IS
 *      LOST. Existing mapping rows are never overwritten (INSERT IGNORE).
 *
 * The migration never drops or renames the legacy marking columns, so the old
 * endpoints keep working during the transition.
 */

require_once __DIR__ . '/../api/config.php'; // $pdo + UPLOADS dirs

// Plain-text output regardless of how it is invoked.
header('Content-Type: text/plain; charset=utf-8');

function mig_log($msg) {
    echo $msg . "\n";
    if (function_exists('ob_flush')) { @ob_flush(); }
    @flush();
}

/** Does a column exist on a table? (MySQL/MariaDB) */
function mig_column_exists(PDO $pdo, $table, $column) {
    $stmt = $pdo->prepare("
        SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    ");
    $stmt->execute(array($table, $column));
    return ((int) $stmt->fetchColumn()) > 0;
}

/** Does a table exist in the current schema? */
function mig_table_exists(PDO $pdo, $table) {
    $stmt = $pdo->prepare("
        SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    ");
    $stmt->execute(array($table));
    return ((int) $stmt->fetchColumn()) > 0;
}

/** Read natural size of an image file; returns [w,h] or null. */
function mig_image_size($path) {
    if (!is_file($path)) { return null; }
    $info = @getimagesize($path);
    if ($info === false || empty($info[0]) || empty($info[1])) { return null; }
    return array((int) $info[0], (int) $info[1]);
}

mig_log('== Product Placement Visualizer: background_products migration ==');
mig_log('Database: ' . DB_NAME);

$hadError = false;

try {
    // -----------------------------------------------------------------------
    // 1 & 2. image_width / image_height columns
    // -----------------------------------------------------------------------
    foreach (array('backgrounds', 'products') as $table) {
        if (!mig_table_exists($pdo, $table)) {
            mig_log("WARN: table `$table` does not exist - skipping its DDL.");
            continue;
        }
        if (!mig_column_exists($pdo, $table, 'image_width')) {
            $pdo->exec("ALTER TABLE `$table` ADD COLUMN `image_width` INT(11) UNSIGNED NULL DEFAULT NULL AFTER `image_filename`");
            mig_log("Added column $table.image_width");
        } else {
            mig_log("OK: $table.image_width already present");
        }
        if (!mig_column_exists($pdo, $table, 'image_height')) {
            $pdo->exec("ALTER TABLE `$table` ADD COLUMN `image_height` INT(11) UNSIGNED NULL DEFAULT NULL AFTER `image_width`");
            mig_log("Added column $table.image_height");
        } else {
            mig_log("OK: $table.image_height already present");
        }
    }

    // -----------------------------------------------------------------------
    // 3. background_products mapping table
    // -----------------------------------------------------------------------
    if (!mig_table_exists($pdo, 'background_products')) {
        $pdo->exec("
            CREATE TABLE `background_products` (
                `id`               INT(11)      NOT NULL AUTO_INCREMENT,
                `background_id`    INT(11)      NOT NULL,
                `product_id`       INT(11)      NOT NULL,
                `x_percent`        DECIMAL(5,2) NOT NULL DEFAULT '0.00',
                `y_percent`        DECIMAL(5,2) NOT NULL DEFAULT '0.00',
                `w_percent`        DECIMAL(5,2) NOT NULL DEFAULT '20.00',
                `h_percent`        DECIMAL(5,2) NOT NULL DEFAULT '70.00',
                `padding_percent`  DECIMAL(5,2) NOT NULL DEFAULT '0.00',
                `z_index`          INT(11)      NOT NULL DEFAULT '0',
                `sort_order`       INT(11)      NOT NULL DEFAULT '0',
                `is_active`        TINYINT(1)   NOT NULL DEFAULT '1',
                `created_at`       TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at`       TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uq_background_product` (`background_id`, `product_id`),
                KEY `idx_bp_background_active` (`background_id`, `is_active`),
                KEY `idx_bp_product` (`product_id`),
                CONSTRAINT `bp_ibfk_background` FOREIGN KEY (`background_id`) REFERENCES `backgrounds` (`id`) ON DELETE CASCADE,
                CONSTRAINT `bp_ibfk_product`    FOREIGN KEY (`product_id`)    REFERENCES `products` (`id`)    ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        mig_log('Created table background_products');
    } else {
        mig_log('OK: background_products already present');
    }

    // -----------------------------------------------------------------------
    // 4. Backfill natural image sizes for rows that lack them
    // -----------------------------------------------------------------------
    $bgRows = $pdo->query("SELECT id, image_filename FROM backgrounds WHERE image_width IS NULL OR image_height IS NULL")->fetchAll(PDO::FETCH_ASSOC);
    $bgFixed = 0;
    foreach ($bgRows as $row) {
        $size = mig_image_size(BACKGROUND_UPLOADS_DIR . '/' . $row['image_filename']);
        if ($size) {
            $up = $pdo->prepare("UPDATE backgrounds SET image_width = ?, image_height = ? WHERE id = ?");
            $up->execute(array($size[0], $size[1], $row['id']));
            $bgFixed++;
        }
    }
    mig_log("Background image sizes backfilled: $bgFixed / " . count($bgRows));

    $prodRows = $pdo->query("SELECT id, image_filename FROM products WHERE image_width IS NULL OR image_height IS NULL")->fetchAll(PDO::FETCH_ASSOC);
    $prodFixed = 0;
    foreach ($prodRows as $row) {
        $size = mig_image_size(PRODUCT_UPLOADS_DIR . '/' . $row['image_filename']);
        if ($size) {
            $up = $pdo->prepare("UPDATE products SET image_width = ?, image_height = ? WHERE id = ?");
            $up->execute(array($size[0], $size[1], $row['id']));
            $prodFixed++;
        }
    }
    mig_log("Product image sizes backfilled: $prodFixed / " . count($prodRows));

    // -----------------------------------------------------------------------
    // 5. Backfill placements from the legacy marking_* columns.
    //    INSERT IGNORE => rows already in the mapping table are left as-is, so
    //    re-running this script never clobbers placement edited in the new UI.
    // -----------------------------------------------------------------------
    $before = (int) $pdo->query("SELECT COUNT(*) FROM background_products")->fetchColumn();

    $sql = "
        INSERT IGNORE INTO background_products
            (background_id, product_id, x_percent, y_percent, w_percent, h_percent,
             padding_percent, z_index, sort_order, is_active)
        SELECT p.background_id, p.id,
               COALESCE(b.marking_left_percent, 0),
               COALESCE(b.marking_top_percent, 0),
               COALESCE(b.marking_width_percent, 20),
               COALESCE(b.marking_height_percent, 70),
               COALESCE(b.marking_padding_percent, 0),
               0, 0, 1
        FROM products p
        JOIN backgrounds b ON b.id = p.background_id
        WHERE p.background_id IS NOT NULL
    ";
    $pdo->exec($sql);

    $after = (int) $pdo->query("SELECT COUNT(*) FROM background_products")->fetchColumn();
    mig_log("Legacy placements migrated into background_products: " . ($after - $before) . " new rows (table rows: $before -> $after)");

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    $bgCount   = (int) $pdo->query("SELECT COUNT(*) FROM backgrounds")->fetchColumn();
    $prodCount = (int) $pdo->query("SELECT COUNT(*) FROM products")->fetchColumn();
    mig_log('---');
    mig_log("Total backgrounds: $bgCount, total products: $prodCount, assignments: $after");
    mig_log('Migration completed successfully. Safe to re-run.');
} catch (PDOException $e) {
    $hadError = true;
    mig_log('ERROR: ' . $e->getMessage());
}

if ($hadError) {
    http_response_code(500);
}