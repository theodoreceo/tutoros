import { CACHE, ensureLoaded } from '../core/store.js';
import { db } from '../lib/db.js';
import { state, effectiveRole } from '../core/state.js';
import { uid, fmtDate, today, esc } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';
import { studentSubscriptionStatus } from '../core/risk.js';

let _hwTab = 'queue';
let _reviewMaxScore = 100;

function scoreDisplay(sub, assignment) {
  if (sub.score === null || sub.score === undefined) return { text: '—', color: 'var(--hint)' };
  const max = sub.max_score != null
    ? sub.max_score
    : (Array.isArray(assignment?.task_config) ? assignment.task_config.reduce((a, b) => a + b, 0) : 100);
  const pct = max > 0 ? sub.score / max : 0;
  const color = pct < 0.5 ? 'var(--red)' : pct < 0.75 ? 'var(--amber)' : pct < 0.9 ? 'var(--green)' : 'var(--accent-mid)';
  return { text: `${sub.score}/${max}`, color };
}

function sourceIcon(source) {
  const icons = { telegram: 'ti-brand-telegram', vk: 'ti-brand-vk', web: 'ti-globe', manual: 'ti-edit' };
  return icons[source] || 'ti-link';
}

function getMyAssistantId() {
  const role = effectiveRole();
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
  const statsEl = document.getElementById('hw-tab-stats');
  if (statsEl) statsEl.style.display = tab === 'stats' ? '' : 'none';
  if (tab === 'queue')        renderHwQueue();
  else if (tab === 'overdue') renderOverdueHw();
  else if (tab === 'stats')   renderHwStatsTab();
  else                        renderAllHw();
}

