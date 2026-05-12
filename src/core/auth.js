import { CACHE } from './store.js';
import { state } from './state.js';

// Called from setup screen
export function selectRole(roleId) {
  const role = CACHE.roles.find(r => r.id === roleId);
  if (!role) return;
  const pin = prompt(`Введите PIN для роли «${role.name}»:`);
  if (pin === null) return;
  if (pin !== role.pin) {
    alert('Неверный PIN');
    return;
  }
  applyRole(role);
}

// Called from sidebar footer "Сменить роль"
export function promptSwitchRole() {
  import('./router.js').then(({ navigate }) => navigate('access'));
}

export function confirmSwitch(roleId) {
  selectRole(roleId);
}

export function applyRole(role) {
  state.currentRole = role;
  localStorage.setItem('tutoros_role', JSON.stringify(role));

  document.getElementById('setup-screen')?.classList.remove('show');

  applyRoleUI(role);

  import('./router.js').then(({ navigate }) => navigate('dashboard'));
}

export function applyRoleUI(role) {
  if (!role) return;
  const el = document.getElementById('current-role-name');
  if (el) el.textContent = role.name;

  // Hide admin-only sidebar items for teacher role
  const adminItems = document.querySelectorAll('[data-admin-only]');
  adminItems.forEach(el => {
    el.style.display = role.access === 'admin' ? '' : 'none';
  });

  // Hide finance items for teacher
  const financeItems = document.querySelectorAll('[data-finance-only]');
  financeItems.forEach(el => {
    el.style.display = role.access === 'admin' ? '' : 'none';
  });
}

export function restoreSession() {
  const raw = localStorage.getItem('tutoros_role');
  if (!raw) return false;
  try {
    const role = JSON.parse(raw);
    // Validate role still exists
    if (!CACHE.roles.find(r => r.id === role.id)) return false;
    applyRole(role);
    return true;
  } catch {
    return false;
  }
}

export function logout() {
  state.currentRole = null;
  localStorage.removeItem('tutoros_role');
  document.getElementById('setup-screen')?.classList.add('show');
}
