// Provides a compact, read-only snapshot for the private Google Sheets dashboard.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNC_SECRET = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;

const SB_HEADERS = {
  'apikey': SUPABASE_SECRET_KEY,
  'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
};

const PAGE_SIZE = 1000;

async function sbAll(table, query) {
  const allRows = [];
  for (let offset = 0; offset < 20000; offset += PAGE_SIZE) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        ...SB_HEADERS,
        'Range': `${offset}-${offset + PAGE_SIZE - 1}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Supabase ${table}: ${response.status} ${await response.text()}`);
    }
    const rows = await response.json();
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) return allRows;
  }
  throw new Error(`Supabase ${table}: export limit exceeded`);
}

const groupTypeLabel = groupType => groupType === 'individual' ? 'Индивидуально' : 'Мини-группа';
const groupStatusLabel = active => active ? 'Активна' : 'Остановлена';
const studentStatusLabel = status => ({
  active: 'Активен', paused: 'Пауза', left: 'Ушёл',
}[status] || status || '—');
const submissionStatusLabel = status => ({
  assigned: 'Не сдано', submitted: 'Сдано', checked: 'Проверено', revision: 'На доработке',
  cancelled: 'Отменено (ДЗ в архиве)',
}[status] || status || '—');
const homeworkTypeLabel = type => ({
  brief: 'Краткий ответ', detailed: 'Подробное решение', trial: 'Пробник',
}[type] || type || '—');

const ratio = (score, maxScore) => {
  const scoreNumber = Number(score);
  const maxNumber = Number(maxScore);
  return Number.isFinite(scoreNumber) && Number.isFinite(maxNumber) && maxNumber > 0
    ? scoreNumber / maxNumber
    : null;
};

const average = values => {
  const clean = values.filter(value => Number.isFinite(value));
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};

const onTimeRate = rows => {
  const known = rows.filter(row => typeof row.on_time === 'boolean');
  return known.length ? known.filter(row => row.on_time).length / known.length : null;
};

