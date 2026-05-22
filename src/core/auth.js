import { supabase } from '../lib/supabase.js';
import { CACHE, isDemoMode } from './store.js';
import { state } from './state.js';
import { ALL_PAGES, ROLE_TYPES } from '../utils/helpers.js';

// ── Demo-mode legacy role (hardcoded, not in DB) ──────────────────────────────
const OWNER_ROLE = { id: 'owner', name: 'Владелец', pages: ALL_PAGES.map(p => p.id), canEdit: true, isOwner: true };

function buildRole(role) {
  if (role.role_type === 'owner') {
    return { ...role, isOwner: true, canEdit: true, pages: ALL_PAGES.map(p => p.id) };
  }
  const rt = ROLE_TYPES[role?.role_type];
  return { ...role, isOwner: false, ...(rt ? { pages: rt.pages } : {}) };
}

// ── UI ────────────────────────────────────────────────────────────────────────

export function applyRoleUI(role) {
  if (!role) return;
  const el = document.getElementById('current-role-name');
  if (el) el.textContent = role.name;

  document.querySelectorAll('.sb-item[data-pg]').forEach(item => {
    const visible = role.isOwner || (role.pages || []).includes(item.dataset.pg);
    item.style.display = visible ? '' : 'none';
  });

  document.querySelectorAll('.sb-section[data-sb-group]').forEach(section => {
    const group = section.dataset.sbGroup;
    const hasVisible = [...document.querySelectorAll(`.sb-item[data-sb-section="${group}"]`)]
      .some(item => item.style.display !== 'none');
    section.style.display = hasVisible ? '' : 'none';
  });

  const dashItem = document.querySelector('.sb-item[data-pg="dashboard"]');
  if (dashItem) dashItem.style.display = role.isOwner ? '' : 'none';

  document.querySelectorAll('.owner-only').forEach(el => el.style.display = role.isOwner ? '' : 'none');
  document.querySelectorAll('.edit-only').forEach(el => el.style.display = (role.canEdit || role.isOwner) ? '' : 'none');
}

function _renderDevSwitcher(activeRole) {
  const bar = document.getElementById('dev-role-switcher');
  if (!bar) return;
  if (!isDemoMode()) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  const allRoles = [
    { ...OWNER_ROLE, name: 'Владелец' },
    ...CACHE.roles.filter(r => r.role_type !== 'owner'),
  ];

  bar.innerHTML = allRoles.map(r => {
    const isActive = activeRole.id === r.id || (activeRole.isOwner && r.id === 'owner');
    const rt = ROLE_TYPES[r.role_type];
    const label = r.isOwner ? 'Владелец' : (rt?.label || r.name);
    return `<button onclick="selectRole('${r.id}')" style="
      font-size:11px;padding:3px 10px;border-radius:10px;border:1px solid;cursor:pointer;
      font-family:inherit;transition:all .15s;
      background:${isActive ? 'rgba(59,130,246,.18)' : 'rgba(226,232,240,.04)'};
      color:${isActive ? '#60a5fa' : 'rgba(226,232,240,.35)'};
      border-color:${isActive ? 'rgba(59,130,246,.4)' : 'rgba(226,232,240,.1)'}
    ">${label}</button>`;
  }).join('');
}

export function applyRole(role) {
  state.currentRole = role;
  if (isDemoMode()) localStorage.setItem('tutoros_role', JSON.stringify(role));
  document.getElementById('setup-screen')?.classList.remove('show');
  document.getElementById('app').style.display = 'flex';
  applyRoleUI(role);
  _renderDevSwitcher(role);
  import('./router.js').then(({ navigate }) => {
    const homePage = role.isOwner
      ? 'dashboard'
      : (ROLE_TYPES[role.role_type]?.homePage || role.pages?.[0] || 'dashboard');
    navigate(homePage);
  });
}

// ── Session restore ───────────────────────────────────────────────────────────

export async function restoreSession() {
  if (isDemoMode()) return _restoreSessionDemo();
  return _restoreSessionAuth();
}

function _restoreSessionDemo() {
  try {
    const raw = localStorage.getItem('tutoros_role');
    if (!raw) return false;
    const role = JSON.parse(raw);
    if (role.id === 'owner') { applyRole(OWNER_ROLE); return true; }
    const found = CACHE.roles.find(r => r.id === role.id);
    if (found) { applyRole(buildRole(found)); return true; }
  } catch { }
  return false;
}

async function _restoreSessionAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const roleRow = CACHE.roles.find(r => r.user_id === session.user.id);
  if (!roleRow) return false;

  applyRole(buildRole(roleRow));
  return true;
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logout() {
  if (isDemoMode()) {
    state.currentRole = null;
    localStorage.removeItem('tutoros_role');
  } else {
    state.currentRole = null;
    await supabase.auth.signOut();
  }
  document.getElementById('app').style.display = 'none';
  const ss = document.getElementById('setup-screen');
  if (ss) ss.classList.add('show');
  if (isDemoMode()) promptSwitchRole();
  else showLoginForm();
}

// ── Login form ────────────────────────────────────────────────────────────────

