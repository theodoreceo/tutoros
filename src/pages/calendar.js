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
  if (!(CACHE.groups || []).length) { toast('Сначала создай хотя бы одну группу'); return; }
  const gOpts = (CACHE.groups || []).map(gr => `<option value="${gr.id}">${gr.name}</option>`).join('');
  modal(`<div class="modal" style="max-width:340px">
    <div class="modal-title">Новое занятие · ${dateVal}</div>
    <div class="fg" style="margin-bottom:16px">
      <label>Группа</label>
      <select class="fi" id="cal-group-pick">${gOpts}</select>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="openLessonFormModal('${dateVal}',(document.getElementById('cal-group-pick')||{}).value)">Далее →</button>
    </div>
  </div>`);
}

export function openLessonFormModal(date, gid, existingId) {
  if (!gid && !existingId) { toast('Выберите группу'); return; }
  const existing = existingId ? (CACHE.lessons || []).find(x => x.id === existingId) : null;
  const groupId = existing ? existing.group_id : gid;
  state.currentGroupId = groupId;
  const gr = (CACHE.groups || []).find(x => x.id === groupId);
  if (!gr) { toast('Группа не найдена'); return; }

  const members = (CACHE.students || []).filter(s => s.group_id === groupId && ['active', 'trial'].includes(s.crm_status));
  const v = existing || { date, start_time: '18:00', duration: 60, topic: '', lesson_link: '', homework_link: '', student_attendance: [], notes: '' };

  const prevLesson = (CACHE.lessons || []).filter(l => l.group_id === groupId && l.date < v.date && l.homework_link).sort((a, b) => b.date > a.date ? 1 : -1)[0];
  const pendingHW = prevLesson ? (CACHE.hw_submissions || []).filter(h => h.lesson_id === prevLesson.id && h.status === 'pending') : [];

  const hwReviewBlock = (!existingId && pendingHW.length) ? `
    <div style="background:var(--amber-bg);border:1px solid var(--amber-border);border-radius:var(--r);padding:12px 14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">
        <i class="ti ti-clipboard-check"></i> Проверить ДЗ с прошлого занятия${prevLesson.homework_link ? ` · <a href="${prevLesson.homework_link}" target="_blank" style="color:var(--accent-mid);font-size:11px">открыть</a>` : ''}
      </div>
      ${pendingHW.map(h => {
    const stu = (CACHE.students || []).find(s => s.id === h.student_id);
    return `<div class="hw-row">
          <span style="flex:1;font-size:13px">${stu ? stu.name : '?'}</span>
          <button class="hw-status-btn pending" id="hwbtn-${h.id}" onclick="setCalHwStatus('${h.id}',this)">— не проверено</button>
        </div>`;
  }).join('')}
    </div>` : '';

  const attendeeRows = members.length ? members.map(s => {
    const att = (v.student_attendance || []).find(a => a.student_id === s.id);
    const present = att ? att.present : true;
    const note = att?.note || '';
    return `<div class="att-row${!present ? ' absent' : ''}" id="att-${s.id}">
      <div class="att-toggle${!present ? ' absent' : ''}" onclick="toggleAttendance('${s.id}')" id="att-tog-${s.id}">
        ${!present ? '<i class="ti ti-x" style="font-size:11px"></i>' : ''}
      </div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500">${s.name}</div>
        <input class="fi" id="att-note-${s.id}" value="${note}" placeholder="Заметка..." style="font-size:11px;padding:3px 7px;margin-top:4px">
      </div>
      <span style="font-size:10px;color:var(--muted)" id="att-lbl-${s.id}">${!present ? 'отсутствует' : 'присутствует'}</span>
    </div>`;
  }).join('') : '<div style="font-size:12px;color:var(--hint)">Активных учеников в группе нет</div>';

  modal(`<div class="modal" style="max-width:640px">
    <div class="modal-title">${existing ? 'Редактировать занятие' : 'Новое занятие'} · ${gr.name}</div>
    ${hwReviewBlock}
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
    <div class="fg" style="margin-bottom:10px"><label>Тема занятия</label><input class="fi" id="lf-topic" value="${v.topic || ''}" placeholder="Тригонометрия: формулы приведения"></div>
    <div class="form-row" style="margin-bottom:12px">
      <div class="fg"><label><i class="ti ti-link" style="font-size:11px"></i> Ссылка на занятие</label><input class="fi" id="lf-lesson-link" value="${v.lesson_link || ''}" placeholder="https://..."></div>
      <div class="fg"><label><i class="ti ti-home" style="font-size:11px"></i> Ссылка на домашнее задание</label><input class="fi" id="lf-hw-link" value="${v.homework_link || ''}" placeholder="https://docs.google.com/..."></div>
    </div>
    <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">
      <i class="ti ti-users"></i> Ученики <span style="font-weight:400;font-style:normal;text-transform:none">(нажми на квадрат чтобы отметить отсутствие)</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:0;margin-bottom:12px" id="att-list">${attendeeRows}</div>
    <div class="fg"><label>Заметка к занятию</label><textarea class="fi" id="lf-notes" rows="2">${v.notes || ''}</textarea></div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="saveLessonForm('${existingId || ''}')">Сохранить</button>
    </div>
  </div>`);
}

