import { CACHE, dbUpdate } from './store.js';
import { daysLeft, today } from '../utils/helpers.js';

export function calcRiskScore(student) {
  let score = 0;
  if ((student.absences || 0) >= 3) score += 30;
  else if ((student.absences || 0) >= 2) score += 15;
  if ((student.hwMissed || 0) >= 3) score += 25;
  else if ((student.hwMissed || 0) >= 2) score += 10;
  if ((student.paymentDelay || 0) >= 14) score += 35;
  else if ((student.paymentDelay || 0) >= 7) score += 20;
  else if ((student.paymentDelay || 0) >= 3) score += 10;
  if (student.subscriptionEnd) {
    const dl = daysLeft(student.subscriptionEnd);
    if (dl !== null && dl <= 0) score += 20;
    else if (dl !== null && dl <= 7) score += 10;
  }
  return Math.min(score, 100);
}

export function recalcRisk(studentId) {
  const s = CACHE.students.find(x => x.id === studentId);
  if (!s) return;
  const score = calcRiskScore(s);
  dbUpdate('students', studentId, { riskScore: score });
}

export function riskBadge(score) {
  if (score >= 70) return `<span class="risk-badge risk-high">${score}</span>`;
  if (score >= 40) return `<span class="risk-badge risk-med">${score}</span>`;
  return `<span class="risk-badge risk-low">${score}</span>`;
}

export function studentSubscriptionStatus(student) {
  if (!student.subscriptionEnd) return null;
  const dl = daysLeft(student.subscriptionEnd);
  if (dl === null) return null;
  if (dl < 0) return { type: 'expired', days: Math.abs(dl) };
  if (dl === 0) return { type: 'today', days: 0 };
  if (dl <= 7) return { type: 'soon', days: dl };
  return { type: 'ok', days: dl };
}

export function renderSubscriptionBadge(student) {
  const st = studentSubscriptionStatus(student);
  if (!st) return '';
  if (st.type === 'expired') return `<span class="b b-r" title="Подписка истекла ${st.days} дн. назад">Просрочена</span>`;
  if (st.type === 'today')   return `<span class="b b-a">Истекает сегодня</span>`;
  if (st.type === 'soon')    return `<span class="b b-a">Истекает через ${st.days} дн.</span>`;
  return '';
}
