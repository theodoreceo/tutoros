import { CACHE, ensureLoaded } from '../core/store.js';
import { fmt, fmtDate, esc } from '../utils/helpers.js';

export async function renderMarketerDashPage() {
  await ensureLoaded(['students', 'payments', 'expenses']);

  const el = document.getElementById('pg-marketer_dash');
  if (!el) return;

  const students = CACHE.students || [];
  const payments = CACHE.payments || [];
  const expenses = CACHE.expenses || [];

  // Funnel stages
  const stages = [
    { key: 'lead',            label: 'Лиды',             color: '#64748b' },
    { key: 'trial_scheduled', label: 'Пробник назначен',  color: '#7c3aed' },
    { key: 'trial_done',      label: 'Пробник проведён',   color: '#d97706' },
    { key: 'active',          label: 'Стали учениками',   color: '#16a34a' },
    { key: 'stopped',         label: 'Отказались',        color: '#ef4444' },
    { key: 'left',            label: 'Ушли',              color: '#dc2626' },
  ];

  const stageCounts = {};
  stages.forEach(s => {
    stageCounts[s.key] = students.filter(st => st.crm_status === s.key).length;
  });

  const totalLeads = students.length;
  const converted = stageCounts['active'] || 0;
  const conversionRate = totalLeads ? Math.round(converted / totalLeads * 100) : 0;

  // Sources
  const sourceMap = {};
  students.forEach(s => {
    const src = s.source || 'Не указан';
    if (!sourceMap[src]) sourceMap[src] = { total: 0, active: 0 };
    sourceMap[src].total++;
    if (s.crm_status === 'active') sourceMap[src].active++;
  });
  const sources = Object.entries(sourceMap)
    .map(([src, d]) => ({ src, ...d, rate: d.total ? Math.round(d.active / d.total * 100) : 0 }))
    .sort((a, b) => b.total - a.total);

  // Marketing expenses
  const mktExpenses = expenses.filter(e => e.channel || e.category === 'Реклама');
  const totalMktSpend = mktExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const cpa = converted && totalMktSpend ? Math.round(totalMktSpend / converted) : 0;

  // Leads this month
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const newLeads = students.filter(s => s.created_at && s.created_at >= monthStart).length;
  const newActive = students.filter(s => {
    const h = s.status_history || [];
    return h.some(e => e.status === 'active' && e.date >= monthStart);
  }).length;

  el.innerHTML = `
    <div style="padding:20px;max-width:1100px;margin:0 auto">
      <div style="font-size:20px;font-weight:700;margin-bottom:20px">Дашборд маркетолога</div>

      <!-- KPI row -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        ${_kpi('Всего лидов', totalLeads, 'ti-users', '#2563eb')}
        ${_kpi('Конверсия в учеников', conversionRate + '%', 'ti-trending-up', conversionRate > 20 ? '#16a34a' : '#d97706')}
        ${_kpi('Новых лидов (месяц)', newLeads, 'ti-user-plus', '#7c3aed')}
        ${_kpi('Стоимость привлечения', cpa ? fmt(cpa) + ' ₽' : '—', 'ti-coin', '#0891b2')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <!-- Funnel -->
        <div class="card" style="margin-bottom:0">
          <div style="font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:6px">
            <i class="ti ti-filter" style="color:var(--accent-mid)"></i> Воронка продаж
          </div>
          ${stages.map(s => {
            const count = stageCounts[s.key] || 0;
            const pct = totalLeads ? Math.round(count / totalLeads * 100) : 0;
            return `<div style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                <span style="color:var(--text)">${esc(s.label)}</span>
                <span style="color:var(--muted)">${count} (${pct}%)</span>
              </div>
              <div style="height:6px;background:var(--surface2,var(--surface));border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${s.color};border-radius:3px;transition:width .3s"></div>
              </div>
            </div>`;
          }).join('')}
        </div>

        <!-- Sources -->
        <div class="card" style="margin-bottom:0">
          <div style="font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:6px">
            <i class="ti ti-speakerphone" style="color:var(--accent-mid)"></i> Источники лидов
          </div>
          ${sources.length ? `
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:6px 12px;font-size:12px;margin-bottom:8px">
            <div style="color:var(--muted);font-weight:600">Источник</div>
            <div style="color:var(--muted);font-weight:600;text-align:right">Лидов</div>
            <div style="color:var(--muted);font-weight:600;text-align:right">Конв.</div>
          </div>
          ${sources.map(s => `
            <div style="display:grid;grid-template-columns:1fr auto auto;gap:4px 12px;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)">
              <div>${esc(s.src)}</div>
              <div style="text-align:right;color:var(--muted)">${s.total}</div>
              <div style="text-align:right;font-weight:600;color:${s.rate > 20 ? '#16a34a' : s.rate > 10 ? '#d97706' : 'var(--muted)'}">${s.rate}%</div>
            </div>
          `).join('')}` : '<div style="color:var(--muted);font-size:13px">Нет данных об источниках</div>'}
        </div>
      </div>

      <!-- This month new active + trial pipeline -->
      <div class="card">
        <div style="font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:6px">
          <i class="ti ti-calendar-stats" style="color:var(--accent-mid)"></i>
          В этом месяце: ${newLeads} новых лидов → ${newActive} стали учениками
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${students.filter(s => ['trial_scheduled','trial_done'].includes(s.crm_status)).map(s => `
            <div style="background:var(--surface2,var(--surface));border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:12px">
              <div style="font-weight:600">${esc(s.name)}</div>
              <div style="color:var(--muted);font-size:11px">${esc(s.source || '—')}</div>
              <span class="b b-bl" style="font-size:10px;margin-top:4px;display:inline-block">${s.crm_status === 'trial_scheduled' ? 'Пробник назначен' : 'Пробник проведён'}</span>
            </div>
          `).join('') || '<div style="color:var(--muted);font-size:13px">Нет активных пробников</div>'}
        </div>
      </div>
    </div>
  `;
}

function _kpi(label, value, icon, color) {
  return `<div class="card" style="margin-bottom:0;padding:16px">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:40px;height:40px;border-radius:10px;background:${color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="ti ${icon}" style="font-size:20px;color:${color}"></i>
      </div>
      <div>
        <div style="font-size:22px;font-weight:700">${value}</div>
        <div style="font-size:11px;color:var(--muted)">${label}</div>
      </div>
    </div>
  </div>`;
}
