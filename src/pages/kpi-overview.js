import { CACHE, ensureLoaded } from '../core/store.js';
import { calcRiskScore } from '../core/risk.js';
import { fmt, esc } from '../utils/helpers.js';

function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }

// ── Curator metrics (per role) ─────────────────────────────────────────────

function calcCuratorKPI(roleId) {
  const myGroups = (CACHE.assistant_groups || [])
    .filter(ag => ag.role_id === roleId)
    .map(ag => ag.group_id);

  if (!myGroups.length) return null;

  const groupSet = new Set(myGroups);
  const students = (CACHE.students || []).filter(s =>
    groupSet.has(s.group_id) && ['active', 'trial'].includes(s.crm_status)
  );
  const allStudents = (CACHE.students || []).filter(s => groupSet.has(s.group_id));
  const leftCount = allStudents.filter(s => s.crm_status === 'left').length;
  const retention = pct(students.length, students.length + leftCount);

  const assignments = (CACHE.homework_assignments || []).filter(a => groupSet.has(a.group_id));
  const assignmentIds = new Set(assignments.map(a => a.id));
  const regularAssignmentIds = new Set(assignments.filter(a => !a.is_advanced).map(a => a.id));
  const briefIds = new Set(assignments.filter(a => a.hw_type === 'brief').map(a => a.id));

  const subs = (CACHE.homework_submissions || []).filter(s => assignmentIds.has(s.assignment_id));
  const regularSubs = subs.filter(s => regularAssignmentIds.has(s.assignment_id));
  const regularDone = regularSubs.filter(s => ['checked', 'submitted'].includes(s.status)).length;
  const completionPct = pct(regularDone, regularSubs.length);

  const unchecked = subs.filter(s => s.status === 'submitted' && !briefIds.has(s.assignment_id)).length;

  // Average check time (hours): checked_at - submitted_at
  const checkedSubs = subs.filter(s => s.status === 'checked' && s.checked_at && s.submitted_at);
  let avgCheckHours = null;
  if (checkedSubs.length) {
    const totalMs = checkedSubs.reduce((acc, s) => {
      return acc + (new Date(s.checked_at) - new Date(s.submitted_at));
    }, 0);
    avgCheckHours = Math.round(totalMs / checkedSubs.length / 3600000);
  }

  // Trial scores
  const trialAssignmentIds = new Set(assignments.filter(a => a.hw_type === 'trial').map(a => a.id));
  const trialSubs = subs.filter(s => trialAssignmentIds.has(s.assignment_id) && s.score !== null)
    .sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));

  let avgTrialScore = null;
  let trialGrowth = null;
  if (trialSubs.length) {
    const latestByStudent = {};
    const prevByStudent = {};
    for (const sub of trialSubs) {
      if (!latestByStudent[sub.student_id]) {
        latestByStudent[sub.student_id] = sub.score;
      } else if (!prevByStudent[sub.student_id]) {
        prevByStudent[sub.student_id] = sub.score;
      }
    }
    const latest = Object.values(latestByStudent);
    avgTrialScore = Math.round(latest.reduce((a, b) => a + b, 0) / latest.length);
    const prev = Object.values(prevByStudent);
    if (prev.length) {
      const prevAvg = Math.round(prev.reduce((a, b) => a + b, 0) / prev.length);
      trialGrowth = prevAvg ? Math.round((avgTrialScore - prevAvg) / prevAvg * 100) : null;
    }
  }

  const riskCount = students.filter(s => calcRiskScore(s).level === 'high').length;

  return {
    groups: myGroups.length,
    students: students.length,
    retention,
    completionPct,
    unchecked,
    avgCheckHours,
    avgTrialScore,
    trialGrowth,
    riskCount,
  };
}

// ── Marketer metrics ────────────────────────────────────────────────────────

