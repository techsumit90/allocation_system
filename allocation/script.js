/**
 * CNC Machine Allocation — Gantt board
 * The board renders one normalized allocation model. It starts with the
 * frontend mock source and can be populated by the existing API adapter.
 */
const CONFIG = {
  scheduleDate: '2026-08-09',
  scheduleDateDisplay: '09 Aug 2026',
  timelineStartHour: 8,
  timelineEndHour: 18,
  snapMinutes: 15,
  hourWidth: 224,
  rowHeight: 172,
  machineColWidth: 160
};

let machines = [];
let allocations = [];

/* ── Storage helpers ── */
const API_BASE_URL = new URLSearchParams(window.location.search).get('api') || 'http://127.0.0.1:8001';
const MAX_VISIBLE_ALLOCATIONS = 5;

function syncMachinesFromAllocations(existingMachines = machines) {
  const stateById = new Map((existingMachines || []).map(machine => [machine.id, machine]));
  machines = machines.map(machine => ({...machine, maintenance:Boolean(stateById.get(machine.id)?.maintenance)}));
}

function formatIST(dateValue) { return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(dateValue)); }

function dbDateTimeParts(value) {
  if (!value) return null;
  const text = String(value).replace('Z', '');
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return { date: match[1], time: `${match[2]}:${match[3]}` };
}

function isConfiguredMachine(value) {
  const machine = String(value ?? '').trim();
  return Boolean(machine) && machine !== '0' && machine.toUpperCase() !== 'NIL';
}

function text(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
}

function getEligibleMachines(allocation) {
  return machines.map(machine => machine.id);
}

function mapApiAllocation(row, stage) {
  const machine = stage === 'Stage 1'
    ? (row.selected_stage1_machine ?? row.assigned_stage1_machine ?? row.machine_stage1_selected)
    : (row.selected_stage2_machine ?? row.assigned_stage2_machine ?? row.machine_stage2_selected);
  const primaryMachine = stage === 'Stage 1'
    ? (row.machine_STAGE1 ?? row.machine_stage1)
    : (row.machine_STAGE2 ?? row.machine_stage2);
  const startValue = stage === 'Stage 1' ? row.stage1_start : row.stage2_start;
  const endValue = stage === 'Stage 1' ? row.stage1_end : row.stage2_end;
  const altMachine = stage === 'Stage 1'
    ? (row.machine_STAGE1_A ?? row.machine_stage1_a)
    : (row.machine_STAGE2_A ?? row.machine_stage2_a);
  const start = dbDateTimeParts(startValue);
  const end = dbDateTimeParts(endValue);
  const operationStatus = stage === 'Stage 1' ? row.stage1_status : row.stage2_status;
  if (!machine || !start || !end || operationStatus === 'completed') return null;
  const smhHours = Number(stage === 'Stage 1' ? (row.STAGE1_SMH ?? row.stage1_smh) : (row.STAGE2_SMH ?? row.stage2_smh)) || 0;

  return {
    id: `db-${row.id}-${stage === 'Stage 1' ? 's1' : 's2'}`,
    sr: row.SR,
    partNo: row.PART_NO || '',
    machine: machine,
    primaryMachine: isConfiguredMachine(primaryMachine) ? primaryMachine : machine,
    altMachine: isConfiguredMachine(altMachine) ? altMachine : '',
    // Retained as source metadata; manual board movement is intentionally not
    // restricted to these automatic-allocation candidates.
    eligibleMachines: [...new Set([primaryMachine, altMachine].filter(isConfiguredMachine))],
    project: row.PROJECT || '',
    module: row.MODULE || '',
    priority: row.PRIORITY ?? '',
    quantity: row.BATCH_QTY ?? row.QUANTITY ?? row.quantity ?? 0,
    stage,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    estimatedStartTime: start.time,
    estimatedEndTime: end.time,
    actualStart: stage === 'Stage 1' ? row.stage1_actual_start : row.stage2_actual_start,
    actualEnd: stage === 'Stage 1' ? row.stage1_actual_end : row.stage2_actual_end,
    completedAt: null,
    status: operationStatus || 'idle',
    backendStatus: row.status || 'ALLOCATED',
    // The backend stores one physical-machine queue shared by both stages.
    queuePosition: row.queue_position ?? (stage === 'Stage 1' ? row.stage1_queue_position : row.stage2_queue_position),
    stage1QueuePosition: row.stage1_queue_position,
    stage2QueuePosition: row.stage2_queue_position,
    dbId: row.id,
    workOrder: row.work_order || '',
    manualAssignment: Boolean(row.is_manual),
    durationMinutes: smhHours > 0
      ? Math.max(1, Math.round(smhHours * 60))
      : Math.max(1, Math.round((new Date(endValue) - new Date(startValue)) / 60000)),
    stage1Completed: Boolean(row.stage1_completed) || row.stage1_status === 'completed',
    isCarriedForward: Boolean(Number(row.is_carried_forward)),
    smhHours
  };
}

