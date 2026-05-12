import { CACHE } from '../core/store.js';
import { state } from '../core/state.js';
import { fmt, today, thisMonth, lastMonth } from '../utils/helpers.js';
import { calcRiskScore } from '../core/risk.js';

export function renderAnalytics() {
  const el = document.getElementById('analytics-content');
  if (!el) return;

  const tab = state.anTab || 'overview';
  const period = state.anPeriod || 'month';

  el.innerHTML = `
    <div class="an-period-bar" style="margin-bottom:12px">
      <button class="${tab==='overview'?'on':''}" onclick="window.__setAnTab('overview')">Обзор</button>
      <button class="${tab==='finance'?'on':''}" onclick="window.__setAnTab('finance')">Финансы</button>
      <button class="${tab==='students'?'on':''}" onclick="window.__setAnTab('students')">Ученики</button>
      <button class="${tab==='channels'?'on':''}" onclick="window.__setAnTab('channels')">Каналы</button>
    </div>
    <div id="an-tab-content"></div>
  `;

  renderAnTab(tab, period);
}

export function setAnTab(tab) {
  state.anTab = tab;
  renderAnalytics();
}

export function setAnPeriod(period) {
  state.anPeriod = period;
  renderAnalytics();
}

function renderAnTab(tab, period) {
  const el = document.getElementById('an-tab-content');
  if (!el) return;

  const mo = thisMonth();
  const lastMo = lastMonth();

  const students = CACHE.students;
  const active = students.filter(s => s.status === 'active');
  const payments = CACHE.payments;
  const expenses = CACHE.expenses;

  const moIncome = payments.filter(p => p.date?.startsWith(mo)).reduce((a,p)=>a+(p.amount||0),0);
  const lastMoIncome = payments.filter(p => p.date?.startsWith(lastMo)).reduce((a,p)=>a+(p.amount||0),0);
  const moExpenses = expenses.filter(e => e.date?.startsWith(mo)).reduce((a,e)=>a+(e.amount||0),0);
  const profit = moIncome - moExpenses;
  const margin = moIncome ? Math.round(profit / moIncome * 100) : 0;
  const growth = lastMoIncome ? Math.round((moIncome - lastMoIncome) / lastMoIncome * 100) : null;

  if (tab === 'overview') {
    const atRisk = active.filter(s => calcRiskScore(s) >= 40).length;
    const highRisk = active.filter(s => calcRiskScore(s) >= 70).length;
    const trials = students.filter(s => s.status === 'trial').length;
    const converted = students.filter(s => s.status === 'active' && s.trialDate).length;
    const trialConversion = (converted + trials) > 0 ? Math.round(converted / (converted + trials) * 100) : 0;

    el.innerHTML = `
      <div class="an-grid">
        <div class="an-met ${moIncome >= lastMoIncome ? 'good' : 'warn'}">
          <div class="an-label">Доходы (месяц)</div>
          <div class="an-val">${fmt(moIncome)} ₽</div>
          ${growth !== null ? `<div class="an-sub">${growth >= 0 ? '+' : ''}${growth}% к прошлому</div>` : ''}
        </div>
        <div class="an-met ${profit >= 0 ? 'good' : 'bad'}">
          <div class="an-label">Прибыль</div>
          <div class="an-val">${fmt(profit)} ₽</div>
          <div class="an-sub">Маржа ${margin}%</div>
        </div>
        <div class="an-met">
          <div class="an-label">Активных учеников</div>
          <div class="an-val">${active.length}</div>
        </div>
        <div class="an-met ${highRisk > 0 ? 'bad' : atRisk > 0 ? 'warn' : 'good'}">
          <div class="an-label">В зоне риска</div>
          <div class="an-val">${atRisk}</div>
          <div class="an-sub">${highRisk} — высокий риск</div>
        </div>
        <div class="an-met">
          <div class="an-label">Конверсия пробных</div>
          <div class="an-val">${trialConversion}%</div>
          <div class="an-sub">${trials} пробных сейчас</div>
        </div>
      </div>

      <div class="an-section">Здоровье бизнеса</div>
      ${renderHealthBlock(active, moIncome, moExpenses)}

      <div class="an-section">Воронка учеников</div>
      ${renderFunnel(students)}
    `;
  } else if (tab === 'finance') {
    el.innerHTML = `
      <div class="an-grid">
        <div class="an-met ${moIncome >= lastMoIncome ? 'good' : 'warn'}">
          <div class="an-label">Доходы</div><div class="an-val">${fmt(moIncome)} ₽</div>
        </div>
        <div class="an-met warn">
          <div class="an-label">Расходы</div><div class="an-val">${fmt(moExpenses)} ₽</div>
        </div>
        <div class="an-met ${profit >= 0 ? 'good' : 'bad'}">
          <div class="an-label">Прибыль</div><div class="an-val">${fmt(profit)} ₽</div>
          <div class="an-sub">Маржа ${margin}%</div>
        </div>
      </div>
      <div class="an-section">MRR за последние 6 месяцев</div>
      ${renderMrrBars()}
    `;
  } else if (tab === 'students') {
    const retention = renderRetention(active);
    el.innerHTML = `
      <div class="an-grid">
        <div class="an-met"><div class="an-label">Активных</div><div class="an-val">${active.length}</div></div>
        <div class="an-met"><div class="an-label">Пробных</div><div class="an-val">${students.filter(s=>s.status==='trial').length}</div></div>
        <div class="an-met"><div class="an-label">На паузе</div><div class="an-val">${students.filter(s=>s.status==='paused').length}</div></div>
        <div class="an-met warn"><div class="an-label">Ушли</div><div class="an-val">${students.filter(s=>s.status==='left').length}</div></div>
      </div>
      <div class="an-section">Удержание (по педагогам)</div>
      ${retention}
    `;
  } else if (tab === 'channels') {
    el.innerHTML = `
      <div class="an-section" style="margin-top:0">Маркетинговые расходы этого месяца</div>
      ${renderChannelsTable()}
    `;
  }
}

