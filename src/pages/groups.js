import { CACHE, dbInsert, dbUpdate, dbDelete, dbFind } from '../core/store.js';
import { state } from '../core/state.js';
import { uid, fmt, fmtDate, today } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';

export function renderGroups() {
  const el = document.getElementById('groups-list');
  if (!el) return;

  if (state.groupDetailId) {
    renderGroupDetail(state.groupDetailId);
    return;
  }

  if (!CACHE.groups.length) {
    el.innerHTML = '<div class="empty">Нет групп. <button class="btn btn-p btn-sm" onclick="window.__openGroupModal()">+ Создать</button></div>';
    return;
  }

  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
    ${CACHE.groups.map(g => {
      const count = (g.studentIds || []).length;
      return `
        <div class="group-card" onclick="window.__openGroupDetail('${g.id}')">
          <div class="group-card-name">${g.name}</div>
          <div class="group-card-meta">
            <span><i class="ph-bold ph-book-open"></i>${g.subject || '—'}</span>
            <span><i class="ph-bold ph-user"></i>${g.teacher || '—'}</span>
            <span><i class="ph-bold ph-users"></i>${count}/${g.maxStudents || '∞'}</span>
            <span><i class="ph-bold ph-calendar"></i>${g.schedule || '—'}</span>
          </div>
        </div>
      `;
    }).join('')}
  </div>`;
}

export function openGroupDetail(id) {
  state.groupDetailId = id;
  renderGroupDetail(id);
}

export function closeGroupDetail() {
  state.groupDetailId = null;
  renderGroups();
}

export function renderGroupDetail(id) {
  const el = document.getElementById('groups-list');
  if (!el) return;
  const g = dbFind('groups', id);
  if (!g) { closeGroupDetail(); return; }

  const members = (g.studentIds || []).map(sid => CACHE.students.find(s => s.id === sid)).filter(Boolean);
  const lessons = CACHE.lessons.filter(l => l.groupId === id).sort((a,b) => b.date.localeCompare(a.date));

  el.innerHTML = `
    <div class="gd-header">
      <span class="gd-back" onclick="window.__closeGroupDetail()"><i class="ph-bold ph-arrow-left"></i> Назад</span>
      <div style="flex:1">
        <div class="gd-title">${g.name}</div>
        <div style="font-size:12px;color:var(--muted)">${g.subject || ''} · ${g.teacher || ''} · ${g.schedule || ''}</div>
      </div>
      <button class="btn btn-sm" onclick="window.__openGroupModal('${id}')">✏️</button>
      <button class="btn btn-p btn-sm" onclick="window.__openLessonModal(null,'${id}')">+ Урок</button>
    </div>

    <div class="two" style="gap:12px;margin-bottom:16px">
      <div class="card">
        <div class="an-section" style="margin-top:0">Участники (${members.length}/${g.maxStudents || '∞'})</div>
        ${members.length ? members.map(s => `
          <div class="member-row">
            <div class="member-name" onclick="window.__openStudentDetail('${s.id}')" style="cursor:pointer;color:var(--accent)">${s.name}</div>
            <span class="b b-gray" style="font-size:10px">${s.level || '—'}</span>
            <span style="font-size:11px;color:var(--muted)">${s.lessonRate ? fmt(s.lessonRate)+' ₽' : '—'}</span>
            <button class="btn btn-sm btn-danger" onclick="window.__removeStudentFromGroup('${id}','${s.id}')">✕</button>
          </div>
        `).join('') : '<div class="empty" style="padding:8px 0">Нет участников</div>'}
        <div style="margin-top:8px">
          <select class="fi" id="add-member-select" style="width:calc(100% - 80px);display:inline-block">
            <option value="">Добавить ученика...</option>
            ${CACHE.students.filter(s => s.status==='active' && !g.studentIds?.includes(s.id)).map(s =>
              `<option value="${s.id}">${s.name}</option>`
            ).join('')}
          </select>
          <button class="btn btn-sm" onclick="window.__addStudentToGroup('${id}')">Добавить</button>
        </div>
      </div>

      <div class="card">
        <div class="an-section" style="margin-top:0">Журнал уроков</div>
        <div class="lesson-journal">
          <div class="lj-row lj-head">
            <span>Дата</span><span>Тема</span><span>Сложность</span><span>Настрой</span><span>ДЗ</span><span></span>
          </div>
          ${lessons.slice(0,10).map(l => `
            <div class="lj-row ${l.cancelled?'lj-cancelled':''}" onclick="window.__openLessonModal('${l.id}','${id}')">
              <span>${fmtDate(l.date)}</span>
              <span class="lj-topic">${l.cancelled ? '[Отменён] ' : ''}${l.topic || '—'}</span>
              <span>${l.difficulty ? `<span class="chip chip-${l.difficulty}">${l.difficulty==='easy'?'Лёгкий':l.difficulty==='med'?'Средний':'Сложный'}</span>` : '—'}</span>
              <span>${l.mood ? ['','😞','😕','😐','🙂','😄'][l.mood] : '—'}</span>
              <span>${l.hwStatus || '—'}</span>
              <span><button class="btn btn-sm btn-danger" onclick="event.stopPropagation();window.__deleteLesson('${l.id}','${id}')">✕</button></span>
            </div>
          `).join('') || '<div class="empty" style="padding:10px 0">Уроков нет</div>'}
        </div>
      </div>
    </div>
  `;
}

export function openGroupModal(id = null) {
  const g = id ? dbFind('groups', id) : null;
  modal('group-modal', `
    <div class="modal-title">${g ? 'Редактировать группу' : 'Новая группа'}</div>
    <div class="form-row">
      <div class="fg"><label>Название *</label><input class="fi" id="gm-name" value="${g?.name || ''}" placeholder="Матем B1 (утро)"></div>
      <div class="fg"><label>Предмет</label><input class="fi" id="gm-subject" value="${g?.subject || ''}"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Педагог</label><input class="fi" id="gm-teacher" value="${g?.teacher || ''}"></div>
      <div class="fg"><label>Уровень</label><input class="fi" id="gm-level" value="${g?.level || ''}"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Расписание</label><input class="fi" id="gm-schedule" value="${g?.schedule || ''}" placeholder="Пн/Ср 10:00"></div>
      <div class="fg"><label>Макс. учеников</label><input class="fi" id="gm-max" type="number" value="${g?.maxStudents || 8}"></div>
    </div>
    <div class="fg"><label>Стоимость урока (₽/чел)</label><input class="fi" id="gm-rate" type="number" value="${g?.rate || 700}"></div>
    <div class="modal-footer">
      ${g ? `<button class="btn btn-danger" onclick="window.__deleteGroup('${g.id}')">Удалить</button>` : ''}
      <button class="btn" onclick="window.__closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="window.__saveGroup('${id||''}')">Сохранить</button>
    </div>
  `);
}

export function saveGroup(id) {
  const name = document.getElementById('gm-name')?.value?.trim();
  if (!name) { toast('Введите название'); return; }
  const patch = {
    name,
    subject: document.getElementById('gm-subject')?.value?.trim() || '',
    teacher: document.getElementById('gm-teacher')?.value?.trim() || '',
    level: document.getElementById('gm-level')?.value?.trim() || '',
    schedule: document.getElementById('gm-schedule')?.value?.trim() || '',
    maxStudents: +document.getElementById('gm-max')?.value || 8,
    rate: +document.getElementById('gm-rate')?.value || 0,
  };
  if (id) {
    dbUpdate('groups', id, patch);
    addHistoryEntry({ action: 'update', table: 'groups', recordId: id, label: `Группа обновлена: ${name}` });
  } else {
    const row = dbInsert('groups', { ...patch, studentIds: [] });
    addHistoryEntry({ action: 'create', table: 'groups', recordId: row.id, label: `Создана группа: ${name}` });
  }
  closeModal();
  toast('Сохранено');
  renderGroups();
}

export function deleteGroup(id) {
  if (!confirm('Удалить группу?')) return;
  const g = dbFind('groups', id);
  dbDelete('groups', id);
  addHistoryEntry({ action: 'delete', table: 'groups', recordId: id, before: g, label: `Удалена группа: ${g?.name}` });
  state.groupDetailId = null;
  closeModal();
  toast('Группа удалена');
  renderGroups();
}

export function addStudentToGroup(groupId) {
  const sid = document.getElementById('add-member-select')?.value;
  if (!sid) return;
  const g = dbFind('groups', groupId);
  if (!g) return;
  const ids = [...(g.studentIds || [])];
  if (!ids.includes(sid)) ids.push(sid);
  dbUpdate('groups', groupId, { studentIds: ids });
  toast('Ученик добавлен');
  renderGroupDetail(groupId);
}

export function removeStudentFromGroup(groupId, studentId) {
  const g = dbFind('groups', groupId);
  if (!g) return;
  dbUpdate('groups', groupId, { studentIds: (g.studentIds || []).filter(id => id !== studentId) });
  toast('Ученик удалён из группы');
  renderGroupDetail(groupId);
}

// ─── LESSON MODAL ────────────────────────────────────────────────────────────

export function openLessonModal(lessonId = null, groupId = null) {
  const l = lessonId ? dbFind('lessons', lessonId) : null;
  const gid = groupId || l?.groupId;
  const group = gid ? dbFind('groups', gid) : null;
  const members = group ? (group.studentIds || []).map(sid => CACHE.students.find(s => s.id === sid)).filter(Boolean) : [];

  modal('lesson-modal', `
    <div class="modal-title">${l ? 'Редактировать урок' : 'Новый урок'} ${group ? '— ' + group.name : ''}</div>
    <div class="form-row">
      <div class="fg"><label>Дата *</label><input class="fi" id="lm-date" type="date" value="${l?.date || today()}"></div>
      <div class="fg"><label>Начало</label><input class="fi" id="lm-start" type="time" value="${l?.startTime || '10:00'}"></div>
      <div class="fg"><label>Конец</label><input class="fi" id="lm-end" type="time" value="${l?.endTime || '11:00'}"></div>
    </div>
    <div class="fg"><label>Тема</label><input class="fi" id="lm-topic" value="${l?.topic || ''}" placeholder="Тема урока"></div>
    <div class="fg"><label>Домашнее задание</label><input class="fi" id="lm-hw" value="${l?.homework || ''}"></div>
    <div class="form-row">
      <div class="fg"><label>Сложность</label>
        <select class="fi" id="lm-diff">
          <option value="">—</option>
          <option value="easy" ${l?.difficulty==='easy'?'selected':''}>Лёгкий</option>
          <option value="med" ${l?.difficulty==='med'?'selected':''}>Средний</option>
          <option value="hard" ${l?.difficulty==='hard'?'selected':''}>Сложный</option>
        </select>
      </div>
      <div class="fg"><label>Настроение (1–5)</label>
        <select class="fi" id="lm-mood">
          <option value="">—</option>
          ${[1,2,3,4,5].map(n=>`<option value="${n}" ${l?.mood==n?'selected':''}>${['😞','😕','😐','🙂','😄'][n-1]} ${n}</option>`).join('')}
        </select>
      </div>
    </div>
    ${members.length ? `
      <div class="an-section">Посещаемость</div>
      <div class="att-grid" id="att-grid">
        ${members.map(s => {
          const att = l?.attendance?.[s.id] || '';
          return `<div class="att-row">
            <div class="att-name">${s.name}</div>
            <div class="att-btns">
              <button class="att-btn ${att==='present'?'on-present':''}" onclick="this.parentNode.querySelectorAll('.att-btn').forEach(b=>b.className='att-btn');this.className='att-btn on-present'" data-sid="${s.id}" data-val="present">Был</button>
              <button class="att-btn ${att==='late'?'on-late':''}" onclick="this.parentNode.querySelectorAll('.att-btn').forEach(b=>b.className='att-btn');this.className='att-btn on-late'" data-sid="${s.id}" data-val="late">Опоздал</button>
              <button class="att-btn ${att==='absent'?'on-absent':''}" onclick="this.parentNode.querySelectorAll('.att-btn').forEach(b=>b.className='att-btn');this.className='att-btn on-absent'" data-sid="${s.id}" data-val="absent">Пропуск</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    ` : ''}
    <div class="fg"><label>Заметки</label><textarea class="fi" id="lm-notes" rows="2">${l?.notes || ''}</textarea></div>
    <div class="modal-footer">
      ${l ? `<button class="btn btn-danger" onclick="window.__deleteLesson('${l.id}','${gid||''}')">Удалить</button>` : ''}
      <button class="btn" onclick="window.__closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="window.__saveLesson('${lessonId||''}','${gid||''}')">Сохранить</button>
    </div>
  `, { size: 'lg' });
}

