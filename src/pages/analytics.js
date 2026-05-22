import { CACHE } from '../core/store.js';
import { fmt, fmtDate, thisMonth, lastMonth } from '../utils/helpers.js';
import { calculateForecast } from '../core/forecast.js';

let _anTab = 'overview';
let _anMonths = 1;

export function setAnTab(tab) {
  _anTab = tab;
  document.querySelectorAll('#an-tab-toggle button').forEach((b, i) => b.classList.toggle('on', ['overview', 'channels', 'detail'][i] === tab));
  ['overview', 'channels', 'detail'].forEach(t => {
    const el = document.getElementById('an-tab-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  renderAnalytics();
}

export function setAnPeriod(months) {
  _anMonths = months;
  document.querySelectorAll('.an-period-bar button').forEach((b, i) => {
    b.classList.toggle('on', [1, 3, 6, 12, 0][i] === months);
  });
  renderAnalytics();
}

function anPeriodStart() {
  if (_anMonths === 0) return new Date('2000-01-01');
  const d = new Date();
  d.setMonth(d.getMonth() - _anMonths);
  return d;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function renderAnalytics() {
  const periodStart = anPeriodStart();
  const students = CACHE.students || [];
  const payments = CACHE.payments || [];
  const expenses = CACHE.expenses || [];

  const periodPayments = payments.filter(p => new Date(p.date) >= periodStart);
  const periodExpenses = expenses.filter(e => new Date(e.date) >= periodStart);

  function becameStatusInPeriod(s, status) {
    const h = s.status_history || [];
    if (h.length) return h.some(e => e.status === status && new Date(e.date) >= periodStart);
    return new Date(s.created_at || '2000-01-01') >= periodStart;
  }

  const newActiveInPeriod = students.filter(s => becameStatusInPeriod(s, 'active'));
  const adSpend = periodExpenses.filter(e => e.category === 'Реклама').reduce((s, e) => s + e.amount, 0);
  const cac = newActiveInPeriod.length > 0
    ? (adSpend > 0 ? Math.round(adSpend / newActiveInPeriod.length) : 0)
    : null;

  function studentActualLTV(s) {
    return payments.filter(p => p.student_id === s.id).reduce((sum, p) => sum + p.amount, 0);
  }
  function studentLifetimeMonths(s) {
    const h = s.status_history || [];
    const startEntry = h.find(e => e.status === 'active');
    const startDate = startEntry ? new Date(startEntry.date) : new Date(s.created_at || Date.now());
    const end = s.left_at ? new Date(s.left_at) : new Date();
    return Math.max(1, Math.round((end - startDate) / 2592000000));
  }

  const studentsWithPayments = students.filter(s => studentActualLTV(s) > 0);
  const ltvSamples = studentsWithPayments.map(s => studentActualLTV(s));
  const ltv = ltvSamples.length ? Math.round(ltvSamples.reduce((a, b) => a + b, 0) / ltvSamples.length) : null;

  const finishedStudents = students.filter(s => ['stopped', 'refused', 'exam_passed'].includes(s.crm_status));
  const lifetimeSamples = finishedStudents.map(studentLifetimeMonths);
  const avgLifetime = lifetimeSamples.length ? Math.round(lifetimeSamples.reduce((a, b) => a + b, 0) / lifetimeSamples.length) : null;

  const activeNow = students.filter(s => s.crm_status === 'active');
  const studentsWithRate = activeNow.filter(s => s.price_per_hour && s.lessons_per_month);
  const arpu = studentsWithRate.length
    ? Math.round(studentsWithRate.reduce((s, st) => s + (st.price_per_hour * st.lessons_per_month), 0) / studentsWithRate.length)
    : null;

  const totalRevenuePeriod = periodPayments.reduce((s, p) => s + p.amount, 0);
  const periodMonths = _anMonths || 12;
  const totalLessonHours = activeNow.reduce((s, st) => s + (st.lessons_per_month || 0) * periodMonths, 0);
  const hourlyRate = (totalRevenuePeriod > 0 && totalLessonHours > 0)
    ? Math.round(totalRevenuePeriod / totalLessonHours)
    : (arpu && activeNow.length
      ? Math.round((arpu * activeNow.length) / activeNow.reduce((s, st) => s + (st.lessons_per_month || 0), 0))
      : null);

  const avgCheck = periodPayments.length ? Math.round(periodPayments.reduce((s, p) => s + p.amount, 0) / periodPayments.length) : null;

  const churned = students.filter(s => ['stopped', 'refused'].includes(s.crm_status) && s.left_at && new Date(s.left_at) >= periodStart);
  const churnBase = activeNow.length + churned.length;
  const churnRate = churnBase ? Math.round(churned.length / churnBase * 100) : 0;

  const allMonthsWithPayments = [...new Set(payments.map(p => p.date?.slice(0, 7)).filter(Boolean))].sort();
  const lastMonthWithData = allMonthsWithPayments[allMonthsWithPayments.length - 1] || new Date().toISOString().slice(0, 7);
  const prevMonthWithData = allMonthsWithPayments[allMonthsWithPayments.length - 2] || null;
  const mrrDisplay = payments.filter(p => p.date?.startsWith(lastMonthWithData)).reduce((s, p) => s + p.amount, 0);
  const mrrPrevDisplay = prevMonthWithData ? payments.filter(p => p.date?.startsWith(prevMonthWithData)).reduce((s, p) => s + p.amount, 0) : 0;
  const mrrGrowth = mrrPrevDisplay ? Math.round((mrrDisplay - mrrPrevDisplay) / mrrPrevDisplay * 100) : null;

  const totalExpPeriod = periodExpenses.reduce((s, e) => s + e.amount, 0);
  const grossMargin = totalRevenuePeriod > 0 ? Math.round((totalRevenuePeriod - totalExpPeriod) / totalRevenuePeriod * 100) : null;

  const ltvCac = (ltv && cac) ? +(ltv / cac).toFixed(1) : null;
  const payback = (cac && arpu && arpu > 0) ? +(cac / arpu).toFixed(1) : null;

  // Funnel
  const allLeads = students.filter(s => becameStatusInPeriod(s, 'lead'));
  const toTrialSched = students.filter(s => becameStatusInPeriod(s, 'trial_scheduled'));
  const toTrialDone = students.filter(s => becameStatusInPeriod(s, 'trial_done') || becameStatusInPeriod(s, 'trial'));
  const toActive = students.filter(s => becameStatusInPeriod(s, 'active'));
  const toTrial = [...new Set([...toTrialSched, ...toTrialDone])];
  const convLeadTrial = allLeads.length ? Math.round(toTrial.length / allLeads.length * 100) : 0;
  const convTrialActive = toTrial.length ? Math.round(toActive.length / toTrial.length * 100) : 0;
  const convLeadActive = allLeads.length ? Math.round(toActive.length / allLeads.length * 100) : 0;

  // Overview metrics
  const activeNowCount = activeNow.length;
  const totalAll = students.length;
  const projectedMRR = activeNow.reduce((sum, s) => sum + (s.price_per_hour || 0) * (s.lessons_per_month || 0), 0);
  const unpaidNow = students.filter(s => s.crm_status === 'active' && !s.paid).length;
  const mrrThisM = payments.filter(p => p.date?.startsWith(thisMonth())).reduce((s, p) => s + p.amount, 0);
  const expThisM = expenses.filter(e => e.date?.startsWith(thisMonth())).reduce((s, e) => s + e.amount, 0);

  const anOverview = document.getElementById('an-overview-metrics');
  if (anOverview) anOverview.innerHTML = `
    <div class="met"><div class="met-label">Активных учеников</div><div class="met-val">${activeNowCount}</div><div class="met-sub">всего ${totalAll} · ${(CACHE.groups || []).length} групп</div></div>
    <div class="met"><div class="met-label">Доход этот месяц</div><div class="met-val">${fmt(mrrThisM)} ₽</div><div class="met-sub">расходы ${fmt(expThisM)} ₽</div></div>
    <div class="met"><div class="met-label">Прибыль этот месяц</div><div class="met-val" style="color:var(--green)">${fmt(mrrThisM - expThisM)} ₽</div></div>
    <div class="met"><div class="met-label">Планируемый MRR</div><div class="met-val">${fmt(projectedMRR)} ₽</div><div class="met-sub">по тарифам учеников</div></div>
    <div class="met"><div class="met-label">Не оплатили</div><div class="met-val" style="color:${unpaidNow > 0 ? 'var(--red)' : 'inherit'}">${unpaidNow}</div><div class="met-sub">активных</div></div>
    <div class="met"><div class="met-label">Лиды / Пробные</div><div class="met-val">${students.filter(s => s.crm_status === 'lead').length} / ${students.filter(s => s.crm_status === 'trial').length}</div><div class="met-sub">в воронке</div></div>`;

  function ltvCacColor(v) { if (!v) return ''; if (v >= 3) return 'good'; if (v >= 1.5) return 'warn'; return 'bad'; }
  function churnColor(v) { if (v <= 5) return 'good'; if (v <= 15) return 'warn'; return 'bad'; }
  function marginColor(v) { if (v === null) return ''; if (v >= 50) return 'good'; if (v >= 20) return 'warn'; return 'bad'; }

  const kpis = [
    { label: 'CAC',         val: cac !== null ? (cac > 0 ? fmt(cac) + ' ₽' : '0 ₽') : '—', sub: cac !== null ? (cac === 0 ? `${newActiveInPeriod.length} уч., нет рекл. расходов` : `${newActiveInPeriod.length} новых уч.`) : 'нет новых учеников', hint: 'рекл. расходы / новых учеников', cls: '' },
    { label: 'LTV',         val: ltv ? fmt(ltv) + ' ₽' : '—', sub: `ср. по ${ltvSamples.length} уч. с оплатами`, hint: 'среднее факт. платежей на ученика', cls: '' },
    { label: 'LTV / CAC',   val: ltvCac ? '×' + ltvCac : '—', sub: ltvCac ? (ltvCac >= 3 ? 'Отлично ✓' : ltvCac >= 1.5 ? 'Норма' : 'Опасно ⚠') : 'нужны CAC и LTV', hint: 'норма: >3', cls: ltvCacColor(ltvCac) },
    { label: 'Payback',     val: payback ? payback + ' мес' : '—', sub: 'окупаемость привлечения', hint: 'CAC / ARPU', cls: '' },
    { label: 'ARPU',        val: arpu ? fmt(arpu) + ' ₽/мес' : '—', sub: `ср. по ${studentsWithRate.length} уч.`, hint: 'ср. (цена × занятий) по активным', cls: '' },
    { label: 'Ст-ть часа',  val: hourlyRate ? fmt(hourlyRate) + ' ₽' : '—', sub: 'твой час', hint: 'выручка / кол-во занятий', cls: '' },
    { label: 'Средний чек', val: avgCheck ? fmt(avgCheck) + ' ₽' : '—', sub: `${periodPayments.length} платежей`, hint: '', cls: '' },
    { label: 'MRR',         val: fmt(mrrDisplay) + ' ₽', sub: mrrGrowth !== null ? (mrrGrowth >= 0 ? '↑ +' + mrrGrowth + '%' : '↓ ' + mrrGrowth + '%') : '', hint: 'последний месяц с данными', cls: mrrGrowth > 0 ? 'good' : mrrGrowth < -10 ? 'warn' : '' },
    { label: 'Gross Margin', val: grossMargin !== null ? grossMargin + '%' : '—', sub: '(доход − расходы) / доход', hint: 'норма: >50%', cls: marginColor(grossMargin) },
    { label: 'Churn rate',  val: churnRate + '%', sub: churned.length + ' ушли за период', hint: 'норма: <5%', cls: churnColor(churnRate) },
    { label: 'Retention',   val: (100 - churnRate) + '%', sub: 'остаются', hint: '1 − churn rate', cls: (100 - churnRate) >= 90 ? 'good' : (100 - churnRate) >= 80 ? '' : 'bad' },
  ];

  const kmEl = document.getElementById('an-key-metrics');
  if (kmEl) kmEl.innerHTML = kpis.map(k => `
    <div class="an-met ${k.cls}">
      <div class="an-label">${k.label}</div>
      <div class="an-val">${k.val}</div>
      ${k.sub ? `<div class="an-sub">${k.sub}</div>` : ''}
      ${k.hint ? `<div class="an-hint">${k.hint}</div>` : ''}
    </div>`).join('');

  // Funnel
  const funnelSteps = [
    { label: 'Лиды',             n: allLeads.length,    color: 'var(--accent-mid)', conv: '' },
    { label: 'Пробник назначен', n: toTrialSched.length, color: '#7c3aed',           conv: `${convLeadTrial}% из лидов` },
    { label: 'Пробник проведён', n: toTrialDone.length,  color: 'var(--amber)',      conv: '' },
    { label: 'Активные',         n: toActive.length,     color: '#22c55e',           conv: `${convTrialActive}% из пробных` },
  ];
  const maxN = Math.max(...funnelSteps.map(s => s.n), 1);
  const funnelEl = document.getElementById('an-funnel');
  if (funnelEl) funnelEl.innerHTML = funnelSteps.map(s => `
    <div class="funnel-row">
      <div style="width:140px;font-size:13px;font-weight:600">${s.label}</div>
      <div class="funnel-bar"><div class="funnel-fill" style="width:${s.n / maxN * 100}%;background:${s.color}"></div></div>
      <div style="width:40px;text-align:right;font-size:13px;font-weight:700">${s.n}</div>
      <div style="width:200px;font-size:11px;color:var(--muted);padding-left:12px">${s.conv || '— входная точка'}</div>
    </div>`).join('') + `<div style="padding-top:10px;font-size:11px;color:var(--muted)">Сквозная конверсия лид → ученик: <b>${convLeadActive}%</b></div>`;

  // MRR bars
  const mMonths = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); mMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const mTotals = mMonths.map(m => payments.filter(p => p.date?.startsWith(m)).reduce((s, p) => s + p.amount, 0));
  const maxMRR = Math.max(...mTotals, 1);
  const mLbls = mMonths.map(m => ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][+m.split('-')[1] - 1]);
  const mrrBarsEl = document.getElementById('an-mrr-bars');
  if (mrrBarsEl) mrrBarsEl.innerHTML = mMonths.map((m, i) => `
    <div class="mrr-bar-w" title="${mLbls[i]}: ${fmt(mTotals[i])} ₽">
      <div class="mrr-bar-v">${mTotals[i] ? fmt(Math.round(mTotals[i] / 1000)) + 'к' : ''}</div>
      <div class="mrr-bar-b ${m === lastMonthWithData ? 'cur' : ''}" style="height:${Math.max(3, mTotals[i] / maxMRR * 78)}px"></div>
      <div class="mrr-bar-l">${mLbls[i]}</div>
    </div>`).join('');

  const mrrGrowthMonths = mMonths.slice(1).map((m, i) => {
    const prev = mTotals[i]; const cur = mTotals[i + 1];
    return prev ? Math.round((cur - prev) / prev * 100) : null;
  }).filter(v => v !== null);
  const avgGrowth = mrrGrowthMonths.length ? Math.round(mrrGrowthMonths.reduce((a, b) => a + b, 0) / mrrGrowthMonths.length) : null;
  const mrrStatsEl = document.getElementById('an-mrr-stats');
  if (mrrStatsEl) mrrStatsEl.innerHTML = `Ср. рост MRR / мес: <b>${avgGrowth !== null ? (avgGrowth >= 0 ? '+' : '') + avgGrowth + '%' : '—'}</b> &nbsp;·&nbsp; Пик: <b>${fmt(Math.max(...mTotals))} ₽</b>`;

  // Revenue forecast
  const forecastEl = document.getElementById('an-forecast');
  if (forecastEl) {
    const { months: fc, retentionRate, usingDefault } = calculateForecast(3);
    forecastEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:${usingDefault ? '10px' : '0'}">
        ${fc.map((m, i) => {
          const pct = m.total ? Math.round(m.guaranteed / m.total * 100) : 0;
          return `<div class="card" style="padding:14px 16px;margin-bottom:0">
            <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
              ${m.label}${i === 0 ? ' <span style="color:var(--accent-mid)">· текущий</span>' : ''}
            </div>
            <div style="font-size:22px;font-weight:800;color:var(--text);margin-bottom:10px">${fmt(m.total)} ₽</div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:3px;display:flex;align-items:center;gap:5px">
              <span style="width:9px;height:9px;border-radius:2px;background:var(--green);flex-shrink:0;display:inline-block"></span>
              Гарантированная: <b style="color:var(--text)">${fmt(m.guaranteed)} ₽</b>
              <span style="color:var(--hint)">${m.guaranteedCount} уч.</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:5px">
              <span style="width:9px;height:9px;border-radius:2px;background:var(--accent-mid);flex-shrink:0;display:inline-block;opacity:.7"></span>
              Вероятная: <b style="color:var(--text)">${fmt(m.probable)} ₽</b>
              <span style="color:var(--hint)">${m.probableCount} уч.</span>
            </div>
            <div style="height:6px;border-radius:3px;overflow:hidden;background:var(--surface2);display:flex">
              <div style="flex:${m.guaranteed || 0};background:var(--green);min-width:${m.guaranteed ? 2 : 0}px"></div>
              <div style="flex:${m.probable || 0};background:var(--accent-mid);opacity:.7;min-width:${m.probable ? 2 : 0}px"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
      ${usingDefault ? `<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.18);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--amber);display:flex;align-items:center;gap:7px">
        <i class="ti ti-info-circle" style="font-size:13px;flex-shrink:0"></i>
        Retention рассчитан по умолчанию (75%) — данных пока недостаточно (нужно минимум 30 платежей в истории)
      </div>` : `<div style="font-size:11px;color:var(--hint);text-align:right">Retention: ${Math.round(retentionRate * 100)}% (из реальных данных)</div>`}`;
  }

  // Key 3
  const k3 = document.getElementById('an-key3');
  if (k3) k3.innerHTML = `
    <div class="pulse-card">
      <div class="p-stripe" style="background:var(--accent-mid)"></div>
      <div class="p-label">MRR</div>
      <div class="p-val">${fmt(mrrDisplay)} ₽</div>
      ${mrrGrowth !== null ? `<div class="p-delta ${mrrGrowth >= 0 ? 'up' : 'down'}">${mrrGrowth >= 0 ? '+' : ''}${mrrGrowth}% к пред.</div>` : '<div class="p-delta flat">нет данных</div>'}
    </div>
    <div class="pulse-card">
      <div class="p-stripe" style="background:${ltv && cac && ltv / cac >= 3 ? '#22c55e' : ltv && cac && ltv / cac >= 1.5 ? '#f59e0b' : '#ef4444'}"></div>
      <div class="p-label">LTV / CAC</div>
      <div class="p-val">${ltvCac ? '×' + ltvCac : '—'}</div>
      <div class="p-delta flat">${ltvCac ? (ltvCac >= 3 ? 'Отлично ✓' : ltvCac >= 1.5 ? 'Норма' : 'Опасно ⚠') : 'нет данных'}</div>
    </div>
    <div class="pulse-card">
      <div class="p-stripe" style="background:${churnRate <= 5 ? '#22c55e' : churnRate <= 15 ? '#f59e0b' : '#ef4444'}"></div>
      <div class="p-label">Churn rate</div>
      <div class="p-val" style="color:${churnRate <= 5 ? 'var(--green)' : churnRate <= 15 ? 'var(--amber)' : 'var(--red)'}">${churnRate}%</div>
      <div class="p-delta flat">${churned.length} ушли · норма &lt;5%</div>
    </div>`;

  // Retention cohort
  const retEl = document.getElementById('an-retention');
  if (retEl) {
    const cohorts = {};
    students.filter(s => s.status_history?.length).forEach(s => {
      const activeEntry = s.status_history.find(e => e.status === 'active');
      if (!activeEntry) return;
      const m = activeEntry.date.slice(0, 7);
      if (!cohorts[m]) cohorts[m] = { joined: 0, still: 0 };
      cohorts[m].joined++;
      if (s.crm_status === 'active' || s.crm_status === 'exam_passed') cohorts[m].still++;
    });
    const cohortArr = Object.entries(cohorts).sort().slice(-8);
    if (!cohortArr.length) {
      retEl.innerHTML = '<div class="empty">Нет данных по когортам</div>';
    } else {
      retEl.innerHTML = `<div class="retention-grid">${cohortArr.map(([m, v]) => {
        const pct = Math.round(v.still / v.joined * 100);
        const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#2563eb' : pct >= 40 ? '#f59e0b' : '#ef4444';
        const mon = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][+m.split('-')[1] - 1];
        return `<div class="ret-row">
          <div class="ret-label">${mon} ${m.split('-')[0]} · ${v.joined} уч.</div>
          <div class="ret-bar-wrap"><div class="ret-bar-fill" style="width:${pct}%;background:${color}">${pct > 20 ? pct + '%' : ''}</div></div>
          <div class="ret-pct" style="color:${color}">${pct}%</div>
        </div>`;
      }).join('')}</div>`;
    }
  }

  // Health score
  const allLessons = CACHE.lessons || [];
  const totalAttendSlots = allLessons.reduce((s, l) => {
    const gr = (CACHE.groups || []).find(g => g.id === l.group_id);
    return s + (gr ? (CACHE.students || []).filter(st => st.group_id === gr.id && st.crm_status === 'active').length : 0);
  }, 0);
  const totalAbsents = allLessons.reduce((s, l) => s + (l.student_attendance || []).filter(a => !a.present).length, 0);
  const attendancePct = totalAttendSlots > 0 ? Math.round((1 - totalAbsents / totalAttendSlots) * 100) : 100;
  const churnScore = Math.max(0, 100 - churnRate * 3);
  const finScore = mrrGrowth !== null ? Math.min(100, 50 + mrrGrowth) : 50;
  const healthScore = Math.round((attendancePct * 0.35) + (churnScore * 0.4) + (finScore * 0.25));
  const healthLabel = healthScore >= 80 ? 'Отлично' : healthScore >= 60 ? 'Хорошо' : healthScore >= 40 ? 'Требует внимания' : 'Критично';
  const healthColor = healthScore >= 80 ? '#22c55e' : healthScore >= 60 ? '#05337D' : healthScore >= 40 ? '#f59e0b' : '#ef4444';
  const healthBg = healthScore >= 80 ? '#f0fdf4' : healthScore >= 60 ? '#dde6f5' : healthScore >= 40 ? '#fffbeb' : '#fef2f2';
  const hb = document.getElementById('an-health-block');
  if (hb) hb.innerHTML = `<div class="health-block" style="border-color:${healthColor}30;background:${healthBg}">
    <div class="health-score-circle" style="background:${healthColor};color:#fff">
      <div class="hs-num">${healthScore}</div>
      <div class="hs-label">Балл</div>
    </div>
    <div style="flex:1">
      <div style="font-size:16px;font-weight:700;color:${healthColor};margin-bottom:10px">${healthLabel}</div>
      <div class="health-breakdown">
        ${[
    { label: 'Посещаемость', val: attendancePct, color: '#2563eb' },
    { label: 'Удержание', val: 100 - churnRate, color: '#16a34a' },
    { label: 'Рост выручки', val: Math.max(0, finScore), color: '#d97706' },
  ].map(c => `<div class="hb-item">
          <div class="hb-label">${c.label}</div>
          <div class="hb-bar"><div class="hb-fill" style="width:${c.val}%;background:${c.color}"></div></div>
          <div class="hb-val" style="color:${c.color}">${c.val}%</div>
        </div>`).join('')}
      </div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Активных</div>
      <div style="font-size:24px;font-weight:800">${activeNow.length}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">из ${students.length} всего</div>
    </div>
  </div>`;

  // Time in statuses
  const transitions = [
    { from: 'lead',    to: 'trial',       label: 'Лид → Пробное' },
    { from: 'trial',   to: 'active',      label: 'Пробное → Занимается' },
    { from: 'active',  to: 'stopped',     label: 'Занимается → Ушёл' },
    { from: 'active',  to: 'exam_passed', label: 'Занимается → Сдал' },
  ];
  const timeStats = transitions.map(tr => {
    const days = students.map(s => {
      const h = s.status_history || [];
      const from = h.find(e => e.status === tr.from);
      const to = h.find(e => e.status === tr.to);
      if (!from || !to) return null;
      return daysBetween(from.date, to.date);
    }).filter(v => v !== null && v >= 0);
    return { ...tr, days, med: median(days), n: days.length };
  });
  const tsEl = document.getElementById('an-time-in-status');
  if (tsEl) tsEl.innerHTML = timeStats.map(tr => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="width:200px;font-size:13px;font-weight:500">${tr.label}</div>
      <div style="font-size:20px;font-weight:700;width:80px">${tr.med !== null ? tr.med + 'д' : '—'}</div>
      <div style="flex:1">${tr.med !== null ? `<div class="prog"><div class="prog-f" style="width:${Math.min(100, tr.med / 90 * 100)}%"></div></div>` : ''}</div>
      <div style="font-size:11px;color:var(--hint)">${tr.n} случ.</div>
    </div>`).join('');

  // Churn list
  const churnEl = document.getElementById('an-churn-list');
  const churnEmEl = document.getElementById('an-churn-empty');
  if (churnEl) {
    if (!churned.length) {
      churnEl.innerHTML = ''; if (churnEmEl) churnEmEl.style.display = '';
    } else {
      if (churnEmEl) churnEmEl.style.display = 'none';
      churnEl.innerHTML = churned.map(s => {
        const h = s.status_history || [];
        const startEntry = h.find(e => e.status === 'active');
        const months = studentLifetimeMonths(s);
        const actualLTV = studentActualLTV(s);
        return `<div class="ch-row">
          <span><b>${s.name}</b></span>
          <span style="color:var(--muted)">${startEntry ? fmtDate(startEntry.date) : ''} — ${fmtDate(s.left_at)}</span>
          <span><span class="tag" style="margin:0">${s.source || '—'}</span></span>
          <span>${months ? months + ' мес' : '—'}</span>
          <span class="amount-pos">${actualLTV ? fmt(actualLTV) + ' ₽' : '—'}</span>
        </div>`;
      }).join('');
    }
  }

  // Channels table
  const chTbl = document.getElementById('an-channels-table');
  if (chTbl) {
    const channels = ['Авито','Сарафан','Telegram','Профи.ру','Instagram','ВКонтакте','Другое'];
    const rows = channels.map(ch => {
      const spend = periodExpenses.filter(e => e.category === 'Реклама' && e.channel === ch).reduce((s, e) => s + e.amount, 0);
      const acquired = students.filter(s => s.source === ch && becameStatusInPeriod(s, 'active')).length ||
        students.filter(s => s.source === ch && ['active', 'exam_passed'].includes(s.crm_status)).length;
      const ltvCh = students.filter(s => s.source === ch).map(s => payments.filter(p => p.student_id === s.id).reduce((a, p) => a + p.amount, 0)).filter(v => v > 0);
      const avgLtv = ltvCh.length ? Math.round(ltvCh.reduce((a, b) => a + b, 0) / ltvCh.length) : null;
      const cac_ch = spend && acquired ? Math.round(spend / acquired) : null;
      const roi = cac_ch && avgLtv ? +(avgLtv / cac_ch).toFixed(1) : null;
      if (!spend && !acquired) return null;
      return { ch, spend, acquired, cac_ch, avgLtv, roi };
    }).filter(Boolean);
    if (!rows.length) {
      chTbl.innerHTML = '<div class="empty">Нет данных — укажи канал при добавлении расходов на рекламу</div>';
    } else {
      const maxRoi = Math.max(...rows.map(r => r.roi || 0), 1);
      chTbl.innerHTML = `<table class="channel-tbl">
        <thead><tr><th>Канал</th><th>Расходы</th><th>Привлечено</th><th>CAC</th><th>Ср. LTV</th><th>ROI</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><b>${r.ch}</b></td>
          <td style="color:var(--red)">${r.spend ? '−' + fmt(r.spend) + ' ₽' : '—'}</td>
          <td>${r.acquired} уч.</td>
          <td>${r.cac_ch ? fmt(r.cac_ch) + ' ₽' : '—'}</td>
          <td>${r.avgLtv ? fmt(r.avgLtv) + ' ₽' : '—'}</td>
          <td>${r.roi !== null ? `<div style="font-weight:700;color:${r.roi >= 3 ? 'var(--green)' : r.roi >= 1 ? 'var(--amber)' : 'var(--red)'}">×${r.roi}</div>
            <div class="roi-bar"><div class="roi-fill" style="width:${Math.min(100, r.roi / maxRoi * 100)}%;background:${r.roi >= 3 ? '#22c55e' : r.roi >= 1 ? '#f59e0b' : '#ef4444'}"></div></div>` : '<span style="color:var(--hint)">—</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }
  }
}
