/**
 * CNC Future Allotment Plan — Excel-style view
 */

const PAGE_SIZE = 25;
const FUTURE_API_BASE_URL = new URLSearchParams(window.location.search).get('api') || 'http://127.0.0.1:8001';

const state = {
  data: null,
  filters: { dateFrom: '', dateTo: '', project: '', stage: '', search: '' },
  currentPage: 1,
  filteredRecords: []
};

async function loadData() {
  const response = await fetch(`${FUTURE_API_BASE_URL}/future-plan`, {cache:'no-store'});
  if (!response.ok) throw new Error(`Future Plan API returned ${response.status}`);
  const payload = await response.json();
  state.data = {futureAllotments:(payload.data || []).map(row => ({
    sr:row.SR, partNo:row.PART_NO, project:row.PROJECT || '', module:row.MODULE || '', priority:row.PRIORITY,
    stage1Machine:row.machine_STAGE1, stage1MachineAlt:row.machine_STAGE1_A,
    stage2Machine:row.machine_STAGE2, stage2MachineAlt:row.machine_STAGE2_A,
    batchQty:row.BATCH_QTY, stage1Setup:row.STAGE1_setup_time, stage1Unit:row.STAGE1_unit_time,
    smhStage1:row.STAGE1_SMH, stage2Setup:row.STAGE2_setup_time, stage2Unit:row.STAGE2_unit_time,
    smhStage2:row.STAGE2_SMH, acComp:row.ac_comp, finalSmh:row.FINAL_smh,
    scheduledDate:'', status:row.status || 'future'
  }))};
}

function applyFilters() {
  let records = [...(state.data.futureAllotments || [])];

  if (state.filters.dateFrom) {
    records = records.filter(r => r.scheduledDate >= state.filters.dateFrom);
  }
  if (state.filters.dateTo) {
    records = records.filter(r => r.scheduledDate <= state.filters.dateTo);
  }
  if (state.filters.project) {
    records = records.filter(r => r.project === state.filters.project);
  }
  if (state.filters.stage === 'Stage 1') {
    records = records.filter(r => r.stage1Machine);
  } else if (state.filters.stage === 'Stage 2') {
    records = records.filter(r => r.stage2Machine);
  }
  if (state.filters.search.trim()) {
    const q = state.filters.search.trim().toLowerCase();
    records = records.filter(r =>
      r.partNo.toLowerCase().includes(q) ||
      r.project.toLowerCase().includes(q) ||
      r.module.toLowerCase().includes(q) ||
      (r.stage1Machine && r.stage1Machine.toLowerCase().includes(q)) ||
      (r.stage2Machine && r.stage2Machine.toLowerCase().includes(q))
    );
  }

  records.sort((a, b) => {
    const dateCmp = a.scheduledDate.localeCompare(b.scheduledDate);
    if (dateCmp !== 0) return dateCmp;
    return a.sr - b.sr;
  });

  state.filteredRecords = records;
  state.currentPage = 1;
}

function getPageRecords() {
  const start = (state.currentPage - 1) * PAGE_SIZE;
  return state.filteredRecords.slice(start, start + PAGE_SIZE);
}

function getTotalPages() {
  return Math.max(1, Math.ceil(state.filteredRecords.length / PAGE_SIZE));
}

