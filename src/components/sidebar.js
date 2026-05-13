import { setupNav } from '../core/router.js';
import { applyRoleUI } from '../core/auth.js';
import { CACHE } from '../core/store.js';
import { state } from '../core/state.js';

export function initSidebar() {
  setupNav();

  // Setup role cards on the setup screen
  renderSetupRoles();
}

export function renderSetupRoles() {
  const container = document.getElementById('setup-roles');
  if (!container) return;
  const ownerBtn = `<button class="btn btn-p" style="background:var(--surface2);color:var(--fg);border:1px solid var(--border)" onclick="selectRole('owner')">
    <i class="ti ti-crown" style="margin-right:6px"></i>Владелец
  </button>`;
  const roleBtns = CACHE.roles.map(r => `
    <button class="btn btn-p" onclick="selectRole('${r.id}')">${r.name}</button>
  `).join('');
  container.innerHTML = ownerBtn + roleBtns;
}
