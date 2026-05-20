import { CACHE, dbInsert, dbUpdate, dbDelete } from './store.js';
import { uid } from '../utils/helpers.js';
import { state } from './state.js';

export async function addHistoryEntry(action, description, entityType, entityId, undoData) {
  const entry = {
    id: uid(),
    action,
    description,
    entity_type: entityType || '',
    entity_id: entityId || '',
    actor: state.currentRole ? state.currentRole.name : 'Владелец',
    timestamp: new Date().toISOString(),
    undo_data: undoData || null,
  };
  await dbInsert('history_log', entry);
  if (CACHE.history_log.length > 500) CACHE.history_log.shift();
}

export async function undoHistoryEntry(id) {
  const entry = (CACHE.history_log || []).find(e => e.id === id);
  if (!entry || !entry.undo_data) return;
  if (!confirm(`Отменить действие: "${entry.description || entry.action}"?\n\nЭто восстановит предыдущее состояние данных.`)) return;
  try {
    const { table, action, record_id, old_data } = entry.undo_data;
    if (action === 'insert') {
      await dbDelete(table, record_id);
      if (CACHE[table]) CACHE[table] = CACHE[table].filter(r => r.id !== record_id);
    } else if (action === 'update' && old_data) {
      await dbUpdate(table, record_id, old_data);
      if (CACHE[table]) CACHE[table] = CACHE[table].map(r => r.id === record_id ? { ...r, ...old_data } : r);
    } else if (action === 'delete' && old_data) {
      await dbInsert(table, old_data);
      if (CACHE[table]) CACHE[table].push(old_data);
    }
    await addHistoryEntry('undo', `Отменено: ${entry.description || entry.action}`, entry.entity_type, entry.entity_id, null);
    return true;
  } catch (err) {
    console.error('Undo error:', err);
    return false;
  }
}
