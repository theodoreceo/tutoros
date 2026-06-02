import { CACHE, ensureLoaded } from '../core/store.js';
import { state } from '../core/state.js';
import { fmt, fmtDate, esc } from '../utils/helpers.js';

let _period = 30; // days

export function setMktPeriod(days) {
  _period = days;
  document.querySelectorAll('.mkt-period-btn').forEach(b =>
    b.classList.toggle('on', +b.dataset.days === days)
  );
  _render();
}

export async function renderMarketerDashPage() {
  await ensureLoaded(['students', 'payments', 'expenses']);
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

  // Funnel stages for period
  const stages = [
    { key: 'lead',            label: 'Лиды',            color: '#64748b' },
    { key: 'trial_scheduled', label: 'Пробник назначен', color: '#7c3aed' },
    { key: 'trial_done',      label: 'Пробник проведён',  color: '#d97706' },
    { key: 'active',          label: 'Стали учениками',  color: '#16a34a' },
    { key: 'stopped',         label: 'Отказались',       color: '#ef4444' },
    { key: 'left',            label: 'Ушли',             color: '#dc2626' },
  ];
  const funnelStudents = students.filter(s => {
    const anyActivity = inPeriod(s.first_contact_at || s.created_at) ||
      (s.status_history || []).some(h => inPeriod(h.date));
    return anyActivity;
  });
  const stageCounts = {};
  stages.forEach(st => {
    stageCounts[st.key] = funnelStudents.filter(s => s.crm_status === st.key).length;
  });
  const funnelTotal = funnelStudents.length || 1;

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
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">
      ${_kpi('Новых лидов',        newLeads.length,                                         delta(newLeads.length, prevLeads.length),        'ti-user-plus',   '#2563eb')}
      ${_kpi('Новых учеников',     becameActive.length,                                     delta(becameActive.length, prevBecameActive.length), 'ti-users',   '#16a34a')}
      ${_kpi('Конверсия',          conversionRate + '%',                                    '',                                              'ti-trending-up', conversionRate > 20 ? '#16a34a' : '#d97706')}
      ${_kpi('Расходы на рекламу', totalMktSpend ? fmt(totalMktSpend) + ' ₽' : '—',        delta(totalMktSpend, prevMktSpend),              'ti-speakerphone','#7c3aed')}
      ${_kpi('Стоимость привлечения', cpa ? fmt(cpa) + ' ₽' : '—',                         delta(cpa, prevCpa) ,                             'ti-coin',        '#0891b2')}
      ${_kpi('ROMI',               romi !== null ? romi + '%' : '—',                        '',                                              'ti-chart-line',  romi >= 0 ? '#16a34a' : '#ef4444')}
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

    <!-- Active trials -->
    <div class="card">
      <div style="font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:6px">
        <i class="ti ti-calendar-stats" style="color:var(--accent-mid)"></i>
        Активные пробники (${activeTrials.length})
      </div>
      ${activeTrials.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
        ${activeTrials.map(s => `
          <div style="background:var(--surface2,var(--surface));border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:12px">
            <div style="font-weight:600">${esc(s.name)}</div>
            <div style="color:var(--muted);font-size:11px">${esc(s.source || '—')}</div>
            <span class="b b-bl" style="font-size:10px;margin-top:4px;display:inline-block">${s.crm_status === 'trial_scheduled' ? 'Пробник назначен' : 'Пробник проведён'}</span>
          </div>
        `).join('')}
      </div>` : '<div style="color:var(--muted);font-size:13px">Нет активных пробников</div>'}
    </div>
  `;
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
