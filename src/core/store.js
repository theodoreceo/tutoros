import { supabase } from '../lib/supabase.js';
import { SEED } from '../data/seed.js';

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
  homework_assignments: [],
  homework_submissions: [],
  assistant_groups: [],
};

export const TABLES = [
  'groups', 'students', 'payments', 'expenses', 'modules', 'tasks', 'roles',
  'folders', 'lessons', 'atasks', 'events', 'student_notes', 'hw_submissions',
  'history_log', 'homework_assignments', 'homework_submissions', 'assistant_groups',
];

// Expense categories stay in localStorage (UI config, not data)
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
  const { error } = await supabase.from(table).insert(record);
  if (error) throw new Error(`[${table}] insert: ${error.message}`);
  CACHE[table] = [...(CACHE[table] || []), record];
}

export async function dbUpdate(table, id, patch) {
  const { error } = await supabase.from(table).update(patch).eq('id', id);
  if (error) throw new Error(`[${table}] update: ${error.message}`);
  CACHE[table] = (CACHE[table] || []).map(r => r.id === id ? { ...r, ...patch } : r);
}

export async function dbDelete(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw new Error(`[${table}] delete: ${error.message}`);
  CACHE[table] = (CACHE[table] || []).filter(r => r.id !== id);
}

export function dbFind(table, id) {
  return (CACHE[table] || []).find(r => r.id === id) || null;
}

// ── INIT ─────────────────────────────────────────────────────────────────────

// FK-safe insert order
const SEED_ORDER = [
  'groups', 'roles', 'students', 'payments', 'expenses',
  'lessons', 'homework_assignments', 'homework_submissions',
  'assistant_groups', 'events', 'student_notes', 'history_log',
  'tasks', 'atasks', 'hw_submissions', 'modules', 'folders',
];

// FK-safe delete order (children first)
const DELETE_ORDER = [
  'history_log', 'events', 'hw_submissions', 'atasks', 'tasks',
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

async function _seedDatabase() {
  for (const t of SEED_ORDER) {
    const records = SEED[t] || [];
    if (!records.length) continue;
    const { error } = await supabase.from(t).insert(records);
    if (error) console.warn(`Seed ${t}:`, error.message);
    else CACHE[t] = records;
  }
}

export async function initSupabase() {
  await _loadAll();
  // Never auto-seed in production — call seedDemoData() explicitly from setup screen
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
  if (import.meta.env.DEV) {
    await seedDemoData();
  }
}
