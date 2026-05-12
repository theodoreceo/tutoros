import { CACHE } from '../core/store.js';
import { state } from '../core/state.js';
import { calcRiskScore } from '../core/risk.js';
import { fmt, fmtDate, today, thisMonth } from '../utils/helpers.js';
import { navigate } from '../core/router.js';

export function renderDashboard() {
  renderDashboardMetrics();
  renderDashboardTodayLessons();
  renderDashboardActionItems();
  renderDashboardHistory();
}

function renderDashboardMetrics() {
  const el = document.getElementById('db-metrics');
  if (!el) return;

  const students = CACHE.students;
  const active = students.filter(s => s.status === 'active').length;
  const trials = students.filter(s => s.status === 'trial').length;

  const mo = thisMonth();
  const moPay = CACHE.payments.filter(p => p.date?.startsWith(mo)).reduce((a, p) => a + (p.amount || 0), 0);
  const moExp = CACHE.expenses.filter(e => e.date?.startsWith(mo)).reduce((a, e) => a + (e.amount || 0), 0);

  const atRisk = students.filter(s => s.status === 'active' && calcRiskScore(s) >= 40).length;
  const openTasks = CACHE.tasks.filter(t => t.status === 'open').length;

  el.innerHTML = `
    <div class="qs-row">
      <div class="qs-item">
        <div class="qs-val">${active}</div>
        <div class="qs-label">Активных учеников</div>
      </div>
      <div class="qs-item">
        <div class="qs-val">${trials}</div>
        <div class="qs-label">Пробных</div>
      </div>
      <div class="qs-item">
        <div class="qs-val">${fmt(moPay)} ₽</div>
        <div class="qs-label">Доходы (месяц)</div>
      </div>
      <div class="qs-item">
        <div class="qs-val" style="color:${atRisk > 0 ? 'var(--red)' : 'inherit'}">${atRisk}</div>
        <div class="qs-label">В зоне риска</div>
      </div>
      <div class="qs-item">
        <div class="qs-val">${openTasks}</div>
        <div class="qs-label">Открытых задач</div>
      </div>
    </div>
  `;
}

function renderDashboardTodayLessons() {
  const el = document.getElementById('db-today');
  if (!el) return;

  const t = today();
  const lessons = CACHE.lessons
    .filter(l => l.date === t && !l.cancelled)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  if (!lessons.length) {
    el.innerHTML = '<div class="empty" style="padding:12px 0">Уроков сегодня нет</div>';
    return;
  }

  const nowH = new Date().getHours() * 60 + new Date().getMinutes();

  el.innerHTML = lessons.map(l => {
    const student = CACHE.students.find(s => s.id === l.studentId);
    const name = student ? student.name : (l.groupId ? (CACHE.groups.find(g => g.id === l.groupId)?.name || '') : '?');
    const [sh, sm] = (l.startTime || '0:0').split(':').map(Number);
    const isPast = (sh * 60 + sm) < nowH;
    return `
      <div class="today-lesson ${isPast ? 'past' : 'upcoming'}" onclick="window.__openLessonCard('${l.id}')">
        <div class="tl-time">${l.startTime}</div>
        <div class="tl-info">
          <div class="tl-name">${name}</div>
          <div class="tl-group">${l.topic || 'Тема не указана'}</div>
        </div>
        ${l.isTrial ? '<span class="b b-bl" style="font-size:10px">Пробный</span>' : ''}
      </div>
    `;
  }).join('');
}

function renderDashboardActionItems() {
  const el = document.getElementById('db-actions');
  if (!el) return;

  const items = [];

  // Overdue payments
  const overduePayment = CACHE.students.filter(s => s.status === 'active' && (s.paymentDelay || 0) >= 7);
  overduePayment.forEach(s => items.push({
    icon: 'ph-bold ph-warning',
    color: 'var(--red)',
    text: `${s.name}: задолженность ${s.paymentDelay} дн.`,
    action: `window.__openStudentDetail('${s.id}')`,
  }));

  // Expiring subscriptions
  CACHE.students.filter(s => s.status === 'active' && s.subscriptionEnd).forEach(s => {
    const dl = Math.ceil((new Date(s.subscriptionEnd) - new Date(today())) / 86400000);
    if (dl >= 0 && dl <= 7) items.push({
      icon: 'ph-bold ph-calendar-x',
      color: 'var(--amber)',
      text: `${s.name}: подписка истекает через ${dl} дн.`,
      action: `window.__openStudentDetail('${s.id}')`,
    });
  });

  // High-risk students
  CACHE.students.filter(s => s.status === 'active' && calcRiskScore(s) >= 70).forEach(s => items.push({
    icon: 'ph-bold ph-shield-warning',
    color: 'var(--red)',
    text: `${s.name}: высокий риск отказа`,
    action: `window.__openStudentDetail('${s.id}')`,
  }));

  // Open tasks due today or overdue
  const t = today();
  CACHE.tasks.filter(tk => tk.status === 'open' && tk.dueDate && tk.dueDate <= t).forEach(tk => items.push({
    icon: 'ph-bold ph-check-square',
    color: 'var(--accent)',
    text: `Задача: ${tk.title}`,
    action: `window.__navigate('tasks')`,
  }));

  if (!items.length) {
    el.innerHTML = '<div class="empty" style="padding:10px 0">Нет срочных действий</div>';
    return;
  }

  el.innerHTML = items.slice(0, 8).map(item => `
    <div class="action-item" onclick="${item.action}" style="cursor:pointer">
      <i class="${item.icon}" style="color:${item.color}"></i>
      <div class="action-item-text">${item.text}</div>
    </div>
  `).join('');
}

function renderDashboardHistory() {
  const el = document.getElementById('db-history');
  if (!el) return;

  const recent = [...CACHE.history]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  if (!recent.length) {
    el.innerHTML = '<div class="empty" style="padding:10px 0">История пуста</div>';
    return;
  }

  el.innerHTML = recent.map(h => `
    <div class="tl-item">
      <div class="tl-dot-wrap"><div class="tl-dot"></div></div>
      <div class="tl-body">
        <div class="tl-event">${h.label || h.action}</div>
        <div class="tl-meta">${h.actor} · ${new Date(h.createdAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    </div>
  `).join('');
}
