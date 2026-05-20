export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
export const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s); return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }); };
export const fmtDateLong = (s) => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); };
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
export const lastMonth = () => { const d = new Date(); d.setMonth(d.getMonth()-1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
export const daysLeft = (s) => { if (!s) return null; const diff = (new Date(s + 'T00:00:00') - new Date()) / 86400000; return Math.round(diff); };
export const g = (id) => (document.getElementById(id) || {}).value || '';

export const ALL_PAGES = [
  { id: 'dashboard',    label: 'Дашборд' },
  { id: 'history',      label: 'История' },
  { id: 'students',     label: 'CRM' },
  { id: 'crm_students', label: 'Ученики' },
  { id: 'groups',       label: 'Группы' },
  { id: 'lessons_cal',  label: 'Занятия' },
  { id: 'income',       label: 'Доходы' },
  { id: 'expenses',     label: 'Расходы' },
  { id: 'analytics',    label: 'Аналитика' },
  { id: 'tasks',        label: 'Задачи' },
  { id: 'homework',     label: 'ДЗ' },
  { id: 'access',       label: 'Доступы' },
];

export const STATUS_CONFIG = {
  lead:             { label: 'Лид',                   cls: 'b-gray', icon: 'ti-user-question' },
  trial_scheduled:  { label: 'Пробник назначен',       cls: 'b-bl',   icon: 'ti-calendar-check' },
  trial_done:       { label: 'Пробник проведён',        cls: 'b-a',    icon: 'ti-star' },
  trial:            { label: 'Пробное',                cls: 'b-bl',   icon: 'ti-user-check' },
  active:           { label: 'Занимается',             cls: 'b-g',    icon: 'ti-user-star' },
  exam_passed:      { label: 'Сдал экзамен',           cls: 'b-a',    icon: 'ti-medal' },
  stopped:          { label: 'Отказался от занятий',   cls: 'b-r',    icon: 'ti-user-x' },
  refused:          { label: 'Отказался заниматься',   cls: 'b-gray', icon: 'ti-user-off' },
};

export const PIPELINE_STAGES = [
  { id: 'lead',            label: 'Лид',                  color: '#64748b', bg: '#f8fafc' },
  { id: 'trial_scheduled', label: 'Пробник назначен',      color: '#7c3aed', bg: '#f5f3ff' },
  { id: 'trial_done',      label: 'Пробник проведён',       color: '#d97706', bg: '#fffbeb' },
  { id: 'active',          label: 'Занимается',            color: '#05337D', bg: '#dde6f5' },
  { id: 'exam_passed',     label: 'Сдал экзамен',          color: '#15803d', bg: '#f0fdf4' },
  { id: 'stopped',         label: 'Отказался от занятий',  color: '#b91c1c', bg: '#fef2f2' },
];

export const GROUP_COLORS = ['#2563eb','#16a34a','#d97706','#7c3aed','#db2777','#0891b2','#ea580c','#0f766e','#9333ea','#dc2626'];
