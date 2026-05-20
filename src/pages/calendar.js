import { CACHE, dbInsert, dbUpdate, dbDelete } from '../core/store.js';
import { state } from '../core/state.js';
import { uid, fmt, fmtDate, today, dateStr, g, GROUP_COLORS } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';
import { addEvent } from '../core/events.js';
import { recalcRisk } from '../core/risk.js';

let _calView = 'week';
let _calDate = new Date();
const _hwBtnStates = {};
let _pendingGroupIds = [];

function groupColor(gid) {
  const idx = (CACHE.groups || []).findIndex(g => g.id === gid);
  return GROUP_COLORS[idx % GROUP_COLORS.length] || '#64748b';
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

export function renderCalendar() {
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
      const dayLessons = (CACHE.lessons || []).filter(l => l.date === ds);
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
        const gc = groupColor(l.group_id);
        const gr = (CACHE.groups || []).find(g => g.id === l.group_id);
        const top = lessonTop(l);
        const h = lessonHeight(l);
        const past = lessonIsPast(l);
        const endMin = lessonTop(l) / (HOUR_PX / 60) + (l.duration || 60);
        const endH = Math.floor(endMin / 60) + CAL_START;
        const endM = endMin % 60;
        const timeStr = `${l.start_time || '?'} – ${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
        return `<div class="cal-event${past ? ' past' : ''}" style="top:${top}px;height:${h}px;background:${gc}18;color:${gc};border-left-color:${gc}" onclick="event.stopPropagation();openLessonCard('${l.id}')">
          <div class="cal-event-title">${l.topic || 'Занятие'}</div>
          <div class="cal-event-time">${timeStr} · ${gr ? gr.name.slice(0, 14) : ''}</div>
          ${past ? `<div class="cal-event-past">✓ прошло</div>` : ''}
        </div>`;
      }).join('');
      return `<div class="cal-day-col" onclick="openLessonFromCalendar('${ds}')">
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
      return d.getFullYear() === y && d.getMonth() === m;
    }).sort((a, b) => a.date !== b.date ? (a.date > b.date ? 1 : -1) : (a.start_time || '').localeCompare(b.start_time || ''));

    const leftPanel = `<div style="width:240px;flex-shrink:0;border-right:1px solid var(--border);overflow-y:auto;max-height:calc(100vh-230px);padding:10px 12px">
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Занятия месяца · ${monthLessons.length}</div>
      ${monthLessons.length ? monthLessons.map(l => {
      const gr = (CACHE.groups || []).find(g => g.id === l.group_id);
      const gc = groupColor(l.group_id);
      const past = lessonIsPast(l);
      const d = new Date(l.date + 'T00:00:00');
      const dayStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      return `<div style="padding:8px 10px;margin-bottom:6px;border-radius:var(--r);border:1px solid var(--border);border-left:3px solid ${gc};cursor:pointer;opacity:${past ? .5 : 1}" onclick="openLessonCard('${l.id}')">
          <div style="font-size:10px;color:var(--muted);font-weight:600">${dayStr} · ${l.start_time || '?'}</div>
          <div style="font-size:12px;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.topic || 'Занятие'}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${gr ? gr.name.slice(0, 20) : '—'}</div>
        </div>`;
    }).join('') : '<div style="font-size:12px;color:var(--hint)">Занятий нет</div>'}
    </div>`;

    el.innerHTML = `<div class="cal-shell"><div style="display:flex">
      ${leftPanel}
      <div style="flex:1;overflow:hidden">
        <div class="cal-month-grid" style="width:100%">
          ${RU_DAYS.map((d, i) => `<div class="cal-month-head-cell" style="${i >= 5 ? 'color:var(--red)' : ''}">${d}</div>`).join('')}
          ${cells.map(({ d, other }) => {
      const ds = dateStr(d);
      const dayLessons = (CACHE.lessons || []).filter(l => l.date === ds).sort((a, b) => (a.start_time || '') > (b.start_time || '') ? 1 : -1);
      const isToday = isSameDay(d, now);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      return `<div class="cal-mcell${other ? ' other' : ''}${isToday ? ' today' : ''}" style="${isWeekend && !other ? 'background:#fef9f0' : ''}" onclick="openLessonFromCalendar('${ds}')">
              <div class="cal-mdate" style="${isWeekend && !other ? 'color:#d97706' : ''}">${d.getDate()}</div>
              ${dayLessons.slice(0, 3).map(l => {
        const gc = groupColor(l.group_id);
        const past = lessonIsPast(l);
        return `<span class="cal-mpill${past ? ' past' : ''}" style="background:${gc}20;color:${past ? 'var(--muted)' : gc}" onclick="event.stopPropagation();openLessonCard('${l.id}')">
                  ${past ? '✓ ' : ''}<span style="overflow:hidden;text-overflow:ellipsis">${l.start_time || ''} ${l.topic || 'Занятие'}</span>
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
  const groups = CACHE.groups || [];
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
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="openLessonFormFromPicker('${dateVal}')">Далее →</button>
    </div>
  </div>`);
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

  const v = existing || { date, start_time: '18:00', duration: 60, topic: '', lesson_link: '', materials_link: '', notes: '', led_by: '' };

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
      <div class="fg"><label>Ведёт занятие</label><select class="fi" id="lf-led-by">${conductorOpts}</select></div>
    </div>
    <div class="form-row" style="margin-bottom:12px">
      <div class="fg"><label><i class="ti ti-video" style="font-size:11px"></i> Ссылка на занятие</label><input class="fi" id="lf-lesson-link" value="${v.lesson_link || ''}" placeholder="https://..."></div>
      <div class="fg"><label><i class="ti ti-books" style="font-size:11px"></i> Ссылка на материалы</label><input class="fi" id="lf-materials-link" value="${v.materials_link || ''}" placeholder="https://drive.google.com/..."></div>
    </div>
    <div style="margin-bottom:14px;border-top:1px solid var(--border);padding-top:12px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600">
        <input type="checkbox" id="lf-hw-assign" style="accent-color:var(--accent-mid)" onchange="toggleHwAssignBlock()">
        <i class="ti ti-home-plus"></i> Дать домашнее задание
      </label>
      <div id="hw-assign-block" style="display:none;margin-top:10px">
        <div class="form-row">
          <div class="fg" style="grid-column:1/-1"><label>Тема задания</label><input class="fi" id="lf-hw-topic" placeholder="Тригонометрия: задачи на формулы приведения..."></div>
        </div>
        <div class="fg" style="margin-bottom:10px"><label>Описание / инструкция</label><textarea class="fi" id="lf-hw-desc" rows="2" placeholder="Подробности..."></textarea></div>
        <div class="form-row" style="margin-bottom:10px">
          <div class="fg">
            <label>Тип задания</label>
            <select class="fi" id="lf-hw-type">
              <option value="detailed">Подробный ответ</option>
              <option value="brief">Краткий ответ</option>
              <option value="trial">Пробник</option>
            </select>
          </div>
          <div class="fg"><label>Дедлайн</label><input class="fi" type="date" id="lf-hw-due"></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;margin-bottom:4px">
          <input type="checkbox" id="lf-hw-advanced" style="accent-color:var(--accent-mid)">
          <span>Сложный уровень</span>
        </label>
      </div>
    </div>
    <div class="fg"><label>Заметка к занятию</label><textarea class="fi" id="lf-notes" rows="2">${v.notes || ''}</textarea></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="saveLessonForm('${existingId || ''}')">Сохранить</button>
    </div>
  </div>`);
}

export function toggleHwAssignBlock() {
  const checked = (document.getElementById('lf-hw-assign') || {}).checked;
  const block = document.getElementById('hw-assign-block');
  if (block) block.style.display = checked ? '' : 'none';
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

  const hwAssign = !existingId && (document.getElementById('lf-hw-assign') || {}).checked;
  let hwParams = null;
  if (hwAssign) {
    hwParams = {
      topic: (document.getElementById('lf-hw-topic') || {}).value || topic,
      description: (document.getElementById('lf-hw-desc') || {}).value || '',
      due_date: (document.getElementById('lf-hw-due') || {}).value || '',
      hw_type: (document.getElementById('lf-hw-type') || {}).value || 'detailed',
      is_advanced: (document.getElementById('lf-hw-advanced') || {}).checked || false,
    };
  }

  try {
    for (const [hwId, status] of Object.entries(_hwBtnStates)) {
      await dbUpdate('hw_submissions', hwId, { status, checked_at: createdAt });
    }

    const lessonIds = [];
    for (const gid of groupIds) {
      const lessonId = existingId || uid();
      const obj = {
        id: lessonId,
        group_id: gid,
        date, start_time, duration, topic,
        lesson_link, materials_link, led_by,
        task_ids: [],
        notes,
        created_at: existingId ? ((CACHE.lessons || []).find(x => x.id === existingId) || {}).created_at || createdAt : createdAt,
      };
      if (existingId) await dbUpdate('lessons', existingId, obj);
      else await dbInsert('lessons', obj);
      lessonIds.push(lessonId);

      if (hwParams) {
        const { db } = await import('../lib/db.js');
        const assignment = await db.homeworks.createAssignment({
          group_id: gid,
          lesson_id: lessonId,
          ...hwParams,
        });
        const members = (CACHE.students || []).filter(s => s.group_id === gid && ['active', 'trial'].includes(s.crm_status));
        for (const stu of members) {
          await db.homeworks.createSubmission({ assignment_id: assignment.id, student_id: stu.id });
        }
      }

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
  const attendance = l.student_attendance || [];
  const absent = attendance.filter(a => !a.present);
  const nowDt = new Date();
  const [lh, lm] = (l.start_time || '00:00').split(':').map(Number);
  const lessonDt = new Date(l.date + 'T' + String(lh).padStart(2, '0') + ':' + String(lm).padStart(2, '0'));
  const isPast = lessonDt < nowDt;
  const endMin = lh * 60 + lm + (l.duration || 60);
  const timeStr = `${l.start_time || '?'} – ${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  const hwSubs = (CACHE.hw_submissions || []).filter(h => h.lesson_id === l.id);
  const role = state.currentRole || {};

  modal(`<div class="modal" style="max-width:540px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
      <div>
        <div style="font-size:15px;font-weight:700">${l.topic || 'Без темы'}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:3px">${gr ? gr.name : ''} · ${l.date} · ${timeStr}</div>
        ${isPast ? `<span style="font-size:11px;color:var(--hint);font-style:italic">✓ занятие прошло</span>` : `<span class="b b-g" style="font-size:10px">Предстоящее</span>`}
      </div>
      <div style="display:flex;gap:6px">
        ${role.isOwner || role.canEdit ? `<button class="btn btn-sm" onclick="closeModal();openLessonFormModal('${l.date}','${l.group_id}','${l.id}')"><i class="ti ti-edit"></i></button><button class="btn btn-sm btn-icon" onclick="closeModal();deleteLesson('${l.id}')"><i class="ti ti-trash" style="color:var(--red)"></i></button>` : ''}
        <button class="btn" onclick="closeModal()"><i class="ti ti-x"></i></button>
      </div>
    </div>
    ${l.led_by ? `<div style="font-size:12px;color:var(--muted);margin-bottom:8px"><i class="ti ti-user-check" style="font-size:11px"></i> Ведёт: <b>${l.led_by === 'owner' ? 'Владелец' : ((CACHE.roles || []).find(r => r.id === l.led_by) || {}).name || l.led_by}</b></div>` : ''}
    ${(l.lesson_link || l.materials_link) ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${l.lesson_link ? `<a href="${l.lesson_link}" target="_blank" class="btn btn-sm"><i class="ti ti-video"></i> Запись занятия</a>` : ''}
      ${l.materials_link ? `<a href="${l.materials_link}" target="_blank" class="btn btn-sm"><i class="ti ti-books"></i> Материалы</a>` : ''}
    </div>` : ''}
    ${attendance.length ? `<div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Ученики</div>
      ${attendance.map(a => {
    const stu = (CACHE.students || []).find(s => s.id === a.student_id);
    const hw = hwSubs.find(h => h.student_id === a.student_id);
    const hwLabel = hw ? { done: '✓ ДЗ сделал', missing: '✗ ДЗ не сдал', pending: '⏳ ДЗ не проверено' }[hw.status] || '' : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span style="color:${a.present ? 'var(--green)' : 'var(--red)'}">${a.present ? '✓' : '✗'}</span>
          <span style="flex:1;font-weight:500">${stu ? stu.name : '?'}</span>
          ${a.note ? `<span style="font-size:11px;color:var(--muted)">${a.note}</span>` : ''}
          ${hwLabel ? `<span style="font-size:10px;color:${hw.status === 'done' ? 'var(--green)' : hw.status === 'missing' ? 'var(--red)' : 'var(--muted)'}">${hwLabel}</span>` : ''}
        </div>`;
  }).join('')}
    </div>` : (isPast ? '<div style="font-size:12px;color:var(--hint);margin-bottom:10px">Посещаемость не заполнена</div>' : '')}
    ${l.notes ? `<div style="font-size:13px;color:var(--muted);border-top:1px solid var(--border);padding-top:10px"><i class="ti ti-notes"></i> ${l.notes}</div>` : ''}
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
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//теорема федора//RU', 'CALSCALE:GREGORIAN'];
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
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'teorema_fedora_lessons.ics'; a.click();
  toast('.ics скачан — импортируй в Apple/Google Calendar двойным кликом');
}
