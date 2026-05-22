import { setupNav } from '../core/router.js';
import { applyRoleUI } from '../core/auth.js';
import { CACHE } from '../core/store.js';
import { state } from '../core/state.js';

export function initSidebar() {
  setupNav();
}
