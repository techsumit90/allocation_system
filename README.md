CNC Sorting + Machine Allocation System

A two-service application for sorting CNC job data and allocating it to machines, with persistent, database-backed state across refresh, logout, and login.

Sorting service (sorting/) — FastAPI backend (main.py, port 8000)
a single-page frontend (index.html). Handles authentication and the CSV/priority sorting workflow.
Allocation service (api/) — FastAPI backend (main1.py, port 8001). Owns the allocation engine, machine queueing, maintenance state, work orders, and completion tracking.
Allocation dashboard (allocation/) — frontend (index.html + script.js) that visualizes machine queues and lets you start/stop/ complete jobs, set maintenance, and enter Work Orders.
MySQL — single database (cnc_job_scheduler) shared by both backends; it is the authoritative source of state, never the browser.
1. Architecture / Data Flow
LOGIN (sorting/index.html)
    ↓
Sorting Dashboard
    ↓  POST /submit  (sorting/main.py, :8000)
Sorted Rows  (completed parts flagged "Part work is already done.")
    ↓  "Proceed for Allocation"
POST /allocate  (api/main1.py, :8001)
    ↓
Allocation Engine → Primary/Alternative Machine Selection → Queue
    ↓
MySQL: allocation_result (linked to an allocation_batch)
    ↓  GET /allocation-results
Allocation Dashboard  (allocation/index.html)
    ↓
Start → Stop/Complete → is_completed = 1 → allocation_history
    ↓  (permanently blocked from re-allocation)

Existing Allocation flow (survives logout/refresh):

Sorting Dashboard → "Existing Allocation"
    ↓  GET /allocation-batch/active?user_id=...
