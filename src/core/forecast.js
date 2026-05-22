import { CACHE } from './store.js';

const DEFAULT_RETENTION = 0.75;
const MIN_PAYMENTS = 30;

function calcRetentionRate() {
  const payments = CACHE.payments || [];
  if (payments.length < MIN_PAYMENTS) return { rate: DEFAULT_RETENTION, usingDefault: true };

  const students = CACHE.students || [];
  const active = students.filter(s => s.crm_status === 'active').length;
  const churned90 = students.filter(s =>
    ['stopped', 'refused', 'left'].includes(s.crm_status) &&
    s.left_at &&
    (Date.now() - new Date(s.left_at)) / 86400000 <= 90
  ).length;
  const base = active + churned90;
  const rate = base > 0 ? Math.min(1, Math.max(0, active / base)) : DEFAULT_RETENTION;
  return { rate, usingDefault: false };
}

function monthEndStr(year, month) {
  // ISO date string for the last day of the month
  return new Date(year, month + 1, 0).toISOString().slice(0, 10);
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

export function calculateForecast(months = 3) {
  const payments = CACHE.payments || [];
  const students = CACHE.students || [];
  const active = students.filter(s => s.crm_status === 'active');
  const { rate: retentionRate, usingDefault } = calcRetentionRate();
  const now = new Date();

  // Pre-index latest sub_end per student
  const latestSubEnd = {};
  for (const p of payments) {
    if (!p.sub_end) continue;
    if (!latestSubEnd[p.student_id] || p.sub_end > latestSubEnd[p.student_id]) {
      latestSubEnd[p.student_id] = p.sub_end;
    }
  }

  const result = [];

  for (let m = 0; m < months; m++) {
    const rawMonth = now.getMonth() + m;
    const year = now.getFullYear() + Math.floor(rawMonth / 12);
    const month = rawMonth % 12;
    const endStr = monthEndStr(year, month);
    const label = monthLabel(year, month);

    let guaranteed = 0, probable = 0;
    let guaranteedCount = 0, probableCount = 0;

    for (const s of active) {
      const monthly = (s.price_per_hour || 0) * (s.lessons_per_month || 0);
      if (!monthly) continue;

      const subType = s.subscription_type || 'monthly';
      const subEnd = latestSubEnd[s.id];
      const isPackage = (subType === '3month' || subType === '6month') && subEnd && subEnd >= endStr;

      if (isPackage) {
        guaranteed += monthly;
        guaranteedCount++;
      } else {
        probable += monthly * retentionRate;
        probableCount++;
      }
    }

    result.push({
      month: m,
      label,
      guaranteed: Math.round(guaranteed),
      probable: Math.round(probable),
      total: Math.round(guaranteed + probable),
      guaranteedCount,
      probableCount,
    });
  }

  return { months: result, retentionRate, usingDefault };
}
