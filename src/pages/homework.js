import { CACHE } from '../core/store.js';
import { db } from '../lib/db.js';
import { state } from '../core/state.js';
import { uid, fmtDate, today } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';

let _hwTab = 'queue';
const _reviewErrors = [];

function scoreLabel(score) {
  if (score === null || score === undefined) return { text: '—', color: 'var(--hint)' };
  if (score < 50) return { text: 'Слабо', color: 'var(--red)' };
  if (score < 75) return { text: 'Удовлетворительно', color: 'var(--amber)' };
  if (score < 90) return { text: 'Хорошо', color: 'var(--green)' };
  return { text: 'Отлично', color: 'var(--accent-mid)' };
}

function sourceIcon(source) {
  const icons = { telegram: 'ti-brand-telegram', vk: 'ti-brand-vk', web: 'ti-globe', manual: 'ti-edit' };
  return icons[source] || 'ti-link';
}

function getMyAssistantId() {
  const role = state.currentRole || {};
  return role.isOwner ? null : role.id;
}

function isOverdue(assignment) {
  return assignment?.due_date && new Date(assignment.due_date) < new Date();
}

export async function getHwQueueCount() {
  const assistantId = getMyAssistantId();
  const queue = await db.homeworks.getQueue(assistantId);
  return queue.length;
}

export async function updateHwBadge() {
  const badge = document.getElementById('hw-queue-badge');
  if (!badge) return;
  const count = await getHwQueueCount();
  badge.textContent = count || '';
  badge.style.display = count ? '' : 'none';
}

