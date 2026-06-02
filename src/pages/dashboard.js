import { CACHE, ensureLoaded } from '../core/store.js';
import { state, effectiveRole } from '../core/state.js';
import { fmt, fmtDate, days30Start, days60Start, dateStr, esc } from '../utils/helpers.js';
import { calcRiskScore, studentSubscriptionStatus } from '../core/risk.js';
import { GROUP_COLORS } from '../utils/helpers.js';

let _dashTab = 'students';

export function setDashTab(tab) {
  _dashTab = tab;
  document.querySelectorAll('.dash-tab').forEach((b, i) => b.classList.toggle('on', ['students', 'funnel'][i] === tab));
  document.getElementById('dash-tab-students').style.display = tab === 'students' ? '' : 'none';
  document.getElementById('dash-tab-funnel').style.display = tab === 'funnel' ? '' : 'none';
}

function groupColor(gid) {
  const idx = CACHE.groups.findIndex(g => g.id === gid);
  return GROUP_COLORS[idx % GROUP_COLORS.length] || '#64748b';
}

function groupShort(id) {
  const g = CACHE.groups.find(x => x.id === id);
  return g ? g.name.slice(0, 24) + (g.name.length > 24 ? '…' : '') : '—';
}

export async function renderDashboard() {
  await ensureLoaded(['students', 'payments', 'expenses', 'groups', 'lessons']);
  const students = CACHE.students;
  const active = students.filter(s => s.crm_status === 'active');
  const d30 = days30Start(), d60 = days60Start();
  const mrr = CACHE.payments.filter(p => p.date >= d30).reduce((s, p) => s + p.amount, 0);
  const mrrPrev = CACHE.payments.filter(p => p.date >= d60 && p.date < d30).reduce((s, p) => s + p.amount, 0);
  const mrrDelta = mrrPrev ? Math.round((mrr - mrrPrev) / mrrPrev * 100) : null;
  const projectedMRR = active.reduce((sum, s) => sum + (s.price_per_hour || 0) * (s.lessons_per_month || 0), 0);
  const expThisM = CACHE.expenses.filter(e => e.date >= d30).reduce((s, e) => s + e.amount, 0);
  const profit = mrr - expThisM;
  const profitPrev = mrrPrev - CACHE.expenses.filter(e => e.date >= d60 && e.date < d30).reduce((s, e) => s + e.amount, 0);
  const profitDelta = profitPrev ? Math.round((profit - profitPrev) / Math.abs(profitPrev) * 100) : null;
  const churned30 = students.filter(s => ['stopped', 'refused', 'left'].includes(s.crm_status) && s.left_at &&
    Math.round((Date.now() - new Date(s.left_at)) / 86400000) <= 30).length;
  const retentionBase = active.length + churned30;
  const retention = retentionBase ? Math.round(active.length / retentionBase * 100) : 100;

  const deltaClass = d => d === null ? 'flat' : d > 0 ? 'up' : 'down';
  const deltaIcon = d => d === null ? '' : `<i class="ti ti-${d > 0 ? 'trending-up' : 'trending-down'}" style="font-size:11px"></i>`;

  const pulseEl = document.getElementById('dash-pulse');
  if (pulseEl) pulseEl.innerHTML = `
    <div class="pulse-card">
      <div class="p-stripe" style="background:var(--accent-mid)"></div>
      <div class="p-label">Прибыль · 30 дней</div>
      <div class="p-val" style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(profit)} ₽</div>
      ${profitDelta !== null ? `<div class="p-delta ${deltaClass(profitDelta)}">${deltaIcon(profitDelta)} ${profitDelta > 0 ? '+' : ''}${profitDelta}% к прошлому</div>` : '<div class="p-delta flat">первый месяц</div>'}
    </div>
    <div class="pulse-card">
      <div class="p-stripe" style="background:#c2b5a5"></div>
      <div class="p-label">Прогноз выручки · 30 дней</div>
      <div class="p-val" style="color:#5a5048">${projectedMRR ? fmt(projectedMRR) + ' ₽' : '—'}</div>
      <div class="p-delta flat">сумма LTV · ${active.filter(s => s.price_per_hour && s.lessons_per_month).length} уч. с тарифом</div>
    </div>
    <div class="pulse-card">
      <div class="p-stripe" style="background:#22c55e"></div>
      <div class="p-label">Активных учеников</div>
      <div class="p-val">${active.length}</div>
      <div class="p-delta flat">${students.filter(s => s.crm_status === 'lead').length} лидов · ${students.filter(s => ['trial', 'trial_scheduled', 'trial_done'].includes(s.crm_status)).length} пробных</div>
    </div>
    <div class="pulse-card">
      <div class="p-stripe" style="background:${retention >= 85 ? '#22c55e' : retention >= 70 ? '#f59e0b' : '#ef4444'}"></div>
      <div class="p-label">Удержание</div>
      <div class="p-val" style="color:${retention >= 85 ? 'var(--green)' : retention >= 70 ? 'var(--amber)' : 'var(--red)'}">${retention}%</div>
      <div class="p-delta flat">${churned30} ушли за 30 дней</div>
    </div>`;

  // Ближайшие занятия
  const todayStr = dateStr(new Date());
  const now = new Date();
  const upcoming = CACHE.lessons.filter(l => {
    if (l.date < todayStr) return false;
    if (l.date > todayStr) return true;
    const [h, m] = (l.start_time || '00:00').split(':').map(Number);
    return new Date(l.date + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')) >= now;
  }).sort((a, b) => a.date !== b.date ? (a.date > b.date ? 1 : -1) : (a.start_time || '').localeCompare(b.start_time || '')).slice(0, 3);

  const todayEl = document.getElementById('dash-today');
  if (todayEl) {
    const fmtLessonDate = ds => {
      const d = new Date(ds + 'T00:00:00');
      const t2 = new Date(); t2.setHours(0, 0, 0, 0);
      const diff = Math.round((d - t2) / 86400000);
      if (diff === 0) return 'Сегодня';
      if (diff === 1) return 'Завтра';
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    };
    if (!upcoming.length) {
      todayEl.innerHTML = `<div class="today-none"><i class="ti ti-coffee" style="display:block;font-size:20px;opacity:.3;margin-bottom:6px"></i>Ближайших занятий нет</div>`;
    } else {
      todayEl.innerHTML = `<div class="today-strip">${upcoming.map(l => {
        const gr = CACHE.groups.find(g => g.id === l.group_id);
        const gc = groupColor(l.group_id);
        const memberCount = gr ? CACHE.students.filter(s => s.group_id === gr.id && s.crm_status === 'active').length : 0;
        return `<div class="today-lesson" style="border-left-color:${gc}" onclick="navigate('lessons_cal')">
          <div style="font-size:10px;color:var(--accent-mid);font-weight:600;margin-bottom:2px">${fmtLessonDate(l.date)} · ${l.start_time || '?'}</div>
          <div class="today-lesson-name">${gr ? esc(gr.name) : 'Без группы'}</div>
          <div class="today-lesson-meta">${esc(l.topic) || 'Тема не указана'}</div>
          <div style="margin-top:4px;font-size:10px;color:var(--hint)"><i class="ti ti-users" style="font-size:10px"></i> ${memberCount} уч.</div>
        </div>`;
      }).join('')}
      <div class="today-lesson" style="border-left-color:var(--border);border-style:dashed;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer" onclick="navigate('lessons_cal')">
        <span style="font-size:11px;color:var(--hint)"><i class="ti ti-plus"></i> Добавить</span>
      </div></div>`;
    }
  }

  // Action queue
  const actions = [];
  active.forEach(s => {
    const sub = studentSubscriptionStatus(s);
    if (sub && sub.daysLeft < 0) actions.push({ level: 'urgent', icon: 'ti-clock-x', title: `${esc(s.name)} — абонемент просрочен на ${Math.abs(sub.daysLeft)} дн.`, sub: `${esc(s.source) || ''}${s.group_id ? ' · ' + esc(groupShort(s.group_id)) : ''}`, action: `openPaymentModalFor('${s.id}')`, actionLabel: 'Добавить оплату' });
  });
  active.filter(s => !s.paid).forEach(s => actions.push({ level: 'urgent', icon: 'ti-cash-off', title: `${esc(s.name)} — не оплачен`, sub: `${esc(s.source) || ''}${s.group_id ? ' · ' + esc(groupShort(s.group_id)) : ''}`, action: `openPaymentModalFor('${s.id}')`, actionLabel: 'Добавить оплату' }));
  active.forEach(s => {
    const { level, reasons } = calcRiskScore(s);
    if (level === 'high' && !actions.find(a => a.title.startsWith(esc(s.name)))) actions.push({ level: 'urgent', icon: 'ti-alert-triangle', title: `${esc(s.name)} — высокий риск`, sub: esc(reasons.join(' · ')), action: `openStudentDetail('${s.id}')`, actionLabel: 'Открыть' });
  });
  active.forEach(s => {
    const sub = studentSubscriptionStatus(s);
    if (sub && sub.daysLeft >= 0 && sub.daysLeft <= 7) actions.push({ level: 'important', icon: 'ti-clock', title: `${esc(s.name)} — абонемент истекает через ${sub.daysLeft} дн.`, sub: `до ${fmtDate(sub.sub_end)}`, action: `openPaymentModalFor('${s.id}')`, actionLabel: 'Продлить' });
  });
  const hwByStudent = {};
  (CACHE.hw_submissions || []).filter(h => h.status === 'missing').forEach(h => { hwByStudent[h.student_id] = (hwByStudent[h.student_id] || 0) + 1; });
  Object.entries(hwByStudent).forEach(([sid, cnt]) => {
    const s = students.find(x => x.id === sid);
    if (s) actions.push({ level: 'important', icon: 'ti-home-off', title: `${esc(s.name)} — ${cnt} ДЗ не сдано`, sub: '', action: `openStudentDetail('${sid}')`, actionLabel: 'Карточка' });
  });
  active.forEach(s => {
    const { level, reasons } = calcRiskScore(s);
    if (level === 'med' && !actions.find(a => a.title.startsWith(esc(s.name)))) actions.push({ level: 'important', icon: 'ti-alert-circle', title: `${esc(s.name)}`, sub: esc(reasons.join(' · ')), action: `openStudentDetail('${s.id}')`, actionLabel: 'Карточка' });
  });
  students.filter(s => s.crm_status === 'lead').forEach(s => {
    const age = Math.round((Date.now() - new Date(s.created_at)) / 86400000);
    if (age >= 3) actions.push({ level: 'notice', icon: 'ti-user-question', title: `Лид: ${esc(s.name)} — ${age} дн. без движения`, sub: `${esc(s.source) || ''}`, action: `openStudentDetail('${s.id}')`, actionLabel: 'Карточка' });
  });

  // HW queue alerts
  const role2 = effectiveRole();
  const myGroupIds2 = role2.isOwner
    ? null
    : new Set((CACHE.assistant_groups || []).filter(ag => ag.assistant_id === role2.id).map(ag => ag.group_id));
  const myAssignmentIds2 = new Set(
    (CACHE.homework_assignments || [])
      .filter(a => !myGroupIds2 || myGroupIds2.has(a.group_id))
      .map(a => a.id)
  );
  const pendingReview = (CACHE.homework_submissions || []).filter(s =>
    s.status === 'submitted' && myAssignmentIds2.has(s.assignment_id)
  );
  const overdueHw = (CACHE.homework_submissions || []).filter(s => {
    if (s.status === 'checked') return false;
    if (myAssignmentIds2.size && !myAssignmentIds2.has(s.assignment_id)) return false;
    const asgn = (CACHE.homework_assignments || []).find(a => a.id === s.assignment_id);
    return asgn?.due_date && new Date(asgn.due_date) < new Date();
  });
  if (pendingReview.length) actions.push({ level: 'important', icon: 'ti-clipboard-check', title: `${pendingReview.length} ДЗ ждут проверки`, sub: 'по вашим группам', action: `navigate('homework')`, actionLabel: 'Проверить' });
  if (overdueHw.length) actions.push({ level: 'notice', icon: 'ti-clock-x', title: `${overdueHw.length} ДЗ просрочены`, sub: '', action: `navigate('homework')`, actionLabel: 'Посмотреть' });

  const actionsEl = document.getElementById('dash-actions');
  const countEl = document.getElementById('dash-action-count');
  if (countEl) countEl.textContent = actions.length ? `${actions.length} пунктов` : '';
  if (actionsEl) {
    if (!actions.length) {
      actionsEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--hint);font-size:13px;background:var(--surface2);border-radius:var(--r)"><i class="ti ti-circle-check" style="display:block;font-size:24px;margin-bottom:6px;color:#22c55e"></i>Всё под контролем</div>`;
    } else {
      actionsEl.innerHTML = actions.map(a => `
        <div class="action-item ${a.level}" onclick="${a.action}">
          <div class="action-icon"><i class="ti ${a.icon}"></i></div>
          <div class="action-text">
            <div class="action-title">${a.title}</div>
            ${a.sub ? `<div class="action-sub">${a.sub}</div>` : ''}
          </div>
          <button class="btn btn-sm action-btn" onclick="event.stopPropagation();${a.action}">${a.actionLabel}</button>
        </div>`).join('');
    }
  }


  // Funnel
  const funnelEl = document.getElementById('dash-funnel');
  if (funnelEl) {
    const counts = {
      lead: students.filter(s => s.crm_status === 'lead').length,
      trial_scheduled: students.filter(s => s.crm_status === 'trial_scheduled').length,
      trial_done: students.filter(s => ['trial_done', 'trial'].includes(s.crm_status)).length,
      active: students.filter(s => s.crm_status === 'active').length,
      exam_passed: students.filter(s => s.crm_status === 'exam_passed').length,
      stopped: students.filter(s => ['stopped', 'refused'].includes(s.crm_status)).length,
      left: students.filter(s => s.crm_status === 'left').length,
    };
    const steps = [
      { label: 'Лиды', color: '#64748b', n: counts.lead },
      { label: 'Пробник назначен', color: '#7c3aed', n: counts.trial_scheduled },
      { label: 'Пробник проведён', color: '#d97706', n: counts.trial_done },
      { label: 'Занимаются', color: '#16a34a', n: counts.active },
      { label: 'Сдали экзамен', color: '#0891b2', n: counts.exam_passed },
    ];
    const maxN = Math.max(...steps.map(s => s.n), 1);
    const trialTotal = counts.trial_scheduled + counts.trial_done;
    const c1 = counts.lead ? Math.round(trialTotal / counts.lead * 100) : 0;
    const c2 = trialTotal ? Math.round(counts.active / trialTotal * 100) : 0;
    funnelEl.innerHTML = steps.map((s, i) => {
      const conv = i === 1 ? `${c1}% из лидов` : i === 3 ? `${c2}% из пробных` : '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:${i < steps.length - 1 ? '1px solid var(--border)' : 'none'}">
        <div style="width:130px;font-size:12px;font-weight:600;color:var(--text);cursor:pointer" onclick="navigate('crm_students')">${s.label}</div>
        <div style="flex:1;background:var(--surface2);border-radius:3px;height:20px;overflow:hidden">
          <div style="height:20px;border-radius:3px;background:${s.color};width:${s.n / maxN * 100}%;display:flex;align-items:center;padding-left:6px;min-width:${s.n ? '24px' : '0'};transition:.3s">
            ${s.n ? `<span style="font-size:11px;font-weight:700;color:#fff;white-space:nowrap">${s.n}</span>` : ''}
          </div>
        </div>
        <div style="width:70px;text-align:right;font-size:11px;color:var(--muted);white-space:nowrap">${conv}</div>
      </div>`;
    }).join('') + `<div style="margin-top:10px;display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--muted)">
      <span>Конверсия лид→активный: <b style="color:var(--text)">${counts.lead ? Math.round(counts.active / counts.lead * 100) : 0}%</b></span>
      <span>Отказались: <b style="color:var(--text)">${counts.stopped}</b></span>
      <span>Ушли: <b style="color:var(--text)">${counts.left}</b></span>
    </div>`;
  }

  // History
  const histEl = document.getElementById('dash-history');
  if (histEl) {
    const entries = (CACHE.history_log || []).slice(0, 5);
    if (!entries.length) { histEl.innerHTML = '<div class="empty" style="padding:14px">Изменений пока нет</div>'; }
    else histEl.innerHTML = entries.map(e => `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)">
      <div style="width:8px;height:8px;border-radius:50%;background:var(--accent-mid);flex-shrink:0;margin-top:4px"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500">${esc(e.description || e.action)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px"><i class="ti ti-user" style="font-size:10px"></i> ${e.actor} · ${new Date(e.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    </div>`).join('');
  }
}
