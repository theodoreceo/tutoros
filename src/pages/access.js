import { supabase } from '../lib/supabase.js';
import { CACHE, dbInsert, dbUpdate, dbDelete, isDemoMode } from '../core/store.js';
import { uid, g, ALL_PAGES, ROLE_TYPES } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';

function assistantRoles() {
  return (CACHE.roles || []).filter(r => r.role_type !== 'owner');
}

export function renderAccess() {
  const el = document.getElementById('roles-list');
  if (!el) return;

  // Owner's bot token block
  const ownerRole = (CACHE.roles || []).find(r => r.role_type === 'owner');
  const ownerBlock = ownerRole?.reg_token ? `
    <div style="background:var(--surface2,var(--surface));border:1px solid var(--border);border-radius:var(--r);padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <i class="ti ti-brand-telegram" style="font-size:20px;color:#2aabee;flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Ваш Telegram-код (владелец)</div>
        <div style="font-size:12px;color:var(--muted)">${ownerRole.telegram_id ? '<span class="b b-g"><i class="ti ti-check" style="font-size:10px"></i> Бот привязан</span>' : '<span class="b b-gray">Не привязан</span>'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <code style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:3px 10px;font-size:13px;font-family:monospace">${ownerRole.reg_token}</code>
        <button class="btn btn-sm" onclick="copyRegToken('${ownerRole.reg_token}')" title="Скопировать"><i class="ti ti-copy"></i></button>
      </div>
    </div>` : '';

  const roles = assistantRoles();
  el.innerHTML = ownerBlock + (roles.length
    ? roles.map(r => {
        const rt = ROLE_TYPES[r.role_type];
        const roleLabel = rt?.label || 'Ассистент';
        const roleIcon = rt?.icon || 'ti-user';
        const linked = !!r.user_id;
        return `<div class="card">
          <div class="card-header">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:7px">
                <span style="width:10px;height:10px;border-radius:50%;background:${r.color || '#64748b'};flex-shrink:0;display:inline-block"></span>
                <span style="font-size:14px;font-weight:600">${r.name}</span>
              </div>
              <div style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span class="b b-bl"><i class="ti ${roleIcon}" style="font-size:10px"></i> ${roleLabel}</span>
                ${isDemoMode()
                  ? `<span class="b b-gray" title="PIN"><i class="ti ti-key" style="font-size:10px"></i> ${r.pin || 'без PIN'}</span>`
                  : linked
                    ? `<span class="b b-g"><i class="ti ti-check" style="font-size:10px"></i> Аккаунт привязан</span>`
                    : `<span class="b b-r"><i class="ti ti-clock" style="font-size:10px"></i> Ожидает регистрации</span>`
                }
                ${!isDemoMode() && r.reg_token
                  ? `<span style="display:flex;align-items:center;gap:5px">
                       <span style="font-size:11px;color:var(--muted)">Telegram-код:</span>
                       <code style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 7px;font-size:11px;font-family:monospace">${r.reg_token}</code>
                       <button class="btn btn-sm" style="padding:1px 6px" onclick="copyRegToken('${r.reg_token}')" title="Скопировать код"><i class="ti ti-copy" style="font-size:11px"></i></button>
                       ${r.telegram_id ? '<i class="ti ti-brand-telegram" style="color:#2aabee;font-size:13px" title="Бот привязан"></i>' : ''}
                     </span>`
                  : ''
                }
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
              ${!isDemoMode() && !linked
                ? `<button class="btn btn-sm" onclick="openInviteModal('${r.id}')" title="Пригласить"><i class="ti ti-mail"></i> Пригласить</button>`
                : ''
              }
              <button class="btn btn-sm btn-icon" onclick="editRole('${r.id}')"><i class="ti ti-edit"></i></button>
              <button class="btn btn-sm btn-icon" onclick="deleteRole('${r.id}')"><i class="ti ti-trash" style="color:var(--red)"></i></button>
            </div>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">Ассистентов нет. Добавьте первого.</div>');

  renderAssistantGroupsSection();
}

function renderAssistantGroupsSection() {
  const el = document.getElementById('assistant-groups-section');
  if (!el) return;
  const roles = assistantRoles();
  if (!roles.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;margin-top:4px">
      <i class="ti ti-sitemap"></i> Назначение на группы
    </div>
    ${roles.map(role => {
      const myGroups = new Set((CACHE.assistant_groups || []).filter(ag => ag.assistant_id === role.id).map(ag => ag.group_id));
      return `<div class="card" style="margin-bottom:10px">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:7px">
          <span style="width:10px;height:10px;border-radius:50%;background:${role.color || '#64748b'};flex-shrink:0;display:inline-block"></span>
          ${role.name}
        </div>
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
      ${isDemoMode() ? `<div class="fg"><label>PIN-код</label><input class="fi" id="rf-pin" value="${v.pin || ''}" placeholder="1234" maxlength="8"></div>` : ''}
    </div>
    <div class="fg" style="margin-top:2px">
      <label>Цвет в календаре</label>
      <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
        <input type="color" id="rf-color" value="${v.color || '#7c3aed'}" style="width:38px;height:34px;border:1px solid var(--border);border-radius:var(--r);cursor:pointer;padding:2px;background:transparent">
        <span style="font-size:12px;color:var(--muted)">Отображается в календаре при ведении занятий</span>
      </div>
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
  const color = document.getElementById('rf-color')?.value || '#7c3aed';
  const obj = { id: id || uid(), name: g('rf-name'), pages, role_type: roleType, can_edit: false, color };
  if (isDemoMode()) obj.pin = g('rf-pin');
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

// ── Invite system (production mode only) ─────────────────────────────────────

export function openInviteModal(roleId) {
  const role = (CACHE.roles || []).find(r => r.id === roleId);
  if (!role) return;
  modal(`<div class="modal" style="max-width:420px">
    <div class="modal-title"><i class="ti ti-mail" style="margin-right:6px"></i>Пригласить ассистента</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">
      Роль: <strong>${role.name}</strong> (${ROLE_TYPES[role.role_type]?.label || role.role_type})
    </p>
    <div id="invite-form-body">
      <div class="fg">
        <label>Email ассистента</label>
        <input class="fi" type="email" id="invite-email" placeholder="assistant@example.com">
      </div>
      <div id="invite-result"></div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Закрыть</button>
      <button class="btn btn-p" id="invite-submit-btn" onclick="createInvite('${roleId}')">Создать ссылку</button>
    </div>
  </div>`);
  setTimeout(() => document.getElementById('invite-email')?.focus(), 50);
}

export async function createInvite(roleId) {
  const email = (document.getElementById('invite-email')?.value || '').trim();
  if (!email) { toast('Введите email'); return; }

  const btn = document.getElementById('invite-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Создание...'; }

  const { data, error } = await supabase
    .from('invites')
    .insert({ email, role_id: roleId })
    .select()
    .single();

  if (error) {
    toast('Ошибка: ' + error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Создать ссылку'; }
    return;
  }

  const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${data.token}`;
  const resultEl = document.getElementById('invite-result');
  const formBody = document.getElementById('invite-form-body');

  if (formBody) formBody.innerHTML = `
    <div style="background:var(--surface-alt,var(--surface));border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-top:4px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Ссылка для <strong>${email}</strong>:</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="fi" value="${inviteUrl}" readonly onclick="this.select()" style="font-size:12px;font-family:monospace">
        <button class="btn btn-sm" onclick="navigator.clipboard.writeText('${inviteUrl}').then(()=>toast('Скопировано'))">
          <i class="ti ti-copy"></i>
        </button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px">
        <i class="ti ti-info-circle"></i> Ссылка одноразовая. Отправь её ассистенту вручную.
      </div>
    </div>
  `;
  if (btn) btn.style.display = 'none';
}