export function setHwTab(tab) {
  _hwTab = tab;
  document.querySelectorAll('.hw-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('hw-tab-queue').style.display   = tab === 'queue'   ? '' : 'none';
  document.getElementById('hw-tab-overdue').style.display = tab === 'overdue' ? '' : 'none';
  document.getElementById('hw-tab-all').style.display     = tab === 'all'     ? '' : 'none';
  if (tab === 'queue')        renderHwQueue();
  else if (tab === 'overdue') renderOverdueHw();
  else                        renderAllHw();
}

export async function renderHomeworkPage() {
  await updateHwBadge();
  if (_hwTab === 'queue')        await renderHwQueue();
  else if (_hwTab === 'overdue') await renderOverdueHw();
  else                           await renderAllHw();
  document.getElementById('hw-tab-queue').style.display   = _hwTab === 'queue'   ? '' : 'none';
  document.getElementById('hw-tab-overdue').style.display = _hwTab === 'overdue' ? '' : 'none';
  document.getElementById('hw-tab-all').style.display     = _hwTab === 'all'     ? '' : 'none';
}

async function renderHwQueue() {
  const el = document.getElementById('hw-tab-queue');
  if (!el) return;
  const assistantId = getMyAssistantId();
  const queue = await db.homeworks.getQueue(assistantId);
  if (!queue.length) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px 20px;color:var(--hint)">
      <i class="ti ti-circle-check" style="font-size:28px;display:block;margin-bottom:8px;color:var(--green);opacity:.7"></i>
      Нет работ на проверке
    </div>`;
    return;
  }
  const rows = queue.map(sub => {
    const stu = (CACHE.students || []).find(s => s.id === sub.student_id);
    const assignment = (CACHE.homework_assignments || []).find(a => a.id === sub.assignment_id);
    const initials = stu ? stu.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
    const submittedAgo = sub.submitted_at ? (() => {
      const diff = Math.round((Date.now() - new Date(sub.submitted_at)) / 3600000);
      if (diff < 1) return 'только что';
      if (diff < 24) return `${diff}ч назад`;
      return `${Math.round(diff / 24)}д назад`;
    })() : '—';
    const overdue = isOverdue(assignment);
    return `<div class="card" style="display:flex;align-items:center;gap:14px;padding:12px 16px;margin-bottom:8px">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--accent-mid);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;flex-shrink:0">${initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${stu ? stu.name : '—'}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${assignment ? assignment.topic || '—' : '—'}</div>
        <div style="font-size:11px;color:var(--hint);margin-top:2px">
          Сдано: ${submittedAgo}
          ${overdue ? '<span class="b b-r" style="font-size:10px;margin-left:6px">просрочено</span>' : ''}
          ${sub.submission_url ? `<i class="ti ${sourceIcon(sub.source)}" style="margin-left:8px;font-size:12px;color:var(--accent-mid)"></i>` : ''}
        </div>
      </div>
      <button class="btn btn-sm btn-p" onclick="openReviewModal('${sub.id}')"><i class="ti ti-pencil-check"></i> Проверить</button>
    </div>`;
  }).join('');
  el.innerHTML = rows;
}

async function renderOverdueHw() {
  const el = document.getElementById('hw-tab-overdue');
  if (!el) return;
  const role = state.currentRole || {};
  const assistantId = role.isOwner ? null : role.id;

  let subs = (CACHE.homework_submissions || []).filter(s => s.status === 'assigned');
  if (!role.isOwner && assistantId) {
    const myGroups = await db.assistantGroups.getGroupsByAssistant(assistantId);
    const groupIds = new Set(myGroups.map(ag => ag.group_id));
    const myIds = new Set((CACHE.homework_assignments || []).filter(a => groupIds.has(a.group_id)).map(a => a.id));
    subs = subs.filter(s => myIds.has(s.assignment_id));
  }

  subs = [...subs].sort((a, b) => {
    const aDate = (CACHE.homework_assignments || []).find(x => x.id === a.assignment_id)?.due_date || '';
    const bDate = (CACHE.homework_assignments || []).find(x => x.id === b.assignment_id)?.due_date || '';
    return aDate.localeCompare(bDate);
  });

  if (!subs.length) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px 20px;color:var(--hint)">
      <i class="ti ti-circle-check" style="font-size:28px;display:block;margin-bottom:8px;color:var(--green);opacity:.7"></i>
      Нет несданных заданий
    </div>`;
    return;
  }

  const statusCfg = {
    assigned: { label: 'Не сдано', cls: 'b-gray' },
    overdue:  { label: 'Просрочено', cls: 'b-r' },
  };
  const hwTypeCfg = {
    brief:    { label: 'Краткий', cls: 'b-gray' },
    detailed: { label: 'Подробный', cls: 'b-bl' },
    trial:    { label: 'Пробник', cls: 'b-a' },
  };

  el.innerHTML = `<div class="card" style="padding:0;overflow-x:auto">
    <table class="tbl">
      <thead><tr><th>Ученик</th><th>Тема</th><th>Тип</th><th>Срок</th><th>Статус</th></tr></thead>
      <tbody>
        ${subs.map(sub => {
          const stu = (CACHE.students || []).find(s => s.id === sub.student_id);
          const assignment = (CACHE.homework_assignments || []).find(a => a.id === sub.assignment_id);
          const overdue = isOverdue(assignment);
          const st = overdue ? statusCfg.overdue : statusCfg.assigned;
          const ht = hwTypeCfg[assignment?.hw_type] || hwTypeCfg.detailed;
          return `<tr>
            <td><b>${stu?.name || '—'}</b></td>
            <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${assignment?.topic || '—'}</td>
            <td><span class="b ${ht.cls}">${ht.label}</span></td>
            <td>${assignment?.due_date ? `<span style="color:${overdue ? 'var(--red)' : 'inherit'}">${fmtDate(assignment.due_date)}</span>` : '—'}</td>
            <td><span class="b ${st.cls}">${st.label}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

