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
  CACHE[table].push(record);
  save(table);
}

export async function dbUpdate(table, id, patch) {
  CACHE[table] = CACHE[table].map(r => r.id === id ? { ...r, ...patch } : r);
  save(table);
}

export async function dbDelete(table, id) {
  CACHE[table] = CACHE[table].filter(r => r.id !== id);
  save(table);
}

export function dbFind(table, id) {
  return CACHE[table].find(r => r.id === id) || null;
}

const INIT_KEY = 'tutoros_initialized';

export function initLocalStorage() {
  if (!localStorage.getItem(INIT_KEY)) {
    TABLES.forEach(t => localStorage.setItem(KEY(t), JSON.stringify(SEED[t] || [])));
    localStorage.setItem(INIT_KEY, '1');
  }
  loadAll();
}

export function clearDemoData() {
  TABLES.forEach(t => localStorage.setItem(KEY(t), JSON.stringify(SEED[t] || [])));
  localStorage.removeItem(INIT_KEY);
}
