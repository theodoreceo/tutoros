import { CACHE, ensureLoaded } from '../core/store.js';
import { state, effectiveRole } from '../core/state.js';
import { calcRiskScore } from '../core/risk.js';
import { esc } from '../utils/helpers.js';

function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }

function calcGroupMetrics(groupId, assistantId) {
  const students = (CACHE.students || []).filter(s =>
    s.group_id === groupId && ['active', 'trial'].includes(s.crm_status)
  );
  const allStudents = (CACHE.students || []).filter(s => s.group_id === groupId);
  const leftCount = allStudents.filter(s => s.crm_status === 'left').length;

  const assignments = (CACHE.homework_assignments || []).filter(a => a.group_id === groupId);
  const assignmentIds = new Set(assignments.map(a => a.id));

  // Only non-advanced assignments for completion % and risk
  const regularAssignmentIds = new Set(
    assignments.filter(a => !a.is_advanced).map(a => a.id)
  );
  const advancedAssignmentIds = new Set(
    assignments.filter(a => a.is_advanced).map(a => a.id)
  );

  const subs = (CACHE.homework_submissions || []).filter(s => assignmentIds.has(s.assignment_id));

  // Completion % (non-advanced only)
  const regularSubs = subs.filter(s => regularAssignmentIds.has(s.assignment_id));
  const regularDone = regularSubs.filter(s => s.status === 'checked' || s.status === 'submitted').length;
  const completionPct = pct(regularDone, regularSubs.length);

  // Advanced completion %
  const advancedSubs = subs.filter(s => advancedAssignmentIds.has(s.assignment_id));
  const advancedDone = advancedSubs.filter(s => s.status === 'checked' || s.status === 'submitted').length;
  const advancedPct = pct(advancedDone, advancedSubs.length);

  // Unchecked (submitted but not checked) — excluding brief-answer
  const briefIds = new Set(assignments.filter(a => a.hw_type === 'brief').map(a => a.id));
  const unchecked = subs.filter(s => s.status === 'submitted' && !briefIds.has(s.assignment_id)).length;

  // Trial scores
  const trialAssignmentIds = new Set(assignments.filter(a => a.hw_type === 'trial').map(a => a.id));
  const trialSubs = subs.filter(s => trialAssignmentIds.has(s.assignment_id) && s.score !== null)
    .sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));

  let avgTrialScore = null;
  let trialGrowth = null;
  if (trialSubs.length) {
    // Latest trial for each student
    const latestByStudent = {};
    const prevByStudent = {};
    for (const sub of trialSubs) {
      if (!latestByStudent[sub.student_id]) {
        latestByStudent[sub.student_id] = sub.score;
      } else if (!prevByStudent[sub.student_id]) {
        prevByStudent[sub.student_id] = sub.score;
      }
    }
    const latestScores = Object.values(latestByStudent);
    avgTrialScore = latestScores.length ? Math.round(latestScores.reduce((a, b) => a + b, 0) / latestScores.length) : null;

    const prevScores = Object.values(prevByStudent);
    if (prevScores.length) {
      const prevAvg = Math.round(prevScores.reduce((a, b) => a + b, 0) / prevScores.length);
      trialGrowth = prevAvg ? Math.round((avgTrialScore - prevAvg) / prevAvg * 100) : null;
    }
  }

  // Risk count (score >= 2)
  const riskCount = students.filter(s => calcRiskScore(s).level === 'high').length;

  // Retention %
  const retention = (students.length + leftCount) > 0
    ? Math.round(students.length / (students.length + leftCount) * 100) : 100;

  // Avg check time (hours): checked_at - submitted_at
  const checkedSubs = subs.filter(s => s.status === 'checked' && s.checked_at && s.submitted_at);
  let avgCheckHours = null;
  if (checkedSubs.length) {
    const totalMs = checkedSubs.reduce((acc, s) => {
      const diff = new Date(s.checked_at) - new Date(s.submitted_at);
      return acc + (diff > 0 ? diff : 0);
    }, 0);
    avgCheckHours = Math.round(totalMs / checkedSubs.length / 3600000);
  }

  // Payment status per student
  const d30ago = new Date(); d30ago.setDate(d30ago.getDate() - 30);
  const d30Str = d30ago.toISOString().slice(0, 10);
  const paidStudentIds = new Set(
    (CACHE.payments || []).filter(p => p.date >= d30Str).map(p => p.student_id)
  );
  const unpaidStudents = students.filter(s => !paidStudentIds.has(s.id));

  return {
    students: students.length,
    leftCount,
    totalEver: allStudents.length,
    retention,
    unchecked,
    avgCheckHours,
    completionPct,
    advancedPct,
    advancedSubs: advancedSubs.length,
    avgTrialScore,
    trialGrowth,
    riskCount,
    unpaidStudents,
  };
}

