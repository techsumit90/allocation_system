from datetime import date, datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Optional, Tuple
import os

import mysql.connector
from mysql.connector import Error
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

IST = ZoneInfo("Asia/Kolkata")

def ist_now() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)

app = FastAPI(
    title="CNC Machine Allocation API",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "cnc_job_scheduler"),
}

# Machine working window: 07:00–23:00 (16 hours). Overnight continuous
# arithmetic is incorrect; scheduling helpers below consume only this window.
ALLOCATION_START_HOUR = int(os.getenv("ALLOCATION_START_HOUR", "7"))
ALLOCATION_START_MINUTE = int(os.getenv("ALLOCATION_START_MINUTE", "0"))
ALLOCATION_END_HOUR = int(os.getenv("ALLOCATION_END_HOUR", "23"))
ALLOCATION_END_MINUTE = int(os.getenv("ALLOCATION_END_MINUTE", "0"))


class SortedRow(BaseModel):
    priority: int
    project: str
    module: str
    ac_comp: Optional[float] = None
    extra_data: Dict[str, Any] = Field(default_factory=dict)


class AllocationRequest(BaseModel):
    rows: List[SortedRow]
    user_id: Optional[int] = None


class AllocationResponse(BaseModel):
    success: bool
    message: str
    rows_processed: int
    rows_skipped_completed: List[str] = Field(default_factory=list)
    rows_skipped_duplicate: List[str] = Field(default_factory=list)
    allocation_run_date: str
    batch_id: Optional[int] = None


class BoardOperationUpdate(BaseModel):
    stage: str
    machine: str
    queue_position: int
    scheduled_start: datetime
    scheduled_end: datetime
    status: str = "idle"
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None


class ManualAllocation(BaseModel):
    values: Dict[str, Any]
    stage: str
    selected_machine: Optional[str] = None
    selected_stage2_machine: Optional[str] = None


class NewManualAllocation(BaseModel):
    priority: int = Field(default=0, ge=0)
    project: str
    module: str
    part_no: str
    batch_qty: int = Field(ge=1)
    stage1_setup_time: int = Field(ge=0)
    stage1_unit_time: int = Field(ge=0)
    stage2_setup_time: int = Field(default=0, ge=0)
    stage2_unit_time: int = Field(default=0, ge=0)
    completed_stage: Optional[str] = None
    stage: str
    selected_machine: str
    selected_stage2_machine: Optional[str] = None


class BoardMove(BaseModel):
    stage: str
    target_machine: str
    target_index: int = 0


machine_available: Dict[str, datetime] = {}


def get_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"DB connection failed: {exc}")


def clean_machine(value: Any) -> Optional[str]:
    if value is None:
        return None

    value = str(value).strip()
    if not value or value.upper() in {"0", "NIL", "NONE", "NULL", "N/A", "NA", "-"}:
        return None

    return value


