import { CACHE, dbInsert, dbUpdate, dbDelete, dbFind } from '../core/store.js';
import { state } from '../core/state.js';
import { uid, fmt, fmtDate, today, STATUS_CONFIG, PIPELINE_STAGES } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';
import { addEvent, studentEvents, eventLabel } from '../core/events.js';
import { calcRiskScore, riskBadge, renderSubscriptionBadge } from '../core/risk.js';

// ─── CRM LIST VIEW ──────────────────────────────────────────────────────────

export function renderStudents() {
  if (state.crmView === 'pipeline') {
    renderPipeline();
  } else {
    renderCRMStudents();
  }
}

export function renderCRMStudents() {
  const el = document.getElementById('crm-list');
  if (!el) return;

  const filter = state.crmStatusFilter || 'all';
  let students = [...CACHE.students];
  if (filter !== 'all') students = students.filter(s => s.status === filter);

  const search = document.getElementById('crm-search')?.value?.toLowerCase() || '';
  if (search) students = students.filter(s =>
    s.name?.toLowerCase().includes(search) ||
    s.subject?.toLowerCase().includes(search) ||
    s.teacher?.toLowerCase().includes(search)
  );

  if (!students.length) {
    el.innerHTML = '<div class="empty">Нет учеников</div>';
    return;
  }

  el.innerHTML = `
    <table class="tbl-wrap" style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th>Ученик</th><th>Предмет</th><th>Педагог</th><th>Статус</th>
        <th>Риск</th><th>Подписка</th><th>Баланс</th><th></th>
      </tr></thead>
      <tbody>
        ${students.map(s => {
          const score = calcRiskScore(s);
          const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.lead;
          return `<tr onclick="window.__openStudentDetail('${s.id}')" style="cursor:pointer">
            <td><strong>${s.name}</strong><br><span style="font-size:11px;color:var(--muted)">${s.phone || ''}</span></td>
            <td>${s.subject || '—'}</td>
            <td>${s.teacher || '—'}</td>
            <td><span class="b ${cfg.cls}">${cfg.label}</span></td>
            <td>${riskBadge(score)}</td>
            <td>${renderSubscriptionBadge(s)}</td>
            <td>${s.balance ? fmt(s.balance) + ' ₽' : '—'}</td>
            <td><button class="btn btn-sm" onclick="event.stopPropagation();window.__openStudentModal('${s.id}')">✏️</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

export function setCRMView(view) {
  state.crmView = view;
  document.querySelectorAll('#pg-crm_students .view-toggle button').forEach(b => {
    b.classList.toggle('on', b.dataset.view === view);
  });
  renderStudents();
}

export function setCRMStatusFilter(f) {
  state.crmStatusFilter = f;
  document.querySelectorAll('#crm-status-filter button').forEach(b => {
    b.classList.toggle('on', b.dataset.status === f);
  });
  renderCRMStudents();
}

// ─── PIPELINE ────────────────────────────────────────────────────────────────

export function renderPipeline() {
  const el = document.getElementById('crm-list');
  if (!el) return;

  el.innerHTML = `<div class="pipeline-board">
    ${PIPELINE_STAGES.map(stage => {
      const cards = CACHE.students.filter(s => s.pipelineStage === stage.id || s.status === stage.id);
      return `
        <div class="pipeline-col">
          <div class="pipeline-col-head" style="background:var(--surface2)">
            ${stage.label} <span class="b b-gray">${cards.length}</span>
          </div>
          <div class="pipeline-col-body">
            ${cards.length ? cards.map(s => {
              const score = calcRiskScore(s);
              const riskCls = score >= 70 ? 'risk-high' : score >= 40 ? 'risk-med' : '';
              return `<div class="pipeline-card ${riskCls}" onclick="window.__openStudentDetail('${s.id}')">
                <div class="pipeline-card-name">${s.name}</div>
                <div style="font-size:11px;color:var(--muted)">${s.subject || ''}</div>
                <div class="pipeline-card-meta">
                  ${riskBadge(score)}
                  ${s.nextLesson ? `<span class="b b-gray" style="font-size:10px">${fmtDate(s.nextLesson)}</span>` : ''}
                </div>
              </div>`;
            }).join('') : '<div class="pipeline-empty">Нет учеников</div>'}
          </div>
        </div>
      `;
    }).join('')}
  </div>`;
}

// ─── STUDENT MODAL (CREATE / EDIT) ───────────────────────────────────────────

export function openStudentModal(id = null) {
  const s = id ? dbFind('students', id) : null;
  const title = s ? 'Редактировать ученика' : 'Новый ученик';

  modal('student-modal', `
    <div class="modal-title">${title}</div>
    <div class="form-row">
      <div class="fg"><label>Имя *</label><input class="fi" id="sm-name" value="${s?.name || ''}" placeholder="Иванова Алиса"></div>
      <div class="fg"><label>Телефон</label><input class="fi" id="sm-phone" value="${s?.phone || ''}" placeholder="+7 900 000-00-00"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Email</label><input class="fi" id="sm-email" value="${s?.email || ''}" type="email"></div>
      <div class="fg"><label>Предмет</label><input class="fi" id="sm-subject" value="${s?.subject || ''}" placeholder="Математика"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Педагог</label><input class="fi" id="sm-teacher" value="${s?.teacher || ''}"></div>
      <div class="fg"><label>Уровень</label><input class="fi" id="sm-level" value="${s?.level || ''}" placeholder="B1"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Статус</label>
        <select class="fi" id="sm-status">
          ${Object.entries(STATUS_CONFIG).map(([k,v]) => `<option value="${k}" ${s?.status===k?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label>Стоимость урока (₽)</label><input class="fi" id="sm-rate" type="number" value="${s?.lessonRate || 1500}"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Длительность (мин)</label><input class="fi" id="sm-dur" type="number" value="${s?.lessonDuration || 60}"></div>
      <div class="fg"><label>Уроков в неделю</label><input class="fi" id="sm-freq" type="number" value="${s?.lessonsPerWeek || 2}"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Тип подписки</label>
        <select class="fi" id="sm-subtype">
          <option value="">Нет</option>
          <option value="monthly" ${s?.subscriptionType==='monthly'?'selected':''}>Помесячная</option>
          <option value="lessons" ${s?.subscriptionType==='lessons'?'selected':''}>Поурочная</option>
        </select>
      </div>
      <div class="fg"><label>Конец подписки</label><input class="fi" id="sm-subend" type="date" value="${s?.subscriptionEnd || ''}"></div>
    </div>
    <div class="fg"><label>Заметки</label><textarea class="fi" id="sm-notes" rows="2">${s?.notes || ''}</textarea></div>
    <div class="modal-footer">
      ${s ? `<button class="btn btn-danger" onclick="window.__deleteStudent('${s.id}')">Удалить</button>` : ''}
      <button class="btn" onclick="window.__closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="window.__saveStudent('${id||''}')">Сохранить</button>
    </div>
  `, { size: 'lg' });
}

export function saveStudent(id) {
  const name = document.getElementById('sm-name')?.value?.trim();
  if (!name) { toast('Введите имя'); return; }

  const patch = {
    name,
    phone: document.getElementById('sm-phone')?.value?.trim() || '',
    email: document.getElementById('sm-email')?.value?.trim() || '',
    subject: document.getElementById('sm-subject')?.value?.trim() || '',
    teacher: document.getElementById('sm-teacher')?.value?.trim() || '',
    level: document.getElementById('sm-level')?.value?.trim() || '',
    status: document.getElementById('sm-status')?.value || 'lead',
    lessonRate: +document.getElementById('sm-rate')?.value || 0,
    lessonDuration: +document.getElementById('sm-dur')?.value || 60,
    lessonsPerWeek: +document.getElementById('sm-freq')?.value || 1,
    subscriptionType: document.getElementById('sm-subtype')?.value || null,
    subscriptionEnd: document.getElementById('sm-subend')?.value || null,
    notes: document.getElementById('sm-notes')?.value?.trim() || '',
  };

  if (id) {
    const before = { ...dbFind('students', id) };
    dbUpdate('students', id, patch);
    addHistoryEntry({ action: 'update', table: 'students', recordId: id, before, after: patch, label: `Обновлён: ${name}` });
  } else {
    const row = dbInsert('students', { ...patch, pipelineStage: patch.status, absences: 0, hwMissed: 0, paymentDelay: 0, balance: 0, totalPaid: 0 });
    addHistoryEntry({ action: 'create', table: 'students', recordId: row.id, label: `Добавлен: ${name}` });
    addEvent(row.id, 'status_change', { to: patch.status, note: 'Создан' });
  }

  closeModal();
  toast('Сохранено');
  renderStudents();
}

export function deleteStudent(id) {
  if (!confirm('Удалить ученика? Это действие нельзя отменить.')) return;
  const s = dbFind('students', id);
  dbDelete('students', id);
  addHistoryEntry({ action: 'delete', table: 'students', recordId: id, before: s, label: `Удалён: ${s?.name}` });
  closeModal();
  toast('Ученик удалён');
  renderStudents();
}

// ─── STUDENT DETAIL ───────────────────────────────────────────────────────────

export function openStudentDetail(id) {
  const s = dbFind('students', id);
  if (!s) return;
  state.studentDetailId = id;

  const lessons = CACHE.lessons.filter(l => l.studentId === id).sort((a,b) => b.date.localeCompare(a.date));
  const payments = CACHE.payments.filter(p => p.studentId === id).sort((a,b) => b.date.localeCompare(a.date));
  const events = studentEvents(id);
  const score = calcRiskScore(s);
  const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.lead;

  modal('student-detail-modal', `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="flex:1">
        <div class="modal-title" style="margin-bottom:4px">${s.name}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <span class="b ${cfg.cls}">${cfg.label}</span>
          ${riskBadge(score)}
          ${renderSubscriptionBadge(s)}
        </div>
      </div>
      <button class="btn btn-sm" onclick="window.__openStudentModal('${id}')">✏️ Редактировать</button>
    </div>

    <div class="two" style="gap:8px;margin-bottom:12px">
      <div class="card" style="padding:12px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Контакты</div>
        <div style="font-size:13px">${s.phone || '—'}</div>
        <div style="font-size:13px;color:var(--muted)">${s.email || '—'}</div>
      </div>
      <div class="card" style="padding:12px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Обучение</div>
        <div style="font-size:13px">${s.subject || '—'} · ${s.teacher || '—'}</div>
        <div style="font-size:12px;color:var(--muted)">${s.lessonRate ? fmt(s.lessonRate)+' ₽/урок' : ''} · ${s.lessonsPerWeek || 0} р/нед</div>
      </div>
      <div class="card" style="padding:12px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Финансы</div>
        <div style="font-size:13px">Баланс: <strong>${fmt(s.balance || 0)} ₽</strong></div>
        <div style="font-size:12px;color:var(--muted)">Всего: ${fmt(s.totalPaid || 0)} ₽</div>
      </div>
      <div class="card" style="padding:12px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Риски</div>
        <div style="font-size:13px">Пропусков: ${s.absences || 0} · ДЗ: ${s.hwMissed || 0}</div>
        <div style="font-size:12px;color:var(--muted)">Задолж.: ${s.paymentDelay || 0} дн.</div>
      </div>
    </div>

    ${s.notes ? `<div class="alert alert-b" style="margin-bottom:12px"><i class="ph-bold ph-note"></i>${s.notes}</div>` : ''}

    <div class="an-section">Последние уроки</div>
    ${lessons.slice(0,5).map(l => `
      <div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span style="color:var(--muted);width:70px;flex-shrink:0">${fmtDate(l.date)}</span>
        <span style="flex:1">${l.topic || 'Тема не указана'}</span>
        <span class="b ${l.attended===false?'b-r':l.attended?'b-g':'b-gray'}" style="font-size:10px">${l.attended===false?'Пропуск':l.attended?'Был':'—'}</span>
      </div>
    `).join('') || '<div class="empty" style="padding:8px 0">Уроков нет</div>'}

    <div class="an-section" style="margin-top:14px">Платежи</div>
    ${payments.slice(0,4).map(p => `
      <div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span style="color:var(--muted);width:70px;flex-shrink:0">${fmtDate(p.date)}</span>
        <span class="amount-pos">${fmt(p.amount)} ₽</span>
        <span style="color:var(--muted)">${p.comment || ''}</span>
      </div>
    `).join('') || '<div class="empty" style="padding:8px 0">Платежей нет</div>'}

    <div class="an-section" style="margin-top:14px">История</div>
    <div class="timeline">
      ${events.slice(0,8).map(ev => `
        <div class="tl-item">
          <div class="tl-dot-wrap"><div class="tl-dot"></div></div>
          <div class="tl-body">
            <div class="tl-event">${eventLabel(ev)}</div>
            <div class="tl-meta">${ev.actor} · ${new Date(ev.createdAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
          </div>
        </div>
      `).join('') || '<div class="empty" style="padding:8px 0">Нет событий</div>'}
    </div>

    <div class="modal-footer">
      <button class="btn" onclick="window.__closeModal()">Закрыть</button>
      <button class="btn btn-p" onclick="window.__openPaymentModalFor('${id}')">+ Платёж</button>
    </div>
  `, { size: 'xl' });
}

export function openStatusDateModal(studentId, newStatus) {
  modal('status-date-modal', `
    <div class="modal-title">Изменить статус</div>
    <div class="fg"><label>Дата перехода</label><input class="fi" id="sd-date" type="date" value="${today()}"></div>
    <div class="fg"><label>Комментарий</label><input class="fi" id="sd-note" placeholder="Причина..."></div>
    <div class="modal-footer">
      <button class="btn" onclick="window.__closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="window.__confirmStatusChange('${studentId}','${newStatus}')">Применить</button>
    </div>
  `);
}

export function confirmStatusChange(studentId, newStatus) {
  const date = document.getElementById('sd-date')?.value || today();
  const note = document.getElementById('sd-note')?.value?.trim() || '';
  const before = { ...dbFind('students', studentId) };
  dbUpdate('students', studentId, { status: newStatus, pipelineStage: newStatus, statusDate: date, statusNote: note });
  addEvent(studentId, 'status_change', { from: before.status, to: newStatus, note, date });
  addHistoryEntry({ action: 'update', table: 'students', recordId: studentId, before, label: `Статус → ${newStatus}: ${before.name}` });
  closeModal();
  toast('Статус обновлён');
  renderStudents();
}

export function openPaymentModalFor(studentId) {
  const s = dbFind('students', studentId);
  modal('payment-modal', `
    <div class="modal-title">Добавить платёж — ${s?.name || ''}</div>
    <div class="form-row">
      <div class="fg"><label>Сумма (₽) *</label><input class="fi" id="pm-amount" type="number" placeholder="3600"></div>
      <div class="fg"><label>Дата</label><input class="fi" id="pm-date" type="date" value="${today()}"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Способ</label>
        <select class="fi" id="pm-method">
          <option value="card">Карта</option>
          <option value="cash">Наличные</option>
          <option value="transfer">Перевод</option>
        </select>
      </div>
      <div class="fg"><label>Комментарий</label><input class="fi" id="pm-comment" placeholder="4 урока"></div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="window.__closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="window.__savePaymentFor('${studentId}')">Сохранить</button>
    </div>
  `);
}

export function savePaymentFor(studentId) {
  const amount = +document.getElementById('pm-amount')?.value;
  if (!amount) { toast('Введите сумму'); return; }
  const date = document.getElementById('pm-date')?.value || today();
  const method = document.getElementById('pm-method')?.value || 'card';
  const comment = document.getElementById('pm-comment')?.value?.trim() || '';

  const row = dbInsert('payments', { studentId, amount, date, method, comment });
  // Update student balance
  const s = dbFind('students', studentId);
  if (s) dbUpdate('students', studentId, { balance: (s.balance || 0) + amount, totalPaid: (s.totalPaid || 0) + amount, paymentDelay: 0 });

  addEvent(studentId, 'payment_added', { amount, date });
  addHistoryEntry({ action: 'create', table: 'payments', recordId: row.id, label: `Платёж ${fmt(amount)} ₽ — ${s?.name}` });
  closeModal();
  toast(`Платёж ${fmt(amount)} ₽ добавлен`);

  // Re-render income page if visible
  import('./income.js').then(m => {
    if (document.getElementById('pg-income')?.classList.contains('on')) m.renderIncome();
  });
}