function statCard(icon, label, value, sub, accent) {
  return `<div class="card" style="padding:14px 16px;display:flex;gap:12px;align-items:flex-start">
    <div style="font-size:22px;color:${accent || 'var(--accent-mid)'};flex-shrink:0"><i class="ti ${icon}"></i></div>
    <div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:2px">${label}</div>
      <div style="font-size:18px;font-weight:700;line-height:1">${value}</div>
      ${sub ? `<div style="font-size:11px;color:var(--hint);margin-top:2px">${sub}</div>` : ''}
    </div>
  </div>`;
}

function groupCard(group, m) {
  const trialLabel = m.avgTrialScore !== null
    ? `${m.avgTrialScore} / 100${m.trialGrowth !== null ? ` <span style="color:${m.trialGrowth >= 0 ? 'var(--green)' : 'var(--red)'}">` +
      (m.trialGrowth >= 0 ? '▲' : '▼') + ` ${Math.abs(m.trialGrowth)}%</span>` : ''}`
    : '—';

  const completionColor = m.completionPct >= 80 ? 'var(--green)' : m.completionPct >= 50 ? 'var(--amber)' : 'var(--red)';
  const retentionColor  = m.retention >= 90 ? 'var(--green)' : m.retention >= 70 ? 'var(--amber)' : 'var(--red)';
  const checkColor      = m.avgCheckHours === null ? 'var(--muted)' : m.avgCheckHours <= 24 ? 'var(--green)' : m.avgCheckHours <= 48 ? 'var(--amber)' : 'var(--red)';

  return `<div class="card" style="padding:0;margin-bottom:12px;overflow:hidden">
    <div style="padding:12px 16px;background:var(--surface2);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:700">${group.name}</div>
      ${m.riskCount > 0 ? `<span class="b b-r"><i class="ti ti-alert-triangle"></i> ${m.riskCount} требуют внимания</span>` : `<span class="b b-g">Всё в порядке</span>`}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:0;padding:0">
      <div style="padding:12px 16px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted)">Retention</div>
        <div style="font-size:18px;font-weight:700;color:${retentionColor}">${m.retention}%</div>
        <div style="font-size:11px;color:var(--hint)">${m.students} акт. / ${m.totalEver} всего</div>
      </div>
      <div style="padding:12px 16px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted)">Непроверенных ДЗ</div>
        <div style="font-size:18px;font-weight:700;color:${m.unchecked > 0 ? 'var(--amber)' : 'var(--green)'}">${m.unchecked}</div>
        <div style="font-size:11px;color:${checkColor}">${m.avgCheckHours !== null ? 'Ср. проверка: ' + m.avgCheckHours + ' ч' : 'Нет данных'}</div>
      </div>
      <div style="padding:12px 16px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted)">Выполнение ДЗ</div>
        <div style="font-size:18px;font-weight:700;color:${completionColor}">${m.completionPct}%</div>
        <div class="prog" style="height:4px;margin-top:4px"><div class="prog-f" style="width:${m.completionPct}%;background:${completionColor}"></div></div>
      </div>
      <div style="padding:12px 16px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted)">Сложные ДЗ</div>
        <div style="font-size:18px;font-weight:700;color:var(--accent-mid)">${m.advancedSubs ? m.advancedPct + '%' : '—'}</div>
      </div>
      <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted)">Средний балл (пробники)</div>
        <div style="font-size:15px;font-weight:700">${trialLabel}</div>
      </div>
    </div>
    ${m.unpaidStudents?.length ? `
      <div style="padding:10px 16px;border-top:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:600">Нет оплаты 30+ дней</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${m.unpaidStudents.map(s => `<span class="b b-r" style="font-size:11px">${esc(s.name)}</span>`).join('')}
        </div>
      </div>
    ` : ''}
  </div>`;
}

