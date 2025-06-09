-- phpMyAdmin SQL Dump
-- version 4.7.4
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3306
-- Generation Time: Jun 09, 2025 at 03:52 PM
-- Server version: 5.7.19
-- PHP Version: 5.6.31

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
-- Table structure for table `backgrounds`
--

DROP TABLE IF EXISTS `backgrounds`;
CREATE TABLE IF NOT EXISTS `backgrounds` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `image_filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `marking_top_percent` decimal(5,2) DEFAULT '0.00',
  `marking_left_percent` decimal(5,2) DEFAULT '0.00',
  `marking_width_percent` decimal(5,2) DEFAULT '100.00',
  `marking_height_percent` decimal(5,2) DEFAULT '100.00',
  `marking_padding_percent` decimal(5,2) DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_backgrounds_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `backgrounds`
--

INSERT INTO `backgrounds` (`id`, `name`, `image_filename`, `marking_top_percent`, `marking_left_percent`, `marking_width_percent`, `marking_height_percent`, `marking_padding_percent`, `created_at`, `updated_at`) VALUES
(1, 'living-room01', '11fd99fb3e769aa8.png', '15.50', '71.00', '18.70', '79.30', '0.00', '2025-05-29 01:28:22', '2025-06-05 17:42:05'),
(3, 'living-room03', 'a073bea05a4f7329.png', '13.50', '71.30', '19.90', '93.30', '0.00', '2025-05-29 13:51:49', '2025-06-05 17:33:13'),
(4, 'living_room', '26ef664a2e2dd462.png', '9.90', '68.20', '21.00', '90.90', '0.00', '2025-05-30 06:21:49', '2025-06-05 07:14:28'),
(5, '3', '84d6b856a6b81a7f.png', '8.30', '75.00', '20.60', '97.60', '0.00', '2025-05-31 02:10:24', '2025-06-08 04:22:32'),
(8, 'living-room7', 'c04a6c919a31d71f.png', '4.60', '73.50', '20.90', '89.60', '0.00', '2025-06-09 13:23:47', '2025-06-09 15:20:44'),
(9, 'living-room5', 'a0d1ae239f79342e.png', '8.60', '27.80', '18.80', '77.20', '0.00', '2025-06-09 13:23:54', '2025-06-09 15:18:31');

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
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_products_background_id` (`background_id`),
  KEY `idx_products_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=48 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `products`
--

INSERT INTO `products` (`id`, `background_id`, `name`, `description`, `image_filename`, `created_at`, `updated_at`) VALUES
(28, 1, '301', '', 'ee01788e7c5f187f.png', '2025-05-31 02:33:29', '2025-05-31 02:33:29'),
(29, 4, '821', '', 'a12254213452c3b5.png', '2025-05-31 02:38:20', '2025-05-31 02:38:20'),
(30, 3, '806', '', 'd1e498d3bb56c710.png', '2025-05-31 02:41:22', '2025-05-31 02:41:22'),
(32, 4, '804', '', '6b25ff8e5231ad3d.png', '2025-06-04 01:49:40', '2025-06-04 01:49:40'),
(35, 5, '218', 'CERTIFIED SERIES', '9e359815502284bb.png', '2025-06-05 15:16:35', '2025-06-09 15:16:51'),
(36, 5, '803', '', '2119cc772d141274.png', '2025-06-05 16:59:50', '2025-06-05 16:59:50'),
(37, 1, '803', '', '590bf6801af63f6a.png', '2025-06-05 17:10:48', '2025-06-05 17:10:48'),
(44, 8, 'squared', '', 'c94ccf2eedd04263.png', '2025-06-09 13:24:33', '2025-06-09 13:24:33'),
(45, 9, 'squared', '', 'fad514e2ffc74c90.png', '2025-06-09 13:30:32', '2025-06-09 13:30:32'),
(46, 9, '218', 'CERTIFIED SERIES', '577c8be778cd96cc.png', '2025-06-09 15:18:20', '2025-06-09 15:30:27'),
(47, 8, '218', 'CERTIFIED SERIES', '4e74298112d2d101.png', '2025-06-09 15:19:57', '2025-06-09 15:30:31');

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
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `product_details`
--

INSERT INTO `product_details` (`id`, `product_id`, `detail_type`, `detail_label`, `detail_value`, `display_order`, `sticker_image_filename`, `sticker_position`, `created_at`, `updated_at`) VALUES
(11, 35, 'feature', 'Size', 'Door Size: Height – 7 feet , Width – 2.5/3/3.5 feet.', 0, '6846f9543e8ae.png', 'top-right', '2025-06-09 15:10:12', '2025-06-09 15:10:12'),
(12, 35, 'dimension', 'Features', 'Easy to Fit\r\nStrong & Durable\r\nWater & Heat Resistant\r\nStandard, Affordable & Environment-Friendly', 0, '6846f9c3d9a88.png', 'top-right', '2025-06-09 15:12:03', '2025-06-09 15:12:03'),
(13, 35, 'warranty', 'WARRENTY', '2 YEARS REPLACEMENT WARRENTY', 0, '6846fa269a47a.png', 'top-right', '2025-06-09 15:13:42', '2025-06-09 15:13:42'),
(14, 35, 'specification', 'MOSTAFA', 'MOSTAFA DOOR', 0, '6846fa9ea7457.png', 'top-right', '2025-06-09 15:15:42', '2025-06-09 15:15:42'),
(15, 46, 'feature', 'Size', 'Door Size: Height – 7 feet , Width – 2.5/3/3.5 feet.', 0, '6846f9543e8ae.png', 'top-right', '2025-06-09 15:10:12', '2025-06-09 15:10:12'),
(16, 47, 'dimension', 'Features', 'Easy to Fit\r\nStrong & Durable\r\nWater & Heat Resistant\r\nStandard, Affordable & Environment-Friendly', 0, '6846f9c3d9a88.png', 'top-right', '2025-06-09 15:12:03', '2025-06-09 15:12:03'),
(17, 47, 'warranty', 'WARRENTY', '2 YEARS REPLACEMENT WARRENTY', 0, '6846fa269a47a.png', 'top-right', '2025-06-09 15:13:42', '2025-06-09 15:13:42'),
(18, 47, 'specification', 'MOSTAFA', 'MOSTAFA DOOR', 0, '6846fa9ea7457.png', 'top-right', '2025-06-09 15:15:42', '2025-06-09 15:15:42');

--
-- Constraints for dumped tables
--

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
