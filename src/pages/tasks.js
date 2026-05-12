import { CACHE, dbInsert, dbUpdate, dbDelete, dbFind } from '../core/store.js';
import { state } from '../core/state.js';
import { uid, fmtDate, today } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';

const PRIORITY = {
  high: { label: 'Высокий', cls: 'b-r' },
  med:  { label: 'Средний', cls: 'b-a' },
  low:  { label: 'Низкий',  cls: 'b-gray' },
};

export function renderAssistantTasks() {
  const el = document.getElementById('tasks-content');
  if (!el) return;

  const filter = state.taskFilter || 'open';
  let tasks = [...CACHE.tasks];
  if (filter === 'open')   tasks = tasks.filter(t => t.status === 'open');
  if (filter === 'done')   tasks = tasks.filter(t => t.status === 'done');
  // 'all' — no filter

  tasks.sort((a,b) => {
    const po = { high:0, med:1, low:2 };
    if (po[a.priority] !== po[b.priority]) return po[a.priority] - po[b.priority];
    return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  });

  const open = CACHE.tasks.filter(t => t.status === 'open').length;
  const done = CACHE.tasks.filter(t => t.status === 'done').length;

  el.innerHTML = `
    <div class="ph">
      <div style="display:flex;gap:6px;align-items:center">
        <div class="an-period-bar">
          <button class="${filter==='open'?'on':''}" onclick="window.__setTaskFilter('open')">Открытые (${open})</button>
          <button class="${filter==='done'?'on':''}" onclick="window.__setTaskFilter('done')">Выполненные (${done})</button>
          <button class="${filter==='all'?'on':''}" onclick="window.__setTaskFilter('all')">Все</button>
        </div>
      </div>
      <button class="btn btn-p btn-sm" onclick="window.__openAssistantTaskModal()">+ Задача</button>
    </div>

    ${!tasks.length ? '<div class="empty">Нет задач</div>' : tasks.map(t => {
      const s = t.studentId ? CACHE.students.find(st => st.id === t.studentId) : null;
      const isOverdue = t.status === 'open' && t.dueDate && t.dueDate < today();
      const pr = PRIORITY[t.priority] || PRIORITY.low;
      return `
        <div class="risk-row" style="gap:12px">
          <input type="checkbox" ${t.status==='done'?'checked':''} onchange="window.__changeTaskStatus('${t.id}', this.checked ? 'done' : 'open')" style="width:16px;height:16px;cursor:pointer">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;${t.status==='done'?'text-decoration:line-through;color:var(--muted)':''}">${t.title}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">
              ${s ? `<a href="#" onclick="window.__openStudentDetail('${s.id}');return false" style="color:var(--accent)">${s.name}</a> · ` : ''}
              ${t.dueDate ? `<span style="color:${isOverdue?'var(--red)':'var(--muted)'}">${isOverdue?'❗':''} до ${fmtDate(t.dueDate)}</span>` : ''}
              ${t.note ? ` · ${t.note}` : ''}
            </div>
          </div>
          <span class="b ${pr.cls}" style="font-size:10px">${pr.label}</span>
          <button class="btn btn-sm" onclick="window.__openAssistantTaskModal('${t.id}')">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="window.__deleteAssistantTask('${t.id}')">✕</button>
        </div>
      `;
    }).join('')}
  `;
}

export function setTaskFilter(f) {
  state.taskFilter = f;
  renderAssistantTasks();
}

export function openAssistantTaskModal(id = null) {
  const t = id ? dbFind('tasks', id) : null;
  modal('task-modal', `
    <div class="modal-title">${t ? 'Редактировать задачу' : 'Новая задача'}</div>
    <div class="fg"><label>Задача *</label><input class="fi" id="tm-title" value="${t?.title || ''}" placeholder="Позвонить ученику"></div>
    <div class="form-row">
      <div class="fg"><label>Срок</label><input class="fi" id="tm-due" type="date" value="${t?.dueDate || ''}"></div>
      <div class="fg"><label>Приоритет</label>
        <select class="fi" id="tm-priority">
          <option value="low" ${t?.priority==='low'?'selected':''}>Низкий</option>
          <option value="med" ${t?.priority==='med'?'selected':''}>Средний</option>
          <option value="high" ${t?.priority==='high'?'selected':''}>Высокий</option>
        </select>
      </div>
    </div>
    <div class="fg"><label>Ученик (необязательно)</label>
      <select class="fi" id="tm-student">
        <option value="">—</option>
        ${CACHE.students.map(s => `<option value="${s.id}" ${t?.studentId===s.id?'selected':''}>${s.name}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label>Заметка</label><input class="fi" id="tm-note" value="${t?.note || ''}"></div>
    <div class="modal-footer">
      ${t ? `<button class="btn btn-danger" onclick="window.__deleteAssistantTask('${t.id}')">Удалить</button>` : ''}
      <button class="btn" onclick="window.__closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="window.__saveAssistantTask('${id||''}')">Сохранить</button>
    </div>
  `);
}

export function saveAssistantTask(id) {
  const title = document.getElementById('tm-title')?.value?.trim();
  if (!title) { toast('Введите задачу'); return; }
  const patch = {
    title,
    dueDate: document.getElementById('tm-due')?.value || null,
    priority: document.getElementById('tm-priority')?.value || 'low',
    studentId: document.getElementById('tm-student')?.value || null,
    note: document.getElementById('tm-note')?.value?.trim() || '',
    status: id ? (dbFind('tasks', id)?.status || 'open') : 'open',
  };
  if (id) {
    dbUpdate('tasks', id, patch);
  } else {
    dbInsert('tasks', patch);
  }
  closeModal();
  toast('Сохранено');
  renderAssistantTasks();
}

export function changeTaskStatus(id, status) {
  dbUpdate('tasks', id, { status });
  renderAssistantTasks();
}

export function deleteAssistantTask(id) {
  if (!confirm('Удалить задачу?')) return;
  dbDelete('tasks', id);
  closeModal();
  toast('Удалено');
  renderAssistantTasks();
}
