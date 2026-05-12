import { CACHE, dbInsert, dbUpdate, dbDelete, dbFind } from '../core/store.js';
import { uid } from '../utils/helpers.js';
import { modal, closeModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { selectRole } from '../core/auth.js';
import { renderSetupRoles } from '../components/sidebar.js';

export function renderAccess() {
  const el = document.getElementById('access-content');
  if (!el) return;

  el.innerHTML = `
    <div class="ph">
      <span class="ph-title">Роли и доступ</span>
      <button class="btn btn-p btn-sm" onclick="window.__openRoleModal()">+ Роль</button>
    </div>

    <table style="width:100%;border-collapse:collapse" class="tbl-wrap">
      <thead><tr>
        <th>Имя</th><th>Тип доступа</th><th>PIN</th><th></th>
      </tr></thead>
      <tbody>
        ${CACHE.roles.map(r => `
          <tr>
            <td><strong>${r.name}</strong></td>
            <td><span class="b ${r.access==='admin'?'b-bl':'b-g'}">${r.access==='admin'?'Администратор':'Педагог'}</span></td>
            <td><code style="background:var(--surface2);padding:2px 6px;border-radius:4px;font-size:12px">${r.pin}</code></td>
            <td style="display:flex;gap:4px">
              <button class="btn btn-sm" onclick="window.__openRoleModal('${r.id}')">✏️</button>
              <button class="btn btn-sm" onclick="window.__selectRole('${r.id}')">Войти</button>
              <button class="btn btn-sm btn-danger" onclick="window.__deleteRole('${r.id}')">✕</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div style="margin-top:24px">
      <div class="an-section">Описание уровней доступа</div>
      <div class="alert alert-b">
        <i class="ph-bold ph-shield"></i>
        <div>
          <strong>Администратор</strong> — полный доступ: ученики, финансы, аналитика, настройки.<br>
          <strong>Педагог</strong> — только свои ученики и расписание. Финансы скрыты.
        </div>
      </div>
    </div>
  `;
}

export function openRoleModal(id = null) {
  const r = id ? dbFind('roles', id) : null;
  modal('role-modal', `
    <div class="modal-title">${r ? 'Редактировать роль' : 'Новая роль'}</div>
    <div class="fg"><label>Имя *</label><input class="fi" id="rm-name" value="${r?.name || ''}" placeholder="Анна Петровна"></div>
    <div class="fg"><label>PIN-код (4 цифры) *</label><input class="fi" id="rm-pin" maxlength="8" value="${r?.pin || ''}" placeholder="1234" type="password"></div>
    <div class="fg"><label>Тип доступа</label>
      <select class="fi" id="rm-access">
        <option value="teacher" ${r?.access==='teacher'?'selected':''}>Педагог</option>
        <option value="admin" ${r?.access==='admin'?'selected':''}>Администратор</option>
      </select>
    </div>
    <div class="modal-footer">
      ${r ? `<button class="btn btn-danger" onclick="window.__deleteRole('${r.id}')">Удалить</button>` : ''}
      <button class="btn" onclick="window.__closeModal()">Отмена</button>
      <button class="btn btn-p" onclick="window.__saveRole('${id||''}')">Сохранить</button>
    </div>
  `);
}

export function saveRole(id) {
  const name = document.getElementById('rm-name')?.value?.trim();
  const pin = document.getElementById('rm-pin')?.value?.trim();
  if (!name || !pin) { toast('Заполните имя и PIN'); return; }

  const patch = {
    name,
    pin,
    access: document.getElementById('rm-access')?.value || 'teacher',
  };

  if (id) {
    dbUpdate('roles', id, patch);
  } else {
    dbInsert('roles', patch);
  }

  closeModal();
  toast('Сохранено');
  renderAccess();
  renderSetupRoles();
}

export function deleteRole(id) {
  if (CACHE.roles.length <= 1) { toast('Нельзя удалить последнюю роль'); return; }
  if (!confirm('Удалить роль?')) return;
  dbDelete('roles', id);
  closeModal();
  toast('Роль удалена');
  renderAccess();
  renderSetupRoles();
}
