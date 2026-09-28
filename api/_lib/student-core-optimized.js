const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const botId = () => 'b' + crypto.randomUUID().replaceAll('-', '');

async function sbSelect(table, qs = '') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB });
  if (!response.ok) throw new Error(`sbSelect ${table}: ${await response.text()}`);
  return response.json();
}
async function sbOne(table, qs) {
  const rows = await sbSelect(table, `${qs}&limit=1`);
  return rows[0] ?? null;
}
async function sbInsert(table, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbInsert ${table}: ${await response.text()}`);
  return response.json();
}
async function sbPatch(table, qs, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbPatch ${table}: ${await response.text()}`);
  return response.json();
}

const moscowDate = iso => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
export const todayMoscow = () => moscowDate(new Date().toISOString());

export function humanDueDate(dueDate) {
  if (!dueDate) return 'без срока';
  const from = new Date(`${todayMoscow()}T12:00:00Z`);
  const to = new Date(`${dueDate}T12:00:00Z`);
  const days = Math.round((to - from) / 86400000);
  if (days < 0) return `просрочено на ${Math.abs(days)} дн.`;
  if (days === 0) return 'сегодня';
  if (days === 1) return 'до завтра';
  if (days <= 7) return `через ${days} дн.`;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(to);
}

export function formatDate(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: 'numeric', month: 'long',
  }).format(new Date(iso));
}

export function percentOf(submission, assignment) {
  if (submission?.score === null || submission?.score === undefined) return null;
  const maxScore = Number(submission.max_score) || (Array.isArray(assignment?.task_config)
    ? assignment.task_config.reduce((sum, value) => sum + Number(value || 0), 0) : 0);
  if (maxScore > 0) return Math.round(Number(submission.score) / maxScore * 100);
  const score = Number(submission.score);
  return Number.isFinite(score) ? Math.round(score) : null;
}

const normalizeAnswer = value => String(value ?? '').trim().toLowerCase().replace(',', '.');

export async function studentByToken(token) {
  const clean = String(token || '').trim().toLowerCase();
  if (!clean) return null;
  return sbOne('students', `reg_token=eq.${encodeURIComponent(clean)}&status=eq.active&select=id,name,group_id,status,target_score,vk_id,telegram_id,reg_token`);
}
export async function studentByTelegram(telegramId) {
  return sbOne('students', `telegram_id=eq.${encodeURIComponent(telegramId)}&status=eq.active&select=id,name,group_id,status,target_score,vk_id,telegram_id`);
}
export async function studentByVk(vkId) {
  return sbOne('students', `vk_id=eq.${encodeURIComponent(vkId)}&status=eq.active&select=id,name,group_id,status,target_score,vk_id,telegram_id`);
}

export async function linkStudentChannel(student, channel, externalId) {
  if (!student?.id || !['telegram', 'vk'].includes(channel)) return null;
  const field = channel === 'telegram' ? 'telegram_id' : 'vk_id';
  if (student[field] && String(student[field]) !== String(externalId)) return { ok: false, reason: 'already_linked' };
  if (!student[field]) {
    try {
      const rows = await sbPatch('students', `id=eq.${encodeURIComponent(student.id)}`, {
        [field]: externalId, updated_at: new Date().toISOString(),
      });
      student = rows[0] || { ...student, [field]: externalId };
    } catch (error) {
      if (/duplicate|unique|23505/i.test(String(error?.message || error))) return { ok: false, reason: 'external_id_in_use' };
      throw error;
    }
  }
  await assignActiveHomework(student);
  return { ok: true, student: { ...student, [field]: externalId } };
}

// Compatibility shim for adapters. Canonical data is no longer rewritten on every click.
export async function canonicalizeStudent(student) { return student; }

export async function assignActiveHomework(student) {
  if (!student?.id || !student?.group_id) return 0;
  const assignments = await sbSelect('homework_assignments', `group_id=eq.${encodeURIComponent(student.group_id)}&archived_at=is.null&select=id`);
  if (!assignments.length) return 0;
  const ids = assignments.map(row => row.id);
  const existing = await sbSelect('homework_submissions', `student_id=eq.${encodeURIComponent(student.id)}&assignment_id=in.(${ids.join(',')})&select=assignment_id`);
  const existingIds = new Set(existing.map(row => row.assignment_id));
  const missing = assignments.filter(row => !existingIds.has(row.id));
  let created = 0;
  for (const assignment of missing) {
    try {
      await sbInsert('homework_submissions', {
        id: botId(), assignment_id: assignment.id, student_id: student.id,
        status: 'assigned', source: 'system', submitted_at: null, score: null, comment: '',
      });
      created += 1;
    } catch (error) {
      if (!/duplicate key|23505/i.test(String(error?.message || error))) throw error;
    }
  }
  return created;
}