async function loadFromStorage() {
  try {
    // NOTE: The /replenish-queues call has been intentionally disabled.
    // It was auto-injecting extra rows from the Future Plan pool (testdata3)
    // into allocation_result on every page load, causing the dashboard to show
    // more parts than were actually submitted via "Proceed for Allocation".
    // The dashboard now displays exactly whatever rows exist in allocation_result
    // after a sort run — no automatic top-up. The /replenish-queues endpoint
    // itself remains intact in main1.py if it is ever needed directly.
    //
    // try {
    //   const replenishResponse = await fetch(`${API_BASE_URL}/replenish-queues`, {method:'POST'});
    //   if (!replenishResponse.ok) throw new Error(`HTTP ${replenishResponse.status}`);
    // } catch (replenishError) {
    //   console.warn('Future Plan queue replenishment unavailable.', replenishError);
    // }
    const response = await fetch(`${API_BASE_URL}/allocation-results`, {method:'GET',cache:'no-store'});
    if (!response.ok) throw new Error(`Allocation API returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload.success) throw new Error(payload.message || 'Allocation API returned an error.');

    const rows = Array.isArray(payload.data) ? payload.data
      : Array.isArray(payload.allocations) ? payload.allocations
      : Array.isArray(payload.rows) ? payload.rows : [];
    const apiAllocations = [];
    rows.forEach(row => {
      const s1 = mapApiAllocation(row, 'Stage 1');
      const s2 = mapApiAllocation(row, 'Stage 2');
      if (s1) apiAllocations.push(s1);
      if (s2) apiAllocations.push(s2);
    });

    allocations = apiAllocations;

    // Machine discovery is independent from allocation loading. A missing or
    // differently wrapped machine endpoint must never erase valid cards.
    let machineValues = [];
    try {
      const machineResponse = await fetch(`${API_BASE_URL}/allocation-machines`, {method:'GET',cache:'no-store'});
      if (!machineResponse.ok) throw new Error(`HTTP ${machineResponse.status}`);
      const machinePayload = await machineResponse.json();
      const source = Array.isArray(machinePayload) ? machinePayload
        : Array.isArray(machinePayload.data) ? machinePayload.data
        : Array.isArray(machinePayload.machines) ? machinePayload.machines : [];
      machineValues = source.map(item => typeof item === 'string' ? item
        : item.machine ?? item.machine_name ?? item.id ?? item.name);
    } catch (machineError) {
      console.warn('Machine API unavailable; deriving machines from backend allocation rows.', machineError);
    }

    // Future Plan is the source of machine rows that are due next.  Merging
    // its configured machines keeps an emptied schedule ready for the next
    // applicable plan without changing any existing allocation or timing.
    try {
      const futureResponse = await fetch(`${API_BASE_URL}/future-plan`, {method:'GET',cache:'no-store'});
      if (!futureResponse.ok) throw new Error(`HTTP ${futureResponse.status}`);
      const futurePayload = await futureResponse.json();
      const futureRows = Array.isArray(futurePayload.data) ? futurePayload.data : [];
      machineValues.push(...futureRows.flatMap(row => [
        row.machine_STAGE1, row.machine_STAGE1_A,
        row.machine_STAGE2, row.machine_STAGE2_A
      ]));
    } catch (futureError) {
      console.warn('Future Plan machine discovery unavailable.', futureError);
    }

    // Backend-only fallback: current selected machines and configured Future
    // Plan candidates already present in allocation-results. No dummy names.
    if (!machineValues.some(isConfiguredMachine)) {
      machineValues = rows.flatMap(row => [
        row.selected_stage1_machine, row.selected_stage2_machine,
        row.machine_STAGE1, row.machine_STAGE1_A,
        row.machine_STAGE2, row.machine_STAGE2_A
      ]);
    }
    const uniqueMachineIds = [...new Set(machineValues.filter(isConfiguredMachine).map(value => String(value).trim()))];
    // Carry forward in-session maintenance flags and also re-fetch the
    // persistent backend registry so state survives full page reloads.
    const prevMachineState = new Map(machines.map(m => [m.id, m]));
    let backendMaintenance = new Set();
    try {
      const mResp = await fetch(`${API_BASE_URL}/allocation-machines/maintenance`, {method:'GET',cache:'no-store'});
      if (mResp.ok) {
        const mPayload = await mResp.json();
        backendMaintenance = new Set(mPayload.maintenance || []);
      }
    } catch (_) { /* non-fatal: fall back to in-session flags */ }
    machines = uniqueMachineIds.map(id => ({
      id,
      maintenance: backendMaintenance.has(id) || Boolean(prevMachineState.get(id)?.maintenance)
    }));

    // Ensure a valid selected machine is never orphaned even if an older
    // machine endpoint omitted it.
    allocations.forEach(job => {
      if (isConfiguredMachine(job.machine) && !machines.some(machine => machine.id === job.machine)) {
        machines.push({id:job.machine, maintenance:false});
      }
    });

    // Keep the timeline date aligned with the generated schedule.
    const first = allocations[0];
    if (first?.startDate) {
      CONFIG.scheduleDate = first.startDate;
      CONFIG.scheduleDateDisplay = new Date(`${first.startDate}T00:00:00`)
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    window.__allocationApiState = { ok: true, count: rows.length, machines: machines.length };
    return;
  } catch (error) {
    console.error('Unable to load allocation results:', error);
    allocations = [];
    machines = [];
    window.__allocationApiState = { ok: false, error: error.message };
    showToast('⚠ ALLOCATION API', `${error.message}. Start FastAPI on port 8001 and refresh.`);
  }
}

function saveToStorage() {
  // Active allocations and queue state are owned by MySQL/FastAPI.
}

let dragState = null;

/* ── Time helpers ── */
function snapMinutes(m)          { return Math.round(m / CONFIG.snapMinutes) * CONFIG.snapMinutes; }
function getStartMin()           { return CONFIG.timelineStartHour * 60; }
function getEndMin()             { return CONFIG.timelineEndHour * 60; }
function getTimelineWidth()      { return (CONFIG.timelineEndHour - CONFIG.timelineStartHour) * CONFIG.hourWidth; }
function minutesToLeft(m)        { return ((m - getStartMin()) / 60) * CONFIG.hourWidth; }
function minutesToWidth(s, e)    { return ((e - s) / 60) * CONFIG.hourWidth; }
function leftToMinutes(left) {
  const raw = (left / CONFIG.hourWidth) * 60 + getStartMin();
  return snapMinutes(Math.max(getStartMin(), Math.min(getEndMin(), raw)));
}
function getDuration(a)          { return timeToMinutes(a.endTime) - timeToMinutes(a.startTime); }

/* ── Machine helpers ── */
function getMachine(id)          { return machines.find(m => m.id === id); }
function isMaintenance(id)       { const m = getMachine(id); return m ? m.maintenance : false; }
function getMachineStatus(id) {
  if (isMaintenance(id)) return 'maintenance';
  return getMachineQueue(id).some(job => job.status === 'running') ? 'running' : 'idle';
}

/* Machine queues retain the automatic engine order initially, then use the
 * persisted queue positions maintained by manual board operations.
 * Only parts that have been through the allocation engine (backendStatus is
 * set by the backend when a sorted row is processed) are shown on the board. */
function getMachineQueue(machineId) {
  return allocations
    .filter(job => job.machine === machineId && !job.unallocated && job.backendStatus)
    .sort((a, b) => {
      const aq = Number.isFinite(Number(a.queuePosition)) ? Number(a.queuePosition) : Infinity;
      const bq = Number.isFinite(Number(b.queuePosition)) ? Number(b.queuePosition) : Infinity;
      return aq - bq || timeToMinutes(a.startTime) - timeToMinutes(b.startTime) || String(a.id).localeCompare(String(b.id));
    });
}

function getQueueState(allocation) {
  if (allocation.status === 'running') return 'running';
  if (allocation.status === 'on_hold') return 'waiting';
  if (allocation.stage === 'Stage 2' && !stageDependencySatisfied(allocation)) return 'waiting';
  const queue = getMachineQueue(allocation.machine);
  return queue[0]?.id === allocation.id ? 'ready' : 'waiting';
}

function canStartAllocation(allocation) {
  const anotherJobIsRunning = getMachineQueue(allocation.machine)
    .some(job => job.id !== allocation.id && job.status === 'running');
  return allocation.status !== 'on_hold' && stageDependencySatisfied(allocation) && getQueueState(allocation) === 'ready' &&
    !anotherJobIsRunning && !allocation.unallocated && !isMaintenance(allocation.machine);
}

function stageDependencySatisfied(allocation) {
  if (allocation.stage !== 'Stage 2') return true;
  return allocation.stage1Completed === true;
}

function durationMinutes(job) {
  return Number(job.durationMinutes) || Math.max(1, getDuration(job));
}

function estimatedDurationLabel(job) {
  const hours = (Number(job.smhHours) > 0 ? Number(job.smhHours) : durationMinutes(job) / 60);
  const value = hours.toLocaleString(undefined, {maximumFractionDigits:2});
  return `${value} ${hours === 1 ? 'hour' : 'hours'}`;
}

function formatEstimatedStamp(dateValue, timeValue) {
  return `${formatDisplayDate(dateValue)}, ${formatTime12(timeValue)}`;
}

function workingScheduleSegments(job) {
  const start = new Date(`${job.startDate}T${job.startTime}:00`);
  const end = new Date(`${job.endDate}T${job.endTime}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return [];
  if (job.startDate === job.endDate) return [];
  const segments = [];
  let cursor = new Date(start);
  const pad = n => String(n).padStart(2, '0');
  const stamp = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  while (cursor < end && segments.length < 6) {
    const dayStart = new Date(cursor);
    dayStart.setHours(7, 0, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(23, 0, 0, 0);
    if (cursor < dayStart) cursor = dayStart;
    if (cursor >= dayEnd) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 7, 0, 0);
      continue;
    }
    const sliceEnd = end < dayEnd ? end : dayEnd;
    segments.push(`${formatDisplayDate(`${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}-${pad(cursor.getDate())}`)}: ${formatTime12(stamp(cursor))} - ${formatTime12(stamp(sliceEnd))}`);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 7, 0, 0);
  }
  return segments;
}

