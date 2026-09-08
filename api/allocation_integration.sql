-- CNC Sorting -> Allocation integration for cnc_job_scheduler
-- Run in phpMyAdmin after importing the main database dump.

USE cnc_job_scheduler;

-- 1) Verify the real sorting source table.
DESCRIBE testdata3;
SELECT COUNT(*) AS source_rows FROM testdata3;

-- 2) The allocation result table uses the existing schema.
--    This is safe to run if the table already exists.
CREATE TABLE IF NOT EXISTS allocation_result (
    id INT AUTO_INCREMENT PRIMARY KEY,
    SR INT NOT NULL,
    PROJECT VARCHAR(100) DEFAULT NULL,
    PRIORITY INT DEFAULT NULL,
    MODULE VARCHAR(100) DEFAULT NULL,
    PART_NO VARCHAR(150) DEFAULT NULL,
    machine_STAGE1 VARCHAR(100) DEFAULT NULL,
    machine_STAGE1_A VARCHAR(100) DEFAULT NULL,
    STAGE1_SMH DECIMAL(10,2) DEFAULT NULL,
    machine_STAGE2 VARCHAR(100) DEFAULT NULL,
    machine_STAGE2_A VARCHAR(100) DEFAULT NULL,
    STAGE2_SMH DECIMAL(10,2) DEFAULT NULL,
    FINAL_smh DECIMAL(10,2) DEFAULT NULL,
    ac_comp DECIMAL(10,2) DEFAULT NULL,
    completed_limit DECIMAL(10,2) DEFAULT NULL,
    selected_stage1_machine VARCHAR(100) DEFAULT NULL,
    selected_stage2_machine VARCHAR(100) DEFAULT NULL,
    stage1_start DATETIME DEFAULT NULL,
    stage1_end DATETIME DEFAULT NULL,
    stage2_start DATETIME DEFAULT NULL,
    stage2_end DATETIME DEFAULT NULL,
    status VARCHAR(30) DEFAULT 'ALLOCATED',
    queue_position INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    stage1_queue_position INT DEFAULT NULL,
    stage2_queue_position INT DEFAULT NULL,
    planned_start DATETIME DEFAULT NULL,
    planned_end DATETIME DEFAULT NULL,
    stage1_status VARCHAR(30) DEFAULT 'idle',
    stage2_status VARCHAR(30) DEFAULT 'idle',
    stage1_actual_start DATETIME DEFAULT NULL,
    stage1_actual_end DATETIME DEFAULT NULL,
    stage2_actual_start DATETIME DEFAULT NULL,
    stage2_actual_end DATETIME DEFAULT NULL,
    is_manual TINYINT(1) NOT NULL DEFAULT 0,
    BATCH_QTY DECIMAL(12,2) DEFAULT NULL,
    STAGE1_setup_time DECIMAL(12,2) DEFAULT NULL,
    STAGE1_unit_time DECIMAL(12,2) DEFAULT NULL,
    STAGE2_setup_time DECIMAL(12,2) DEFAULT NULL,
    STAGE2_unit_time DECIMAL(12,2) DEFAULT NULL,
    INDEX idx_allocation_sr (SR),
    INDEX idx_stage1_machine (selected_stage1_machine),
    INDEX idx_stage2_machine (selected_stage2_machine)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS allocation_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    allocation_id INT NOT NULL,
    stage VARCHAR(20) NOT NULL,
    part_no VARCHAR(150), project VARCHAR(100), module VARCHAR(100),
    priority INT, batch_qty DECIMAL(12,2), machine VARCHAR(100),
    scheduled_start DATETIME, scheduled_end DATETIME,
    actual_start DATETIME, actual_end DATETIME,
    completed_at DATETIME NOT NULL,
    UNIQUE KEY uq_completed_operation (allocation_id, stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Optional: clear stale results before a manual test.
-- TRUNCATE TABLE allocation_result;

-- 4) Verify the latest allocation after clicking Proceed for Allocation.
SELECT
    id,
    SR,
    PROJECT,
    PRIORITY,
    MODULE,
    PART_NO,
    machine_STAGE1,
    machine_STAGE1_A,
    selected_stage1_machine,
    stage1_queue_position,
    stage1_start,
    stage1_end,
    machine_STAGE2,
    machine_STAGE2_A,
    selected_stage2_machine,
    stage2_queue_position,
    stage2_start,
    stage2_end,
    status
FROM allocation_result
ORDER BY id ASC;

-- 5) Machine-wise verification.
SELECT
    selected_stage1_machine AS machine,
    stage1_queue_position AS queue_position,
    SR,
    PART_NO,
    stage1_start AS start_time,
    stage1_end AS end_time
FROM allocation_result
WHERE selected_stage1_machine IS NOT NULL
UNION ALL
SELECT
    selected_stage2_machine AS machine,
    stage2_queue_position AS queue_position,
    SR,
    PART_NO,
    stage2_start AS start_time,
    stage2_end AS end_time
FROM allocation_result
WHERE selected_stage2_machine IS NOT NULL
ORDER BY machine, queue_position;


-- Persistent maintenance state
CREATE TABLE IF NOT EXISTS machine_maintenance (
 machine_id VARCHAR(100) PRIMARY KEY, is_maintenance TINYINT(1) NOT NULL DEFAULT 1, updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
