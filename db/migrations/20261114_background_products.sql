-- ---------------------------------------------------------------------------
-- Product Placement Visualizer - migration: per-background product placement
-- ---------------------------------------------------------------------------
-- Adds the `background_products` mapping table and stores the natural pixel
-- size of every background / product image so any client (web, Android) can
-- reproduce the exact same geometry with a single "fit / contain" rule.
--
-- Placement values are PERCENTAGES of the rendered background image box:
--   x_percent, y_percent   -> top-left corner of the product box
--   w_percent, h_percent   -> size of the product box
--   padding_percent        -> inset of the product image inside its own box,
--                             expressed as a percentage of the box size
-- A product can be assigned to many backgrounds; each assignment carries its
-- own placement, so the same door can sit differently in every room.
--
-- This file DOCUMENTS the resulting schema. Apply it with
-- db/migrate_to_background_products.php, which checks information_schema first
-- and is therefore safe to re-run.
-- ---------------------------------------------------------------------------

-- 1. Natural image size of backgrounds --------------------------------------
ALTER TABLE `backgrounds`
    ADD COLUMN `image_width`  INT(11) UNSIGNED NULL DEFAULT NULL AFTER `image_filename`,
    ADD COLUMN `image_height` INT(11) UNSIGNED NULL DEFAULT NULL AFTER `image_width`;

-- 2. Natural image size of products (used to lock aspect ratio in the editor)
ALTER TABLE `products`
    ADD COLUMN `image_width`  INT(11) UNSIGNED NULL DEFAULT NULL AFTER `image_filename`,
    ADD COLUMN `image_height` INT(11) UNSIGNED NULL DEFAULT NULL AFTER `image_width`;

-- 3. The mapping table ------------------------------------------------------
CREATE TABLE IF NOT EXISTS `background_products` (
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
    CONSTRAINT `bp_ibfk_background`
        FOREIGN KEY (`background_id`) REFERENCES `backgrounds` (`id`) ON DELETE CASCADE,
    CONSTRAINT `bp_ibfk_product`
        FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Data migration (performed by db/migrate_to_background_products.php):
--
--   INSERT IGNORE INTO background_products
--       (background_id, product_id, x_percent, y_percent, w_percent, h_percent,
--        padding_percent, z_index, sort_order, is_active)
--   SELECT p.background_id, p.id,
--          b.marking_left_percent, b.marking_top_percent,
--          b.marking_width_percent, b.marking_height_percent,
--          b.marking_padding_percent, 0, 0, 1
--   FROM products p
--   JOIN backgrounds b ON b.id = p.background_id
--   WHERE p.background_id IS NOT NULL;
--
-- The legacy `marking_*_percent` columns on `backgrounds` are kept untouched so
-- older endpoints (api/backgrounds.php, get_product_fullscreen.php) keep
-- working; they are simply no longer the source of truth for placement.
-- ---------------------------------------------------------------------------