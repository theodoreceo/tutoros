export const state = {
  currentRole: null,   // null | { id, name, access, teacherId? }
  crmView: 'table',    // 'table' | 'pipeline'
  crmStatusFilter: 'all',
  calView: 'week',     // 'week' | 'month'
  calDate: new Date(),
  anTab: 'overview',
  anPeriod: 'month',
  taskFilter: 'open',
  groupDetailId: null,
  studentDetailId: null,
};
