import { CACHE, dbInsert, dbUpdate, dbDelete, ensureLoaded } from '../core/store.js';
import { state, effectiveRole } from '../core/state.js';
import { uid, fmt, fmtDate, today, dateStr, g, GROUP_COLORS, esc } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';
import { addEvent } from '../core/events.js';
import { recalcRisk } from '../core/risk.js';

function _getCuratorGroupIds(role) {
  if (!role || role.isOwner || role.role_type !== 'curator') return null;
  const myAG = (CACHE.assistant_groups || []).filter(ag => ag.assistant_id === role.id);
  return myAG.length ? new Set(myAG.map(ag => ag.group_id)) : null;
}

let _calView = 'week';
let _calDate = new Date();
const _hwBtnStates = {};
let _pendingGroupIds = [];

function groupColor(gid) {
  const idx = (CACHE.groups || []).findIndex(g => g.id === gid);
  return GROUP_COLORS[idx % GROUP_COLORS.length] || '#64748b';
}

function roleColor(ledBy) {
  if (!ledBy) return null;
  if (ledBy === 'owner') return '#2563eb';
  return (CACHE.roles || []).find(r => r.id === ledBy)?.color || null;
}

function roleName(ledBy) {
  if (!ledBy) return '';
  if (ledBy === 'owner') return 'Владелец';
  return (CACHE.roles || []).find(r => r.id === ledBy)?.name || '';
}

export function setCalView(v) {
  _calView = v;
  document.querySelectorAll('#cal-view-toggle button').forEach((b, i) => b.classList.toggle('on', ['week', 'month'][i] === v));
  renderCalendar();
}

export function calNav(dir) {
  if (_calView === 'week') _calDate = new Date(_calDate.getTime() + dir * 7 * 86400000);
  else { _calDate = new Date(_calDate); _calDate.setMonth(_calDate.getMonth() + dir); }
  renderCalendar();
}

export function calToday() { _calDate = new Date(); renderCalendar(); }

function getWeekDays(anchor) {
  const d = new Date(anchor);
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() - dow + 1);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return x; });
}

function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

function _timeToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function _assignColumns(lessons) {
  if (!lessons.length) return { colOf: {}, totalOf: {} };
  const sorted = [...lessons].sort((a, b) => _timeToMin(a.start_time) - _timeToMin(b.start_time));
  const colOf = {};
  const colEnd = [];
  for (const l of sorted) {
    const s = _timeToMin(l.start_time);
    const e = s + (l.duration || 60);
    let c = colEnd.findIndex(end => end <= s);
    if (c === -1) c = colEnd.length;
    colOf[l.id] = c;
    colEnd[c] = e;
  }
  const totalOf = {};
  for (const l of sorted) {
    const s = _timeToMin(l.start_time);
    const e = s + (l.duration || 60);
    const overlapping = sorted.filter(o => o.id !== l.id && _timeToMin(o.start_time) < e && (_timeToMin(o.start_time) + (o.duration || 60)) > s);
    totalOf[l.id] = Math.max(colOf[l.id], ...overlapping.map(o => colOf[o.id]), 0) + 1;
  }
  return { colOf, totalOf };
}

function _setupDragCreate(container, CAL_START, HOUR_PX, role) {
  const body = container.querySelector('.cal-body');
  if (!body) return;

  let _active = false, _ghost = null, _startMin = 0, _colDate = '';

  body.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const col = e.target.closest('.cal-day-col');
    if (!col) return;
    if (e.target.closest('[data-action]')) return;
    _colDate = col.dataset.id || '';
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top + body.scrollTop;
    _startMin = Math.round(y / HOUR_PX * 60 / 15) * 15;
    _active = true;

    _ghost = document.createElement('div');
    _ghost.style.cssText = `position:absolute;top:${_startMin/60*HOUR_PX}px;height:${HOUR_PX}px;left:2px;right:2px;background:var(--accent-mid);opacity:.25;border-radius:6px;pointer-events:none;z-index:50;border-left:3px solid var(--accent-mid);`;
    col.style.position = 'relative';
    col.appendChild(_ghost);
    e.preventDefault();
  });

  body.addEventListener('mousemove', (e) => {
    if (!_active || !_ghost) return;
    const col = _ghost.parentElement;
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top + body.scrollTop;
    const endMin = Math.max(_startMin + 15, Math.round(y / HOUR_PX * 60 / 15) * 15);
    _ghost.style.top = `${_startMin / 60 * HOUR_PX}px`;
    _ghost.style.height = `${Math.max(HOUR_PX / 4, (endMin - _startMin) / 60 * HOUR_PX)}px`;
  });

  const _finish = (e) => {
    if (!_active) return;
    _active = false;
    if (!_ghost) return;
    const col = _ghost.parentElement;
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top + body.scrollTop;
    const endMin = Math.max(_startMin + 15, Math.round(y / HOUR_PX * 60 / 15) * 15);
    const durationMin = endMin - _startMin;
    _ghost.remove(); _ghost = null;

    if (durationMin < 10) return;

    const totalStart = CAL_START * 60 + _startMin;
    const hh = String(Math.floor(totalStart / 60)).padStart(2, '0');
    const mm = String(totalStart % 60).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    if (role.role_type === 'marketer') {
      openTrialLessonModal(_colDate);
      setTimeout(() => {
        const ti = document.getElementById('tl-time');
        const du = document.getElementById('tl-dur');
        if (ti) ti.value = timeStr;
        if (du) {
          const opts = [45, 60, 90, 120];
          const closest = opts.reduce((a, b) => Math.abs(b - durationMin) < Math.abs(a - durationMin) ? b : a);
          du.value = closest;
        }
      }, 50);
    } else {
      openLessonFromCalendar(_colDate);
      setTimeout(() => {
        const ti = document.getElementById('lf-time');
        const du = document.getElementById('lf-dur');
        if (ti) ti.value = timeStr;
        if (du) {
          const opts = [45, 60, 90, 120];
          const closest = opts.reduce((a, b) => Math.abs(b - durationMin) < Math.abs(a - durationMin) ? b : a);
          du.value = closest;
        }
      }, 300);
    }
  };

  body.addEventListener('mouseup', _finish);
  document.addEventListener('mouseup', _finish);
}

