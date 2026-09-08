from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import Any, Dict, List, Optional
import mysql.connector
from mysql.connector import Error
import os
import re
import hashlib
import hmac
import secrets
from dotenv import load_dotenv

load_dotenv()

IST = ZoneInfo("Asia/Kolkata")


def ist_now() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)

app = FastAPI(title="CNC Sorting API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 3306)),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "cnc_job_scheduler"),
}


def get_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except Error as e:
        raise HTTPException(status_code=500, detail=f"DB connection failed: {e}")


class CombinationItem(BaseModel):
    project: str
    module: str
    ac_comp: Optional[float] = None


class SubmitRequest(BaseModel):
    combinations: List[CombinationItem]


class ResultRow(BaseModel):
    priority: int
    project: str
    module: str
    ac_comp: Optional[float]
    extra_data: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
USERNAME_RE = re.compile(r"^[A-Za-z0-9]+$")


class RegisterRequest(BaseModel):
    full_name: str
    username: str
    password: str

    @field_validator("full_name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Full Legal Name is required.")
        return v.strip()

    @field_validator("username")
    @classmethod
    def username_alnum(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Username is required.")
        if not USERNAME_RE.match(v):
            raise ValueError("Username must contain only letters and digits.")
        return v

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters.")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 200_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest_hex = stored.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 200_000)
    return hmac.compare_digest(digest.hex(), digest_hex)


def ensure_users_table(cursor) -> None:
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            full_name VARCHAR(150) NOT NULL,
            username VARCHAR(80) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at DATETIME NOT NULL,
            UNIQUE KEY uq_users_username (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)


@app.get("/auth/check-username")
def check_username(username: str):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        ensure_users_table(cursor)
        cursor.execute("SELECT 1 FROM users WHERE username=%s LIMIT 1", (username,))
        return {"available": cursor.fetchone() is None}
    finally:
        cursor.close()
        conn.close()


@app.post("/auth/register")
def register(payload: RegisterRequest):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        ensure_users_table(cursor)
        cursor.execute("SELECT 1 FROM users WHERE username=%s LIMIT 1", (payload.username,))
        if cursor.fetchone() is not None:
            raise HTTPException(status_code=409, detail="Username already exists.")
        cursor.execute(
            "INSERT INTO users (full_name, username, password_hash, created_at) VALUES (%s,%s,%s,%s)",
            (payload.full_name, payload.username, hash_password(payload.password), ist_now()),
        )
        conn.commit()
        user_id = cursor.lastrowid
        return {"success": True, "user_id": user_id, "full_name": payload.full_name, "username": payload.username}
    except HTTPException:
        conn.rollback()
        raise
    except Error as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()


@app.post("/auth/login")
def login(payload: LoginRequest):
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        ensure_users_table(cursor)
        cursor.execute(
            "SELECT id, full_name, username, password_hash FROM users WHERE username=%s LIMIT 1",
            (payload.username,),
        )
        user = cursor.fetchone()
        if not user or not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid username or password.")
        return {"success": True, "user_id": user["id"], "full_name": user["full_name"], "username": user["username"]}
    finally:
        cursor.close()
        conn.close()


def validate_unique_combinations(combos: List[CombinationItem]):
    seen = set()
    for i, c in enumerate(combos):
        key = (c.project.strip().lower(), c.module.strip().lower())
        if key in seen:
            raise HTTPException(
                status_code=422,
                detail=f"Duplicate combination at row {i + 1}: '{c.project}' + '{c.module}' already exists.",
            )
        seen.add(key)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/options")
def get_options():
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT DISTINCT project_name FROM projects ORDER BY project_name")
        projects = [r["project_name"] for r in cursor.fetchall()]

        cursor.execute("SELECT DISTINCT module_name FROM modules ORDER BY module_name")
        modules = [r["module_name"] for r in cursor.fetchall()]

        return {"projects": projects, "modules": modules}
    finally:
        cursor.close()
        conn.close()


@app.post("/submit", response_model=List[ResultRow])
def submit_combinations(payload: SubmitRequest):
    combos = payload.combinations
    if not combos:
        raise HTTPException(status_code=422, detail="No combinations provided.")

    validate_unique_combinations(combos)

    conn = get_connection()
    cursor = conn.cursor(dictionary=True)
    results: List[ResultRow] = []

    try:
        # IMPORTANT: this is the only place where sorting/order is produced.
        # Allocation receives this response exactly as returned.
        query = """
            SELECT
                t.SR,
                t.PART_NO,
                t.PROJECT,
                t.MODULE,
                t.PRIORITY,
                t.machine_STAGE1,
                t.machine_STAGE1_A,
                t.machine_STAGE2,
                t.machine_STAGE2_A,
                t.BATCH_QTY,
                t.STAGE1_setup_time,
                t.STAGE1_unit_time,
                t.STAGE1_smh,
                t.STAGE2_setup_time,
                t.STAGE2_unit_time,
                t.STAGE2_smh,
                t.completed,
                t.smh
            FROM testdata3 t
            WHERE t.project = %s
              AND t.module = %s
              AND t.completed <= %s
            ORDER BY t.completed ASC, t.priority ASC, t.smh DESC, t.SR ASC
        """

        for priority, combo in enumerate(combos, start=1):
            cursor.execute(
                query,
                (
                    combo.project.strip().lower(),
                    combo.module.strip().lower(),
                    combo.ac_comp,
                ),
            )
            rows = cursor.fetchall()

            if rows:
                part_nos = [r["PART_NO"] for r in rows if r.get("PART_NO")]
                completed_parts = set()
                if part_nos:
                    placeholders = ",".join(["%s"] * len(part_nos))
                    # A part is permanently done if it's flagged is_completed on
                    # allocation_result, OR it already has a completed operation
                    # in allocation_history (covers rows from before is_completed
                    # existed). Backend-enforced — not a frontend-only filter.
                    cursor.execute(
                        f"""SELECT PART_NO AS part_no FROM allocation_result
                            WHERE PART_NO IN ({placeholders}) AND is_completed=1
                            UNION
                            SELECT part_no FROM allocation_history
                            WHERE part_no IN ({placeholders})""",
                        tuple(part_nos) + tuple(part_nos),
                    )
                    completed_parts = {r["part_no"] for r in cursor.fetchall()}

                for row in rows:
                    is_done = row.get("PART_NO") in completed_parts
                    extra = dict(row)
                    if is_done:
                        extra["already_completed"] = True
                        extra["message"] = "Part work is already done."
                    results.append(
                        ResultRow(
                            project=combo.project,
                            module=combo.module,
                            priority=priority,
                            ac_comp=combo.ac_comp,
                            extra_data=extra,
                        )
                    )
            else:
                results.append(
                    ResultRow(
                        project=combo.project,
                        module=combo.module,
                        priority=priority,
                        ac_comp=combo.ac_comp,
                        extra_data={"note": "No matching records in DB"},
                    )
                )

        return results

    finally:
        cursor.close()
        conn.close()


@app.post("/save-priority")
def save_priority(payload: SubmitRequest):
    validate_unique_combinations(payload.combinations)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        for rank, combo in enumerate(payload.combinations, start=1):
            cursor.execute(
                """
                INSERT INTO priority_log (priority, project, module, ac_comp)
                VALUES (%s, %s, %s, %s)
                """,
                (rank, combo.project, combo.module, combo.ac_comp),
            )
        conn.commit()
        return {"saved": len(payload.combinations)}
    except Error as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
