import { CACHE, dbInsert, dbUpdate, dbDelete } from '../core/store.js';
import { uid, g, ALL_PAGES, ROLE_TYPES } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';

export function renderAccess() {
  const el = document.getElementById('roles-list');
  if (!el) return;
  if (!(CACHE.roles || []).length) { el.innerHTML = '<div class="empty">Ассистентов нет. Добавьте первого.</div>'; }
  else {
    el.innerHTML = CACHE.roles.map(r => {
      const rt = ROLE_TYPES[r.role_type];
      const roleLabel = rt?.label || 'Ассистент';
      const roleIcon = rt?.icon || 'ti-user';
      return `<div class="card">
        <div class="card-header">
          <div>
            <div style="font-size:14px;font-weight:600">${r.name}</div>
            <div style="margin-top:4px;display:flex;align-items:center;gap:6px">
              <span class="b b-bl"><i class="ti ${roleIcon}" style="font-size:10px"></i> ${roleLabel}</span>
              <span class="b b-gray" title="PIN"><i class="ti ti-key" style="font-size:10px"></i> ${r.pin || 'без PIN'}</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-sm btn-icon" onclick="editRole('${r.id}')"><i class="ti ti-edit"></i></button>
            <button class="btn btn-sm btn-icon" onclick="deleteRole('${r.id}')"><i class="ti ti-trash" style="color:var(--red)"></i></button>
          </div>
        </div>
      </div>`;
    }).join('');
  }
  renderAssistantGroupsSection();
}

function renderAssistantGroupsSection() {
  const el = document.getElementById('assistant-groups-section');
  if (!el) return;
  const roles = CACHE.roles || [];
  if (!roles.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;margin-top:4px">
      <i class="ti ti-sitemap"></i> Назначение на группы
    </div>
    ${roles.map(role => {
      const myGroups = new Set((CACHE.assistant_groups || []).filter(ag => ag.assistant_id === role.id).map(ag => ag.group_id));
      return `<div class="card" style="margin-bottom:10px">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px">${role.name}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px">
          ${(CACHE.groups || []).map(gr => {
            const checked = myGroups.has(gr.id);
            return `<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid ${checked ? 'var(--accent-mid)' : 'var(--border)'};border-radius:var(--r);cursor:pointer;font-size:13px;background:${checked ? 'var(--accent-bg)' : 'var(--surface)'}">
              <input type="checkbox" ${checked ? 'checked' : ''} style="accent-color:var(--accent-mid)" onchange="toggleAssistantGroup('${role.id}','${gr.id}',this.checked)">
              ${gr.name}
            </label>`;
          }).join('')}
          ${!(CACHE.groups || []).length ? '<div style="font-size:12px;color:var(--hint)">Групп нет</div>' : ''}
        </div>
      </div>`;
    }).join('')}
  `;
}

export async function toggleAssistantGroup(roleId, groupId, assign) {
  const { db } = await import('../lib/db.js');
  if (assign) await db.assistantGroups.assign(roleId, groupId);
  else await db.assistantGroups.unassign(roleId, groupId);
  renderAssistantGroupsSection();
}

export function openRoleModal(id) {
  const r = id ? (CACHE.roles || []).find(x => x.id === id) : null;
  const v = r || { name: '', pin: '', role_type: 'curator' };
  modal(`<div class="modal"><div class="modal-title">${r ? 'Редактировать ассистента' : 'Добавить ассистента'}</div>
    <div class="form-row">
      <div class="fg"><label>Имя</label><input class="fi" id="rf-name" value="${v.name}" placeholder="Анна"></div>
      <div class="fg"><label>PIN-код</label><input class="fi" id="rf-pin" value="${v.pin || ''}" placeholder="1234" maxlength="8"></div>
    </div>
    <div class="fg">
      <label style="margin-bottom:8px;display:block">Роль</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${Object.entries(ROLE_TYPES).map(([key, rt]) => `
        <label style="display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:2px solid ${v.role_type === key ? 'var(--accent-mid)' : 'var(--border)'};border-radius:var(--r);cursor:pointer;background:${v.role_type === key ? 'var(--accent-bg)' : 'var(--surface)'};transition:all .12s" id="rtlabel-${key}">
          <input type="radio" name="role_type" id="rt-${key}" value="${key}" ${v.role_type === key ? 'checked' : ''} style="display:none" onchange="document.querySelectorAll('[id^=rtlabel-]').forEach(l=>l.style.border='2px solid var(--border)');document.querySelectorAll('[id^=rtlabel-]').forEach(l=>l.style.background='var(--surface)');this.closest('label').style.border='2px solid var(--accent-mid)';this.closest('label').style.background='var(--accent-bg)'">
          <div style="font-weight:600;font-size:13px"><i class="ti ${rt.icon}" style="margin-right:4px"></i>${rt.label}</div>
          <div style="font-size:11px;color:var(--muted)">${rt.pages.map(p => ALL_PAGES.find(x => x.id === p)?.label || p).join(', ')}</div>
        </label>`).join('')}
      </div>
    </div>
    <div class="modal-footer"><button class="btn" onclick="closeModal()">Отмена</button><button class="btn btn-p" onclick="saveRole('${id || ''}')">Сохранить</button></div>
  </div>`);
}

export function editRole(id) { openRoleModal(id); }

export async function saveRole(id) {
  const roleTypeEl = document.querySelector('input[name="role_type"]:checked');
  const roleType = roleTypeEl?.value || 'curator';
  const pages = ROLE_TYPES[roleType]?.pages || [];
  const obj = { id: id || uid(), name: g('rf-name'), pin: g('rf-pin'), pages, role_type: roleType, can_edit: false };
  if (!obj.name) { toast('Введите имя'); return; }
  try {
    if (id) await dbUpdate('roles', id, obj); else await dbInsert('roles', obj);
    closeModal(); renderAccess(); toast('Сохранено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}

export async function deleteRole(id) {
  if (!confirm('Удалить роль?')) return;
  try {
    await dbDelete('roles', id);
    renderAccess(); toast('Удалено');
  } catch (e) { toast('Ошибка: ' + e.message); }
}
