import { CACHE } from './store.js';
import { state } from './state.js';
import { ALL_PAGES, ROLE_TYPES } from '../utils/helpers.js';

const OWNER_ROLE = { id: 'owner', name: 'Владелец', pages: ALL_PAGES.map(p => p.id), canEdit: true, isOwner: true };

export function applyRoleUI(role) {
  if (!role) return;
  const el = document.getElementById('current-role-name');
  if (el) el.textContent = role.name;

  document.querySelectorAll('.sb-item[data-pg]').forEach(item => {
    const visible = role.isOwner || (role.pages || []).includes(item.dataset.pg);
    item.style.display = visible ? '' : 'none';
  });

  // Hide section headers when none of their items are visible
  document.querySelectorAll('.sb-section[data-sb-group]').forEach(section => {
    const group = section.dataset.sbGroup;
    const hasVisible = [...document.querySelectorAll(`.sb-item[data-sb-section="${group}"]`)]
      .some(item => item.style.display !== 'none');
    section.style.display = hasVisible ? '' : 'none';
  });

  // Hide the dashboard item for non-owners (they have their own landing page)
  const dashItem = document.querySelector('.sb-item[data-pg="dashboard"]');
  if (dashItem) dashItem.style.display = role.isOwner ? '' : 'none';

  document.querySelectorAll('.owner-only').forEach(el => el.style.display = role.isOwner ? '' : 'none');
  document.querySelectorAll('.edit-only').forEach(el => el.style.display = (role.canEdit || role.isOwner) ? '' : 'none');
}

export function applyRole(role) {
  state.currentRole = role;
  localStorage.setItem('tutoros_role', JSON.stringify(role));
  document.getElementById('setup-screen')?.classList.remove('show');
  document.getElementById('app').style.display = 'flex';
  applyRoleUI(role);
  import('./router.js').then(({ navigate }) => {
    const homePage = role.isOwner
      ? 'dashboard'
      : (ROLE_TYPES[role.role_type]?.homePage || role.pages?.[0] || 'dashboard');
    navigate(homePage);
  });
}

export function restoreSession() {
  try {
    const raw = localStorage.getItem('tutoros_role');
    if (!raw) return false;
    const role = JSON.parse(raw);
    if (role.id === 'owner' || CACHE.roles.find(r => r.id === role.id)) {
      applyRole(role.id === 'owner' ? OWNER_ROLE : { ...CACHE.roles.find(r => r.id === role.id), isOwner: false });
      return true;
    }
  } catch { }
  return false;
}

export function logout() {
  state.currentRole = null;
  localStorage.removeItem('tutoros_role');
  document.getElementById('app').style.display = 'none';
  document.getElementById('setup-screen')?.classList.add('show');
}

export function promptSwitchRole() {
  const roles = [{ ...OWNER_ROLE, name: 'Владелец (полный доступ)', pin: null }, ...CACHE.roles];
  import('../components/modal.js').then(({ modal, closeModal }) => {
    modal(`<div class="modal" style="max-width:400px">
      <div class="modal-title">Войти как</div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px">Выбери роль. Для ассистентов нужен PIN.</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${roles.map(r => {
          const rt = ROLE_TYPES[r.role_type];
          const subtitle = r.isOwner ? 'Все разделы · без PIN' : `${rt?.label || 'Ассистент'} · ${r.pin ? 'нужен PIN' : 'без PIN'}`;
          return `<div class="card" style="cursor:pointer;padding:12px 16px;margin-bottom:0;transition:border-color .12s" onmouseover="this.style.borderColor='var(--accent-mid)'" onmouseout="this.style.borderColor=''" onclick="selectRole('${r.id}')">
          <div style="font-weight:500;font-size:13px">${r.name}</div>
          <div style="font-size:11px;color:var(--muted)">${subtitle}</div>
        </div>`;
        }).join('')}
      </div>
    </div>`);
  });
}

export function selectRole(id) {
  import('../components/modal.js').then(({ modal, closeModal }) => {
    import('../components/toast.js').then(({ toast }) => {
      if (id === 'owner') {
        applyRole(OWNER_ROLE);
        closeModal();
        toast('Вы вошли как Владелец');
        return;
      }
      const role = CACHE.roles.find(r => r.id === id);
      if (!role) return;
      if (!role.pin) { applyRole({ ...role, isOwner: false }); closeModal(); return; }
      modal(`<div class="modal" style="max-width:340px">
        <div class="modal-title">PIN для: ${role.name}</div>
        <div class="fg"><label>Введите PIN</label><input class="fi" type="password" id="switch-pin" maxlength="8" autofocus></div>
        <div class="modal-footer">
          <button class="btn" onclick="promptSwitchRole()">Назад</button>
          <button class="btn btn-p" onclick="confirmSwitch('${id}')">Войти</button>
        </div>
      </div>`);
      setTimeout(() => document.getElementById('switch-pin')?.focus(), 100);
    });
  });
}

export function confirmSwitch(id) {
  import('../components/modal.js').then(({ closeModal }) => {
    import('../components/toast.js').then(({ toast }) => {
      const pin = (document.getElementById('switch-pin') || {}).value || '';
      const role = CACHE.roles.find(r => r.id === id);
      if (!role) return;
      if (role.pin !== pin) { toast('Неверный PIN'); return; }
      applyRole({ ...role, isOwner: false });
      closeModal();
      toast(`Вы вошли как: ${role.name}`);
    });
  });
}
