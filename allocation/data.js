/**
 * Shared CNC allocation data store (localStorage)
 * Used by both the live Allocation page and History page.
 */

const CNCStorage = (function () {
  const STORAGE_KEY = 'cnc_allocation_data';
  const DATA_VERSION = 9;

  const DEFAULT_ALLOCATIONS = [
    {id:'alloc-1',  partNo:'b1.12.58.46', machine:'DMG1',      altMachine:'DMG2',      project:'maruti', module:'door',         priority:1, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'11:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-2',  partNo:'b1.12.58.07', machine:'JYOTI1',    altMachine:'JYOTI2',    project:'maruti', module:'door',         priority:2, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'12:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-3',  partNo:'b1.12.59.84', machine:'CMS1',      altMachine:'CMS2',      project:'maruti', module:'door',         priority:4, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'15:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-4',  partNo:'b1.12.58.12', machine:'HAAS1',     altMachine:'HAAS2',     project:'maruti', module:'door',         priority:5, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'16:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-5',  partNo:'b1.12.58.32', machine:'HAAS2',     altMachine:'HAAS3',     project:'maruti', module:'door',         priority:1, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'11:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-6',  partNo:'b1.12.58.71', machine:'RAMBAUDI1', altMachine:'CMS1',      project:'maruti', module:'braking',      priority:3, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'13:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-7',  partNo:'b1.12.58.13', machine:'DMG2',      altMachine:'DMG1',      project:'maruti', module:'braking',      priority:4, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'16:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-8',  partNo:'b1.12.58.149',machine:'TAKUMI1',   altMachine:'TAKUMI3',   project:'maruti', module:'braking',      priority:4, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'13:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-9',  partNo:'b1.12.59.86', machine:'TAKUMI2',   altMachine:'TAKUMI5',   project:'maruti', module:'windshield',   priority:1, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'15:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-10', partNo:'b1.12.58.14', machine:'TAKUMI5',   altMachine:'TAKUMI6',   project:'maruti', module:'windshield',   priority:2, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'17:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-11', partNo:'b1.12.58.227',machine:'DMG1',      altMachine:'DMG2',      project:'maruti', module:'windshield',   priority:1, stage:'Stage 2', startDate:'2026-08-09', startTime:'11:00', endDate:'2026-08-09', endTime:'17:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-12', partNo:'b1.12.59.87', machine:'JYOTI2',    altMachine:'JYOTI1',    project:'maruti', module:'windshield',   priority:1, stage:'Stage 1', startDate:'2026-08-09', startTime:'08:00', endDate:'2026-08-09', endTime:'17:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
    {id:'alloc-13', partNo:'b1.12.58.266',machine:'HAAS2',     altMachine:'HAAS1',     project:'maruti', module:'transmission', priority:1, stage:'Stage 2', startDate:'2026-08-09', startTime:'12:00', endDate:'2026-08-09', endTime:'16:00', actualStart:null, actualEnd:null, completedAt:null, status:'idle'},
  ];

  // Frontend-only sample source. Replace getMockAllocations() with an API
  // adapter later; dashboard rendering consumes this common job model only.
  const MOCK_ALLOCATIONS = DEFAULT_ALLOCATIONS.map((job, index) => {
    return {
      ...job,
      quantity: [100, 75, 120, 40, 90, 60, 150, 80, 110, 55, 200, 70, 95][index],
      estimatedStartTime: job.startTime,
      estimatedEndTime: job.endTime,
      actualStart: null,
      actualEnd: null,
      completedAt: null,
      status: 'idle'
    };
  });

  const SEED_HISTORY = [
    {id:'h-001', partNo:'b1.12.58.46', machine:'DMG1',      project:'maruti', module:'door',         priority:1, stage:'Stage 1', startDate:'2026-08-01', startTime:'08:00', endDate:'2026-08-01', endTime:'11:00', actualStart:'2026-08-01T08:05:00.000Z', actualEnd:'2026-08-01T11:10:00.000Z', completedAt:'2026-08-01T11:10:00.000Z', status:'completed'},
    {id:'h-002', partNo:'b1.12.58.07', machine:'JYOTI1',    project:'maruti', module:'door',         priority:2, stage:'Stage 1', startDate:'2026-08-01', startTime:'08:00', endDate:'2026-08-01', endTime:'12:00', actualStart:'2026-08-01T08:00:00.000Z', actualEnd:'2026-08-01T12:05:00.000Z', completedAt:'2026-08-01T12:05:00.000Z', status:'completed'},
    {id:'h-003', partNo:'b1.12.59.84', machine:'CMS1',      project:'maruti', module:'door',         priority:4, stage:'Stage 1', startDate:'2026-08-01', startTime:'08:00', endDate:'2026-08-01', endTime:'15:00', actualStart:'2026-08-01T08:10:00.000Z', actualEnd:'2026-08-01T15:20:00.000Z', completedAt:'2026-08-01T15:20:00.000Z', status:'completed'},
    {id:'h-004', partNo:'b1.12.58.12', machine:'HAAS1',     project:'maruti', module:'door',         priority:5, stage:'Stage 1', startDate:'2026-08-01', startTime:'08:00', endDate:'2026-08-01', endTime:'16:00', actualStart:'2026-08-01T08:00:00.000Z', actualEnd:'2026-08-01T16:00:00.000Z', completedAt:'2026-08-01T16:00:00.000Z', status:'completed'},
    {id:'h-005', partNo:'b1.12.58.32', machine:'HAAS2',     project:'maruti', module:'door',         priority:1, stage:'Stage 1', startDate:'2026-08-01', startTime:'08:00', endDate:'2026-08-01', endTime:'17:00', actualStart:'2026-08-01T08:15:00.000Z', actualEnd:'2026-08-01T17:00:00.000Z', completedAt:'2026-08-01T17:00:00.000Z', status:'completed'},
    {id:'h-006', partNo:'b1.12.58.71', machine:'RAMBAUDI1', project:'maruti', module:'braking',      priority:3, stage:'Stage 1', startDate:'2026-08-01', startTime:'08:00', endDate:'2026-08-01', endTime:'13:00', actualStart:'2026-08-01T07:55:00.000Z', actualEnd:'2026-08-01T12:45:00.000Z', completedAt:'2026-08-01T12:45:00.000Z', status:'stopped'},
    {id:'h-007', partNo:'b1.12.59.85', machine:'RAMBAUDI1', project:'maruti', module:'braking',      priority:2, stage:'Stage 1', startDate:'2026-08-01', startTime:'13:00', endDate:'2026-08-01', endTime:'17:00', actualStart:'2026-08-01T13:05:00.000Z', actualEnd:'2026-08-01T17:00:00.000Z', completedAt:'2026-08-01T17:00:00.000Z', status:'completed'},
    {id:'h-008', partNo:'b1.12.58.13', machine:'DMG1',      project:'maruti', module:'braking',      priority:4, stage:'Stage 1', startDate:'2026-08-02', startTime:'08:00', endDate:'2026-08-02', endTime:'16:00', actualStart:'2026-08-02T08:00:00.000Z', actualEnd:'2026-08-02T16:10:00.000Z', completedAt:'2026-08-02T16:10:00.000Z', status:'completed'},
    {id:'h-009', partNo:'b1.12.58.110',machine:'RAMBAUDI2', project:'maruti', module:'braking',      priority:1, stage:'Stage 1', startDate:'2026-08-02', startTime:'08:00', endDate:'2026-08-02', endTime:'14:00', actualStart:'2026-08-02T08:00:00.000Z', actualEnd:'2026-08-02T14:00:00.000Z', completedAt:'2026-08-02T14:00:00.000Z', status:'completed'},
    {id:'h-010', partNo:'b1.12.58.149',machine:'TAKUMI1',   project:'maruti', module:'braking',      priority:4, stage:'Stage 1', startDate:'2026-08-02', startTime:'08:00', endDate:'2026-08-02', endTime:'13:00', actualStart:'2026-08-02T08:05:00.000Z', actualEnd:'2026-08-02T13:00:00.000Z', completedAt:'2026-08-02T13:00:00.000Z', status:'completed'},
    {id:'h-011', partNo:'b1.12.59.86', machine:'TAKUMI2',   project:'maruti', module:'windshield',   priority:1, stage:'Stage 1', startDate:'2026-08-02', startTime:'08:00', endDate:'2026-08-02', endTime:'15:00', actualStart:'2026-08-02T08:00:00.000Z', actualEnd:'2026-08-02T15:05:00.000Z', completedAt:'2026-08-02T15:05:00.000Z', status:'completed'},
    {id:'h-012', partNo:'b1.12.58.14', machine:'TAKUMI5',   project:'maruti', module:'windshield',   priority:2, stage:'Stage 1', startDate:'2026-08-02', startTime:'08:00', endDate:'2026-08-02', endTime:'17:00', actualStart:'2026-08-02T08:10:00.000Z', actualEnd:'2026-08-02T17:10:00.000Z', completedAt:'2026-08-02T17:10:00.000Z', status:'completed'},
    {id:'h-013', partNo:'b1.12.58.188',machine:'CMS3',      project:'maruti', module:'windshield',   priority:4, stage:'Stage 1', startDate:'2026-08-02', startTime:'08:00', endDate:'2026-08-02', endTime:'16:00', actualStart:'2026-08-02T08:00:00.000Z', actualEnd:'2026-08-02T15:50:00.000Z', completedAt:'2026-08-02T15:50:00.000Z', status:'stopped'},
    {id:'h-014', partNo:'b1.12.58.227',machine:'DMG2',      project:'maruti', module:'windshield',   priority:1, stage:'Stage 1', startDate:'2026-08-02', startTime:'08:00', endDate:'2026-08-02', endTime:'17:00', actualStart:'2026-08-02T08:00:00.000Z', actualEnd:'2026-08-02T17:00:00.000Z', completedAt:'2026-08-02T17:00:00.000Z', status:'completed'},
    {id:'h-015', partNo:'b1.12.59.87', machine:'JYOTI2',    project:'maruti', module:'windshield',   priority:1, stage:'Stage 1', startDate:'2026-08-03', startTime:'08:00', endDate:'2026-08-03', endTime:'17:00', actualStart:'2026-08-03T08:05:00.000Z', actualEnd:'2026-08-03T17:00:00.000Z', completedAt:'2026-08-03T17:00:00.000Z', status:'completed'},
    {id:'h-016', partNo:'b1.12.58.15', machine:'CMS2',      project:'maruti', module:'transmission', priority:3, stage:'Stage 1', startDate:'2026-08-03', startTime:'08:00', endDate:'2026-08-03', endTime:'17:00', actualStart:'2026-08-03T08:00:00.000Z', actualEnd:'2026-08-03T17:00:00.000Z', completedAt:'2026-08-03T17:00:00.000Z', status:'completed'},
    {id:'h-017', partNo:'b1.12.58.266',machine:'HAAS2',     project:'maruti', module:'transmission', priority:1, stage:'Stage 1', startDate:'2026-08-03', startTime:'08:00', endDate:'2026-08-03', endTime:'17:00', actualStart:'2026-08-03T08:10:00.000Z', actualEnd:'2026-08-03T17:00:00.000Z', completedAt:'2026-08-03T17:00:00.000Z', status:'completed'},
    {id:'h-018', partNo:'b1.12.58.305',machine:'HAAS3',     project:'maruti', module:'transmission', priority:4, stage:'Stage 1', startDate:'2026-08-03', startTime:'08:00', endDate:'2026-08-03', endTime:'17:00', actualStart:'2026-08-03T08:00:00.000Z', actualEnd:'2026-08-03T16:45:00.000Z', completedAt:'2026-08-03T16:45:00.000Z', status:'stopped'},
    {id:'h-019', partNo:'b1.12.59.88', machine:'CMS1',      project:'maruti', module:'transmission', priority:1, stage:'Stage 1', startDate:'2026-08-03', startTime:'08:00', endDate:'2026-08-03', endTime:'17:00', actualStart:'2026-08-03T08:00:00.000Z', actualEnd:'2026-08-03T17:00:00.000Z', completedAt:'2026-08-03T17:00:00.000Z', status:'completed'},
    {id:'h-020', partNo:'b1.12.58.16', machine:'DMG1',      project:'maruti', module:'transmission', priority:5, stage:'Stage 1', startDate:'2026-08-03', startTime:'08:00', endDate:'2026-08-03', endTime:'15:00', actualStart:'2026-08-03T08:05:00.000Z', actualEnd:'2026-08-03T15:00:00.000Z', completedAt:'2026-08-03T15:00:00.000Z', status:'completed'},
    {id:'h-021', partNo:'c1.32.58.f1', machine:'RAMBAUDI2', project:'tata', module:'transmission', priority:5, stage:'Stage 1', startDate:'2026-08-04', startTime:'08:00', endDate:'2026-08-04', endTime:'17:00', actualStart:'2026-08-04T08:00:00.000Z', actualEnd:'2026-08-04T17:00:00.000Z', completedAt:'2026-08-04T17:00:00.000Z', status:'completed'},
    {id:'h-022', partNo:'c1.32.48.f2', machine:'DMG2',      project:'tata', module:'transmission', priority:4, stage:'Stage 1', startDate:'2026-08-04', startTime:'08:00', endDate:'2026-08-04', endTime:'16:00', actualStart:'2026-08-04T08:10:00.000Z', actualEnd:'2026-08-04T16:00:00.000Z', completedAt:'2026-08-04T16:00:00.000Z', status:'completed'},
    {id:'h-023', partNo:'c1.33.44.z2', machine:'TAKUMI3',   project:'tata', module:'transmission', priority:1, stage:'Stage 1', startDate:'2026-08-04', startTime:'08:00', endDate:'2026-08-04', endTime:'09:00', actualStart:'2026-08-04T08:00:00.000Z', actualEnd:'2026-08-04T09:00:00.000Z', completedAt:'2026-08-04T09:00:00.000Z', status:'completed'},
    {id:'h-024', partNo:'c1.32.58.f2', machine:'TAKUMI5',   project:'tata', module:'transmission', priority:4, stage:'Stage 1', startDate:'2026-08-04', startTime:'09:00', endDate:'2026-08-04', endTime:'10:00', actualStart:'2026-08-04T09:00:00.000Z', actualEnd:'2026-08-04T10:05:00.000Z', completedAt:'2026-08-04T10:05:00.000Z', status:'completed'},
    {id:'h-025', partNo:'c1.32.48.f3', machine:'TAKUMI6',   project:'tata', module:'transmission', priority:3, stage:'Stage 1', startDate:'2026-08-04', startTime:'10:00', endDate:'2026-08-04', endTime:'11:00', actualStart:'2026-08-04T10:00:00.000Z', actualEnd:'2026-08-04T10:55:00.000Z', completedAt:'2026-08-04T10:55:00.000Z', status:'stopped'},
    {id:'h-026', partNo:'c1.33.44.z3', machine:'CMS1',      project:'tata', module:'transmission', priority:1, stage:'Stage 1', startDate:'2026-08-04', startTime:'08:00', endDate:'2026-08-04', endTime:'16:00', actualStart:'2026-08-04T08:00:00.000Z', actualEnd:'2026-08-04T16:00:00.000Z', completedAt:'2026-08-04T16:00:00.000Z', status:'completed'},
    {id:'h-027', partNo:'c1.32.58.f3', machine:'DMG1',      project:'tata', module:'transmission', priority:2, stage:'Stage 1', startDate:'2026-08-04', startTime:'08:00', endDate:'2026-08-04', endTime:'16:00', actualStart:'2026-08-04T08:05:00.000Z', actualEnd:'2026-08-04T16:00:00.000Z', completedAt:'2026-08-04T16:00:00.000Z', status:'completed'},
    {id:'h-028', partNo:'c1.32.48.f4', machine:'JYOTI1',    project:'tata', module:'wheels',       priority:5, stage:'Stage 1', startDate:'2026-08-04', startTime:'08:00', endDate:'2026-08-04', endTime:'12:00', actualStart:'2026-08-04T08:00:00.000Z', actualEnd:'2026-08-04T12:00:00.000Z', completedAt:'2026-08-04T12:00:00.000Z', status:'completed'},
    {id:'h-029', partNo:'c1.33.44.z4', machine:'CMS1',      project:'tata', module:'wheels',       priority:2, stage:'Stage 1', startDate:'2026-08-05', startTime:'08:00', endDate:'2026-08-05', endTime:'10:00', actualStart:'2026-08-05T08:00:00.000Z', actualEnd:'2026-08-05T10:00:00.000Z', completedAt:'2026-08-05T10:00:00.000Z', status:'completed'},
    {id:'h-030', partNo:'c1.32.58.f4', machine:'HAAS1',     project:'tata', module:'wheels',       priority:3, stage:'Stage 1', startDate:'2026-08-05', startTime:'08:00', endDate:'2026-08-05', endTime:'17:00', actualStart:'2026-08-05T08:00:00.000Z', actualEnd:'2026-08-05T17:10:00.000Z', completedAt:'2026-08-05T17:10:00.000Z', status:'completed'},
    // Stage 2 records
    {id:'h-s2-01', partNo:'b1.12.58.46', machine:'EMCO',      project:'maruti', module:'door',         priority:1, stage:'Stage 2', startDate:'2026-08-01', startTime:'11:30', endDate:'2026-08-01', endTime:'13:30', actualStart:'2026-08-01T11:35:00.000Z', actualEnd:'2026-08-01T13:35:00.000Z', completedAt:'2026-08-01T13:35:00.000Z', status:'completed'},
    {id:'h-s2-02', partNo:'b1.12.58.07', machine:'FEMCO',     project:'maruti', module:'door',         priority:2, stage:'Stage 2', startDate:'2026-08-01', startTime:'12:30', endDate:'2026-08-01', endTime:'17:00', actualStart:'2026-08-01T12:30:00.000Z', actualEnd:'2026-08-01T17:00:00.000Z', completedAt:'2026-08-01T17:00:00.000Z', status:'completed'},
    {id:'h-s2-03', partNo:'b1.12.58.16', machine:'WFL',       project:'maruti', module:'transmission', priority:5, stage:'Stage 2', startDate:'2026-08-03', startTime:'15:30', endDate:'2026-08-03', endTime:'17:00', actualStart:'2026-08-03T15:35:00.000Z', actualEnd:'2026-08-03T16:55:00.000Z', completedAt:'2026-08-03T16:55:00.000Z', status:'stopped'},
    {id:'h-s2-04', partNo:'c1.32.58.f1', machine:'EMCO',      project:'tata',   module:'transmission', priority:5, stage:'Stage 2', startDate:'2026-08-04', startTime:'08:00', endDate:'2026-08-04', endTime:'17:00', actualStart:'2026-08-04T08:05:00.000Z', actualEnd:'2026-08-04T17:00:00.000Z', completedAt:'2026-08-04T17:00:00.000Z', status:'completed'},
    {id:'h-s2-05', partNo:'c1.32.48.f2', machine:'FEMCO',     project:'tata',   module:'transmission', priority:4, stage:'Stage 2', startDate:'2026-08-04', startTime:'08:00', endDate:'2026-08-04', endTime:'16:00', actualStart:'2026-08-04T08:00:00.000Z', actualEnd:'2026-08-04T15:55:00.000Z', completedAt:'2026-08-04T15:55:00.000Z', status:'completed'},
    {id:'h-s2-06', partNo:'c1.33.44.z4', machine:'WFL',       project:'tata',   module:'wheels',       priority:2, stage:'Stage 2', startDate:'2026-08-05', startTime:'10:30', endDate:'2026-08-05', endTime:'13:30', actualStart:'2026-08-05T10:30:00.000Z', actualEnd:'2026-08-05T13:30:00.000Z', completedAt:'2026-08-05T13:30:00.000Z', status:'completed'},
    {id:'h-s2-07', partNo:'c1.32.58.f4', machine:'EMCO',      project:'tata',   module:'wheels',       priority:3, stage:'Stage 2', startDate:'2026-08-05', startTime:'08:00', endDate:'2026-08-05', endTime:'16:00', actualStart:'2026-08-05T08:10:00.000Z', actualEnd:'2026-08-05T16:00:00.000Z', completedAt:'2026-08-05T16:00:00.000Z', status:'completed'},
    {id:'h-s2-08', partNo:'c1.32.48.f5', machine:'HAAS2',     project:'tata',   module:'wheels',       priority:1, stage:'Stage 2', startDate:'2026-08-05', startTime:'12:30', endDate:'2026-08-05', endTime:'17:00', actualStart:'2026-08-05T12:30:00.000Z', actualEnd:'2026-08-05T17:00:00.000Z', completedAt:'2026-08-05T17:00:00.000Z', status:'completed'},
    {id:'h-s2-09', partNo:'c1.33.44.z5', machine:'HAAS3',     project:'tata',   module:'wheels',       priority:2, stage:'Stage 2', startDate:'2026-08-05', startTime:'08:00', endDate:'2026-08-05', endTime:'13:00', actualStart:'2026-08-05T08:00:00.000Z', actualEnd:'2026-08-05T12:50:00.000Z', completedAt:'2026-08-05T12:50:00.000Z', status:'stopped'},
    {id:'h-s2-10', partNo:'c1.32.58.f5', machine:'CMS1',      project:'tata',   module:'wheels',       priority:4, stage:'Stage 2', startDate:'2026-08-05', startTime:'08:00', endDate:'2026-08-05', endTime:'14:00', actualStart:'2026-08-05T08:00:00.000Z', actualEnd:'2026-08-05T14:00:00.000Z', completedAt:'2026-08-05T14:00:00.000Z', status:'completed'},
    {id:'h-s2-11', partNo:'d5.bg.84.57', machine:'RAMBAUDI1', project:'tata',   module:'door',         priority:4, stage:'Stage 2', startDate:'2026-08-06', startTime:'08:00', endDate:'2026-08-06', endTime:'17:00', actualStart:'2026-08-06T08:00:00.000Z', actualEnd:'2026-08-06T17:00:00.000Z', completedAt:'2026-08-06T17:00:00.000Z', status:'completed'},
    {id:'h-s2-12', partNo:'gp.79.14.k3', machine:'RAMBAUDI1', project:'tata',   module:'door',         priority:1, stage:'Stage 2', startDate:'2026-08-06', startTime:'08:00', endDate:'2026-08-06', endTime:'12:00', actualStart:'2026-08-06T08:05:00.000Z', actualEnd:'2026-08-06T12:00:00.000Z', completedAt:'2026-08-06T12:00:00.000Z', status:'completed'},
    {id:'h-s2-13', partNo:'d5.bg.84.58', machine:'DMG1',      project:'tata',   module:'door',         priority:2, stage:'Stage 2', startDate:'2026-08-06', startTime:'15:30', endDate:'2026-08-06', endTime:'17:00', actualStart:'2026-08-06T15:30:00.000Z', actualEnd:'2026-08-06T17:00:00.000Z', completedAt:'2026-08-06T17:00:00.000Z', status:'completed'},
    {id:'h-s2-14', partNo:'gp.79.14.k5', machine:'TAKUMI2',   project:'tata',   module:'lights',       priority:1, stage:'Stage 2', startDate:'2026-08-06', startTime:'14:30', endDate:'2026-08-06', endTime:'17:00', actualStart:'2026-08-06T14:30:00.000Z', actualEnd:'2026-08-06T17:00:00.000Z', completedAt:'2026-08-06T17:00:00.000Z', status:'completed'},
    {id:'h-s2-15', partNo:'d5.bg.84.60', machine:'TAKUMI5',   project:'tata',   module:'lights',       priority:3, stage:'Stage 2', startDate:'2026-08-07', startTime:'11:30', endDate:'2026-08-07', endTime:'14:30', actualStart:'2026-08-07T11:30:00.000Z', actualEnd:'2026-08-07T14:30:00.000Z', completedAt:'2026-08-07T14:30:00.000Z', status:'completed'},
    {id:'h-s2-16', partNo:'78.g1.j2.90', machine:'TAKUMI5',   project:'tata',   module:'sunroof',      priority:1, stage:'Stage 2', startDate:'2026-08-08', startTime:'08:00', endDate:'2026-08-08', endTime:'16:00', actualStart:'2026-08-08T08:00:00.000Z', actualEnd:'2026-08-08T16:00:00.000Z', completedAt:'2026-08-08T16:00:00.000Z', status:'completed'},
    {id:'h-s2-17', partNo:'78.g1.j2.100',machine:'TAKUMI1',   project:'mahindra',module:'engine',      priority:5, stage:'Stage 2', startDate:'2026-08-05', startTime:'08:00', endDate:'2026-08-05', endTime:'15:00', actualStart:'2026-08-05T08:05:00.000Z', actualEnd:'2026-08-05T15:00:00.000Z', completedAt:'2026-08-05T15:00:00.000Z', status:'completed'},
    {id:'h-s2-18', partNo:'68.g1.e2.70', machine:'EMCO',      project:'mahindra',module:'engine',      priority:4, stage:'Stage 2', startDate:'2026-08-06', startTime:'08:00', endDate:'2026-08-06', endTime:'11:00', actualStart:'2026-08-06T08:00:00.000Z', actualEnd:'2026-08-06T11:00:00.000Z', completedAt:'2026-08-06T11:00:00.000Z', status:'completed'},
    {id:'h-s2-19', partNo:'78.g1.j2.101',machine:'FEMCO',     project:'mahindra',module:'engine',      priority:1, stage:'Stage 2', startDate:'2026-08-06', startTime:'08:00', endDate:'2026-08-06', endTime:'13:00', actualStart:'2026-08-06T08:00:00.000Z', actualEnd:'2026-08-06T12:55:00.000Z', completedAt:'2026-08-06T12:55:00.000Z', status:'stopped'},
    {id:'h-s2-20', partNo:'sw.hg.48.07', machine:'FEMCO',     project:'mahindra',module:'battery',     priority:1, stage:'Stage 2', startDate:'2026-08-08', startTime:'08:00', endDate:'2026-08-08', endTime:'16:00', actualStart:'2026-08-08T08:00:00.000Z', actualEnd:'2026-08-08T16:00:00.000Z', completedAt:'2026-08-08T16:00:00.000Z', status:'completed'},
  ];

  function normalizeAllocation(job) {
    const configuredMachines = job.eligibleMachines || [job.primaryMachine, job.altMachine, job.machine];
    const isConfiguredMachine = machine => {
      const value = String(machine ?? '').trim();
      return value && value !== '0' && value.toUpperCase() !== 'NIL';
    };
    return {
      ...job,
      // Kept with the allocation after a manual move, so eligibility never
      // changes merely because the selected machine changes.
      primaryMachine: isConfiguredMachine(job.primaryMachine) ? job.primaryMachine : job.machine || null,
      eligibleMachines: [...new Set(configuredMachines.filter(isConfiguredMachine))],
      quantity: job.quantity ?? 0,
      estimatedStartTime: job.estimatedStartTime || job.startTime,
      estimatedEndTime: job.estimatedEndTime || job.endTime,
      actualStart: job.actualStart || job.actualStartTime || null,
      actualEnd: job.actualEnd || job.actualEndTime || null
    };
  }

  function getMockAllocations() { return MOCK_ALLOCATIONS.map(job => normalizeAllocation(job)); }
  function getMockHistory() { return SEED_HISTORY.map(job => normalizeAllocation(job)); }
  function deriveMachines(allocationData, existingMachines) {
    const stateById = new Map((existingMachines || []).map(machine => [machine.id, machine]));
    const ids = (allocationData || []).flatMap(job => [job.machine, ...(job.eligibleMachines || [])]);
    const valid = id => String(id ?? '').trim() && String(id).trim() !== '0' && String(id).trim().toUpperCase() !== 'NIL';
    // Keep current row order stable; append newly discovered source machines.
    return [...new Set([...(existingMachines || []).map(machine => machine.id), ...ids].filter(valid))]
      .map(id => ({ id, maintenance: stateById.get(id)?.maintenance || false }));
  }

  const FUTURE_ALLOTMENTS = [
    {sr:1,  partNo:'b1.12.58.46', project:'maruti',   module:'door',         priority:1, scheduledDate:'2026-08-10', stage1Machine:'DMG1',      stage1Start:'08:00', stage1End:'11:00', smhStage1:3,  stage2Machine:'EMCO',   stage2Start:'11:30', stage2End:'13:30', smhStage2:2, status:'planned'},
    {sr:2,  partNo:'b1.12.58.07', project:'maruti',   module:'door',         priority:2, scheduledDate:'2026-08-10', stage1Machine:'JYOTI1',    stage1Start:'08:00', stage1End:'12:00', smhStage1:4,  stage2Machine:'FEMCO',  stage2Start:'12:30', stage2End:'17:00', smhStage2:4, status:'planned'},
    {sr:3,  partNo:'b1.12.59.84', project:'maruti',   module:'door',         priority:4, scheduledDate:'2026-08-10', stage1Machine:'CMS1',      stage1Start:'08:00', stage1End:'15:00', smhStage1:7,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:4,  partNo:'b1.12.58.12', project:'maruti',   module:'door',         priority:5, scheduledDate:'2026-08-10', stage1Machine:'HAAS1',     stage1Start:'08:00', stage1End:'16:00', smhStage1:8,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:5,  partNo:'b1.12.58.32', project:'maruti',   module:'door',         priority:1, scheduledDate:'2026-08-10', stage1Machine:'HAAS2',     stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:6,  partNo:'b1.12.58.71', project:'maruti',   module:'braking',      priority:3, scheduledDate:'2026-08-10', stage1Machine:'RAMBAUDI1', stage1Start:'08:00', stage1End:'13:00', smhStage1:5,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:7,  partNo:'b1.12.59.85', project:'maruti',   module:'braking',      priority:2, scheduledDate:'2026-08-10', stage1Machine:'RAMBAUDI1', stage1Start:'13:00', stage1End:'17:00', smhStage1:4,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:8,  partNo:'b1.12.58.13', project:'maruti',   module:'braking',      priority:4, scheduledDate:'2026-08-11', stage1Machine:'DMG1',      stage1Start:'08:00', stage1End:'16:00', smhStage1:8,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:9,  partNo:'b1.12.58.110',project:'maruti',   module:'braking',      priority:1, scheduledDate:'2026-08-11', stage1Machine:'RAMBAUDI2', stage1Start:'08:00', stage1End:'14:00', smhStage1:6,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:10, partNo:'b1.12.58.149',project:'maruti',   module:'braking',      priority:4, scheduledDate:'2026-08-11', stage1Machine:'TAKUMI1',   stage1Start:'08:00', stage1End:'13:00', smhStage1:5,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:11, partNo:'b1.12.59.86', project:'maruti',   module:'windshield',   priority:1, scheduledDate:'2026-08-11', stage1Machine:'TAKUMI2',   stage1Start:'08:00', stage1End:'15:00', smhStage1:7,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:12, partNo:'b1.12.58.14', project:'maruti',   module:'windshield',   priority:2, scheduledDate:'2026-08-11', stage1Machine:'TAKUMI5',   stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:13, partNo:'b1.12.58.188',project:'maruti',   module:'windshield',   priority:4, scheduledDate:'2026-08-12', stage1Machine:'CMS3',      stage1Start:'08:00', stage1End:'16:00', smhStage1:8,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:14, partNo:'b1.12.58.227',project:'maruti',   module:'windshield',   priority:1, scheduledDate:'2026-08-12', stage1Machine:'DMG2',      stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:15, partNo:'b1.12.59.87', project:'maruti',   module:'windshield',   priority:1, scheduledDate:'2026-08-12', stage1Machine:'JYOTI2',    stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:16, partNo:'b1.12.58.15', project:'maruti',   module:'transmission', priority:3, scheduledDate:'2026-08-12', stage1Machine:'CMS2',      stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:17, partNo:'b1.12.58.266',project:'maruti',   module:'transmission', priority:1, scheduledDate:'2026-08-13', stage1Machine:'HAAS2',     stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:18, partNo:'b1.12.58.305',project:'maruti',   module:'transmission', priority:4, scheduledDate:'2026-08-13', stage1Machine:'HAAS3',     stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:19, partNo:'b1.12.59.88', project:'maruti',   module:'transmission', priority:1, scheduledDate:'2026-08-13', stage1Machine:'CMS1',      stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:20, partNo:'b1.12.58.16', project:'maruti',   module:'transmission', priority:5, scheduledDate:'2026-08-13', stage1Machine:'DMG1',      stage1Start:'08:00', stage1End:'15:00', smhStage1:7,  stage2Machine:'WFL',    stage2Start:'15:30', stage2End:'17:00', smhStage2:2, status:'planned'},
    {sr:21, partNo:'c1.32.58.f1', project:'tata',     module:'transmission', priority:5, scheduledDate:'2026-08-14', stage1Machine:'RAMBAUDI2', stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:'EMCO',   stage2Start:'08:00', stage2End:'17:00', smhStage2:9, status:'planned'},
    {sr:22, partNo:'c1.32.48.f2', project:'tata',     module:'transmission', priority:4, scheduledDate:'2026-08-14', stage1Machine:'DMG2',      stage1Start:'08:00', stage1End:'16:00', smhStage1:8,  stage2Machine:'FEMCO',  stage2Start:'08:00', stage2End:'16:00', smhStage2:8, status:'planned'},
    {sr:23, partNo:'c1.33.44.z2', project:'tata',     module:'transmission', priority:1, scheduledDate:'2026-08-14', stage1Machine:'TAKUMI3',   stage1Start:'08:00', stage1End:'09:00', smhStage1:1,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:24, partNo:'c1.32.58.f2', project:'tata',     module:'transmission', priority:4, scheduledDate:'2026-08-14', stage1Machine:'TAKUMI5',   stage1Start:'09:00', stage1End:'10:00', smhStage1:1,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:25, partNo:'c1.32.48.f3', project:'tata',     module:'transmission', priority:3, scheduledDate:'2026-08-14', stage1Machine:'TAKUMI6',   stage1Start:'10:00', stage1End:'11:00', smhStage1:1,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:26, partNo:'c1.33.44.z3', project:'tata',     module:'transmission', priority:1, scheduledDate:'2026-08-15', stage1Machine:'CMS1',      stage1Start:'08:00', stage1End:'16:00', smhStage1:8,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:27, partNo:'c1.32.58.f3', project:'tata',     module:'transmission', priority:2, scheduledDate:'2026-08-15', stage1Machine:'DMG1',      stage1Start:'08:00', stage1End:'16:00', smhStage1:8,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:28, partNo:'c1.32.48.f4', project:'tata',     module:'wheels',       priority:5, scheduledDate:'2026-08-15', stage1Machine:'JYOTI1',    stage1Start:'08:00', stage1End:'12:00', smhStage1:4,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:29, partNo:'c1.33.44.z4', project:'tata',     module:'wheels',       priority:2, scheduledDate:'2026-08-15', stage1Machine:'CMS1',      stage1Start:'08:00', stage1End:'10:00', smhStage1:2,  stage2Machine:'WFL',    stage2Start:'10:30', stage2End:'13:30', smhStage2:3, status:'planned'},
    {sr:30, partNo:'c1.32.58.f4', project:'tata',     module:'wheels',       priority:3, scheduledDate:'2026-08-15', stage1Machine:'HAAS1',     stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:'EMCO',   stage2Start:'08:00', stage2End:'16:00', smhStage2:8, status:'planned'},
    {sr:31, partNo:'c1.32.48.f5', project:'tata',     module:'wheels',       priority:1, scheduledDate:'2026-08-16', stage1Machine:'HAAS2',     stage1Start:'08:00', stage1End:'12:00', smhStage1:4,  stage2Machine:'HAAS2',  stage2Start:'12:30', stage2End:'17:00', smhStage2:4, status:'planned'},
    {sr:32, partNo:'c1.33.44.z5', project:'tata',     module:'wheels',       priority:2, scheduledDate:'2026-08-16', stage1Machine:'RAMBAUDI1', stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:'HAAS3',  stage2Start:'08:00', stage2End:'13:00', smhStage2:5, status:'planned'},
    {sr:33, partNo:'c1.32.58.f5', project:'tata',     module:'wheels',       priority:4, scheduledDate:'2026-08-16', stage1Machine:'RAMBAUDI1', stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:'CMS1',   stage2Start:'08:00', stage2End:'14:00', smhStage2:6, status:'planned'},
    {sr:34, partNo:'c1.32.48.f6', project:'tata',     module:'wheels',       priority:5, scheduledDate:'2026-08-16', stage1Machine:'DMG1',      stage1Start:'08:00', stage1End:'12:00', smhStage1:4,  stage2Machine:'CMS1',   stage2Start:'12:30', stage2End:'17:00', smhStage2:4, status:'planned'},
    {sr:35, partNo:'c1.33.44.z6', project:'tata',     module:'braking',      priority:1, scheduledDate:'2026-08-17', stage1Machine:'RAMBAUDI2', stage1Start:'08:00', stage1End:'14:00', smhStage1:6,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:36, partNo:'c1.32.58.f6', project:'tata',     module:'braking',      priority:3, scheduledDate:'2026-08-17', stage1Machine:'TAKUMI1',   stage1Start:'08:00', stage1End:'09:00', smhStage1:1,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:37, partNo:'c1.32.48.f7', project:'tata',     module:'braking',      priority:2, scheduledDate:'2026-08-17', stage1Machine:'TAKUMI2',   stage1Start:'08:00', stage1End:'14:00', smhStage1:6,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:38, partNo:'d5.bg.84.56', project:'tata',     module:'braking',      priority:4, scheduledDate:'2026-08-17', stage1Machine:'TAKUMI5',   stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:39, partNo:'gp.79.14.k2', project:'tata',     module:'braking',      priority:1, scheduledDate:'2026-08-17', stage1Machine:'CMS3',      stage1Start:'08:00', stage1End:'09:00', smhStage1:1,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:40, partNo:'d5.bg.84.57', project:'tata',     module:'door',         priority:4, scheduledDate:'2026-08-18', stage1Machine:'DMG2',      stage1Start:'08:00', stage1End:'17:00', smhStage1:9,  stage2Machine:'RAMBAUDI1', stage2Start:'08:00', stage2End:'17:00', smhStage2:9, status:'planned'},
    {sr:41, partNo:'gp.79.14.k3', project:'tata',     module:'door',         priority:1, scheduledDate:'2026-08-18', stage1Machine:'JYOTI2',    stage1Start:'08:00', stage1End:'16:00', smhStage1:8,  stage2Machine:'RAMBAUDI1', stage2Start:'08:00', stage2End:'12:00', smhStage2:4, status:'planned'},
    {sr:42, partNo:'d5.bg.84.58', project:'tata',     module:'door',         priority:2, scheduledDate:'2026-08-18', stage1Machine:'CMS2',      stage1Start:'08:00', stage1End:'15:00', smhStage1:7,  stage2Machine:'DMG1',   stage2Start:'15:30', stage2End:'17:00', smhStage2:2, status:'planned'},
    {sr:43, partNo:'gp.79.14.k4', project:'tata',     module:'door',         priority:4, scheduledDate:'2026-08-18', stage1Machine:'HAAS2',     stage1Start:'08:00', stage1End:'15:00', smhStage1:7,  stage2Machine:'RAMBAUDI2', stage2Start:'08:00', stage2End:'15:00', smhStage2:7, status:'planned'},
    {sr:44, partNo:'d5.bg.84.59', project:'tata',     module:'door',         priority:1, scheduledDate:'2026-08-19', stage1Machine:'HAAS3',     stage1Start:'08:00', stage1End:'10:00', smhStage1:2,  stage2Machine:'TAKUMI1', stage2Start:'10:30', stage2End:'14:30', smhStage2:4, status:'planned'},
    {sr:45, partNo:'gp.79.14.k5', project:'tata',     module:'lights',       priority:1, scheduledDate:'2026-08-19', stage1Machine:'CMS1',      stage1Start:'08:00', stage1End:'14:00', smhStage1:6,  stage2Machine:'TAKUMI2', stage2Start:'14:30', stage2End:'17:00', smhStage2:3, status:'planned'},
    {sr:46, partNo:'d5.bg.84.60', project:'tata',     module:'lights',       priority:3, scheduledDate:'2026-08-19', stage1Machine:'DMG1',      stage1Start:'08:00', stage1End:'11:00', smhStage1:3,  stage2Machine:'TAKUMI5', stage2Start:'11:30', stage2End:'14:30', smhStage2:3, status:'planned'},
    {sr:47, partNo:'gp.79.14.k6', project:'tata',     module:'lights',       priority:1, scheduledDate:'2026-08-19', stage1Machine:'RAMBAUDI2', stage1Start:'08:00', stage1End:'09:00', smhStage1:1,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:48, partNo:'d5.bg.84.61', project:'tata',     module:'lights',       priority:4, scheduledDate:'2026-08-19', stage1Machine:'DMG2',      stage1Start:'08:00', stage1End:'09:00', smhStage1:1,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:49, partNo:'gp.79.14.k7', project:'tata',     module:'lights',       priority:1, scheduledDate:'2026-08-20', stage1Machine:'TAKUMI3',   stage1Start:'09:00', stage1End:'10:00', smhStage1:1,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
    {sr:50, partNo:'d5.bg.84.62', project:'tata',     module:'lights',       priority:5, scheduledDate:'2026-08-20', stage1Machine:'TAKUMI5',   stage1Start:'08:00', stage1End:'09:00', smhStage1:1,  stage2Machine:null,     stage2Start:null,    stage2End:null,    smhStage2:null, status:'planned'},
  ];

  function defaultMachines() {
    // Derive the machine list dynamically from FUTURE_ALLOTMENTS.
    // Read all four machine fields, ignore 0/"0"/NIL/null/undefined/empty.
    const seen = new Set();
    const valid = v => v && v !== '0' && String(v).toUpperCase() !== 'NIL' && String(v).trim() !== '';
    FUTURE_ALLOTMENTS.forEach(row => {
      [row.stage1Machine, row.stage1MachineAlt, row.stage2Machine, row.stage2MachineAlt]
        .forEach(m => { if (valid(m)) seen.add(String(m).trim()); });
    });
    return Array.from(seen).map(id => ({ id, maintenance: false }));
  }

  /**
   * Build active allocations from FUTURE_ALLOTMENTS in SR order.
   * Uses the actual current clock time as the scheduling anchor.
   * Each job is queued on its machine immediately after the previous job
   * on that same machine (no overlap, no hardcoded times).
   */
  function buildAllocationsFromPlan() {
    const now       = new Date();
    const todayISO  = now.getFullYear() + '-' +
                      String(now.getMonth() + 1).padStart(2, '0') + '-' +
                      String(now.getDate()).padStart(2, '0');
    const nowMin    = now.getHours() * 60 + now.getMinutes();
    const TIMELINE_START = 8 * 60;   // 08:00
    const TIMELINE_END   = 18 * 60;  // 18:00

    // Track where each machine's queue ends (in minutes from midnight)
    const machineEnd = {};   // { machineId: endMinute }

    const result = [];

    // Sort by SR ascending — this is the authoritative processing order
    const plan = [...FUTURE_ALLOTMENTS].sort((a, b) => a.sr - b.sr);

    plan.forEach(row => {
      // ── Stage 1 allocation ──
      if (row.stage1Machine && row.stage1Machine !== '0' && row.stage1Machine !== 'NIL') {
        const dur = (row.smhStage1 || 1) * 60; // smh is in hours → convert to minutes
        const mach = row.stage1Machine;
        // Start after current time AND after whatever is already queued on this machine
        const earliest = Math.max(nowMin, machineEnd[mach] || TIMELINE_START, TIMELINE_START);
        const start    = earliest;
        const end      = start + dur;
        machineEnd[mach] = end;

        if (start < TIMELINE_END) {
          result.push({
            id:            `plan-s1-${row.sr}`,
            sr:            row.sr,
            partNo:        row.partNo,
            machine:       mach,
            altMachine:    row.stage1MachineAlt || null,
            project:       row.project,
            module:        row.module,
            priority:      row.priority,
            stage:         'Stage 1',
            startDate:     todayISO,
            startTime:     String(Math.floor(start / 60)).padStart(2, '0') + ':' + String(start % 60).padStart(2, '0'),
            endDate:       todayISO,
            endTime:       String(Math.floor(Math.min(end, TIMELINE_END) / 60)).padStart(2, '0') + ':' + String(Math.min(end, TIMELINE_END) % 60).padStart(2, '0'),
            actualStart:   null,
            actualEnd:     null,
            completedAt:   null,
            status:        'idle',
            allocatedAt:   now.toISOString()
          });
        }
      }

      // ── Stage 2 allocation ──
      if (row.stage2Machine && row.stage2Machine !== '0' && row.stage2Machine !== 'NIL') {
        const dur = (row.smhStage2 || 1) * 60;
        const mach = row.stage2Machine;
        const earliest = Math.max(nowMin, machineEnd[mach] || TIMELINE_START, TIMELINE_START);
        const start    = earliest;
        const end      = start + dur;
        machineEnd[mach] = end;

        if (start < TIMELINE_END) {
          result.push({
            id:            `plan-s2-${row.sr}`,
            sr:            row.sr,
            partNo:        row.partNo,
            machine:       mach,
            altMachine:    row.stage2MachineAlt || null,
            project:       row.project,
            module:        row.module,
            priority:      row.priority,
            stage:         'Stage 2',
            startDate:     todayISO,
            startTime:     String(Math.floor(start / 60)).padStart(2, '0') + ':' + String(start % 60).padStart(2, '0'),
            endDate:       todayISO,
            endTime:       String(Math.floor(Math.min(end, TIMELINE_END) / 60)).padStart(2, '0') + ':' + String(Math.min(end, TIMELINE_END) % 60).padStart(2, '0'),
            actualStart:   null,
            actualEnd:     null,
            completedAt:   null,
            status:        'idle',
            allocatedAt:   now.toISOString()
          });
        }
      }
    });

    return result;
  }

  function defaultData() {
    return {
      version: DATA_VERSION,
      scheduleDate: new Date().toISOString().slice(0, 10),
      machines: deriveMachines(MOCK_ALLOCATIONS),
      allocations: getMockAllocations(),
      allocationHistory: getMockHistory(),
      futureAllotments: FUTURE_ALLOTMENTS.map(a => Object.assign({}, a))
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { const d = defaultData(); save(d); return d; }
      const parsed = JSON.parse(raw);
      if (!parsed.version || parsed.version < DATA_VERSION) {
        const fresh = defaultData(); save(fresh); return fresh;
      }
      if (!parsed.machines) parsed.machines = defaultMachines();
      if (!parsed.allocations) parsed.allocations = [];
      if (!parsed.allocationHistory) parsed.allocationHistory = [];
      if (!parsed.futureAllotments) parsed.futureAllotments = FUTURE_ALLOTMENTS.map(a => Object.assign({}, a));
      return parsed;
    } catch (e) {
      const d = defaultData(); save(d); return d;
    }
  }

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function resetToDefaults() {
    const d = defaultData(); save(d); return d;
  }

  return { STORAGE_KEY, FUTURE_ALLOTMENTS, load, save, resetToDefaults, defaultData,
    getMockAllocations, getMockHistory, normalizeAllocation, deriveMachines };
})();

/* ─── Shared formatting utilities ─── */

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTime12(timeStr) {
  if (!timeStr) return '—';
  const total = timeToMinutes(timeStr);
  let h = Math.floor(total / 60);
  const m = total % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTimeFromDate(date) {
  return minutesToTime(date.getHours() * 60 + date.getMinutes());
}

function formatDateTimeDisplay(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return `${formatDisplayDate(formatDateISO(d))}, ${formatTime12(formatTimeFromDate(d))}`;
}

function getDurationLabel(allocation) {
  const mins = timeToMinutes(allocation.endTime) - timeToMinutes(allocation.startTime);
  if (mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
