/**
 * CNC Allocation History Page
 */

const PAGE_SIZE = 25;
const HISTORY_API_BASE_URL = new URLSearchParams(window.location.search).get('api') || 'http://127.0.0.1:8001';

const state = {
  data: null,
  filters: { dateFrom: '', dateTo: '', machine: '', stage: '', search: '' },
  sort: { field: 'completedAt', direction: 'desc' },
  currentPage: 1,
  filteredRecords: []
};

async function loadHistoryData() {
  const response = await fetch(`${HISTORY_API_BASE_URL}/allocation-history`, {cache:'no-store'});
  if (!response.ok) throw new Error(`History API returned ${response.status}`);
  const payload = await response.json();
  state.data = {allocationHistory:(payload.data || []).map(row => CNCStorage.normalizeAllocation({
    id:`history-${row.id}`, partNo:row.part_no, project:row.project, module:row.module,
    priority:row.priority, quantity:row.batch_qty, machine:row.machine, stage:row.stage,
    startDate:String(row.scheduled_start || '').slice(0,10), startTime:String(row.scheduled_start || '').slice(11,16),
    endDate:String(row.scheduled_end || '').slice(0,10), endTime:String(row.scheduled_end || '').slice(11,16),
    estimatedStartTime:String(row.scheduled_start || '').slice(11,16), estimatedEndTime:String(row.scheduled_end || '').slice(11,16),
    actualStart:row.actual_start, actualEnd:row.actual_end, completedAt:row.completed_at, status:'completed'
  }))};
}

function getCompletionDate(r) {
  return r.completedAt ? formatDateISO(new Date(r.completedAt)) : r.endDate;
}

function applyFilters() {
  let records = [...state.data.allocationHistory];
  const f = state.filters;
  if (f.dateFrom) records = records.filter(r => getCompletionDate(r) >= f.dateFrom);
  if (f.dateTo)   records = records.filter(r => getCompletionDate(r) <= f.dateTo);
  if (f.machine)  records = records.filter(r => r.machine === f.machine);
  if (f.stage)    records = records.filter(r => r.stage === f.stage);
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    records = records.filter(r =>
      r.partNo.toLowerCase().includes(q) ||
      r.machine.toLowerCase().includes(q) ||
      (r.project && r.project.toLowerCase().includes(q)) ||
      (r.module  && r.module.toLowerCase().includes(q))
    );
  }
  records.sort((a, b) => compareRecords(a, b, state.sort.field, state.sort.direction));
  state.filteredRecords = records;
  state.currentPage = 1;
}

function compareRecords(a, b, field, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  if (field === 'completedAt') {
    const da = a.completedAt || `${a.endDate}T${a.endTime}`;
    const db = b.completedAt || `${b.endDate}T${b.endTime}`;
    return da.localeCompare(db) * mul;
  }
  if (field === 'duration') {
    return ((timeToMinutes(a.endTime)-timeToMinutes(a.startTime)) - (timeToMinutes(b.endTime)-timeToMinutes(b.startTime))) * mul;
  }
  if (field === 'priority') return ((a.priority||0) - (b.priority||0)) * mul;
  if (field === 'quantity') return ((a.quantity||0) - (b.quantity||0)) * mul;
  return String(a[field]||'').toLowerCase().localeCompare(String(b[field]||'').toLowerCase()) * mul;
}

function getPageRecords() {
  const start = (state.currentPage - 1) * PAGE_SIZE;
  return state.filteredRecords.slice(start, start + PAGE_SIZE);
}
function getTotalPages() { return Math.max(1, Math.ceil(state.filteredRecords.length / PAGE_SIZE)); }