Restores the caller's current ACTIVE batch from MySQL — never re-sorts,
never re-runs the allocation algorithm, never resets the queue.
2. Prerequisites
Python 3.12+
MySQL 8.x (or MariaDB equivalent) running locally or reachable over the network
A modern browser (the frontends are static HTML/JS — no build step)
3. Database Setup
Create the database (if it doesn't already exist):
sql
   CREATE DATABASE IF NOT EXISTS cnc_job_scheduler;
Load your existing base schema/data (projects, modules, testdata3, etc.) if not already present.
Run the migrations, in order:
bash
   mysql -u root -p cnc_job_scheduler < api/allocation_integration.sql
   mysql -u root -p cnc_job_scheduler < api/migration_002_auth_persistence.sql

Both are additive and safe to re-run (idempotent IF NOT EXISTS / catalog-check guards) — they never drop or overwrite existing data.

migration_002_auth_persistence.sql adds:

users (full_name, username [unique], password_hash, created_at)
allocation_batch (batch_id, user_id, status ACTIVE/COMPLETED, timestamps)
allocation_result.batch_id, .work_order, .is_completed
an index on allocation_history.part_no for fast completed-part checks
Verify:
sql
   DESCRIBE users;
   DESCRIBE allocation_batch;
   SHOW COLUMNS FROM allocation_result LIKE 'work_order';
   SHOW COLUMNS FROM allocation_result LIKE 'is_completed';
   SHOW COLUMNS FROM allocation_result LIKE 'batch_id';
4. Environment Variables

Each backend reads its own .env (or a shared one at the repo root — both sorting/main.py and api/main1.py call load_dotenv(), which looks in the current working directory by default).

env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=cnc_job_scheduler

Do not commit your real .env — see .gitignore below.

5. Install & Run
bash
# from the project root
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r api/requirements.txt

# Terminal 1 — Sorting API (auth + sorting)
cd sorting
python main.py                   # http://127.0.0.1:8000

# Terminal 2 — Allocation API (engine, queue, maintenance, work order)
cd api
python main1.py                  # http://127.0.0.1:8001

Open the frontends directly in a browser (no server needed for static files):

Sorting Dashboard: sorting/index.html
Allocation Dashboard: allocation/index.html (opened automatically via "Proceed for Allocation" or "Existing Allocation" from the Sorting Dashboard)

If your browser blocks fetch() from a file:// page, serve the static folders with any simple HTTP server, e.g. python -m http.server 5500 from the project root, then open http://127.0.0.1:5500/sorting/index.html.

6. Complete User Flow
Register — Full Legal Name, Username (letters/digits only), Password (6+ chars). Both validated client-side and server-side; username uniqueness enforced by a DB unique key.
Login — "Sign in as Admin" screen. Successful login caches {user_id, username, full_name} in localStorage purely as a session identifier — not as the source of truth for any allocation data.
Sorting Dashboard — add Project/Module/AC_COMP rows, "Submit & Fetch Results" calls POST /submit. Any part already completed is flagged "Part work is already done." in its own result column.
Proceed for Allocation — sends the sorted rows, in order, to POST /allocate along with the current user_id. The allocation engine:
looks up (or creates) the user's ACTIVE batch,
skips parts that are is_completed = 1 or already active in the batch,
runs the existing primary/alternative machine selection and queue logic unchanged for everything else.
Allocation Dashboard — restores automatically from GET /allocation-results (only non-completed rows). Drag-and-drop, Start/Stop, Maintenance, and manual allocation all persist to MySQL immediately — no local-only state.
Work Order — type into the field on any allocated card and click Save; it calls PATCH /allocation-results/{id}/work-order and survives refresh/logout/login.
Complete a part — Stop/Complete sets is_completed = 1 and logs to allocation_history; the part is now permanently blocked from re-allocation in both Sorting and Allocation. When every row in a batch is completed, the batch itself flips ACTIVE → COMPLETED.
Logout — returns to sorting/index.html, never to a login/landing page. Active allocations are untouched.
Existing Allocation — after logging back in, click the button on the Sorting Dashboard to restore the previous ACTIVE batch exactly as it was left, with no re-sorting or re-allocation.
7. Key API Endpoints

Sorting API — sorting/main.py (:8000)

Method	Path	Purpose
POST	/auth/register	Create user (full_name, username, password)
POST	/auth/login	Authenticate, returns user_id
GET	/auth/check-username	Username availability check
GET	/options	Project/module dropdown values
POST	/submit	Sort rows; flags already-completed parts
POST	/save-priority	Persist priority ordering log

Allocation API — api/main1.py (:8001)

Method	Path	Purpose
POST	/allocate	Allocate sorted rows into the user's active batch
GET	/allocation-batch/active	Fetch the caller's current ACTIVE batch + rows
GET	/allocation-results	Live dashboard board (non-completed rows)
PATCH	/allocation-results/{id}/work-order	Save/update Work Order
PATCH	/allocation-results/{id}/quantity	Recalculate SMH server-side
POST	/allocation-results/{id}/complete	Mark an operation complete
POST/DELETE	/machine-maintenance/{machine}	Set/clear maintenance, persisted
POST	/allocation-results/manual/new	Manual allocation (rejects completed parts)
8. Manual Test Checklist
 Register with valid data
 Duplicate username → rejected with a clear message
 Password < 6 chars → rejected client- and server-side
 Username with special characters → rejected
 Login heading reads "Sign in as Admin"
 Sort → Proceed for Allocation → rows appear on the dashboard in sorted order
 Change manual-allocation quantity → SMH recalculated by the backend and reflected immediately
 Leave Stage 2 empty → allocation still succeeds
 Enter a Work Order → refresh → still present
 Refresh the Allocation Dashboard → all state intact (allocations, queue, maintenance, Work Orders, unallocated parts)
 Set a machine to Maintenance → refresh → still in Maintenance
 Logout from the Allocation Dashboard → lands on sorting/index.html, not a login page
 Login again → "Existing Allocation" restores the same dashboard, unchanged
 Complete a part → appears in history, is_completed = 1
 Re-attempt allocating that same part (via sorting or manual allocation) → "Part work is already done."
 Complete every part in a batch → batch status flips to COMPLETED
9. Project Structure
.
├── api/
│   ├── main1.py                          # Allocation engine + API (:8001)
│   ├── allocation_integration.sql        # Migration 001 (maintenance, history tables)
│   ├── migration_002_auth_persistence.sql# Migration 002 (users, batch, work_order, is_completed)
│   └── requirements.txt
├── sorting/
│   ├── main.py                           # Auth + sorting API (:8000)
│   ├── index.html                        # Sorting Dashboard / Sign-in / Register
│   └── hal_logo.png
├── allocation/
│   ├── index.html                        # Allocation Dashboard
│   ├── script.js                         # Dashboard logic, drag-and-drop, Work Order UI
│   ├── style.css
│   ├── data.js / future.* / history.*    # Supporting views
└── README.md
10. Notes / Assumptions
Password hashing uses Python's standard-library hashlib.pbkdf2_hmac (200,000 iterations, per-user random salt) so no extra dependency (e.g. bcrypt) was required beyond what requirements.txt already lists.
There is no session/token system (JWT, cookies) — user_id is passed explicitly by the frontend on each relevant call, cached client-side only as a convenience for "who is logged in," never as authoritative data.
The Allocation Dashboard (GET /allocation-results) shows the shared, active board (all non-completed rows across users); "Existing Allocation" is the per-user, per-batch restore path.
