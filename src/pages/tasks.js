import { CACHE, dbInsert, dbUpdate, dbDelete } from '../core/store.js';
import { state } from '../core/state.js';
import { uid, fmtDate, today, g } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';

let _taskFilter = '';

const TASK_STATUS = {
  assigned:    { label: 'Назначено',   cls: 'b-bl' },
  in_progress: { label: 'В процессе', cls: 'b-a' },
  done:        { label: 'Выполнено',   cls: 'b-g' },
};

export function setTaskFilter(status) {
  _taskFilter = status;
  document.querySelectorAll('.task-tab').forEach(b => b.classList.remove('on'));
  const tabs = document.querySelectorAll('.task-tab');
  const idx = ['', 'assigned', 'in_progress', 'done'].indexOf(status);
  if (tabs[idx]) tabs[idx].classList.add('on');
  renderAssistantTasks();
}

export function renderAssistantTasks() {
  const tbody = document.getElementById('assistant-tasks-tbody');
  const empty = document.getElementById('assistant-tasks-empty');
  if (!tbody) return;

  const role = state.currentRole || {};
  let atasks = CACHE.atasks || [];

  if (!role.isOwner) atasks = atasks.filter(t => t.assignee === role.name);
  if (_taskFilter) atasks = atasks.filter(t => (t.status || 'assigned') === _taskFilter);

  if (!atasks.length) { tbody.innerHTML = ''; if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = atasks.map(t => {
    const st = TASK_STATUS[t.status || 'assigned'] || TASK_STATUS.assigned;
    const isOverdue = t.deadline && t.status !== 'done' && new Date(t.deadline) < new Date();
    const deadlineHtml = t.deadline
      ? `<span style="color:${isOverdue ? 'var(--red)' : 'inherit'}">${fmtDate(t.deadline)}${isOverdue ? ' <i class="ti ti-alert-circle" style="font-size:11px"></i>' : ''}</span>`
      : '—';
    const canChange = role.isOwner || t.assignee === role.name;
    const nextStatus = { assigned: 'in_progress', in_progress: 'done', done: 'assigned' };
    const nextLabel  = { assigned: '→ В процессе', in_progress: '→ Выполнено', done: '↺ Назначено' };
    return `<tr>
      <td><b>${t.title || 'Без названия'}</b></td>
      <td style="max-width:200px;color:var(--muted);font-size:12px">${t.description || '—'}</td>
      <td>${t.assignee || '<span style="color:var(--hint)">Не назначено</span>'}</td>
      <td>${deadlineHtml}</td>
      <td><span class="b ${st.cls}">${st.label}</span></td>
      <td style="white-space:nowrap;display:flex;gap:4px;align-items:center">
        ${canChange ? `<button class="btn btn-sm" onclick="changeTaskStatus('${t.id}','${nextStatus[t.status || 'assigned']}')" style="font-size:11px">${nextLabel[t.status || 'assigned']}</button>` : ''}
        ${role.isOwner ? `
          <button class="btn btn-sm btn-icon" onclick="editAssistantTask('${t.id}')"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-icon" onclick="deleteAssistantTask('${t.id}')"><i class="ti ti-trash" style="color:var(--red)"></i></button>
        ` : ''}
      </td>
    </tr>`;
  }).join('');
}

export function openAssistantTaskModal(id) {
  const t = id ? (CACHE.atasks || []).find(x => x.id === id) : null;
  const v = t || { title: '', description: '', assignee: '', deadline: '', status: 'assigned' };
  const assistantOptions = (CACHE.roles || []).map(r =>
    `<option value="${r.name}" ${v.assignee === r.name ? 'selected' : ''}>${r.name}</option>`
  ).join('');
  modal(`<div class="modal">
    <div class="modal-title">${t ? 'Редактировать задачу' : 'Новая задача'}</div>
    <div class="fg" style="margin-bottom:10px">
      <label>Название задачи</label>
      <input class="fi" id="at-title" value="${v.title}" placeholder="Краткое название">
    </div>
    <div class="fg" style="margin-bottom:10px">
      <label>Комментарий</label>
      <textarea class="fi" id="at-desc" placeholder="Подробности, инструкции...">${v.description || ''}</textarea>
    </div>
    <div class="form-row">
      <div class="fg">
        <label>Ассистент</label>
        <select class="fi" id="at-assignee">
          <option value="">— Не назначено —</option>
          ${assistantOptions}
        </select>
      </div>
      <div class="fg">
        <label>Дедлайн</label>
        <input type="date" class="fi" id="at-deadline" value="${v.deadline || ''}">
      </div>
    </div>
    <div class="fg" style="margin-bottom:10px">
      <label>Статус</label>
      <select class="fi" id="at-status">
        <option value="assigned"    ${v.status === 'assigned'    ? 'selected' : ''}>Назначено</option>
        <option value="in_progress" ${v.status === 'in_progress' ? 'selected' : ''}>В процессе</option>
        <option value="done"        ${v.status === 'done'        ? 'selected' : ''}>Выполнено</option>
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="saveAssistantTask('${id || ''}')">Сохранить</button>
    </div>
  </div>`);
}

export function editAssistantTask(id) { openAssistantTaskModal(id); }

export async function saveAssistantTask(id) {
  const obj = {
    id: id || uid(),
    title: g('at-title'),
    description: g('at-desc'),
    assignee: (document.getElementById('at-assignee') || {}).value || '',
    deadline: g('at-deadline'),
    status: (document.getElementById('at-status') || {}).value || 'assigned',
    created_at: id ? ((CACHE.atasks || []).find(x => x.id === id) || {}).created_at || new Date().toISOString() : new Date().toISOString(),
  };
  if (!obj.title) { toast('Введите название задачи'); return; }
  if (id) {
    await dbUpdate('atasks', id, obj);
    CACHE.atasks = (CACHE.atasks || []).map(x => x.id === id ? obj : x);
    await addHistoryEntry('update', `Задача обновлена: ${obj.title}`, 'task', id, { table: 'atasks', action: 'update', record_id: id, old_data: null });
  } else {
    await dbInsert('atasks', obj);
    if (!CACHE.atasks) CACHE.atasks = [];
    CACHE.atasks.push(obj);
    await addHistoryEntry('insert', `Создана задача: ${obj.title}${obj.assignee ? ' → ' + obj.assignee : ''}`, 'task', obj.id, { table: 'atasks', action: 'insert', record_id: obj.id, old_data: null });
  }
  closeModal();
  renderAssistantTasks();
  toast(id ? 'Задача обновлена' : 'Задача создана');
}

export async function changeTaskStatus(id, newStatus) {
  const task = (CACHE.atasks || []).find(t => t.id === id);
  if (!task) return;
  task.status = newStatus;
  await dbUpdate('atasks', id, { status: newStatus });
  renderAssistantTasks();
  toast('Статус обновлён');
}

export async function deleteAssistantTask(id) {
  if (!confirm('Удалить задачу?')) return;
  CACHE.atasks = (CACHE.atasks || []).filter(t => t.id !== id);
  await dbDelete('atasks', id);
  renderAssistantTasks();
  toast('Задача удалена');
}