async function renderAllHw() {
  const el = document.getElementById('hw-tab-all');
  if (!el) return;
  const role = state.currentRole || {};
  const assistantId = role.isOwner ? null : role.id;

  let subs = CACHE.homework_submissions || [];
  if (!role.isOwner && assistantId) {
    const myGroups = await db.assistantGroups.getGroupsByAssistant(assistantId);
    const groupIds = new Set(myGroups.map(ag => ag.group_id));
    const myAssignmentIds = new Set(
      (CACHE.homework_assignments || []).filter(a => groupIds.has(a.group_id)).map(a => a.id)
    );
    subs = subs.filter(s => myAssignmentIds.has(s.assignment_id));
  }

  const studentFilter = (document.getElementById('hw-all-student') || {}).value || '';
  const statusFilter = (document.getElementById('hw-all-status') || {}).value || '';
  if (studentFilter) subs = subs.filter(s => s.student_id === studentFilter);
  if (statusFilter) subs = subs.filter(s => s.status === statusFilter);

  subs = [...subs].sort((a, b) => {
    const da = a.submitted_at || a.assigned_at || '';
    const db2 = b.submitted_at || b.assigned_at || '';
    return db2.localeCompare(da);
  });

  const stuOpts = (CACHE.students || []).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  const statusCfg = {
    assigned: { label: 'Назначено', cls: 'b-gray' },
    submitted: { label: 'Сдано', cls: 'b-bl' },
    checked: { label: 'Проверено', cls: 'b-g' },
    overdue: { label: 'Просрочено', cls: 'b-r' },
  };
  const hwTypeCfg = {
    brief:    { label: 'Краткий',   cls: 'b-gray' },
    detailed: { label: 'Подробный', cls: 'b-bl' },
    trial:    { label: 'Пробник',   cls: 'b-a' },
  };

  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <select class="fi" id="hw-all-student" style="max-width:200px" onchange="renderAllHwFiltered()">
        <option value="">Все ученики</option>${stuOpts}
      </select>
      <select class="fi" id="hw-all-status" style="max-width:160px" onchange="renderAllHwFiltered()">
        <option value="">Все статусы</option>
        <option value="assigned">Назначено</option>
        <option value="submitted">Сдано</option>
        <option value="checked">Проверено</option>
        <option value="overdue">Просрочено</option>
      </select>
    </div>
    ${subs.length ? `<div class="card" style="padding:0;overflow-x:auto">
      <table class="tbl">
        <thead><tr><th>Ученик</th><th>Тема</th><th>Тип</th><th>Срок</th><th>Статус</th><th>Оценка</th><th>Проверил</th><th></th></tr></thead>
        <tbody>
          ${subs.map(sub => {
            const stu = (CACHE.students || []).find(s => s.id === sub.student_id);
            const assignment = (CACHE.homework_assignments || []).find(a => a.id === sub.assignment_id);
            const st = statusCfg[sub.status] || statusCfg.assigned;
            const ht = hwTypeCfg[assignment?.hw_type] || hwTypeCfg.detailed;
            const overdue = isOverdue(assignment);
            const checker = sub.checked_by ? ((CACHE.roles || []).find(r => r.id === sub.checked_by) || {}).name || 'Владелец' : '—';
            const { text: scoreText, color: scoreColor } = scoreLabel(sub.score);
            return `<tr>
              <td><b>${stu ? stu.name : '—'}</b></td>
              <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${assignment ? assignment.topic || '—' : '—'}${assignment?.is_advanced ? ' <span class="b b-a" style="font-size:10px">Сложный</span>' : ''}</td>
              <td><span class="b ${ht.cls}">${ht.label}</span></td>
              <td>${assignment?.due_date ? `<span style="color:${overdue && sub.status !== 'checked' ? 'var(--red)' : 'inherit'}">${fmtDate(assignment.due_date)}${overdue && sub.status !== 'checked' ? ' <i class="ti ti-alert-circle" style="font-size:11px"></i>' : ''}</span>` : '—'}</td>
              <td><span class="b ${st.cls}">${st.label}</span></td>
              <td style="color:${scoreColor};font-weight:600">${scoreText}</td>
              <td style="font-size:12px;color:var(--muted)">${checker}</td>
              <td style="white-space:nowrap">
                ${assignment?.hw_type === 'brief' ? '' :
                  sub.status === 'submitted' ? `
                    <button class="btn btn-sm btn-p" onclick="openReviewModal('${sub.id}')">Проверить</button>
                    <button class="btn btn-sm" onclick="changeHwStatus('${sub.id}','assigned')" title="Вернуть"><i class="ti ti-rotate-left"></i></button>
                  ` : sub.status === 'checked' ? `
                    <button class="btn btn-sm" onclick="openReviewModal('${sub.id}')"><i class="ti ti-edit"></i> Изменить</button>
                  ` : sub.status === 'assigned' || sub.status === 'overdue' ? `
                    <button class="btn btn-sm" onclick="changeHwStatus('${sub.id}','submitted')"><i class="ti ti-upload"></i> Принять</button>
                  ` : ''
                }
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '<div class="empty">Нет домашних заданий по фильтру</div>'}
  `;
}

export async function renderAllHwFiltered() {
  await renderAllHw();
}

export async function openReviewModal(submissionId) {
  const sub = await db.homeworks.getSubmission(submissionId);
  if (!sub) { toast('Работа не найдена'); return; }
  const stu = (CACHE.students || []).find(s => s.id === sub.student_id);
  const assignment = (CACHE.homework_assignments || []).find(a => a.id === sub.assignment_id);
  _reviewErrors.length = 0;
  if (sub.errors) _reviewErrors.push(...sub.errors);

  const sourceOpts = [
    { v: 'manual', l: 'Вручную' },
    { v: 'telegram', l: 'Telegram' },
    { v: 'vk', l: 'ВКонтакте' },
    { v: 'web', l: 'Веб' },
  ].map(o => `<option value="${o.v}" ${sub.source === o.v ? 'selected' : ''}>${o.l}</option>`).join('');

  modal(`<div class="modal" style="max-width:560px">
    <div class="modal-title"><i class="ti ti-pencil-check"></i> Проверка работы</div>
    <div class="card" style="padding:10px 14px;margin-bottom:14px;background:var(--surface2)">
      <div style="font-size:13px;font-weight:700">${stu ? stu.name : '—'}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${assignment ? assignment.topic || '—' : '—'}</div>
      ${assignment?.due_date ? `<div style="font-size:11px;color:var(--hint);margin-top:2px">Срок: ${fmtDate(assignment.due_date)}</div>` : ''}
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div class="fg">
        <label>Ссылка на работу</label>
        <input class="fi" id="rv-url" value="${sub.submission_url || ''}" placeholder="https://...">
      </div>
      <div class="fg">
        <label>Источник</label>
        <select class="fi" id="rv-source">${sourceOpts}</select>
      </div>
    </div>
    <div class="fg" style="margin-bottom:12px">
      <label>Оценка <span style="color:var(--accent-mid);font-size:11px">0–100</span></label>
      <div style="display:flex;align-items:center;gap:10px">
        <input class="fi" type="number" id="rv-score" min="0" max="100" value="${sub.score ?? ''}" style="max-width:80px" oninput="updateScorePreview()">
        <div style="flex:1">
          <div class="prog" style="height:8px"><div class="prog-f" id="rv-score-bar" style="width:${sub.score ?? 0}%;background:var(--accent-mid)"></div></div>
        </div>
        <span id="rv-score-label" style="font-size:12px;font-weight:600;min-width:80px;text-align:right">${scoreLabel(sub.score).text}</span>
      </div>
    </div>
    <div class="fg" style="margin-bottom:12px">
      <label>Комментарий</label>
      <textarea class="fi" id="rv-comment" rows="3" placeholder="Общий отзыв на работу...">${sub.comment || ''}</textarea>
    </div>
    <div class="fg" style="margin-bottom:16px">
      <label style="display:flex;align-items:center;justify-content:space-between">
        <span>Ошибки</span>
        <button class="btn btn-sm" onclick="addReviewError()" type="button"><i class="ti ti-plus"></i> Добавить</button>
      </label>
      <div id="rv-errors-list">${renderErrorsList()}</div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="saveReview('${submissionId}')">Сохранить проверку</button>
    </div>
  </div>`);
  updateScorePreview();
}

function renderErrorsList() {
  if (!_reviewErrors.length) return '<div style="font-size:12px;color:var(--hint);padding:6px 0">Ошибок нет</div>';
  return _reviewErrors.map((e, i) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <input class="fi" style="flex:1" value="${e.replace(/"/g, '&quot;')}" oninput="updateReviewError(${i}, this.value)">
      <button class="btn btn-sm btn-icon" onclick="removeReviewError(${i})" type="button"><i class="ti ti-x" style="color:var(--red)"></i></button>
    </div>`).join('');
}

