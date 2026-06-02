import { CACHE, ensureLoaded } from '../core/store.js';
import { state } from '../core/state.js';
import { db } from '../lib/db.js';
import { calcRiskScore } from '../core/risk.js';

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

  return {
    students: students.length,
    leftCount,
    totalEver: allStudents.length,
    unchecked,
    completionPct,
    advancedPct,
    advancedSubs: advancedSubs.length,
    avgTrialScore,
    trialGrowth,
    riskCount,
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
  const retentionLabel = m.totalEver
    ? `${m.students} активных / ${m.totalEver} всего (ушло: ${m.leftCount})`
    : '—';
  const trialLabel = m.avgTrialScore !== null
    ? `${m.avgTrialScore} / 100${m.trialGrowth !== null ? ` <span style="color:${m.trialGrowth >= 0 ? 'var(--green)' : 'var(--red)'}">` +
      (m.trialGrowth >= 0 ? '▲' : '▼') + ` ${Math.abs(m.trialGrowth)}%</span>` : ''}`
    : '—';

  const completionColor = m.completionPct >= 80 ? 'var(--green)' : m.completionPct >= 50 ? 'var(--amber)' : 'var(--red)';

  return `<div class="card" style="padding:0;margin-bottom:12px;overflow:hidden">
    <div style="padding:12px 16px;background:var(--surface2);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:700">${group.name}</div>
      ${m.riskCount > 0 ? `<span class="b b-r"><i class="ti ti-alert-triangle"></i> ${m.riskCount} требуют внимания</span>` : `<span class="b b-g">Всё в порядке</span>`}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0;padding:0">
      <div style="padding:12px 16px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted)">Учеников</div>
        <div style="font-size:18px;font-weight:700">${m.students}</div>
        <div style="font-size:11px;color:var(--hint)">${retentionLabel}</div>
      </div>
      <div style="padding:12px 16px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted)">Непроверенных ДЗ</div>
        <div style="font-size:18px;font-weight:700;color:${m.unchecked > 0 ? 'var(--amber)' : 'var(--green)'}">${m.unchecked}</div>
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

function _renderLessonCompletionRate(groups, lessons) {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = now.toISOString().slice(0, 10);
  const monthLessons = lessons.filter(l => l.date >= monthStart && l.date <= monthEnd);
  if (!monthLessons.length) return '';
  const total = monthLessons.length;
  const withAttendance = monthLessons.filter(l => l.attendance && Object.values(l.attendance).some(v => v)).length;
  const rate = total ? Math.round(withAttendance / total * 100) : 0;
  const color = rate >= 80 ? 'var(--green)' : rate >= 50 ? 'var(--amber)' : 'var(--red)';
  return `
    <div style="margin-top:16px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Посещаемость в этом месяце</div>
      <div class="card" style="padding:14px 16px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <div style="flex:1;font-size:13px">Занятий с отметками посещаемости</div>
          <div style="font-size:18px;font-weight:700;color:${color}">${rate}%</div>
          <div style="font-size:11px;color:var(--muted)">${withAttendance} / ${total}</div>
        </div>
        <div class="prog" style="height:6px"><div class="prog-f" style="width:${rate}%;background:${color}"></div></div>
      </div>
    </div>
  `;
}

export async function renderCuratorDashPage() {
  await ensureLoaded(['groups', 'students', 'lessons', 'homework_assignments', 'homework_submissions', 'payments']);
  const el = document.getElementById('curator-dash-content');
  if (!el) return;

  const role = state.currentRole || {};
  const assistantId = role.isOwner ? null : role.id;

  let groups = CACHE.groups || [];
  if (!role.isOwner && assistantId) {
    const myGroups = await db.assistantGroups.getGroupsByAssistant(assistantId);
    const groupIds = new Set(myGroups.map(ag => ag.group_id));
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
  const allRegularSubs = metrics.reduce((acc, x) => acc + x.m.completionPct, 0);
  const avgCompletion = metrics.length ? Math.round(allRegularSubs / metrics.length) : 0;
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
    <div style="margin-bottom:16px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Общая статистика</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
        ${statCard('ti-users', 'Учеников', total.students, `${groups.length} групп`, 'var(--accent-mid)')}
        ${statCard('ti-list-check', 'Непроверенных ДЗ', total.unchecked, 'Требуют проверки', total.unchecked > 0 ? 'var(--amber)' : 'var(--green)')}
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
    ${_renderLessonCompletionRate(groups, CACHE.lessons || [])}
  `;
}
