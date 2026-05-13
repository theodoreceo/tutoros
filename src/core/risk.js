import { CACHE } from './store.js';
import { daysLeft, fmt } from '../utils/helpers.js';
import { addEvent } from './events.js';

export function studentSubscriptionStatus(s) {
  const payments = (CACHE.payments || []).filter(p => p.student_id === s.id && p.sub_end).sort((a, b) => new Date(b.sub_end) - new Date(a.sub_end));
  if (!payments.length) return null;
  const latest = payments[0];
  const dl = daysLeft(latest.sub_end);
  return { sub_end: latest.sub_end, daysLeft: dl };
}

export function renderSubscriptionBadge(s) {
  const sub = studentSubscriptionStatus(s);
  if (!sub) return '<span class="b b-gray">—</span>';
  const dl = sub.daysLeft;
  if (dl < 0) return `<span class="b b-r">Просрочен ${Math.abs(dl)}д</span>`;
  if (dl <= 7) return `<span class="b b-a">Истекает через ${dl}д</span>`;
  return `<span class="b b-g">Активен до ${new Date(sub.sub_end+'T00:00:00').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'})}</span>`;
}

export function calcRiskScore(s) {
  let score = 0; const reasons = [];
  const cutoff30 = new Date(); cutoff30.setDate(cutoff30.getDate() - 30);
  const lessons30 = (CACHE.lessons || []).filter(l => new Date(l.date) >= cutoff30);

  const absents30 = lessons30.filter(l => (l.student_attendance || []).some(a => a.student_id === s.id && !a.present)).length;
  if (absents30 >= 3) { score += 3; reasons.push(`${absents30} пропусков за 30д`); }
  else if (absents30 >= 2) { score += 2; reasons.push(`${absents30} пропуска за 30д`); }
  else if (absents30 >= 1) { score += 1; reasons.push(`1 пропуск за 30д`); }

  const hwMissing = (CACHE.hw_submissions || []).filter(h => h.student_id === s.id && h.status === 'missing').length;
  if (hwMissing >= 2) { score += 2; reasons.push(`${hwMissing} ДЗ не сдано`); }
  else if (hwMissing === 1) { score += 1; reasons.push('1 ДЗ не сдано'); }

  const sub = studentSubscriptionStatus(s);
  if (sub && sub.daysLeft < 0) { score += 3; reasons.push('абонемент просрочен'); }
  else if (sub && sub.daysLeft <= 7) { score += 1; reasons.push('абонемент истекает'); }

  if (!s.paid && s.crm_status === 'active') { score += 2; reasons.push('не оплачен'); }

  return { score, reasons, level: score >= 5 ? 'high' : score >= 2 ? 'med' : 'low' };
}

export async function recalcRisk(s) {
  const { score, reasons, level } = calcRiskScore(s);
  if (level === 'high' || level === 'med') {
    const existing = (CACHE.events || []).find(e => e.entity_id === s.id && e.event_type === 'student_at_risk' &&
      new Date(e.created_at) > new Date(Date.now() - 86400000 * 3));
    if (!existing) await addEvent('student', s.id, 'student_at_risk', { score, reasons });
  }
}

export function riskBadge(s) {
  const { score, level, reasons } = calcRiskScore(s);
  if (level === 'high') return `<span class="risk-badge high" title="${reasons.join(', ')}"><i class="ti ti-alert-triangle"></i> Высокий</span>`;
  if (level === 'med')  return `<span class="risk-badge med"  title="${reasons.join(', ')}"><i class="ti ti-alert-circle"></i> Средний</span>`;
  return `<span class="risk-badge low"><i class="ti ti-circle-check"></i> OK</span>`;
}
