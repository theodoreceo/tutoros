import { CACHE, dbInsert, dbUpdate, dbDelete, ensureLoaded } from '../core/store.js';
import { state } from '../core/state.js';
import { uid, fmt, fmtDate, today, g, STATUS_CONFIG, PIPELINE_STAGES, esc } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';
import { addEvent, studentEvents } from '../core/events.js';
import { calcRiskScore, riskBadge, renderSubscriptionBadge, studentSubscriptionStatus, recalcRisk } from '../core/risk.js';

const genToken = () => Math.random().toString(36).slice(2, 8);

function groupShort(id) {
  const gr = (CACHE.groups || []).find(x => x.id === id);
  return gr ? gr.name.slice(0, 24) + (gr.name.length > 24 ? '…' : '') : '—';
}

export function setCRMView() {}

export function setCRMStatusFilter(status) {
  import('../core/router.js').then(({ navigate }) => navigate('students'));
  setTimeout(() => {
    const el = document.getElementById('student-status-filter');
    if (el) { el.value = status; renderStudents(); }
  }, 50);
}

// CRM — полная таблица всех учеников
export async function renderStudents() {
  await ensureLoaded(['students', 'groups', 'payments', 'student_notes', 'events']);
  const isCurator = (state.currentRole?.role_type === 'curator');
  const gf = document.getElementById('student-filter');
  if (gf) gf.innerHTML = '<option value="">Все группы</option>' + (CACHE.groups || []).map(g => `<option value="${esc(g.id)}">${esc(g.name.slice(0, 30))}</option>`).join('');
  const search = ((document.getElementById('student-search') || {}).value || '').toLowerCase();
  const gFilter = (document.getElementById('student-filter') || {}).value || '';
  const stFilter = (document.getElementById('student-status-filter') || {}).value || '';
  let students = (CACHE.students || []).filter(s => {
    if (search && !s.name.toLowerCase().includes(search) && !(s.contact || '').toLowerCase().includes(search)) return false;
    if (gFilter && s.group_id !== gFilter) return false;
    if (stFilter && s.crm_status !== stFilter) return false;
    return true;
  });
  const tbody = document.getElementById('students-tbody');
  const empty = document.getElementById('students-empty');
  if (!tbody) return;
  if (!students.length) { tbody.innerHTML = ''; if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';
  const role = state.currentRole || {};
  const canEdit = role.canEdit || role.isOwner;
  // Toggle financial columns visibility (hidden for curator and non-owner)
  document.querySelectorAll('.fin-col').forEach(el => { el.style.display = (role.isOwner && !isCurator) ? '' : 'none'; });
  tbody.innerHTML = students.map(s => {
    const st = STATUS_CONFIG[s.crm_status] || STATUS_CONFIG['lead'];
    const ltv = (s.price_per_hour || 0) * (s.lessons_per_month || 0);
    const contact = s.contact || s.phone || '—';
    const subBadge = renderSubscriptionBadge(s);
    const { level } = calcRiskScore(s);
    const resetBtn = level !== 'low' ? `<button class="btn btn-sm" style="font-size:10px;padding:2px 6px" data-action="resetStudentRisk" data-id="${esc(s.id)}" onclick="event.stopPropagation()" title="Сбросить риск"><i class="ti ti-refresh"></i></button>` : '';
    return `<tr style="cursor:pointer" data-action="openStudentDetail" data-id="${esc(s.id)}">
      <td><span class="b ${st.cls}"><i class="ti ${st.icon}" style="font-size:11px;margin-right:3px"></i>${st.label}</span></td>
      <td><b>${esc(s.name)}</b><br><span style="font-size:11px;color:var(--muted)">${esc(s.source || '')}</span></td>
      <td>${s.grade}</td>
      <td style="max-width:140px;word-break:break-all"><span style="font-size:12px">${contact}</span></td>
      <td><span class="b ${s.format === 'individual' ? 'b-bl' : 'b-gray'}">${s.format === 'individual' ? 'Инд' : 'Группа'}</span><br><span style="font-size:11px;color:var(--muted)">${groupShort(s.group_id)}</span></td>
      <td>${subBadge}</td>
      ${!isCurator ? `<td class="fin-col" style="text-align:right;${role.isOwner ? '' : 'display:none'}">${s.price_per_hour ? fmt(s.price_per_hour) + ' ₽' : '—'}</td>
      <td class="fin-col" style="text-align:center;${role.isOwner ? '' : 'display:none'}">${s.lessons_per_month ?? '—'}</td>
      <td class="fin-col" style="text-align:right;font-weight:600;color:var(--green);${role.isOwner ? '' : 'display:none'}">${ltv ? fmt(ltv) + ' ₽/мес' : '—'}</td>` : ''}
      <td>${s.trial_score || '—'} → <b>${s.target_score || '—'}</b></td>
      <td style="white-space:nowrap">${riskBadge(s)} ${resetBtn}</td>
      <td style="white-space:nowrap" onclick="event.stopPropagation()">${canEdit ? `<button class="btn btn-sm btn-icon" data-action="editStudent" data-id="${esc(s.id)}"><i class="ti ti-edit"></i></button>
        <button class="btn btn-sm btn-icon" data-action="deleteStudent" data-id="${esc(s.id)}"><i class="ti ti-trash" style="color:var(--red)"></i></button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

// Воронка — pipeline без активных, с поиском и 30-дневным скрытием ушедших
export async function renderCRMStudents() {
  await ensureLoaded(['students', 'groups', 'payments', 'student_notes', 'events']);
  renderMarketingDash();
  renderPipeline();
}

function renderMarketingDash() {
  const el = document.getElementById('marketing-dash');
  if (!el) return;
  const students = CACHE.students || [];
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000);
  const leads = students.filter(s => s.crm_status === 'lead');
  const trials = students.filter(s => ['trial_scheduled', 'trial_done', 'trial'].includes(s.crm_status));
  const active = students.filter(s => s.crm_status === 'active').length;
  const stale = leads.filter(s => s.created_at && new Date(s.created_at) < weekAgo).length;
  const newLeads7d = leads.filter(s => s.created_at && new Date(s.created_at) >= weekAgo).length;
  const conv = students.length ? Math.round(active / students.length * 100) : 0;
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">
    ${[
      { icon: 'ti-user-question', label: 'Лидов', val: leads.length, sub: `+${newLeads7d} за 7 дней`, color: '#64748b' },
      { icon: 'ti-star',          label: 'На пробном', val: trials.length, sub: 'trial + назначен', color: '#d97706' },
      { icon: 'ti-trending-up',   label: 'Конверсия', val: conv + '%', sub: 'лид → активный', color: '#16a34a' },
      { icon: 'ti-clock-x',       label: 'Просрочено', val: stale, sub: 'лидов без движения 7д', color: stale ? '#ef4444' : '#94a3b8' },
    ].map(c => `<div class="card" style="padding:12px 14px;margin-bottom:0">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px"><i class="ti ${c.icon}" style="color:${c.color};margin-right:3px"></i>${c.label}</div>
      <div style="font-size:22px;font-weight:700;color:${c.color}">${c.val}</div>
      <div style="font-size:10px;color:var(--hint);margin-top:2px">${c.sub}</div>
    </div>`).join('')}
  </div>`;
}

export async function renderPipeline() {
  await ensureLoaded(['students', 'groups', 'payments', 'student_notes', 'events']);
  const board = document.getElementById('pipeline-board');
  if (!board) return;
  const role = state.currentRole || {};
  const search = ((document.getElementById('pipeline-search') || {}).value || '').toLowerCase();
  const now = Date.now();
  const cutoff30 = now - 30 * 86400000;

  board.innerHTML = PIPELINE_STAGES.map(stage => {
    const exitStatuses = ['stopped', 'refused', 'left'];
    let cards = (CACHE.students || []).filter(s => {
      // map both stopped and refused to the 'stopped' column
      if (stage.id === 'stopped') {
        if (s.crm_status !== 'stopped' && s.crm_status !== 'refused') return false;
      } else if (stage.id === 'trial_done') {
        if (s.crm_status !== 'trial_done' && s.crm_status !== 'trial') return false;
      } else {
        if (s.crm_status !== stage.id) return false;
      }
      // hide exit-status students older than 30 days
      if (exitStatuses.includes(s.crm_status) && s.left_at && new Date(s.left_at).getTime() < cutoff30) return false;
      return true;
    });
    if (search) cards = cards.filter(s => s.name.toLowerCase().includes(search) || (s.contact || '').toLowerCase().includes(search));

    const badge = stage.id === 'lead' && cards.filter(s => {
      const age = Math.round((now - new Date(s.created_at)) / 86400000);
      return age >= 3;
    }).length > 0 ? `<span style="background:#fffbeb;color:#92400e;border-radius:20px;font-size:10px;padding:1px 6px;font-weight:700">${cards.filter(s => Math.round((now - new Date(s.created_at)) / 86400000) >= 3).length}!</span>` : '';

    return `<div class="pipeline-col">
      <div class="pipeline-col-head" style="border-color:${stage.color}20;background:${stage.bg}">
        <span style="color:${stage.color}">${stage.label}</span>
        <div style="display:flex;align-items:center;gap:4px">
          ${badge}
          <span style="font-size:11px;color:#94a3b8;font-weight:400">${cards.length}</span>
        </div>
      </div>
      <div class="pipeline-col-body">
        ${cards.length ? cards.map(s => {
          const { level, reasons } = calcRiskScore(s);
          const riskCls = level === 'high' ? 'risk-high' : level === 'med' ? 'risk-med' : '';
          const contact = s.contact ? `<span style="font-size:10px;color:var(--hint)">${s.contact}</span>` : '';
          const tgIcon = s.telegram_id
            ? `<i class="ti ti-brand-telegram" style="color:#2aabee;font-size:11px" title="Telegram привязан"></i>`
            : s.reg_token
              ? `<span style="display:inline-flex;align-items:center;gap:3px;cursor:pointer" data-action="copyRegToken" data-token="${esc(s.reg_token)}" onclick="event.stopPropagation()" title="Скопировать код ${esc(s.reg_token)}"><i class="ti ti-brand-telegram" style="color:var(--muted);font-size:11px"></i><code style="font-size:10px;color:var(--muted)">${esc(s.reg_token)}</code></span>`
              : '';
          return `<div class="pipeline-card ${riskCls}" data-action="openStudentDetail" data-id="${esc(s.id)}">
            <div class="pipeline-card-name">${esc(s.name)}</div>
            <div style="font-size:11px;color:var(--muted)">${esc(s.source || '')} · ${s.grade || ''}кл</div>
            <div class="pipeline-card-meta">
              ${contact}
              ${level !== 'low' ? `<span class="risk-badge ${level}" style="font-size:9px;padding:1px 5px">${reasons[0] || ''}</span>` : ''}
              ${tgIcon}
            </div>
          </div>`;
        }).join('') : `<div class="pipeline-empty">Нет</div>`}
        ${role.isOwner && !['stopped','exam_passed','left'].includes(stage.id) ? `<div style="margin-top:4px"><button class="btn btn-sm" style="width:100%;justify-content:center;font-size:11px;color:var(--hint)" data-action="openStudentModal"><i class="ti ti-plus"></i></button></div>` : ''}
      </div>
    </div>`;
  }).join('');
}

export function openStudentModal(id) {
  const s = id ? (CACHE.students || []).find(x => x.id === id) : null;
  const todayStr = today();
  const v = s || { name: '', contact: '', grade: '11', group_id: '', format: 'group', crm_status: 'lead', price_per_hour: '', lessons_per_month: '', paid: false, trial_score: '', target_score: '', source: 'Авито', notes: '', first_contact_at: todayStr };
  const gOpts = (CACHE.groups || []).map(gr => `<option value="${gr.id}" ${v.group_id === gr.id ? 'selected' : ''}>${gr.name}</option>`).join('');
  const ltv = (v.price_per_hour && v.lessons_per_month) ? (+v.price_per_hour * +v.lessons_per_month) : 0;
  modal(`<div class="modal"><div class="modal-title">${s ? 'Редактировать' : 'Добавить ученика'}</div>
    <div class="form-row">
      <div class="fg"><label>Имя</label><input class="fi" id="sf-name" value="${esc(v.name || '')}"></div>
      <div class="fg"><label>Контакт (ВКонтакте / WhatsApp / Telegram)</label><input class="fi" id="sf-contact" value="${esc(v.contact || v.phone || '')}" placeholder="@username или +7..."></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Статус</label><select class="fi" id="sf-status">
        <option value="lead" ${v.crm_status === 'lead' ? 'selected' : ''}>Лид</option>
        <option value="trial_scheduled" ${v.crm_status === 'trial_scheduled' ? 'selected' : ''}>Пробник назначен</option>
        <option value="trial_done" ${(v.crm_status === 'trial_done' || v.crm_status === 'trial') ? 'selected' : ''}>Пробник проведён</option>
        <option value="active" ${v.crm_status === 'active' ? 'selected' : ''}>Занимается</option>
        <option value="exam_passed" ${v.crm_status === 'exam_passed' ? 'selected' : ''}>Сдал экзамен</option>
        <option value="stopped" ${v.crm_status === 'stopped' ? 'selected' : ''}>Отказался (не начал)</option>
        <option value="left" ${v.crm_status === 'left' ? 'selected' : ''}>Ушел (бросил занятия)</option>
        <option value="refused" ${v.crm_status === 'refused' ? 'selected' : ''}>Отказался (устаревший)</option>
      </select></div>
      <div class="fg"><label>Первый контакт</label><input class="fi" type="date" id="sf-first-contact" value="${v.first_contact_at || todayStr}"></div>
      <div class="fg"><label>Класс</label><select class="fi" id="sf-grade">${[7, 8, 9, 10, 11].map(x => `<option ${v.grade == x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Формат</label><select class="fi" id="sf-format"><option value="group" ${v.format === 'group' ? 'selected' : ''}>Групповой</option><option value="individual" ${v.format === 'individual' ? 'selected' : ''}>Индивидуальный</option></select></div>
      <div class="fg"><label>Группа</label><select class="fi" id="sf-group"><option value="">—</option>${gOpts}</select></div>
      <div class="fg"><label>Источник</label><select class="fi" id="sf-source"><option ${v.source === 'Авито' ? 'selected' : ''}>Авито</option><option ${v.source === 'Сарафан' ? 'selected' : ''}>Сарафан</option><option ${v.source === 'Telegram' ? 'selected' : ''}>Telegram</option><option ${v.source === 'Профи.ру' ? 'selected' : ''}>Профи.ру</option><option ${v.source === 'Другое' ? 'selected' : ''}>Другое</option></select></div>
    </div>
    <div style="background:var(--surface2);border-radius:var(--r);padding:12px 14px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Финансы</div>
      <div class="form-row" style="margin-bottom:0">
        <div class="fg"><label>Цена за час ₽</label><input class="fi" type="number" id="sf-price-hour" value="${v.price_per_hour || ''}" oninput="calcLTV()" placeholder="2000"></div>
        <div class="fg"><label>Занятий в месяц</label><input class="fi" type="number" id="sf-lessons-month" value="${v.lessons_per_month || ''}" oninput="calcLTV()" placeholder="8"></div>
        <div class="fg"><label>LTV / месяц ₽</label><input class="fi" id="sf-ltv" value="${ltv ? fmt(ltv) : ''}" readonly style="background:var(--accent-light);font-weight:600;color:var(--green)"></div>
      </div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Оплата</label><select class="fi" id="sf-paid"><option value="1" ${v.paid ? 'selected' : ''}>Оплачен</option><option value="0" ${!v.paid ? 'selected' : ''}>Не оплачен</option></select></div>
      <div class="fg"><label>Пробный балл</label><input class="fi" type="number" id="sf-trial" value="${v.trial_score || ''}"></div>
      <div class="fg"><label>Целевой балл</label><input class="fi" type="number" id="sf-target" value="${v.target_score || ''}"></div>
    </div>
    <div class="fg"><label>Заметки</label><textarea class="fi" id="sf-notes">${esc(v.notes || '')}</textarea></div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Отмена</button>
      <button class="btn btn-p" data-action="saveStudent" data-id="${esc(id || '')}">Сохранить</button>
    </div>
  </div>`);
}

export function calcLTV() {
  const h = +(document.getElementById('sf-price-hour') || {}).value || 0;
  const l = +(document.getElementById('sf-lessons-month') || {}).value || 0;
  const el = document.getElementById('sf-ltv');
  if (el) el.value = (h * l) ? fmt(h * l) : '';
}

export function editStudent(id) { openStudentModal(id); }

export async function saveStudent(id) {
  const newStatus = g('sf-status') || 'lead';
  const existing = id ? (CACHE.students || []).find(x => x.id === id) : null;
  const todayStr = today();
  let history = existing?.status_history ? [...existing.status_history] : [];
  if (!existing) {
    history = [{ status: newStatus, date: g('sf-first-contact') || todayStr }];
  } else if (existing.crm_status !== newStatus) {
    closeModal();
    openStatusDateModal(id, newStatus, existing, todayStr);
    return;
  }
  await _commitSaveStudent(id, newStatus, history, existing, todayStr);
}

export function openStatusDateModal(id, newStatus, existing, todayStr) {
  const st = STATUS_CONFIG[newStatus] || { label: newStatus };
  const oldSt = STATUS_CONFIG[existing.crm_status] || { label: existing.crm_status };
  modal(`<div class="modal" style="max-width:400px">
    <div class="modal-title">Смена статуса</div>
    <div style="margin-bottom:14px;font-size:13px;color:var(--muted)">
      <span class="b ${(STATUS_CONFIG[existing.crm_status] || { cls: 'b-gray' }).cls}">${oldSt.label}</span>
      <i class="ti ti-arrow-right" style="margin:0 8px;font-size:12px"></i>
      <span class="b ${(STATUS_CONFIG[newStatus] || { cls: 'b-gray' }).cls}">${st.label}</span>
    </div>
    <div class="fg" style="margin-bottom:16px">
      <label>Дата перехода <span style="color:var(--hint);font-weight:400">(можно изменить)</span></label>
      <input type="date" class="fi" id="status-change-date" value="${todayStr}">
    </div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal" data-next-action="editStudent" data-id="${esc(id)}">Назад</button>
      <button class="btn btn-p" data-action="confirmStatusChange" data-id="${esc(id)}" data-status="${esc(newStatus)}">Подтвердить</button>
    </div>
  </div>`);
}

export async function confirmStatusChange(id, newStatus) {
  const date = (document.getElementById('status-change-date') || {}).value || today();
  const existing = (CACHE.students || []).find(x => x.id === id);
  if (!existing) return;
  const history = [...(existing.status_history || []), { status: newStatus, date }];
  await _commitSaveStudent(id, newStatus, history, existing, date);
  closeModal();
  renderPipeline();
}

async function _commitSaveStudent(id, newStatus, history, existing, statusDate) {
  const todayStr = today();
  const leftStatuses = ['stopped', 'refused', 'left'];
  const exitStatuses = ['stopped', 'refused', 'left', 'exam_passed'];
  const left_at = leftStatuses.includes(newStatus) ? (existing?.left_at || statusDate || todayStr) : null;
  const clearTokens = exitStatuses.includes(newStatus);
  function fv(fieldId, fallback) { return (document.getElementById(fieldId) || {}).value ?? fallback; }
  const obj = {
    id: id || uid(),
    name: fv('sf-name', existing?.name || ''),
    contact: fv('sf-contact', existing?.contact || ''),
    grade: fv('sf-grade', existing?.grade || '11'),
    group_id: fv('sf-group', existing?.group_id || null) || null,
    format: fv('sf-format', existing?.format || 'group'),
    crm_status: newStatus,
    price_per_hour: +(fv('sf-price-hour', existing?.price_per_hour || '')) || null,
    lessons_per_month: +(fv('sf-lessons-month', existing?.lessons_per_month || '')) || null,
    paid: fv('sf-paid', existing?.paid ? '1' : '0') === '1',
    trial_score: +(fv('sf-trial', existing?.trial_score || '')) || null,
    target_score: +(fv('sf-target', existing?.target_score || '')) || null,
    source: fv('sf-source', existing?.source || ''),
    notes: fv('sf-notes', existing?.notes || ''),
    first_contact_at: fv('sf-first-contact', existing?.first_contact_at || todayStr),
    status_history: history,
    left_at,
    created_at: existing?.created_at || new Date().toISOString(),
    reg_token: clearTokens ? null : (existing?.reg_token ?? genToken()),
    telegram_id: clearTokens ? null : (existing?.telegram_id ?? null),
  };
  if (!obj.name) { toast('Введите имя'); return; }
  try {
    if (id) await dbUpdate('students', id, obj); else await dbInsert('students', obj);
    const action = id ? 'update' : 'insert';
    const desc = id ? `Изменён ученик: ${obj.name}${existing && existing.crm_status !== newStatus ? ' (статус: ' + STATUS_CONFIG[newStatus]?.label + ')' : ''}` : `Добавлен ученик: ${obj.name}`;
    await addHistoryEntry(action, desc, 'student', obj.id, { table: 'students', action, record_id: obj.id, old_data: existing || null });
    if (!id) {
      await addEvent('student', obj.id, 'lead_created', { source: obj.source });
      if (obj.crm_status !== 'lead') await addEvent('student', obj.id, 'status_changed', { from: 'lead', to: obj.crm_status });
    } else if (existing && existing.crm_status !== newStatus) {
      await addEvent('student', obj.id, 'status_changed', { from: existing.crm_status, to: newStatus });
      if (newStatus === 'active') await recalcRisk(obj);
    }
    renderStudents(); renderPipeline(); toast('Сохранено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export async function deleteStudent(id) {
  if (!confirm('Удалить ученика?')) return;
  try {
    await dbDelete('students', id);
    renderStudents(); renderPipeline(); toast('Удалено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export function openStudentDetail(id) {
  const s = (CACHE.students || []).find(x => x.id === id);
  if (!s) return;
  const { score, level, reasons } = calcRiskScore(s);
  const events = studentEvents(id);
  const ltv = (s.price_per_hour || 0) * (s.lessons_per_month || 0);
  const actualLTV = (CACHE.payments || []).filter(p => p.student_id === id).reduce((sum, p) => sum + p.amount, 0);
  const sub = studentSubscriptionStatus(s);
  const subBadge = sub ? (sub.daysLeft < 0 ? '<span class="b b-r">Просрочен</span>' : (sub.daysLeft <= 7 ? `<span class="b b-a">через ${sub.daysLeft}д</span>` : `<span class="b b-g">до ${fmtDate(sub.sub_end)}</span>`)) : '<span class="b b-gray">—</span>';
  const EVENT_CONFIG = {
    lead_created:    { dot: 'tl-dot-blue',  icon: 'ti-user-plus',      label: ev => `Лид создан · ${ev.payload?.source || ''}` },
    status_changed:  { dot: 'tl-dot-blue',  icon: 'ti-arrow-right',    label: ev => { const cfg = STATUS_CONFIG[ev.payload?.to]; return `Статус → <b>${cfg?.label || ev.payload?.to}</b>`; } },
    trial_completed: { dot: 'tl-dot-amber', icon: 'ti-star',           label: ev => `Пробное завершено · балл: ${ev.payload?.score || '—'}` },
    payment_added:   { dot: 'tl-dot-green', icon: 'ti-cash',           label: ev => `Оплата ${ev.payload?.amount ? fmt(ev.payload.amount) + ' ₽' : ''}` },
    lesson_absent:   { dot: 'tl-dot-red',   icon: 'ti-user-off',       label: ev => `Пропуск · ${ev.payload?.topic || ''}` },
    student_at_risk: { dot: 'tl-dot-red',   icon: 'ti-alert-triangle', label: ev => `Риск-алерт · ${(ev.payload?.reasons || []).join(', ')}` },
    lesson_attended: { dot: 'tl-dot-gray',  icon: 'ti-check',          label: ev => `Был на занятии · ${ev.payload?.topic || ''}` },
    homework_missing:   { dot: 'tl-dot-amber', icon: 'ti-home-off',   label: ev => `Не сдал ДЗ · ${ev.payload?.topic || ''}` },
    homework_completed: { dot: 'tl-dot-green', icon: 'ti-home-check', label: ev => `Сдал ДЗ` },
    subscription_expiring: { dot: 'tl-dot-amber', icon: 'ti-clock',   label: ev => `Абонемент истекает` },
  };
  const tlHtml = events.length ? events.map(ev => {
    const cfg = EVENT_CONFIG[ev.event_type] || { dot: 'tl-dot-gray', icon: 'ti-point', label: () => ev.event_type };
    return `<div class="tl-item">
      <div class="tl-dot ${cfg.dot}"><i class="ti ${cfg.icon}" style="font-size:9px;color:#fff"></i></div>
      <div class="tl-body"><div class="tl-label">${cfg.label(ev)}</div></div>
      <div class="tl-date">${fmtDate(ev.created_at?.slice(0, 10))}</div>
    </div>`;
  }).join('') : '<div class="empty" style="padding:12px 0;font-size:12px">Событий пока нет</div>';
  const riskColor = level === 'high' ? 'var(--red)' : level === 'med' ? 'var(--amber)' : 'var(--green)';
  const riskLabel = level === 'high' ? 'Высокий' : level === 'med' ? 'Средний' : 'OK';
  const role = state.currentRole || {};
  const isCurator = (role.role_type === 'curator');
  const hwAll = (CACHE.hw_submissions || []).filter(h => h.student_id === id);
  const hwDone = hwAll.filter(h => h.status === 'done').length;
  const hwMissing = hwAll.filter(h => h.status === 'missing').length;
  const hwPct = hwAll.length ? Math.round(hwDone / hwAll.length * 100) : null;
  const hwBarColor = hwPct !== null ? (hwPct >= 80 ? '#22c55e' : hwPct >= 50 ? '#f59e0b' : '#ef4444') : '';
  const hwBlock = hwAll.length ? `<div style="background:var(--surface2);border-radius:var(--r);padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:14px">
    <i class="ti ti-home-check" style="font-size:18px;color:${hwBarColor};flex-shrink:0"></i>
    <div style="flex:1;min-width:0">
      <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px">ДОМАШКА</div>
      <div class="prog"><div class="prog-f" style="width:${hwPct}%;background:${hwBarColor}"></div></div>
    </div>
    <div style="text-align:right;flex-shrink:0;font-size:12px">
      <span style="font-weight:700;color:${hwBarColor}">${hwPct}%</span>
      <div style="color:var(--hint)">${hwDone} из ${hwAll.length} · ${hwMissing} не сдал</div>
    </div>
  </div>` : '';

  modal(`<div class="modal" style="max-width:640px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div>
        <div style="font-size:17px;font-weight:700">${esc(s.name)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(s.source || '')} · ${s.grade || ''}кл · <span class="b ${(STATUS_CONFIG[s.crm_status] || { cls: 'b-gray' }).cls}" style="font-size:10px">${(STATUS_CONFIG[s.crm_status] || { label: '—' }).label}</span></div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${role.isOwner ? `<button class="btn btn-sm" data-action="editStudent" data-id="${esc(id)}" data-close-modal="true"><i class="ti ti-edit"></i> Редакт.</button>` : ''}
        <button class="btn" data-action="closeModal"><i class="ti ti-x"></i></button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(${role.isOwner && !isCurator ? 4 : 2},1fr);gap:8px;margin-bottom:16px">
      <div class="met" style="padding:10px 12px">
        <div class="met-label">Риск</div>
        <div class="met-val" style="font-size:16px;color:${riskColor}">${riskLabel}</div>
        <div class="met-sub" style="font-size:10px">${reasons[0] || 'всё хорошо'}</div>
        ${level !== 'low' ? `<button class="btn btn-sm" style="margin-top:6px;font-size:10px;padding:2px 8px" data-action="resetStudentRisk" data-id="${esc(id)}"><i class="ti ti-refresh"></i> Сбросить риск</button>` : ''}
      </div>
      ${role.isOwner && !isCurator ? `<div class="met" style="padding:10px 12px"><div class="met-label">MRR</div><div class="met-val" style="font-size:16px">${ltv ? fmt(ltv) + ' ₽' : '—'}</div><div class="met-sub">в месяц</div></div>
      <div class="met" style="padding:10px 12px"><div class="met-label">LTV факт.</div><div class="met-val" style="font-size:16px">${actualLTV ? fmt(actualLTV) + ' ₽' : '—'}</div><div class="met-sub">итого оплат</div></div>` : ''}
      <div class="met" style="padding:10px 12px"><div class="met-label">Абонемент</div><div class="met-val" style="font-size:14px;padding-top:4px">${subBadge}</div></div>
    </div>
    ${hwBlock}
    <div style="background:var(--surface2,var(--surface));border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <i class="ti ti-brand-telegram" style="font-size:18px;color:#2aabee;flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Telegram</div>
        <div style="font-size:12px">${s.telegram_id ? '<span class="b b-g"><i class="ti ti-check" style="font-size:10px"></i> Привязан</span>' : '<span class="b b-gray">Не привязан</span>'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        ${s.reg_token
          ? `<span style="font-size:11px;color:var(--muted)">Код:</span>
             <code style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:12px;font-family:monospace">${esc(s.reg_token)}</code>
             <button class="btn btn-sm" data-action="copyRegToken" data-token="${esc(s.reg_token)}" title="Скопировать код"><i class="ti ti-copy"></i></button>`
          : `<button class="btn btn-sm" data-action="generateStudentToken" data-id="${esc(s.id)}" title="Создать Telegram-код"><i class="ti ti-key"></i> Создать код</button>`
        }
      </div>
    </div>
    <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
      <i class="ti ti-timeline" style="margin-right:5px"></i>Timeline
    </div>
    <div class="tl-wrap" style="max-height:200px;overflow-y:auto">${tlHtml}</div>
    <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
      <i class="ti ti-message-circle" style="margin-right:5px"></i>Заметки
    </div>
    <div id="notes-thread-${id}">${renderNotesThread(id)}</div>
    <div class="note-add-row">
      <textarea class="fi" id="note-input-${id}" placeholder="Добавить заметку..." rows="2" style="min-height:38px"></textarea>
      <button class="btn btn-p btn-sm" style="flex-shrink:0;align-self:flex-end" data-action="addStudentNote" data-id="${esc(id)}"><i class="ti ti-send"></i></button>
    </div>
    <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
      <i class="ti ti-clipboard-list" style="margin-right:5px"></i>Домашние задания
    </div>
    <div style="max-height:220px;overflow-y:auto">${renderStudentHwTabInline(id)}</div>
    ${role.isOwner ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      ${s.crm_status === 'lead' ? `<button class="btn btn-sm" data-action="openStatusDateModal" data-id="${esc(id)}" data-status="trial_scheduled" data-close-modal="true"><i class="ti ti-calendar-check"></i> → Пробник назначен</button>` : ''}
      ${s.crm_status === 'trial_scheduled' ? `<button class="btn btn-sm" data-action="openTrialFromCalendar" data-id="${esc(id)}" data-close-modal="true"><i class="ti ti-calendar-plus"></i> Назначить в календаре</button><button class="btn btn-sm btn-p" data-action="openStatusDateModal" data-id="${esc(id)}" data-status="trial_done" data-close-modal="true"><i class="ti ti-star"></i> → Пробник проведён</button>` : ''}
      ${(s.crm_status === 'trial_done' || s.crm_status === 'trial') ? `<button class="btn btn-sm btn-p" data-action="openStatusDateModal" data-id="${esc(id)}" data-status="active" data-close-modal="true"><i class="ti ti-user-star"></i> → Занимается</button>` : ''}
      ${['lead', 'trial_scheduled', 'trial_done', 'trial'].includes(s.crm_status) ? `<button class="btn btn-sm" style="color:var(--red)" data-action="openStatusDateModal" data-id="${esc(id)}" data-status="refused" data-close-modal="true"><i class="ti ti-user-off"></i> → Отказался</button>` : ''}
      ${s.crm_status === 'active' ? `<button class="btn btn-sm btn-p" data-action="openPaymentModalFor" data-id="${esc(id)}" data-close-modal="true"><i class="ti ti-cash"></i> Добавить платёж</button>` : ''}
      ${s.crm_status === 'active' ? `<button class="btn btn-sm" style="color:var(--red)" data-action="openStatusDateModal" data-id="${esc(id)}" data-status="stopped" data-close-modal="true"><i class="ti ti-door-exit"></i> → Отказался от занятий</button>` : ''}
    </div>` : ''}
  </div>`);
}

export async function resetStudentRisk(studentId) {
  const s = (CACHE.students || []).find(x => x.id === studentId);
  if (!s) return;
  await dbUpdate('students', studentId, { risk_reset_at: new Date().toISOString() });
  toast('Риск сброшен');
  closeModal();
  renderStudents();
}

export function openTrialFromCalendar(studentId) {
  const s = (CACHE.students || []).find(x => x.id === studentId);
  if (!s) return;
  const todayStr = today();
  const gOpts = (CACHE.groups || []).map(gr => `<option value="${gr.id}">${gr.name}</option>`).join('');
  modal(`<div class="modal" style="max-width:420px">
    <div class="modal-title"><i class="ti ti-calendar-check"></i> Назначить пробное · ${esc(s.name)}</div>
    <div class="fg" style="margin-bottom:10px">
      <label>Дата пробного занятия</label>
      <input type="date" class="fi" id="trial-date" value="${todayStr}">
    </div>
    <div class="fg" style="margin-bottom:10px">
      <label>Время</label>
      <input type="time" class="fi" id="trial-time" value="18:00">
    </div>
    <div class="fg" style="margin-bottom:10px">
      <label>Группа (необязательно)</label>
      <select class="fi" id="trial-group">
        <option value="">— Индивидуально —</option>
        ${gOpts}
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn" data-action="closeModal">Отмена</button>
      <button class="btn btn-p" data-action="scheduleTrialLesson" data-id="${esc(studentId)}">Назначить пробник</button>
    </div>
  </div>`);
}

export async function scheduleTrialLesson(studentId) {
  const date = (document.getElementById('trial-date') || {}).value;
  const time = (document.getElementById('trial-time') || {}).value || '18:00';
  const groupId = (document.getElementById('trial-group') || {}).value || null;
  if (!date) { toast('Укажите дату'); return; }
  const s = (CACHE.students || []).find(x => x.id === studentId);
  if (!s) return;
  if (groupId) {
    const lesson = {
      id: uid(), group_id: groupId, date, start_time: time, duration: 60,
      topic: `Пробное занятие · ${s.name}`,
      lesson_link: '', homework_link: '', student_attendance: [{ student_id: studentId, present: true, note: 'Пробное' }],
      task_ids: [], notes: 'Пробное занятие', created_at: new Date().toISOString()
    };
    await dbInsert('lessons', lesson);
  }
  const history = [...(s.status_history || []), { status: 'trial_scheduled', date }];
  const updates = { crm_status: 'trial_scheduled', status_history: history };
  await dbUpdate('students', studentId, updates);
  await addHistoryEntry('trial_scheduled', `Пробник назначен: ${s.name} на ${date}`, 'student', studentId, { table: 'students', action: 'update', record_id: studentId, old_data: { crm_status: s.crm_status, status_history: s.status_history } });
  closeModal();
  renderPipeline();
  toast(`Пробник назначен на ${date}`);
}

export function openPaymentModalFor(studentId) {
  import('./income.js').then(({ openPaymentModal }) => {
    openPaymentModal();
    setTimeout(() => {
      const sel = document.getElementById('pf-student');
      if (sel) sel.value = studentId;
    }, 50);
  });
}

function renderNotesThread(studentId) {
  const notes = (CACHE.student_notes || []).filter(n => n.student_id === studentId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (!notes.length) return '<div style="font-size:12px;color:var(--hint);padding:8px 0">Заметок пока нет</div>';
  const role = state.currentRole || {};
  return `<div class="notes-thread">${notes.map(n => {
    const isOwner = n.author === 'Владелец';
    return `<div class="note-item${isOwner ? ' owner' : ''}">
      <div class="note-meta">
        <span class="note-author"><i class="ti ti-${isOwner ? 'crown' : 'user'}" style="font-size:10px"></i> ${esc(n.author)}</span>
        <span class="note-date">${new Date(n.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div class="note-text">${esc(n.text)}</div>
    </div>`;
  }).join('')}</div>`;
}

export async function addStudentNote(studentId) {
  const ta = document.getElementById('note-input-' + studentId);
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) { toast('Введите текст заметки'); return; }
  const role = state.currentRole || {};
  const note = { id: uid(), student_id: studentId, text, author: role.name || 'Владелец', created_at: new Date().toISOString() };
  await dbInsert('student_notes', note);
  ta.value = '';
  const thread = document.getElementById('notes-thread-' + studentId);
  if (thread) thread.innerHTML = renderNotesThread(studentId);
  toast('Заметка добавлена');
}

function renderStudentHwTabInline(studentId) {
  // New-style assignments (with scores)
  const newSubs = (CACHE.homework_submissions || []).filter(s => s.student_id === studentId)
    .sort((a, b) => (b.submitted_at || b.assigned_at || '').localeCompare(a.submitted_at || a.assigned_at || ''));

  // Old-style submissions (hw_submissions from group journal)
  const oldSubs = (CACHE.hw_submissions || []).filter(h => h.student_id === studentId)
    .sort((a, b) => new Date(b.assigned_at) - new Date(a.assigned_at));

  if (!newSubs.length && !oldSubs.length) return '<div style="font-size:12px;color:var(--hint);padding:6px 0">Нет домашних заданий</div>';

  const now = Date.now();
  const month30ago = now - 30 * 86400000;
  const scoredRecent = newSubs.filter(s => {
    const d = s.checked_at || s.submitted_at;
    return d && new Date(d).getTime() >= month30ago && s.score !== null;
  });
  const avgScore = scoredRecent.length ? Math.round(scoredRecent.reduce((acc, s) => acc + s.score, 0) / scoredRecent.length) : null;

  const scoreColor = (v) => v === null ? 'var(--hint)' : v < 50 ? 'var(--red)' : v < 75 ? 'var(--amber)' : v < 90 ? 'var(--green)' : 'var(--accent-mid)';
  const scoreFmt   = (sub) => {
    if (sub.score === null || sub.score === undefined) return '';
    const a   = (CACHE.homework_assignments || []).find(x => x.id === sub.assignment_id);
    const max = sub.max_score ?? (Array.isArray(a?.task_config) ? a.task_config.reduce((x, y) => x + y, 0) : 100);
    return `${sub.score}/${max}`;
  };
  const statusCfg = {
    assigned: { label: 'Назначено', cls: 'b-gray' },
    submitted: { label: 'Сдано', cls: 'b-bl' },
    checked: { label: 'Проверено', cls: 'b-g' },
    overdue: { label: 'Просрочено', cls: 'b-r' },
  };

  return `${avgScore !== null ? `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface2);border-radius:var(--r);margin-bottom:10px;font-size:12px">
    <i class="ti ti-chart-bar" style="color:${scoreColor(avgScore)}"></i>
    Средний балл за 30 дней: <b style="color:${scoreColor(avgScore)}">${avgScore}/100</b>
  </div>` : ''}
  ${newSubs.length ? newSubs.map(sub => {
    const assignment = (CACHE.homework_assignments || []).find(a => a.id === sub.assignment_id);
    const st = statusCfg[sub.status] || statusCfg.assigned;
    const isOverdue = assignment?.due_date && new Date(assignment.due_date) < new Date() && sub.status !== 'checked';
    return `<div class="hw-history-item">
      <i class="ti ti-home-check" style="color:${sub.status === 'checked' ? 'var(--green)' : 'var(--muted)'}"></i>
      <span style="flex:1;font-size:12px">${assignment ? assignment.topic || '—' : '—'}</span>
      <span class="b ${st.cls}" style="font-size:10px">${st.label}</span>
      ${sub.score !== null ? `<span style="font-size:11px;color:${scoreColor(sub.score)};font-weight:700">${scoreFmt(sub)}</span>` : ''}
      ${isOverdue ? '<span class="b b-r" style="font-size:10px">просрочено</span>' : ''}
    </div>`;
  }).join('') : ''}
  ${oldSubs.length ? `<div style="font-size:10px;color:var(--hint);margin:6px 0 4px;text-transform:uppercase;letter-spacing:.05em">Из журнала групп</div>` + oldSubs.map(h => {
    const l = (CACHE.lessons || []).find(x => x.id === h.lesson_id);
    const cfg = { done: { color: 'var(--green)', icon: 'ti-check', label: 'Сдал' }, missing: { color: 'var(--red)', icon: 'ti-x', label: 'Не сдал' }, pending: { color: 'var(--amber)', icon: 'ti-clock', label: 'Ожидает' } }[h.status] || { color: 'var(--hint)', icon: 'ti-point', label: h.status };
    return `<div class="hw-history-item">
      <i class="ti ${cfg.icon}" style="color:${cfg.color};font-size:13px"></i>
      <span style="flex:1;font-size:12px">${l ? l.topic || l.date : 'Занятие'}</span>
      <span style="font-size:11px;color:${cfg.color};font-weight:600">${cfg.label}</span>
    </div>`;
  }).join('') : ''}`;
}

export function copyRegToken(token) {
  navigator.clipboard.writeText(token).then(() => toast('Код скопирован'));
}

export async function generateStudentToken(id) {
  const token = genToken();
  try {
    await dbUpdate('students', id, { reg_token: token });
    toast('Код создан: ' + token);
    openStudentDetail(id);
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export function selectChip(el, hiddenId, value) {
  const group = el.parentElement;
  group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const hidden = document.getElementById(hiddenId);
  if (hidden) hidden.value = value;
}
