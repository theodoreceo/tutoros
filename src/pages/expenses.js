import { CACHE, dbInsert, dbUpdate, dbDelete, dbFind, expenseCats } from '../core/store.js';
import { fmt, fmtDate, today, thisMonth, lastMonth } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';

export function renderExpenses() {
  const el = document.getElementById('expenses-content');
  if (!el) return;

  const mo = thisMonth();
  const all = [...CACHE.expenses].sort((a,b) => b.date.localeCompare(a.date));
  const moExp = all.filter(e => e.date?.startsWith(mo));
  const total = moExp.reduce((a, e) => a + (e.amount || 0), 0);
  const lastMoTotal = all.filter(e => e.date?.startsWith(lastMonth())).reduce((a, e) => a + (e.amount || 0), 0);

  // By category this month
  const byCat = {};
  moExp.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + (e.amount || 0); });

  el.innerHTML = `
    <div class="an-grid" style="margin-bottom:20px">
      <div class="an-met ${total <= lastMoTotal ? 'good' : 'warn'}">
        <div class="an-label">Расходы (месяц)</div>
        <div class="an-val">${fmt(total)} ₽</div>
        ${lastMoTotal ? `<div class="an-sub">${total <= lastMoTotal ? '▼' : '▲'} ${fmt(Math.abs(total - lastMoTotal))} к прошлому</div>` : ''}
      </div>
      ${expenseCats.filter(c => byCat[c.id]).map(c => `
        <div class="an-met">
          <div class="an-label">${c.label}</div>
          <div class="an-val" style="font-size:18px">${fmt(byCat[c.id])} ₽</div>
          <div class="an-sub">${Math.round((byCat[c.id]/total)*100)}% от расходов</div>
        </div>
      `).join('')}
    </div>

    <div class="ph">
      <span class="ph-title">Все расходы</span>
      <button class="btn btn-p btn-sm" onclick="window.__openExpenseModal()">+ Расход</button>
    </div>

    <table style="width:100%;border-collapse:collapse" class="tbl-wrap">
      <thead><tr>
        <th>Дата</th><th>Категория</th><th>Поставщик</th><th>Сумма</th><th>Комментарий</th><th></th>
      </tr></thead>
      <tbody>
        ${all.slice(0, 50).map(e => {
          const cat = expenseCats.find(c => c.id === e.category);
          return `<tr>
            <td>${fmtDate(e.date)}</td>
            <td><span class="b b-gray">${cat?.label || e.category || '—'}</span></td>
            <td>${e.vendor || '—'}</td>
            <td class="amount-neg">${fmt(e.amount)} ₽</td>
            <td style="color:var(--muted)">${e.comment || ''}</td>
            <td>
              <button class="btn btn-sm" onclick="window.__openExpenseModal('${e.id}')">✏️</button>
              <button class="btn btn-sm btn-danger" onclick="window.__deleteExpense('${e.id}')">✕</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

export function openExpenseModal(id = null) {
  const e = id ? dbFind('expenses', id) : null;
  const isMkt = e?.category === 'marketing';

  modal('expense-modal', `
    <div class="modal-title">${e ? 'Редактировать расход' : 'Новый расход'}</div>
    <div class="form-row">
      <div class="fg"><label>Категория *</label>
        <select class="fi" id="em-cat" onchange="window.__toggleChannelField()">
          ${expenseCats.map(c => `<option value="${c.id}" ${e?.category===c.id?'selected':''}>${c.label}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label>Сумма (₽) *</label><input class="fi" id="em-amount" type="number" value="${e?.amount || ''}"></div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Поставщик</label><input class="fi" id="em-vendor" value="${e?.vendor || ''}"></div>
      <div class="fg"><label>Дата</label><input class="fi" id="em-date" type="date" value="${e?.date || today()}"></div>
    </div>
    <div class="fg" id="em-channel-wrap" style="${isMkt ? '' : 'display:none'}">
      <label>Канал (маркетинг)</label>
      <select class="fi" id="em-channel">
        <option value="">— выберите —</option>
        <option value="yandex" ${e?.channel==='yandex'?'selected':''}>Яндекс Директ</option>
        <option value="vk" ${e?.channel==='vk'?'selected':''}>ВКонтакте</option>
        <option value="telegram" ${e?.channel==='telegram'?'selected':''}>Telegram Ads</option>
        <option value="instagram" ${e?.channel==='instagram'?'selected':''}>Instagram</option>
        <option value="seo" ${e?.channel==='seo'?'selected':''}>SEO</option>
        <option value="other" ${e?.channel==='other'?'selected':''}>Прочее</option>
      </select>
    </div>
    <div class="fg"><label>Комментарий</label><input class="fi" id="em-comment" value="${e?.comment || ''}"></div>
    <div class="modal-footer">
      ${e ? `<button class="btn btn-danger" onclick="window.__deleteExpense('${e.id}')">Удалить</button>` : ''}
      <button class="btn" onclick="window.__closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="window.__saveExpense('${id||''}')">Сохранить</button>
    </div>
  `);
}

export function toggleChannelField() {
  const cat = document.getElementById('em-cat')?.value;
  const wrap = document.getElementById('em-channel-wrap');
  if (wrap) wrap.style.display = cat === 'marketing' ? '' : 'none';
}

export function saveExpense(id) {
  const amount = +document.getElementById('em-amount')?.value;
  if (!amount) { toast('Введите сумму'); return; }
  const patch = {
    category: document.getElementById('em-cat')?.value || 'other',
    amount,
    vendor: document.getElementById('em-vendor')?.value?.trim() || '',
    date: document.getElementById('em-date')?.value || today(),
    channel: document.getElementById('em-channel')?.value || null,
    comment: document.getElementById('em-comment')?.value?.trim() || '',
  };
  if (id) {
    const before = dbFind('expenses', id);
    dbUpdate('expenses', id, patch);
    addHistoryEntry({ action: 'update', table: 'expenses', recordId: id, before, label: `Расход обновлён: ${fmt(amount)} ₽` });
  } else {
    const row = dbInsert('expenses', patch);
    addHistoryEntry({ action: 'create', table: 'expenses', recordId: row.id, label: `Расход ${fmt(amount)} ₽ — ${patch.vendor || patch.category}` });
  }
  closeModal();
  toast('Сохранено');
  renderExpenses();
}

export function deleteExpense(id) {
  if (!confirm('Удалить расход?')) return;
  const e = dbFind('expenses', id);
  dbDelete('expenses', id);
  addHistoryEntry({ action: 'delete', table: 'expenses', recordId: id, before: e, label: `Расход удалён: ${fmt(e?.amount)} ₽` });
  closeModal();
  toast('Удалено');
  renderExpenses();
}