export function addReviewError() {
  _reviewErrors.push('');
  const el = document.getElementById('rv-errors-list');
  if (el) el.innerHTML = renderErrorsList();
}

export function removeReviewError(idx) {
  _reviewErrors.splice(idx, 1);
  const el = document.getElementById('rv-errors-list');
  if (el) el.innerHTML = renderErrorsList();
}

export function updateReviewError(idx, value) {
  _reviewErrors[idx] = value;
}

export function updateScorePreview() {
  const score = +(document.getElementById('rv-score') || {}).value;
  const bar = document.getElementById('rv-score-bar');
  const label = document.getElementById('rv-score-label');
  if (!bar || !label) return;
  const { text, color } = scoreLabel(isNaN(score) ? null : score);
  bar.style.width = `${Math.min(100, Math.max(0, score || 0))}%`;
  bar.style.background = color;
  label.textContent = text;
  label.style.color = color;
}

export async function saveReview(submissionId) {
  const score = (document.getElementById('rv-score') || {}).value;
  const comment = (document.getElementById('rv-comment') || {}).value || '';
  const url = (document.getElementById('rv-url') || {}).value || '';
  const source = (document.getElementById('rv-source') || {}).value || 'manual';
  const role = state.currentRole || {};
  const checkedBy = role.isOwner ? null : role.id;

  const errors = _reviewErrors.filter(e => e.trim());
  try {
    // Update submission_url and source first
    if (url || source) {
      const { dbUpdate: du } = await import('../core/store.js');
      await du('homework_submissions', submissionId, { submission_url: url, source });
    }
    await db.homeworks.saveReview(submissionId, {
      score: score !== '' ? +score : null,
      comment,
      errors,
      checkedBy,
    });
    const sub = await db.homeworks.getSubmission(submissionId);
    const stu = (CACHE.students || []).find(s => s.id === sub?.student_id);
    const assignment = (CACHE.homework_assignments || []).find(a => a.id === sub?.assignment_id);
    await addHistoryEntry('update', `Проверено ДЗ: ${stu?.name || '—'} · ${assignment?.topic || '—'}${score !== '' ? ' · ' + score + ' баллов' : ''}`, 'homework', submissionId, null);
    closeModal();
    if (_hwTab === 'queue') await renderHwQueue();
    else await renderAllHw();
    await updateHwBadge();
    toast('Проверка сохранена');
  } catch (err) {
    toast('Ошибка: ' + err.message);
  }
}

