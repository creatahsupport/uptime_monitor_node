-- Uptime Monitor Database Schema
-- Run this script to initialise the database

CREATE DATABASE IF NOT EXISTS uptime_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE uptime_monitor;

-- ─────────────────────────────────────────────
-- Table: monitored_urls
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitored_urls (
  id               INT            NOT NULL AUTO_INCREMENT,
  name             VARCHAR(255)   NOT NULL,
  url              VARCHAR(2048)  NOT NULL,
  client_email     VARCHAR(255)   NOT NULL,
  is_active        TINYINT(1)     NOT NULL DEFAULT 1,
  current_status   ENUM('up','down','unknown') NOT NULL DEFAULT 'unknown',
  last_checked_at  DATETIME       NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
-- Table: monitor_checks
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitor_checks (
  id                  INT          NOT NULL AUTO_INCREMENT,
  url_id              INT          NOT NULL,
  status              ENUM('up','down') NOT NULL,
  load_time_ms        INT          NULL,
  performance_label   ENUM('good','average','bad') NULL,
  http_status_code    INT          NULL,
  error_message       TEXT         NULL,
  checked_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_url_id    (url_id),
  INDEX idx_checked_at (checked_at),
  CONSTRAINT fk_checks_url FOREIGN KEY (url_id)
    REFERENCES monitored_urls (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
-- Table: incidents
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id                  INT        NOT NULL AUTO_INCREMENT,
  url_id              INT        NOT NULL,
  started_at          DATETIME   NOT NULL,
  resolved_at         DATETIME   NULL,
  duration_minutes    INT        NULL,
  notified_client     TINYINT(1) NOT NULL DEFAULT 0,
  notified_internal   TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_incident_url (url_id),
  INDEX idx_incident_started (started_at),
  CONSTRAINT fk_incidents_url FOREIGN KEY (url_id)
    REFERENCES monitored_urls (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
-- Table: internal_recipients
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS internal_recipients (
  id         INT          NOT NULL AUTO_INCREMENT,
  name       VARCHAR(255) NULL,
  email      VARCHAR(255) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recipient_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
