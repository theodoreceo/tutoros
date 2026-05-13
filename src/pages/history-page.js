import { CACHE, dbInsert, dbUpdate, dbDelete } from '../core/store.js';
import { state } from '../core/state.js';
import { addHistoryEntry } from '../core/history.js';
import { toast } from '../components/toast.js';

export function renderHistoryPage() {
  const el = document.getElementById('history-container');
  if (!el) return;
  const entries = (CACHE.history_log || []).slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (!entries.length) { el.innerHTML = '<div class="empty">История изменений пуста</div>'; return; }
  const role = state.currentRole || {};
  el.innerHTML = entries.map(e => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border)" id="hlog-${e.id}">
      <div style="width:10px;height:10px;border-radius:50%;background:var(--accent-mid);flex-shrink:0;margin-top:4px"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500">${e.description || e.action}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">
          <i class="ti ti-user" style="font-size:10px"></i> ${e.actor} &nbsp;·&nbsp;
          <i class="ti ti-clock" style="font-size:10px"></i> ${new Date(e.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          ${e.entity_type ? `&nbsp;·&nbsp; <span class="b b-gray" style="font-size:10px">${e.entity_type}</span>` : ''}
        </div>
      </div>
      ${e.undo_data && role.isOwner ? `<button class="btn btn-sm btn-danger" onclick="undoHistoryEntry('${e.id}')"><i class="ti ti-rotate-left"></i> Отменить</button>` : ''}
    </div>`).join('');
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
    renderHistoryPage();
    toast('Действие отменено');
  } catch (err) { toast('Ошибка при отмене: ' + err.message); }
}
