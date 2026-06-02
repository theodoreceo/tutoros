import { CACHE, dbInsert, dbUpdate, dbDelete, ensureLoaded } from '../core/store.js';
import { state } from '../core/state.js';
import { uid, fmt, fmtDate, daysLeft, today, thisMonth, lastMonth, g, esc } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';
import { addEvent } from '../core/events.js';

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

export async function renderIncome() {
  await ensureLoaded(['payments', 'students']);
  const total = (CACHE.payments || []).reduce((s, p) => s + p.amount, 0);
  const curM = thisMonth();
  const prevM = lastMonth();
  const thisM = (CACHE.payments || []).filter(p => p.date?.startsWith(curM)).reduce((s, p) => s + p.amount, 0);
  const lastM = (CACHE.payments || []).filter(p => p.date?.startsWith(prevM)).reduce((s, p) => s + p.amount, 0);
  const metricsEl = document.getElementById('income-metrics');
  if (metricsEl) metricsEl.innerHTML = `
    <div class="met"><div class="met-label">Всего получено</div><div class="met-val">${fmt(total)} ₽</div></div>
    <div class="met"><div class="met-label">Этот месяц</div><div class="met-val">${fmt(thisM)} ₽</div></div>
    <div class="met"><div class="met-label">Прошлый месяц</div><div class="met-val">${fmt(lastM)} ₽</div></div>
    <div class="met"><div class="met-label">Налог (4%)</div><div class="met-val">${fmt(thisM * 0.04)} ₽</div></div>`;

  const sName = id => { const s = (CACHE.students || []).find(x => x.id === id); return s ? s.name : '—'; };
  const tbody = document.getElementById('income-tbody');
  const empty = document.getElementById('income-empty');
  if (!tbody) return;
  if (!(CACHE.payments || []).length) { tbody.innerHTML = ''; if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  const sorted = [...(CACHE.payments || [])].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const groups = {};
  sorted.forEach(p => {
    const key = p.date ? p.date.slice(0, 7) : '0000-00';
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  const role = state.currentRole || {};
  const canOwner = role.isOwner;
  tbody.innerHTML = Object.entries(groups).map(([key, items]) => {
    const [year, mon] = key.split('-');
    const monthTotal = items.reduce((s, p) => s + p.amount, 0);
    const header = `<tr>
      <td colspan="5" style="background:var(--surface2);padding:8px 10px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)">
        ${MONTH_NAMES[+mon - 1]} ${year} <span style="font-weight:400;color:var(--hint);margin-left:8px">итого: +${fmt(monthTotal)} ₽</span>
      </td>
    </tr>`;
    const rows = items.map(p => {
      const subEnd = p.sub_end ? fmtDate(p.sub_end) : '—';
      const subDl = p.sub_end ? daysLeft(p.sub_end) : null;
      let subBadge;
      if (!p.sub_end) subBadge = '<span style="color:var(--hint)">—</span>';
      else if (subDl < 0) subBadge = `<span class="b b-r">Просрочен</span>`;
      else if (subDl <= 7) subBadge = `<span class="b b-a">${subEnd}</span>`;
      else subBadge = `<span class="b b-g">${subEnd}</span>`;
      return `<tr>
      <td>${fmtDate(p.date)}</td><td>${esc(sName(p.student_id))}</td>
      <td>${subBadge}</td>
      <td class="amount-pos">+${fmt(p.amount)} ₽</td>
      <td>${canOwner ? `<button class="btn btn-sm btn-icon" data-action="deletePayment" data-id="${esc(p.id)}"><i class="ti ti-trash" style="color:var(--red)"></i></button>` : ''}</td>
    </tr>`;
    }).join('');
    return header + rows;
  }).join('');
}

export function openPaymentModal() {
  const sOpts = (CACHE.students || []).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  const todayStr = today();
  const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStr = nextMonth.toISOString().slice(0, 10);
  modal(`<div class="modal"><div class="modal-title">Добавить платёж</div>
    <div class="form-row">
      <div class="fg"><label>Ученик</label><select class="fi" id="pf-student">${sOpts}</select></div>
      <div class="fg"><label>Дата платежа</label><input class="fi" type="date" id="pf-date" value="${todayStr}"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Сумма ₽</label><input class="fi" type="number" id="pf-amount"></div>
      <div class="fg"><label>Период</label><input class="fi" id="pf-period" placeholder="Май 2025"></div>
    </div>
    <div class="form-row">
      <div class="fg" style="grid-column:1/-1">
        <label>Абонемент действует до <span style="color:var(--accent-mid);font-weight:600">*</span></label>
        <input class="fi" type="date" id="pf-sub-end" value="${nextMonthStr}">
        <div style="font-size:11px;color:var(--muted);margin-top:3px">Эта дата будет показана в CRM-таблице учеников как статус абонемента.</div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn" data-action="closeModal">Отмена</button><button class="btn btn-p" data-action="savePayment">Сохранить</button></div>
  </div>`);
}

export async function savePayment() {
  const p = { id: uid(), student_id: g('pf-student'), date: g('pf-date'), amount: +g('pf-amount'), period: g('pf-period'), sub_end: g('pf-sub-end') || null };
  if (!p.amount) { toast('Введите сумму'); return; }
  try {
    await dbInsert('payments', p);
    const stu = (CACHE.students || []).find(s => s.id === p.student_id);
    const updates = { paid: true };
    if (stu && ['lead', 'trial_scheduled', 'trial_done', 'trial'].includes(stu.crm_status)) updates.crm_status = 'active';
    await dbUpdate('students', p.student_id, updates);
    await addHistoryEntry('insert', `Платёж +${fmt(p.amount)} ₽ · ${stu ? stu.name : ''}`, 'payment', p.id, { table: 'payments', action: 'insert', record_id: p.id, old_data: null });
    await addEvent('student', p.student_id, 'payment_added', { amount: p.amount });
    if (stu && updates.crm_status) await addEvent('student', p.student_id, 'status_changed', { from: stu.crm_status, to: 'active' });
    closeModal(); renderIncome(); toast('Платёж добавлен');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export async function deletePayment(id) {
  if (!confirm('Удалить платёж?')) return;
  try {
    await dbDelete('payments', id);
    renderIncome(); toast('Удалено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}