export async function renderHomeworkPage() {
  await ensureLoaded(['homework_assignments', 'homework_submissions', 'students', 'groups', 'lessons', 'assistant_groups']);
  await updateHwBadge();

  // Inject stats tab button if not already present
  const hwTabsContainer = document.querySelector('#pg-homework > div[style*="flex"]');
  if (hwTabsContainer && !document.querySelector('.hw-tab[data-tab="stats"]')) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm hw-tab';
    btn.dataset.tab = 'stats';
    btn.dataset.action = 'setHwTab';
    btn.innerHTML = '<i class="ti ti-chart-bar"></i> Статистика';
    hwTabsContainer.appendChild(btn);
  }

  // Inject stats tab container if not present
  if (!document.getElementById('hw-tab-stats')) {
    const div = document.createElement('div');
    div.id = 'hw-tab-stats';
    div.style.display = 'none';
    document.getElementById('pg-homework').appendChild(div);
  }

  if (_hwTab === 'queue')        await renderHwQueue();
  else if (_hwTab === 'overdue') await renderOverdueHw();
  else if (_hwTab === 'stats')   renderHwStatsTab();
  else                           await renderAllHw();
  document.getElementById('hw-tab-queue').style.display   = _hwTab === 'queue'   ? '' : 'none';
  document.getElementById('hw-tab-overdue').style.display = _hwTab === 'overdue' ? '' : 'none';
  document.getElementById('hw-tab-all').style.display     = _hwTab === 'all'     ? '' : 'none';
  const statsEl = document.getElementById('hw-tab-stats');
  if (statsEl) statsEl.style.display = _hwTab === 'stats' ? '' : 'none';
  // Sync active state on tab buttons
  document.querySelectorAll('.hw-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === _hwTab));
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
        <div style="font-size:13px;font-weight:600">${stu ? esc(stu.name) : '—'}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${assignment ? esc(assignment.topic) || '—' : '—'}</div>
        <div style="font-size:11px;color:var(--hint);margin-top:2px">
          Сдано: ${submittedAgo}
          ${overdue ? '<span class="b b-r" style="font-size:10px;margin-left:6px">просрочено</span>' : ''}
          ${sub.submission_url ? `<i class="ti ${sourceIcon(sub.source)}" style="margin-left:8px;font-size:12px;color:var(--accent-mid)"></i>` : ''}
        </div>
      </div>
      <button class="btn btn-sm btn-p" data-action="openReviewModal" data-id="${esc(sub.id)}"><i class="ti ti-pencil-check"></i> Проверить</button>
    </div>`;
  }).join('');
  el.innerHTML = rows;
}

async function renderOverdueHw() {
  const el = document.getElementById('hw-tab-overdue');
  if (!el) return;
  const role = effectiveRole();
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
  const role = effectiveRole();
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
            const { text: scoreText, color: scoreColor } = scoreDisplay(sub, assignment);
            return `<tr>
              <td><b>${stu ? esc(stu.name) : '—'}</b></td>
              <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${assignment ? esc(assignment.topic) || '—' : '—'}${assignment?.is_advanced ? ' <span class="b b-a" style="font-size:10px">Сложный</span>' : ''}</td>
              <td><span class="b ${ht.cls}">${ht.label}</span></td>
              <td>${assignment?.due_date ? `<span style="color:${overdue && sub.status !== 'checked' ? 'var(--red)' : 'inherit'}">${fmtDate(assignment.due_date)}${overdue && sub.status !== 'checked' ? ' <i class="ti ti-alert-circle" style="font-size:11px"></i>' : ''}</span>` : '—'}</td>
              <td><span class="b ${st.cls}">${st.label}</span></td>
              <td style="color:${scoreColor};font-weight:600">${scoreText}</td>
              <td style="font-size:12px;color:var(--muted)">${checker}</td>
              <td style="white-space:nowrap">
                ${assignment?.hw_type === 'brief' ? '' :
                  sub.status === 'submitted' ? `
                    <button class="btn btn-sm btn-p" data-action="openReviewModal" data-id="${esc(sub.id)}">Проверить</button>
                    <button class="btn btn-sm" data-action="changeHwStatus" data-id="${esc(sub.id)}" data-status="assigned" title="Вернуть"><i class="ti ti-rotate-left"></i></button>
                  ` : sub.status === 'checked' ? `
                    <button class="btn btn-sm" data-action="openReviewModal" data-id="${esc(sub.id)}"><i class="ti ti-edit"></i> Изменить</button>
                  ` : sub.status === 'assigned' || sub.status === 'overdue' ? `
                    <button class="btn btn-sm" data-action="changeHwStatus" data-id="${esc(sub.id)}" data-status="submitted"><i class="ti ti-upload"></i> Принять</button>
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

export async function renderHwStudentsPage() {
  const el = document.getElementById('hw-students-list');
  if (!el) return;

  const role = effectiveRole();
  const assistantId = role.isOwner ? null : role.id;

  let students = (CACHE.students || []).filter(s => ['active', 'trial'].includes(s.crm_status));

  if (!role.isOwner && assistantId) {
    const myGroups = await db.assistantGroups.getGroupsByAssistant(assistantId);
    const groupIds = new Set(myGroups.map(ag => ag.group_id));
    students = students.filter(s => groupIds.has(s.group_id));
  }

  if (!students.length) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px 20px;color:var(--hint)">
      <i class="ti ti-users" style="font-size:28px;display:block;margin-bottom:8px;opacity:.3"></i>
      Нет активных учеников
    </div>`;
    return;
  }

  const allSubs = CACHE.homework_submissions || [];
  const allAssignments = CACHE.homework_assignments || [];
  const allRoles = CACHE.roles || [];
  const allAssistantGroups = CACHE.assistant_groups || [];

  const rows = students.map(s => {
    const sub = studentSubscriptionStatus(s);
    const subBadge = sub
      ? (sub.daysLeft < 0
          ? `<span class="b b-r" style="font-size:10px">Просрочен</span>`
          : sub.daysLeft <= 7
            ? `<span class="b b-a" style="font-size:10px">через ${sub.daysLeft}д</span>`
            : `<span class="b b-g" style="font-size:10px">до ${fmtDate(sub.sub_end)}</span>`)
      : `<span class="b b-gray" style="font-size:10px">Нет абонемента</span>`;

    const mySubs = allSubs.filter(h => h.student_id === s.id);
    const totalHw = mySubs.length;
    const checkedHw = mySubs.filter(h => h.status === 'checked').length;
    const hwPct = totalHw > 0 ? Math.round(checkedHw / totalHw * 100) : null;
    const hwPctColor = hwPct === null ? 'var(--hint)' : hwPct >= 80 ? 'var(--green)' : hwPct >= 50 ? 'var(--amber)' : 'var(--red)';

    const trialSubs = mySubs.filter(h => {
      const a = allAssignments.find(x => x.id === h.assignment_id);
      return a?.hw_type === 'trial' && h.status === 'checked' && h.score != null;
    });
    let avgTrial = null;
    if (trialSubs.length) {
      const total = trialSubs.reduce((acc, h) => {
        const a = allAssignments.find(x => x.id === h.assignment_id);
        const max = h.max_score != null ? h.max_score : (Array.isArray(a?.task_config) ? a.task_config.reduce((x, y) => x + y, 0) : 100);
        return acc + (max > 0 ? h.score / max * 100 : 0);
      }, 0);
      avgTrial = Math.round(total / trialSubs.length);
    }

    const groupCurators = allAssistantGroups
      .filter(ag => ag.group_id === s.group_id)
      .map(ag => allRoles.find(r => r.id === ag.assistant_id)?.name)
      .filter(Boolean);

    return `<div class="card" style="padding:14px 16px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:160px">
          <div style="font-size:13px;font-weight:600;cursor:pointer;color:var(--fg)" data-action="openStudentDetail" data-id="${esc(s.id)}">${esc(s.name)}</div>
          <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${subBadge}</div>
        </div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:12px;color:var(--muted)">
          <div style="text-align:center">
            <div style="font-size:18px;font-weight:700;color:${hwPctColor}">${hwPct !== null ? hwPct + '%' : '—'}</div>
            <div style="font-size:11px;margin-top:2px">Выполнение ДЗ</div>
            ${totalHw ? `<div style="font-size:10px;color:var(--hint)">${checkedHw}/${totalHw}</div>` : ''}
          </div>
          <div style="text-align:center">
            <div style="font-size:18px;font-weight:700;color:${avgTrial !== null ? (avgTrial >= 80 ? 'var(--green)' : avgTrial >= 50 ? 'var(--amber)' : 'var(--red)') : 'var(--hint)'}">${avgTrial !== null ? avgTrial + '%' : '—'}</div>
            <div style="font-size:11px;margin-top:2px">Ср. балл пробников</div>
            ${trialSubs.length ? `<div style="font-size:10px;color:var(--hint)">${trialSubs.length} пр.</div>` : ''}
          </div>
          <div style="text-align:center;min-width:80px">
            <div style="font-size:12px;font-weight:600;color:var(--fg)">${groupCurators.length ? groupCurators.join(', ') : '—'}</div>
            <div style="font-size:11px;margin-top:2px;color:var(--muted)">Куратор</div>
          </div>
        </div>
      </div>
    </div>`;
  });

  el.innerHTML = rows.join('');
}