const submitted = row => !['assigned', 'cancelled'].includes(row.status);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SYNC_SECRET || req.headers['x-tutoros-sync-secret'] !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [rawGroups, rawStudents, rawLessons, rawAssignments, rawSubmissions] = await Promise.all([
      sbAll('groups', 'select=id,name,group_type,active,created_at'),
      sbAll('students', 'select=id,name,group_id,status,created_at'),
      sbAll('lessons', 'select=id,group_id,lesson_number,topic,event_type'),
      sbAll('homework_assignments', 'select=id,group_id,lesson_id,topic,due_date,hw_type,is_advanced,assigned_at,archived_at'),
      sbAll('homework_submissions', 'select=id,assignment_id,student_id,status,submitted_at,checked_at,score,max_score,on_time,comment'),
    ]);

    const groups = rawGroups;
    const groupMap = new Map(groups.map(group => [group.id, group]));
    const students = rawStudents.filter(student => groupMap.has(student.group_id));
    const studentMap = new Map(students.map(student => [student.id, student]));
    const lessonMap = new Map(
      rawLessons.filter(lesson => groupMap.has(lesson.group_id)).map(lesson => [lesson.id, lesson])
    );
    const assignments = rawAssignments.filter(assignment => groupMap.has(assignment.group_id));
    const activeAssignments = assignments.filter(assignment => !assignment.archived_at);
    const assignmentMap = new Map(assignments.map(assignment => [assignment.id, assignment]));
    const submissions = rawSubmissions.filter(submission =>
      assignmentMap.has(submission.assignment_id) && studentMap.has(submission.student_id)
    );

    const submissionsFor = (field, id) => submissions.filter(row => row[field] === id);

    const groupRows = groups.map(group => {
      const groupStudents = students.filter(student =>
        student.group_id === group.id && student.status === 'active'
      );
      const groupAssignments = activeAssignments.filter(assignment => assignment.group_id === group.id);
      const groupSubmissions = groupAssignments.flatMap(assignment =>
        submissionsFor('assignment_id', assignment.id)
      );
      return {
        group: group.name,
        format: groupTypeLabel(group.group_type),
        students: groupStudents.length,
        assignments: groupAssignments.length,
        submitted: groupSubmissions.filter(submitted).length,
        average_score: average(groupSubmissions.map(row => ratio(row.score, row.max_score))),
        on_time_rate: onTimeRate(groupSubmissions),
        status: groupStatusLabel(group.active),
      };
    }).sort((a, b) => a.group.localeCompare(b.group, 'ru'));

    const studentRows = students.map(student => {
      const group = groupMap.get(student.group_id);
      const studentSubmissions = submissionsFor('student_id', student.id)
        .filter(row => !assignmentMap.get(row.assignment_id)?.archived_at);
      return {
        student: student.name,
        group: group?.name || '—',
        format: groupTypeLabel(group?.group_type),
        status: studentStatusLabel(student.status),
        assigned: studentSubmissions.length,
        submitted: studentSubmissions.filter(submitted).length,
        checked: studentSubmissions.filter(row => row.status === 'checked').length,
        average_score: average(studentSubmissions.map(row => ratio(row.score, row.max_score))),
        on_time_rate: onTimeRate(studentSubmissions),
      };
    }).sort((a, b) =>
      a.group.localeCompare(b.group, 'ru') || a.student.localeCompare(b.student, 'ru')
    );

    const assignmentRows = assignments.map(assignment => {
      const group = groupMap.get(assignment.group_id);
      const lesson = lessonMap.get(assignment.lesson_id);
      const assignmentSubmissions = submissionsFor('assignment_id', assignment.id);
      return {
        assigned_at: assignment.assigned_at,
        group: group?.name || '—',
        lesson: lesson?.lesson_number || '—',
        topic: assignment.topic,
        type: homeworkTypeLabel(assignment.hw_type),
        level: assignment.is_advanced ? 'Продвинутый' : 'Основной',
        state: assignment.archived_at ? 'Архив' : 'Активно',
        due_date: assignment.due_date,
        students: assignmentSubmissions.length,
        submitted: assignmentSubmissions.filter(submitted).length,
        checked: assignmentSubmissions.filter(row => row.status === 'checked').length,
        average_score: average(assignmentSubmissions.map(row => ratio(row.score, row.max_score))),
      };
    }).sort((a, b) => String(b.assigned_at).localeCompare(String(a.assigned_at)));

    const resultRows = submissions.map(submission => {
      const assignment = assignmentMap.get(submission.assignment_id);
      const group = groupMap.get(assignment?.group_id);
      const student = studentMap.get(submission.student_id);
      const lesson = lessonMap.get(assignment?.lesson_id);
      return {
        assigned_at: assignment?.assigned_at || null,
        due_date: assignment?.due_date || null,
        group: group?.name || '—',
        student: student?.name || '—',
        lesson: lesson?.lesson_number || '—',
        topic: assignment?.topic || '—',
        assignment_state: assignment?.archived_at ? 'Архив' : 'Активно',
        status: submissionStatusLabel(submission.status),
        submitted_at: submission.submitted_at,
        checked_at: submission.checked_at,
        score: submission.score,
        max_score: submission.max_score,
        result: ratio(submission.score, submission.max_score),
        on_time: submission.on_time === true ? 'Да' : submission.on_time === false ? 'Нет' : '—',
        comment: submission.comment || '',
      };
    }).sort((a, b) =>
      String(b.assigned_at).localeCompare(String(a.assigned_at)) ||
      a.group.localeCompare(b.group, 'ru') ||
      a.student.localeCompare(b.student, 'ru')
    );

    return res.status(200).json({
      ok: true,
      updated_at: new Date().toISOString(),
      overview: {
        active_groups: groups.filter(group => group.active).length,
        active_mini_groups: groups.filter(group => group.active && group.group_type !== 'individual').length,
        active_individuals: groups.filter(group => group.active && group.group_type === 'individual').length,
        active_students: students.filter(student => student.status === 'active').length,
        assignments: activeAssignments.length,
        checked: submissions.filter(row => row.status === 'checked' && !assignmentMap.get(row.assignment_id)?.archived_at).length,
        average_score: average(submissions
          .filter(row => !assignmentMap.get(row.assignment_id)?.archived_at)
          .map(row => ratio(row.score, row.max_score))),
        on_time_rate: onTimeRate(submissions.filter(row => !assignmentMap.get(row.assignment_id)?.archived_at)),
      },
      groups: groupRows,
      students: studentRows,
      assignments: assignmentRows,
      results: resultRows,
    });
  } catch (error) {
    console.error(`Stats export failed: ${error.message}`);
    return res.status(500).json({ error: 'Statistics export failed' });
  }
}
