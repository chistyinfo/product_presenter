-- phpMyAdmin SQL Dump
-- version 4.7.4
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3306
-- Generation Time: Nov 14, 2026 at 04:54 AM
-- Server version: 5.7.19
-- PHP Version: 7.1.9

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `productvisualizerdb`
--

-- --------------------------------------------------------

--
-- Table structure for table `api_viewer_state`
--

DROP TABLE IF EXISTS `api_viewer_state`;
CREATE TABLE IF NOT EXISTS `api_viewer_state` (
  `id` tinyint(3) UNSIGNED NOT NULL DEFAULT '1',
  `state_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `seq` int(10) UNSIGNED NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `api_viewer_state`
--

INSERT INTO `api_viewer_state` (`id`, `state_json`, `seq`, `updated_at`) VALUES
(1, '{\"productId\":35,\"roomId\":1,\"position\":{\"x\":0.7935,\"y\":0.5565},\"scale\":1,\"flip\":false,\"showInfo\":false,\"seq\":144,\"updatedAt\":\"2026-11-07T07:16:49+00:00\"}', 144, '2026-11-07 01:16:49');

-- --------------------------------------------------------

--
-- Table structure for table `backgrounds`
--

DROP TABLE IF EXISTS `backgrounds`;
CREATE TABLE IF NOT EXISTS `backgrounds` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `image_filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `image_width` int(11) UNSIGNED DEFAULT NULL,
  `image_height` int(11) UNSIGNED DEFAULT NULL,
  `marking_top_percent` decimal(5,2) DEFAULT '0.00',
  `marking_left_percent` decimal(5,2) DEFAULT '0.00',
  `marking_width_percent` decimal(5,2) DEFAULT '100.00',
  `marking_height_percent` decimal(5,2) DEFAULT '100.00',
  `marking_padding_percent` decimal(5,2) DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_backgrounds_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `backgrounds`
--

INSERT INTO `backgrounds` (`id`, `name`, `image_filename`, `image_width`, `image_height`, `marking_top_percent`, `marking_left_percent`, `marking_width_percent`, `marking_height_percent`, `marking_padding_percent`, `created_at`, `updated_at`) VALUES
(3, 'living-room03', 'a073bea05a4f7329.png', 1920, 1080, '5.20', '67.00', '19.90', '93.30', '0.00', '2025-05-29 13:51:49', '2026-11-14 02:19:28'),
(4, 'living_room', '26ef664a2e2dd462.png', 1920, 1080, '12.50', '68.70', '18.70', '79.80', '0.00', '2025-05-30 06:21:49', '2026-11-14 02:19:28'),
(5, '3', '84d6b856a6b81a7f.png', 1920, 1080, '8.00', '72.50', '20.10', '89.60', '0.00', '2025-05-31 02:10:24', '2026-11-14 02:19:28'),
(8, 'living-room7', 'c04a6c919a31d71f.png', 1920, 1080, '0.70', '73.10', '19.50', '86.50', '0.00', '2025-06-09 13:23:47', '2026-11-14 02:19:28'),
(10, 'Blue Wall', '3f94c64f077adb77.png', 1920, 1080, '32.00', '25.00', '15.00', '60.00', '0.00', '2026-11-14 02:42:42', '2026-11-14 02:42:42'),
(11, 'Blue Wall', '1f80da3de2784cc3.png', 1920, 1080, '32.00', '25.00', '15.00', '60.00', '0.00', '2026-11-14 03:07:18', '2026-11-14 03:07:18');

-- --------------------------------------------------------

--
-- Table structure for table `background_products`
--

DROP TABLE IF EXISTS `background_products`;
CREATE TABLE IF NOT EXISTS `background_products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `background_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `x_percent` decimal(5,2) NOT NULL DEFAULT '0.00',
  `y_percent` decimal(5,2) NOT NULL DEFAULT '0.00',
  `w_percent` decimal(5,2) NOT NULL DEFAULT '20.00',
  `h_percent` decimal(5,2) NOT NULL DEFAULT '70.00',
  `padding_percent` decimal(5,2) NOT NULL DEFAULT '0.00',
  `z_index` int(11) NOT NULL DEFAULT '0',
  `sort_order` int(11) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_background_product` (`background_id`,`product_id`),
  KEY `idx_bp_background_active` (`background_id`,`is_active`),
  KEY `idx_bp_product` (`product_id`)
) ENGINE=InnoDB AUTO_INCREMENT=55 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `background_products`
--

INSERT INTO `background_products` (`id`, `background_id`, `product_id`, `x_percent`, `y_percent`, `w_percent`, `h_percent`, `padding_percent`, `z_index`, `sort_order`, `is_active`, `created_at`, `updated_at`) VALUES
(3, 3, 30, '67.00', '5.20', '19.90', '93.30', '0.00', 0, 0, 1, '2026-11-14 02:19:28', '2026-11-14 02:19:28'),
(4, 3, 48, '67.00', '5.20', '19.90', '93.30', '0.00', 0, 0, 1, '2026-11-14 02:19:28', '2026-11-14 02:19:28'),
(5, 4, 29, '68.70', '12.50', '18.70', '79.80', '0.00', 0, 0, 1, '2026-11-14 02:19:28', '2026-11-14 02:19:28'),
(6, 4, 32, '68.70', '12.50', '18.70', '79.80', '0.00', 0, 0, 1, '2026-11-14 02:19:28', '2026-11-14 02:19:28'),
(7, 5, 35, '72.50', '8.00', '20.10', '89.60', '0.00', 0, 0, 1, '2026-11-14 02:19:28', '2026-11-14 02:19:28'),
(8, 5, 36, '72.50', '8.00', '20.10', '89.60', '0.00', 0, 0, 1, '2026-11-14 02:19:28', '2026-11-14 02:19:28'),
(9, 8, 44, '73.10', '0.70', '19.50', '86.50', '0.00', 0, 0, 1, '2026-11-14 02:19:28', '2026-11-14 02:19:28'),
(10, 8, 47, '73.10', '0.70', '19.50', '86.50', '0.00', 0, 0, 1, '2026-11-14 02:19:28', '2026-11-14 02:19:28'),
(19, 10, 49, '40.81', '15.00', '18.38', '70.00', '0.00', 0, 0, 0, '2026-11-14 02:42:59', '2026-11-14 04:46:08'),
(20, 10, 50, '64.06', '18.81', '18.38', '70.00', '0.00', 0, 0, 1, '2026-11-14 02:46:57', '2026-11-14 04:47:23'),
(22, 11, 44, '40.81', '15.00', '18.38', '70.00', '0.00', 0, 0, 0, '2026-11-14 03:39:11', '2026-11-14 03:39:18'),
(24, 11, 36, '40.81', '15.00', '18.38', '70.00', '0.00', 0, 0, 0, '2026-11-14 03:39:21', '2026-11-14 03:40:43'),
(26, 11, 35, '40.81', '15.00', '18.38', '70.00', '0.00', 0, 0, 0, '2026-11-14 03:39:34', '2026-11-14 03:40:03'),
(28, 11, 32, '40.81', '15.00', '18.38', '70.00', '0.00', 0, 0, 0, '2026-11-14 03:39:38', '2026-11-14 03:39:49'),
(29, 11, 49, '42.95', '13.37', '18.38', '70.00', '0.00', 0, 0, 1, '2026-11-14 03:40:16', '2026-11-14 04:52:46'),
(37, 11, 50, '40.81', '15.00', '18.38', '70.00', '0.00', 0, 0, 0, '2026-11-14 03:41:45', '2026-11-14 04:52:27');

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
CREATE TABLE IF NOT EXISTS `products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `background_id` int(11) NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `image_filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `image_width` int(11) UNSIGNED DEFAULT NULL,
  `image_height` int(11) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_products_background_id` (`background_id`),
  KEY `idx_products_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=52 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `products`
--

INSERT INTO `products` (`id`, `background_id`, `name`, `description`, `image_filename`, `image_width`, `image_height`, `created_at`, `updated_at`) VALUES
(29, 4, '821', '', 'a12254213452c3b5.png', 350, 750, '2025-05-31 02:38:20', '2026-11-14 02:19:28'),
(30, 3, '806', '', 'd1e498d3bb56c710.png', 350, 750, '2025-05-31 02:41:22', '2026-11-14 02:19:28'),
(32, 4, '804', '', '6b25ff8e5231ad3d.png', 350, 750, '2025-06-04 01:49:40', '2026-11-14 02:19:28'),
(35, 5, '218', 'CERTIFIED SERIES', '9e359815502284bb.png', 350, 750, '2025-06-05 15:16:35', '2026-11-14 02:19:28'),
(36, 5, '803', '', '2119cc772d141274.png', 350, 750, '2025-06-05 16:59:50', '2026-11-14 02:19:28'),
(44, 8, 'squared', '', 'c94ccf2eedd04263.png', 350, 750, '2025-06-09 13:24:33', '2026-11-14 02:19:28'),
(47, 8, '218', 'CERTIFIED SERIES', '4e74298112d2d101.png', 350, 750, '2025-06-09 15:19:57', '2026-11-14 02:19:28'),
(48, 3, '6b25ff8e5231ad3d', '', 'f545bee28407f974.png', 350, 750, '2026-11-13 17:04:34', '2026-11-14 02:19:28'),
(49, 10, '4e74298112d2d101', '', '200deb0ae662ca49.png', 350, 750, '2026-11-14 02:42:59', '2026-11-14 02:42:59'),
(50, 10, '577c8be778cd96cc', '', '52346614c03b081f.png', 350, 750, '2026-11-14 02:46:57', '2026-11-14 02:46:57');

-- --------------------------------------------------------

--
-- Table structure for table `product_details`
--

DROP TABLE IF EXISTS `product_details`;
CREATE TABLE IF NOT EXISTS `product_details` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` int(11) NOT NULL,
  `detail_type` enum('specification','feature','dimension','material','warranty') COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail_label` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail_value` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_order` int(3) DEFAULT '0',
  `sticker_image_filename` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sticker_position` enum('top-left','top-right','bottom-left','bottom-right','center') COLLATE utf8mb4_unicode_ci DEFAULT 'top-right',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_product_details_product_id` (`product_id`),
  KEY `idx_product_details_display_order` (`display_order`)
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `product_details`
--

INSERT INTO `product_details` (`id`, `product_id`, `detail_type`, `detail_label`, `detail_value`, `display_order`, `sticker_image_filename`, `sticker_position`, `created_at`, `updated_at`) VALUES
(11, 35, 'feature', 'Size', 'Door Size: Height – 7 feet , Width – 2.5/3/3.5 feet.', 0, '6846f9543e8ae.png', 'top-right', '2025-06-09 15:10:12', '2025-06-09 15:10:12'),
(12, 35, 'dimension', 'Features', 'Easy to Fit\r\nStrong & Durable\r\nWater & Heat Resistant\r\nStandard, Affordable & Environment-Friendly', 0, '6846f9c3d9a88.png', 'top-right', '2025-06-09 15:12:03', '2025-06-09 15:12:03'),
(13, 35, 'warranty', 'WARRENTY', '2 YEARS REPLACEMENT WARRENTY', 0, '6846fa269a47a.png', 'top-right', '2025-06-09 15:13:42', '2025-06-09 15:13:42'),
(14, 35, 'specification', 'MOSTAFA', 'MOSTAFA DOOR', 0, '6846fa9ea7457.png', 'top-right', '2025-06-09 15:15:42', '2025-06-09 15:15:42'),
(16, 47, 'dimension', 'Features', 'Easy to Fit\r\nStrong & Durable\r\nWater & Heat Resistant\r\nStandard, Affordable & Environment-Friendly', 0, '6846f9c3d9a88.png', 'top-right', '2025-06-09 15:12:03', '2025-06-09 15:12:03'),
(17, 47, 'warranty', 'WARRENTY', '2 YEARS REPLACEMENT WARRENTY', 0, '6846fa269a47a.png', 'top-right', '2025-06-09 15:13:42', '2025-06-09 15:13:42'),
(18, 47, 'specification', 'MOSTAFA', 'MOSTAFA DOOR', 0, '6846fa9ea7457.png', 'top-right', '2025-06-09 15:15:42', '2025-06-09 15:15:42'),
(19, 36, 'specification', 'BRAND', 'MOSTAFA', 0, '6847160cda98d.png', 'top-right', '2025-06-09 17:12:44', '2025-06-09 17:12:44');

--
-- Constraints for dumped tables
--

--
-- Constraints for table `background_products`
--
ALTER TABLE `background_products`
  ADD CONSTRAINT `bp_ibfk_background` FOREIGN KEY (`background_id`) REFERENCES `backgrounds` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `bp_ibfk_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `products`
--
ALTER TABLE `products`
  ADD CONSTRAINT `products_ibfk_1` FOREIGN KEY (`background_id`) REFERENCES `backgrounds` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `product_details`
--
ALTER TABLE `product_details`
  ADD CONSTRAINT `product_details_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