function renderTable() {
  const tbody    = document.getElementById('historyTableBody');
  const emptyAll = document.getElementById('emptyState');
  const emptyFil = document.getElementById('emptyFiltered');
  const tableWrap= document.getElementById('tableWrapper');
  const pag      = document.getElementById('pagination');
  const count    = document.getElementById('recordCount');

  tbody.innerHTML = '';
  const total    = state.data.allocationHistory.length;
  const filtered = state.filteredRecords.length;

  if (total === 0) {
    emptyAll.hidden = false; emptyFil.hidden = true;
    tableWrap.hidden = true; pag.hidden = true; count.textContent = ''; return;
  }
  emptyAll.hidden = true;
  if (filtered === 0) {
    emptyFil.hidden = false; tableWrap.hidden = true; pag.hidden = true;
    count.textContent = '0 records'; return;
  }
  emptyFil.hidden = true; tableWrap.hidden = false; pag.hidden = false;
  count.textContent = `${filtered} record${filtered !== 1 ? 's' : ''}`;

  getPageRecords().forEach((record, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.id = record.id;
    const sc  = record.stage === 'Stage 1' ? 'stage-1' : 'stage-2';
    const stc = record.status === 'completed' ? 'completed' : 'stopped';
    const stl = record.status === 'completed' ? '✓ COMPLETED' : 'STOPPED';
    const srNum = (state.currentPage - 1) * PAGE_SIZE + idx + 1;
    tr.innerHTML = `
      <td class="col-sr">${srNum}</td>
      <td><strong>${record.partNo}</strong></td>
      <td>${record.project || '—'}</td>
      <td>${record.module  || '—'}</td>
      <td>${record.quantity ?? '—'}</td>
      <td>${record.priority ?? '—'}</td>
      <td>${record.machine}</td>
      <td><span class="stage-badge ${sc}">${record.stage}</span></td>
      <td>${formatDisplayDate(record.startDate)}, ${formatTime12(record.startTime)}</td>
      <td>${formatDisplayDate(record.endDate)}, ${formatTime12(record.endTime)}</td>
      <td>${formatTime12(record.estimatedStartTime)}</td>
      <td>${formatTime12(record.estimatedEndTime)}</td>
      <td>${getDurationLabel(record)}</td>
      <td>${formatDateTimeDisplay(record.actualStart)}</td>
      <td>${formatDateTimeDisplay(record.completedAt || record.actualEnd)}</td>
      <td><span class="status-badge ${stc}">${stl}</span></td>`;
    tbody.appendChild(tr);
  });

  renderPagination();
  updateSortHeaders();
}

function renderPagination() {
  const pag = document.getElementById('pagination');
  const total = state.filteredRecords.length;
  const totalPages = getTotalPages();
  if (total === 0) { pag.hidden = true; return; }
  pag.hidden = false;
  const start = (state.currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(state.currentPage * PAGE_SIZE, total);
  document.getElementById('paginationInfo').textContent =
    totalPages > 1 ? `Showing ${start}–${end} of ${total}` : `Showing ${total} record${total !== 1 ? 's' : ''}`;
  document.getElementById('prevPage').disabled = state.currentPage <= 1;
  document.getElementById('nextPage').disabled = state.currentPage >= totalPages;

  const nums = document.getElementById('pageNumbers');
  nums.innerHTML = '';
  const maxV = 5;
  let sp = Math.max(1, state.currentPage - Math.floor(maxV/2));
  let ep = Math.min(totalPages, sp + maxV - 1);
  if (ep - sp < maxV - 1) sp = Math.max(1, ep - maxV + 1);
  for (let i = sp; i <= ep; i++) {
    const btn = document.createElement('button');
    btn.className = 'page-num' + (i === state.currentPage ? ' active' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => { state.currentPage = i; renderTable(); });
    nums.appendChild(btn);
  }
}

function updateSortHeaders() {
  document.querySelectorAll('.history-table th[data-sort]').forEach(th => {
    th.classList.remove('sorted-asc','sorted-desc');
    if (th.dataset.sort === state.sort.field)
      th.classList.add(state.sort.direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
  });
}

function populateMachineFilter() {
  const sel = document.getElementById('machineFilter');
  sel.innerHTML = '<option value="">All Machines</option>';
  const machineIds = [...new Set((state.data.allocationHistory || []).map(record => record.machine).filter(Boolean))].sort();
  machineIds.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = id; sel.appendChild(opt);
  });
}