export async function showLoginForm() {
  const container = document.getElementById('setup-roles');
  if (!container) return;

  let ownerClaimed = true;
  try {
    const { data } = await supabase.rpc('is_owner_claimed');
    ownerClaimed = data ?? true;
  } catch { /* if function missing, assume claimed */ }

  container.innerHTML = `
    <form onsubmit="handleLogin(event)" style="display:flex;flex-direction:column;gap:12px">
      <div class="fg">
        <label>Email</label>
        <input class="fi" type="email" id="login-email" placeholder="email@example.com" autocomplete="email" required>
      </div>
      <div class="fg">
        <label>Пароль</label>
        <input class="fi" type="password" id="login-password" placeholder="••••••••" autocomplete="current-password" required>
      </div>
      <button type="submit" class="btn btn-p" id="login-btn" style="width:100%;justify-content:center">Войти</button>
      <div id="login-error" style="color:var(--red);font-size:12px;text-align:center;display:none"></div>
      ${!ownerClaimed ? `
      <div style="margin-top:4px;padding-top:12px;border-top:1px solid var(--border);text-align:center">
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Первый запуск — аккаунт владельца не создан</div>
        <button type="button" class="btn" onclick="showRegisterForm(null)" style="width:100%;font-size:12px">
          <i class="ti ti-crown" style="margin-right:4px"></i>Создать аккаунт владельца
        </button>
      </div>` : ''}
    </form>
  `;
  setTimeout(() => document.getElementById('login-email')?.focus(), 50);
}

export function showRegisterForm(inviteToken) {
  const container = document.getElementById('setup-roles');
  if (!container) return;

  const isInvite = !!inviteToken;
  container.innerHTML = `
    <form onsubmit="handleRegister(event)" style="display:flex;flex-direction:column;gap:12px">
      <div class="fg">
        <label>Email${isInvite ? ' (тот, на который пришло приглашение)' : ''}</label>
        <input class="fi" type="email" id="reg-email" placeholder="email@example.com" autocomplete="email" required>
      </div>
      <div class="fg">
        <label>Пароль</label>
        <input class="fi" type="password" id="reg-password" placeholder="Минимум 6 символов" autocomplete="new-password" required minlength="6">
      </div>
      ${inviteToken ? `<input type="hidden" id="reg-invite-token" value="${inviteToken}">` : ''}
      <button type="submit" class="btn btn-p" id="reg-btn" style="width:100%;justify-content:center">
        ${isInvite ? 'Принять приглашение' : 'Зарегистрироваться как владелец'}
      </button>
      <div id="reg-error" style="color:var(--red);font-size:12px;text-align:center;display:none"></div>
      <button type="button" class="btn" onclick="showLoginForm()" style="width:100%;font-size:12px;justify-content:center">
        ← Назад ко входу
      </button>
    </form>
  `;
  setTimeout(() => document.getElementById('reg-email')?.focus(), 50);
}

export async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  const errorEl = document.getElementById('login-error');

  btn.disabled = true;
  btn.textContent = 'Вход...';
  errorEl.style.display = 'none';

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    errorEl.textContent = error.message === 'Invalid login credentials'
      ? 'Неверный email или пароль'
      : error.message;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Войти';
    return;
  }

  window.location.reload();
}

export async function handleRegister(event) {
  event.preventDefault();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const inviteToken = document.getElementById('reg-invite-token')?.value || null;
  const btn = document.getElementById('reg-btn');
  const errorEl = document.getElementById('reg-error');

  btn.disabled = true;
  btn.textContent = 'Создание аккаунта...';
  errorEl.style.display = 'none';

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });

  if (signUpError) {
    errorEl.textContent = signUpError.message;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = inviteToken ? 'Принять приглашение' : 'Зарегистрироваться как владелец';
    return;
  }

  if (!signUpData.session) {
    errorEl.style.color = 'var(--muted)';
    errorEl.textContent = 'Письмо с подтверждением отправлено на ' + email + '. Подтверди email — затем войди через форму входа. Или отключи "Confirm email" в Supabase Auth Settings и зарегистрируйся снова.';
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = inviteToken ? 'Принять приглашение' : 'Зарегистрироваться как владелец';
    return;
  }

  btn.textContent = 'Привязка роли...';

  const rpcName = inviteToken ? 'accept_invite' : 'claim_owner';
  const rpcArgs = inviteToken ? { p_token: inviteToken } : {};
  const { data: result, error: rpcError } = await supabase.rpc(rpcName, rpcArgs);

  if (rpcError || result?.error) {
    errorEl.textContent = result?.error || rpcError?.message || 'Ошибка привязки роли';
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = inviteToken ? 'Принять приглашение' : 'Зарегистрироваться как владелец';
    await supabase.auth.signOut();
    return;
  }

  window.location.reload();
}

// ── Demo-mode: role switching (unchanged) ─────────────────────────────────────

export function promptSwitchRole() {
  if (!isDemoMode()) return;
  const roles = [{ ...OWNER_ROLE, name: 'Владелец (полный доступ)', pin: null }, ...CACHE.roles.filter(r => r.role_type !== 'owner')];
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
  if (!isDemoMode()) return;
  import('../components/modal.js').then(({ modal, closeModal }) => {
    import('../components/toast.js').then(({ toast }) => {
      if (id === 'owner') { applyRole(OWNER_ROLE); closeModal(); toast('Вы вошли как Владелец'); return; }
      const role = CACHE.roles.find(r => r.id === id);
      if (!role) return;
      if (!role.pin) { applyRole(buildRole(role)); closeModal(); return; }
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
  if (!isDemoMode()) return;
  import('../components/modal.js').then(({ closeModal }) => {
    import('../components/toast.js').then(({ toast }) => {
      const pin = (document.getElementById('switch-pin') || {}).value || '';
      const role = CACHE.roles.find(r => r.id === id);
      if (!role) return;
      if (role.pin !== pin) { toast('Неверный PIN'); return; }
      applyRole(buildRole(role));
      closeModal();
      toast(`Вы вошли как: ${role.name}`);
    });
  });
}
