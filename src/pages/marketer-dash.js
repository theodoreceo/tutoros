import { CACHE, ensureLoaded } from '../core/store.js';
import { state } from '../core/state.js';
import { fmt, fmtDate, esc, today, dateStr } from '../utils/helpers.js';

let _period = 30; // days

export function setMktPeriod(days) {
  _period = days;
  document.querySelectorAll('.mkt-period-btn').forEach(b =>
    b.classList.toggle('on', +b.dataset.days === days)
  );
  _render();
}

export async function renderMarketerDashPage() {
  await ensureLoaded(['students', 'payments', 'expenses', 'lessons']);
  const el = document.getElementById('pg-marketer_dash');
  if (!el) return;

  el.innerHTML = `
    <div style="padding:20px;max-width:1100px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div style="font-size:20px;font-weight:700">Дашборд маркетолога</div>
        <div style="display:flex;gap:4px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:3px">
          ${[30,90,180,360].map(d => `<button class="btn btn-sm mkt-period-btn${d === _period ? ' on' : ''}" data-action="setMktPeriod" data-days="${d}">${d === 360 ? '1г' : d + 'д'}</button>`).join('')}
        </div>
      </div>
      <div id="mkt-body"></div>
    </div>
  `;
  _render();
}

function _render() {
  const el = document.getElementById('mkt-body');
  if (!el) return;

  const students = CACHE.students || [];
  const payments = CACHE.payments || [];
  const expenses = CACHE.expenses || [];

  // Period boundaries
  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setDate(now.getDate() - _period);
  const periodStartStr = periodStart.toISOString().slice(0, 10);

  const prevStart = new Date(periodStart);
  prevStart.setDate(prevStart.getDate() - _period);
  const prevStartStr = prevStart.toISOString().slice(0, 10);

  // Helpers
  const inPeriod = (dateStr) => dateStr && dateStr >= periodStartStr;
  const inPrev   = (dateStr) => dateStr && dateStr >= prevStartStr && dateStr < periodStartStr;

  // New leads in period = students whose first_contact_at or created_at is in period
  const newLeads = students.filter(s => inPeriod(s.first_contact_at || s.created_at));
  const prevLeads = students.filter(s => inPrev(s.first_contact_at || s.created_at));

  // Became active in period (via status_history)
  const becameActive = students.filter(s =>
    (s.status_history || []).some(h => h.status === 'active' && inPeriod(h.date))
  );
  const prevBecameActive = students.filter(s =>
    (s.status_history || []).some(h => h.status === 'active' && inPrev(h.date))
  );

  // Conversion: new leads → became active (among leads from this period)
  const newLeadIds = new Set(newLeads.map(s => s.id));
  const convertedFromPeriod = becameActive.filter(s => newLeadIds.has(s.id));
  const conversionRate = newLeads.length ? Math.round(convertedFromPeriod.length / newLeads.length * 100) : 0;

  // Marketing expenses in period
  const mktExp = expenses.filter(e => inPeriod(e.date) && (e.channel || e.category === 'Реклама'));
  const totalMktSpend = mktExp.reduce((s, e) => s + (e.amount || 0), 0);
  const prevMktExp = expenses.filter(e => inPrev(e.date) && (e.channel || e.category === 'Реклама'));
  const prevMktSpend = prevMktExp.reduce((s, e) => s + (e.amount || 0), 0);

  // CPA = marketing spend / new active students in period
  const cpa = becameActive.length && totalMktSpend
    ? Math.round(totalMktSpend / becameActive.length)
    : 0;
  const prevCpa = prevBecameActive.length && prevMktSpend
    ? Math.round(prevMktSpend / prevBecameActive.length)
    : 0;

  // Revenue in period
  const revenue = payments.filter(p => inPeriod(p.date)).reduce((s, p) => s + (p.amount || 0), 0);
  const prevRevenue = payments.filter(p => inPrev(p.date)).reduce((s, p) => s + (p.amount || 0), 0);

  // ROMI = (revenue - mkt spend) / mkt spend * 100
  const romi = totalMktSpend ? Math.round((revenue - totalMktSpend) / totalMktSpend * 100) : null;

  // Sources
  const sourceMap = {};
  newLeads.forEach(s => {
    const src = s.source || 'Не указан';
    if (!sourceMap[src]) sourceMap[src] = { leads: 0, active: 0 };
    sourceMap[src].leads++;
    if (becameActive.some(a => a.id === s.id)) sourceMap[src].active++;
  });
  const sources = Object.entries(sourceMap)
    .map(([src, d]) => ({ src, ...d, rate: d.leads ? Math.round(d.active / d.leads * 100) : 0 }))
    .sort((a, b) => b.leads - a.leads);

  // Step-by-step conversions in period (via status_history)
  const reachedTrial = students.filter(s =>
    (s.status_history || []).some(h => h.status === 'trial_scheduled' && inPeriod(h.date))
  );
  const reachedTrialDone = students.filter(s =>
    (s.status_history || []).some(h => h.status === 'trial_done' && inPeriod(h.date))
  );
  // Conv rates: each step relative to previous
  const convLeadToTrial     = newLeads.length     ? Math.round(reachedTrial.length     / newLeads.length * 100)     : 0;
  const convTrialToTrialDone = reachedTrial.length ? Math.round(reachedTrialDone.length / reachedTrial.length * 100) : 0;
  const convTrialDoneToActive = reachedTrialDone.length ? Math.round(becameActive.length / reachedTrialDone.length * 100) : 0;

  // Funnel stages for period — marketer only sees acquisition stages
  const stages = [
    { key: 'lead',            label: 'Лиды',            color: '#64748b' },
    { key: 'trial_scheduled', label: 'Пробник назначен', color: '#7c3aed' },
    { key: 'trial_done',      label: 'Пробник проведён',  color: '#d97706' },
    { key: 'active',          label: 'Стали учениками',  color: '#16a34a' },
    { key: 'stopped',         label: 'Отказались',       color: '#ef4444' },
  ];
  const funnelStudents = students.filter(s => {
    const anyActivity = inPeriod(s.first_contact_at || s.created_at) ||
      (s.status_history || []).some(h => inPeriod(h.date));
    return anyActivity;
  });
  const stageCounts = {};
  stages.forEach(st => {
    stageCounts[st.key] = funnelStudents.filter(s =>
      st.key === 'stopped' ? ['stopped','refused'].includes(s.crm_status) : s.crm_status === st.key
    ).length;
  });
  const funnelTotal = funnelStudents.length || 1;

  // Avg days lead → active
  const convDays = becameActive
    .map(s => {
      const activeEvt = (s.status_history || []).find(h => h.status === 'active');
      const created = s.first_contact_at || s.created_at;
      if (!activeEvt || !created) return null;
      const d = (new Date(activeEvt.date) - new Date(created)) / 86400000;
      return d >= 0 ? d : null;
    })
    .filter(d => d !== null);
  const avgConvDays = convDays.length
    ? Math.round(convDays.reduce((a, b) => a + b, 0) / convDays.length) : null;

  // Stale leads: status=lead, first_contact > 7 days ago
  const d7ago = new Date(); d7ago.setDate(d7ago.getDate() - 7);
  const d7str = d7ago.toISOString().slice(0, 10);
  const staleLeads = students.filter(s =>
    s.crm_status === 'lead' && (s.first_contact_at || s.created_at) <= d7str
  );

  // Active trials
  const activeTrials = students.filter(s =>
    ['trial_scheduled', 'trial_done'].includes(s.crm_status)
  );

  const delta = (cur, prev) => {
    if (!prev) return '';
    const d = cur - prev;
    const pct = Math.round(Math.abs(d) / prev * 100);
    const color = d >= 0 ? 'var(--green)' : 'var(--red)';
    return `<span style="font-size:11px;color:${color};margin-left:6px">${d >= 0 ? '▲' : '▼'} ${pct}%</span>`;
  };

  el.innerHTML = `
    <!-- KPI row -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin-bottom:16px">
      ${_kpi('Новых лидов',           newLeads.length,                                    delta(newLeads.length, prevLeads.length),           'ti-user-plus',   '#2563eb')}
      ${_kpi('Новых учеников',        becameActive.length,                               delta(becameActive.length, prevBecameActive.length),  'ti-users',       '#16a34a')}
      ${_kpi('Общая конверсия',       conversionRate + '%',                              '',                                                   'ti-trending-up', conversionRate >= 30 ? '#16a34a' : conversionRate >= 15 ? '#d97706' : '#ef4444')}
      ${_kpi('Срок конверсии',        avgConvDays !== null ? avgConvDays + ' дн.' : '—', '',                                                   'ti-hourglass',   avgConvDays === null ? '#64748b' : avgConvDays <= 14 ? '#16a34a' : avgConvDays <= 21 ? '#d97706' : '#ef4444')}
      ${_kpi('Зависших лидов',        staleLeads.length,                                 '',                                                   'ti-clock-pause', staleLeads.length === 0 ? '#16a34a' : staleLeads.length <= 3 ? '#d97706' : '#ef4444')}
      ${_kpi('Расходы на рекламу',    totalMktSpend ? fmt(totalMktSpend) + ' ₽' : '—',  delta(totalMktSpend, prevMktSpend),                   'ti-speakerphone','#7c3aed')}
      ${_kpi('Стоимость привлечения', cpa ? fmt(cpa) + ' ₽' : '—',                      delta(cpa, prevCpa),                                  'ti-coin',        '#0891b2')}
      ${_kpi('ROMI',                  romi !== null ? romi + '%' : '—',                  '',                                                   'ti-chart-line',  romi !== null && romi >= 100 ? '#16a34a' : romi !== null && romi >= 0 ? '#d97706' : '#ef4444')}
    </div>

    <!-- Stale leads list -->
    ${staleLeads.length ? `
    <div class="card" style="margin-bottom:16px;padding:14px 16px;border-left:3px solid #d97706">
      <div style="font-size:12px;font-weight:700;color:#ca8a04;margin-bottom:10px;display:flex;align-items:center;gap:6px">
        <i class="ti ti-clock-pause"></i> Лиды без движения более 7 дней (${staleLeads.length})
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${staleLeads.map(s => {
          const created = s.first_contact_at || s.created_at;
          const days = created ? Math.floor((Date.now() - new Date(created)) / 86400000) : null;
          return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer" data-action="openStudentDetail" data-id="${esc(s.id)}">
            <div style="font-weight:600">${esc(s.name)}</div>
            <div style="color:var(--muted);font-size:11px">${esc(s.source || '—')} · ${days !== null ? days + ' дн.' : '—'}</div>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    <!-- Step-by-step conversions -->
    <div class="card" style="margin-bottom:16px;padding:16px 20px">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px">
        <i class="ti ti-arrow-right" style="margin-right:4px"></i>Пошаговые конверсии за период
      </div>
      <div style="display:flex;align-items:center;gap:0;flex-wrap:wrap">
        ${_convStep(newLeads.length,       'Лиды',            '#64748b')}
        ${_convArrow(convLeadToTrial)}
        ${_convStep(reachedTrial.length,   'Пробник назначен', '#7c3aed')}
        ${_convArrow(convTrialToTrialDone)}
        ${_convStep(reachedTrialDone.length,'Пробник проведён', '#d97706')}
        ${_convArrow(convTrialDoneToActive)}
        ${_convStep(becameActive.length,   'Занимаются',      '#16a34a')}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <!-- Funnel -->
      <div class="card" style="margin-bottom:0">
        <div style="font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:6px">
          <i class="ti ti-filter" style="color:var(--accent-mid)"></i> Воронка за период
          <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:auto">${funnelStudents.length} контактов</span>
        </div>
        ${stages.map(st => {
          const count = stageCounts[st.key] || 0;
          const pct = Math.round(count / funnelTotal * 100);
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
              <span style="color:var(--text)">${esc(st.label)}</span>
              <span style="color:var(--muted)">${count} (${pct}%)</span>
            </div>
            <div style="height:6px;background:var(--surface2,var(--surface));border-radius:3px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${st.color};border-radius:3px;transition:width .3s"></div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <!-- Sources -->
      <div class="card" style="margin-bottom:0">
        <div style="font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:6px">
          <i class="ti ti-speakerphone" style="color:var(--accent-mid)"></i> Источники лидов за период
        </div>
        ${sources.length ? `
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:6px 12px;font-size:11px;margin-bottom:6px">
          <div style="color:var(--muted);font-weight:600">Источник</div>
          <div style="color:var(--muted);font-weight:600;text-align:right">Лидов</div>
          <div style="color:var(--muted);font-weight:600;text-align:right">Конв.</div>
        </div>
        ${sources.map(s => `
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:4px 12px;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)">
            <div>${esc(s.src)}</div>
            <div style="text-align:right;color:var(--muted)">${s.leads}</div>
            <div style="text-align:right;font-weight:600;color:${s.rate > 20 ? '#16a34a' : s.rate > 10 ? '#d97706' : 'var(--muted)'}">${s.rate}%</div>
          </div>
        `).join('')}` : '<div style="color:var(--muted);font-size:13px">Нет данных об источниках за период</div>'}
      </div>
    </div>

    <!-- Trial lessons widget -->
    <div class="card" style="margin-bottom:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <i class="ti ti-calendar-check" style="color:#16a34a;font-size:16px"></i>
        <div style="font-size:13px;font-weight:700">Пробные уроки</div>
        <button class="btn btn-p btn-sm" style="margin-left:auto" data-action="navigate" data-pg="lessons_cal">
          <i class="ti ti-calendar-event"></i> Открыть календарь
        </button>
      </div>
      ${(() => {
        const trialLessons = (CACHE.lessons || [])
          .filter(l => l.lesson_type === 'trial')
          .sort((a, b) => (a.date + (a.start_time || '')).localeCompare(b.date + (b.start_time || '')));
        const upcoming = trialLessons.filter(l => l.date >= today());
        const past     = trialLessons.filter(l => l.date < today()).slice(-3).reverse();

        if (!trialLessons.length) return `
          <div style="text-align:center;padding:20px 0;color:var(--muted)">
            <i class="ti ti-calendar-plus" style="font-size:28px;opacity:.4"></i>
            <div style="font-size:13px;margin-top:8px">Пробных уроков пока нет</div>
            <div style="font-size:11px;margin-top:4px">Откройте календарь и нажмите на день</div>
          </div>`;

        const row = l => {
          const leads = l.student_attendance || [];
          const isPast = l.date < today();
          return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="min-width:70px;font-size:11px;font-weight:600;color:${isPast ? 'var(--muted)' : '#16a34a'}">${fmtDate(l.date)}${l.start_time ? ' · ' + l.start_time : ''}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.topic || 'Пробный урок')}</div>
              <div style="font-size:11px;color:var(--muted)">${leads.length ? leads.map(a => esc(a.name)).join(', ') : 'Без лидов'}</div>
            </div>
            <span class="b" style="background:${isPast ? 'var(--surface2)' : '#dcfce7'};color:${isPast ? 'var(--muted)' : '#16a34a'};font-size:10px">${leads.length} лид.</span>
          </div>`;
        };

        return `
          ${upcoming.length ? `
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Предстоящие</div>
            ${upcoming.map(row).join('')}` : ''}
          ${past.length ? `
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:10px;margin-bottom:4px">Прошедшие</div>
            ${past.map(row).join('')}` : ''}
        `;
      })()}
    </div>
  `;
}

function _convStep(count, label, color) {
  return `<div style="text-align:center;padding:10px 16px;background:${color}12;border-radius:10px;min-width:90px;flex:1">
    <div style="font-size:22px;font-weight:800;color:${color}">${count}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.3">${label}</div>
  </div>`;
}

function _convArrow(pct) {
  const color = pct >= 50 ? '#16a34a' : pct >= 25 ? '#d97706' : '#ef4444';
  return `<div style="display:flex;flex-direction:column;align-items:center;padding:0 6px;flex-shrink:0">
    <div style="font-size:13px;font-weight:700;color:${color}">${pct}%</div>
    <div style="font-size:16px;color:var(--muted)">→</div>
  </div>`;
}

function _kpi(label, value, deltaHtml, icon, color) {
  return `<div class="card" style="margin-bottom:0;padding:16px">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:40px;height:40px;border-radius:10px;background:${color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="ti ${icon}" style="font-size:20px;color:${color}"></i>
      </div>
      <div>
        <div style="font-size:20px;font-weight:700;display:flex;align-items:center">${value}${deltaHtml}</div>
        <div style="font-size:11px;color:var(--muted)">${label}</div>
      </div>
    </div>
  </div>`;
}