function _renderWeekLessons(groups, lessons) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const ws = weekStart.toISOString().slice(0, 10);
  const we = weekEnd.toISOString().slice(0, 10);
  const weekLessons = lessons.filter(l => l.date >= ws && l.date <= we).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  if (!weekLessons.length) return '';
  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  return `
    <div style="margin-top:20px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Занятия на этой неделе</div>
      <div class="card" style="padding:0;overflow:hidden">
        ${weekLessons.map(l => {
          const grp = groups.find(g => g.id === l.group_id);
          const d = new Date(l.date + 'T00:00:00');
          const dayLabel = dayNames[d.getDay() === 0 ? 6 : d.getDay() - 1];
          const dateLabel = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
          const attendCount = l.attendance ? Object.values(l.attendance).filter(v => v).length : 0;
          return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">
            <div style="font-size:11px;font-weight:600;color:var(--accent-mid);min-width:32px">${dayLabel}</div>
            <div style="font-size:11px;color:var(--muted);min-width:36px">${dateLabel}</div>
            <div style="font-size:12px;font-weight:600;color:var(--accent-mid);min-width:40px">${l.time || '—'}</div>
            <div style="flex:1;font-size:13px">${grp?.name || '—'}</div>
            <div style="font-size:11px;color:var(--muted)">${attendCount} уч.</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function _renderHwBacklog(groups, hwSubmissions, hwAssignments) {
  const pending = hwSubmissions.filter(s => s.status === 'submitted');
  if (!pending.length) return '';
  const assignmentMap = Object.fromEntries(hwAssignments.map(a => [a.id, a]));
  const byGroup = {};
  for (const sub of pending) {
    const assignment = assignmentMap[sub.assignment_id];
    const groupId = assignment?.group_id || 'unknown';
    byGroup[groupId] = (byGroup[groupId] || 0) + 1;
  }
  const rows = Object.entries(byGroup).map(([gid, count]) => {
    const grp = groups.find(g => g.id === gid);
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border)">
      <div style="flex:1;font-size:13px">${grp?.name || 'Неизвестная группа'}</div>
      <span style="font-size:12px;font-weight:700;color:${count > 5 ? 'var(--red)' : 'var(--amber)'}">${count}</span>
      <div style="font-size:11px;color:var(--muted)">на проверке</div>
    </div>`;
  }).join('');
  return `
    <div style="margin-top:16px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">ДЗ на проверке по группам</div>
      <div class="card" style="padding:0;overflow:hidden">${rows}</div>
    </div>
  `;
}