function renderHealthBlock(active, income, expenseTotal) {
  const atRisk = active.filter(s => calcRiskScore(s) >= 40).length;
  const riskScore = active.length ? Math.round((1 - atRisk / active.length) * 100) : 100;
  const margin = income ? Math.round((income - expenseTotal) / income * 100) : 0;
  const finScore = Math.max(0, Math.min(100, margin + 50));
  const overall = Math.round((riskScore + finScore) / 2);
  const color = overall >= 70 ? '#16a34a' : overall >= 50 ? '#ca8a04' : '#dc2626';

  return `<div class="health-block">
    <div class="health-score-circle" style="background:${color}20;color:${color}">
      <div class="hs-num">${overall}</div>
      <div class="hs-label">Балл</div>
    </div>
    <div class="health-breakdown">
      <div class="hb-item">
        <div class="hb-label">Риски</div>
        <div class="hb-bar"><div class="hb-fill" style="width:${riskScore}%;background:${riskScore>=70?'#16a34a':'#ca8a04'}"></div></div>
        <div class="hb-val" style="color:${riskScore>=70?'#16a34a':'#ca8a04'}">${riskScore}%</div>
      </div>
      <div class="hb-item">
        <div class="hb-label">Финансы</div>
        <div class="hb-bar"><div class="hb-fill" style="width:${finScore}%;background:${finScore>=70?'#16a34a':'#ca8a04'}"></div></div>
        <div class="hb-val" style="color:${finScore>=70?'#16a34a':'#ca8a04'}">${margin}% маржа</div>
      </div>
    </div>
  </div>`;
}

function renderFunnel(students) {
  const stages = [
    { key: 'lead',   label: 'Лиды' },
    { key: 'trial',  label: 'Пробные' },
    { key: 'active', label: 'Активные' },
  ];
  const max = students.length || 1;
  return `<div>
    ${stages.map(st => {
      const count = students.filter(s => s.status === st.key || s.pipelineStage === st.key).length;
      const pct = Math.round(count / max * 100);
      return `<div class="funnel-row">
        <span style="width:80px;font-size:12px">${st.label}</span>
        <div class="funnel-bar"><div class="funnel-fill" style="width:${pct}%"></div></div>
        <span style="width:40px;text-align:right;font-size:12px;font-weight:600">${count}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function renderMrrBars() {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return d.toISOString().slice(0, 7);
  });
  const values = months.map(m => CACHE.payments.filter(p => p.date?.startsWith(m)).reduce((a,p)=>a+(p.amount||0),0));
  const max = Math.max(...values, 1);

  return `<div class="mrr-bars">
    ${months.map((m, i) => {
      const h = Math.round((values[i] / max) * 70);
      const isCur = m === thisMonth();
      return `<div class="mrr-bar-w">
        <div class="mrr-bar-v">${fmt(values[i])}</div>
        <div class="mrr-bar-b ${isCur?'cur':''}" style="height:${h}px" title="${m}: ${fmt(values[i])} ₽"></div>
        <div class="mrr-bar-l">${m.slice(5)}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderRetention(active) {
  const byTeacher = {};
  active.forEach(s => {
    const t = s.teacher || 'Не указан';
    byTeacher[t] = (byTeacher[t] || 0) + 1;
  });
  const total = active.length || 1;
  return `<div class="retention-grid">
    ${Object.entries(byTeacher).map(([teacher, count]) => {
      const pct = Math.round(count / total * 100);
      return `<div class="ret-row">
        <div class="ret-label">${teacher}</div>
        <div class="ret-bar-wrap">
          <div class="ret-bar-fill" style="width:${pct}%;background:var(--accent-mid)">${count}</div>
        </div>
        <div class="ret-pct">${pct}%</div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderChannelsTable() {
  const mo = thisMonth();
  const mktExp = CACHE.expenses.filter(e => e.category === 'marketing' && e.date?.startsWith(mo));
  const totalSpend = mktExp.reduce((a,e)=>a+(e.amount||0),0);
  const byChannel = {};
  mktExp.forEach(e => {
    const ch = e.channel || 'other';
    byChannel[ch] = (byChannel[ch] || 0) + (e.amount || 0);
  });

  const CHANNEL_NAMES = { yandex: 'Яндекс Директ', vk: 'ВКонтакте', telegram: 'Telegram Ads', instagram: 'Instagram', seo: 'SEO', other: 'Прочее' };

  if (!Object.keys(byChannel).length) return '<div class="empty">Нет маркетинговых расходов</div>';

  return `<table class="channel-tbl">
    <thead><tr><th>Канал</th><th>Расход</th><th>Доля</th></tr></thead>
    <tbody>
      ${Object.entries(byChannel).sort((a,b)=>b[1]-a[1]).map(([ch, amount]) => {
        const pct = totalSpend ? Math.round(amount / totalSpend * 100) : 0;
        return `<tr>
          <td>${CHANNEL_NAMES[ch] || ch}</td>
          <td class="amount-neg">${fmt(amount)} ₽</td>
          <td>
            <div>${pct}%</div>
            <div class="roi-bar"><div class="roi-fill" style="width:${pct}%;height:6px;border-radius:3px;background:var(--accent-mid)"></div></div>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}
