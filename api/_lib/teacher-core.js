import { resultsOverview, todayMoscow } from './student-core.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const botId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const tokenId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

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
async function sbRpc(fn, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: SB, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbRpc ${fn}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function unlinkStudentEverywhere(studentId) {
  const rows = await sbPatch('students', `id=eq.${encodeURIComponent(studentId)}&status=eq.active`, {
    telegram_id: null,
    vk_id: null,
    updated_at: new Date().toISOString(),
  });
  return rows[0] ?? null;
}

export async function listTeacherGroups() {
  return sbSelect('groups', 'active=eq.true&order=name.asc&select=id,name,group_type,target_score,created_at');
}

export async function groupAdminView(groupId) {
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true`);
  if (!group) return null;
  const [students, assignments, lessons] = await Promise.all([
    sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&order=name.asc&select=id,name,group_id,target_score,telegram_id,vk_id,reg_token`),
    sbSelect('homework_assignments', `group_id=eq.${encodeURIComponent(groupId)}&archived_at=is.null&order=assigned_at.desc&select=id,topic,due_date,hw_type,assigned_at,lesson_id`),
    sbSelect('lessons', `group_id=eq.${encodeURIComponent(groupId)}&active=eq.true&order=sequence.desc&limit=30&select=id,topic,scheduled_date,sequence,lesson_number,created_at`),
  ]);
  const assignmentIds = assignments.map(a => a.id);
  const submissions = assignmentIds.length
    ? await sbSelect('homework_submissions', `assignment_id=in.(${assignmentIds.join(',')})&status=not.eq.cancelled&select=id,assignment_id,student_id,status,score,max_score,submitted_at,checked_at`)
    : [];
  const pending = submissions.filter(s => s.status === 'submitted').length;
  const overdue = submissions.filter(s => s.status === 'assigned' && assignments.find(a => a.id === s.assignment_id)?.due_date && assignments.find(a => a.id === s.assignment_id).due_date < todayMoscow()).length;
  return { group, students, assignments, lessons, submissions, pending, overdue };
}

export async function listGroupStudentsAdmin(groupId) {
  return sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&order=name.asc&select=id,name,group_id,target_score,telegram_id,vk_id,reg_token`);
}

export async function studentAdminView(studentId) {
  const student = await sbOne('students', `id=eq.${encodeURIComponent(studentId)}&status=eq.active&select=id,name,group_id,target_score,telegram_id,vk_id,reg_token,status`);
  if (!student) return null;
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(student.group_id)}&select=id,name,group_type`);
  const results = await resultsOverview(student);
  return { student, group, results };
}

export async function rotateStudentToken(studentId) {
  const rows = await sbPatch('students', `id=eq.${encodeURIComponent(studentId)}&status=eq.active`, {
    reg_token: tokenId(),
    updated_at: new Date().toISOString(),
  });
  return rows[0] ?? null;
}

export async function archiveStudent(studentId) {
  const student = await sbOne('students', `id=eq.${encodeURIComponent(studentId)}&status=eq.active`);
  if (!student) return null;
  await sbPatch('students', `id=eq.${encodeURIComponent(studentId)}`, {
    status: 'left', telegram_id: null, vk_id: null, updated_at: new Date().toISOString(),
  });
  await sbPatch('homework_submissions', `student_id=eq.${encodeURIComponent(studentId)}&status=eq.assigned`, { status: 'cancelled' });
  return student;
}