export function toggleAttendance(sid) {
  const row = document.getElementById('att-' + sid);
  const tog = document.getElementById('att-tog-' + sid);
  const lbl = document.getElementById('att-lbl-' + sid);
  const absent = !row.classList.contains('absent');
  row.classList.toggle('absent', absent);
  tog.classList.toggle('absent', absent);
  tog.innerHTML = absent ? '<i class="ti ti-x" style="font-size:11px"></i>' : '';
  if (lbl) lbl.textContent = absent ? 'отсутствует' : 'присутствует';
}

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

  const members = (CACHE.students || []).filter(s => s.group_id === state.currentGroupId && ['active', 'trial'].includes(s.crm_status));
  const student_attendance = members.map(s => ({
    student_id: s.id,
    present: !document.getElementById('att-' + s.id)?.classList.contains('absent'),
    note: (document.getElementById('att-note-' + s.id) || {}).value || ''
  }));

  const absent_ids = student_attendance.filter(a => !a.present).map(a => a.student_id);
  const hw_link = g('lf-hw-link');
  const lesson_link = g('lf-lesson-link');
  const duration = +(document.getElementById('lf-dur') || {}).value || 60;
  const start_time = g('lf-time') || '18:00';

  const obj = {
    id: existingId || uid(),
    group_id: state.currentGroupId,
    date, start_time, duration, topic,
    lesson_link, homework_link: hw_link,
    student_attendance,
    task_ids: [],
    notes: g('lf-notes'),
    created_at: existingId ? ((CACHE.lessons || []).find(x => x.id === existingId) || {}).created_at || new Date().toISOString() : new Date().toISOString()
  };

  try {
    if (existingId) await dbUpdate('lessons', existingId, obj);
    else await dbInsert('lessons', obj);

    for (const [hwId, status] of Object.entries(_hwBtnStates)) {
      await dbUpdate('hw_submissions', hwId, { status, checked_at: new Date().toISOString() });
    }

    if (hw_link && !existingId) {
      const presentIds = student_attendance.filter(a => a.present).map(a => a.student_id);
      for (const sid of presentIds) {
        const hwObj = { id: uid(), lesson_id: obj.id, group_id: state.currentGroupId, student_id: sid, hw_link, assigned_at: new Date().toISOString(), status: 'pending', checked_at: null };
        await dbInsert('hw_submissions', hwObj);
      }
    }

    if (!existingId) {
      for (const sid of absent_ids) await addEvent('student', sid, 'lesson_absent', { lesson_id: obj.id, topic });
      const actives = members.filter(s => s.crm_status === 'active');
      for (const s of actives) await recalcRisk(s);
    }

    const gr2 = (CACHE.groups || []).find(x => x.id === obj.group_id);
    await addHistoryEntry(existingId ? 'update' : 'insert', `${existingId ? 'Изменено' : 'Добавлено'} занятие: ${topic}${gr2 ? ' (' + gr2.name + ')' : ''} · ${date}`, 'lesson', obj.id, { table: 'lessons', action: existingId ? 'update' : 'insert', record_id: obj.id, old_data: null });
    closeModal(); renderCalendar(); toast(existingId ? 'Занятие обновлено' : 'Занятие добавлено');
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
    ${(l.lesson_link || l.homework_link) ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${l.lesson_link ? `<a href="${l.lesson_link}" target="_blank" class="btn btn-sm"><i class="ti ti-video"></i> Запись занятия</a>` : ''}
      ${l.homework_link ? `<a href="${l.homework_link}" target="_blank" class="btn btn-sm"><i class="ti ti-home"></i> Домашнее задание</a>` : ''}
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
      `DESCRIPTION:${l.homework_link ? 'ДЗ: ' + l.homework_link : ''}`,
      `UID:${l.id}@tutoros`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'TutorOS_lessons.ics'; a.click();
  toast('.ics скачан — импортируй в Apple/Google Calendar двойным кликом');
}
