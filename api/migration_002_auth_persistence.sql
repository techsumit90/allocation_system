-- Migration 002: authentication, active-batch, work order, completion flag
-- Additive only. Safe to re-run (all guards use IF NOT EXISTS / catalog checks).
-- Run this AFTER api/allocation_integration.sql (migration 001).

USE cnc_job_scheduler;

-- ---------------------------------------------------------------------------
-- 1) USERS  (new — no auth table existed before this migration)
--    Per the latest spec: no email field at all. Only full name, username,
--    password. Username uniqueness enforced at the DB level; the
--    alphanumeric-only rule is app-level validation (backend + frontend),
--    not something a column constraint can express in MySQL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    username VARCHAR(80) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- If migration 002 was already applied with the older (email-included)
-- version of this table, drop the now-unwanted column. Safe no-op otherwise.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='email'
);
SET @sql := IF(@col_exists > 0,
  'ALTER TABLE users DROP INDEX uq_users_email, DROP COLUMN email',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2) ACTIVE ALLOCATION BATCH
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS allocation_batch (
    batch_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | COMPLETED
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY idx_batch_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 3) allocation_result: batch link, work order, permanent completion flag
--    (allocation_history already tracks per-operation completion; is_completed
--     is the row-level flag the brief asks for so every workflow can check a
--     single column instead of joining out to history everywhere.)
-- ---------------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='allocation_result' AND COLUMN_NAME='batch_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE allocation_result ADD COLUMN batch_id INT DEFAULT NULL, ADD INDEX idx_alloc_batch (batch_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='allocation_result' AND COLUMN_NAME='work_order'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE allocation_result ADD COLUMN work_order VARCHAR(150) DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='allocation_result' AND COLUMN_NAME='is_completed'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE allocation_result ADD COLUMN is_completed TINYINT(1) NOT NULL DEFAULT 0, ADD INDEX idx_alloc_completed (is_completed)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill: any part that already has BOTH stages fully completed in
-- allocation_history (or the only stage it has, if Stage 2 was never used)
-- is marked is_completed so old data respects the new guard immediately.
UPDATE allocation_result ar
SET ar.is_completed = 1
WHERE ar.is_completed = 0
  AND EXISTS (SELECT 1 FROM allocation_history h WHERE h.part_no = ar.PART_NO AND h.stage IN ('Stage 1','stage1'))
  AND (
        ar.selected_stage2_machine IS NULL
        OR EXISTS (SELECT 1 FROM allocation_history h2 WHERE h2.part_no = ar.PART_NO AND h2.stage IN ('Stage 2','stage2'))
      );

-- ---------------------------------------------------------------------------
-- 4) testdata3 / completed-part guard support: an index to make the
--    "is this PART_NO already completed" lookup cheap from Sorting too.
-- ---------------------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='allocation_history' AND INDEX_NAME='idx_history_part_no'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE allocation_history ADD INDEX idx_history_part_no (part_no)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Verification queries (run manually, not part of the migration)
-- ---------------------------------------------------------------------------
-- DESCRIBE users;
-- DESCRIBE allocation_batch;
-- SHOW COLUMNS FROM allocation_result LIKE 'batch_id';
-- SHOW COLUMNS FROM allocation_result LIKE 'work_order';
-- SHOW COLUMNS FROM allocation_result LIKE 'is_completed';
-- SELECT COUNT(*) FROM allocation_result WHERE is_completed = 1;