export async function archiveGroup(groupId) {
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true`);
  if (!group) return null;
  await sbPatch('groups', `id=eq.${encodeURIComponent(groupId)}`, { active: false, updated_at: new Date().toISOString() });
  return group;
}

export async function createGroupAdmin(name, groupType = 'mini_group') {
  const now = new Date().toISOString();
  const rows = await sbInsert('groups', {
    id: botId(),
    name: String(name || '').trim(),
    group_type: groupType,
    sheet_key: null,
    active: true,
    created_at: now,
    updated_at: now,
  });
  return rows[0] ?? null;
}

export async function createStudentAdmin(groupId, name, targetScore = null) {
  const now = new Date().toISOString();
  const rows = await sbInsert('students', {
    id: botId(),
    name: String(name || '').trim(),
    group_id: groupId,
    status: 'active',
    ...(targetScore ? { target_score: targetScore } : {}),
    created_at: now,
    updated_at: now,
  });
  return rows[0] ?? null;
}

export async function listGroupHomeworkAdmin(groupId) {
  const assignments = await sbSelect('homework_assignments', `group_id=eq.${encodeURIComponent(groupId)}&archived_at=is.null&order=assigned_at.desc&select=id,group_id,lesson_id,topic,due_date,hw_type,assigned_at,task_config,answers`);
  if (!assignments.length) return [];
  const ids = assignments.map(a => a.id);
  const submissions = await sbSelect('homework_submissions', `assignment_id=in.(${ids.join(',')})&status=not.eq.cancelled&select=id,assignment_id,status,student_id,score,max_score`);
  return assignments.map(assignment => {
    const rows = submissions.filter(s => s.assignment_id === assignment.id);
    return {
      assignment,
      total: rows.length,
      submitted: rows.filter(s => ['submitted', 'checked'].includes(s.status)).length,
      pending: rows.filter(s => s.status === 'submitted').length,
      checked: rows.filter(s => s.status === 'checked').length,
      overdue: rows.filter(s => s.status === 'assigned').filter(() => assignment.due_date && assignment.due_date < todayMoscow()).length,
    };
  });
}

export async function listGroupLessonsAdmin(groupId) {
  const lessons = await sbSelect('lessons', `group_id=eq.${encodeURIComponent(groupId)}&active=eq.true&order=sequence.desc&limit=30&select=id,group_id,topic,scheduled_date,sequence,lesson_number,created_at`);
  if (!lessons.length) return [];
  const ids = lessons.map(l => l.id);
  const [materials, homework] = await Promise.all([
    sbSelect('lesson_materials', `lesson_id=in.(${ids.join(',')})&select=id,lesson_id,material_type,title,external_url,telegram_file_id,vk_attachment,file_name`),
    sbSelect('homework_assignments', `lesson_id=in.(${ids.join(',')})&archived_at=is.null&select=id,lesson_id,topic,due_date,hw_type`),
  ]);
  return lessons.map(lesson => ({
    lesson,
    materials: materials.filter(m => m.lesson_id === lesson.id),
    homework: homework.filter(h => h.lesson_id === lesson.id),
  }));
}

export async function lessonAdminView(groupId, lessonId) {
  const lesson = await sbOne('lessons', `id=eq.${encodeURIComponent(lessonId)}&group_id=eq.${encodeURIComponent(groupId)}&active=eq.true`);
  if (!lesson) return null;
  const [materials, homework] = await Promise.all([
    sbSelect('lesson_materials', `lesson_id=eq.${encodeURIComponent(lessonId)}&order=created_at.asc`),
    sbSelect('homework_assignments', `lesson_id=eq.${encodeURIComponent(lessonId)}&archived_at=is.null&order=assigned_at.desc`),
  ]);
  return { lesson, materials, homework };
}

export async function ensureTeacherLesson(groupId, topic = '') {
  const today = todayMoscow();
  const current = await sbOne('lessons', `group_id=eq.${encodeURIComponent(groupId)}&active=eq.true&order=sequence.desc&select=id,topic,scheduled_date,created_at,sequence`);
  const currentDate = current?.scheduled_date || (current?.created_at ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date(current.created_at)) : null);
  if (current && currentDate === today) return current.id;
  const sequence = Math.max(0, Number(current?.sequence) || 0) + 1;
  const id = botId();
  const now = new Date().toISOString();
  await sbInsert('lessons', {
    id,
    group_id: groupId,
    sheet_lesson_key: `manual:${id}`,
    lesson_number: String(sequence),
    sequence,
    topic: topic || `Занятие ${today}`,
    event_type: 'lesson',
    scheduled_date: today,
    active: true,
    created_at: now,
    updated_at: now,
  });
  return id;
}

export async function createHomeworkAdmin(data) {
  const assignmentId = botId();
  const lessonId = data.lesson_id || await ensureTeacherLesson(data.group_id, data.topic);
  await sbRpc('create_homework_for_group', {
    p_assignment_id: assignmentId,
    p_group_id: data.group_id,
    p_lesson_id: lessonId,
    p_topic: data.topic,
    p_due_date: data.due_date || null,
    p_hw_type: data.hw_type,
    p_is_advanced: data.hw_type === 'detailed_hard',
    p_file_id: data.file_id || null,
    p_answers: Array.isArray(data.answers) ? data.answers : null,
    p_task_config: Array.isArray(data.task_config) ? data.task_config : null,
  });
  const rows = await sbPatch('homework_assignments', `id=eq.${encodeURIComponent(assignmentId)}`, {
    telegram_file_id: data.telegram_file_id || null,
    material_name: data.material_name || null,
  });
  const assignment = rows[0] || await sbOne('homework_assignments', `id=eq.${encodeURIComponent(assignmentId)}`);
  const [students, submissions] = await Promise.all([
    sbSelect('students', `group_id=eq.${encodeURIComponent(data.group_id)}&status=eq.active&select=id,name,telegram_id,vk_id`),
    sbSelect('homework_submissions', `assignment_id=eq.${encodeURIComponent(assignmentId)}&select=id,student_id,status`),
  ]);
  return { assignment, students, submissions, lessonId };
}

export async function addLessonMaterialAdmin(data) {
  const id = botId();
  const lessonId = data.lesson_id || await ensureTeacherLesson(data.group_id);
  const rows = await sbInsert('lesson_materials', {
    id,
    group_id: data.group_id,
    lesson_id: lessonId,
    material_type: data.material_type,
    title: data.title,
    external_url: data.external_url || null,
    telegram_file_id: data.telegram_file_id || null,
    vk_attachment: data.vk_attachment || null,
    file_name: data.file_name || null,
    created_at: new Date().toISOString(),
  });
  const students = await sbSelect('students', `group_id=eq.${encodeURIComponent(data.group_id)}&status=eq.active&select=id,name,telegram_id,vk_id`);
  return { material: rows[0], students };
}

export async function listUncheckedAdmin() {
  const submissions = await sbSelect('homework_submissions', 'status=eq.submitted&order=submitted_at.asc&limit=50&select=id,assignment_id,student_id,submitted_at,submitted_files,source');
  if (!submissions.length) return [];
  const studentIds = [...new Set(submissions.map(s => s.student_id))];
  const assignmentIds = [...new Set(submissions.map(s => s.assignment_id))];
  const [students, assignments] = await Promise.all([
    sbSelect('students', `id=in.(${studentIds.join(',')})&select=id,name,group_id,telegram_id,vk_id`),
    sbSelect('homework_assignments', `id=in.(${assignmentIds.join(',')})&select=id,topic,group_id,due_date,hw_type,task_config`),
  ]);
  const sm = new Map(students.map(s => [s.id, s]));
  const am = new Map(assignments.map(a => [a.id, a]));
  return submissions.map(submission => ({ submission, student: sm.get(submission.student_id), assignment: am.get(submission.assignment_id) })).filter(x => x.student && x.assignment);
}

export async function uncheckedAdminView(submissionId) {
  const submission = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(submissionId)}&status=eq.submitted`);
  if (!submission) return null;
  const [student, assignment] = await Promise.all([
    sbOne('students', `id=eq.${encodeURIComponent(submission.student_id)}&select=id,name,group_id,telegram_id,vk_id`),
    sbOne('homework_assignments', `id=eq.${encodeURIComponent(submission.assignment_id)}&select=id,topic,group_id,due_date,hw_type,task_config`),
  ]);
  if (!student || !assignment) return null;
  return { submission, student, assignment };
}

