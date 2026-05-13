import { SEED } from '../data/seed.js';
import { uid } from '../utils/helpers.js';

// Single source of truth — all modules import this object and read/mutate it in place
export const CACHE = {
  students: [],
  groups: [],
  payments: [],
  expenses: [],
  modules: [],
  tasks: [],
  roles: [],
  folders: [],
  lessons: [],
  atasks: [],
  events: [],
  student_notes: [],
  hw_submissions: [],
  history_log: [],
};

export const TABLES = ['groups','students','payments','expenses','modules','tasks','roles','folders','lessons','atasks','events','student_notes','hw_submissions','history_log'];

const KEY = (t) => `tutoros_${t}`;

export function getExpenseCategories() {
  try { return JSON.parse(localStorage.getItem('tutoros_expense_cats') || 'null'); } catch(e) { return null; }
}

export function saveExpenseCategories(cats) {
  localStorage.setItem('tutoros_expense_cats', JSON.stringify(cats));
}

export function expenseCats() {
  return getExpenseCategories() || ['Платформы', 'Реклама', 'Материалы', 'Оборудование', 'Прочее'];
}

export function loadAll() {
  for (const t of TABLES) {
    const raw = localStorage.getItem(KEY(t));
    CACHE[t] = raw ? JSON.parse(raw) : [];
  }
}

function save(table) {
  localStorage.setItem(KEY(table), JSON.stringify(CACHE[table]));
}

export async function dbInsert(table, record) {
  const rows = JSON.parse(localStorage.getItem(KEY(table)) || '[]');
  rows.push(record);
  localStorage.setItem(KEY(table), JSON.stringify(rows));
}

export async function dbUpdate(table, id, patch) {
  const rows = (JSON.parse(localStorage.getItem(KEY(table)) || '[]')).map(r => r.id === id ? { ...r, ...patch } : r);
  localStorage.setItem(KEY(table), JSON.stringify(rows));
}

export async function dbDelete(table, id) {
  const rows = (JSON.parse(localStorage.getItem(KEY(table)) || '[]')).filter(r => r.id !== id);
  localStorage.setItem(KEY(table), JSON.stringify(rows));
}

export function dbFind(table, id) {
  return CACHE[table].find(r => r.id === id) || null;
}

export function initLocalStorage() {
  // Demo mode: always reseed so relative dates stay fresh on every load
  TABLES.forEach(t => {
    const data = SEED[t] || [];
    localStorage.setItem(KEY(t), JSON.stringify(data));
  });
  loadAll();
}

export function clearDemoData() {
  TABLES.forEach(t => {
    localStorage.setItem(KEY(t), JSON.stringify(SEED[t] || []));
  });
}
