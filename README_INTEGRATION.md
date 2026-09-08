# CNC Sorting -> Allocation Integration

## Folder structure

```text
project/
├── sorting/
│   ├── index.html
│   └── main.py
├── allocation/
│   ├── index.html
│   ├── data.js
│   ├── script.js
│   ├── style.css
│   ├── future.html / future.js / future.css
│   └── history.html / history.js / history.css
└── api/
    ├── main1.py
    ├── allocation_integration.sql
    └── requirements.txt
```

## Runtime flow

1. Start XAMPP Apache + MySQL.
2. The Sorting Dashboard continues to use `main.py` and `/submit` exactly as before.
3. The sorted result is expected to be persisted by the existing sorting/SQL workflow into `testdata_final`.
4. The new **Proceed for Allocation** button calls `POST http://localhost:8001/allocate`.
5. `main1.py` reads `testdata_final ORDER BY SR ASC`. It does not re-sort the data.
6. Allocation is performed from first SR to last SR using the machine queue logic.
7. Results are written to `allocation_result` in MySQL.
8. The browser calls `http://localhost:8001/allocation-results` to confirm the result.
9. The browser navigates to `../allocation/index.html`.
10. The Allocation Dashboard calls `http://localhost:8001/allocation-results` on startup and renders the returned Stage 1 / Stage 2 allocations.

## Machine rule

For each stage, `machine_STAGE1` + `machine_STAGE1_A` (and Stage 2 equivalents) are alternatives, not simultaneous machines.

- Primary is preferred when both become available at the same time.
- If primary is busy and alternative is free, alternative is selected.
- If both are busy, the machine with the earlier availability time is selected.
- The selected machine's queue end is then updated.
- Stage 2 cannot start before Stage 1 for the same part has finished.

## Important path setting

The sorting page contains:

```js
const ALLOCATION_DASHBOARD_URL = "../allocation/index.html";
```

This is correct when `sorting` and `allocation` are sibling folders. If your actual folder names differ, change only this path.

## Start the two FastAPI processes

Install dependencies once:

```bash
pip install -r api/requirements.txt
```

### Sorting API — port 8000
Run your existing Sorting Dashboard backend:

```bash
uvicorn sorting.main:app --reload --port 8000
```

### Allocation API — port 8001
Run the new allocation backend:

```bash
uvicorn api.main1:app --reload --port 8001
```

This keeps the two dashboards independent and avoids a port collision. The Sorting page sends sorting requests to `8000` and allocation requests to `8001`.

## XAMPP / phpMyAdmin

Run `api/allocation_integration.sql` once. The allocation backend also creates `allocation_result` automatically if it is missing.

Before clicking Proceed, this should return rows:

```sql
SELECT COUNT(*) FROM testdata_final;
```

After allocation:

```sql
SELECT * FROM allocation_result ORDER BY SR ASC, id ASC;
```