function getLessonOptsForGroup(groupId) {
  const lessons = (CACHE.lessons || [])
    .filter(l => l.group_id === groupId)
    .sort((a, b) => b.date.localeCompare(a.date));
  return lessons.map(l => `<option value="${l.id}">${fmtDate(l.date)} · ${l.topic || 'Без темы'}</option>`).join('');
}

export async function openCreateHwModal() {
  const role = state.currentRole || {};
  const assistantId = role.isOwner ? null : role.id;

  let availableGroups = CACHE.groups || [];
  if (!role.isOwner && assistantId) {
    const myGroups = await db.assistantGroups.getGroupsByAssistant(assistantId);
    const groupIds = new Set(myGroups.map(ag => ag.group_id));
    availableGroups = availableGroups.filter(g => groupIds.has(g.id));
  }
  if (!availableGroups.length) { toast('Нет доступных групп'); return; }

  const groupOpts = availableGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  const firstGroupId = availableGroups[0].id;
  const lessonOpts = getLessonOptsForGroup(firstGroupId);

  modal(`<div class="modal" style="max-width:560px">
    <div class="modal-title"><i class="ti ti-home-plus"></i> Новое домашнее задание</div>
    <div class="fg" style="margin-bottom:12px">
      <label>Группа</label>
      <select class="fi" id="nhw-group" onchange="updateHwLessonOpts()">${groupOpts}</select>
    </div>
    <div class="fg" style="margin-bottom:12px">
      <label>Занятие <span style="font-weight:400;color:var(--hint)">(опционально)</span></label>
      <select class="fi" id="nhw-lesson"><option value="">— не привязывать к занятию —</option>${lessonOpts}</select>
    </div>
    <div class="fg" style="margin-bottom:12px">
      <label>Тема задания</label>
      <input class="fi" id="nhw-topic" placeholder="Тригонометрия: формулы приведения...">
    </div>
    <div class="fg" style="margin-bottom:12px">
      <label>Описание / инструкция</label>
      <textarea class="fi" id="nhw-desc" rows="2" placeholder="Подробности задания..."></textarea>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div class="fg">
        <label>Тип задания</label>
        <select class="fi" id="nhw-type">
          <option value="detailed">Подробный ответ</option>
          <option value="brief">Краткий ответ</option>
          <option value="trial">Пробник</option>
        </select>
      </div>
      <div class="fg" style="margin-bottom:16px">
        <label>Дедлайн</label>
        <input class="fi" type="date" id="nhw-due">
      </div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin-bottom:16px">
      <input type="checkbox" id="nhw-advanced" style="accent-color:var(--accent-mid)">
      <span>Сложный уровень <span style="color:var(--hint);font-weight:400">(не влияет на риски и % выполнения)</span></span>
    </label>
    <div style="font-size:12px;color:var(--muted);margin-bottom:16px">
      <i class="ti ti-info-circle"></i> ДЗ автоматически назначится всем активным ученикам группы
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="saveNewHw()"><i class="ti ti-check"></i> Создать</button>
    </div>
  </div>`);
}

