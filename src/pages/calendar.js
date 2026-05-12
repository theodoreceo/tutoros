import { CACHE, dbInsert, dbUpdate, dbDelete, dbFind } from '../core/store.js';
import { state } from '../core/state.js';
import { fmt, fmtDate, today } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';
import { addEvent } from '../core/events.js';

const COLORS = [
  { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },
  { bg: '#f0fdf4', border: '#22c55e', text: '#15803d' },
  { bg: '#fff7ed', border: '#f97316', text: '#c2410c' },
  { bg: '#fdf4ff', border: '#a855f7', text: '#7e22ce' },
  { bg: '#fef2f2', border: '#ef4444', text: '#b91c1c' },
  { bg: '#ecfdf5', border: '#10b981', text: '#065f46' },
];

function colorFor(id) {
  let hash = 0;
  for (const ch of (id || 'x')) hash = ((hash << 5) - hash) + ch.charCodeAt(0);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function renderCalendar() {
  if (state.calView === 'month') renderMonthView();
  else renderWeekView();
}

export function setCalView(v) {
  state.calView = v;
  document.querySelectorAll('#pg-lessons_cal .view-toggle button').forEach(b => {
    b.classList.toggle('on', b.dataset.view === v);
  });
  renderCalendar();
}

export function calNav(dir) {
  const d = state.calDate;
  if (state.calView === 'month') {
    state.calDate = new Date(d.getFullYear(), d.getMonth() + dir, 1);
  } else {
    state.calDate = new Date(d.getTime() + dir * 7 * 86400000);
  }
  renderCalendar();
}

export function calToday() {
  state.calDate = new Date();
  renderCalendar();
}

// ─── WEEK VIEW ────────────────────────────────────────────────────────────────

function renderWeekView() {
  const el = document.getElementById('cal-content');
  if (!el) return;

  const base = state.calDate;
  const dow = base.getDay(); // 0=Sun
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((dow === 0 ? 7 : dow) - 1));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const todayStr = today();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const hours = Array.from({ length: 15 }, (_, i) => i + 7); // 07:00–21:00

  el.innerHTML = `
    <div class="cal-shell">
      <div class="cal-header-row week">
        <div class="cal-header-cell" style="border-right:1px solid var(--border)"></div>
        ${days.map((d, i) => {
          const ds = d.toISOString().slice(0, 10);
          const isToday = ds === todayStr;
          return `<div class="cal-header-cell ${isToday ? 'today' : ''}">
            <div class="cal-hday">${DAY_NAMES[i]}</div>
            <div class="cal-hdate">${d.getDate()}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="cal-body">
        <div class="cal-time-col">
          ${hours.map(h => `<div class="cal-time-slot">${h}:00</div>`).join('')}
        </div>
        <div class="cal-days-row week">
          ${days.map(d => {
            const ds = d.toISOString().slice(0, 10);
            const isToday = ds === todayStr;
            const dayLessons = CACHE.lessons.filter(l => l.date === ds && !l.cancelled);

            return `<div class="cal-day-col" data-date="${ds}" onclick="window.__openLessonFormModal('${ds}', event)">
              ${hours.map(h => `<div class="cal-hour-line"></div>`).join('')}
              ${isToday ? `<div class="cal-now-line" style="top:${calcTop(nowMin)}px"><div class="cal-now-dot"></div></div>` : ''}
              ${dayLessons.map(l => renderEventBlock(l)).join('')}
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

function calcTop(startMin) {
  const startOfDay = 7 * 60;
  return ((startMin - startOfDay) / 60) * 60;
}

function calcHeight(startMin, endMin) {
  return Math.max(((endMin - startMin) / 60) * 60, 20);
}

function parseMin(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function renderEventBlock(l) {
  const startMin = parseMin(l.startTime);
  const endMin = parseMin(l.endTime) || startMin + 60;
  const top = calcTop(startMin);
  const height = calcHeight(startMin, endMin);
  const isPast = l.date < today() || (l.date === today() && endMin < new Date().getHours() * 60 + new Date().getMinutes());

  const name = l.studentId
    ? (CACHE.students.find(s => s.id === l.studentId)?.name || '?')
    : (CACHE.groups.find(g => g.id === l.groupId)?.name || '?');

  const c = colorFor(l.studentId || l.groupId);

  return `<div class="cal-event ${isPast ? 'past' : ''} ${l.isTrial ? 'trial' : ''}"
    style="top:${top}px;height:${height}px;background:${c.bg};border-color:${c.border};color:${c.text}"
    onclick="event.stopPropagation();window.__openLessonCard('${l.id}')">
    <div class="cal-event-title">${name}</div>
    <div class="cal-event-time">${l.startTime || ''}${l.endTime ? '–'+l.endTime : ''}</div>
    ${isPast && l.attended === false ? '<div class="cal-event-past">пропуск</div>' : ''}
  </div>`;
}

// ─── MONTH VIEW ───────────────────────────────────────────────────────────────

function renderMonthView() {
  const el = document.getElementById('cal-content');
  if (!el) return;

  const d = state.calDate;
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const todayStr = today();

  // Start from Monday before 1st
  const startDow = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const cells = [];
  for (let i = -startDow; i < 42 - startDow; i++) {
    const cd = new Date(year, month, 1 + i);
    cells.push(cd);
  }

  const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  el.innerHTML = `
    <div class="cal-shell">
      <div class="cal-month-grid">
        ${DAY_NAMES.map(n => `<div class="cal-month-head-cell">${n}</div>`).join('')}
        ${cells.map(cd => {
          const ds = cd.toISOString().slice(0, 10);
          const isCurrentMonth = cd.getMonth() === month;
          const isToday = ds === todayStr;
          const dayLessons = CACHE.lessons.filter(l => l.date === ds);
          return `<div class="cal-mcell ${isToday ? 'today' : ''} ${!isCurrentMonth ? 'other' : ''}" onclick="window.__openLessonFormModal('${ds}', event)">
            <div class="cal-mdate">${cd.getDate()}</div>
            ${dayLessons.slice(0, 3).map(l => {
              const name = l.studentId
                ? (CACHE.students.find(s => s.id === l.studentId)?.name?.split(' ')[0] || '?')
                : (CACHE.groups.find(g => g.id === l.groupId)?.name || '?');
              const c = colorFor(l.studentId || l.groupId);
              return `<div class="cal-mpill ${l.date < todayStr ? 'past' : ''}"
                style="background:${c.bg};color:${c.text};border:1px solid ${c.border}"
                onclick="event.stopPropagation();window.__openLessonCard('${l.id}')">${l.startTime ? l.startTime+' ' : ''}${name}</div>`;
            }).join('')}
            ${dayLessons.length > 3 ? `<div style="font-size:10px;color:var(--hint)">+${dayLessons.length - 3} ещё</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ─── LESSON CARD (view) ───────────────────────────────────────────────────────

export function openLessonCard(id) {
  const l = dbFind('lessons', id);
  if (!l) return;
  const name = l.studentId
    ? (CACHE.students.find(s => s.id === l.studentId)?.name || '?')
    : (CACHE.groups.find(g => g.id === l.groupId)?.name || '?');

  const DIFF = { easy: 'Лёгкий', med: 'Средний', hard: 'Сложный' };
  const MOOD = { 1:'😞 1', 2:'😕 2', 3:'😐 3', 4:'🙂 4', 5:'😄 5' };

  modal('lesson-card-modal', `
    <div class="modal-title">${name} — ${fmtDate(l.date)}</div>
    <div class="two" style="gap:8px;margin-bottom:12px">
      <div><span style="font-size:11px;color:var(--muted)">Время</span><br>${l.startTime || '—'}${l.endTime?'–'+l.endTime:''}</div>
      <div><span style="font-size:11px;color:var(--muted)">Посещаемость</span><br>
        ${l.attended === true ? '<span class="b b-g">Был</span>' : l.attended === false ? '<span class="b b-r">Пропуск</span>' : '<span class="b b-gray">—</span>'}
      </div>
      <div><span style="font-size:11px;color:var(--muted)">Сложность</span><br>${l.difficulty ? DIFF[l.difficulty] : '—'}</div>
      <div><span style="font-size:11px;color:var(--muted)">Настроение</span><br>${l.mood ? MOOD[l.mood] : '—'}</div>
    </div>
    ${l.topic ? `<div class="fg"><label>Тема</label><div style="font-size:13px">${l.topic}</div></div>` : ''}
    ${l.homework ? `<div class="fg"><label>ДЗ</label><div style="font-size:13px">${l.homework}</div></div>` : ''}
    ${l.notes ? `<div class="fg"><label>Заметки</label><div style="font-size:13px">${l.notes}</div></div>` : ''}
    <div class="modal-footer">
      <button class="btn" onclick="window.__closeModal()">Закрыть</button>
      <button class="btn btn-p" onclick="window.__openLessonFormModal(null, null, '${id}')">✏️ Редактировать</button>
    </div>
  `);
}

// ─── LESSON FORM MODAL ────────────────────────────────────────────────────────

export function openLessonFormModal(date = null, e = null, editId = null) {
  if (e && e.target && e.target.classList.contains('cal-event')) return;
  const l = editId ? dbFind('lessons', editId) : null;

  modal('lesson-form-modal', `
    <div class="modal-title">${l ? 'Редактировать урок' : 'Новый урок'}</div>
    <div class="form-row">
      <div class="fg"><label>Ученик / Группа</label>
        <select class="fi" id="lf-target">
          <optgroup label="Ученики">
            ${CACHE.students.filter(s=>s.status==='active'||s.status==='trial').map(s =>
              `<option value="s:${s.id}" ${l?.studentId===s.id?'selected':''}>${s.name}</option>`
            ).join('')}
          </optgroup>
          <optgroup label="Группы">
            ${CACHE.groups.map(g =>
              `<option value="g:${g.id}" ${l?.groupId===g.id?'selected':''}>${g.name}</option>`
            ).join('')}
          </optgroup>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Дата *</label><input class="fi" id="lf-date" type="date" value="${l?.date || date || today()}"></div>
      <div class="fg"><label>Начало</label><input class="fi" id="lf-start" type="time" value="${l?.startTime || '10:00'}"></div>
      <div class="fg"><label>Конец</label><input class="fi" id="lf-end" type="time" value="${l?.endTime || '11:00'}"></div>
    </div>
    <div class="fg"><label>Тема</label><input class="fi" id="lf-topic" value="${l?.topic || ''}"></div>
    <div class="fg"><label>ДЗ</label><input class="fi" id="lf-hw" value="${l?.homework || ''}"></div>
    <div class="form-row">
      <div class="fg"><label>Сложность</label>
        <select class="fi" id="lf-diff">
          <option value="">—</option>
          <option value="easy" ${l?.difficulty==='easy'?'selected':''}>Лёгкий</option>
          <option value="med" ${l?.difficulty==='med'?'selected':''}>Средний</option>
          <option value="hard" ${l?.difficulty==='hard'?'selected':''}>Сложный</option>
        </select>
      </div>
      <div class="fg"><label>Настроение</label>
        <select class="fi" id="lf-mood">
          <option value="">—</option>
          ${[1,2,3,4,5].map(n=>`<option value="${n}" ${l?.mood==n?'selected':''}>${['😞','😕','😐','🙂','😄'][n-1]} ${n}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label>Посетил</label>
        <select class="fi" id="lf-attended">
          <option value="">—</option>
          <option value="true" ${l?.attended===true?'selected':''}>Да</option>
          <option value="false" ${l?.attended===false?'selected':''}>Пропуск</option>
        </select>
      </div>
    </div>
    <div class="fg"><label>Статус ДЗ</label>
      <select class="fi" id="lf-hwstatus">
        <option value="">—</option>
        <option value="done" ${l?.hwStatus==='done'?'selected':''}>Сделано</option>
        <option value="partial" ${l?.hwStatus==='partial'?'selected':''}>Частично</option>
        <option value="miss" ${l?.hwStatus==='miss'?'selected':''}>Не сделано</option>
      </select>
    </div>
    <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-bottom:10px">
      <input type="checkbox" id="lf-trial" ${l?.isTrial?'checked':''}> Пробный урок
    </label>
    <div class="fg"><label>Заметки</label><textarea class="fi" id="lf-notes" rows="2">${l?.notes || ''}</textarea></div>
    <div class="modal-footer">
      ${l ? `<button class="btn btn-danger" onclick="window.__deleteLessonFromCal('${l.id}')">Удалить</button>` : ''}
      <button class="btn" onclick="window.__closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="window.__saveLessonForm('${editId||''}')">Сохранить</button>
    </div>
  `, { size: 'lg' });
}

export function saveLessonForm(editId) {
  const targetVal = document.getElementById('lf-target')?.value || '';
  const [ttype, tid] = targetVal.split(':');
  const date = document.getElementById('lf-date')?.value;
  if (!date) { toast('Укажите дату'); return; }

  const attendedRaw = document.getElementById('lf-attended')?.value;

  const patch = {
    studentId: ttype === 's' ? tid : null,
    groupId: ttype === 'g' ? tid : null,
    date,
    startTime: document.getElementById('lf-start')?.value || '',
    endTime: document.getElementById('lf-end')?.value || '',
    topic: document.getElementById('lf-topic')?.value?.trim() || '',
    homework: document.getElementById('lf-hw')?.value?.trim() || '',
    difficulty: document.getElementById('lf-diff')?.value || null,
    mood: document.getElementById('lf-mood')?.value ? +document.getElementById('lf-mood').value : null,
    attended: attendedRaw === 'true' ? true : attendedRaw === 'false' ? false : null,
    hwStatus: document.getElementById('lf-hwstatus')?.value || null,
    isTrial: document.getElementById('lf-trial')?.checked || false,
    notes: document.getElementById('lf-notes')?.value?.trim() || '',
    cancelled: false,
  };

  if (editId) {
    dbUpdate('lessons', editId, patch);
    addHistoryEntry({ action: 'update', table: 'lessons', recordId: editId, label: `Урок обновлён: ${patch.date}` });
  } else {
    const row = dbInsert('lessons', patch);
    addHistoryEntry({ action: 'create', table: 'lessons', recordId: row.id, label: `Урок добавлен: ${patch.date}` });
    if (patch.studentId) addEvent(patch.studentId, 'lesson_added', { date: patch.date });
  }

  // Update absences counter
  if (patch.studentId && patch.attended === false) {
    const s = dbFind('students', patch.studentId);
    if (s) dbUpdate('students', patch.studentId, { absences: (s.absences || 0) + 1 });
  }

  closeModal();
  toast('Урок сохранён');
  renderCalendar();
}

export function deleteLessonFromCal(id) {
  if (!confirm('Удалить урок?')) return;
  dbDelete('lessons', id);
  closeModal();
  toast('Урок удалён');
  renderCalendar();
}
