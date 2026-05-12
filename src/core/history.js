import { CACHE, dbInsert, dbUpdate, dbDelete } from './store.js';
import { uid, fmtDateTime } from '../utils/helpers.js';
import { state } from './state.js';

export function addHistoryEntry({ action, table, recordId, before, after, label }) {
  return dbInsert('history', {
    id: uid(),
    action,      // 'create' | 'update' | 'delete'
    table,
    recordId,
    before: before || null,
    after: after || null,
    label,
    actor: state.currentRole ? state.currentRole.name : 'Система',
    createdAt: new Date().toISOString(),
  });
}

export function undoHistoryEntry(entryId) {
  const entry = CACHE.history.find(h => h.id === entryId);
  if (!entry || entry.undone) return false;

  if (entry.action === 'create') {
    dbDelete(entry.table, entry.recordId);
  } else if (entry.action === 'delete' && entry.before) {
    CACHE[entry.table].push(entry.before);
    const { dbInsert: _ins, ...rest } = { dbInsert };
    dbInsert(entry.table, entry.before);
  } else if (entry.action === 'update' && entry.before) {
    dbUpdate(entry.table, entry.recordId, entry.before);
  }

  dbUpdate('history', entryId, { undone: true, undoneAt: new Date().toISOString() });
  return true;
}
