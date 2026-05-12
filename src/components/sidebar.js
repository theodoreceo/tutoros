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
  container.innerHTML = CACHE.roles.map(r => `
    <button class="btn btn-p" onclick="window.__selectRole('${r.id}')">
      ${r.name}
    </button>
  `).join('');
}