export async function homeworkOverview(student) {
  const submissions = await sbSelect('homework_submissions', `student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,submitted)&select=id,assignment_id,status,submitted_at`);
  if (!submissions.length) return { todo: [], review: [] };
  const ids = [...new Set(submissions.map(row => row.assignment_id))];
  const assignments = await sbSelect('homework_assignments', `id=in.(${ids.join(',')})&archived_at=is.null&select=id,topic,due_date,hw_type,assigned_at,file_id,telegram_file_id,material_name,lesson_id`);
  const assignmentMap = new Map(assignments.map(row => [row.id, row]));
  const rows = submissions.map(submission => ({ submission, assignment: assignmentMap.get(submission.assignment_id) })).filter(row => row.assignment);
  const todo = rows.filter(row => row.submission.status === 'assigned').sort((a, b) => {
    const l = a.assignment.due_date || '9999-12-31';
    const r = b.assignment.due_date || '9999-12-31';
    return l.localeCompare(r) || String(b.assignment.assigned_at || '').localeCompare(String(a.assignment.assigned_at || ''));
  });
  const review = rows.filter(row => row.submission.status === 'submitted').sort((a, b) => String(b.submission.submitted_at || '').localeCompare(String(a.submission.submitted_at || '')));
  return { todo, review };
}

export async function submissionCard(student, submissionId) {
  const submission = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(submissionId)}&student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,submitted,checked)`);
  if (!submission) return null;
  const assignment = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(submission.assignment_id)}&archived_at=is.null`);
  return assignment ? { submission, assignment } : null;
}

export async function homeworkMaterial(student, assignmentId) {
  return sbOne('homework_assignments', `id=eq.${encodeURIComponent(assignmentId)}&group_id=eq.${encodeURIComponent(student.group_id)}&archived_at=is.null&select=id,topic,file_id,telegram_file_id,material_name`);
}

export async function beginBrief(student, submissionId) {
  const row = await submissionCard(student, submissionId);
  if (!row || row.submission.status !== 'assigned') return null;
  const answers = Array.isArray(row.assignment.answers) ? row.assignment.answers.map(String) : [];
  return answers.length ? { ...row, answers } : null;
}

export async function finalizeBrief(student, submissionId, given, source) {
  const submission = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(submissionId)}&student_id=eq.${encodeURIComponent(student.id)}&status=eq.assigned`);
  if (!submission) return null;
  const assignment = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(submission.assignment_id)}&archived_at=is.null`);
  if (!assignment) return null;
  const correct = Array.isArray(assignment.answers) ? assignment.answers : [];
  if (!correct.length || given.length !== correct.length) return null;
  const results = correct.map((answer, index) => normalizeAnswer(given[index]) === normalizeAnswer(answer));
  const score = results.filter(Boolean).length;
  const maxScore = correct.length;
  const now = new Date().toISOString();
  const onTime = assignment.due_date ? moscowDate(now) <= assignment.due_date : null;
  const updated = await sbPatch('homework_submissions', `id=eq.${encodeURIComponent(submissionId)}&student_id=eq.${encodeURIComponent(student.id)}&status=eq.assigned`, {
    status: 'checked', submitted_at: now, checked_at: now, score, max_score: maxScore,
    student_answers: given, task_scores: results.map(ok => ok ? 1 : 0),
    comment: `${score}/${maxScore} верно`, source, on_time: onTime,
  });
  return updated.length ? { submission: updated[0], assignment, correct, given, results, score, maxScore } : null;
}

export async function finalizeFiles(student, submissionId, files, source) {
  if (!Array.isArray(files) || !files.length) return null;
  const submission = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(submissionId)}&student_id=eq.${encodeURIComponent(student.id)}&status=eq.assigned`);
  if (!submission) return null;
  const assignment = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(submission.assignment_id)}&archived_at=is.null`);
  if (!assignment) return null;
  const now = new Date().toISOString();
  const onTime = assignment.due_date ? moscowDate(now) <= assignment.due_date : null;
  const updated = await sbPatch('homework_submissions', `id=eq.${encodeURIComponent(submissionId)}&student_id=eq.${encodeURIComponent(student.id)}&status=eq.assigned`, {
    status: 'submitted', submitted_at: now, submitted_files: files, source, on_time: onTime,
  });
  return updated.length ? { submission: updated[0], assignment } : null;
}