function renderTable() {
  const tbody = document.getElementById('excelTableBody');
  const pagination = document.getElementById('pagination');
  tbody.innerHTML = '';

  const total = state.filteredRecords.length;
  document.getElementById('recordCount').textContent =
    `${total} planned allotment${total !== 1 ? 's' : ''}`;

  getPageRecords().forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-sr">${row.sr}</td>
      <td class="cell-part">${row.partNo}</td>
      <td>${row.project}</td>
      <td>${row.module}</td>
      <td>${row.priority}</td>
      <td class="cell-stage1">${row.stage1Machine || '—'}</td>
      <td class="cell-stage1">${row.stage1MachineAlt || '—'}</td>
      <td class="cell-stage2">${row.stage2Machine || '—'}</td>
      <td class="cell-stage2">${row.stage2MachineAlt || '—'}</td>
      <td>${row.batchQty ?? '—'}</td>
      <td class="cell-stage1">${row.stage1Setup ?? '—'}</td>
      <td class="cell-stage1">${row.stage1Unit ?? '—'}</td>
      <td class="cell-stage1">${row.smhStage1 != null ? row.smhStage1 + 'h' : '—'}</td>
      <td class="cell-stage2">${row.stage2Setup ?? '—'}</td>
      <td class="cell-stage2">${row.stage2Unit ?? '—'}</td>
      <td class="cell-stage2">${row.smhStage2 != null ? row.smhStage2 + 'h' : '—'}</td>
      <td>${row.acComp ?? '—'}</td>
      <td>${row.finalSmh != null ? row.finalSmh + 'h' : '—'}</td>
      <td>${formatDisplayDate(row.scheduledDate)}</td>
      <td><span class="status-planned">${(row.status || 'planned').toUpperCase()}</span></td>
    `;
    tbody.appendChild(tr);
  });

  if (total === 0) { pagination.hidden = true; return; }
  pagination.hidden = false;
  renderPagination();
}

function renderPagination() {
  const total = state.filteredRecords.length;
  const totalPages = getTotalPages();
  const start = (state.currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(state.currentPage * PAGE_SIZE, total);

  document.getElementById('paginationInfo').textContent =
    totalPages > 1 ? `Showing ${start}–${end} of ${total}` : `${total} records`;

  document.getElementById('prevPage').disabled = state.currentPage <= 1;
  document.getElementById('nextPage').disabled = state.currentPage >= totalPages;

  const pageNumbers = document.getElementById('pageNumbers');
  pageNumbers.innerHTML = '';
  const maxVisible = 5;
  let sp = Math.max(1, state.currentPage - 2);
  let ep = Math.min(totalPages, sp + maxVisible - 1);
  if (ep - sp < maxVisible - 1) sp = Math.max(1, ep - maxVisible + 1);
  for (let i = sp; i <= ep; i++) {
    const btn = document.createElement('button');
    btn.className = 'page-num' + (i === state.currentPage ? ' active' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => { state.currentPage = i; renderTable(); });
    pageNumbers.appendChild(btn);
  }
}

function populateProjectFilter() {
  const select = document.getElementById('projectFilter');
  const projects = [...new Set((state.data.futureAllotments || []).map(r => r.project))].sort();
  select.innerHTML = '<option value="">All Projects</option>';
  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
    select.appendChild(opt);
  });
}

function readFiltersFromUI() {
  state.filters.dateFrom = document.getElementById('dateFrom').value;
  state.filters.dateTo = document.getElementById('dateTo').value;
  state.filters.project = document.getElementById('projectFilter').value;
  state.filters.stage = document.getElementById('stageFilter').value;
  state.filters.search = document.getElementById('searchInput').value;
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

function exportFutureFile() {
  readFiltersFromUI();
  applyFilters();

  const headers = [
    'SR', 'Part Number', 'Project', 'Module', 'Priority',
    'Machine Stage 1', 'Machine Stage 1 Alt', 'Machine Stage 2', 'Machine Stage 2 Alt',
    'Batch Qty', 'S1 Setup', 'S1 Unit', 'SMH S1',
    'S2 Setup', 'S2 Unit', 'SMH S2', 'AC Comp', 'Final SMH',
    'Scheduled Date', 'Status'
  ];

  const rows = state.filteredRecords.map(r => [
    r.sr, r.partNo, r.project, r.module, r.priority,
    r.stage1Machine || '', r.stage1MachineAlt || '',
    r.stage2Machine || '', r.stage2MachineAlt || '',
    r.batchQty ?? '', r.stage1Setup ?? '', r.stage1Unit ?? '',
    r.smhStage1 ?? '', r.stage2Setup ?? '', r.stage2Unit ?? '',
    r.smhStage2 ?? '', r.acComp ?? '', r.finalSmh ?? '',
    formatDisplayDate(r.scheduledDate),
    (r.status || 'planned').toUpperCase()
  ]);

  const today = formatDateISO(new Date());
  downloadXls('CNC_Future_Allotment_' + today + '.xls', headers, rows);
}

async function init() {
  document.getElementById('logoutBtn')?.addEventListener('click', () => { window.location.href = '../sorting/index.html'; });
  try { await loadData(); }
  catch (error) { state.data={futureAllotments:[]}; console.error(error); }
  populateProjectFilter();

  const dates = (state.data.futureAllotments || []).map(r => r.scheduledDate).sort();
  if (dates.length) {
    document.getElementById('dateFrom').value = dates[0];
    document.getElementById('dateTo').value = dates[dates.length - 1];
  }

  readFiltersFromUI();
  applyFilters();
  renderTable();

  document.getElementById('applyFilter').addEventListener('click', () => {
    readFiltersFromUI();
    applyFilters();
    renderTable();
  });

  document.getElementById('clearFilter').addEventListener('click', () => {
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    document.getElementById('projectFilter').value = '';
    document.getElementById('stageFilter').value = '';
    document.getElementById('searchInput').value = '';
    readFiltersFromUI();
    applyFilters();
    renderTable();
  });

  document.getElementById('searchInput').addEventListener('input', () => {
    readFiltersFromUI();
    applyFilters();
    renderTable();
  });

  document.getElementById('prevPage').addEventListener('click', () => {
    if (state.currentPage > 1) { state.currentPage--; renderTable(); }
  });

  document.getElementById('nextPage').addEventListener('click', () => {
    if (state.currentPage < getTotalPages()) { state.currentPage++; renderTable(); }
  });

  document.getElementById('exportBtn').addEventListener('click', exportFutureFile);
}

document.addEventListener('DOMContentLoaded', init);
