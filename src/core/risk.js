import { CACHE } from './store.js';
import { daysLeft } from '../utils/helpers.js';
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
  let score = 0;
  const reasons = [];
  const cutoff30 = new Date(Date.now() - 30 * 86400000);
  const resetAt = s.risk_reset_at ? new Date(s.risk_reset_at) : null;

  // Missed non-advanced HW in last 30 days (after reset if any)
  const recentMissed = (CACHE.homework_submissions || []).filter(sub => {
    if (sub.student_id !== s.id) return false;
    if (sub.status !== 'overdue' && sub.status !== 'missing') return false;
    const asgn = (CACHE.homework_assignments || []).find(a => a.id === sub.assignment_id);
    if (!asgn) return false;
    if (asgn.is_advanced) return false;
    const asgnDate = new Date(asgn.assigned_at || asgn.due_date || 0);
    if (asgnDate < cutoff30) return false;
    if (resetAt && asgnDate < resetAt) return false;
    return true;
  }).length;

  if (recentMissed >= 3)      { score += 2; reasons.push(`${recentMissed} несданных ДЗ за 30 дн.`); }
  else if (recentMissed >= 2) { score += 1; reasons.push(`${recentMissed} несданных ДЗ за 30 дн.`); }

  // Subscription status
  const sub = studentSubscriptionStatus(s);
  if (sub) {
    if (sub.daysLeft < 0)     { score += 2; reasons.push('абонемент просрочен'); }
    else if (sub.daysLeft < 3){ score += 1; reasons.push('абонемент истекает'); }
  }

  return { score, reasons, level: score >= 2 ? 'high' : score === 1 ? 'med' : 'low' };
}

export async function recalcRisk(s) {
  const { score, reasons, level } = calcRiskScore(s);
  if (level === 'high') {
    const existing = (CACHE.events || []).find(e => e.entity_id === s.id && e.event_type === 'student_at_risk' &&
      new Date(e.created_at) > new Date(Date.now() - 86400000 * 3));
    if (!existing) await addEvent('student', s.id, 'student_at_risk', { score, reasons });
  }
}

export function riskBadge(s) {
  const { score, level, reasons } = calcRiskScore(s);
  if (level === 'high') return `<span class="risk-badge high" title="${reasons.join(', ')}"><i class="ti ti-alert-triangle"></i> ${score} · Внимание</span>`;
  if (level === 'med')  return `<span class="risk-badge med"  title="${reasons.join(', ')}"><i class="ti ti-alert-circle"></i> ${score} · Следить</span>`;
  return `<span class="risk-badge low"><i class="ti ti-circle-check"></i> OK</span>`;
}