function setScheduledRange(job, start) {
  const end = new Date(start.getTime() + durationMinutes(job) * 60000);
  const parts = value => ({
    date: `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`,
    time: `${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`
  });
  const s = parts(start), e = parts(end);
  Object.assign(job, { startDate:s.date, startTime:s.time, endDate:e.date, endTime:e.time,
    estimatedStartTime:s.time, estimatedEndTime:e.time });
  return end;
}

function recalculateMachine(machineId) {
  const queue = getMachineQueue(machineId);
  let cursor = queue.length
    ? new Date(Math.min(...queue.map(job => new Date(`${job.startDate || CONFIG.scheduleDate}T${job.startTime || '08:00'}:00`).getTime())))
    : new Date(`${CONFIG.scheduleDate}T08:00:00`);
  queue.forEach((job, index) => {
    if (job.status === 'running' && job.actualStart) cursor = new Date(job.actualStart);
    job.queuePosition = index + 1;
    cursor = setScheduledRange(job, cursor);
  });
  return queue;
}

async function persistOperations(jobs) {
  const backendJobs = jobs.filter(job => job.dbId);
  await Promise.all(backendJobs.map(job => fetch(`${API_BASE_URL}/allocation-results/${job.dbId}/operation`, {
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      stage:job.stage, machine:job.machine, queue_position:job.queuePosition,
      scheduled_start:`${job.startDate}T${job.startTime}:00`, scheduled_end:`${job.endDate}T${job.endTime}:00`,
      status:job.status, actual_start:job.actualStart, actual_end:job.actualEnd
    })
  }).then(response => { if (!response.ok) throw new Error(`Persistence failed (${response.status})`); })));
}

const FIXED_CARD_WIDTH = 214;
const LANE_HEIGHT = 248;
const LANE_PADDING = 6;
const CARD_GAP = 12;
const ROW_PADDING_X = 12;

function getBoardWidth() {
  const queueLengths = machines.map(machine => Math.min(getMachineQueue(machine.id).length, MAX_VISIBLE_ALLOCATIONS));
  queueLengths.push(allocations.filter(job => job.unallocated).length);
  const maxCards = Math.max(1, ...queueLengths);
  return ROW_PADDING_X * 2 + maxCards * FIXED_CARD_WIDTH + Math.max(0, maxCards - 1) * CARD_GAP;
}

/* ── Conflict detection ── */
function checkConflict(machineId, s, e, excludeId) {
  if (isMaintenance(machineId)) return { type: 'maintenance' };
  const moved = allocations.find(a => a.id === excludeId);
  const movedStartDate = moved?.startDate;
  const movedEndDate = moved?.endDate || movedStartDate;
  const c = allocations.find(a =>
    a.id !== excludeId && a.machine === machineId &&
    (() => {
      if (movedStartDate && a.startDate) {
        const requestedStart = new Date(`${movedStartDate}T${minutesToTime(s)}:00`).getTime();
        const requestedEnd = new Date(`${movedEndDate}T${minutesToTime(e)}:00`).getTime();
        const existingStart = new Date(`${a.startDate}T${a.startTime}:00`).getTime();
        const existingEnd = new Date(`${a.endDate || a.startDate}T${a.endTime}:00`).getTime();
        return requestedStart < existingEnd && requestedEnd > existingStart;
      }
      return s < timeToMinutes(a.endTime) && e > timeToMinutes(a.startTime);
    })()
  );
  return c ? { type: 'overlap', allocation: c } : null;
}

function hasAnyOverlap(items) {
  const sorted = [...items].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  for (let i = 1; i < sorted.length; i++) {
    if (timeToMinutes(sorted[i].startTime) < timeToMinutes(sorted[i-1].endTime)) return true;
  }
  return false;
}

