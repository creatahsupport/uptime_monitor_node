-- Uptime Monitor — Full Schema
-- Database: uptime_monitor
-- Run: mysql -u root uptime_monitor < create_tables.sql

CREATE DATABASE IF NOT EXISTS `uptime_monitor`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `uptime_monitor`;

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `username`     VARCHAR(255) NOT NULL,
  `password`     VARCHAR(255) NOT NULL,
  `totp_secret`  VARCHAR(255)          DEFAULT NULL,
  `totp_enabled` TINYINT(1)   NOT NULL DEFAULT 0,
  `role`         ENUM('super_admin','admin') NOT NULL DEFAULT 'admin',
  `is_deleted`   TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── monitored_urls ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `monitored_urls` (
  `id`                   INT          NOT NULL AUTO_INCREMENT,
  `name`                 VARCHAR(255) NOT NULL,
  `url`                  VARCHAR(2048) NOT NULL,
  `client_email`         VARCHAR(255) NOT NULL,
  `is_active`            TINYINT(1)   NOT NULL DEFAULT 1,
  `current_status`       ENUM('up','down','unknown') NOT NULL DEFAULT 'unknown',
  `last_checked_at`      DATETIME              DEFAULT NULL,
  `is_deleted`           TINYINT(1)   NOT NULL DEFAULT 0,
  `consecutive_failures` INT          NOT NULL DEFAULT 0,
  `created_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_client_email` (`client_email`),
  INDEX `idx_is_deleted_is_active` (`is_deleted`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── monitor_checks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `monitor_checks` (
  `id`                INT          NOT NULL AUTO_INCREMENT,
  `url_id`            INT          NOT NULL,
  `status`            ENUM('up','down') NOT NULL,
  `load_time_ms`      INT                    DEFAULT NULL,
  `html_load_ms`      INT                    DEFAULT NULL,
  `css_load_ms`       INT                    DEFAULT NULL,
  `js_load_ms`        INT                    DEFAULT NULL,
  `image_load_ms`     INT                    DEFAULT NULL,
  `full_load_ms`      INT                    DEFAULT NULL,
  `lcp_ms`            INT                    DEFAULT NULL,
  `performance_label` ENUM('good','average','bad') DEFAULT NULL,
  `http_status_code`  INT                    DEFAULT NULL,
  `error_message`     TEXT                   DEFAULT NULL,
  `error_type`        ENUM(
                        'dns_error','connection_refused','connection_reset',
                        'timeout','ssl_expired','ssl_invalid','server_error',
                        'client_error','http_error','network_error','http_blocked',
                        'server_down','tcp_error','content_loading_error',
                        'browser_metrics_unavailable','browser_error'
                      )                      DEFAULT NULL,
  `check_type`        ENUM('uptime','load_time') NOT NULL DEFAULT 'uptime',
  `checked_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_url_id`    (`url_id`),
  INDEX `idx_checked_at` (`checked_at`),
  CONSTRAINT `fk_mc_url` FOREIGN KEY (`url_id`) REFERENCES `monitored_urls` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── incidents ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `incidents` (
  `id`               INT      NOT NULL AUTO_INCREMENT,
  `url_id`           INT      NOT NULL,
  `started_at`       DATETIME NOT NULL,
  `resolved_at`      DATETIME          DEFAULT NULL,
  `duration_minutes` INT               DEFAULT NULL,
  `notified_client`  TINYINT(1) NOT NULL DEFAULT 0,
  `notified_internal` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `idx_url_id`     (`url_id`),
  INDEX `idx_started_at`  (`started_at`),
  INDEX `idx_resolved_at` (`resolved_at`),
  CONSTRAINT `fk_inc_url` FOREIGN KEY (`url_id`) REFERENCES `monitored_urls` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── settings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `settings` (
  `key`        VARCHAR(255) NOT NULL,
  `value`      TEXT                  DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── internal_recipients ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `internal_recipients` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(255)          DEFAULT NULL,
  `email`      VARCHAR(255) NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Default settings ─────────────────────────────────────────────────────────
INSERT IGNORE INTO `settings` (`key`, `value`) VALUES
  ('cron_schedule',        '0 * * * *'),
  ('cron_enabled',         'true'),
  ('monthly_report_day',   '1'),
  ('monthly_report_hour',  '0'),
  ('monthly_report_minute','0');
