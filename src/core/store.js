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

const BOOT_TABLES = ['roles'];
const _loaded = new Set();
const _channels = new Map();

// ── Demo mode ────────────────────────────────────────────────────────────────

const DEMO_KEY = 'tutoros_demo_mode';
export const isDemoMode = () => localStorage.getItem(DEMO_KEY) === '1';

export function setDemoMode(enabled) {
  if (enabled) {
    localStorage.setItem(DEMO_KEY, '1');
    localStorage.removeItem('tutoros_role');
  } else {
    localStorage.removeItem(DEMO_KEY);
    localStorage.removeItem('tutoros_role');
  }
}

// ── Expense categories ────────────────────────────────────────────────────────

export function getExpenseCategories() {
  try { return JSON.parse(localStorage.getItem('tutoros_expense_cats') || 'null'); } catch { return null; }
}
export function saveExpenseCategories(cats) {
  localStorage.setItem('tutoros_expense_cats', JSON.stringify(cats));
}
export function expenseCats() {
  return getExpenseCategories() || ['Платформы', 'Реклама', 'Материалы', 'Оборудование', 'Прочее'];
}

// ── Realtime ─────────────────────────────────────────────────────────────────

function _subscribeTable(table) {
  if (_channels.has(table) || isDemoMode()) return;

  const ch = supabase
    .channel(`rt-${table}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      const { eventType, new: newRow, old: oldRow } = payload;
      if (eventType === 'INSERT') {
        if (!(CACHE[table] || []).find(r => r.id === newRow.id)) {
          CACHE[table] = [...(CACHE[table] || []), newRow];
        }
      } else if (eventType === 'UPDATE') {
        CACHE[table] = (CACHE[table] || []).map(r => r.id === newRow.id ? { ...r, ...newRow } : r);
      } else if (eventType === 'DELETE') {
        CACHE[table] = (CACHE[table] || []).filter(r => r.id !== oldRow.id);
      }
      window.dispatchEvent(new CustomEvent('cache-update', { detail: { table } }));
    })
    .subscribe();

  _channels.set(table, ch);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function dbInsert(table, record) {
  CACHE[table] = [...(CACHE[table] || []), record];
  if (!isDemoMode()) {
    const { error } = await supabase.from(table).insert(record);
    if (error) {
      CACHE[table] = CACHE[table].filter(r => r !== record);
      window.dispatchEvent(new CustomEvent('cache-update', { detail: { table } }));
      throw new Error(`[${table}] insert: ${error.message}`);
    }
  }
}

export async function dbUpdate(table, id, patch) {
  const prev = CACHE[table];
  CACHE[table] = (CACHE[table] || []).map(r => r.id === id ? { ...r, ...patch } : r);
  if (!isDemoMode()) {
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    if (error) {
      CACHE[table] = prev;
      window.dispatchEvent(new CustomEvent('cache-update', { detail: { table } }));
      throw new Error(`[${table}] update: ${error.message}`);
    }
  }
}

export async function dbDelete(table, id) {
  const prev = CACHE[table];
  CACHE[table] = (CACHE[table] || []).filter(r => r.id !== id);
  if (!isDemoMode()) {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) {
      CACHE[table] = prev;
      window.dispatchEvent(new CustomEvent('cache-update', { detail: { table } }));
      throw new Error(`[${table}] delete: ${error.message}`);
    }
  }
}

export function dbFind(table, id) {
  return (CACHE[table] || []).find(r => r.id === id) || null;
}

// ── Lazy loading ─────────────────────────────────────────────────────────────

async function _loadTable(table) {
  if (_loaded.has(table)) return;
  const { data, error } = await supabase.from(table).select('*');
  if (error) { console.warn(`Load ${table}:`, error.message); return; }
  CACHE[table] = data || [];
  _loaded.add(table);
  _subscribeTable(table);
}

export async function ensureLoaded(tables) {
  if (isDemoMode()) return;
  const missing = tables.filter(t => !_loaded.has(t));
  if (!missing.length) return;
  await Promise.all(missing.map(_loadTable));
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

export async function initSupabase() {
  if (isDemoMode()) {
    for (const t of TABLES) CACHE[t] = (SEED[t] || []).map(r => ({ ...r }));
    return;
  }
  await Promise.all(BOOT_TABLES.map(_loadTable));
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