/* ── Auto-shift ── */
function tryResolveWithShift(movedId, targetMachine, reqStart) {
  const moved = allocations.find(a => a.id === movedId);
  if (!moved) return null;
  const d = getDuration(moved);
  if (reqStart < getStartMin() || reqStart + d > getEndMin()) return null;

  const others = allocations.filter(a => a.machine === targetMachine && a.id !== movedId).map(a => ({ ...a }));
  const movedCopy = { ...moved, machine: targetMachine, startTime: minutesToTime(reqStart), endTime: minutesToTime(reqStart + d) };
  let items = [...others, movedCopy].sort((a, b) => {
    const diff = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    return diff !== 0 ? diff : a.id === movedId ? -1 : b.id === movedId ? 1 : 0;
  });

  for (let pass = 0; pass < items.length; pass++) {
    let changed = false;
    for (let i = 1; i < items.length; i++) {
      const prevEnd = timeToMinutes(items[i-1].endTime), currStart = timeToMinutes(items[i].startTime);
      if (currStart < prevEnd) {
        const dur = timeToMinutes(items[i].endTime) - currStart;
        const ns = prevEnd, ne = ns + dur;
        if (ne > getEndMin()) return null;
        items[i].startTime = minutesToTime(ns); items[i].endTime = minutesToTime(ne);
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (items.some(it => timeToMinutes(it.startTime) < getStartMin() || timeToMinutes(it.endTime) > getEndMin())) return null;
  if (hasAnyOverlap(items)) return null;
  return items;
}

/* ── Manual machine override ──
 * Reorder or move a part (including red/stopped parts on a maintenance machine)
 * onto a valid non-maintenance machine. Stage is preserved by the existing move API.
 */
async function handleMachineChange(allocationId, targetMachine, targetIndex) {
  const a = allocations.find(x => x.id === allocationId);
  if (!a) return { success: false, message: 'Not found.' };
  if (a.status === 'running' || a.status === 'completed' || a.status === 'stopped')
    return { success: false, message: 'Started or completed jobs are locked and cannot be moved.' };
  if (!machines.some(machine => machine.id === targetMachine))
    return { success: false, message: 'Drop the part onto an active machine row.' };
  if (isMaintenance(targetMachine))
    return { success: false, message: `${targetMachine} is under maintenance.` };
  try {
    const response = await fetch(`${API_BASE_URL}/allocation-results/${a.dbId}/move`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({stage:a.stage,target_machine:targetMachine,target_index:targetIndex})
    });
    if (!response.ok) throw new Error((await response.json()).detail || `HTTP ${response.status}`);
    await loadFromStorage();
    return {success:true};
  } catch (error) {
    return {success:false,message:`The move could not be saved: ${error.message}`};
  }
}

/* ── Start ── */
async function startAllocation(id) {
  const a = allocations.find(x => x.id === id);
  if (!a) return;
  if (a.stage === 'Stage 2' && !stageDependencySatisfied(a)) {
    showToast('⚠ STAGE DEPENDENCY', 'Stage 1 must be completed before Stage 2 can start.'); return;
  }
  if (a.unallocated || !canStartAllocation(a)) return;
  if (a.status === 'running' || a.status === 'completed' || a.status === 'stopped') return;
  a.status = 'running';
  // Server records the authoritative actual start timestamp.
  a.actualStart = null;
  try {
    await persistOperations([a]);
    await loadFromStorage();
    renderAll();
  } catch (error) {
    await loadFromStorage();
    renderAll();
    showToast('⚠ START PREVENTED', error.message);
  }
}

async function holdAllocation(id) {
  const a = allocations.find(x => x.id === id);
  if (!a || a.unallocated || isMaintenance(a.machine)) return;
  const isOnHold = a.status === 'on_hold';
  if (!isOnHold && a.status !== 'running') return;
  try {
    const response = await fetch(`${API_BASE_URL}/allocation-results/${a.dbId}/operation`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        stage:a.stage, machine:a.machine, queue_position:a.queuePosition,
        scheduled_start:`${a.startDate}T${a.startTime}:00`, scheduled_end:`${a.endDate}T${a.endTime}:00`,
        status:isOnHold ? 'idle' : 'on_hold', actual_start:a.actualStart, actual_end:a.actualEnd
      })
    });
    if (!response.ok) throw new Error((await response.json()).detail || `HTTP ${response.status}`);
    await loadFromStorage();
    renderAll();
    showToast(isOnHold ? '✓ ALLOCATION RESUMED' : 'Ⅱ ALLOCATION ON HOLD',
      isOnHold ? 'The part resumed in its existing machine queue position.' : 'The part remains allocated to its machine and is paused.');
  } catch (error) {
    await loadFromStorage();
    renderAll();
    showToast('⚠ HOLD FAILED', error.message);
  }
}

/* ── Stop — self-contained, no CNCStorage.load() ── */
async function stopAllocation(id) {
  const a = allocations.find(x => x.id === id);
  if (!a) return;
  // Reject if machine is under maintenance or job is tagged unallocated
  if (a.unallocated || isMaintenance(a.machine)) return;
  if (a.status !== 'running') return;

  const now = new Date();
  // Server records the authoritative actual end timestamp — same pattern as
  // actualStart in startAllocation(). We no longer send the browser's clock;
  // it was a UTC timestamp getting stored as a raw naive-IST value on the
  // backend, which is why stopped times in History looked off.
  a.actualEnd   = null;
  a.completedAt = now.toISOString();
  a.status = 'completed';
  try {
    const response = await fetch(`${API_BASE_URL}/allocation-results/${a.dbId}/complete`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      stage:a.stage,machine:a.machine,queue_position:a.queuePosition,scheduled_start:`${a.startDate}T${a.startTime}:00`,scheduled_end:`${a.endDate}T${a.endTime}:00`,status:'completed',actual_start:a.actualStart,actual_end:null
    })});
    if (!response.ok) throw new Error(`Completion API returned ${response.status}`);
  }
  catch (error) { showToast('⚠ SAVE FAILED', error.message); return; }

  await loadFromStorage();
  renderAll();
}

async function dismissAllocation(allocation) {
  if (!allocation?.dbId) {
    showToast('⚠ REMOVE FAILED', 'This part has no allocation id.');
    return;
  }
  if (!window.confirm('Remove this part from the current allocation?')) return;
  try {
    const response = await fetch(`${API_BASE_URL}/allocation-results/${allocation.dbId}`, {method:'DELETE'});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
    await loadFromStorage();
    renderAll();
    showToast('✓ PART REMOVED', `${allocation.partNo} was removed from the current allocation.`);
  } catch (error) {
    showToast('⚠ REMOVE FAILED', error.message);
  }
}

/* ── Maintenance ── */