export async function renderCalendar() {
  await ensureLoaded(['lessons', 'groups', 'students']);
  const role = effectiveRole();
  const myGroupIds = _getCuratorGroupIds(role);
  const isMarketer = role.role_type === 'marketer';
  const el = document.getElementById('cal-container');
  if (!el) return;
  const now = new Date();
  const RU_DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const RU_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const CAL_START = 8, CAL_END = 22, HOUR_PX = 60;
  const totalH = (CAL_END - CAL_START) * HOUR_PX;

  function lessonIsPast(l) {
    const [h, m] = (l.start_time || '00:00').split(':').map(Number);
    const dt = new Date(l.date + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
    return dt < now;
  }
  function lessonTop(l) {
    const [h, m] = (l.start_time || '09:00').split(':').map(Number);
    return ((h - CAL_START) * 60 + m) * HOUR_PX / 60;
  }
  function lessonHeight(l) { return Math.max(30, (l.duration || 60) * HOUR_PX / 60); }

  if (_calView === 'week') {
    const days = getWeekDays(_calDate);
    const [mon, sun] = [days[0], days[6]];
    const labelEl = document.getElementById('cal-label');
    if (labelEl) labelEl.textContent = `${mon.getDate()} — ${sun.getDate()} ${RU_MONTHS[sun.getMonth()]} ${sun.getFullYear()}`;

    const timeSlots = Array.from({ length: CAL_END - CAL_START }, (_, i) => `<div class="cal-time-slot">${String(i + CAL_START).padStart(2, '0')}:00</div>`).join('');

    const dayCols = days.map(day => {
      const ds = dateStr(day);
      const dayLessons = (CACHE.lessons || []).filter(l => l.date === ds && (!myGroupIds || myGroupIds.has(l.group_id)) && (!isMarketer || l.lesson_type === 'trial'));
      const { colOf, totalOf } = _assignColumns(dayLessons);
      const isToday = isSameDay(day, now);
      let nowLine = '';
      if (isToday) {
        const nowMin = (now.getHours() - CAL_START) * 60 + now.getMinutes();
        if (nowMin >= 0 && nowMin <= (CAL_END - CAL_START) * 60) {
          const top = nowMin * HOUR_PX / 60;
          nowLine = `<div class="cal-now-line" style="top:${top}px"><div class="cal-now-dot"></div></div>`;
        }
      }
      const hourLines = Array.from({ length: CAL_END - CAL_START }, () => `<div class="cal-hour-line"></div>`).join('');
      const halfLines = Array.from({ length: CAL_END - CAL_START }, (_, i) => `<div class="cal-half-line" style="top:${(i + 0.5) * HOUR_PX}px"></div>`).join('');
      const eventBlocks = dayLessons.map(l => {
        const gc = roleColor(l.led_by) || groupColor(l.group_id);
        const gr = (CACHE.groups || []).find(g => g.id === l.group_id);
        const top = lessonTop(l);
        const h = lessonHeight(l);
        const past = lessonIsPast(l);
        const endMin = lessonTop(l) / (HOUR_PX / 60) + (l.duration || 60);
        const endH = Math.floor(endMin / 60) + CAL_START;
        const endM = endMin % 60;
        const timeStr = `${l.start_time || '?'} – ${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
        const rName = roleName(l.led_by);
        const isConsult = l.lesson_type === 'consultation';
        const isTrial  = l.lesson_type === 'trial';
        const evColor  = isTrial ? '#16a34a' : isConsult ? '#7c3aed' : gc;
        const evBorder = isTrial ? 'solid' : isConsult ? 'dashed' : 'solid';
        const trialLeads = isTrial ? (l.student_attendance || []) : [];
        const trialSub   = isTrial
          ? (trialLeads.length ? trialLeads.map(a => esc(a.name || '')).join(', ') : 'Без лидов')
          : (gr ? esc(gr.name).slice(0, 14) : '');
        const _col = colOf[l.id] || 0;
        const _tot = totalOf[l.id] || 1;
        const _left = (_col / _tot * 100).toFixed(1);
        const _wid  = (1 / _tot * 100).toFixed(1);
        return `<div class="cal-event${past ? ' past' : ''}${isConsult ? ' consult' : ''}" style="top:${top}px;height:${h}px;left:${_left}%;width:${_wid}%;background:${evColor}18;color:${evColor};border-left-color:${evColor};border-left-style:${evBorder}" data-action="openLessonCard" data-id="${esc(l.id)}" onclick="event.stopPropagation()">
          <div class="cal-event-title">${isTrial ? '<i class="ti ti-user-check" style="font-size:9px"></i> ' : ''}${esc(l.topic) || 'Занятие'}</div>
          <div class="cal-event-time">${timeStr} · ${trialSub}</div>
          ${!isTrial && rName ? `<div style="font-size:9px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px"><i class="ti ti-user-check" style="font-size:8px"></i> ${rName}</div>` : ''}
          ${past ? `<div class="cal-event-past">✓ прошло</div>` : ''}
        </div>`;
      }).join('');
      return `<div class="cal-day-col" data-action="openLessonFromCalendar" data-id="${esc(ds)}">
        ${hourLines}${halfLines}${nowLine}${eventBlocks}
      </div>`;
    }).join('');

    const header = `<div class="cal-header-row week">
      <div class="cal-header-cell" style="border-bottom:none"></div>
      ${days.map(day => {
      const isToday = isSameDay(day, now);
      return `<div class="cal-header-cell${isToday ? ' today' : ''}">
          <div class="cal-hday">${RU_DAYS[day.getDay() === 0 ? 6 : day.getDay() - 1]}</div>
          <div class="cal-hdate">${day.getDate()}</div>
        </div>`;
    }).join('')}
    </div>`;

    el.innerHTML = `<div class="cal-shell">
      ${header}
      <div class="cal-body">
        <div class="cal-time-col">${timeSlots}</div>
        <div class="cal-days-row week" style="min-height:${totalH}px">${dayCols}</div>
      </div>
    </div>`;

    setTimeout(() => {
      const body = el.querySelector('.cal-body');
      if (body) { const scroll = isSameDay(_calDate, now) ? Math.max(0, (now.getHours() - CAL_START - 1) * HOUR_PX) : 0; body.scrollTop = scroll; }
      _setupDragCreate(el, CAL_START, HOUR_PX, role);
    }, 50);

  } else {
    const y = _calDate.getFullYear(), m = _calDate.getMonth();
    const labelEl = document.getElementById('cal-label');
    if (labelEl) labelEl.textContent = `${RU_MONTHS[m]} ${y}`;
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    const startDow = firstDay.getDay() || 7;
    const cells = [];
    for (let i = 1; i < startDow; i++) { const d = new Date(y, m, 1); d.setDate(2 - startDow + i); cells.push({ d, other: true }); }
    for (let i = 1; i <= lastDay.getDate(); i++) cells.push({ d: new Date(y, m, i), other: false });
    const totalCells = Math.ceil(cells.length / 7) * 7;
    let next = 1;
    while (cells.length < totalCells) { cells.push({ d: new Date(y, m + 1, next++), other: true }); }

    const monthLessons = (CACHE.lessons || []).filter(l => {
      const d = new Date(l.date + 'T00:00:00');
      return d.getFullYear() === y && d.getMonth() === m && (!myGroupIds || myGroupIds.has(l.group_id)) && (!isMarketer || l.lesson_type === 'trial');
    }).sort((a, b) => a.date !== b.date ? (a.date > b.date ? 1 : -1) : (a.start_time || '').localeCompare(b.start_time || ''));

    el.innerHTML = `<div class="cal-shell"><div>
      <div class="cal-month-grid" style="width:100%">
          ${RU_DAYS.map((d, i) => `<div class="cal-month-head-cell" style="${i >= 5 ? 'color:var(--red)' : ''}">${d}</div>`).join('')}
          ${cells.map(({ d, other }) => {
      const ds = dateStr(d);
      const dayLessons = (CACHE.lessons || []).filter(l => l.date === ds && (!myGroupIds || myGroupIds.has(l.group_id)) && (!isMarketer || l.lesson_type === 'trial')).sort((a, b) => (a.start_time || '') > (b.start_time || '') ? 1 : -1);
      const isToday = isSameDay(d, now);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      return `<div class="cal-mcell${other ? ' other' : ''}${isToday ? ' today' : ''}" style="${isWeekend && !other ? 'background:#fef9f0' : ''}" data-action="openLessonFromCalendar" data-id="${esc(ds)}">
              <div class="cal-mdate" style="${isWeekend && !other ? 'color:#d97706' : ''}">${d.getDate()}</div>
              ${dayLessons.slice(0, 3).map(l => {
        const gc = roleColor(l.led_by) || groupColor(l.group_id);
        const past = lessonIsPast(l);
        const isConsult = l.lesson_type === 'consultation';
        const isTrial  = l.lesson_type === 'trial';
        const pillColor = isTrial ? '#16a34a' : isConsult ? '#7c3aed' : gc;
        return `<span class="cal-mpill${past ? ' past' : ''}" style="background:${pillColor}20;color:${past ? 'var(--muted)' : pillColor};border-left:2px ${isConsult ? 'dashed' : 'solid'} ${pillColor}" data-action="openLessonCard" data-id="${esc(l.id)}" onclick="event.stopPropagation()">
                  ${past ? '✓ ' : ''}${isTrial ? '🎯 ' : ''}<span style="overflow:hidden;text-overflow:ellipsis">${l.start_time || ''} ${esc(l.topic) || 'Занятие'}</span>
                </span>`;
      }).join('')}
              ${dayLessons.length > 3 ? `<span style="font-size:10px;color:var(--hint)">+${dayLessons.length - 3} ещё</span>` : ''}
            </div>`;
    }).join('')}
        </div>
      </div>
    </div></div>`;
  }
}

export function openLessonFromCalendar(date) {
  const dateVal = date || dateStr(new Date());
  const role = effectiveRole();

  // Marketer goes straight to trial lesson form
  if (role.role_type === 'marketer') {
    openTrialLessonModal(dateVal);
    return;
  }

  const curatorGroupIds = _getCuratorGroupIds(role);
  const groups = curatorGroupIds
    ? (CACHE.groups || []).filter(g => curatorGroupIds.has(g.id))
    : (CACHE.groups || []);
  if (!groups.length) { toast('Сначала создай хотя бы одну группу'); return; }
  const checkboxes = groups.map((gr, i) =>
    `<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--r);cursor:pointer;transition:background .1s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <input type="checkbox" name="cal-group-pick" value="${gr.id}" style="accent-color:var(--accent-mid)" ${i === 0 ? 'checked' : ''}>
      <span style="font-size:13px">${gr.name}</span>
    </label>`
  ).join('');
  modal(`<div class="modal" style="max-width:340px">
    <div class="modal-title">Новое занятие · ${dateVal}</div>
    <div class="fg" style="margin-bottom:16px">
      <label>Группы</label>
      <div style="margin-top:4px">${checkboxes}</div>
    </div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Отмена</button>
      <button class="btn btn-p" data-action="openLessonFormFromPicker" data-date="${esc(dateVal)}">Далее →</button>
    </div>
  </div>`);
}

export function openTrialLessonModal(date, existingId) {
  const existing = existingId ? (CACHE.lessons || []).find(x => x.id === existingId) : null;
  const todayStr = date || dateStr(new Date());
  const leads = (CACHE.students || []).filter(s => ['lead', 'trial_scheduled', 'trial_done'].includes(s.crm_status));
  const attachedIds = new Set((existing?.student_attendance || []).map(a => a.student_id));

  const leadCheckboxes = leads.length
    ? leads.map(s => `
      <label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--r);cursor:pointer" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
        <input type="checkbox" name="trial-lead-pick" value="${esc(s.id)}" style="accent-color:#16a34a" ${attachedIds.has(s.id) ? 'checked' : ''}>
        <span style="flex:1;font-size:13px">${esc(s.name)}</span>
        <span style="font-size:11px;color:var(--muted)">${esc(s.source || '—')}</span>
      </label>`).join('')
    : '<div style="font-size:13px;color:var(--muted);padding:8px 0">Нет лидов в воронке</div>';

  modal(`<div class="modal" style="max-width:480px">
    <div class="modal-title"><i class="ti ti-calendar-check" style="color:#16a34a;margin-right:6px"></i>${existing ? 'Редактировать пробный урок' : 'Новый пробный урок'}</div>
    <div class="form-row" style="margin-bottom:10px">
      <div class="fg"><label>Дата</label><input class="fi" type="date" id="tl-date" value="${existing?.date || todayStr}"></div>
      <div class="fg"><label>Время</label><input class="fi" type="time" id="tl-time" value="${existing?.start_time || '18:00'}"></div>
      <div class="fg"><label>Длительность</label>
        <select class="fi" id="tl-dur">
          <option value="45" ${existing?.duration == 45 ? 'selected' : ''}>45 мин</option>
          <option value="60" ${(!existing?.duration || existing?.duration == 60) ? 'selected' : ''}>1 час</option>
          <option value="90" ${existing?.duration == 90 ? 'selected' : ''}>1.5 ч</option>
        </select>
      </div>
    </div>
    <div class="fg" style="margin-bottom:12px">
      <label>Тема / название</label>
      <input class="fi" id="tl-topic" value="${esc(existing?.topic || 'Пробный урок')}" placeholder="Пробный урок">
    </div>
    <div class="fg" style="margin-bottom:12px">
      <label><i class="ti ti-video" style="font-size:11px"></i> Ссылка на занятие</label>
      <input class="fi" id="tl-link" value="${esc(existing?.lesson_link || '')}" placeholder="https://...">
    </div>
    <div class="fg" style="margin-bottom:4px">
      <label>Лиды на пробный урок</label>
      <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r);margin-top:4px">
        ${leadCheckboxes}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Отмена</button>
      <button class="btn btn-p" data-action="saveTrialLesson" data-id="${esc(existingId || '')}">Сохранить</button>
    </div>
  </div>`);
}

export async function saveTrialLesson(existingId) {
  const date = (document.getElementById('tl-date') || {}).value;
  if (!date) { toast('Укажите дату'); return; }
  const start_time = (document.getElementById('tl-time') || {}).value || '18:00';
  const duration = +((document.getElementById('tl-dur') || {}).value || 60);
  const topic = (document.getElementById('tl-topic') || {}).value || 'Пробный урок';
  const lesson_link = (document.getElementById('tl-link') || {}).value || '';
  const selectedLeadIds = [...document.querySelectorAll('input[name="trial-lead-pick"]:checked')].map(el => el.value);

  const student_attendance = selectedLeadIds.map(id => {
    const s = (CACHE.students || []).find(x => x.id === id);
    return { student_id: id, name: s?.name || '', present: true };
  });

  const lesson = {
    id: existingId || uid(),
    group_id: '',
    date, start_time, duration, topic,
    lesson_link, materials_link: '', led_by: '', notes: '',
    lesson_type: 'trial',
    student_attendance,
    task_ids: [],
    created_at: existingId
      ? ((CACHE.lessons || []).find(x => x.id === existingId) || {}).created_at || new Date().toISOString()
      : new Date().toISOString(),
  };

  try {
    if (existingId) await dbUpdate('lessons', existingId, lesson);
    else await dbInsert('lessons', lesson);

    // Update lead statuses: newly attached → trial_scheduled, detached → back to lead
    const existing = existingId ? (CACHE.lessons || []).find(x => x.id === existingId) : null;
    const prevIds = new Set((existing?.student_attendance || []).map(a => a.student_id));
    const newIds = new Set(selectedLeadIds);

    for (const id of newIds) {
      if (!prevIds.has(id)) {
        const s = (CACHE.students || []).find(x => x.id === id);
        if (s && s.crm_status === 'lead') {
          const history = [...(s.status_history || []), { status: 'trial_scheduled', date }];
          await dbUpdate('students', id, { crm_status: 'trial_scheduled', status_history: history });
        }
      }
    }
    for (const id of prevIds) {
      if (!newIds.has(id)) {
        const s = (CACHE.students || []).find(x => x.id === id);
        if (s && s.crm_status === 'trial_scheduled') {
          const history = [...(s.status_history || []), { status: 'lead', date }];
          await dbUpdate('students', id, { crm_status: 'lead', status_history: history });
        }
      }
    }

    await addHistoryEntry(existingId ? 'update' : 'insert',
      `${existingId ? 'Изменён' : 'Добавлен'} пробный урок: ${topic} · ${date} · лидов: ${selectedLeadIds.length}`,
      'lesson', lesson.id, null);

    closeModal();
    renderCalendar();
    toast(existingId ? 'Пробный урок обновлён' : 'Пробный урок добавлен');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export function openLessonFormFromPicker(dateVal) {
  const checked = [...document.querySelectorAll('input[name="cal-group-pick"]:checked')].map(el => el.value);
  if (!checked.length) { toast('Выберите хотя бы одну группу'); return; }
  _pendingGroupIds = checked;
  openLessonFormModal(dateVal, checked[0]);
}

export function openLessonFormModal(date, gid, existingId) {
  if (!gid && !existingId) { toast('Выберите группу'); return; }
  const existing = existingId ? (CACHE.lessons || []).find(x => x.id === existingId) : null;
  const groupId = existing ? existing.group_id : gid;
  state.currentGroupId = groupId;
  const gr = (CACHE.groups || []).find(x => x.id === groupId);
  if (!gr) { toast('Группа не найдена'); return; }

  // For new lessons, use _pendingGroupIds (may be multiple); for edits, single group
  const groupIds = existingId ? [groupId] : (_pendingGroupIds.length ? _pendingGroupIds : [groupId]);
  const groupNames = groupIds.map(id => (CACHE.groups || []).find(g => g.id === id)?.name || id).join(', ');

  const v = existing || { date, start_time: '18:00', duration: 60, topic: '', lesson_link: '', materials_link: '', notes: '', led_by: '', lesson_type: 'lesson' };

  // Conductor dropdown: owner + all roles
  const conductorOpts = [
    `<option value="" ${!v.led_by ? 'selected' : ''}>— не указан —</option>`,
    `<option value="owner" ${v.led_by === 'owner' ? 'selected' : ''}>Владелец</option>`,
    ...(CACHE.roles || []).map(r => `<option value="${r.id}" ${v.led_by === r.id ? 'selected' : ''}>${r.name}</option>`),
  ].join('');

  const members = (CACHE.students || []).filter(s => s.group_id === groupId && ['active', 'trial'].includes(s.crm_status));

  modal(`<div class="modal" style="max-width:640px">
    <div class="modal-title">${existing ? 'Редактировать занятие' : 'Новое занятие'} · ${existing ? gr.name : groupNames}</div>
    <div class="form-row" style="margin-bottom:10px">
      <div class="fg"><label>Дата</label><input class="fi" type="date" id="lf-date" value="${v.date || date}"></div>
      <div class="fg"><label>Время начала</label><input class="fi" type="time" id="lf-time" value="${v.start_time || '18:00'}"></div>
      <div class="fg"><label>Длительность (мин)</label>
        <select class="fi" id="lf-dur">
          <option value="45" ${v.duration == 45 ? 'selected' : ''}>45 мин</option>
          <option value="60" ${(!v.duration || v.duration == 60) ? 'selected' : ''}>1 час</option>
          <option value="90" ${v.duration == 90 ? 'selected' : ''}>1.5 часа</option>
          <option value="120" ${v.duration == 120 ? 'selected' : ''}>2 часа</option>
        </select>
      </div>
    </div>
    <div class="form-row" style="margin-bottom:10px">
      <div class="fg" style="flex:2"><label>Тема занятия</label><input class="fi" id="lf-topic" value="${v.topic || ''}" placeholder="Тригонометрия: формулы приведения"></div>
      <div class="fg"><label>Тип</label><select class="fi" id="lf-type">
  <option value="lesson" ${(!v.lesson_type || v.lesson_type === 'lesson') ? 'selected' : ''}>Занятие</option>
  <option value="consultation" ${v.lesson_type === 'consultation' ? 'selected' : ''}>Консультация</option>
</select></div>
      <div class="fg"><label>Ведёт занятие</label><select class="fi" id="lf-led-by">${conductorOpts}</select></div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div class="fg"><label><i class="ti ti-video" style="font-size:11px"></i> Ссылка на занятие</label><input class="fi" id="lf-lesson-link" value="${v.lesson_link || ''}" placeholder="https://..."></div>
      <div class="fg"><label><i class="ti ti-books" style="font-size:11px"></i> Ссылка на материалы</label><input class="fi" id="lf-materials-link" value="${v.materials_link || ''}" placeholder="https://drive.google.com/..."></div>
    </div>
    <div class="fg"><label>Заметка к занятию</label><textarea class="fi" id="lf-notes" rows="2">${v.notes || ''}</textarea></div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Отмена</button>
      <button class="btn btn-p" data-action="saveLessonForm" data-id="${esc(existingId || '')}">Сохранить</button>
    </div>
  </div>`);
}

export function toggleAttendance() {}

export function setCalHwStatus(hwId, btn) {
  const states = ['pending', 'done', 'missing'];
  const labels = { pending: '— не проверено', done: '✓ сделал', missing: '✗ не сделал' };
  const curIdx = states.indexOf(states.find(s => btn.classList.contains(s)) || 'pending');
  const nextStatus = states[(curIdx + 1) % states.length];
  states.forEach(s => btn.classList.remove(s));
  btn.classList.add(nextStatus);
  btn.textContent = labels[nextStatus];
  _hwBtnStates[hwId] = nextStatus;
}

// Columns added by migration_lesson_type.sql — fall back gracefully if not yet applied
const _NEW_LESSON_COLS = ['lesson_type', 'start_time', 'duration', 'lesson_link'];

async function _dbLessonSave(mode, obj, existingId) {
  try {
    if (mode === 'update') await dbUpdate('lessons', existingId, obj);
    else await dbInsert('lessons', obj);
  } catch (e) {
    const isSchemaErr = e.message && (
      e.message.includes('column') || e.message.includes('schema cache')
    );
    if (!isSchemaErr) throw e;
    // Strip new columns and retry — migration not yet applied
    const stripped = { ...obj };
    _NEW_LESSON_COLS.forEach(k => delete stripped[k]);
    if (mode === 'update') await dbUpdate('lessons', existingId, stripped);
    else await dbInsert('lessons', stripped);
    console.warn('lesson saved without new columns — run migration_lesson_type.sql in Supabase');
  }
}

export async function saveLessonForm(existingId) {
  const topic = g('lf-topic');
  if (!topic) { toast('Укажите тему'); return; }
  const date = g('lf-date');
  if (!date) { toast('Укажите дату'); return; }

  const lesson_link = g('lf-lesson-link');
  const materials_link = g('lf-materials-link');
  const led_by = (document.getElementById('lf-led-by') || {}).value || '';
  const duration = +(document.getElementById('lf-dur') || {}).value || 60;
  const start_time = g('lf-time') || '18:00';
  const notes = g('lf-notes');
  const createdAt = new Date().toISOString();

  // For new lessons: create one per selected group; for edit: single group
  const groupIds = existingId ? [state.currentGroupId] : (_pendingGroupIds.length ? _pendingGroupIds : [state.currentGroupId]);


  try {
    for (const [hwId, status] of Object.entries(_hwBtnStates)) {
      await dbUpdate('hw_submissions', hwId, { status, checked_at: createdAt });
    }

    const lessonIds = [];
    for (const gid of groupIds) {
      const lessonId = existingId || uid();
      const lesson_type = (document.getElementById('lf-type') || {}).value || 'lesson';
      const obj = {
        id: lessonId,
        group_id: gid,
        date, start_time, duration, topic,
        lesson_link, materials_link, led_by,
        lesson_type,
        task_ids: [],
        notes,
        created_at: existingId ? ((CACHE.lessons || []).find(x => x.id === existingId) || {}).created_at || createdAt : createdAt,
      };
      if (existingId) {
        await _dbLessonSave('update', obj, existingId);
      } else {
        await _dbLessonSave('insert', obj);
      }
      lessonIds.push(lessonId);

      if (!existingId) {
        const members = (CACHE.students || []).filter(s => s.group_id === gid && s.crm_status === 'active');
        for (const s of members) await recalcRisk(s);
      }

      const gr2 = (CACHE.groups || []).find(x => x.id === gid);
      await addHistoryEntry(existingId ? 'update' : 'insert', `${existingId ? 'Изменено' : 'Добавлено'} занятие: ${topic}${gr2 ? ' (' + gr2.name + ')' : ''} · ${date}`, 'lesson', lessonId, null);
    }

    _pendingGroupIds = [];
    closeModal(); renderCalendar();
    toast(existingId ? 'Занятие обновлено' : groupIds.length > 1 ? `Занятие добавлено в ${groupIds.length} группы` : 'Занятие добавлено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export function openLessonCard(lid) {
  const l = (CACHE.lessons || []).find(x => x.id === lid);
  if (!l) return;
  const gr = (CACHE.groups || []).find(g => g.id === l.group_id);
  const nowDt = new Date();
  const [lh, lm] = (l.start_time || '00:00').split(':').map(Number);
  const lessonDt = new Date(l.date + 'T' + String(lh).padStart(2, '0') + ':' + String(lm).padStart(2, '0'));
  const isPast = lessonDt < nowDt;
  const endMin = lh * 60 + lm + (l.duration || 60);
  const timeStr = `${l.start_time || '?'} – ${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  const hwSubs = (CACHE.hw_submissions || []).filter(h => h.lesson_id === l.id);
  const role = effectiveRole();

  modal(`<div class="modal" style="max-width:540px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
      <div>
        <div style="font-size:15px;font-weight:700">${esc(l.topic) || 'Без темы'}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:3px">${l.lesson_type === 'trial' ? 'Пробный урок' : gr ? esc(gr.name) : ''} · ${l.date} · ${timeStr}</div>
        ${l.lesson_type === 'consultation' ? `<span class="b" style="background:#7c3aed18;color:#7c3aed;font-size:10px;margin-top:4px;display:inline-block"><i class="ti ti-users-group" style="font-size:10px"></i> Консультация</span>` : ''}
        ${l.lesson_type === 'trial' ? `<span class="b" style="background:#dcfce7;color:#16a34a;font-size:10px;margin-top:4px;display:inline-block"><i class="ti ti-user-check" style="font-size:10px"></i> Пробный урок</span>` : ''}
        ${isPast ? `<span style="font-size:11px;color:var(--hint);font-style:italic;margin-left:4px">✓ прошло</span>` : `<span class="b b-g" style="font-size:10px;margin-left:4px">Предстоящее</span>`}
      </div>
      <div style="display:flex;gap:6px">
        ${role.isOwner || role.canEdit
          ? l.lesson_type === 'trial'
            ? `<button class="btn btn-sm" data-action="openTrialLessonModal" data-date="${esc(l.date)}" data-id="${esc(l.id)}"><i class="ti ti-edit"></i></button>`
            : `<button class="btn btn-sm" data-action="openLessonFormModal" data-date="${esc(l.date)}" data-group-id="${esc(l.group_id)}" data-id="${esc(l.id)}"><i class="ti ti-edit"></i></button>`
          : ''}
        ${role.isOwner || role.canEdit ? `<button class="btn btn-sm btn-icon" data-action="calDeleteLesson" data-id="${esc(l.id)}"><i class="ti ti-trash" style="color:var(--red)"></i></button>` : ''}
        <button class="btn" data-action="closeModal"><i class="ti ti-x"></i></button>
      </div>
    </div>
    ${l.lesson_type === 'trial' ? (() => {
      const leads = (l.student_attendance || []);
      return leads.length
        ? `<div style="margin-bottom:12px">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Записанные лиды</div>
            <div style="display:flex;flex-direction:column;gap:4px">
              ${leads.map(a => {
                const s = (CACHE.students || []).find(x => x.id === a.student_id);
                return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface2);border-radius:6px;font-size:13px">
                  <i class="ti ti-user" style="color:#16a34a;font-size:14px"></i>
                  <span style="font-weight:500">${esc(a.name || s?.name || '—')}</span>
                  <span style="font-size:11px;color:var(--muted);margin-left:auto">${esc(s?.source || '—')}</span>
                  <span class="b ${s?.crm_status === 'trial_done' ? 'b-a' : 'b-bl'}" style="font-size:10px">${s?.crm_status === 'trial_done' ? 'Проведён' : 'Назначен'}</span>
                </div>`;
              }).join('')}
            </div>
          </div>`
        : `<div style="font-size:13px;color:var(--muted);margin-bottom:12px">Нет записанных лидов</div>`;
    })() : ''}
    ${l.lesson_type !== 'trial' && l.led_by ? `<div style="font-size:12px;color:var(--muted);margin-bottom:8px"><i class="ti ti-user-check" style="font-size:11px"></i> Ведёт: <b>${l.led_by === 'owner' ? 'Владелец' : esc(((CACHE.roles || []).find(r => r.id === l.led_by) || {}).name || l.led_by)}</b></div>` : ''}
    ${(l.lesson_link || l.materials_link) ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${l.lesson_link ? `<a href="${l.lesson_link}" target="_blank" class="btn btn-sm"><i class="ti ti-video"></i> ${l.lesson_type === 'trial' ? 'Ссылка на урок' : 'Запись занятия'}</a>` : ''}
      ${l.materials_link ? `<a href="${l.materials_link}" target="_blank" class="btn btn-sm"><i class="ti ti-books"></i> Материалы</a>` : ''}
    </div>` : ''}
    ${l.notes ? `<div style="font-size:13px;color:var(--muted);border-top:1px solid var(--border);padding-top:10px"><i class="ti ti-notes"></i> ${esc(l.notes)}</div>` : ''}
  </div>`);
}

export async function deleteLesson(id) {
  if (!confirm('Удалить запись о занятии?')) return;
  try {
    const l = (CACHE.lessons || []).find(x => x.id === id);
    await dbDelete('lessons', id);
    await addHistoryEntry('delete', `Удалено занятие: ${l?.topic || '—'} · ${l?.date || ''}`, 'lesson', id, { table: 'lessons', action: 'delete', record_id: id, old_data: l });
    renderCalendar();
    toast('Удалено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export function exportICS() {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TutorOS//RU', 'CALSCALE:GREGORIAN'];
  (CACHE.lessons || []).forEach(l => {
    const gr = (CACHE.groups || []).find(g => g.id === l.group_id);
    const [h, m] = (l.start_time || '09:00').split(':').map(Number);
    const dur = l.duration || 60;
    const dt = l.date.replace(/-/g, '');
    const dtStart = `${dt}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
    const endTotalMin = h * 60 + m + dur;
    const dtEnd = `${dt}T${String(Math.floor(endTotalMin / 60)).padStart(2, '0')}${String(endTotalMin % 60).padStart(2, '0')}00`;
    lines.push('BEGIN:VEVENT', `DTSTART:${dtStart}`, `DTEND:${dtEnd}`,
      `SUMMARY:${l.topic || 'Занятие'}${gr ? ' (' + gr.name + ')' : ''}`,
      `DESCRIPTION:${l.materials_link ? 'Материалы: ' + l.materials_link : ''}`,
      `UID:${l.id}@tutoros`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tutoros_lessons.ics'; a.click();
}

export async function calSubscribe() {
  const { isDemoMode } = await import('../core/store.js');
  if (isDemoMode()) {
    exportICS();
    toast('В демо-режиме доступно только скачивание .ics');
    return;
  }
  const { supabase } = await import('../lib/supabase.js');
  let { data } = await supabase.from('settings').select('value').eq('key', 'cal_token').maybeSingle();
  let token = data?.value;
  if (!token) {
    token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const { error } = await supabase.from('settings').upsert({ key: 'cal_token', value: token });
    if (error) {
      toast('Ошибка: нужно запустить migration_colors.sql в Supabase');
      console.error('settings upsert:', error.message);
      return;
    }
  }
  const webcalUrl = `webcal://${window.location.host}/api/cal?token=${token}`;
  modal(`<div class="modal" style="max-width:440px">
    <div class="modal-title"><i class="ti ti-brand-apple" style="margin-right:6px"></i>Синхронизация с Apple Calendar</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:14px">
      Занятия будут автоматически обновляться в Apple Calendar каждые 4 часа.
    </div>
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">URL подписки</div>
      <code style="font-size:11px;word-break:break-all;color:var(--text);line-height:1.6">${webcalUrl}</code>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:16px;line-height:1.7">
      <b>iOS / iPadOS:</b> Настройки → Контакты → Аккаунты → Добавить → Другое → Добавить подписку на календарь<br>
      <b>Mac:</b> Calendar → Файл → Новая подписка на календарь<br>
      Или нажми «Открыть в Calendar» — приложение откроется само.
    </div>
    <div class="modal-footer" style="flex-wrap:wrap;gap:6px">
      <button class="btn" data-action="closeModal">Закрыть</button>
      <button class="btn" data-action="exportICS"><i class="ti ti-calendar-download"></i> Скачать .ics</button>
      <button class="btn" onclick="navigator.clipboard.writeText('${esc(webcalUrl)}').then(()=>toast('URL скопирован'))"><i class="ti ti-copy"></i> Скопировать URL</button>
      <a href="${esc(webcalUrl)}" class="btn btn-p" data-action="closeModal"><i class="ti ti-brand-apple"></i> Открыть в Calendar</a>
    </div>
  </div>`);
}
