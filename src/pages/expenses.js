import { CACHE, dbInsert, dbDelete, ensureLoaded } from '../core/store.js';
import { state, effectiveRole } from '../core/state.js';
import { uid, fmt, fmtDate, today, thisMonth, lastMonth, g, esc } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { addHistoryEntry } from '../core/history.js';

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function expenseCats() {
  try { return JSON.parse(localStorage.getItem('tutoros_expense_cats')) || ['Платформы','Реклама','Материалы','Оборудование','Прочее']; }
  catch { return ['Платформы','Реклама','Материалы','Оборудование','Прочее']; }
}
function saveExpenseCategories(cats) { localStorage.setItem('tutoros_expense_cats', JSON.stringify(cats)); }

export async function renderExpenses() {
  await ensureLoaded(['expenses']);
  const total = (CACHE.expenses || []).reduce((s, e) => s + e.amount, 0);
  const curM = thisMonth();
  const thisM = (CACHE.expenses || []).filter(e => e.date?.startsWith(curM)).reduce((s, e) => s + e.amount, 0);
  const metricsEl = document.getElementById('expense-metrics');
  if (metricsEl) metricsEl.innerHTML = `
    <div class="met"><div class="met-label">Всего расходов</div><div class="met-val">${fmt(total)} ₽</div></div>
    <div class="met"><div class="met-label">Этот месяц</div><div class="met-val">${fmt(thisM)} ₽</div></div>`;

  const tbody = document.getElementById('expenses-tbody');
  const empty = document.getElementById('expenses-empty');
  if (!tbody) return;
  if (!(CACHE.expenses || []).length) { tbody.innerHTML = ''; if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  const sorted = [...(CACHE.expenses || [])].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const groups = {};
  sorted.forEach(e => {
    const key = e.date ? e.date.slice(0, 7) : '0000-00';
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  const role = effectiveRole();
  const canOwner = role.isOwner;
  tbody.innerHTML = Object.entries(groups).map(([key, items]) => {
    const [year, mon] = key.split('-');
    const monthTotal = items.reduce((s, e) => s + e.amount, 0);
    const header = `<tr>
      <td colspan="5" style="background:var(--surface2);padding:8px 10px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)">
        ${MONTH_NAMES[+mon - 1]} ${year} <span style="font-weight:400;color:var(--hint);margin-left:8px">итого: −${fmt(monthTotal)} ₽</span>
      </td>
    </tr>`;
    const rows = items.map(e => `<tr>
      <td>${fmtDate(e.date)}</td><td><span class="b b-gray">${esc(e.category)}</span></td>
      <td style="color:var(--muted)">${esc(e.note) || ''}</td>
      <td class="amount-neg">−${fmt(e.amount)} ₽</td>
      <td>${canOwner ? `<button class="btn btn-sm btn-icon" data-action="deleteExpense" data-id="${esc(e.id)}"><i class="ti ti-trash" style="color:var(--red)"></i></button>` : ''}</td>
    </tr>`).join('');
    return header + rows;
  }).join('');
}

export function openExpenseModal() {
  const todayStr = today();
  const cats = expenseCats();
  const catOpts = cats.map(c => `<option>${c}</option>`).join('');
  modal(`<div class="modal"><div class="modal-title">Добавить расход</div>
    <div class="form-row">
      <div class="fg"><label>Дата</label><input class="fi" type="date" id="ef-date" value="${todayStr}"></div>
      <div class="fg">
        <label>Категория</label>
        <div style="display:flex;gap:6px">
          <select class="fi" id="ef-cat" style="flex:1" onchange="toggleChannelField()">${catOpts}</select>
          <button class="btn btn-sm" data-action="addExpenseCategory" title="Добавить категорию" style="flex-shrink:0;padding:0 10px"><i class="ti ti-plus"></i></button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <div class="fg"><label>Сумма ₽</label><input class="fi" type="number" id="ef-amount"></div>
      <div class="fg"><label>Комментарий</label><input class="fi" id="ef-note"></div>
    </div>
    <div class="fg" id="ef-channel-row" style="margin-bottom:10px;display:none">
      <label>Канал привлечения <span style="color:var(--accent-mid);font-size:11px">(для CAC-аналитики)</span></label>
      <select class="fi" id="ef-channel">
        <option value="">— Не указан —</option>
        <option>Авито</option>
        <option>Сарафан</option>
        <option>Telegram</option>
        <option>Профи.ру</option>
        <option>Instagram</option>
        <option>ВКонтакте</option>
        <option>Другое</option>
      </select>
    </div>
    <div class="modal-footer"><button class="btn" data-action="closeModal">Отмена</button><button class="btn btn-p" data-action="saveExpense">Сохранить</button></div>
  </div>`);
  toggleChannelField();
}

export function toggleChannelField() {
  const cat = (document.getElementById('ef-cat') || {}).value || '';
  const row = document.getElementById('ef-channel-row');
  if (row) row.style.display = cat === 'Реклама' ? '' : 'none';
}

export function addExpenseCategory() {
  const name = prompt('Название новой категории:');
  if (!name || !name.trim()) return;
  const cats = expenseCats();
  if (cats.includes(name.trim())) { toast('Такая категория уже есть'); return; }
  cats.push(name.trim());
  saveExpenseCategories(cats);
  const sel = document.getElementById('ef-cat');
  if (sel) { const opt = document.createElement('option'); opt.textContent = name.trim(); sel.appendChild(opt); sel.value = name.trim(); }
  toast('Категория добавлена');
}

export async function saveExpense() {
  const cat = g('ef-cat');
  const channel = cat === 'Реклама' ? ((document.getElementById('ef-channel') || {}).value || '') : '';
  const e = { id: uid(), date: g('ef-date'), category: cat, amount: +g('ef-amount'), note: g('ef-note'), channel };
  if (!e.amount) { toast('Введите сумму'); return; }
  try {
    await dbInsert('expenses', e);
    await addHistoryEntry('insert', `Расход −${fmt(e.amount)} ₽ · ${e.category}${e.note ? ' (' + e.note + ')' : ''}`, 'expense', e.id, { table: 'expenses', action: 'insert', record_id: e.id, old_data: null });
    closeModal(); renderExpenses(); toast('Расход добавлен');
  } catch (err) { toast('Ошибка: ' + err.message); }
}

export async function deleteExpense(id) {
  if (!confirm('Удалить?')) return;
  try {
    await dbDelete('expenses', id);
    renderExpenses(); toast('Удалено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}