async function setMaintenance(id) {
  const m = getMachine(id); if (!m) return;
  m.maintenance = true;

  // Parts stay on this machine. Running work is halted so cards turn red and
  // remain draggable; nothing is moved to Not Allocated.
  allocations.forEach(a => {
    if (a.machine !== id) return;
    if (a.status === 'running') a.status = 'idle';
  });

  try {
    const response = await fetch(`${API_BASE_URL}/allocation-machines/${encodeURIComponent(id)}/maintenance`, {method:'POST'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    m.maintenance = false;
    showToast('⚠ MAINTENANCE NOT SAVED', err.message || 'Unable to persist maintenance.');
    await loadFromStorage();
    renderAll();
    return;
  }

  await loadFromStorage();
  renderAll();
  showToast('⚠ MACHINE MAINTENANCE', `${id} is under maintenance. Parts remain on the machine and are stopped.`);
}

async function removeMaintenance(id) {
  const m = getMachine(id); if (!m) return;
  m.maintenance = false;

  try {
    const response = await fetch(`${API_BASE_URL}/allocation-machines/${encodeURIComponent(id)}/maintenance`, {method:'DELETE'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    m.maintenance = true;
    showToast('⚠ MAINTENANCE UPDATE FAILED', err.message || 'Unable to clear maintenance.');
    await loadFromStorage();
    renderAll();
    return;
  }

  await loadFromStorage();
  renderAll();
  showToast('✓ MACHINE RESTORED', `${id} is back from maintenance. Allocated parts were left in place.`);
}

/* ── Export to Excel (SpreadsheetML) ── */
function exportFile() {
  // Estimated Start/End are identical to Scheduled Start/End at allocation time
  // and add no new information — consolidated into a single Scheduled column.
  const headers = ['Part Number','Project','Module','Quantity','Machine','Stage',
    'Scheduled Start','Scheduled End','Actual Start','Actual End','Status'];
  const rows = allocations.map(a => [
    a.partNo, a.project, a.module, a.quantity, a.machine, a.stage,
    `${formatDisplayDate(a.startDate)}, ${formatTime12(a.startTime)}`,
    `${formatDisplayDate(a.endDate)}, ${formatTime12(a.endTime)}`,
    formatDateTimeDisplay(a.actualStart), formatDateTimeDisplay(a.actualEnd),
    a.status.toUpperCase()
  ]);
  const today = formatDateISO(new Date());
  downloadXls('CNC_Allocation_Schedule_' + today + '.xls', headers, rows);
}

/* ── Toast ── */
function showToast(title, message) {
  const t = document.getElementById('toast');
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastMessage').textContent = message;
  t.hidden = false;
  t.dataset.kind = title.includes('ALLOCATION CONFLICT') ? 'conflict' : 'notice';
  const isSuccess = title.startsWith('✓');
  t.className = isSuccess ? 'toast toast-success' : 'toast';
  const iconEl = t.querySelector('.toast-icon');
  if (iconEl) iconEl.textContent = isSuccess ? '✓' : '⚠';
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => hideToast(), 5000);
}
function hideToast() { document.getElementById('toast').hidden = true; }
function hideConflictToast() {
  const toast = document.getElementById('toast');
  if (toast.dataset.kind === 'conflict') hideToast();
}

/* ── Render board canvas (no visible time axis) ── */
function renderTimeline() {
  document.getElementById('timelineCanvas').style.width = getBoardWidth() + 'px';
}

/* ── Render sidebar ── */
function renderMachines() {
  const list = document.getElementById('machineList');
  list.innerHTML = '';

  if (window.__allocationApiState?.ok === false) {
    const errorItem = document.createElement('div');
    errorItem.className = 'machine-item api-error-item';
    errorItem.style.height = LANE_HEIGHT + 'px';
    errorItem.innerHTML = `
      <div class="machine-name">API OFFLINE</div>
      <div class="machine-status maintenance">No machine data</div>
      <div class="na-hint">Run: python api/main1.py</div>`;
    list.appendChild(errorItem);
    return;
  }

  machines.forEach(machine => {
    const allocs = getMachineQueue(machine.id);
    const itemHeight = LANE_HEIGHT;
    const status = getMachineStatus(machine.id);
    const lbl = status === 'maintenance' ? 'Maintenance' : status === 'running' ? 'Running' : 'Idle';

    const item = document.createElement('div');
    item.className = 'machine-item' + (machine.maintenance ? ' maintenance' : '');
    item.dataset.machine = machine.id;
    item.style.height = itemHeight + 'px';
    item.innerHTML = `
      <div class="machine-name">${machine.id}</div>
      <div class="machine-status ${status}">${lbl}</div>
      <div class="machine-controls">
        ${machine.maintenance
          ? `<button class="btn-back-maintenance" data-action="back-maintenance" data-machine="${machine.id}">Back From Maintenance</button>`
          : `<button class="btn-maintenance" data-action="maintenance" data-machine="${machine.id}">Maintenance</button>`}
      </div>`;
    list.appendChild(item);
  });

  list.querySelectorAll('[data-action="maintenance"]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); setMaintenance(btn.dataset.machine); }));
  list.querySelectorAll('[data-action="back-maintenance"]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); removeMaintenance(btn.dataset.machine); }));
}

/* ── Create allocation box ── */
function createAllocationElement(allocation) {
  const stageClass = allocation.stage === 'Stage 1' ? 'stage-1' : 'stage-2';
  const inMaintenance = isMaintenance(allocation.machine);
  const queueState = inMaintenance ? 'stopped' : getQueueState(allocation);
  const isRunning  = queueState === 'running';
  const canStart   = canStartAllocation(allocation);
  const dependencyBlocked = allocation.stage === 'Stage 2' && !stageDependencySatisfied(allocation);

  const box = document.createElement('div');
  box.className = `allocation-box ${stageClass} queue-${queueState}`
    + (inMaintenance ? ' maintenance-part' : ' active-machine-part')
    + (allocation.isCarriedForward ? ' carried-forward-part' : '');
  box.dataset.id = allocation.id;
  box.dataset.dbId = allocation.dbId || '';
  box.title = inMaintenance
    ? 'Machine under maintenance — drag this part to a valid machine'
    : allocation.stage === 'Stage 2' && !stageDependencySatisfied(allocation)
    ? 'Stage 1 must be completed before this operation can start.' : 'Drag to reorder or move to another machine';

  box.style.width  = FIXED_CARD_WIDTH + 'px';
  box.style.height = (LANE_HEIGHT - LANE_PADDING * 2) + 'px';

  const badge = `<div class="alloc-status-badge ${queueState}">${queueState.toUpperCase()}</div>`;

  const displayActual = value => value ? formatDateTimeDisplay(value) : 'Not Started';
  const text = value => String(value ?? '—').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const estimatedSegments = workingScheduleSegments(allocation);
  const estimatedTitle = `Start: ${formatEstimatedStamp(allocation.startDate, allocation.startTime)} · End: ${formatEstimatedStamp(allocation.endDate, allocation.endTime)}`;
  box.innerHTML = `
    <button type="button" class="btn-dismiss-part" data-action="dismiss" title="Remove Part" aria-label="Remove Part" onmousedown="event.stopPropagation()">&times;</button>
    <div class="alloc-card-heading"><div class="alloc-part-no" title="${text(allocation.partNo)}">${text(allocation.partNo)}</div><div class="alloc-stage">${text(allocation.stage)}</div></div>
    <div class="alloc-summary">
      <span title="Project: ${text(allocation.project)}">Project: ${text(allocation.project)}</span><span title="Module: ${text(allocation.module)}">Module: ${text(allocation.module)}</span><span>Qty: ${text(allocation.quantity)}</span>
    </div>
    <div class="alloc-time-group"><strong>Scheduled Date</strong><span class="scheduled-value">${formatDisplayDate(allocation.startDate)}<br>${formatTime12(allocation.startTime)} – ${formatTime12(allocation.endTime)}</span></div>
    <div class="alloc-time-group estimated"><strong>Estimated</strong><span class="estimated-value" title="${estimatedTitle}">Start: ${formatEstimatedStamp(allocation.startDate, allocation.startTime)}<br>End: ${formatEstimatedStamp(allocation.endDate, allocation.endTime)}${estimatedSegments.length ? `<br>${estimatedSegments.join('<br>')}` : ''}</span></div>
    <div class="alloc-time-group actual"><strong>Actual</strong><span>${allocation.actualStart ? displayActual(allocation.actualStart) : 'Not Started'} / ${allocation.actualEnd ? formatDateTimeDisplay(allocation.actualEnd) : '—'}</span></div>
    ${allocation.manualAssignment ? '<div class="alloc-assignment-badge">MANUAL</div>' : ''}
    ${badge}
    <div class="alloc-work-order" onmousedown="event.stopPropagation()">
      <label>Work Order</label>
      <input type="text" class="wo-input" value="${text(allocation.workOrder || '')}" placeholder="Enter work order" ${allocation.dbId ? '' : 'disabled'}>
      <button class="wo-save" data-action="save-wo" ${allocation.dbId ? '' : 'disabled'}>Save</button>
      <span class="wo-state"></span>
    </div>
    <div class="alloc-actions">
      <button class="btn-start${isRunning?' active':''}" data-action="start" ${(!canStart&&!dependencyBlocked)||isRunning||inMaintenance?'disabled':''}>▶ START</button>
      <button class="btn-stop" data-action="stop" ${!isRunning||inMaintenance?'disabled':''}>■ STOP</button>
    </div>`;

  box.querySelector('[data-action="start"]').addEventListener('click', ev => {
    ev.stopPropagation(); startAllocation(allocation.id);
  });
  box.querySelector('[data-action="stop"]').addEventListener('click', ev => {
    ev.stopPropagation(); stopAllocation(allocation.id);
  });
  box.querySelector('[data-action="dismiss"]')?.addEventListener('click', ev => {
    ev.stopPropagation();
    dismissAllocation(allocation);
  });
  const woInput = box.querySelector('.wo-input');
  const woState = box.querySelector('.wo-state');
  woInput?.addEventListener('mousedown', ev => ev.stopPropagation());
  woInput?.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); saveWorkOrder(); } });
  box.querySelector('[data-action="save-wo"]')?.addEventListener('click', ev => {
    ev.stopPropagation(); saveWorkOrder();
  });
  async function saveWorkOrder() {
    const value = woInput.value.trim();
    woState.textContent = 'Saving…';
    try {
      const response = await fetch(`${API_BASE_URL}/allocation-results/${allocation.dbId}/work-order`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order: value })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Unable to save Work Order.');
      allocation.workOrder = result.work_order || '';
      woInput.value = allocation.workOrder;
      woState.textContent = 'Saved ✓';
      setTimeout(() => { woState.textContent = ''; }, 1500);
    } catch (err) {
      woState.textContent = 'Error';
      showToast('✗ WORK ORDER NOT SAVED', err.message || 'Unable to save Work Order.');
    }
  }
  box.addEventListener('mousedown', onDragStart);
  return box;
}

