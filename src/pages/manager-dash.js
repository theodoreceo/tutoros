import { CACHE, ensureLoaded } from '../core/store.js';
import { fmt, fmtDate, today } from '../utils/helpers.js';

export async function renderManagerDashPage() {
  await ensureLoaded(['students', 'groups', 'lessons', 'payments', 'homework_assignments', 'homework_submissions']);

  const el = document.getElementById('pg-manager_dash');
  if (!el) return;

  const students = CACHE.students || [];
  const groups = CACHE.groups || [];
  const lessons = CACHE.lessons || [];
  const payments = CACHE.payments || [];
  const hwSubmissions = CACHE.homework_submissions || [];

  const todayStr = today();
  const active = students.filter(s => s.crm_status === 'active');

  // Lessons today
  const todayLessons = lessons.filter(l => l.date === todayStr).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  // This week lessons
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);
  const weekLessons = lessons.filter(l => l.date >= weekStartStr && l.date <= weekEndStr);

  // Students without payment in last 30 days
  const d30ago = new Date(); d30ago.setDate(d30ago.getDate() - 30);
  const d30Str = d30ago.toISOString().slice(0, 10);
  const paidIds = new Set(payments.filter(p => p.date >= d30Str).map(p => p.student_id));
  const pendingPayment = active.filter(s => !paidIds.has(s.id));

  // HW pending review
  const pendingHw = hwSubmissions.filter(s => s.status === 'submitted');

  // At-risk: no lesson in 14 days
  const d14ago = new Date(); d14ago.setDate(d14ago.getDate() - 14);
  const d14Str = d14ago.toISOString().slice(0, 10);
  const recentLessonStudents = new Set(
    lessons.filter(l => l.date >= d14Str).flatMap(l => l.attendance ? Object.keys(l.attendance) : [])
  );
  const atRisk = active.filter(s => !recentLessonStudents.has(s.id)).slice(0, 8);

  // Recent status changes
  const recentChanges = students
    .flatMap(s => (s.status_history || []).map(h => ({ ...h, student: s })))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 6);

  el.innerHTML = `
    <div style="padding:20px;max-width:1100px;margin:0 auto">
      <div style="font-size:20px;font-weight:700;margin-bottom:20px">Операционный дашборд</div>

      <!-- KPI row -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        ${_kpi('Активных учеников', active.length, 'ti-users', '#2563eb')}
        ${_kpi('Занятий на неделе', weekLessons.length, 'ti-calendar', '#16a34a')}
        ${_kpi('Ожидают оплаты', pendingPayment.length, 'ti-receipt', pendingPayment.length > 3 ? '#ef4444' : '#d97706')}
        ${_kpi('ДЗ на проверке', pendingHw.length, 'ti-file-check', pendingHw.length > 5 ? '#ef4444' : '#7c3aed')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <!-- Today's lessons -->
        <div class="card" style="margin-bottom:0">
          <div style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:6px">
            <i class="ti ti-clock" style="color:var(--accent-mid)"></i> Занятия сегодня
            <span style="margin-left:auto;font-size:11px;color:var(--muted);font-weight:400">${todayLessons.length} занятий</span>
          </div>
          ${todayLessons.length ? todayLessons.map(l => {
            const grp = groups.find(g => g.id === l.group_id);
            const attendCount = l.attendance ? Object.values(l.attendance).filter(v => v).length : 0;
            return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
              <div style="font-size:12px;font-weight:600;color:var(--accent-mid);min-width:40px">${l.time || '—'}</div>
              <div style="flex:1;font-size:13px">${grp?.name || 'Группа'}</div>
              <div style="font-size:11px;color:var(--muted)">${attendCount} уч.</div>
            </div>`;
          }).join('') : '<div style="color:var(--muted);font-size:13px;padding:8px 0">Занятий нет</div>'}
        </div>

        <!-- At-risk students -->
        <div class="card" style="margin-bottom:0">
          <div style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:6px">
            <i class="ti ti-alert-triangle" style="color:#d97706"></i> Не было занятий 14+ дней
            <span style="margin-left:auto;font-size:11px;color:var(--muted);font-weight:400">${atRisk.length} учеников</span>
          </div>
          ${atRisk.length ? atRisk.map(s => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
              <div style="flex:1;font-size:13px">${s.name}</div>
              <span class="b b-r" style="font-size:10px">риск</span>
            </div>
          `).join('') : '<div style="color:var(--muted);font-size:13px;padding:8px 0">Всё в порядке</div>'}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- Pending payment -->
        <div class="card" style="margin-bottom:0">
          <div style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:6px">
            <i class="ti ti-receipt-2" style="color:#d97706"></i> Нет оплаты за 30 дней (${pendingPayment.length})
          </div>
          ${pendingPayment.slice(0, 6).map(s => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
              <div style="flex:1;font-size:13px">${s.name}</div>
              <div style="font-size:11px;color:var(--muted)">${fmt(s.price_per_hour || 0)} ₽/ч</div>
            </div>
          `).join('') || '<div style="color:var(--muted);font-size:13px">Все оплатили</div>'}
          ${pendingPayment.length > 6 ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">+${pendingPayment.length - 6} ещё</div>` : ''}
        </div>

        <!-- Recent CRM activity -->
        <div class="card" style="margin-bottom:0">
          <div style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:6px">
            <i class="ti ti-activity" style="color:var(--accent-mid)"></i> Последние изменения статусов
          </div>
          ${recentChanges.length ? recentChanges.map(h => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
              <div style="flex:1;font-size:13px">${h.student.name}</div>
              <span class="b b-bl" style="font-size:10px">${h.status}</span>
              <div style="font-size:11px;color:var(--muted)">${fmtDate(h.date)}</div>
            </div>
          `).join('') : '<div style="color:var(--muted);font-size:13px">Нет данных</div>'}
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