function calcMarketerKPI(period = 30) {
  const students = CACHE.students || [];
  const expenses = CACHE.expenses || [];
  const payments = CACHE.payments || [];

  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setDate(now.getDate() - period);
  const ps = periodStart.toISOString().slice(0, 10);

  const prevStart = new Date(periodStart);
  prevStart.setDate(prevStart.getDate() - period);
  const pvs = prevStart.toISOString().slice(0, 10);

  const inPeriod = d => d && d >= ps;
  const inPrev   = d => d && d >= pvs && d < ps;

  const newLeads = students.filter(s => inPeriod(s.first_contact_at || s.created_at));
  const prevLeads = students.filter(s => inPrev(s.first_contact_at || s.created_at));

  const becameActive = students.filter(s =>
    (s.status_history || []).some(h => h.status === 'active' && inPeriod(h.date))
  );
  const prevBecameActive = students.filter(s =>
    (s.status_history || []).some(h => h.status === 'active' && inPrev(h.date))
  );

  const newLeadIds = new Set(newLeads.map(s => s.id));
  const converted = becameActive.filter(s => newLeadIds.has(s.id));
  const conversionRate = pct(converted.length, newLeads.length);

  // Avg days lead → active
  let avgConvDays = null;
  const convDays = becameActive
    .map(s => {
      const activeEvt = (s.status_history || []).find(h => h.status === 'active');
      const created = s.first_contact_at || s.created_at;
      if (!activeEvt || !created) return null;
      return (new Date(activeEvt.date) - new Date(created)) / 86400000;
    })
    .filter(d => d !== null && d >= 0);
  if (convDays.length) {
    avgConvDays = Math.round(convDays.reduce((a, b) => a + b, 0) / convDays.length);
  }

  // Stale leads: status=lead, first_contact > 7 days ago
  const d7ago = new Date(); d7ago.setDate(d7ago.getDate() - 7);
  const d7str = d7ago.toISOString().slice(0, 10);
  const staleLeads = students.filter(s =>
    s.crm_status === 'lead' && (s.first_contact_at || s.created_at) <= d7str
  ).length;

  const mktExp = expenses.filter(e => inPeriod(e.date) && (e.channel || e.category === 'Реклама'));
  const totalMktSpend = mktExp.reduce((s, e) => s + (e.amount || 0), 0);
  const prevMktSpend = expenses.filter(e => inPrev(e.date) && (e.channel || e.category === 'Реклама'))
    .reduce((s, e) => s + (e.amount || 0), 0);

  const cpa = becameActive.length && totalMktSpend
    ? Math.round(totalMktSpend / becameActive.length) : null;

  const revenue = payments.filter(p => inPeriod(p.date)).reduce((s, p) => s + (p.amount || 0), 0);
  const romi = totalMktSpend ? Math.round((revenue - totalMktSpend) / totalMktSpend * 100) : null;

  return {
    newLeads: newLeads.length,
    prevLeads: prevLeads.length,
    becameActive: becameActive.length,
    prevBecameActive: prevBecameActive.length,
    conversionRate,
    avgConvDays,
    staleLeads,
    totalMktSpend,
    cpa,
    romi,
  };
}

// ── Traffic light helpers ───────────────────────────────────────────────────

function light(value, thresholds) {
  // thresholds: { green, yellow } — above green=green, above yellow=yellow, else red
  // or { greenMax, yellowMax } for "lower is better"
  if (thresholds.greenMax !== undefined) {
    if (value <= thresholds.greenMax) return 'green';
    if (value <= thresholds.yellowMax) return 'yellow';
    return 'red';
  }
  if (value >= thresholds.green) return 'green';
  if (value >= thresholds.yellow) return 'yellow';
  return 'red';
}

const LIGHT_COLORS = {
  green:  { bg: '#dcfce7', text: '#16a34a', dot: '#16a34a' },
  yellow: { bg: '#fef9c3', text: '#ca8a04', dot: '#eab308' },
  red:    { bg: '#fee2e2', text: '#dc2626', dot: '#ef4444' },
  gray:   { bg: 'var(--surface2)', text: 'var(--muted)', dot: '#94a3b8' },
};

function lightDot(status) {
  const c = LIGHT_COLORS[status] || LIGHT_COLORS.gray;
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.dot};flex-shrink:0"></span>`;
}

function badge(status, text) {
  const c = LIGHT_COLORS[status] || LIGHT_COLORS.gray;
  return `<span style="background:${c.bg};color:${c.text};border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600;white-space:nowrap">${text}</span>`;
}