/* ── Render machine rows ── */
function renderAllocations() {
  const wrap = document.getElementById('machineRows');
  wrap.innerHTML = '';

  if (window.__allocationApiState?.ok === false) {
    const row = document.createElement('div');
    row.className = 'machine-row api-error-row';
    row.style.width = Math.max(getBoardWidth(), 720) + 'px';
    row.style.height = LANE_HEIGHT + 'px';
    row.innerHTML = `<div class="board-api-error"><strong>Allocation API is not running.</strong><span>Start it with <code>python api/main1.py</code>, then refresh this page.</span></div>`;
    wrap.appendChild(row);
    return;
  }

  // Regular machine rows
  machines.forEach(machine => {
    const allocs = getMachineQueue(machine.id);
    const rowH = LANE_HEIGHT;

    const row = document.createElement('div');
    row.className = 'machine-row' + (machine.maintenance ? ' maintenance-row' : '');
    row.dataset.machine = machine.id;
    row.style.width = getBoardWidth() + 'px';
    row.style.height = rowH + 'px';

    const lane = document.createElement('div');
    lane.className = 'machine-lane';
    allocs.slice(0, MAX_VISIBLE_ALLOCATIONS)
      .forEach(alloc => lane.appendChild(createAllocationElement(alloc)));
    row.appendChild(lane);
    if (machine.maintenance) {
      const ov = document.createElement('div'); ov.className = 'maintenance-overlay'; row.appendChild(ov);
      const lb = document.createElement('div'); lb.className = 'maintenance-label'; lb.textContent = '🔴 MAINTENANCE'; row.appendChild(lb);
    }
    wrap.appendChild(row);
  });
}

function renderAll() { renderTimeline(); renderMachines(); renderAllocations(); syncScrollHeights(); }

/* ── Scroll sync ── */
function syncScrollHeights() {
  const ml = document.getElementById('machineList');
  const ts = document.getElementById('timelineBodyScroll');
  ml.onscroll = () => { ts.scrollTop = ml.scrollTop; };
  ts.onscroll = () => { ml.scrollTop = ts.scrollTop; };
}