export async function finalizeReviewAdmin(submissionId, score, maxScore, comment = '') {
  const rows = await sbPatch('homework_submissions', `id=eq.${encodeURIComponent(submissionId)}&status=eq.submitted`, {
    status: 'checked',
    checked_at: new Date().toISOString(),
    score: Number(score),
    max_score: Number(maxScore),
    comment: String(comment || '').trim(),
  });
  return rows[0] ?? null;
}

export async function teacherAnalytics() {
  const [groups, students, assignments, pending, checked] = await Promise.all([
    sbSelect('groups', 'active=eq.true&select=id'),
    sbSelect('students', 'status=eq.active&select=id'),
    sbSelect('homework_assignments', 'archived_at=is.null&select=id'),
    sbSelect('homework_submissions', 'status=eq.submitted&select=id'),
    sbSelect('homework_submissions', 'status=eq.checked&order=checked_at.desc&limit=100&select=score,max_score'),
  ]);
  const percentages = checked.map(row => {
    const score = Number(row.score); const max = Number(row.max_score);
    return Number.isFinite(score) && Number.isFinite(max) && max > 0 ? score / max * 100 : null;
  }).filter(Number.isFinite);
  const average = percentages.length ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length) : null;
  return {
    groups: groups.length,
    students: students.length,
    activeHomework: assignments.length,
    unchecked: pending.length,
    checked: checked.length,
    average,
  };
}