def to_float(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def to_int(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def normalized_key(value: Any) -> str:
    return "".join(ch.lower() for ch in str(value) if ch.isalnum())


def value_from_extra(extra: Dict[str, Any], *names: str) -> Any:
    """Read a field while tolerating old/new capitalization/underscore styles."""
    if not extra:
        return None

    normalized = {normalized_key(k): v for k, v in extra.items()}
    for name in names:
        key = normalized_key(name)
        if key in normalized:
            return normalized[key]
    return None


def build_start_datetime() -> datetime:
    today = date.today()
    return datetime.combine(
        today,
        time(ALLOCATION_START_HOUR, ALLOCATION_START_MINUTE),
    )


def work_start_time() -> time:
    return time(ALLOCATION_START_HOUR, ALLOCATION_START_MINUTE)


def work_end_time() -> time:
    return time(ALLOCATION_END_HOUR, ALLOCATION_END_MINUTE)


def align_to_working_start(proposed: Optional[datetime]) -> datetime:
    """Move a timestamp into the 07:00–23:00 machine window.

    Before 07:00 → same day 07:00.
    At or after 23:00 → next calendar day 07:00.
    Working-day exclusions are not added here; the project has no Sunday-off
    calendar configured, so that rule is left unchanged.
    """
    start = proposed or build_start_datetime()
    if getattr(start, "tzinfo", None) is not None:
        start = start.replace(tzinfo=None)
    window_start = datetime.combine(start.date(), work_start_time())
    window_end = datetime.combine(start.date(), work_end_time())
    if start < window_start:
        return window_start
    if start >= window_end:
        return datetime.combine(start.date() + timedelta(days=1), work_start_time())
    return start


def remaining_working_hours(moment: datetime) -> float:
    aligned = align_to_working_start(moment)
    window_end = datetime.combine(aligned.date(), work_end_time())
    return max(0.0, (window_end - aligned).total_seconds() / 3600.0)


def calculate_working_schedule(start_datetime: Optional[datetime], required_hours: float) -> Tuple[datetime, datetime]:
    """Return (aligned_start, working_end) consuming only 07:00–23:00 hours."""
    hours = max(0.0, to_float(required_hours))
    start = align_to_working_start(start_datetime)
    if hours <= 0:
        return start, start
    remaining = hours
    cursor = start
    while remaining > 1e-9:
        cursor = align_to_working_start(cursor)
        day_left = remaining_working_hours(cursor)
        if day_left <= 1e-9:
            cursor = datetime.combine(cursor.date() + timedelta(days=1), work_start_time())
            continue
        consume = min(remaining, day_left)
        cursor = cursor + timedelta(hours=consume)
        remaining -= consume
        if remaining > 1e-9:
            cursor = datetime.combine(cursor.date() + timedelta(days=1), work_start_time())
    return start, cursor


def calculate_working_end(start_datetime: Optional[datetime], required_hours: float) -> datetime:
    """End timestamp after consuming required_hours inside the working window."""
    _, end = calculate_working_schedule(start_datetime, required_hours)
    return end


SCHEDULE_START = build_start_datetime()


def choose_machine(primary: Any, alternative: Any) -> Optional[str]:
    """
    Primary/alternative are alternatives, never simultaneous.

    Rules:
      1. If primary and alternative are both free, use primary.
      2. If only one is currently free, use that machine.
      3. If both are busy, use the machine with the earliest available time.
      4. If availability ties, primary wins.
    """
    primary = clean_machine(primary)
    alternative = clean_machine(alternative)

    candidates: List[Tuple[str, datetime, int]] = []

    if primary:
        candidates.append((primary, machine_available.get(primary, SCHEDULE_START), 0))

    if alternative and alternative != primary:
        candidates.append((alternative, machine_available.get(alternative, SCHEDULE_START), 1))

    if not candidates:
        return None

    return min(candidates, key=lambda item: (item[1], item[2]))[0]


def ensure_allocation_table(cursor) -> None:
    cursor.execute(
        """
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
            INDEX idx_allocation_sr (SR),
            INDEX idx_stage1_machine (selected_stage1_machine),
            INDEX idx_stage2_machine (selected_stage2_machine)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
    )
    # Stage-specific execution fields keep completing Stage 1 from removing
    # the same row's still-active Stage 2 operation.
    cursor.execute("SHOW COLUMNS FROM allocation_result")
    columns = {row[0] if not isinstance(row, dict) else row["Field"] for row in cursor.fetchall()}
    additions = {
        "stage1_status": "VARCHAR(30) DEFAULT 'idle'",
        "stage2_status": "VARCHAR(30) DEFAULT 'idle'",
        "stage1_actual_start": "DATETIME DEFAULT NULL",
        "stage1_actual_end": "DATETIME DEFAULT NULL",
        "stage2_actual_start": "DATETIME DEFAULT NULL",
        "stage2_actual_end": "DATETIME DEFAULT NULL",
        "stage1_hold_at": "DATETIME DEFAULT NULL",
        "stage2_hold_at": "DATETIME DEFAULT NULL",
        "is_manual": "TINYINT(1) NOT NULL DEFAULT 0",
        "BATCH_QTY": "DECIMAL(12,2) DEFAULT NULL",
        "STAGE1_setup_time": "DECIMAL(12,2) DEFAULT NULL",
        "STAGE1_unit_time": "DECIMAL(12,2) DEFAULT NULL",
        "STAGE2_setup_time": "DECIMAL(12,2) DEFAULT NULL",
        "STAGE2_unit_time": "DECIMAL(12,2) DEFAULT NULL",
        "work_order": "VARCHAR(150) DEFAULT NULL",
        "is_completed": "TINYINT(1) NOT NULL DEFAULT 0",
        "batch_id": "INT DEFAULT NULL",
        "allocation_session_id": "VARCHAR(64) DEFAULT NULL",
        "is_carried_forward": "TINYINT(1) NOT NULL DEFAULT 0",
        "is_dismissed": "TINYINT(1) NOT NULL DEFAULT 0",
    }
    for name, definition in additions.items():
        if name not in columns:
            cursor.execute(f"ALTER TABLE allocation_result ADD COLUMN {name} {definition}")
    cursor.execute("""UPDATE allocation_result ar JOIN testdata3 t ON ar.PART_NO=t.PART_NO
        SET ar.BATCH_QTY=COALESCE(ar.BATCH_QTY,t.BATCH_QTY),
            ar.STAGE1_setup_time=COALESCE(ar.STAGE1_setup_time,t.STAGE1_setup_time),
            ar.STAGE1_unit_time=COALESCE(ar.STAGE1_unit_time,t.STAGE1_unit_time),
            ar.STAGE2_setup_time=COALESCE(ar.STAGE2_setup_time,t.STAGE2_setup_time),
            ar.STAGE2_unit_time=COALESCE(ar.STAGE2_unit_time,t.STAGE2_unit_time)
        WHERE ar.BATCH_QTY IS NULL OR ar.STAGE1_setup_time IS NULL
           OR ar.STAGE1_unit_time IS NULL OR ar.STAGE2_setup_time IS NULL
           OR ar.STAGE2_unit_time IS NULL""")


def ensure_history_table(cursor) -> None:
    cursor.execute("""
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    cursor.execute("SHOW COLUMNS FROM allocation_history")
    history_columns = {row[0] if not isinstance(row, dict) else row["Field"] for row in cursor.fetchall()}
    if "work_order" not in history_columns:
        cursor.execute("ALTER TABLE allocation_history ADD COLUMN work_order VARCHAR(150) DEFAULT NULL")



def ensure_machine_maintenance_table(cursor) -> None:
    cursor.execute("""CREATE TABLE IF NOT EXISTS machine_maintenance (
        machine_id VARCHAR(100) PRIMARY KEY, is_maintenance TINYINT(1) NOT NULL DEFAULT 1,
        updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""")


def ensure_batch_table(cursor) -> None:
    cursor.execute("""CREATE TABLE IF NOT EXISTS allocation_batch (
        batch_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        KEY idx_batch_user_status (user_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""")


def get_or_create_active_batch(cursor, user_id: Optional[int]) -> int:
    """Every allocation row belongs to the caller's single ACTIVE batch.
    Existing Allocation restores this batch without ever recreating it."""
    ensure_batch_table(cursor)
    if user_id is not None:
        cursor.execute(
            "SELECT batch_id FROM allocation_batch WHERE user_id=%s AND status='ACTIVE' ORDER BY batch_id DESC LIMIT 1",
            (user_id,),
        )
    else:
        cursor.execute(
            "SELECT batch_id FROM allocation_batch WHERE user_id IS NULL AND status='ACTIVE' ORDER BY batch_id DESC LIMIT 1"
        )
    row = cursor.fetchone()
    if row:
        return row["batch_id"]
    now = ist_now()
    cursor.execute(
        "INSERT INTO allocation_batch (user_id, status, created_at, updated_at) VALUES (%s,'ACTIVE',%s,%s)",
        (user_id, now, now),
    )
    return cursor.lastrowid


def close_batch_if_fully_completed(cursor, batch_id: Optional[int]) -> None:
    """ACTIVE -> COMPLETED once every row in the batch is is_completed=1.
    A batch with zero rows is never auto-completed (nothing to complete yet)."""
    if batch_id is None:
        return
    cursor.execute(
        "SELECT COUNT(*) AS total, SUM(is_completed) AS done FROM allocation_result WHERE batch_id=%s",
        (batch_id,),
    )
    row = cursor.fetchone()
    total = row["total"] or 0
    done = row["done"] or 0
    if total > 0 and total == done:
        cursor.execute(
            "UPDATE allocation_batch SET status='COMPLETED', updated_at=%s WHERE batch_id=%s AND status='ACTIVE'",
            (ist_now(), batch_id),
        )


def mark_row_completed_if_done(cursor, allocation_id: int) -> None:
    """Sets the permanent is_completed flag once every stage the row actually
    has (Stage 2 only if it exists) is completed. Never re-opens a row."""
    cursor.execute(
        "SELECT selected_stage2_machine, stage1_status, stage2_status, batch_id FROM allocation_result WHERE id=%s",
        (allocation_id,),
    )
    row = cursor.fetchone()
    if not row:
        return
    stage1_done = row["stage1_status"] == "completed"
    stage2_needed = row["selected_stage2_machine"] is not None
    stage2_done = row["stage2_status"] == "completed"
    fully_done = stage1_done and (stage2_done if stage2_needed else True)
    if fully_done:
        cursor.execute("UPDATE allocation_result SET is_completed=1 WHERE id=%s", (allocation_id,))
        close_batch_if_fully_completed(cursor, row.get("batch_id"))


def completed_part_numbers(cursor, part_nos: List[str]) -> set:
    """Union of allocation_result.is_completed=1 and allocation_history —
    the single source of truth every workflow (sorting, allocate, manual) must
    check before letting a part be allocated again."""
    part_nos = [p for p in dict.fromkeys(part_nos) if p]
    if not part_nos:
        return set()
    placeholders = ",".join(["%s"] * len(part_nos))
    cursor.execute(
        f"""SELECT PART_NO AS part_no FROM allocation_result
            WHERE PART_NO IN ({placeholders}) AND is_completed=1
            UNION
            SELECT part_no FROM allocation_history WHERE part_no IN ({placeholders})""",
        tuple(part_nos) + tuple(part_nos),
    )
    return {r["part_no"] for r in cursor.fetchall()}


def active_part_numbers(cursor, part_nos: List[str]) -> set:
    """PART_NOs that already have a non-completed row in allocation_result —
    re-sending them through /allocate must not create a duplicate allocation."""
    part_nos = [p for p in dict.fromkeys(part_nos) if p]
    if not part_nos:
        return set()
    placeholders = ",".join(["%s"] * len(part_nos))
    cursor.execute(
        f"""SELECT DISTINCT PART_NO AS part_no FROM allocation_result
            WHERE PART_NO IN ({placeholders}) AND is_completed=0
              AND COALESCE(is_dismissed, 0)=0""",
        tuple(part_nos),
    )
    return {r["part_no"] for r in cursor.fetchall()}


def dismissed_part_numbers(cursor, part_nos: List[str]) -> set:
    """Parts removed with the card × control. They must not return on a later
    /allocate unless a new manual allocation creates a fresh row."""
    part_nos = [p for p in dict.fromkeys(part_nos) if p]
    if not part_nos:
        return set()
    placeholders = ",".join(["%s"] * len(part_nos))
    cursor.execute(
        f"""SELECT DISTINCT PART_NO AS part_no FROM allocation_result
            WHERE PART_NO IN ({placeholders}) AND COALESCE(is_dismissed, 0)=1""",
        tuple(part_nos),
    )
    return {r["part_no"] for r in cursor.fetchall()}


def seed_machine_available_from_active_rows(cursor) -> None:
    """/allocate no longer wipes allocation_result, so a fresh run must pick up
    machine queue-end times from whatever is already active, not start empty."""
    global machine_available
    cursor.execute("""
        SELECT selected_stage1_machine AS machine, MAX(stage1_end) AS latest FROM allocation_result
        WHERE selected_stage1_machine IS NOT NULL AND is_completed=0 AND COALESCE(is_dismissed,0)=0
        GROUP BY selected_stage1_machine
        UNION ALL
        SELECT selected_stage2_machine AS machine, MAX(stage2_end) AS latest FROM allocation_result
        WHERE selected_stage2_machine IS NOT NULL AND is_completed=0 AND COALESCE(is_dismissed,0)=0
        GROUP BY selected_stage2_machine
    """)
    for row in cursor.fetchall():
        if row["machine"] and row["latest"]:
            current = machine_available.get(row["machine"])
            if current is None or row["latest"] > current:
                machine_available[row["machine"]] = row["latest"]


def recalculate_machine_queues(cursor, stage_one: bool, machines: List[str]) -> None:
    """Persist one sequential queue per physical machine, across both stages."""
    machines = list(dict.fromkeys(machine for machine in machines if machine))
    if not machines:
        return
    placeholders = ",".join(["%s"] * len(machines))
    cursor.execute(f"""
        SELECT operation.id, 'stage1' AS stage, operation.selected_stage1_machine AS machine,
               operation.stage1_start AS start_time, operation.stage1_end AS end_time,
               operation.queue_position, operation.stage1_queue_position AS stage_queue_position,
               operation.STAGE1_SMH AS duration_hours, NULL AS stage1_ready_at,
               COALESCE(operation.stage1_status, 'idle') AS operation_status
        FROM allocation_result operation
        WHERE operation.selected_stage1_machine IN ({placeholders})
          AND COALESCE(operation.stage1_status, 'idle') <> 'completed'
          AND COALESCE(operation.is_dismissed, 0) = 0
        UNION ALL
        SELECT operation.id, 'stage2' AS stage, operation.selected_stage2_machine AS machine,
               operation.stage2_start AS start_time, operation.stage2_end AS end_time,
               operation.queue_position, operation.stage2_queue_position AS stage_queue_position,
               operation.STAGE2_SMH AS duration_hours,
               COALESCE(operation.stage1_end, (
                   SELECT MAX(stage1_operation.stage1_end)
                   FROM allocation_result stage1_operation
                   WHERE stage1_operation.PART_NO = operation.PART_NO
                     AND stage1_operation.stage1_end IS NOT NULL
                     AND COALESCE(stage1_operation.is_dismissed, 0) = 0
               )) AS stage1_ready_at,
               COALESCE(operation.stage2_status, 'idle') AS operation_status
        FROM allocation_result operation
        WHERE operation.selected_stage2_machine IN ({placeholders})
          AND COALESCE(operation.stage2_status, 'idle') <> 'completed'
          AND COALESCE(operation.is_dismissed, 0) = 0
    """, tuple(machines) + tuple(machines))
    by_machine: Dict[str, List[Dict[str, Any]]] = {}
    for operation in cursor.fetchall():
        by_machine.setdefault(operation["machine"], []).append(operation)

    for machine, queue in by_machine.items():
        queue.sort(key=lambda operation: (
            operation["queue_position"] or 999999,
            operation["stage_queue_position"] or 999999,
            operation["start_time"] or datetime.max,
            operation["id"],
        ))
        # A queue is always rebuilt from the configured schedule start.  Using
        # an operation's previous start here leaked its old-machine timestamp
        # into a newly selected machine after a drag/drop.
        current = align_to_working_start(build_start_datetime())
        for operation in queue:
            if operation.get("operation_status") == "running" and operation.get("end_time"):
                current = align_to_working_start(max(current, operation["end_time"]))
        for position, operation in enumerate(queue, start=1):
            if operation["stage1_ready_at"]:
                current = align_to_working_start(max(current, operation["stage1_ready_at"]))
            duration_hours = to_float(operation["duration_hours"])
            if duration_hours <= 0 and operation["start_time"] and operation["end_time"]:
                duration_hours = max(
                    0.0,
                    (operation["end_time"] - operation["start_time"]).total_seconds() / 3600.0,
                )
            if operation.get("operation_status") == "running" and operation["start_time"] and operation["end_time"]:
                start, end = operation["start_time"], operation["end_time"]
            else:
                start, end = calculate_working_schedule(current, duration_hours)
            prefix = operation["stage"]
            cursor.execute(f"""UPDATE allocation_result
                SET queue_position=%s, {prefix}_queue_position=%s,
                    {prefix}_start=%s, {prefix}_end=%s
                WHERE id=%s""", (position, position, start, end, operation["id"]))
            current = align_to_working_start(end)


def recalculate_stage2_dependencies(cursor, part_nos: Optional[List[str]] = None) -> None:
    """Rebuild just the Stage 2 queues affected by Stage 1 completion times."""
    query = """SELECT DISTINCT selected_stage2_machine AS machine
        FROM allocation_result WHERE selected_stage2_machine IS NOT NULL"""
    params: Tuple[Any, ...] = ()
    if part_nos:
        placeholders = ",".join(["%s"] * len(part_nos))
        query += f" AND PART_NO IN ({placeholders})"
        params = tuple(part_nos)
    cursor.execute(query, params)
    recalculate_machine_queues(cursor, False, [row["machine"] for row in cursor.fetchall()])


def source_machines(cursor) -> List[str]:
    cursor.execute("""
        SELECT machine FROM (
            SELECT machine_STAGE1 machine FROM testdata3
            UNION SELECT machine_STAGE1_A FROM testdata3
            UNION SELECT machine_STAGE2 FROM testdata3
            UNION SELECT machine_STAGE2_A FROM testdata3
        ) machines
        WHERE machine IS NOT NULL AND TRIM(machine) <> ''
          AND UPPER(TRIM(machine)) NOT IN ('0','NIL','NONE','NULL','N/A','NA','-')
          AND UPPER(TRIM(machine)) NOT LIKE 'MACHINE_STAGE%'
        ORDER BY machine
    """)
    rows = cursor.fetchall()
    return [str((row.get("machine") if isinstance(row, dict) else row[0])).strip() for row in rows]


MIN_MACHINE_QUEUE_DEPTH = 3


def machine_queue_depths(cursor) -> Dict[str, int]:
    """Count scheduled operations per physical machine, across both stages."""
    cursor.execute("""SELECT machine, COUNT(DISTINCT allocation_id) AS depth FROM (
        SELECT id AS allocation_id, selected_stage1_machine AS machine FROM allocation_result
        WHERE selected_stage1_machine IS NOT NULL AND COALESCE(stage1_status, 'idle') <> 'completed'
          AND COALESCE(is_dismissed, 0) = 0
        UNION ALL
        SELECT id AS allocation_id, selected_stage2_machine AS machine FROM allocation_result
        WHERE selected_stage2_machine IS NOT NULL AND COALESCE(stage2_status, 'idle') <> 'completed'
          AND COALESCE(is_dismissed, 0) = 0
    ) active_operations GROUP BY machine""")
    return {row["machine"]: int(row["depth"]) for row in cursor.fetchall()}


def machine_next_start(cursor, machine: str, ready_at: Optional[datetime] = None) -> datetime:
    cursor.execute("""SELECT MAX(end_time) AS latest FROM (
        SELECT stage1_end AS end_time FROM allocation_result
        WHERE selected_stage1_machine=%s AND COALESCE(stage1_status, 'idle') <> 'completed'
          AND COALESCE(is_dismissed, 0) = 0
        UNION ALL
        SELECT stage2_end AS end_time FROM allocation_result
        WHERE selected_stage2_machine=%s AND COALESCE(stage2_status, 'idle') <> 'completed'
          AND COALESCE(is_dismissed, 0) = 0
    ) scheduled_operations""", (machine, machine))
    latest = cursor.fetchone()["latest"]
    proposed = max(
        build_start_datetime(),
        latest or build_start_datetime(),
        ready_at or build_start_datetime(),
    )
    return align_to_working_start(proposed)


def machine_next_position(cursor, machine: str) -> int:
    cursor.execute("""SELECT COALESCE(MAX(queue_position), 0) AS last_position FROM allocation_result
        WHERE COALESCE(is_dismissed, 0) = 0 AND (
              (selected_stage1_machine=%s AND COALESCE(stage1_status, 'idle') <> 'completed')
           OR (selected_stage2_machine=%s AND COALESCE(stage2_status, 'idle') <> 'completed')
        )""",
        (machine, machine))
    return int(cursor.fetchone()["last_position"] or 0) + 1


def schedule_after_machine(
    cursor,
    machine: str,
    duration_hours: float,
    ready_at: Optional[datetime] = None,
    excluded_id: int = 0,
) -> Tuple[datetime, datetime]:
    cursor.execute("""SELECT MAX(end_time) latest FROM (
        SELECT stage1_end AS end_time FROM allocation_result
        WHERE selected_stage1_machine=%s AND id<>%s
          AND COALESCE(stage1_status, 'idle') <> 'completed'
          AND COALESCE(is_dismissed, 0) = 0
        UNION ALL
        SELECT stage2_end AS end_time FROM allocation_result
        WHERE selected_stage2_machine=%s AND id<>%s
          AND COALESCE(stage2_status, 'idle') <> 'completed'
          AND COALESCE(is_dismissed, 0) = 0
    ) machine_operations""", (machine, excluded_id, machine, excluded_id))
    latest = cursor.fetchone()["latest"]
    start = align_to_working_start(max(
        latest or build_start_datetime(),
        ready_at or build_start_datetime(),
        build_start_datetime(),
    ))
    return calculate_working_schedule(start, duration_hours)


def choose_next_machine(cursor, primary: Any, alternative: Any, ready_at: Optional[datetime] = None) -> Optional[str]:
    """Select an existing configured machine by its persisted queue end."""
    candidates = [machine for machine in (clean_machine(primary), clean_machine(alternative)) if machine]
    candidates = list(dict.fromkeys(candidates))
    if not candidates:
        return None
    return min(enumerate(candidates), key=lambda item: (machine_next_start(cursor, item[1], ready_at), item[0]))[1]


def next_future_row_for_machine(cursor, machine: str) -> Optional[Dict[str, Any]]:
    """The next unallocated Future Plan part that can run on this machine."""
    cursor.execute("""SELECT t.SR, t.PART_NO, t.PROJECT, t.MODULE, t.PRIORITY,
        t.machine_STAGE1, t.machine_STAGE1_A, t.machine_STAGE2, t.machine_STAGE2_A,
        t.BATCH_QTY, t.STAGE1_setup_time, t.STAGE1_unit_time, t.STAGE1_smh,
        t.STAGE2_setup_time, t.STAGE2_unit_time, t.STAGE2_smh, t.completed, t.smh
        FROM testdata3 t
        WHERE t.SR > 0
          AND NOT EXISTS (SELECT 1 FROM allocation_history h WHERE h.part_no=t.PART_NO)
          AND NOT EXISTS (SELECT 1 FROM allocation_result ar WHERE ar.SR=t.SR AND (
              (ar.selected_stage1_machine IS NOT NULL AND COALESCE(ar.stage1_status,'idle') <> 'completed') OR
              (ar.selected_stage2_machine IS NOT NULL AND COALESCE(ar.stage2_status,'idle') <> 'completed')
          ))
          AND ((%s IN (t.machine_STAGE1, t.machine_STAGE1_A) AND COALESCE(t.STAGE1_smh, 0) > 0)
            OR (%s IN (t.machine_STAGE2, t.machine_STAGE2_A) AND COALESCE(t.STAGE2_smh, 0) > 0))
        ORDER BY t.PRIORITY, t.SR LIMIT 1""", (machine, machine))
    return cursor.fetchone()


def promote_future_row(cursor, row: Dict[str, Any], target_machine: str) -> List[str]:
    """Persist one Future Plan part, honoring the machine that needs refilling."""
    s1_candidates = {clean_machine(row.get("machine_STAGE1")), clean_machine(row.get("machine_STAGE1_A"))}
    s2_candidates = {clean_machine(row.get("machine_STAGE2")), clean_machine(row.get("machine_STAGE2_A"))}
    stage1_machine = target_machine if target_machine in s1_candidates else choose_next_machine(
        cursor, row.get("machine_STAGE1"), row.get("machine_STAGE1_A")
    )
    stage1_duration = to_float(row.get("STAGE1_smh"))
    stage1_start = machine_next_start(cursor, stage1_machine) if stage1_machine and stage1_duration > 0 else None
    stage1_end = calculate_working_end(stage1_start, stage1_duration) if stage1_start else None

    stage2_machine = target_machine if target_machine in s2_candidates else choose_next_machine(
        cursor, row.get("machine_STAGE2"), row.get("machine_STAGE2_A"), stage1_end
    )
    stage2_duration = to_float(row.get("STAGE2_smh"))
    stage2_start = machine_next_start(cursor, stage2_machine, stage1_end) if stage2_machine and stage2_duration > 0 else None
    stage2_end = calculate_working_end(stage2_start, stage2_duration) if stage2_start else None

    if target_machine not in {stage1_machine, stage2_machine}:
        return []
    stage1_position = machine_next_position(cursor, stage1_machine) if stage1_machine else None
    stage2_position = machine_next_position(cursor, stage2_machine) if stage2_machine else None
    cursor.execute("""INSERT INTO allocation_result (
        SR, PART_NO, PROJECT, MODULE, PRIORITY,
        machine_STAGE1, machine_STAGE1_A, STAGE1_SMH, machine_STAGE2, machine_STAGE2_A, STAGE2_SMH,
        BATCH_QTY, STAGE1_setup_time, STAGE1_unit_time, STAGE2_setup_time, STAGE2_unit_time,
        FINAL_smh, completed_limit, selected_stage1_machine, selected_stage2_machine,
        stage1_start, stage1_end, stage2_start, stage2_end, status,
        queue_position, stage1_queue_position, stage2_queue_position, planned_start, planned_end
    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'ALLOCATED',%s,%s,%s,%s,%s)""",
        (row["SR"], row["PART_NO"], row.get("PROJECT"), row.get("MODULE"), row.get("PRIORITY"),
         clean_machine(row.get("machine_STAGE1")), clean_machine(row.get("machine_STAGE1_A")), stage1_duration,
         clean_machine(row.get("machine_STAGE2")), clean_machine(row.get("machine_STAGE2_A")), stage2_duration,
         row.get("BATCH_QTY"), row.get("STAGE1_setup_time"), row.get("STAGE1_unit_time"),
         row.get("STAGE2_setup_time"), row.get("STAGE2_unit_time"), row.get("smh"), row.get("completed"),
         stage1_machine, stage2_machine, stage1_start, stage1_end, stage2_start, stage2_end,
         max(stage1_position or 0, stage2_position or 0) or None, stage1_position, stage2_position,
         stage1_start or stage2_start, stage2_end or stage1_end))
    return [machine for machine in (stage1_machine, stage2_machine) if machine]


def replenish_future_queues(cursor, minimum_depth: int = MIN_MACHINE_QUEUE_DEPTH) -> int:
    """Promote Future Plan parts until every eligible machine has its queue depth."""
    depths = machine_queue_depths(cursor)
    changed_machines: set[str] = set()
    promoted = 0
    for machine in source_machines(cursor):
        while depths.get(machine, 0) < minimum_depth:
            row = next_future_row_for_machine(cursor, machine)
            if not row:
                break
            assigned = promote_future_row(cursor, row, machine)
            if not assigned:
                break
            promoted += 1
            for assigned_machine in set(assigned):
                depths[assigned_machine] = depths.get(assigned_machine, 0) + 1
                changed_machines.add(assigned_machine)
    if changed_machines:
        recalculate_machine_queues(cursor, True, list(changed_machines))
        recalculate_stage2_dependencies(cursor)
    return promoted


def load_source_record(cursor, part_no: Any) -> Optional[Dict[str, Any]]:
    """Fallback enrichment for an older Sorting frontend that sends only partial extra_data."""
    if not part_no:
        return None

    cursor.execute(
        """
        SELECT
            SR, PART_NO, PROJECT, MODULE, PRIORITY,
            machine_STAGE1, machine_STAGE1_A,
            machine_STAGE2, machine_STAGE2_A,
            BATCH_QTY, STAGE1_setup_time, STAGE1_unit_time, STAGE1_smh,
            STAGE2_setup_time, STAGE2_unit_time, STAGE2_smh, completed, smh
        FROM testdata3
        WHERE PART_NO = %s
        LIMIT 1
        """,
        (str(part_no),),
    )
    return cursor.fetchone()


def normalize_row(sorted_row: SortedRow, cursor, input_position: int) -> Dict[str, Any]:
    extra = sorted_row.extra_data or {}

    part_no = value_from_extra(extra, "PART_NO", "part_no", "partNo")
    source = load_source_record(cursor, part_no)

    def field(*names: str) -> Any:
        value = value_from_extra(extra, *names)
        if value is not None:
            return value
        if source:
            source_normalized = {normalized_key(k): v for k, v in source.items()}
            for name in names:
                key = normalized_key(name)
                if key in source_normalized:
                    return source_normalized[key]
        return None

    sr = to_int(field("SR", "sr"), input_position)
    project = sorted_row.project or field("PROJECT", "project") or ""
    module = sorted_row.module or field("MODULE", "module") or ""
    priority = to_int(sorted_row.priority, to_int(field("PRIORITY", "priority"), input_position))

    return {
        "SR": sr,
        "PROJECT": project,
        "PRIORITY": priority,
        "MODULE": module,
        "PART_NO": part_no or f"ROW-{input_position}",
        "machine_STAGE1": clean_machine(field("machine_STAGE1", "stage1Machine")),
        "machine_STAGE1_A": clean_machine(field("machine_STAGE1_A", "stage1MachineA")),
        "STAGE1_SMH": to_float(field("STAGE1_SMH", "STAGE1_smh", "stage1_smh")),
        "machine_STAGE2": clean_machine(field("machine_STAGE2", "stage2Machine")),
        "machine_STAGE2_A": clean_machine(field("machine_STAGE2_A", "stage2MachineA")),
        "STAGE2_SMH": to_float(field("STAGE2_SMH", "STAGE2_smh", "stage2_smh")),
        "BATCH_QTY": to_float(field("BATCH_QTY")),
        "STAGE1_setup_time": to_float(field("STAGE1_setup_time")),
        "STAGE1_unit_time": to_float(field("STAGE1_unit_time")),
        "STAGE2_setup_time": to_float(field("STAGE2_setup_time")),
        "STAGE2_unit_time": to_float(field("STAGE2_unit_time")),
        "FINAL_smh": to_float(field("FINAL_smh", "final_smh", "smh")),
        "ac_comp": sorted_row.ac_comp,
        "completed_limit": to_float(field("completed_limit", "completed"), 0),
    }


def allocate_rows(sorted_rows: List[SortedRow], user_id: Optional[int] = None) -> Tuple[int, str, List[str], List[str], int]:
    global machine_available, SCHEDULE_START

    machine_available = {}
    SCHEDULE_START = build_start_datetime()
    run_date = SCHEDULE_START.date().isoformat()

    connection = None
    cursor = None

    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        ensure_allocation_table(cursor)
        ensure_history_table(cursor)
        ensure_batch_table(cursor)

        # IMPORTANT CHANGE FROM THE ORIGINAL BEHAVIOR:
        # /allocate used to `DELETE FROM allocation_result` on every call and
        # rebuild the whole table from scratch. That wiped active allocations,
        # queue positions, work orders, and completion state on every re-sort —
        # incompatible with a persistent dashboard / Existing Allocation / the
        # completed-part protection requirement. It now APPENDS only the rows
        # that are genuinely new, skipping parts that are already completed or
        # already have an active (non-completed) allocation row.
        batch_id = get_or_create_active_batch(cursor, user_id)
        session_id = uuid4().hex
        cursor.execute(
            """UPDATE allocation_result SET is_carried_forward=1
               WHERE is_completed=0 AND COALESCE(is_dismissed,0)=0"""
        )
        seed_machine_available_from_active_rows(cursor)

        candidate_part_nos = []
        for sorted_row in sorted_rows:
            part_no = value_from_extra(sorted_row.extra_data or {}, "PART_NO", "part_no", "partNo")
            if part_no:
                candidate_part_nos.append(str(part_no))

        completed = completed_part_numbers(cursor, candidate_part_nos)
        already_active = active_part_numbers(cursor, candidate_part_nos)
        dismissed = dismissed_part_numbers(cursor, candidate_part_nos)

        # Highest existing queue position per machine, so appended rows extend
        # the queue instead of resetting stage/queue positions to start at 1.
        cursor.execute("""SELECT machine, MAX(pos) AS last_pos FROM (
            SELECT selected_stage1_machine AS machine, stage1_queue_position AS pos FROM allocation_result
            WHERE selected_stage1_machine IS NOT NULL AND is_completed=0 AND COALESCE(is_dismissed,0)=0
            UNION ALL
            SELECT selected_stage2_machine AS machine, stage2_queue_position AS pos FROM allocation_result
            WHERE selected_stage2_machine IS NOT NULL AND is_completed=0 AND COALESCE(is_dismissed,0)=0
        ) existing GROUP BY machine""")
        queue_positions: Dict[str, int] = {r["machine"]: int(r["last_pos"] or 0) for r in cursor.fetchall() if r["machine"]}

        processed = 0
        skipped_completed: List[str] = []
        skipped_duplicate: List[str] = []

        # IMPORTANT: no sorting happens here. The list is consumed exactly in
        # the order supplied by Sorting Dashboard.
        for input_position, sorted_row in enumerate(sorted_rows, start=1):
            row = normalize_row(sorted_row, cursor, input_position)

            if row["PART_NO"] in completed:
                skipped_completed.append(row["PART_NO"])
                continue
            # Dedup: keep the existing active/running/queued row as-is
            # (machine, queue, progress). It is already marked carried-forward
            # so the dashboard renders it yellow. Only unseen PART_NOs insert.
            if row["PART_NO"] in already_active:
                skipped_duplicate.append(row["PART_NO"])
                continue
            if row["PART_NO"] in dismissed:
                skipped_duplicate.append(row["PART_NO"])
                continue

            stage1_machine = choose_machine(
                row["machine_STAGE1"], row["machine_STAGE1_A"]
            )
            stage1_start = None
            stage1_end = None

            if stage1_machine:
                stage1_start = align_to_working_start(
                    machine_available.get(stage1_machine, SCHEDULE_START)
                )
                stage1_start, stage1_end = calculate_working_schedule(stage1_start, row["STAGE1_SMH"])
                machine_available[stage1_machine] = stage1_end
                queue_positions[stage1_machine] = queue_positions.get(stage1_machine, 0) + 1
                stage1_queue_position = queue_positions[stage1_machine]
            else:
                stage1_queue_position = None

            stage2_machine = choose_machine(
                row["machine_STAGE2"], row["machine_STAGE2_A"]
            )
            if stage2_machine and row["STAGE2_SMH"] <= 0:
                stage2_machine = None
            stage2_start = None
            stage2_end = None

            if stage2_machine:
                machine_ready = machine_available.get(stage2_machine, SCHEDULE_START)
                part_ready = stage1_end or SCHEDULE_START
                stage2_start = align_to_working_start(max(machine_ready, part_ready))
                stage2_start, stage2_end = calculate_working_schedule(stage2_start, row["STAGE2_SMH"])
                machine_available[stage2_machine] = stage2_end
                queue_positions[stage2_machine] = queue_positions.get(stage2_machine, 0) + 1
                stage2_queue_position = queue_positions[stage2_machine]
            else:
                stage2_queue_position = None

            status = "ALLOCATED" if (stage1_machine or stage2_machine) else "WAITING"
            planned_start = stage1_start or stage2_start
            planned_end = stage2_end or stage1_end

            cursor.execute(
                """
                INSERT INTO allocation_result (
                    SR, PROJECT, PRIORITY, MODULE, PART_NO,
                    machine_STAGE1, machine_STAGE1_A, STAGE1_SMH,
                    machine_STAGE2, machine_STAGE2_A, STAGE2_SMH,
                    FINAL_smh, ac_comp, completed_limit, BATCH_QTY,
                    STAGE1_setup_time, STAGE1_unit_time, STAGE2_setup_time, STAGE2_unit_time,
                    selected_stage1_machine, selected_stage2_machine,
                    stage1_start, stage1_end, stage2_start, stage2_end,
                    status, queue_position, stage1_queue_position,
                    stage2_queue_position, planned_start, planned_end, batch_id,
                    allocation_session_id, is_carried_forward
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, 0
                )
                """,
                (
                    row["SR"], row["PROJECT"], row["PRIORITY"], row["MODULE"], row["PART_NO"],
                    row["machine_STAGE1"], row["machine_STAGE1_A"], row["STAGE1_SMH"],
                    row["machine_STAGE2"], row["machine_STAGE2_A"], row["STAGE2_SMH"],
                    row["FINAL_smh"], row["ac_comp"], row["completed_limit"],
                    row["BATCH_QTY"], row["STAGE1_setup_time"], row["STAGE1_unit_time"],
                    row["STAGE2_setup_time"], row["STAGE2_unit_time"],
                    stage1_machine, stage2_machine,
                    stage1_start, stage1_end, stage2_start, stage2_end,
                    status,
                    max(stage1_queue_position or 0, stage2_queue_position or 0) or None,
                    stage1_queue_position, stage2_queue_position,
                    planned_start, planned_end, batch_id, session_id,
                ),
            )
            processed += 1
            # Guards against the same PART_NO appearing twice within one
            # /allocate request (e.g. duplicate CSV rows) — not just across calls.
            already_active.add(row["PART_NO"])

        recalculate_stage2_dependencies(cursor)
        connection.commit()
        return processed, run_date, skipped_completed, skipped_duplicate, batch_id

    except Exception:
        if connection:
            connection.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


@app.get("/")
def root():
    return {"service": "CNC Machine Allocation API", "status": "running"}


@app.get("/health")
def health():
    connection = None
    try:
        connection = get_connection()
        return {"status": "ok", "database": "connected"}
    except Exception as exc:
        return {"status": "error", "database": str(exc)}
    finally:
        if connection:
            connection.close()


@app.post("/allocate", response_model=AllocationResponse)
def allocate(payload: AllocationRequest):
    if not payload.rows:
        raise HTTPException(status_code=422, detail="No sorted rows were supplied for allocation.")

    try:
        count, run_date, skipped_completed, skipped_duplicate, batch_id = allocate_rows(payload.rows, payload.user_id)
        if count == 0 and skipped_completed and not skipped_duplicate:
            message = "Part work is already done."
        elif skipped_completed or skipped_duplicate:
            message = f"Allocated {count} new row(s). {len(skipped_completed)} already completed, {len(skipped_duplicate)} already active were skipped."
        else:
            message = "Sorted rows allocated successfully in the received order."
        return AllocationResponse(
            success=True,
            message=message,
            rows_processed=count,
            rows_skipped_completed=skipped_completed,
            rows_skipped_duplicate=skipped_duplicate,
            allocation_run_date=run_date,
            batch_id=batch_id,
        )
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"MySQL allocation error: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Allocation error: {exc}")


@app.get("/allocation-batch/active")
def get_active_batch(user_id: Optional[int] = None):
    """Used by the 'Existing Allocation' button — restores the caller's
    current ACTIVE batch and its rows without rerunning anything."""
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        ensure_batch_table(cursor)
        ensure_allocation_table(cursor)
        if user_id is not None:
            cursor.execute(
                "SELECT * FROM allocation_batch WHERE user_id=%s AND status='ACTIVE' ORDER BY batch_id DESC LIMIT 1",
                (user_id,),
            )
        else:
            cursor.execute(
                "SELECT * FROM allocation_batch WHERE user_id IS NULL AND status='ACTIVE' ORDER BY batch_id DESC LIMIT 1"
            )
        batch = cursor.fetchone()
        if not batch:
            return {"success": True, "has_active_batch": False, "batch": None, "data": []}
        cursor.execute("SELECT * FROM allocation_result WHERE batch_id=%s AND COALESCE(is_dismissed,0)=0 ORDER BY id ASC", (batch["batch_id"],))
        rows = cursor.fetchall()
        return {"success": True, "has_active_batch": True, "batch": batch, "data": rows}
    finally:
        cursor.close()
        connection.close()


@app.patch("/allocation-results/{allocation_id}/work-order")
def update_work_order(allocation_id: int, payload: dict):
    work_order = payload.get("work_order")
    if work_order is not None:
        work_order = str(work_order).strip()
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        ensure_allocation_table(cursor)
        cursor.execute("SELECT id FROM allocation_result WHERE id=%s", (allocation_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Allocation row not found.")
        cursor.execute(
            "UPDATE allocation_result SET work_order=%s WHERE id=%s",
            (work_order or None, allocation_id),
        )
        connection.commit()
        return {"success": True, "id": allocation_id, "work_order": work_order or None}
    except HTTPException:
        connection.rollback()
        raise
    except Exception as exc:
        connection.rollback()
        raise HTTPException(status_code=500, detail=f"Unable to save Work Order: {exc}")
    finally:
        cursor.close()
        connection.close()


@app.get("/allocation-results")
def allocation_results():
    connection = None
    cursor = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        ensure_allocation_table(cursor)

        cursor.execute(
            """
            SELECT
                id, SR, PROJECT, PRIORITY, MODULE, PART_NO,
                machine_STAGE1, machine_STAGE1_A, STAGE1_SMH,
                machine_STAGE2, machine_STAGE2_A, STAGE2_SMH,
                FINAL_smh, ac_comp, completed_limit,
                selected_stage1_machine, selected_stage2_machine,
                stage1_start, stage1_end, stage2_start, stage2_end,
                status, queue_position, stage1_queue_position,
                stage2_queue_position, planned_start, planned_end, created_at,
                stage1_status, stage2_status,
                stage1_actual_start, stage1_actual_end,
                stage2_actual_start, stage2_actual_end, is_manual,
                BATCH_QTY, STAGE1_setup_time, STAGE1_unit_time,
                STAGE2_setup_time, STAGE2_unit_time,
                work_order, is_completed, batch_id,
                allocation_session_id, is_carried_forward, is_dismissed,
                EXISTS(
                    SELECT 1 FROM allocation_result completed_s1
                    WHERE completed_s1.PART_NO = allocation_result.PART_NO
                      AND completed_s1.stage1_status = 'completed'
                ) AS stage1_completed
            FROM allocation_result
            WHERE is_completed = 0 AND COALESCE(is_dismissed, 0) = 0
            ORDER BY id ASC
            """
        )
        rows = cursor.fetchall()
        return {"success": True, "count": len(rows), "data": rows}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


@app.delete("/allocation-results/{allocation_id}")
def dismiss_allocation(allocation_id: int):
    """Remove one active allocation from the dashboard permanently.

    Soft-dismisses the allocation_result row so it cannot return after refresh
    or a later /allocate. Does not delete testdata3 or allocation_history.
    """
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        ensure_allocation_table(cursor)
        cursor.execute(
            """SELECT id, selected_stage1_machine, selected_stage2_machine, PART_NO
               FROM allocation_result WHERE id=%s""",
            (allocation_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Allocation row not found.")
        cursor.execute(
            "UPDATE allocation_result SET is_dismissed=1, status='DISMISSED' WHERE id=%s",
            (allocation_id,),
        )
        affected = [row.get("selected_stage1_machine"), row.get("selected_stage2_machine")]
        recalculate_machine_queues(cursor, True, [m for m in affected if m])
        if row.get("selected_stage2_machine"):
            recalculate_stage2_dependencies(cursor, [row.get("PART_NO")])
        connection.commit()
        return {"success": True, "id": allocation_id, "dismissed": True}
    except HTTPException:
        connection.rollback()
        raise
    except Exception as exc:
        connection.rollback()
        raise HTTPException(status_code=500, detail=f"Unable to remove allocation: {exc}")
    finally:
        cursor.close()
        connection.close()


@app.get("/allocation-machines")
def allocation_machines():
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        return {"success": True, "data": source_machines(cursor)}
    finally:
        cursor.close()
        connection.close()


@app.get("/testdata3-schema")
def testdata3_schema():
    """Return the real source columns used by the manual-allocation form."""
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute("SHOW COLUMNS FROM testdata3")
        return {"success": True, "columns": [row["Field"] for row in cursor.fetchall()]}
    finally:
        cursor.close()
        connection.close()


@app.get("/planning-records")
def planning_records():
    """Planning data used to prefill the exceptional manual override form."""
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute("""SELECT SR, PART_NO, PROJECT, MODULE, PRIORITY,
            machine_STAGE1, machine_STAGE1_A, machine_STAGE2, machine_STAGE2_A,
            BATCH_QTY, STAGE1_setup_time, STAGE1_unit_time, STAGE1_smh,
            STAGE2_setup_time, STAGE2_unit_time, STAGE2_smh, completed, smh
            FROM testdata3
            WHERE SR IS NOT NULL AND SR > 0 AND PART_NO IS NOT NULL AND TRIM(PART_NO) <> ''
            ORDER BY SR""")
        return {"success": True, "data": cursor.fetchall()}
    finally:
        cursor.close()
        connection.close()


@app.get("/future-plan")
def future_plan():
    """The database waiting pool: planning records not in an active allocation."""
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute("""SELECT t.SR, t.PART_NO, t.PROJECT, t.MODULE, t.PRIORITY,
            t.machine_STAGE1, t.machine_STAGE1_A, t.machine_STAGE2, t.machine_STAGE2_A,
            t.BATCH_QTY, t.STAGE1_setup_time, t.STAGE1_unit_time, t.STAGE1_smh,
            t.STAGE2_setup_time, t.STAGE2_unit_time, t.STAGE2_smh, t.completed, t.smh,
            'future' AS status
            FROM testdata3 t
        WHERE t.SR > 0 AND NOT EXISTS (
                SELECT 1 FROM allocation_history h WHERE h.part_no=t.PART_NO
            ) AND NOT EXISTS (
            SELECT 1 FROM allocation_result ar WHERE ar.SR=t.SR AND (
                    (ar.selected_stage1_machine IS NOT NULL AND COALESCE(ar.stage1_status,'idle') <> 'completed')
                    OR (ar.selected_stage2_machine IS NOT NULL AND COALESCE(ar.stage2_status,'idle') <> 'completed')
                )
            ) ORDER BY t.PRIORITY, t.SR""")
        return {"success": True, "data": cursor.fetchall()}
    finally:
        cursor.close()
        connection.close()


@app.post("/replenish-queues")
def replenish_queues():
    """Persistently top up every eligible dashboard machine from Future Plan."""
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        ensure_allocation_table(cursor)
        # Automatic queue replenishment is disabled — only explicitly sorted/allocated
        # parts should appear on the board. The endpoint itself is preserved below.
        # promoted = replenish_future_queues(cursor)
        promoted = 0
        connection.commit()
        return {"success": True, "promoted": promoted, "minimum_queue_depth": MIN_MACHINE_QUEUE_DEPTH}
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


@app.patch("/allocation-results/{allocation_id}/operation")
def update_board_operation(allocation_id: int, payload: BoardOperationUpdate):
    stage_one = payload.stage.strip().lower() in {"stage 1", "stage1"}
    prefix = "stage1" if stage_one else "stage2"
    machine_column = "selected_stage1_machine" if stage_one else "selected_stage2_machine"
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        ensure_allocation_table(cursor)
        cursor.execute(f"SELECT {machine_column} machine, PART_NO, {prefix}_status operation_status FROM allocation_result WHERE id=%s", (allocation_id,))
        previous = cursor.fetchone()
        if not previous:
            raise HTTPException(status_code=404, detail="Allocation row not found.")
        requested_status = payload.status.strip().lower()
        if not stage_one and payload.status.strip().lower() == "running":
            cursor.execute("""SELECT EXISTS(
                SELECT 1 FROM allocation_result stage2_row
                JOIN allocation_result stage1_row ON stage1_row.PART_NO=stage2_row.PART_NO
                WHERE stage2_row.id=%s AND stage1_row.stage1_status='completed'
            )""", (allocation_id,))
            dependency_complete = next(iter(cursor.fetchone().values()))
            if not dependency_complete:
                raise HTTPException(status_code=409, detail="Stage 1 must be completed before Stage 2 can start.")
        actual_start = payload.actual_start
        actual_end = payload.actual_end
        hold_at = None
        # Execution time belongs to the server, never the browser clock.
        if requested_status == "running" and previous["operation_status"] != "on_hold":
            actual_start = ist_now()
        if requested_status in {"on_hold", "hold"}:
            requested_status = "on_hold"
            hold_at = ist_now()
        queue_position = payload.queue_position
        hold_transition = requested_status == "on_hold" or previous["operation_status"] == "on_hold"
        cursor.execute(
            f"""UPDATE allocation_result SET {machine_column}=%s,
                {prefix}_queue_position=%s, {prefix}_start=%s, {prefix}_end=%s,
                {prefix}_status=%s, {prefix}_actual_start=COALESCE({prefix}_actual_start,%s),
                {prefix}_actual_end=%s, {prefix}_hold_at=%s
                WHERE id=%s""",
            (payload.machine, queue_position, payload.scheduled_start,
             payload.scheduled_end, requested_status, actual_start,
             actual_end, hold_at, allocation_id),
        )
        # Holding is a state-only pause.  Keep the allocation, queue position,
        # and planned time intact until the job is resumed.
        if not hold_transition:
            if stage_one:
                recalculate_machine_queues(cursor, True, [previous["machine"], payload.machine])
                recalculate_stage2_dependencies(cursor, [previous["PART_NO"]])
            else:
                recalculate_machine_queues(cursor, False, [previous["machine"], payload.machine])
        connection.commit()
        return {"success": True}
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


@app.post("/allocation-results/{allocation_id}/move")
def move_board_operation(allocation_id: int, payload: BoardMove):
    """Move/reorder an operation and recalculate both machine queues in MySQL."""
    stage_one = payload.stage.strip().lower() in {"stage 1", "stage1"}
    prefix = "stage1" if stage_one else "stage2"
    machine_col = "selected_stage1_machine" if stage_one else "selected_stage2_machine"
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        ensure_allocation_table(cursor)
        ensure_machine_maintenance_table(cursor)
        if payload.target_machine not in source_machines(cursor):
            raise HTTPException(status_code=422, detail="Target machine is not present in testdata3.")
        cursor.execute(
            "SELECT 1 FROM machine_maintenance WHERE machine_id=%s AND is_maintenance=1",
            (payload.target_machine,),
        )
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail=f"{payload.target_machine} is under maintenance.")
        cursor.execute(f"SELECT {machine_col} machine, PART_NO FROM allocation_result WHERE id=%s", (allocation_id,))
        found = cursor.fetchone()
        if not found or not found["machine"]:
            raise HTTPException(status_code=404, detail="Allocation operation not found.")
        old_machine = found["machine"]
        affected = {old_machine, payload.target_machine}
        # Put the moved operation at its requested destination index, then let
        # the single queue engine cascade both affected machines.
        cursor.execute("""SELECT id FROM allocation_result
            WHERE id<>%s AND COALESCE(is_dismissed,0)=0 AND (
                (selected_stage1_machine=%s AND COALESCE(stage1_status,'idle') <> 'completed') OR
                (selected_stage2_machine=%s AND COALESCE(stage2_status,'idle') <> 'completed')
            )
            ORDER BY queue_position, COALESCE(stage1_start, stage2_start), id""",
            (allocation_id, payload.target_machine, payload.target_machine))
        destination_ids = [row["id"] for row in cursor.fetchall()]
        destination_ids.insert(max(0, min(payload.target_index, len(destination_ids))), allocation_id)
        cursor.execute(f"UPDATE allocation_result SET {machine_col}=%s WHERE id=%s", (payload.target_machine, allocation_id))
        for position, operation_id in enumerate(destination_ids, start=1):
            cursor.execute("UPDATE allocation_result SET queue_position=%s WHERE id=%s", (position, operation_id))
        recalculate_machine_queues(cursor, stage_one, list(affected))
        if stage_one:
            recalculate_stage2_dependencies(cursor, [found["PART_NO"]])
        connection.commit()
        return {"success": True}
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


@app.post("/allocation-results/manual")
def create_manual_allocation(payload: ManualAllocation):
    stage_one = payload.stage.strip().lower() in {"stage 1", "stage1"}
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        ensure_allocation_table(cursor)
        selected_sr = payload.values.get("SR")
        if selected_sr in (None, ""):
            raise HTTPException(status_code=422, detail="Select an SR from planning data.")
        cursor.execute("""SELECT SR, PART_NO, PROJECT, MODULE, PRIORITY,
            machine_STAGE1, machine_STAGE1_A, machine_STAGE2, machine_STAGE2_A,
            BATCH_QTY, STAGE1_setup_time, STAGE1_unit_time, STAGE1_smh,
            STAGE2_setup_time, STAGE2_unit_time, STAGE2_smh, completed, smh
            FROM testdata3 WHERE SR=%s LIMIT 1""", (selected_sr,))
        values = cursor.fetchone()
        if not values:
            raise HTTPException(status_code=404, detail="Planning record not found for the selected SR.")
        quantity = payload.values.get("quantity")
        if quantity not in (None, ""):
            try:
                quantity = int(str(quantity))
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail="Quantity must be an integer.")
            if quantity < 1:
                raise HTTPException(status_code=422, detail="Quantity must be at least 1.")
            values["BATCH_QTY"] = quantity
            values["STAGE1_smh"] = to_float(values.get("STAGE1_setup_time")) + to_float(values.get("STAGE1_unit_time")) * quantity
            values["STAGE2_smh"] = to_float(values.get("STAGE2_setup_time")) + to_float(values.get("STAGE2_unit_time")) * quantity
        configured = source_machines(cursor)
        cursor.execute("""SELECT * FROM allocation_result
            WHERE SR=%s AND is_completed=0 AND COALESCE(is_dismissed,0)=0
            ORDER BY id DESC LIMIT 1""", (values["SR"],))
        existing = cursor.fetchone()
        excluded_id = existing["id"] if existing else 0

        requested_s1 = clean_machine(payload.selected_machine)
        requested_s2 = clean_machine(payload.selected_stage2_machine)

        if requested_s1 and requested_s1 not in configured:
            raise HTTPException(status_code=422, detail="Selected Stage 1 machine is not present in testdata3.")
        if requested_s2 and requested_s2 not in configured:
            raise HTTPException(status_code=422, detail="Selected Stage 2 machine is not present in testdata3.")

        # Stage 1 empty → keep automatic/default machine selection.
        stage1_machine = requested_s1 or clean_machine(
            (existing or {}).get("selected_stage1_machine")
            or values.get("machine_STAGE1")
            or values.get("machine_STAGE1_A")
        )
        if not stage1_machine:
            stage1_machine = choose_next_machine(cursor, values.get("machine_STAGE1"), values.get("machine_STAGE1_A"))
        # Empty Stage 2 is valid (Stage-1-only). Do not auto-fill Stage 2.
        stage2_machine = requested_s2
        if not stage_one and not stage2_machine:
            stage2_machine = clean_machine(payload.selected_machine) or choose_next_machine(
                cursor, values.get("machine_STAGE2"), values.get("machine_STAGE2_A")
            )

        stage1_duration = to_float(values.get("STAGE1_smh"))
        stage2_duration = to_float(values.get("STAGE2_smh"))
        if stage1_machine and stage1_duration <= 0 and stage_one:
            raise HTTPException(status_code=422, detail="The selected stage SMH must be greater than zero.")
        if stage2_machine and stage2_duration <= 0:
            stage2_machine = None

        if not stage1_machine and not stage2_machine:
            raise HTTPException(status_code=422, detail="Select at least a Stage 1 machine, or a valid default machine.")
        if stage1_machine and stage1_machine not in configured:
            raise HTTPException(status_code=422, detail="The selected part has no valid machine for this stage.")

        s1_start = s1_end = s2_start = s2_end = None
        s1_pos = s2_pos = None
        affected = []
        if stage1_machine:
            s1_start, s1_end = schedule_after_machine(cursor, stage1_machine, stage1_duration, None, excluded_id)
            s1_pos = machine_next_position(cursor, stage1_machine)
            affected.append(stage1_machine)
        if stage2_machine:
            s2_start, s2_end = schedule_after_machine(
                cursor, stage2_machine, stage2_duration, s1_end, excluded_id
            )
            s2_pos = machine_next_position(cursor, stage2_machine)
            affected.append(stage2_machine)

        queue_position = max(s1_pos or 0, s2_pos or 0) or None
        if existing:
            old_machines = [existing.get("selected_stage1_machine"), existing.get("selected_stage2_machine")]
            cursor.execute(
                """UPDATE allocation_result SET
                    selected_stage1_machine=%s, selected_stage2_machine=%s,
                    stage1_start=%s, stage1_end=%s, stage2_start=%s, stage2_end=%s,
                    BATCH_QTY=%s, STAGE1_SMH=%s, STAGE2_SMH=%s,
                    queue_position=%s, stage1_queue_position=%s, stage2_queue_position=%s,
                    planned_start=%s, planned_end=%s, is_manual=1
                WHERE id=%s""",
                (
                    stage1_machine, stage2_machine, s1_start, s1_end, s2_start, s2_end,
                    values["BATCH_QTY"], values["STAGE1_smh"], values["STAGE2_smh"],
                    queue_position, s1_pos, s2_pos,
                    s1_start or s2_start, s2_end or s1_end, existing["id"],
                ),
            )
            recalculate_machine_queues(cursor, True, [m for m in old_machines + affected if m])
            recalculate_stage2_dependencies(cursor, [values.get("PART_NO")])
            connection.commit()
            return {"success": True, "id": existing["id"], "overridden": True}

        cursor.execute(
            """INSERT INTO allocation_result (
                SR, PART_NO, PROJECT, MODULE, PRIORITY,
                machine_STAGE1, machine_STAGE1_A, machine_STAGE2, machine_STAGE2_A,
                STAGE1_SMH, STAGE2_SMH, completed_limit, FINAL_smh, BATCH_QTY,
                STAGE1_setup_time, STAGE1_unit_time, STAGE2_setup_time, STAGE2_unit_time,
                selected_stage1_machine, selected_stage2_machine,
                stage1_start, stage1_end, stage2_start, stage2_end,
                stage1_status, stage2_status, status, is_manual,
                queue_position, stage1_queue_position, stage2_queue_position,
                planned_start, planned_end, is_carried_forward
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'idle','idle','ALLOCATED',1,%s,%s,%s,%s,%s,0)""",
            (to_int(values.get("SR"), 0), values.get("PART_NO"), values.get("PROJECT"), values.get("MODULE"), to_int(values.get("PRIORITY")),
             clean_machine(values.get("machine_STAGE1")), clean_machine(values.get("machine_STAGE1_A")),
             clean_machine(values.get("machine_STAGE2")), clean_machine(values.get("machine_STAGE2_A")),
             to_float(values.get("STAGE1_smh")), to_float(values.get("STAGE2_smh")),
             to_float(values.get("completed")), to_float(values.get("smh")), to_float(values.get("BATCH_QTY")),
             to_float(values.get("STAGE1_setup_time")), to_float(values.get("STAGE1_unit_time")),
             to_float(values.get("STAGE2_setup_time")), to_float(values.get("STAGE2_unit_time")),
             stage1_machine, stage2_machine, s1_start, s1_end, s2_start, s2_end,
             queue_position, s1_pos, s2_pos, s1_start or s2_start, s2_end or s1_end),
        )
        allocation_id = cursor.lastrowid
        recalculate_machine_queues(cursor, True, affected)
        if stage2_machine:
            recalculate_stage2_dependencies(cursor, [values.get("PART_NO")])
        connection.commit()
        return {
            "success": True,
            "id": allocation_id,
            "scheduled_start": s1_start or s2_start,
            "scheduled_end": s2_end or s1_end,
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


@app.post("/allocation-results/manual/new")
def create_new_manual_allocation(payload: NewManualAllocation):
    """Create one database planning record, then append its selected stage."""
    if not payload.part_no.strip():
        raise HTTPException(status_code=422, detail="PART_NO is required.")
    has_stage2 = bool(clean_machine(payload.selected_stage2_machine))
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        if payload.selected_machine not in source_machines(cursor):
            raise HTTPException(status_code=422, detail="Selected Stage 1 machine is not present in testdata3.")
        if has_stage2 and payload.selected_stage2_machine not in source_machines(cursor):
            raise HTTPException(status_code=422, detail="Selected Stage 2 machine is not present in testdata3.")
        cursor.execute("SELECT EXISTS(SELECT 1 FROM testdata3 WHERE PART_NO=%s) duplicate", (payload.part_no.strip(),))
        if next(iter(cursor.fetchone().values())):
            raise HTTPException(status_code=409, detail="PART_NO already exists in planning data. Use Add Existing Part.")
        cursor.execute("SELECT COALESCE(MAX(SR),0)+1 next_sr FROM testdata3")
        sr = int(cursor.fetchone()["next_sr"])
        stage1_smh = payload.stage1_setup_time + payload.stage1_unit_time * payload.batch_qty
        stage2_smh = (payload.stage2_setup_time + payload.stage2_unit_time * payload.batch_qty) if has_stage2 else 0
        cursor.execute("""INSERT INTO testdata3 (SR, PART_NO, PROJECT, MODULE, PRIORITY,
            BATCH_QTY, machine_STAGE1, machine_STAGE2, STAGE1_setup_time, STAGE1_unit_time, STAGE1_smh,
            STAGE2_setup_time, STAGE2_unit_time, STAGE2_smh, completed, smh)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (sr, payload.part_no.strip(), payload.project, payload.module, payload.priority,
             payload.batch_qty, payload.selected_machine, payload.selected_stage2_machine if has_stage2 else None,
             payload.stage1_setup_time, payload.stage1_unit_time, stage1_smh,
             payload.stage2_setup_time if has_stage2 else 0, payload.stage2_unit_time if has_stage2 else 0, stage2_smh,
             2 if has_stage2 else 1, stage1_smh + stage2_smh))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()
    result = create_manual_allocation(
        ManualAllocation(
            values={"SR": sr, "quantity": payload.batch_qty},
            stage="Stage 1",
            selected_machine=payload.selected_machine,
            selected_stage2_machine=payload.selected_stage2_machine if has_stage2 else None,
        )
    )
    return {"success": True, "sr": sr, "stage1": result, "stage2": result if has_stage2 else None,
            "stage1_smh": stage1_smh, "stage2_smh": stage2_smh}


@app.post("/allocation-results/{allocation_id}/complete")
def complete_operation(allocation_id: int, payload: BoardOperationUpdate):
    stage_one = payload.stage.strip().lower() in {"stage 1", "stage1"}
    prefix = "stage1" if stage_one else "stage2"
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        ensure_allocation_table(cursor)
        ensure_history_table(cursor)
        cursor.execute("SELECT * FROM allocation_result WHERE id=%s FOR UPDATE", (allocation_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Allocation row not found.")
        actual_end = ist_now()
        # NOTE: actual_end is always the server clock, never a client-supplied
        # timestamp. The board previously sent the browser's UTC time
        # (now.toISOString()), which was stored as-is into this naive IST
        # DATETIME column with no timezone conversion — landing off by the
        # IST offset (and occasionally across a date boundary), which is
        # what made "stopped" times in History look wrong/random. actual_start
        # already uses this same server-authoritative pattern (see
        # update_board_operation) — this brings actual_end in line with it.
        cursor.execute(f"UPDATE allocation_result SET {prefix}_status='completed', {prefix}_actual_end=%s WHERE id=%s", (actual_end, allocation_id))
        cursor.execute("""INSERT INTO allocation_history (
            allocation_id, stage, part_no, project, module, priority, batch_qty, machine,
            scheduled_start, scheduled_end, actual_start, actual_end, completed_at, work_order
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON DUPLICATE KEY UPDATE actual_end=VALUES(actual_end), completed_at=VALUES(completed_at), work_order=VALUES(work_order)""",
        (allocation_id, payload.stage, row["PART_NO"], row["PROJECT"], row["MODULE"], row["PRIORITY"], row.get("BATCH_QTY"),
         row["selected_stage1_machine"] if stage_one else row["selected_stage2_machine"],
         row[f"{prefix}_start"], row[f"{prefix}_end"], row.get(f"{prefix}_actual_start"), actual_end, actual_end,
         row.get("work_order")))
        # Completed cards leave the active board queue, so cascade the
        # remaining cards on that same machine from their retained anchor.
        recalculate_machine_queues(cursor, stage_one, [row["selected_stage1_machine"] if stage_one else row["selected_stage2_machine"]])
        # Cascading recalculation: when a Stage 1 stop completes, the actual
        # end time may differ from the scheduled end, so any Stage 2 operations
        # that depend on this part's Stage 1 completion must have their start
        # and end times recalculated to reflect the real upstream finish time.
        if stage_one:
            recalculate_stage2_dependencies(cursor, [row["PART_NO"]])
        # Automatic queue replenishment disabled — do not pull Future Plan parts
        # into the board after a stop. Only sorted/allocated parts should appear.
        # replenish_future_queues(cursor)
        # Permanently protect this row from re-allocation once every stage it
        # actually has is completed (Stage 2 only counted if it exists).
        mark_row_completed_if_done(cursor, allocation_id)
        connection.commit()
        return {"success": True}
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


@app.get("/allocation-history")
def allocation_history():
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        ensure_history_table(cursor)
        connection.commit()
        cursor.execute("SELECT * FROM allocation_history ORDER BY completed_at DESC")
        return {"success": True, "data": cursor.fetchall()}
    finally:
        cursor.close()
        connection.close()


@app.patch("/allocation-results/{allocation_id}/quantity")
def update_allocation_quantity(allocation_id: int, payload: dict):
    """Update BATCH_QTY for an allocation row and recalculate its SMH."""
    quantity = payload.get("quantity")
    if quantity is None:
        raise HTTPException(status_code=422, detail="quantity is required.")
    try:
        quantity = int(str(quantity))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="quantity must be an integer.")
    if quantity < 1:
        raise HTTPException(status_code=422, detail="quantity must be at least 1.")
    connection = get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        ensure_allocation_table(cursor)
        cursor.execute(
            "SELECT PART_NO, STAGE1_setup_time, STAGE1_unit_time, STAGE2_setup_time, STAGE2_unit_time "
            "FROM allocation_result WHERE id=%s", (allocation_id,)
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Allocation row not found.")
        stage1_smh = to_float(row.get("STAGE1_setup_time")) + to_float(row.get("STAGE1_unit_time")) * quantity
        stage2_smh = to_float(row.get("STAGE2_setup_time")) + to_float(row.get("STAGE2_unit_time")) * quantity
        cursor.execute(
            "UPDATE allocation_result SET BATCH_QTY=%s, STAGE1_SMH=%s, STAGE2_SMH=%s WHERE id=%s",
            (quantity, stage1_smh, stage2_smh, allocation_id)
        )
        # Also update the planning source record so future allocations use the new qty.
        cursor.execute("UPDATE testdata3 SET BATCH_QTY=%s WHERE PART_NO=%s", (quantity, row["PART_NO"]))
        connection.commit()
        return {"success": True, "batch_qty": quantity, "stage1_smh": stage1_smh, "stage2_smh": stage2_smh}
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


# Persistent maintenance registry in MySQL.
@app.post("/allocation-machines/{machine_id}/maintenance")
def set_machine_maintenance(machine_id: str):
    connection=get_connection(); cursor=connection.cursor()
    try:
        ensure_machine_maintenance_table(cursor)
        ensure_allocation_table(cursor)
        cursor.execute("INSERT INTO machine_maintenance(machine_id,is_maintenance,updated_at) VALUES(%s,1,%s) ON DUPLICATE KEY UPDATE is_maintenance=1,updated_at=VALUES(updated_at)",(machine_id,ist_now()))
        # Halt running work on this machine but keep every part allocated here.
        cursor.execute(
            "UPDATE allocation_result SET stage1_status='idle' WHERE selected_stage1_machine=%s AND stage1_status='running'",
            (machine_id,),
        )
        cursor.execute(
            "UPDATE allocation_result SET stage2_status='idle' WHERE selected_stage2_machine=%s AND stage2_status='running'",
            (machine_id,),
        )
        connection.commit(); return {"success":True,"machine":machine_id,"maintenance":True}
    except Exception:
        connection.rollback()
        raise
    finally: cursor.close(); connection.close()

@app.delete("/allocation-machines/{machine_id}/maintenance")
def clear_machine_maintenance(machine_id: str):
    connection=get_connection(); cursor=connection.cursor()
    try:
        ensure_machine_maintenance_table(cursor)
        cursor.execute("UPDATE machine_maintenance SET is_maintenance=0,updated_at=%s WHERE machine_id=%s",(ist_now(),machine_id))
        connection.commit(); return {"success":True,"machine":machine_id,"maintenance":False}
    finally: cursor.close(); connection.close()

@app.get("/allocation-machines/maintenance")
def get_maintenance_machines():
    connection=get_connection(); cursor=connection.cursor()
    try:
        ensure_machine_maintenance_table(cursor); cursor.execute("SELECT machine_id FROM machine_maintenance WHERE is_maintenance=1")
        return {"success":True,"maintenance":[r[0] for r in cursor.fetchall()]}
    finally: cursor.close(); connection.close()

@app.get("/completed-parts/{part_no}")
def completed_part(part_no: str):
    connection=get_connection(); cursor=connection.cursor()
    try:
        ensure_history_table(cursor); cursor.execute("SELECT 1 FROM allocation_history WHERE part_no=%s LIMIT 1",(part_no,))
        return {"success":True,"completed":cursor.fetchone() is not None}
    finally: cursor.close(); connection.close()


@app.get("/allocation-health")
def allocation_health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)