export async function resultsOverview(student) {
  const all = await sbSelect('homework_submissions', `student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,submitted,checked)&order=submitted_at.desc.nullslast&select=id,assignment_id,status,score,max_score,submitted_at,checked_at,on_time,student_answers,comment`);
  const ids = [...new Set(all.map(row => row.assignment_id))];
  const assignments = ids.length ? await sbSelect('homework_assignments', `id=in.(${ids.join(',')})&select=id,topic,due_date,hw_type,task_config,lesson_id,archived_at`) : [];
  const assignmentMap = new Map(assignments.map(row => [row.id, row]));
  const visible = all.filter(row => !assignmentMap.get(row.assignment_id)?.archived_at || row.status === 'checked');
  const checked = visible.filter(row => row.status === 'checked').sort((a, b) => String(b.checked_at || '').localeCompare(String(a.checked_at || '')));
  const scored = checked.map(row => ({ row, assignment: assignmentMap.get(row.assignment_id), pct: percentOf(row, assignmentMap.get(row.assignment_id)) })).filter(item => Number.isFinite(item.pct));
  const recent = scored.slice(0, 3).map(item => item.pct);
  const previous = scored.slice(3, 6).map(item => item.pct);
  const avg = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const trend = recent.length >= 2 && previous.length >= 2 ? Math.round(avg(recent) - avg(previous)) : null;
  const lastTrial = scored.find(item => item.assignment?.hw_type === 'trial') || null;
  const relevant = visible.filter(row => ['assigned', 'submitted', 'checked'].includes(row.status));
  return {
    total: relevant.length,
    completed: relevant.filter(row => ['submitted', 'checked'].includes(row.status)).length,
    recentAverage: recent.length ? Math.round(avg(recent)) : null,
    trend, lastTrial,
    rows: checked.slice(0, 15).map(row => ({ submission: row, assignment: assignmentMap.get(row.assignment_id) })).filter(row => row.assignment),
  };
}

export async function resultDetail(student, submissionId) {
  const submission = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(submissionId)}&student_id=eq.${encodeURIComponent(student.id)}&status=eq.checked`);
  if (!submission) return null;
  const assignment = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(submission.assignment_id)}&select=id,topic,description,due_date,hw_type,task_config,lesson_id`);
  return assignment ? { submission, assignment, percent: percentOf(submission, assignment) } : null;
}

export async function lessonsOverview(student) {
  const lessons = await sbSelect('lessons', `group_id=eq.${encodeURIComponent(student.group_id)}&active=eq.true&order=sequence.desc&limit=30&select=id,lesson_number,sequence,topic,scheduled_date,created_at`);
  if (!lessons.length) return [];
  const ids = lessons.map(row => row.id);
  const [materials, assignments] = await Promise.all([
    sbSelect('lesson_materials', `lesson_id=in.(${ids.join(',')})&select=id,lesson_id,material_type`),
    sbSelect('homework_assignments', `lesson_id=in.(${ids.join(',')})&archived_at=is.null&select=id,lesson_id`),
  ]);
  const materialByLesson = new Map();
  for (const material of materials) {
    const bucket = materialByLesson.get(material.lesson_id) || []; bucket.push(material); materialByLesson.set(material.lesson_id, bucket);
  }
  const assignmentCount = new Map();
  for (const assignment of assignments) assignmentCount.set(assignment.lesson_id, (assignmentCount.get(assignment.lesson_id) || 0) + 1);
  return lessons.map(lesson => ({ ...lesson, materials: materialByLesson.get(lesson.id) || [], homework_count: assignmentCount.get(lesson.id) || 0 }))
    .filter(lesson => lesson.materials.length || lesson.homework_count);
}

export async function lessonDetail(student, lessonId) {
  const lesson = await sbOne('lessons', `id=eq.${encodeURIComponent(lessonId)}&group_id=eq.${encodeURIComponent(student.group_id)}&active=eq.true`);
  if (!lesson) return null;
  const [materials, assignments] = await Promise.all([
    sbSelect('lesson_materials', `lesson_id=eq.${encodeURIComponent(lesson.id)}&order=created_at.asc`),
    sbSelect('homework_assignments', `lesson_id=eq.${encodeURIComponent(lesson.id)}&archived_at=is.null&select=id,topic,due_date,hw_type`),
  ]);
  let homework = [];
  if (assignments.length) {
    const ids = assignments.map(row => row.id);
    const submissions = await sbSelect('homework_submissions', `student_id=eq.${encodeURIComponent(student.id)}&assignment_id=in.(${ids.join(',')})&status=in.(assigned,submitted,checked)&select=id,assignment_id,status`);
    const map = new Map(submissions.map(row => [row.assignment_id, row]));
    homework = assignments.map(assignment => ({ assignment, submission: map.get(assignment.id) || null }));
  }
  return { lesson, materials, homework };
}

export async function lessonMaterial(student, materialId) {
  return sbOne('lesson_materials', `id=eq.${encodeURIComponent(materialId)}&group_id=eq.${encodeURIComponent(student.group_id)}`);
}
export async function patchLessonMaterial(materialId, changes) {
  const rows = await sbPatch('lesson_materials', `id=eq.${encodeURIComponent(materialId)}`, changes);
  return rows[0] ?? null;
}
export async function patchHomeworkAssignment(assignmentId, changes) {
  const rows = await sbPatch('homework_assignments', `id=eq.${encodeURIComponent(assignmentId)}`, changes);
  return rows[0] ?? null;
}
