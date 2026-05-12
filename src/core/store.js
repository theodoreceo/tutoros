import { SEED } from '../data/seed.js';
import { uid } from '../utils/helpers.js';

// Single source of truth — all modules import this object and read/mutate it in place
export const CACHE = {
  students: [],
  groups: [],
  lessons: [],
  payments: [],
  expenses: [],
  tasks: [],
  roles: [],
  history: [],
  events: [],
};

export const TABLES = ['students','groups','lessons','payments','expenses','tasks','roles','history','events'];

const KEY = (t) => `tutoros_${t}`;

export const expenseCats = [
  { id: 'marketing',   label: 'Маркетинг'     },
  { id: 'salary',      label: 'Зарплата'      },
  { id: 'software',    label: 'ПО/Сервисы'    },
  { id: 'rent',        label: 'Аренда'        },
  { id: 'materials',   label: 'Материалы'     },
  { id: 'other',       label: 'Прочее'        },
];

export function loadAll() {
  for (const t of TABLES) {
    const raw = localStorage.getItem(KEY(t));
    CACHE[t] = raw ? JSON.parse(raw) : [];
  }
}

function save(table) {
  localStorage.setItem(KEY(table), JSON.stringify(CACHE[table]));
}

export function dbInsert(table, record) {
  const row = { ...record, id: record.id || uid(), createdAt: record.createdAt || new Date().toISOString() };
  CACHE[table].push(row);
  save(table);
  return row;
}

export function dbUpdate(table, id, patch) {
  const idx = CACHE[table].findIndex(r => r.id === id);
  if (idx === -1) return null;
  CACHE[table][idx] = { ...CACHE[table][idx], ...patch };
  save(table);
  return CACHE[table][idx];
}

export function dbDelete(table, id) {
  CACHE[table] = CACHE[table].filter(r => r.id !== id);
  save(table);
}

export function dbFind(table, id) {
  return CACHE[table].find(r => r.id === id) || null;
}

export function initLocalStorage() {
  const hasData = localStorage.getItem(KEY('students'));
  if (!hasData) {
    for (const t of TABLES) {
      if (SEED[t] && SEED[t].length) {
        localStorage.setItem(KEY(t), JSON.stringify(SEED[t]));
      }
    }
  }
  loadAll();
}

export function clearDemoData() {
  for (const t of TABLES) {
    localStorage.removeItem(KEY(t));
    CACHE[t] = [];
  }
}
