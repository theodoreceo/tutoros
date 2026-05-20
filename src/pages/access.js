import { CACHE, dbInsert, dbUpdate, dbDelete } from '../core/store.js';
import { uid, g, ALL_PAGES } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';

export function renderAccess() {
  const el = document.getElementById('roles-list');
  if (!el) return;
  if (!(CACHE.roles || []).length) { el.innerHTML = '<div class="empty">Ролей нет. Создайте первую для ассистента.</div>'; return; }
  el.innerHTML = CACHE.roles.map(r => {
    const pages = (r.pages || []).map(p => ALL_PAGES.find(x => x.id === p)?.label || p);
    return `<div class="card">
      <div class="card-header">
        <div>
          <div style="font-size:14px;font-weight:600">${r.name}</div>
          <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">${pages.map(p => `<span class="tag">${p}</span>`).join('')}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="b ${r.can_edit ? 'b-a' : 'b-gray'}">${r.can_edit ? 'Редактирование' : 'Только чтение'}</span>
          <span class="b b-gray" title="PIN">🔑 ${r.pin || 'без PIN'}</span>
          <button class="btn btn-sm btn-icon" onclick="editRole('${r.id}')"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-icon" onclick="deleteRole('${r.id}')"><i class="ti ti-trash" style="color:var(--red)"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

export function openRoleModal(id) {
  const r = id ? (CACHE.roles || []).find(x => x.id === id) : null;
  const defaultPages = ['students', 'groups', 'tasks'];
  const v = r || { name: '', pin: '', pages: defaultPages, can_edit: false };
  modal(`<div class="modal"><div class="modal-title">${r ? 'Редактировать роль' : 'Новая роль'}</div>
    <div class="form-row">
      <div class="fg"><label>Название</label><input class="fi" id="rf-name" value="${v.name}" placeholder="Ассистент"></div>
      <div class="fg"><label>PIN-код</label><input class="fi" id="rf-pin" value="${v.pin || ''}" placeholder="1234" maxlength="8"></div>
    </div>
    <div class="fg" style="margin-bottom:12px">
      <label style="margin-bottom:6px;display:block">Права редактирования</label>
      <select class="fi" id="rf-edit">
        <option value="0" ${!v.can_edit ? 'selected' : ''}>Только просмотр</option>
        <option value="1" ${v.can_edit ? 'selected' : ''}>Может добавлять / редактировать</option>
      </select>
    </div>
    <div class="fg">
      <label style="margin-bottom:6px;display:block">Доступные разделы</label>
      <div style="background:var(--surface2);border-radius:8px;padding:10px 12px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${ALL_PAGES.filter(p => p.id !== 'access').map(p => `<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--border);border-radius:var(--r);cursor:pointer;font-size:13px;background:var(--surface)">
          <input type="checkbox" id="rp-${p.id}" ${(v.pages || []).includes(p.id) ? 'checked' : ''} style="accent-color:var(--accent)">
          ${p.label}
        </label>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:5px">Финансы (доходы, расходы) по умолчанию скрыты для ассистента.</div>
    </div>
    <div class="modal-footer"><button class="btn" onclick="closeModal()">Отмена</button><button class="btn btn-p" onclick="saveRole('${id || ''}')">Сохранить</button></div>
  </div>`);
}

export function editRole(id) { openRoleModal(id); }

export async function saveRole(id) {
  const pages = ALL_PAGES.map(p => p.id).filter(p => (document.getElementById('rp-' + p) || {}).checked);
  const obj = { id: id || uid(), name: g('rf-name'), pin: g('rf-pin'), pages, can_edit: g('rf-edit') === '1' };
  if (!obj.name) { toast('Введите название'); return; }
  if (!pages.length) { toast('Выберите разделы'); return; }
  try {
    if (id) await dbUpdate('roles', id, obj); else await dbInsert('roles', obj);
    closeModal(); renderAccess(); toast('Роль сохранена');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export async function deleteRole(id) {
  if (!confirm('Удалить роль?')) return;
  try {
    await dbDelete('roles', id);
    renderAccess(); toast('Удалено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}
