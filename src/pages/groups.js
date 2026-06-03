import { CACHE, dbInsert, dbUpdate, dbDelete, ensureLoaded } from '../core/store.js';
import { state, effectiveRole } from '../core/state.js';
import { uid, fmt, fmtDate, fmtDateLong, today, g, STATUS_CONFIG, dateStr, esc } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';
import { addEvent } from '../core/events.js';
import { studentSubscriptionStatus, recalcRisk } from '../core/risk.js';

export async function renderGroups() {
  await ensureLoaded(['groups', 'students', 'lessons']);
  const el = document.getElementById('groups-list');
  if (!el) return;
  const role = effectiveRole();

  // Curators only see their assigned groups
  let groups = CACHE.groups || [];
  if (!role.isOwner) {
    const myGroupIds = new Set((CACHE.assistant_groups || []).filter(ag => ag.assistant_id === role.id).map(ag => ag.group_id));
    groups = groups.filter(g => myGroupIds.has(g.id));
  }
  if (!groups.length) { el.innerHTML = '<div class="empty">Групп нет или вам не назначены группы.</div>'; return; }

  el.innerHTML = groups.map(gr => {
    const members = (CACHE.students || []).filter(s => s.group_id === gr.id && s.crm_status === 'active');
    const allMembers = (CACHE.students || []).filter(s => s.group_id === gr.id);
    const lessons = (CACHE.lessons || []).filter(l => l.group_id === gr.id);
    const mrr = members.length * (gr.price_per_student || 0);
    const unpaid = members.filter(s => !s.paid).length;
    const lastLesson = [...lessons].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const fillPct = gr.capacity ? Math.round(members.length / gr.capacity * 100) : 0;
    return `<div class="card" style="cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor='var(--accent-mid)'" onmouseout="this.style.borderColor=''" data-action="openGroupDetail" data-id="${esc(gr.id)}">
      <div class="card-header" style="margin-bottom:10px">
        <div>
          <div style="font-size:14px;font-weight:600">${esc(gr.name)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px"><i class="ti ti-clock" style="font-size:11px"></i> ${gr.schedule || '—'}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center" onclick="event.stopPropagation()">
          ${unpaid ? `<span class="b b-r"><i class="ti ti-cash-off" style="font-size:10px"></i> ${unpaid} не оплат.</span>` : ''}
          ${role.isOwner ? `<span class="b b-g">${fmt(mrr)} ₽/мес</span>` : ''}
          ${role.isOwner ? `<button class="btn btn-sm btn-icon" data-action="editGroup" data-id="${esc(gr.id)}"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-icon" data-action="deleteGroup" data-id="${esc(gr.id)}"><i class="ti ti-trash" style="color:var(--red)"></i></button>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:16px;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;color:var(--muted);white-space:nowrap"><i class="ti ti-users" style="font-size:11px"></i> ${members.length} уч.</div>
        <div style="font-size:11px;color:var(--muted);white-space:nowrap"><i class="ti ti-notebook" style="font-size:11px"></i> ${lessons.length} зан.</div>
        ${lastLesson ? `<div style="font-size:11px;color:var(--muted);white-space:nowrap"><i class="ti ti-calendar" style="font-size:11px"></i> ${fmtDate(lastLesson.date)}</div>` : ''}
      </div>
      <div class="divider" style="margin:8px 0"></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${allMembers.length ? allMembers.slice(0, 6).map(s => {
      const st = STATUS_CONFIG[s.crm_status || 'lead'];
      return `<span class="b ${st.cls}" style="font-size:10px">${esc(s.name.split(' ')[0])}</span>`;
    }).join('') + (allMembers.length > 6 ? `<span class="b b-gray" style="font-size:10px">+${allMembers.length - 6}</span>` : '')
      : '<span style="font-size:12px;color:var(--hint)">Нет учеников</span>'}
      </div>
    </div>`;
  }).join('');
}

export function openGroupModal(id) {
  const gr = id ? (CACHE.groups || []).find(x => x.id === id) : null;
  const v = gr || { name: '', schedule: '', price_per_student: 2000, capacity: 8 };
  modal(`<div class="modal"><div class="modal-title">${gr ? 'Редактировать' : 'Новая группа'}</div>
    <div class="form-row"><div class="fg" style="grid-column:1/-1"><label>Название</label><input class="fi" id="gf-name" value="${esc(v.name)}" placeholder="ЕГЭ Математика — группа А"></div></div>
    <div class="form-row">
      <div class="fg"><label>Расписание</label><input class="fi" id="gf-schedule" value="${esc(v.schedule || '')}" placeholder="Вт/Пт 17:00"></div>
      <div class="fg"><label>Цена ₽/уч/ч</label><input class="fi" type="number" id="gf-price" value="${v.price_per_student}"></div>
      <div class="fg"><label>Макс. учеников</label><input class="fi" type="number" id="gf-cap" value="${v.capacity}"></div>
    </div>
    <div class="modal-footer"><button class="btn" data-action="closeModal">Отмена</button><button class="btn btn-p" data-action="saveGroup" data-id="${esc(id || '')}">Сохранить</button></div>
  </div>`);
}

export function editGroup(id) { openGroupModal(id); }

export async function saveGroup(id) {
  const obj = { id: id || uid(), name: g('gf-name'), schedule: g('gf-schedule'), price_per_student: +g('gf-price'), capacity: +g('gf-cap'), type: 'group' };
  if (!obj.name) { toast('Введите название'); return; }
  try {
    if (id) await dbUpdate('groups', id, obj); else await dbInsert('groups', obj);
    closeModal(); renderGroups(); toast('Сохранено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export async function deleteGroup(id) {
  if (!confirm('Удалить группу?')) return;
  try {
    await dbDelete('groups', id);
    renderGroups(); toast('Удалено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export function openGroupDetail(id) {
  state.currentGroupId = id;
  document.getElementById('groups-list-view').style.display = 'none';
  document.getElementById('group-detail-view').style.display = 'block';
  renderGroupDetail();
}

export function closeGroupDetail() {
  state.currentGroupId = null;
  document.getElementById('groups-list-view').style.display = 'block';
  document.getElementById('group-detail-view').style.display = 'none';
  renderGroups();
}

export function renderGroupDetail() {
  const gr = (CACHE.groups || []).find(x => x.id === state.currentGroupId);
  if (!gr) { closeGroupDetail(); return; }
  const titleEl = document.getElementById('gd-title');
  if (titleEl) titleEl.textContent = gr.name;
  const editBtn = document.getElementById('gd-edit-btn');
  if (editBtn) editBtn.onclick = () => editGroup(gr.id);

  const members = (CACHE.students || []).filter(s => s.group_id === gr.id);
  const active = members.filter(s => s.crm_status === 'active');
  const lessons = (CACHE.lessons || []).filter(l => l.group_id === gr.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const mrr = active.length * (gr.price_per_student || 0);

  const totalAttendSlots = lessons.length * active.length;
  const totalAbsent = lessons.reduce((s, l) => s + (l.student_attendance || []).filter(a => !a.present).length, 0);
  const attendPct = totalAttendSlots > 0 ? Math.round((1 - totalAbsent / totalAttendSlots) * 100) : 100;

  const allHw = (CACHE.hw_submissions || []).filter(h => h.group_id === gr.id);
  const hwDone = allHw.filter(h => h.status === 'done').length;
  const hwMissing = allHw.filter(h => h.status === 'missing').length;
  const hwTotal = allHw.length;
  const hwPct = hwTotal ? Math.round(hwDone / hwTotal * 100) : null;

  const role = effectiveRole();
  const metricsEl = document.getElementById('gd-metrics');
  if (metricsEl) metricsEl.innerHTML = `
    <div class="met"><div class="met-label">Учеников</div><div class="met-val">${active.length}<span style="font-size:13px;color:var(--muted)">/${gr.capacity || '∞'}</span></div><div class="met-sub">${gr.schedule || '—'}</div></div>
    ${role.isOwner ? `<div class="met"><div class="met-label">Выручка / мес</div><div class="met-val">${fmt(mrr)} ₽</div><div class="met-sub">${fmt(gr.price_per_student || 0)} ₽/уч</div></div>` : ''}
    <div class="met"><div class="met-label">Занятий</div><div class="met-val">${lessons.length}</div><div class="met-sub">${lessons[0] ? 'последнее ' + fmtDate(lessons[0].date) : 'ещё не было'}</div></div>
    <div class="met"><div class="met-label">Посещаемость</div><div class="met-val" style="color:${attendPct >= 85 ? 'var(--green)' : attendPct >= 70 ? 'var(--amber)' : 'var(--red)'}">${attendPct}%</div><div class="met-sub">по активным ученикам</div></div>
    ${hwTotal ? `<div class="met"><div class="met-label">Домашка</div><div class="met-val" style="color:${hwPct >= 80 ? 'var(--green)' : hwPct >= 50 ? 'var(--amber)' : 'var(--red)'}">${hwPct}%</div><div class="met-sub">${hwMissing > 0 ? `${hwMissing} не сдано` : 'все сдали'}</div></div>` : ''}`;
  const canEdit = role.canEdit || role.isOwner;
  const membersEl = document.getElementById('gd-members');
  if (membersEl) membersEl.innerHTML = members.length ? members.map(s => {
    const st = STATUS_CONFIG[s.crm_status || 'lead'];
    const sub = studentSubscriptionStatus(s);
    const absCount = lessons.filter(l => (l.student_attendance || []).some(a => a.student_id === s.id && !a.present)).length;
    const attendPctS = lessons.length > 0 ? Math.round((1 - absCount / lessons.length) * 100) : null;
    const subBadge = sub ? (sub.daysLeft < 0 ? `<span class="b b-r" style="font-size:10px">Просрочен</span>` : (sub.daysLeft <= 7 ? `<span class="b b-a" style="font-size:10px">через ${sub.daysLeft}д</span>` : `<span class="b b-g" style="font-size:10px">до ${fmtDate(sub.sub_end)}</span>`)) : `<span class="b b-gray" style="font-size:10px">—</span>`;
    const warnFlag = absCount >= 2 && lessons.length >= 2 ? `<span title="${absCount} пропусков" style="color:var(--red);font-size:12px"><i class="ti ti-alert-triangle"></i></span>` : '';
    const hwS = (CACHE.hw_submissions || []).filter(h => h.student_id === s.id && h.group_id === gr.id);
    const hwMissingS = hwS.filter(h => h.status === 'missing').length;
    const hwPendingS = hwS.filter(h => h.status === 'pending').length;
    const hwBadge = hwMissingS > 0 ? `<span class="b b-r" style="font-size:10px"><i class="ti ti-home-off" style="font-size:9px"></i> ${hwMissingS} не сдал</span>`
      : hwPendingS > 0 ? `<span class="b b-a" style="font-size:10px"><i class="ti ti-clock" style="font-size:9px"></i> ждём ДЗ</span>` : '';
    return `<div class="card" style="padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
          <span class="b ${st.cls}" style="font-size:10px;padding:1px 6px;flex-shrink:0">${st.label}</span>
          <span style="font-size:13px;font-weight:600;cursor:pointer" data-action="openStudentDetail" data-id="${esc(s.id)}">${esc(s.name)}</span>
          ${warnFlag}
        </div>
        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">${subBadge}${!s.paid ? `<span class="b b-r" style="font-size:10px">Не оплачен</span>` : ''}${hwBadge}</div>
      </div>
      ${attendPctS !== null ? `<div style="text-align:right;flex-shrink:0">
        <div style="font-size:13px;color:${attendPctS >= 85 ? 'var(--green)' : attendPctS >= 70 ? 'var(--amber)' : 'var(--red)'};font-weight:700">${attendPctS}%</div>
        <div class="attend-bar" style="margin-top:3px"><div class="attend-fill" style="width:${attendPctS}%;background:${attendPctS >= 85 ? '#22c55e' : attendPctS >= 70 ? '#f59e0b' : '#ef4444'}"></div></div>
        <div style="font-size:10px;color:var(--hint);margin-top:2px">${absCount} пр.</div>
      </div>` : ''}
    </div>`;
  }).join('') : '<div class="empty" style="padding:12px">Нет учеников в группе</div>';

  renderLessonJournal(lessons);
}

export function renderLessonJournal(lessons) {
  const el = document.getElementById('gd-journal');
  if (!el) return;
  if (!lessons || !lessons.length) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px 20px;color:var(--hint)"><i class="ti ti-notebook" style="font-size:28px;display:block;margin-bottom:8px;opacity:.3"></i>Занятий пока нет.<br><span style="font-size:12px">Добавьте первое занятие.</span></div>`;
    return;
  }
  const role = effectiveRole();
  const canEdit = role.canEdit || role.isOwner;
  el.innerHTML = lessons.map(l => {
    const absentNames = (l.student_attendance || []).filter(a => !a.present).map(a => {
      const s = (CACHE.students || []).find(x => x.id === a.student_id);
      return s ? esc(s.name.split(' ')[0]) : '?';
    });
    const diffMap = { easy: 'chip-easy', medium: 'chip-medium', hard: 'chip-hard' };
    const diffLabel = { easy: '😊 Лёгкое', medium: '🤔 Среднее', hard: '🔥 Сложное' };
    const moodMap = { good: 'chip-mood-good', neutral: 'chip-mood-neutral', bad: 'chip-mood-bad' };
    const moodLabel = { good: '👍 Хорошо', neutral: '😐 Нейтр.', bad: '👎 Плохо' };

    let hwBlock = '';
    if (l.hw === 'assigned') {
      const hwSubs = (CACHE.hw_submissions || []).filter(h => h.lesson_id === l.id);
      const mems = (CACHE.students || []).filter(s => s.group_id === l.group_id && s.crm_status === 'active');
      if (mems.length) {
        const hwRows = mems.map(s => {
          const sub = hwSubs.find(h => h.student_id === s.id);
          const status = sub ? sub.status : 'none';
          const statusMap = { done: '✅', missing: '❌', pending: '⏳', none: '—' };
          const colorMap = { done: 'var(--green)', missing: 'var(--red)', pending: 'var(--amber)', none: 'var(--hint)' };
          return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
            <span style="flex:1;font-size:12px">${s.name.split(' ')[0]}</span>
            ${canEdit ? `
              <button class="btn btn-sm" style="font-size:10px;padding:2px 6px;${status === 'done' ? 'background:var(--green-bg);color:var(--green);' : 'opacity:.5'}" data-action="setGroupHwStatus" data-id="${esc(l.id)}" data-group-id="${esc(l.group_id)}" data-student-id="${esc(s.id)}" data-status="done">✅ Сдал</button>
              <button class="btn btn-sm" style="font-size:10px;padding:2px 6px;${status === 'missing' ? 'background:var(--red-bg);color:var(--red);' : 'opacity:.5'}" data-action="setGroupHwStatus" data-id="${esc(l.id)}" data-group-id="${esc(l.group_id)}" data-student-id="${esc(s.id)}" data-status="missing">❌ Не сдал</button>
              <button class="btn btn-sm" style="font-size:10px;padding:2px 6px;${status === 'pending' ? 'background:var(--amber-bg);color:var(--amber);' : 'opacity:.5'}" data-action="setGroupHwStatus" data-id="${esc(l.id)}" data-group-id="${esc(l.group_id)}" data-student-id="${esc(s.id)}" data-status="pending">⏳ Ждём</button>
            ` : `<span style="font-size:13px;color:${colorMap[status]}">${statusMap[status]}</span>`}
          </div>`;
        }).join('');
        const doneCount = hwSubs.filter(h => h.status === 'done').length;
        const missingCount = hwSubs.filter(h => h.status === 'missing').length;
        hwBlock = `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
          <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;gap:6px">
            <i class="ti ti-home-check"></i> Домашка
            <span style="font-weight:400">${doneCount} сдали · ${missingCount} нет · ${mems.length - doneCount - missingCount} ждём</span>
          </div>
          ${hwRows}
        </div>`;
      }
    }

    return `<div class="lesson-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div class="lesson-date">${fmtDateLong(l.date)}</div>
          <div class="lesson-topic">${esc(l.topic || 'Без темы')}</div>
        </div>
        ${canEdit ? `<div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">
          <button class="btn btn-sm btn-icon" data-action="openLessonModal" data-id="${esc(l.id)}"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-icon" data-action="deleteLesson" data-id="${esc(l.id)}"><i class="ti ti-trash" style="color:var(--red)"></i></button>
        </div>` : ''}
      </div>
      <div class="lesson-chips">
        ${l.difficulty ? `<span class="lesson-chip-tag ${diffMap[l.difficulty] || ''}">${diffLabel[l.difficulty] || l.difficulty}</span>` : ''}
        ${l.mood ? `<span class="lesson-chip-tag ${moodMap[l.mood] || ''}">${moodLabel[l.mood] || l.mood}</span>` : ''}
        ${l.hw === 'assigned' ? `<span class="lesson-chip-tag chip-hw"><i class="ti ti-home" style="font-size:10px"></i> ДЗ дано</span>` : ''}
      </div>
      <div class="lesson-meta">
        ${absentNames.length ? absentNames.map(n => `<span class="absent-chip"><i class="ti ti-user-off"></i> ${n}</span>`).join('') : ''}
      </div>
      ${l.notes ? `<div style="margin-top:8px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:8px"><i class="ti ti-notes" style="font-size:11px"></i> ${esc(l.notes)}</div>` : ''}
      ${hwBlock}
    </div>`;
  }).join('');
}

export function openLessonModal(id) {
  const l = id ? (CACHE.lessons || []).find(x => x.id === id) : null;
  const gr = (CACHE.groups || []).find(x => x.id === state.currentGroupId);
  if (!gr) { toast('Группа не выбрана'); return; }
  const members = (CACHE.students || []).filter(s => s.group_id === state.currentGroupId);
  const todayStr = today();
  const v = l || { date: todayStr, topic: '', absent_ids: [], notes: '' };
  const memberChecks = members.length ? members.map(s => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--r);cursor:pointer;font-size:13px;background:var(--surface)">
      <input type="checkbox" class="absent-check" data-id="${s.id}" ${(v.absent_ids || []).includes(s.id) ? 'checked' : ''} style="accent-color:var(--red)">
      ${esc(s.name)}
    </label>`).join('') : '<div style="color:var(--hint);font-size:13px">В группе нет учеников</div>';
  modal(`<div class="modal" style="max-width:600px"><div class="modal-title">${l ? 'Редактировать занятие' : 'Добавить занятие'}</div>
    <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:4px">Группа: ${esc(gr.name)}</div>
    <div class="form-row">
      <div class="fg"><label>Дата занятия</label><input class="fi" type="date" id="lf-date" value="${v.date}"></div>
      <div class="fg" style="grid-column:1/-1"><label>Тема занятия</label><input class="fi" id="lf-topic" value="${esc(v.topic || '')}" placeholder="Тригонометрия: формулы приведения"></div>
    </div>
    <div class="fg" style="margin-bottom:12px">
      <label style="margin-bottom:6px;display:flex;align-items:center;gap:4px"><i class="ti ti-user-off" style="color:var(--red)"></i> Отсутствующие</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--surface2);border-radius:8px;padding:10px 12px">${memberChecks}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="fg">
        <label style="margin-bottom:6px;display:block"><i class="ti ti-chart-bar" style="font-size:11px"></i> Сложность</label>
        <div class="chip-row">
          <span class="chip diff-easy ${v.difficulty === 'easy' ? 'active' : ''}" data-action="selectChip" data-field="lf-difficulty" data-value="easy">😊 Лёгкое</span>
          <span class="chip diff-medium${v.difficulty === 'medium' ? 'active' : ''}" data-action="selectChip" data-field="lf-difficulty" data-value="medium">🤔 Среднее</span>
          <span class="chip diff-hard ${v.difficulty === 'hard' ? 'active' : ''}" data-action="selectChip" data-field="lf-difficulty" data-value="hard">🔥 Сложное</span>
        </div>
        <input type="hidden" id="lf-difficulty" value="${v.difficulty || 'medium'}">
      </div>
      <div class="fg">
        <label style="margin-bottom:6px;display:block"><i class="ti ti-mood-smile" style="font-size:11px"></i> Настроение</label>
        <div class="chip-row">
          <span class="chip mood-good ${v.mood === 'good' ? 'active' : ''}" data-action="selectChip" data-field="lf-mood" data-value="good">👍 Хорошо</span>
          <span class="chip mood-neutral${v.mood === 'neutral' ? 'active' : ''}" data-action="selectChip" data-field="lf-mood" data-value="neutral">😐 Нейтр.</span>
          <span class="chip mood-bad ${v.mood === 'bad' ? 'active' : ''}" data-action="selectChip" data-field="lf-mood" data-value="bad">👎 Плохо</span>
        </div>
        <input type="hidden" id="lf-mood" value="${v.mood || 'neutral'}">
      </div>
      <div class="fg">
        <label style="margin-bottom:6px;display:block"><i class="ti ti-home" style="font-size:11px"></i> Домашка</label>
        <div class="chip-row">
          <span class="chip hw-yes${v.hw === 'assigned' ? 'active' : ''}" data-action="selectChip" data-field="lf-hw" data-value="assigned">✅ Дана</span>
          <span class="chip hw-no ${v.hw === 'not_assigned' ? 'active' : ''}" data-action="selectChip" data-field="lf-hw" data-value="not_assigned">— Не дана</span>
        </div>
        <input type="hidden" id="lf-hw" value="${v.hw || 'assigned'}">
      </div>
    </div>
    <div class="fg"><label>Заметка <span style="font-size:11px;color:var(--hint);font-weight:400">(необязательно)</span></label><textarea class="fi" id="lf-notes" placeholder="Что разобрали, кому что объяснить...">${esc(v.notes || '')}</textarea></div>
    <div class="modal-footer"><button class="btn" data-action="closeModal">Отмена</button><button class="btn btn-p" data-action="saveLesson" data-id="${esc(id || '')}">Сохранить</button></div>
  </div>`);
}

export async function saveLesson(id) {
  const absent_ids = [...document.querySelectorAll('.absent-check:checked')].map(el => el.dataset.id);
  const difficulty = (document.getElementById('lf-difficulty') || {}).value || 'medium';
  const mood = (document.getElementById('lf-mood') || {}).value || 'neutral';
  const hw = (document.getElementById('lf-hw') || {}).value || 'assigned';
  const obj = { id: id || uid(), group_id: state.currentGroupId, date: g('lf-date'), topic: g('lf-topic'), absent_ids, difficulty, mood, hw, notes: g('lf-notes'), created_at: new Date().toISOString() };
  if (!obj.date) { toast('Укажите дату'); return; }
  if (!obj.topic) { toast('Укажите тему'); return; }
  try {
    if (id) await dbUpdate('lessons', id, obj);
    else {
      await dbInsert('lessons', obj);
      for (const sid of absent_ids) await addEvent('student', sid, 'lesson_absent', { lesson_id: obj.id, topic: obj.topic });
      const mems = (CACHE.students || []).filter(s => s.group_id === state.currentGroupId && s.crm_status === 'active');
      for (const s of mems) await recalcRisk(s);
    }
    closeModal(); renderGroupDetail(); toast('Занятие сохранено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export async function deleteLesson(id) {
  if (!confirm('Удалить запись о занятии?')) return;
  try {
    const l = (CACHE.lessons || []).find(x => x.id === id);
    await dbDelete('lessons', id);
    await addHistoryEntry('delete', `Удалено занятие: ${l?.topic || '—'} · ${l?.date || ''}`, 'lesson', id, { table: 'lessons', action: 'delete', record_id: id, old_data: l });
    renderGroupDetail();
    toast('Удалено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export async function setGroupHwStatus(lessonId, groupId, studentId, status) {
  const existing = (CACHE.hw_submissions || []).find(h => h.lesson_id === lessonId && h.student_id === studentId);
  if (existing) {
    await dbUpdate('hw_submissions', existing.id, { status, checked_at: new Date().toISOString() });
  } else {
    const obj = { id: uid(), lesson_id: lessonId, group_id: groupId, student_id: studentId, assigned_at: new Date().toISOString(), status, checked_at: new Date().toISOString() };
    await dbInsert('hw_submissions', obj);
  }
  if (status === 'missing') {
    const lesson = (CACHE.lessons || []).find(l => l.id === lessonId);
    await addEvent('student', studentId, 'homework_missing', { lesson_id: lessonId, topic: lesson?.topic || '' });
    const s = (CACHE.students || []).find(x => x.id === studentId);
    if (s) await recalcRisk(s);
  }
  renderGroupDetail();
  toast('Статус ДЗ сохранён');
}
