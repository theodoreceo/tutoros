let _uidCounter = Date.now();
export const uid = () => `id_${(++_uidCounter).toString(36)}`;

export const fmt = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0));

export const fmtDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

export const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const today = () => new Date().toISOString().slice(0, 10);

export const thisMonth = () => new Date().toISOString().slice(0, 7);

export const lastMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export const daysLeft = (iso) => {
  if (!iso) return null;
  const diff = (new Date(iso) - new Date(today())) / 86400000;
  return Math.ceil(diff);
};

export const riskDot = (score) => {
  if (score >= 70) return '<span class="dot red"></span>';
  if (score >= 40) return '<span class="dot amber"></span>';
  return '<span class="dot green"></span>';
};

export const groupShort = (name) => name ? name.slice(0, 2).toUpperCase() : '??';

export const g = (id) => document.getElementById(id);

export const STATUS_CONFIG = {
  active:    { label: 'Активный',    cls: 'b-g'    },
  trial:     { label: 'Пробный',     cls: 'b-bl'   },
  paused:    { label: 'Пауза',       cls: 'b-a'    },
  left:      { label: 'Ушёл',        cls: 'b-r'    },
  lead:      { label: 'Лид',         cls: 'b-gray' },
  graduated: { label: 'Выпускник',   cls: 'b-gray' },
};

export const PIPELINE_STAGES = [
  { id: 'lead',      label: 'Лиды'        },
  { id: 'trial',     label: 'Пробный'     },
  { id: 'active',    label: 'Активные'    },
  { id: 'paused',    label: 'Пауза'       },
  { id: 'left',      label: 'Ушли'        },
];

export const ALL_PAGES = [
  'dashboard','history','crm_students','students','groups',
  'income','expenses','tasks','lessons_cal','analytics','access',
];

export const DIFFICULTY_CONFIG = {
  easy: { label: 'Лёгкий', cls: 'chip-easy' },
  med:  { label: 'Средний', cls: 'chip-med' },
  hard: { label: 'Сложный', cls: 'chip-hard' },
};

export const MOOD_EMOJI = { 5: '😄', 4: '🙂', 3: '😐', 2: '😕', 1: '😞' };

export const HW_CONFIG = {
  done:    { label: 'Сделано',   cls: 'hw-done'    },
  partial: { label: 'Частично', cls: 'hw-partial'  },
  miss:    { label: 'Не сделано', cls: 'hw-miss'   },
  null:    { label: '—',         cls: 'hw-none'    },
};

export const showLoading = (on) => {
  const el = document.getElementById('loading');
  if (el) el.style.display = on ? 'flex' : 'none';
};