function readFilters() {
  state.filters.dateFrom = document.getElementById('dateFrom').value;
  state.filters.dateTo   = document.getElementById('dateTo').value;
  state.filters.machine  = document.getElementById('machineFilter').value;
  state.filters.stage    = document.getElementById('stageFilter').value;
  state.filters.search   = document.getElementById('searchInput').value;
}

function downloadXls(filename, headers, rows) {
  const esc = v => String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const headerCells = headers.map(h =>
    `<Cell ss:StyleID="hdr"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join('');
  const dataRows = rows.map(row =>
    '<Row>' + row.map(c => `<Cell><Data ss:Type="String">${esc(c)}</Data></Cell>`).join('') + '</Row>'
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/></Style></Styles>
<Worksheet ss:Name="Sheet1"><Table><Row>${headerCells}</Row>${dataRows}</Table></Worksheet></Workbook>`;
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportHistoryFile() {
  readFilters(); applyFilters();
  // Estimated Start/End are duplicates of Scheduled Start/End — omitted to keep export clean.
  const headers = ['SR','Part Number','Project','Module','Quantity','Priority','Machine','Stage',
    'Scheduled Start','Scheduled End','Duration','Actual Start','Actual End','Status'];
  const rows = state.filteredRecords.map((r, idx) => [
    idx + 1,
    r.partNo, r.project||'', r.module||'', r.quantity??'', r.priority??'', r.machine, r.stage,
    `${formatDisplayDate(r.startDate)}, ${formatTime12(r.startTime)}`,
    `${formatDisplayDate(r.endDate)}, ${formatTime12(r.endTime)}`,
    getDurationLabel(r), r.status.toUpperCase(),
    formatDateTimeDisplay(r.actualStart),
    formatDateTimeDisplay(r.completedAt || r.actualEnd)
  ]);
  const today = formatDateISO(new Date());
  downloadXls('CNC_Allocation_History_' + today + '.xls', headers, rows);
}
async function renderAll() { await loadHistoryData(); applyFilters(); renderTable(); }

async function init() {
  try { await loadHistoryData(); }
  catch (error) { state.data = {allocationHistory:[]}; console.error(error); }
  populateMachineFilter();
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value   = '';
  readFilters(); applyFilters(); renderTable();

  document.getElementById('applyFilter').addEventListener('click', () => { readFilters(); applyFilters(); renderTable(); });
  document.getElementById('clearFilter').addEventListener('click', () => {
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value   = '';
    document.getElementById('machineFilter').value = '';
    document.getElementById('stageFilter').value   = '';
    document.getElementById('searchInput').value   = '';
    readFilters(); applyFilters(); renderTable();
  });
  document.getElementById('searchInput').addEventListener('input', () => { readFilters(); applyFilters(); renderTable(); });
  document.getElementById('machineFilter').addEventListener('change', () => { readFilters(); applyFilters(); renderTable(); });
  document.getElementById('stageFilter').addEventListener('change',  () => { readFilters(); applyFilters(); renderTable(); });

  document.querySelectorAll('.history-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      state.sort = { field, direction: state.sort.field === field && state.sort.direction === 'asc' ? 'desc' : (field === 'completedAt' ? 'desc' : 'asc') };
      applyFilters(); renderTable();
    });
  });

  document.getElementById('prevPage').addEventListener('click', () => { if (state.currentPage > 1) { state.currentPage--; renderTable(); } });
  document.getElementById('nextPage').addEventListener('click', () => { if (state.currentPage < getTotalPages()) { state.currentPage++; renderTable(); } });
  document.getElementById('exportBtn').addEventListener('click', exportHistoryFile);
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    window.location.href = '../sorting/index.html';
  });
  window.addEventListener('focus', renderAll);
}

document.addEventListener('DOMContentLoaded', init);