export function updateHwLessonOpts() {
  const groupId = (document.getElementById('nhw-group') || {}).value;
  const sel = document.getElementById('nhw-lesson');
  if (!sel) return;
  sel.innerHTML = `<option value="">— не привязывать к занятию —</option>${getLessonOptsForGroup(groupId)}`;
}

export async function saveNewHw() {
  const groupId = (document.getElementById('nhw-group') || {}).value;
  const lessonId = (document.getElementById('nhw-lesson') || {}).value || null;
  const topic = ((document.getElementById('nhw-topic') || {}).value || '').trim();
  const desc = (document.getElementById('nhw-desc') || {}).value || '';
  const due = (document.getElementById('nhw-due') || {}).value || '';
  const hw_type = (document.getElementById('nhw-type') || {}).value || 'detailed';
  const is_advanced = (document.getElementById('nhw-advanced') || {}).checked || false;

  if (!groupId) { toast('Выберите группу'); return; }
  if (!topic) { toast('Укажите тему'); return; }

  try {
    const assignment = await db.homeworks.createAssignment({
      group_id: groupId,
      lesson_id: lessonId,
      topic,
      description: desc,
      due_date: due,
      hw_type,
      is_advanced,
    });
    const students = (CACHE.students || []).filter(s => s.group_id === groupId && ['active', 'trial'].includes(s.crm_status));
    for (const stu of students) {
      await db.homeworks.createSubmission({ assignment_id: assignment.id, student_id: stu.id });
    }
    closeModal();
    toast(`ДЗ назначено ${students.length} ученикам`);
    await renderHomeworkPage();
    await updateHwBadge();
  } catch (err) {
    toast('Ошибка: ' + err.message);
  }
}

