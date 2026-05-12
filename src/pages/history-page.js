import { CACHE } from '../core/store.js';
import { undoHistoryEntry } from '../core/history.js';
import { toast } from '../components/toast.js';

export function renderHistoryPage() {
  const el = document.getElementById('history-content');
  if (!el) return;

  const entries = [...CACHE.history].sort((a,b) => b.createdAt.localeCompare(a.createdAt));

  if (!entries.length) {
    el.innerHTML = '<div class="empty">История изменений пуста</div>';
    return;
  }

  const ACTION_LABELS = { create: 'Создано', update: 'Изменено', delete: 'Удалено' };
  const ACTION_COLORS = { create: 'b-g', update: 'b-bl', delete: 'b-r' };

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse" class="tbl-wrap">
      <thead><tr>
        <th>Дата</th><th>Действие</th><th>Описание</th><th>Кто</th><th></th>
      </tr></thead>
      <tbody>
        ${entries.slice(0, 100).map(h => `
          <tr style="${h.undone ? 'opacity:.5;text-decoration:line-through' : ''}">
            <td style="white-space:nowrap;font-size:11px;color:var(--muted)">${new Date(h.createdAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
            <td><span class="b ${ACTION_COLORS[h.action] || 'b-gray'}">${ACTION_LABELS[h.action] || h.action}</span></td>
            <td>${h.label || '—'}</td>
            <td style="color:var(--muted);font-size:12px">${h.actor || '—'}</td>
            <td>
              ${!h.undone && (h.action === 'create' || h.action === 'update') ?
                `<button class="btn btn-sm" onclick="window.__undoHistory('${h.id}')">↩ Отменить</button>` :
                h.undone ? '<span style="font-size:11px;color:var(--hint)">Отменено</span>' : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export function undoHistory(id) {
  const ok = undoHistoryEntry(id);
  if (ok) {
    toast('Изменение отменено');
    renderHistoryPage();
  } else {
    toast('Не удалось отменить');
  }
}
