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

-- ─────────────────────────────────────────────
-- TEST DATA: March 2026 monitor checks
-- Run this to test monthly report generation.
-- Replace url_id values with actual IDs from your monitored_urls table.
-- Check your IDs: SELECT id, name FROM monitored_urls WHERE is_deleted = 0;
-- ─────────────────────────────────────────────

-- Insert March 2026 sample checks for url_id = 1
-- (change url_id to match your actual URL IDs)
INSERT INTO monitor_checks (url_id, status, load_time_ms, performance_label, http_status_code, error_message, checked_at) VALUES
(1, 'up',   320,  'good',    200, NULL,                    '2026-03-01 06:00:00'),
(1, 'up',   410,  'good',    200, NULL,                    '2026-03-01 07:00:00'),
(1, 'up',   290,  'good',    200, NULL,                    '2026-03-01 08:00:00'),
(1, 'down', NULL, NULL,      503, 'Service Unavailable',   '2026-03-02 03:00:00'),
(1, 'down', NULL, NULL,      503, 'Service Unavailable',   '2026-03-02 04:00:00'),
(1, 'up',   380,  'good',    200, NULL,                    '2026-03-02 05:00:00'),
(1, 'up',   1500, 'average', 200, NULL,                    '2026-03-05 06:00:00'),
(1, 'up',   450,  'good',    200, NULL,                    '2026-03-08 06:00:00'),
(1, 'up',   3500, 'bad',     200, NULL,                    '2026-03-10 06:00:00'),
(1, 'up',   310,  'good',    200, NULL,                    '2026-03-12 06:00:00'),
(1, 'down', NULL, NULL,      500, 'Internal Server Error', '2026-03-15 02:00:00'),
(1, 'up',   280,  'good',    200, NULL,                    '2026-03-15 03:00:00'),
(1, 'up',   400,  'good',    200, NULL,                    '2026-03-18 06:00:00'),
(1, 'up',   350,  'good',    200, NULL,                    '2026-03-20 06:00:00'),
(1, 'up',   420,  'good',    200, NULL,                    '2026-03-22 06:00:00'),
(1, 'up',   290,  'good',    200, NULL,                    '2026-03-25 06:00:00'),
(1, 'up',   510,  'good',    200, NULL,                    '2026-03-28 06:00:00'),
(1, 'up',   330,  'good',    200, NULL,                    '2026-03-30 06:00:00'),
(1, 'up',   470,  'good',    200, NULL,                    '2026-03-31 06:00:00');
