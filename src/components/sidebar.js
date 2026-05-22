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

  const isEmpty = !CACHE.groups.length && !CACHE.roles.length;
  const emptyState = isEmpty ? `
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);text-align:center">
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px">База данных пуста</div>
      <button class="btn" style="width:100%;justify-content:center;gap:6px" onclick="seedDemoData()">
        <i class="ti ti-database-import"></i> Загрузить демо-данные
      </button>
    </div>` : '';

  container.innerHTML = ownerBtn + roleBtns + emptyState;
}
