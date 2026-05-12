import { CACHE, dbInsert, dbUpdate, dbDelete, dbFind } from '../core/store.js';
import { uid, fmt, fmtDate, today, thisMonth, lastMonth } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';

export function renderIncome() {
  const el = document.getElementById('income-content');
  if (!el) return;

  const mo = thisMonth();
  const payments = [...CACHE.payments].sort((a,b) => b.date.localeCompare(a.date));
  const moPayments = payments.filter(p => p.date?.startsWith(mo));
  const total = moPayments.reduce((a, p) => a + (p.amount || 0), 0);
  const lastMoPay = payments.filter(p => p.date?.startsWith(lastMonth())).reduce((a, p) => a + (p.amount || 0), 0);
  const growth = lastMoPay ? Math.round((total - lastMoPay) / lastMoPay * 100) : null;

  el.innerHTML = `
    <div class="an-grid" style="margin-bottom:20px">
      <div class="an-met ${total >= lastMoPay ? 'good' : 'warn'}">
        <div class="an-label">Доходы (месяц)</div>
        <div class="an-val">${fmt(total)} ₽</div>
        ${growth !== null ? `<div class="an-sub">${growth >= 0 ? '+' : ''}${growth}% к прошлому месяцу</div>` : ''}
      </div>
      <div class="an-met">
        <div class="an-label">Всего платежей</div>
        <div class="an-val">${moPayments.length}</div>
        <div class="an-sub">за текущий месяц</div>
      </div>
      <div class="an-met">
        <div class="an-label">Средний платёж</div>
        <div class="an-val">${moPayments.length ? fmt(total / moPayments.length) : 0} ₽</div>
      </div>
    </div>

    <div class="ph">
      <span class="ph-title">Все платежи</span>
      <button class="btn btn-p btn-sm" onclick="window.__openPaymentModal()">+ Платёж</button>
    </div>

    <table style="width:100%;border-collapse:collapse" class="tbl-wrap">
      <thead><tr>
        <th>Дата</th><th>Ученик</th><th>Сумма</th><th>Способ</th><th>Комментарий</th><th></th>
      </tr></thead>
      <tbody>
        ${payments.slice(0, 50).map(p => {
          const s = CACHE.students.find(st => st.id === p.studentId);
          const METHOD = { card: '💳', cash: '💵', transfer: '🔁' };
          return `<tr>
            <td>${fmtDate(p.date)}</td>
            <td>${s ? `<a href="#" onclick="window.__openStudentDetail('${s.id}');return false" style="color:var(--accent)">${s.name}</a>` : '—'}</td>
            <td class="amount-pos">${fmt(p.amount)} ₽</td>
            <td>${METHOD[p.method] || p.method || '—'}</td>
            <td style="color:var(--muted)">${p.comment || ''}</td>
            <td>
              <button class="btn btn-sm" onclick="window.__openPaymentModal('${p.id}')">✏️</button>
              <button class="btn btn-sm btn-danger" onclick="window.__deletePayment('${p.id}')">✕</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

export function openPaymentModal(id = null) {
  const p = id ? dbFind('payments', id) : null;
  modal('payment-modal', `
    <div class="modal-title">${p ? 'Редактировать платёж' : 'Новый платёж'}</div>
    <div class="form-row">
      <div class="fg"><label>Ученик</label>
        <select class="fi" id="im-student">
          <option value="">— выберите —</option>
          ${CACHE.students.map(s => `<option value="${s.id}" ${p?.studentId===s.id?'selected':''}>${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label>Сумма (₽) *</label><input class="fi" id="im-amount" type="number" value="${p?.amount || ''}"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Дата</label><input class="fi" id="im-date" type="date" value="${p?.date || today()}"></div>
      <div class="fg"><label>Способ</label>
        <select class="fi" id="im-method">
          <option value="card" ${p?.method==='card'?'selected':''}>Карта</option>
          <option value="cash" ${p?.method==='cash'?'selected':''}>Наличные</option>
          <option value="transfer" ${p?.method==='transfer'?'selected':''}>Перевод</option>
        </select>
      </div>
    </div>
    <div class="fg"><label>Комментарий</label><input class="fi" id="im-comment" value="${p?.comment || ''}"></div>
    <div class="modal-footer">
      ${p ? `<button class="btn btn-danger" onclick="window.__deletePayment('${p.id}')">Удалить</button>` : ''}
      <button class="btn" onclick="window.__closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="window.__savePayment('${id||''}')">Сохранить</button>
    </div>
  `);
}

export function savePayment(id) {
  const amount = +document.getElementById('im-amount')?.value;
  if (!amount) { toast('Введите сумму'); return; }
  const studentId = document.getElementById('im-student')?.value || null;
  const date = document.getElementById('im-date')?.value || today();
  const method = document.getElementById('im-method')?.value || 'card';
  const comment = document.getElementById('im-comment')?.value?.trim() || '';

  if (id) {
    const before = dbFind('payments', id);
    dbUpdate('payments', id, { studentId, amount, date, method, comment });
    addHistoryEntry({ action: 'update', table: 'payments', recordId: id, before, label: `Платёж обновлён: ${fmt(amount)} ₽` });
  } else {
    const row = dbInsert('payments', { studentId, amount, date, method, comment });
    // update student balance
    if (studentId) {
      const s = dbFind('students', studentId);
      if (s) dbUpdate('students', studentId, { balance: (s.balance || 0) + amount, totalPaid: (s.totalPaid || 0) + amount });
    }
    addHistoryEntry({ action: 'create', table: 'payments', recordId: row.id, label: `Платёж ${fmt(amount)} ₽` });
  }

  closeModal();
  toast('Сохранено');
  renderIncome();
}

export function deletePayment(id) {
  if (!confirm('Удалить платёж?')) return;
  const p = dbFind('payments', id);
  // reverse balance
  if (p?.studentId) {
    const s = dbFind('students', p.studentId);
    if (s) dbUpdate('students', p.studentId, { balance: (s.balance || 0) - (p.amount || 0) });
  }
  dbDelete('payments', id);
  addHistoryEntry({ action: 'delete', table: 'payments', recordId: id, before: p, label: `Платёж удалён: ${fmt(p?.amount)} ₽` });
  closeModal();
  toast('Удалено');
  renderIncome();
}