export async function renderCuratorDashPage() {
  await ensureLoaded(['groups', 'students', 'lessons', 'homework_assignments', 'homework_submissions', 'payments', 'assistant_groups']);
  const el = document.getElementById('curator-dash-content');
  if (!el) return;

  // Use viewAsRole when owner is previewing a specific curator's view
  const role = effectiveRole();
  const assistantId = role.isOwner ? null : role.id;

  let groups = CACHE.groups || [];
  if (assistantId) {
    const myAG = (CACHE.assistant_groups || []).filter(ag => ag.assistant_id === assistantId);
    const groupIds = new Set(myAG.map(ag => ag.group_id));
    groups = groups.filter(g => groupIds.has(g.id));
  }

  if (!groups.length) {
    el.innerHTML = '<div class="empty">Нет назначенных групп</div>';
    return;
  }

  const metrics = groups.map(g => ({ group: g, m: calcGroupMetrics(g.id, assistantId) }));

  // Aggregate overall
  const total = {
    students: metrics.reduce((acc, x) => acc + x.m.students, 0),
    unchecked: metrics.reduce((acc, x) => acc + x.m.unchecked, 0),
    riskCount: metrics.reduce((acc, x) => acc + x.m.riskCount, 0),
  };
  const avgCompletion = metrics.length
    ? Math.round(metrics.reduce((acc, x) => acc + x.m.completionPct, 0) / metrics.length) : 0;
  const avgRetention = metrics.length
    ? Math.round(metrics.reduce((acc, x) => acc + x.m.retention, 0) / metrics.length) : 100;
  const checkMetrics = metrics.filter(x => x.m.avgCheckHours !== null);
  const avgCheckHours = checkMetrics.length
    ? Math.round(checkMetrics.reduce((acc, x) => acc + x.m.avgCheckHours, 0) / checkMetrics.length) : null;
  const avgAdvanced = metrics.filter(x => x.m.advancedSubs > 0).length
    ? Math.round(metrics.filter(x => x.m.advancedSubs > 0).reduce((acc, x) => acc + x.m.advancedPct, 0) / metrics.filter(x => x.m.advancedSubs > 0).length)
    : null;
  const trialGroups = metrics.filter(x => x.m.avgTrialScore !== null);
  const overallTrial = trialGroups.length
    ? Math.round(trialGroups.reduce((acc, x) => acc + x.m.avgTrialScore, 0) / trialGroups.length)
    : null;
  const growthGroups = metrics.filter(x => x.m.trialGrowth !== null);
  const overallGrowth = growthGroups.length
    ? Math.round(growthGroups.reduce((acc, x) => acc + x.m.trialGrowth, 0) / growthGroups.length)
    : null;

  const growthStr = overallGrowth !== null
    ? `<span style="color:${overallGrowth >= 0 ? 'var(--green)' : 'var(--red)'}">${overallGrowth >= 0 ? '▲' : '▼'} ${Math.abs(overallGrowth)}%</span>`
    : '—';

  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-p btn-sm" data-action="navigate" data-pg="homework"><i class="ti ti-list-check" style="margin-right:4px"></i>Очередь ДЗ ${total.unchecked > 0 ? `<span style="background:rgba(255,255,255,.2);border-radius:8px;padding:0 6px;margin-left:4px">${total.unchecked}</span>` : ''}</button>
      <button class="btn btn-sm" data-action="navigate" data-pg="lessons_cal"><i class="ti ti-calendar-plus" style="margin-right:4px"></i>Поставить консультацию</button>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Общая статистика</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
        ${statCard('ti-users', 'Учеников', total.students, `${groups.length} групп`, 'var(--accent-mid)')}
        ${statCard('ti-heart-rate-monitor', 'Retention', avgRetention + '%', 'Среднее по группам', avgRetention >= 90 ? 'var(--green)' : avgRetention >= 70 ? 'var(--amber)' : 'var(--red)')}
        ${statCard('ti-list-check', 'Непроверенных ДЗ', total.unchecked, 'Требуют проверки', total.unchecked > 0 ? 'var(--amber)' : 'var(--green)')}
        ${statCard('ti-clock', 'Время проверки ДЗ', avgCheckHours !== null ? avgCheckHours + ' ч' : '—', 'Среднее, цель ≤ 24 ч', avgCheckHours === null ? 'var(--muted)' : avgCheckHours <= 24 ? 'var(--green)' : avgCheckHours <= 48 ? 'var(--amber)' : 'var(--red)')}
        ${statCard('ti-percentage', 'Выполнение ДЗ', avgCompletion + '%', 'Среднее по группам', avgCompletion >= 80 ? 'var(--green)' : avgCompletion >= 50 ? 'var(--amber)' : 'var(--red)')}
        ${statCard('ti-star', 'Сложные ДЗ', avgAdvanced !== null ? avgAdvanced + '%' : '—', 'Среднее по группам', 'var(--accent-mid)')}
        ${statCard('ti-school', 'Средний балл (пробники)', overallTrial !== null ? overallTrial + ' / 100' : '—', overallGrowth !== null ? `Динамика: ${growthStr}` : 'Нет данных для сравнения', 'var(--accent-mid)')}
        ${statCard('ti-alert-triangle', 'Требуют внимания', total.riskCount, 'Риск ≥ 2 очков', total.riskCount > 0 ? 'var(--red)' : 'var(--green)')}
      </div>
    </div>

    <div style="font-size:12px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">По группам</div>
    ${metrics.map(({ group, m }) => groupCard(group, m)).join('')}

    ${_renderWeekLessons(groups, CACHE.lessons || [])}
    ${_renderHwBacklog(groups, CACHE.homework_submissions || [], CACHE.homework_assignments || [])}
  `;
}