export async function changeHwStatus(submissionId, newStatus) {
  try {
    const { dbUpdate } = await import('../core/store.js');
    await dbUpdate('homework_submissions', submissionId, {
      status: newStatus,
      ...(newStatus === 'submitted' ? { submitted_at: new Date().toISOString() } : {}),
    });
    if (_hwTab === 'queue') await renderHwQueue();
    else await renderAllHw();
    await updateHwBadge();
    const labels = { assigned: 'Назначено', submitted: 'Сдано', checked: 'Проверено', overdue: 'Просрочено' };
    toast(`Статус: ${labels[newStatus] || newStatus}`);
  } catch (err) {
    toast('Ошибка: ' + err.message);
  }
}

export function renderStudentHwTab(studentId) {
  const subs = (CACHE.homework_submissions || []).filter(s => s.student_id === studentId)
    .sort((a, b) => (b.submitted_at || b.assigned_at || '').localeCompare(a.submitted_at || a.assigned_at || ''));

  const now = Date.now();
  const month30ago = now - 30 * 86400000;
  const recent = subs.filter(s => {
    const d = s.checked_at || s.submitted_at || s.assigned_at;
    return d && new Date(d).getTime() >= month30ago && s.score !== null;
  });
  const avgScore = recent.length ? Math.round(recent.reduce((acc, s) => acc + s.score, 0) / recent.length) : null;
  const { text: avgLabel, color: avgColor } = scoreLabel(avgScore);

  const statusCfg = {
    assigned: { label: 'Назначено', cls: 'b-gray' },
    submitted: { label: 'Сдано', cls: 'b-bl' },
    checked: { label: 'Проверено', cls: 'b-g' },
    overdue: { label: 'Просрочено', cls: 'b-r' },
  };

  if (!subs.length) return '<div style="font-size:12px;color:var(--hint);padding:8px 0">Нет заданий</div>';

  return `${avgScore !== null ? `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface2);border-radius:var(--r);margin-bottom:12px">
      <i class="ti ti-chart-bar" style="font-size:20px;color:${avgColor}"></i>
      <div>
        <div style="font-size:11px;color:var(--muted)">Средний балл за 30 дней</div>
        <div style="font-size:16px;font-weight:700;color:${avgColor}">${avgScore} / 100 <span style="font-size:12px;font-weight:400">${avgLabel}</span></div>
      </div>
    </div>` : ''}
  <div class="card" style="padding:0">
    <table class="tbl" style="font-size:12px">
      <thead><tr><th>Тема</th><th>Срок</th><th>Статус</th><th>Оценка</th><th>Ошибки</th></tr></thead>
      <tbody>
        ${subs.map(sub => {
          const assignment = (CACHE.homework_assignments || []).find(a => a.id === sub.assignment_id);
          const st = statusCfg[sub.status] || statusCfg.assigned;
          const overdue = isOverdue(assignment);
          const { text: scoreText, color: scoreColor } = scoreLabel(sub.score);
          return `<tr>
            <td>${assignment ? assignment.topic || '—' : '—'}</td>
            <td>${assignment?.due_date ? `<span style="color:${overdue && sub.status !== 'checked' ? 'var(--red)' : 'inherit'}">${fmtDate(assignment.due_date)}</span>` : '—'}</td>
            <td><span class="b ${st.cls}">${st.label}</span></td>
            <td style="color:${scoreColor};font-weight:600">${scoreText}</td>
            <td style="font-size:11px;color:var(--muted)">${(sub.errors || []).join(', ') || '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}