export async function openReviewModal(submissionId) {
  const sub = await db.homeworks.getSubmission(submissionId);
  if (!sub) { toast('Работа не найдена'); return; }
  const stu        = (CACHE.students || []).find(s => s.id === sub.student_id);
  const assignment = (CACHE.homework_assignments || []).find(a => a.id === sub.assignment_id);
  const taskConfig = Array.isArray(assignment?.task_config) && assignment.task_config.length
    ? assignment.task_config : null;
  _reviewMaxScore  = taskConfig ? taskConfig.reduce((a, b) => a + b, 0) : 100;

  const files = sub.submitted_files || [];
  const filesBlock = files.length
    ? `<div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">
          <i class="ti ti-files"></i> Файлы ученика (${files.length})
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start">
          ${files.map((f, i) => f.type === 'photo'
            ? `<a href="/api/tgfile?id=${f.file_id}" target="_blank" style="display:block;flex-shrink:0">
                 <img src="/api/tgfile?id=${f.file_id}"
                   style="max-height:130px;max-width:170px;border-radius:6px;border:1px solid var(--border);cursor:zoom-in;object-fit:cover;display:block"
                   onerror="this.parentElement.innerHTML='<span style=\\'font-size:11px;color:var(--muted)\\'>Фото ${i + 1} недоступно</span>'">
               </a>`
            : `<a href="/api/tgfile?id=${f.file_id}" target="_blank" class="btn btn-sm" style="text-decoration:none">
                 <i class="ti ti-file-type-pdf" style="color:#e74c3c"></i> Файл ${i + 1}
               </a>`
          ).join('')}
        </div>
       </div>`
    : '';

  const scoreBlock = taskConfig
    ? `<div class="fg" style="margin-bottom:12px">
        <label style="margin-bottom:8px;display:block">Баллы по заданиям</label>
        ${taskConfig.map((maxT, i) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:13px;min-width:90px;color:var(--muted)">Задание ${i + 1}</span>
            <input class="fi" type="number" id="rv-task-${i}" min="0" max="${maxT}" value="${(sub.task_scores || [])[i] ?? ''}" style="max-width:70px" oninput="updateTotalScore()">
            <span style="font-size:12px;color:var(--muted)">/ ${maxT}</span>
          </div>`).join('')}
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          <span style="font-size:13px;font-weight:600">Итого:</span>
          <input class="fi" type="number" id="rv-score" value="${sub.score ?? ''}" style="max-width:80px" readonly tabindex="-1">
          <span style="font-size:12px;color:var(--muted)">/ ${_reviewMaxScore}</span>
          <div style="flex:1"><div class="prog" style="height:8px"><div class="prog-f" id="rv-score-bar" style="width:0%;background:var(--accent-mid)"></div></div></div>
          <span id="rv-score-label" style="font-size:12px;font-weight:600;min-width:60px;text-align:right">${scoreDisplay(sub, assignment).text}</span>
        </div>
       </div>`
    : `<div class="fg" style="margin-bottom:12px">
        <label>Оценка <span style="color:var(--accent-mid);font-size:11px">0–${_reviewMaxScore}</span></label>
        <div style="display:flex;align-items:center;gap:10px">
          <input class="fi" type="number" id="rv-score" min="0" max="${_reviewMaxScore}" value="${sub.score ?? ''}" style="max-width:80px" oninput="updateScorePreview()">
          <div style="flex:1">
            <div class="prog" style="height:8px"><div class="prog-f" id="rv-score-bar" style="width:${sub.score != null ? Math.min(100, (sub.score / _reviewMaxScore) * 100) : 0}%;background:var(--accent-mid)"></div></div>
          </div>
          <span id="rv-score-label" style="font-size:12px;font-weight:600;min-width:80px;text-align:right">${scoreDisplay(sub, assignment).text}</span>
        </div>
       </div>`;

  modal(`<div class="modal" style="max-width:560px">
    <div class="modal-title"><i class="ti ti-pencil-check"></i> Проверка работы</div>
    <div class="card" style="padding:10px 14px;margin-bottom:14px;background:var(--surface2)">
      <div style="font-size:13px;font-weight:700">${stu ? esc(stu.name) : '—'}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${assignment ? esc(assignment.topic) || '—' : '—'}</div>
      ${assignment?.due_date ? `<div style="font-size:11px;color:var(--hint);margin-top:2px">Срок: ${fmtDate(assignment.due_date)}</div>` : ''}
    </div>
    ${filesBlock}
    ${scoreBlock}
    <div class="fg" style="margin-bottom:12px">
      <label>Комментарий</label>
      <textarea class="fi" id="rv-comment" rows="3" placeholder="Общий отзыв на работу...">${sub.comment || ''}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Отмена</button>
      <button class="btn btn-p" data-action="saveReview" data-id="${esc(submissionId)}">Сохранить проверку</button>
    </div>
  </div>`);
  updateScorePreview();
}

export function updateScorePreview() {
  const scoreEl = document.getElementById('rv-score');
  const bar     = document.getElementById('rv-score-bar');
  const label   = document.getElementById('rv-score-label');
  if (!bar || !label || !scoreEl) return;
  const score = parseFloat(scoreEl.value);
  const max   = _reviewMaxScore || 100;
  const pct   = isNaN(score) ? 0 : score / max;
  const color = pct < 0.5 ? 'var(--red)' : pct < 0.75 ? 'var(--amber)' : pct < 0.9 ? 'var(--green)' : 'var(--accent-mid)';
  bar.style.width      = `${Math.min(100, Math.max(0, isNaN(score) ? 0 : pct * 100))}%`;
  bar.style.background = isNaN(score) ? 'var(--hint)' : color;
  label.textContent    = isNaN(score) ? '—' : `${score}/${max}`;
  label.style.color    = isNaN(score) ? 'var(--hint)' : color;
}

export function updateTotalScore() {
  let i = 0, total = 0;
  while (true) {
    const el = document.getElementById(`rv-task-${i}`);
    if (!el) break;
    total += parseFloat(el.value) || 0;
    i++;
  }
  const scoreEl = document.getElementById('rv-score');
  if (scoreEl) scoreEl.value = total;
  updateScorePreview();
}

export async function saveReview(submissionId) {
  const comment   = (document.getElementById('rv-comment') || {}).value || '';
  const role      = state.currentRole || {};
  const checkedBy = role.id || null;

  // Collect per-task scores if present
  let score, taskScores, maxScore;
  const taskInputs = [];
  for (let i = 0; ; i++) {
    const el = document.getElementById(`rv-task-${i}`);
    if (!el) break;
    taskInputs.push(parseFloat(el.value) || 0);
  }
  if (taskInputs.length) {
    taskScores = taskInputs;
    score      = taskScores.reduce((a, b) => a + b, 0);
    maxScore   = _reviewMaxScore || null;
  } else {
    const raw = (document.getElementById('rv-score') || {}).value;
    score    = raw !== '' ? +raw : null;
    maxScore = _reviewMaxScore !== 100 ? _reviewMaxScore : null;
    taskScores = null;
  }

  try {
    await db.homeworks.saveReview(submissionId, { score, comment, checkedBy, taskScores, maxScore });

    // Notify student via Telegram (fire-and-forget)
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submission_id: submissionId }),
    }).catch(() => {});

    const sub        = await db.homeworks.getSubmission(submissionId);
    const stu        = (CACHE.students || []).find(s => s.id === sub?.student_id);
    const assignment = (CACHE.homework_assignments || []).find(a => a.id === sub?.assignment_id);
    const scoreStr   = score !== null ? ` · ${score}${maxScore ? '/' + maxScore : ''} баллов` : '';
    await addHistoryEntry('update', `Проверено ДЗ: ${stu?.name || '—'} · ${assignment?.topic || '—'}${scoreStr}`, 'homework', submissionId, null);
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
  const role = effectiveRole();
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
      <button class="btn" data-action="closeModal">Отмена</button>
      <button class="btn btn-p" data-action="saveNewHw"><i class="ti ti-check"></i> Создать</button>
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
    fetch('/api/notify-hw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignment_id: assignment.id }),
    }).catch(() => {});
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

function renderHwStatsTab() {
  const role = effectiveRole();
  const isCurator = role.role_type === 'curator';

  // Filter students to curator's groups if applicable
  let myGroupIds = null;
  if (isCurator && !role.isOwner) {
    const myAG = (CACHE.assistant_groups || []).filter(ag => ag.assistant_id === role.id);
    myGroupIds = myAG.length ? new Set(myAG.map(ag => ag.group_id)) : new Set();
  }

  const students = (CACHE.students || []).filter(s =>
    ['active', 'trial'].includes(s.crm_status) &&
    (!myGroupIds || myGroupIds.has(s.group_id))
  );

  const assignments = (CACHE.homework_assignments || []).filter(a =>
    !myGroupIds || myGroupIds.has(a.group_id)
  );

  const submissions = CACHE.homework_submissions || [];

  // Per student stats
  const stats = students.map(s => {
    const group = (CACHE.groups || []).find(g => g.id === s.group_id);
    const studentAssignments = assignments.filter(a => a.group_id === s.group_id);
    const total = studentAssignments.length;
    const submitted = submissions.filter(sub =>
      sub.student_id === s.id &&
      studentAssignments.some(a => a.id === sub.assignment_id) &&
      ['submitted', 'checked'].includes(sub.status)
    ).length;
    const overdue = submissions.filter(sub =>
      sub.student_id === s.id &&
      studentAssignments.some(a => a.id === sub.assignment_id) &&
      sub.status === 'overdue'
    ).length;
    const pct = total ? Math.round(submitted / total * 100) : null;
    return { s, group, total, submitted, overdue, pct };
  }).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)); // worst first, null last

  const el = document.getElementById('hw-tab-stats');
  if (!el) return;

  if (!stats.length) {
    el.innerHTML = '<div class="empty">Нет учеников</div>';
    return;
  }

  el.innerHTML = `
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">
      Ученики отсортированы по проценту сданных ДЗ — сначала те, кто сдаёт меньше всего.
    </div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="tbl">
        <thead>
          <tr>
            <th>Ученик</th>
            <th>Группа</th>
            <th>Сдано / Всего</th>
            <th>% выполнения</th>
            <th>Просрочено</th>
          </tr>
        </thead>
        <tbody>
          ${stats.map(({ s, group, total, submitted, overdue, pct }) => {
            const color = pct === null ? 'var(--muted)' : pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
            return `<tr>
              <td><span style="cursor:pointer;font-weight:600" data-action="openStudentDetail" data-id="${esc(s.id)}">${esc(s.name)}</span></td>
              <td style="color:var(--muted)">${group ? esc(group.name) : '—'}</td>
              <td>${submitted} / ${total}</td>
              <td>
                ${pct !== null ? `
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="flex:1;height:6px;background:var(--surface2);border-radius:3px;min-width:60px">
                      <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
                    </div>
                    <span style="font-size:12px;font-weight:700;color:${color};min-width:32px">${pct}%</span>
                  </div>
                ` : '<span style="color:var(--muted)">—</span>'}
              </td>
              <td style="color:${overdue > 0 ? 'var(--red)' : 'var(--muted)'};font-weight:${overdue > 0 ? '700' : '400'}">${overdue || '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
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
  const avgPct   = (avgScore ?? 0) / 100;
  const avgColor = avgScore == null ? 'var(--hint)' : avgPct < 0.5 ? 'var(--red)' : avgPct < 0.75 ? 'var(--amber)' : avgPct < 0.9 ? 'var(--green)' : 'var(--accent-mid)';

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
        <div style="font-size:16px;font-weight:700;color:${avgColor}">${avgScore} / 100</div>
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
          const { text: scoreText, color: scoreColor } = scoreDisplay(sub, assignment);
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
