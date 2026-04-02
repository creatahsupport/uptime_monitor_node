-- ─────────────────────────────────────────────────────────────────────────────
-- Uptime Monitor — Migration Script
-- Run this against an EXISTING database to apply incremental changes.
-- Safe to run on the server without touching existing data.
-- ─────────────────────────────────────────────────────────────────────────────

USE uptime_monitor;

-- ─────────────────────────────────────────────
-- ALTER: Add soft delete column to monitored_urls
-- ─────────────────────────────────────────────
ALTER TABLE monitored_urls
  ADD COLUMN IF NOT EXISTS is_deleted TINYINT(1) NOT NULL DEFAULT 0;