/* ── Drag & Drop ── */
function onDragStart(e) {
  if (e.button !== 0 || e.target.closest('button')) return;
  const box = e.currentTarget;
  const alloc = allocations.find(a => a.id === box.dataset.id);
  if (!alloc || alloc.status === 'running' || alloc.status === 'on_hold' || alloc.status === 'completed' || alloc.status === 'stopped') return;
  e.preventDefault();
  const bodyScroll = document.getElementById('timelineBodyScroll');
  const boxRect = box.getBoundingClientRect();
  dragState = {
    allocationId: alloc.id, originalMachine: alloc.machine,
    originalStart: timeToMinutes(alloc.startTime), originalEnd: timeToMinutes(alloc.endTime),
    duration: getDuration(alloc), offsetX: e.clientX - boxRect.left,
    scrollLeft: bodyScroll.scrollLeft, scrollTop: bodyScroll.scrollTop
  };
  box.classList.add('dragging');
  document.getElementById('dragPreview').hidden = false;
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function getTargetFromPointer(clientX, clientY) {
  const bs = document.getElementById('timelineBodyScroll');
  const canvas = document.getElementById('timelineCanvas');
  const cr = canvas.getBoundingClientRect();
  // `cr.top` already reflects the scroll container's offset. Adding scrollTop
  // again skips rows and can resolve a visible alternate row as Unallocated.
  const relY = clientY - cr.top;
  const allocation = allocations.find(a => a.id === dragState.allocationId);
  const newStart = timeToMinutes(allocation.startTime);

  const rows = document.querySelectorAll('.machine-row');
  let cumY = 0, targetMachine = machines[0].id;
  for (let i = 0; i < rows.length; i++) {
    const rh = rows[i].offsetHeight;
    if (relY < cumY + rh) { targetMachine = rows[i].dataset.machine; break; }
    cumY += rh;
    if (i === rows.length - 1) targetMachine = rows[i].dataset.machine;
  }
  const targetRow = [...rows].find(row => row.dataset.machine === targetMachine);
  const cards = targetRow ? [...targetRow.querySelectorAll('.allocation-box:not(.dragging)')] : [];
  let targetIndex = cards.length;
  for (let i=0; i<cards.length; i++) {
    if (clientX < cards[i].getBoundingClientRect().left + cards[i].offsetWidth / 2) { targetIndex=i; break; }
  }
  return { targetMachine, targetIndex, newStart, newEnd: newStart + dragState.duration };
}

function isDropValid(target, s, e) {
  const allocation = allocations.find(a => a.id === dragState.allocationId);
  if (!allocation) return false;
  if (!machines.some(machine => machine.id === target)) return false;
  if (isMaintenance(target)) return false;
  return true;
}

function onDragMove(e) {
  if (!dragState) return;
  const preview = document.getElementById('dragPreview');
  const { targetMachine, newStart, newEnd } = getTargetFromPointer(e.clientX, e.clientY);
  const valid = isDropValid(targetMachine, newStart, newEnd);
  preview.style.left = (e.clientX + 16) + 'px';
  preview.style.top  = (e.clientY + 16) + 'px';
  preview.querySelector('.preview-part').textContent = allocations.find(a=>a.id===dragState.allocationId)?.partNo || '';
  preview.querySelector('.preview-time').textContent = `${formatTime12(minutesToTime(newStart))} → ${formatTime12(minutesToTime(newEnd))}`;
  preview.querySelector('.preview-status').textContent = valid ? `${targetMachine}  ✓` : `${targetMachine}  ✕`;
  preview.querySelector('.preview-status').className = 'preview-status ' + (valid ? 'valid' : 'invalid');
  document.querySelectorAll('.machine-row').forEach(row => {
    row.classList.remove('drag-target','drag-target-invalid');
    if (row.dataset.machine === targetMachine) row.classList.add(valid ? 'drag-target' : 'drag-target-invalid');
  });
}

async function onDragEnd(e) {
  if (!dragState) return;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  const box = document.querySelector(`.allocation-box[data-id="${dragState.allocationId}"]`);
  if (box) box.classList.remove('dragging');
  document.getElementById('dragPreview').hidden = true;
  document.querySelectorAll('.machine-row').forEach(r => r.classList.remove('drag-target','drag-target-invalid'));

  const { targetMachine, targetIndex, newStart, newEnd } = getTargetFromPointer(e.clientX, e.clientY);
  const movedId = dragState.allocationId;
  if (!isDropValid(targetMachine, newStart, newEnd)) {
    dragState = null;
    renderAll();
    return;
  }
  const result = await handleMachineChange(movedId, targetMachine, targetIndex);
  if (!result.success) {
    await loadFromStorage();
    showToast('⚠ ALLOCATION CONFLICT', result.message);
  } else {
    hideConflictToast();
    const updated = allocations.find(allocation => allocation.id === movedId);
    if (updated) {
      showToast('✓ SCHEDULE UPDATED', `${updated.partNo} → ${updated.machine}, ${formatDisplayDate(updated.startDate)} ${formatTime12(updated.startTime)} – ${formatTime12(updated.endTime)}`);
    }
  }
  dragState = null;
  renderAll();
}

/* ── Shared Excel helper (SpreadsheetML — opens natively in Excel) ── */
function downloadXls(filename, headers, rows) {
  const esc = v => String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const headerRow = headers.map(h =>
    `<Cell ss:StyleID="hdr"><Data ss:Type="String">${esc(h)}</Data></Cell>`
  ).join('');

  const dataRows = rows.map(row =>
    '<Row>' + row.map(cell =>
      `<Cell><Data ss:Type="String">${esc(cell)}</Data></Cell>`
    ).join('') + '</Row>'
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="hdr">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Sheet1">
    <Table>
      <Row>${headerRow}</Row>
${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

let manualPlanningRecords = [];

function renderNewManualForm() {
  const fields = document.getElementById('manualFormFields');
  const integer = (name, min=0) => `<label class="manual-field">${name}<input name="${name}" type="number" min="${min}" step="1" required></label>`;
  const suggestedSr = Math.max(0, ...manualPlanningRecords.map(record => Number(record.SR) || 0)) + 1;
  fields.innerHTML = `
    <label class="manual-field">Allocation type<select name="manual_mode"><option value="new">Create New Part</option><option value="existing">Add Existing Part</option></select></label>
    <label class="manual-field">Project<input name="project" required></label><label class="manual-field">Module<input name="module" required></label>
    <label class="manual-field">SR<input value="${suggestedSr} (generated on create)" readonly></label>
    <label class="manual-field">PART_NO<input name="part_no" required></label>${integer('batch_qty',1)}
    ${integer('stage1_setup_time')}${integer('stage1_unit_time')}
    <label class="manual-field">STAGE1_smh<input value="Calculated by backend" readonly></label>
    <label class="manual-field">stage2_setup_time<input name="stage2_setup_time" type="number" min="0" step="1"></label><label class="manual-field">stage2_unit_time<input name="stage2_unit_time" type="number" min="0" step="1"></label>
    <label class="manual-field">Complete Stage (Stage 2)<select name="completed_stage"><option value="">None (Stage 1 only)</option><option value="Stage 2">Stage 2</option></select></label>
    <label class="manual-field">Stage 1 Machine<select name="selected_machine" required><option value="">Select Stage 1 Machine</option>${machines.map(machine => `<option>${text(machine.id)}</option>`).join('')}</select></label>
    <label class="manual-field">Stage 2 Machine<select name="selected_stage2_machine"><option value="">Select Stage 2 Machine</option>${machines.map(machine => `<option>${text(machine.id)}</option>`).join('')}</select></label>`;
  fields.querySelector('[name="manual_mode"]').addEventListener('change', () => openManualAllocation());
}

async function openManualAllocation() {
  try {
    const response = await fetch(`${API_BASE_URL}/planning-records`, {cache:'no-store'});
    if (!response.ok) throw new Error(`Planning API returned ${response.status}`);
    const payload = await response.json();
    manualPlanningRecords = payload.data || [];
    if (!manualPlanningRecords.length) throw new Error('Planning data contains no SR records.');
    const fields = document.getElementById('manualFormFields');

    // Build a datalist so the part number input has live search autocomplete.
    const datalistId = 'partNoSuggestions';
    const datalistOptions = manualPlanningRecords
      .map(r => `<option value="${text(r.PART_NO)}" data-sr="${text(r.SR)}">`)
      .join('');

    fields.innerHTML = `
    <datalist id="${datalistId}">${datalistOptions}</datalist>
    <label class="manual-field">Allocation type<select name="manual_mode"><option value="existing">Add Existing Part</option><option value="new">Create New Part</option></select></label>
    <label class="manual-field">Part Number<input name="part_no_search" list="${datalistId}" placeholder="Type to search part numbers…" autocomplete="off" required></label>
    <input type="hidden" name="SR">
    <label class="manual-field">Quantity<input name="quantity" type="number" min="1" step="1" required></label>
    <label class="manual-field">Stage 1 Machine<select name="selected_machine"><option value="">Select Stage 1 Machine</option>${machines.map(machine => `<option>${text(machine.id)}</option>`).join('')}</select></label>
    <label class="manual-field">Stage 2 Machine<select name="selected_stage2_machine"><option value="">Select Stage 2 Machine</option>${machines.map(machine => `<option>${text(machine.id)}</option>`).join('')}</select></label>`;

    fields.querySelector('[name="manual_mode"]').addEventListener('change', event => { if (event.target.value === 'new') renderNewManualForm(); });

    // When the user picks or types a part number, resolve it to an SR and
    // prefill quantity and machine from the planning record.
    const partInput = fields.querySelector('[name="part_no_search"]');
    const srInput   = fields.querySelector('[name="SR"]');
    const qtyInput  = fields.querySelector('[name="quantity"]');
    const machSel   = fields.querySelector('[name="selected_machine"]');
    const mach2Sel  = fields.querySelector('[name="selected_stage2_machine"]');

    function resolvePartNo(partNo) {
      const record = manualPlanningRecords.find(r => r.PART_NO === partNo);
      if (!record) { srInput.value = ''; return; }
      srInput.value    = record.SR;
      qtyInput.value   = record.BATCH_QTY ?? '';
      machSel.value    = record.machine_STAGE1 ?? '';
      if (mach2Sel) mach2Sel.value = record.machine_STAGE2 ?? '';
    }

    partInput.addEventListener('input', () => resolvePartNo(partInput.value.trim()));
    partInput.addEventListener('change', () => resolvePartNo(partInput.value.trim()));

    // Wire quantity to immediately PATCH the DB when the user leaves the field.
    qtyInput.addEventListener('blur', async () => {
      const currentSr = srInput.value;
      if (!currentSr) return;
      const qty = parseInt(qtyInput.value, 10);
      if (!qty || qty < 1) return;
      // Find the allocation_result id for this SR so we can call the quantity endpoint.
      // We look it up from the allocations already loaded on the board.
      const match = allocations.find(a => String(a.sr) === String(currentSr));
      if (!match?.dbId) return;
      try {
        const r = await fetch(`${API_BASE_URL}/allocation-results/${match.dbId}/quantity`, {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({quantity: qty})
        });
        if (!r.ok) console.warn('Quantity update failed:', await r.text());
      } catch (err) { console.warn('Quantity PATCH error:', err); }
    });

    document.getElementById('manualModal').hidden = false;
  } catch (error) { showToast('⚠ MANUAL ALLOCATION', `Unable to load planning data: ${error.message}`); }
}

function closeManualAllocation() { document.getElementById('manualModal').hidden = true; }

async function submitManualAllocation(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());

  if (values.manual_mode === 'new') {
    try {
      const response = await fetch(`${API_BASE_URL}/allocation-results/manual/new`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          ...values,
          priority:0,
          stage:values.completed_stage || 'Stage 1',
          selected_stage2_machine: values.selected_stage2_machine || null,
          stage2_setup_time:Number(values.stage2_setup_time || 0),
          stage2_unit_time:Number(values.stage2_unit_time || 0)
        })
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || `API returned ${response.status}`);
      }
      await loadFromStorage(); closeManualAllocation(); renderAll();
      showToast('✓ NEW PART ALLOCATED', 'SR and SMH were calculated by the backend.');
    } catch (error) {
      showToast('⚠ NEW PART FAILED', error.message);
    }
    return;
  }

  if (!values.SR) {
    showToast('⚠ MANUAL ALLOCATION', 'Select an existing part number from planning data.');
    return;
  }

  const {selected_machine, selected_stage2_machine, part_no_search, ...sourceValues} = values;
  const payload = {
    values: sourceValues,
    stage: 'Stage 1',
    selected_machine: selected_machine || null,
    selected_stage2_machine: selected_stage2_machine || null
  };
  try {
    const response = await fetch(`${API_BASE_URL}/allocation-results/manual`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.detail || `API returned ${response.status}`);
    }
    await response.json();
  } catch (error) {
    showToast('⚠ MANUAL ALLOCATION FAILED', error.message);
    return;
  }
  await loadFromStorage(); closeManualAllocation(); event.currentTarget.reset(); renderAll();
  showToast('✓ MANUAL ALLOCATION', 'The selected stage was assigned to the machine queue.');
}

/* ── Init ── */
async function init() {
  document.getElementById('exportBtn').addEventListener('click', exportFile);
  document.getElementById('refreshBtn')?.remove();
  document.getElementById('toastClose').addEventListener('click', hideToast);
  await loadFromStorage();
  renderAll();
  // Keep Future Plan machine availability in sync as allocations finish.
  setInterval(async () => {
    if (document.hidden) return;
    await loadFromStorage();
    renderAll();
  }, 30000);
  document.getElementById('manualAllocationBtn').addEventListener('click', openManualAllocation);
  document.getElementById('manualModalClose').addEventListener('click', closeManualAllocation);
  document.getElementById('manualCancelBtn').addEventListener('click', closeManualAllocation);
  document.getElementById('manualAllocationForm').addEventListener('submit', submitManualAllocation);
  document.getElementById('logoutBtn')?.addEventListener ('click', () => {
    window.location.href = '../sorting/index.html';
  });
}

document.addEventListener('DOMContentLoaded', init);