function kpiRow(label, value, status, hint) {
  const c = LIGHT_COLORS[status] || LIGHT_COLORS.gray;
  return `<div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
    <div>
      <div style="font-size:12px;color:var(--text)">${label}</div>
      ${hint ? `<div style="font-size:11px;color:var(--muted)">${hint}</div>` : ''}
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      ${lightDot(status)}
      <span style="font-size:13px;font-weight:700;color:${c.text}">${value}</span>
    </div>
  </div>`;
}

// ── Score helpers ───────────────────────────────────────────────────────────

function curatorScore(kpi) {
  let score = 0, max = 0;
  const add = (val, thresh) => { max += 2; score += val >= thresh.green ? 2 : val >= thresh.yellow ? 1 : 0; };
  const addMax = (val, thresh) => { max += 2; score += val <= thresh.greenMax ? 2 : val <= thresh.yellowMax ? 1 : 0; };
  add(kpi.completionPct, { green: 80, yellow: 50 });
  add(kpi.retention, { green: 90, yellow: 70 });
  addMax(kpi.unchecked, { greenMax: 0, yellowMax: 5 });
  addMax(kpi.riskCount, { greenMax: 0, yellowMax: 2 });
  if (kpi.avgCheckHours !== null) addMax(kpi.avgCheckHours, { greenMax: 24, yellowMax: 48 });
  if (kpi.avgTrialScore !== null) add(kpi.avgTrialScore, { green: 70, yellow: 50 });
  const pct = Math.round(score / max * 100);
  return { score, max, pct, status: pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red' };
}

function marketerScore(kpi) {
  let score = 0, max = 0;
  const add = (val, thresh) => { max += 2; score += val >= thresh.green ? 2 : val >= thresh.yellow ? 1 : 0; };
  const addMax = (val, thresh) => { max += 2; score += val <= thresh.greenMax ? 2 : val <= thresh.yellowMax ? 1 : 0; };
  add(kpi.conversionRate, { green: 30, yellow: 15 });
  addMax(kpi.staleLeads, { greenMax: 0, yellowMax: 3 });
  if (kpi.avgConvDays !== null) addMax(kpi.avgConvDays, { greenMax: 14, yellowMax: 21 });
  if (kpi.romi !== null) add(kpi.romi, { green: 100, yellow: 0 });
  if (kpi.cpa !== null) addMax(kpi.cpa, { greenMax: 3000, yellowMax: 6000 });
  const p = Math.round(score / max * 100);
  return { score, max, pct: p, status: p >= 80 ? 'green' : p >= 50 ? 'yellow' : 'red' };
}

// ── Curator card ────────────────────────────────────────────────────────────

function curatorCard(role, kpi) {
  const sc = curatorScore(kpi);
  const c = LIGHT_COLORS[sc.status];

  const compStatus = light(kpi.completionPct, { green: 80, yellow: 50 });
  const retStatus  = light(kpi.retention, { green: 90, yellow: 70 });
  const unchStatus = light(kpi.unchecked, { greenMax: 0, yellowMax: 5 });
  const riskStatus = light(kpi.riskCount, { greenMax: 0, yellowMax: 2 });
  const checkStatus = kpi.avgCheckHours !== null
    ? light(kpi.avgCheckHours, { greenMax: 24, yellowMax: 48 }) : 'gray';
  const trialStatus = kpi.avgTrialScore !== null
    ? light(kpi.avgTrialScore, { green: 70, yellow: 50 }) : 'gray';

  const trialVal = kpi.avgTrialScore !== null
    ? `${kpi.avgTrialScore}/100${kpi.trialGrowth !== null
        ? ` <span style="color:${kpi.trialGrowth >= 0 ? '#16a34a' : '#ef4444'}">${kpi.trialGrowth >= 0 ? '▲' : '▼'}${Math.abs(kpi.trialGrowth)}%</span>` : ''}` : '—';

  return `<div class="card" style="margin-bottom:12px;padding:0;overflow:hidden">
    <div style="padding:12px 16px;background:var(--surface2);display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)">
      <div style="width:36px;height:36px;border-radius:50%;background:${c.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="ti ti-school" style="color:${c.text};font-size:16px"></i>
      </div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:700">${esc(role.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${kpi.groups} групп · ${kpi.students} учеников</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:800;color:${c.text}">${sc.pct}%</div>
        <div style="font-size:10px;color:var(--muted)">эффективность</div>
      </div>
      ${badge(sc.status, sc.status === 'green' ? 'Отлично' : sc.status === 'yellow' ? 'Внимание' : 'Критично')}
    </div>
    <div style="padding:4px 16px 8px">
      ${kpiRow('Выполнение ДЗ', kpi.completionPct + '%', compStatus, 'цель ≥ 80%')}
      ${kpiRow('Retention группы', kpi.retention + '%', retStatus, 'цель ≥ 90%')}
      ${kpiRow('Непроверенных ДЗ', kpi.unchecked, unchStatus, 'цель = 0')}
      ${kpiRow('Время проверки ДЗ', kpi.avgCheckHours !== null ? kpi.avgCheckHours + ' ч' : '—', checkStatus, 'цель ≤ 24 ч')}
      ${kpiRow('Ученики под риском', kpi.riskCount, riskStatus, 'цель = 0')}
      ${kpiRow('Средний балл пробников', trialVal, trialStatus, 'цель ≥ 70')}
    </div>
  </div>`;
}

// ── Marketer card ───────────────────────────────────────────────────────────

function marketerCard(role, kpi) {
  const sc = marketerScore(kpi);
  const c = LIGHT_COLORS[sc.status];

  const convStatus  = light(kpi.conversionRate, { green: 30, yellow: 15 });
  const staleStatus = light(kpi.staleLeads, { greenMax: 0, yellowMax: 3 });
  const daysStatus  = kpi.avgConvDays !== null
    ? light(kpi.avgConvDays, { greenMax: 14, yellowMax: 21 }) : 'gray';
  const romiStatus  = kpi.romi !== null
    ? light(kpi.romi, { green: 100, yellow: 0 }) : 'gray';
  const cpaStatus   = kpi.cpa !== null
    ? light(kpi.cpa, { greenMax: 3000, yellowMax: 6000 }) : 'gray';

  const leadDelta = kpi.prevLeads
    ? `<span style="font-size:11px;color:${kpi.newLeads >= kpi.prevLeads ? '#16a34a' : '#ef4444'};margin-left:4px">${kpi.newLeads >= kpi.prevLeads ? '▲' : '▼'}${Math.abs(kpi.newLeads - kpi.prevLeads)}</span>`
    : '';

  return `<div class="card" style="margin-bottom:12px;padding:0;overflow:hidden">
    <div style="padding:12px 16px;background:var(--surface2);display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)">
      <div style="width:36px;height:36px;border-radius:50%;background:${c.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="ti ti-speakerphone" style="color:${c.text};font-size:16px"></i>
      </div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:700">${esc(role.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${kpi.newLeads} лидов за 30 дн.${leadDelta}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:800;color:${c.text}">${sc.pct}%</div>
        <div style="font-size:10px;color:var(--muted)">эффективность</div>
      </div>
      ${badge(sc.status, sc.status === 'green' ? 'Отлично' : sc.status === 'yellow' ? 'Внимание' : 'Критично')}
    </div>
    <div style="padding:4px 16px 8px">
      ${kpiRow('Конверсия лид → ученик', kpi.conversionRate + '%', convStatus, 'цель ≥ 30%')}
      ${kpiRow('Зависших лидов (>7 дн.)', kpi.staleLeads, staleStatus, 'цель = 0')}
      ${kpiRow('Средний срок конверсии', kpi.avgConvDays !== null ? kpi.avgConvDays + ' дн.' : '—', daysStatus, 'цель ≤ 14 дн.')}
      ${kpiRow('Расходы на рекламу', kpi.totalMktSpend ? fmt(kpi.totalMktSpend) + ' ₽' : '—', 'gray', '30 дней')}
      ${kpiRow('CPA (стоимость привлечения)', kpi.cpa ? fmt(kpi.cpa) + ' ₽' : '—', cpaStatus, 'цель ≤ 3 000 ₽')}
      ${kpiRow('ROMI', kpi.romi !== null ? kpi.romi + '%' : '—', romiStatus, 'цель ≥ 100%')}
    </div>
  </div>`;
}

// ── Summary bar ─────────────────────────────────────────────────────────────

function summaryBar(curators, marketers) {
  const allScores = [
    ...curators.map(({ kpi }) => curatorScore(kpi)),
    ...marketers.map(({ kpi }) => marketerScore(kpi)),
  ];
  const green  = allScores.filter(s => s.status === 'green').length;
  const yellow = allScores.filter(s => s.status === 'yellow').length;
  const red    = allScores.filter(s => s.status === 'red').length;

  return `<div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
    <div style="background:#dcfce7;border-radius:10px;padding:12px 20px;display:flex;align-items:center;gap:8px;flex:1;min-width:100px">
      <i class="ti ti-circle-check" style="color:#16a34a;font-size:20px"></i>
      <div><div style="font-size:20px;font-weight:800;color:#16a34a">${green}</div><div style="font-size:11px;color:#16a34a">отлично</div></div>
    </div>
    <div style="background:#fef9c3;border-radius:10px;padding:12px 20px;display:flex;align-items:center;gap:8px;flex:1;min-width:100px">
      <i class="ti ti-alert-circle" style="color:#ca8a04;font-size:20px"></i>
      <div><div style="font-size:20px;font-weight:800;color:#ca8a04">${yellow}</div><div style="font-size:11px;color:#ca8a04">внимание</div></div>
    </div>
    <div style="background:#fee2e2;border-radius:10px;padding:12px 20px;display:flex;align-items:center;gap:8px;flex:1;min-width:100px">
      <i class="ti ti-alert-triangle" style="color:#dc2626;font-size:20px"></i>
      <div><div style="font-size:20px;font-weight:800;color:#dc2626">${red}</div><div style="font-size:11px;color:#dc2626">критично</div></div>
    </div>
  </div>`;
}

// ── Main render ─────────────────────────────────────────────────────────────

export async function renderKpiOverviewPage() {
  await ensureLoaded([
    'roles', 'groups', 'students', 'lessons', 'payments', 'expenses',
    'homework_assignments', 'homework_submissions', 'assistant_groups',
  ]);

  const el = document.getElementById('pg-kpi_overview');
  if (!el) return;

  const roles = CACHE.roles || [];
  const curatorRoles = roles.filter(r => r.role_type === 'curator');
  const marketerRoles = roles.filter(r => r.role_type === 'marketer');

  const curators = curatorRoles
    .map(r => ({ role: r, kpi: calcCuratorKPI(r.id) }))
    .filter(x => x.kpi !== null);

  const marketers = marketerRoles.map(r => ({ role: r, kpi: calcMarketerKPI(30) }));
  const mktKpi = calcMarketerKPI(30);

  const hasCurators  = curators.length > 0;
  const hasMarketers = marketerRoles.length > 0;

  const allEntities = [
    ...curators,
    ...(hasMarketers ? [{ role: marketerRoles[0], kpi: mktKpi }] : []),
  ];

  el.innerHTML = `
    <div style="padding:20px;max-width:900px;margin:0 auto">
      <div style="font-size:20px;font-weight:700;margin-bottom:4px">KPI команды</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:20px">Сводный обзор эффективности кураторов и маркетологов</div>

      ${allEntities.length ? summaryBar(curators, hasMarketers ? [{ kpi: mktKpi }] : []) : ''}

      ${hasCurators ? `
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:6px">
          <i class="ti ti-school"></i> Кураторы
        </div>
        ${curators.map(({ role, kpi }) => curatorCard(role, kpi)).join('')}
      ` : `<div class="card" style="color:var(--muted);font-size:13px;padding:20px">Нет назначенных кураторов</div>`}

      ${hasMarketers ? `
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:20px 0 10px;display:flex;align-items:center;gap:6px">
          <i class="ti ti-speakerphone"></i> Маркетологи
        </div>
        ${marketerRoles.map(r => marketerCard(r, mktKpi)).join('')}
      ` : ''}

      ${!hasCurators && !hasMarketers ? `
        <div class="card" style="padding:40px;text-align:center">
          <i class="ti ti-users-group" style="font-size:40px;color:var(--muted)"></i>
          <div style="font-size:15px;font-weight:600;margin-top:12px">Нет ролей для отображения</div>
          <div style="font-size:13px;color:var(--muted);margin-top:4px">Создайте кураторов и маркетологов в разделе «Доступы»</div>
        </div>
      ` : ''}
    </div>
  `;
}
