import { supabase } from '../lib/supabase.js';
import { SEED } from '../data/seed.js';

export const CACHE = {
  students: [],
  groups: [],
  payments: [],
  expenses: [],
  modules: [],
  roles: [],
  folders: [],
  lessons: [],
  events: [],
  student_notes: [],
  hw_submissions: [],
  history_log: [],
  homework_assignments: [],
  homework_submissions: [],
  assistant_groups: [],
};

export const TABLES = [
  'groups', 'students', 'payments', 'expenses', 'modules', 'roles',
  'folders', 'lessons', 'events', 'student_notes', 'hw_submissions',
  'history_log', 'homework_assignments', 'homework_submissions', 'assistant_groups',
];

// ── Demo mode ────────────────────────────────────────────────────────────────
// In demo mode CACHE is loaded from SEED; all writes are in-memory only (no DB).

const DEMO_KEY = 'tutoros_demo_mode';
export const isDemoMode = () => localStorage.getItem(DEMO_KEY) === '1';

export function setDemoMode(enabled) {
  if (enabled) localStorage.setItem(DEMO_KEY, '1');
  else localStorage.removeItem(DEMO_KEY);
}

// ── Expense categories (UI config, stays in localStorage) ─────────────────────

export function getExpenseCategories() {
  try { return JSON.parse(localStorage.getItem('tutoros_expense_cats') || 'null'); } catch { return null; }
}
export function saveExpenseCategories(cats) {
  localStorage.setItem('tutoros_expense_cats', JSON.stringify(cats));
}
export function expenseCats() {
  return getExpenseCategories() || ['Платформы', 'Реклама', 'Материалы', 'Оборудование', 'Прочее'];
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function dbInsert(table, record) {
  CACHE[table] = [...(CACHE[table] || []), record];
  if (!isDemoMode()) {
    const { error } = await supabase.from(table).insert(record);
    if (error) { CACHE[table] = CACHE[table].filter(r => r !== record); throw new Error(`[${table}] insert: ${error.message}`); }
  }
}

export async function dbUpdate(table, id, patch) {
  const prev = CACHE[table];
  CACHE[table] = (CACHE[table] || []).map(r => r.id === id ? { ...r, ...patch } : r);
  if (!isDemoMode()) {
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    if (error) { CACHE[table] = prev; throw new Error(`[${table}] update: ${error.message}`); }
  }
}

export async function dbDelete(table, id) {
  const prev = CACHE[table];
  CACHE[table] = (CACHE[table] || []).filter(r => r.id !== id);
  if (!isDemoMode()) {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) { CACHE[table] = prev; throw new Error(`[${table}] delete: ${error.message}`); }
  }
}

export function dbFind(table, id) {
  return (CACHE[table] || []).find(r => r.id === id) || null;
}

// ── INIT ─────────────────────────────────────────────────────────────────────

const SEED_ORDER = [
  'groups', 'roles', 'students', 'payments', 'expenses',
  'lessons', 'homework_assignments', 'homework_submissions',
  'assistant_groups', 'events', 'student_notes', 'history_log',
  'hw_submissions', 'modules', 'folders',
];

const DELETE_ORDER = [
  'history_log', 'events', 'hw_submissions',
  'student_notes', 'homework_submissions', 'assistant_groups',
  'payments', 'homework_assignments', 'lessons',
  'students', 'expenses', 'modules', 'folders',
  'groups', 'roles',
];

async function _loadAll() {
  const results = await Promise.all(
    TABLES.map(t => supabase.from(t).select('*').then(({ data, error }) => {
      if (error) console.warn(`Load ${t}:`, error.message);
      return [t, data || []];
    }))
  );
  for (const [t, data] of results) CACHE[t] = data;
}

export async function initSupabase() {
  if (isDemoMode()) {
    for (const t of TABLES) CACHE[t] = (SEED[t] || []).map(r => ({ ...r }));
    return;
  }
  await _loadAll();
}

export async function seedDemoData() {
  for (const t of SEED_ORDER) {
    const records = SEED[t] || [];
    if (!records.length) continue;
    const { error } = await supabase.from(t).insert(records);
    if (error) console.warn(`Seed ${t}:`, error.message);
    else CACHE[t] = [...(CACHE[t] || []), ...records];
  }
}

export async function clearDemoData() {
  for (const t of DELETE_ORDER) {
    const { error } = await supabase.from(t).delete().not('id', 'is', null);
    if (error) console.warn(`Clear ${t}:`, error.message);
    else CACHE[t] = [];
  }
}