export function saveLesson(lessonId, groupId) {
  const date = document.getElementById('lm-date')?.value;
  if (!date) { toast('Укажите дату'); return; }

  // Collect attendance
  const attendance = {};
  document.querySelectorAll('#att-grid .att-btn.on-present, #att-grid .att-btn.on-late, #att-grid .att-btn.on-absent').forEach(btn => {
    const sid = btn.dataset.sid;
    const val = btn.dataset.val;
    if (sid && val) attendance[sid] = val;
  });

  const patch = {
    date,
    startTime: document.getElementById('lm-start')?.value || '',
    endTime: document.getElementById('lm-end')?.value || '',
    topic: document.getElementById('lm-topic')?.value?.trim() || '',
    homework: document.getElementById('lm-hw')?.value?.trim() || '',
    difficulty: document.getElementById('lm-diff')?.value || null,
    mood: document.getElementById('lm-mood')?.value ? +document.getElementById('lm-mood').value : null,
    notes: document.getElementById('lm-notes')?.value?.trim() || '',
    attendance,
    groupId: groupId || null,
  };

  if (lessonId) {
    dbUpdate('lessons', lessonId, patch);
  } else {
    dbInsert('lessons', patch);
  }

  closeModal();
  toast('Урок сохранён');
  if (groupId) renderGroupDetail(groupId);
}

export function deleteLesson(lessonId, groupId) {
  if (!confirm('Удалить урок?')) return;
  dbDelete('lessons', lessonId);
  closeModal();
  toast('Урок удалён');
  if (groupId) renderGroupDetail(groupId);
}
