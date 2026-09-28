import { resultsOverview, todayMoscow } from './student-core.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const botId = () => 'b' + crypto.randomUUID().replaceAll('-', '');
const tokenId = () => 'r' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);

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
async function sbDelete(table, qs) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'DELETE', headers: { ...SB, Prefer: 'return=minimal' },
  });
  if (!response.ok) throw new Error(`sbDelete ${table}: ${await response.text()}`);
}
async function sbRpc(fn, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: SB, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbRpc ${fn}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function clearStudentSessions(student) {
  const tasks = [];
  if (student?.telegram_id) tasks.push(sbDelete('telegram_sessions', `telegram_user_id=eq.${encodeURIComponent(student.telegram_id)}`).catch(() => {}));
  if (student?.vk_id) tasks.push(sbDelete('vk_sessions', `vk_user_id=eq.${encodeURIComponent(student.vk_id)}`).catch(() => {}));
  await Promise.all(tasks);
}

export async function unlinkStudentEverywhere(studentId) {
  const student = await sbOne('students', `id=eq.${encodeURIComponent(studentId)}&status=eq.active&select=id,telegram_id,vk_id`);
  if (!student) return null;
  const rows = await sbPatch('students', `id=eq.${encodeURIComponent(studentId)}&status=eq.active`, {
    telegram_id: null,
    vk_id: null,
    updated_at: new Date().toISOString(),
  });
  await clearStudentSessions(student);
  return rows[0] ?? null;
}

export async function normalizeLegacyRevisions() {
  return sbPatch('homework_submissions', 'status=eq.revision', {
    status: 'assigned',
    checked_at: null,
  });
}

export async function listTeacherGroups() {
  return sbSelect('groups', 'active=eq.true&order=name.asc&select=id,name,group_type,target_score,created_at');
}

export async function groupAdminView(groupId) {
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true`);
  if (!group) return null;
  const [students, assignments, lessons] = await Promise.all([
    sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&order=name.asc&select=id,name,group_id,target_score,telegram_id,vk_id,reg_token`),
    sbSelect('homework_assignments', `group_id=eq.${encodeURIComponent(groupId)}&archived_at=is.null&order=assigned_at.desc&select=id,topic,due_date,hw_type,is_advanced,assigned_at,lesson_id`),
    sbSelect('lessons', `group_id=eq.${encodeURIComponent(groupId)}&active=eq.true&order=sequence.desc&limit=30&select=id,topic,scheduled_date,sequence,lesson_number,created_at`),
  ]);
  const assignmentIds = assignments.map(a => a.id);
  const submissions = assignmentIds.length
    ? await sbSelect('homework_submissions', `assignment_id=in.(${assignmentIds.join(',')})&status=in.(assigned,submitted,checked)&select=id,assignment_id,student_id,status,score,max_score,submitted_at,checked_at`)
    : [];
  const pending = submissions.filter(s => s.status === 'submitted').length;
  const assignmentMap = new Map(assignments.map(a => [a.id, a]));
  const overdue = submissions.filter(s => s.status === 'assigned' && assignmentMap.get(s.assignment_id)?.due_date && assignmentMap.get(s.assignment_id).due_date < todayMoscow()).length;
  return { group, students, assignments, lessons, submissions, pending, overdue };
}

export async function listGroupStudentsAdmin(groupId) {
  return sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&order=name.asc&select=id,name,group_id,target_score,telegram_id,vk_id,reg_token`);
}

export async function studentAdminView(studentId) {
  const student = await sbOne('students', `id=eq.${encodeURIComponent(studentId)}&status=eq.active&select=id,name,group_id,target_score,telegram_id,vk_id,reg_token,status`);
  if (!student) return null;
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(student.group_id)}&active=eq.true&select=id,name,group_type`);
  if (!group) return null;
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
  const student = await sbOne('students', `id=eq.${encodeURIComponent(studentId)}&status=eq.active&select=id,name,group_id,telegram_id,vk_id`);
  if (!student) return null;
  await Promise.all([
    sbPatch('students', `id=eq.${encodeURIComponent(studentId)}`, {
      status: 'left', telegram_id: null, vk_id: null, updated_at: new Date().toISOString(),
    }),
    sbPatch('homework_submissions', `student_id=eq.${encodeURIComponent(studentId)}&status=eq.assigned`, { status: 'cancelled' }),
  ]);
  await clearStudentSessions(student);
  return student;
}

export async function archiveGroup(groupId) {
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true`);
  if (!group) return null;
  const students = await sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&select=id,telegram_id,vk_id`);
  const studentIds = students.map(student => student.id);
  await Promise.all([
    sbPatch('groups', `id=eq.${encodeURIComponent(groupId)}`, { active: false, updated_at: new Date().toISOString() }),
    sbPatch('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active`, {
      status: 'left', telegram_id: null, vk_id: null, updated_at: new Date().toISOString(),
    }),
    studentIds.length
      ? sbPatch('homework_submissions', `student_id=in.(${studentIds.join(',')})&status=eq.assigned`, { status: 'cancelled' })
      : Promise.resolve([]),
  ]);
  await Promise.all(students.map(clearStudentSessions));
  return { ...group, archived_students: students.length };
}

export async function createGroupAdmin(name, groupType = 'mini_group') {
  const cleanType = groupType === 'individual' ? 'individual' : 'mini_group';
  const now = new Date().toISOString();
  const rows = await sbInsert('groups', {
    id: botId(),
    name: String(name || '').trim(),
    group_type: cleanType,
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
  const assignments = await sbSelect('homework_assignments', `group_id=eq.${encodeURIComponent(groupId)}&archived_at=is.null&order=assigned_at.desc&select=id,group_id,lesson_id,topic,due_date,hw_type,is_advanced,assigned_at,task_config,answers,file_id,telegram_file_id,material_name`);
  if (!assignments.length) return [];
  const ids = assignments.map(a => a.id);
  const submissions = await sbSelect('homework_submissions', `assignment_id=in.(${ids.join(',')})&status=in.(assigned,submitted,checked)&select=id,assignment_id,status,student_id,score,max_score`);
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

export async function homeworkAdminView(assignmentId) {
  const assignment = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(assignmentId)}&archived_at=is.null`);
  if (!assignment) return null;
  const [group, submissions] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(assignment.group_id)}&active=eq.true&select=id,name`),
    sbSelect('homework_submissions', `assignment_id=eq.${encodeURIComponent(assignmentId)}&status=in.(assigned,submitted,checked)&select=id,student_id,status,score,max_score,submitted_at,checked_at`),
  ]);
  if (!group) return null;
  return {
    assignment,
    group,
    submissions,
    submitted: submissions.filter(row => ['submitted', 'checked'].includes(row.status)).length,
    pending: submissions.filter(row => row.status === 'submitted').length,
    checked: submissions.filter(row => row.status === 'checked').length,
    overdue: submissions.filter(row => row.status === 'assigned' && assignment.due_date && assignment.due_date < todayMoscow()).length,
  };
}

export async function updateHomeworkAdmin(assignmentId, changes = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(changes, 'topic')) patch.topic = String(changes.topic || '').trim();
  if (Object.prototype.hasOwnProperty.call(changes, 'due_date')) patch.due_date = changes.due_date || null;
  if (Object.prototype.hasOwnProperty.call(changes, 'telegram_file_id')) patch.telegram_file_id = changes.telegram_file_id || null;
  if (Object.prototype.hasOwnProperty.call(changes, 'file_id')) patch.file_id = changes.file_id || null;
  if (Object.prototype.hasOwnProperty.call(changes, 'material_name')) patch.material_name = changes.material_name || null;
  if (!Object.keys(patch).length) return homeworkAdminView(assignmentId);
  const rows = await sbPatch('homework_assignments', `id=eq.${encodeURIComponent(assignmentId)}&archived_at=is.null`, patch);
  return rows[0] ?? null;
}

export async function archiveHomeworkAdmin(assignmentId) {
  return sbRpc('set_homework_archived', { p_assignment_id: assignmentId, p_archived: true });
}

export async function listGroupLessonsAdmin(groupId) {
  const lessons = await sbSelect('lessons', `group_id=eq.${encodeURIComponent(groupId)}&active=eq.true&order=sequence.desc&limit=30&select=id,group_id,topic,scheduled_date,sequence,lesson_number,created_at`);
  if (!lessons.length) return [];
  const ids = lessons.map(l => l.id);
  const [materials, homework] = await Promise.all([
    sbSelect('lesson_materials', `lesson_id=in.(${ids.join(',')})&select=id,lesson_id,material_type,title,external_url,telegram_file_id,vk_attachment,file_name`),
    sbSelect('homework_assignments', `lesson_id=in.(${ids.join(',')})&archived_at=is.null&select=id,lesson_id,topic,due_date,hw_type,is_advanced`),
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
  return createTeacherLesson(groupId, topic || `Занятие ${today}`);
}

export async function createTeacherLesson(groupId, topic = '') {
  const latest = await sbOne('lessons', `group_id=eq.${encodeURIComponent(groupId)}&order=sequence.desc&select=sequence`);
  const sequence = Math.max(0, Number(latest?.sequence) || 0) + 1;
  const id = botId();
  const now = new Date().toISOString();
  await sbInsert('lessons', {
    id,
    group_id: groupId,
    sheet_lesson_key: `manual:${id}`,
    lesson_number: String(sequence),
    sequence,
    topic: String(topic || '').trim() || `Занятие ${todayMoscow()}`,
    event_type: 'lesson',
    scheduled_date: todayMoscow(),
    active: true,
    created_at: now,
    updated_at: now,
  });
  return id;
}

export async function createHomeworkAdmin(data) {
  const assignmentId = botId();
  const lessonId = data.lesson_id || await ensureTeacherLesson(data.group_id, data.topic);
  const requestedType = String(data.hw_type || 'detailed');
  const storedType = requestedType === 'brief' || requestedType === 'trial' ? requestedType : 'detailed';
  await sbRpc('create_homework_for_group', {
    p_assignment_id: assignmentId,
    p_group_id: data.group_id,
    p_lesson_id: lessonId,
    p_topic: data.topic,
    p_due_date: data.due_date || null,
    p_hw_type: storedType,
    p_is_advanced: requestedType === 'detailed_hard',
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
  const lessonId = data.lesson_id || await ensureTeacherLesson(data.group_id);
  const existing = ['notes', 'recording'].includes(data.material_type)
    ? await sbOne('lesson_materials', `lesson_id=eq.${encodeURIComponent(lessonId)}&material_type=eq.${encodeURIComponent(data.material_type)}&order=created_at.desc`)
    : null;
  const payload = {
    group_id: data.group_id,
    lesson_id: lessonId,
    material_type: data.material_type,
    title: data.title,
    external_url: data.external_url || null,
    telegram_file_id: data.telegram_file_id || null,
    vk_attachment: data.vk_attachment || null,
    file_name: data.file_name || null,
  };
  let material;
  if (existing) {
    const rows = await sbPatch('lesson_materials', `id=eq.${encodeURIComponent(existing.id)}`, payload);
    material = rows[0] || { ...existing, ...payload };
  } else {
    const rows = await sbInsert('lesson_materials', {
      id: botId(),
      ...payload,
      created_at: new Date().toISOString(),
    });
    material = rows[0];
  }
  const students = await sbSelect('students', `group_id=eq.${encodeURIComponent(data.group_id)}&status=eq.active&select=id,name,telegram_id,vk_id`);
  return { material, students };
}

export async function listUncheckedAdmin() {
  const submissions = await sbSelect('homework_submissions', 'status=eq.submitted&order=submitted_at.asc&limit=50&select=id,assignment_id,student_id,submitted_at,submitted_files,source');
  if (!submissions.length) return [];
  const studentIds = [...new Set(submissions.map(s => s.student_id))];
  const assignmentIds = [...new Set(submissions.map(s => s.assignment_id))];
  const [students, assignments] = await Promise.all([
    sbSelect('students', `id=in.(${studentIds.join(',')})&status=eq.active&select=id,name,group_id,telegram_id,vk_id`),
    sbSelect('homework_assignments', `id=in.(${assignmentIds.join(',')})&archived_at=is.null&select=id,topic,group_id,due_date,hw_type,task_config`),
  ]);
  const sm = new Map(students.map(s => [s.id, s]));
  const am = new Map(assignments.map(a => [a.id, a]));
  return submissions.map(submission => ({ submission, student: sm.get(submission.student_id), assignment: am.get(submission.assignment_id) })).filter(x => x.student && x.assignment);
}

export async function uncheckedAdminView(submissionId) {
  const submission = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(submissionId)}&status=eq.submitted`);
  if (!submission) return null;
  const [student, assignment] = await Promise.all([
    sbOne('students', `id=eq.${encodeURIComponent(submission.student_id)}&status=eq.active&select=id,name,group_id,telegram_id,vk_id`),
    sbOne('homework_assignments', `id=eq.${encodeURIComponent(submission.assignment_id)}&archived_at=is.null&select=id,topic,group_id,due_date,hw_type,task_config`),
  ]);
  if (!student || !assignment) return null;
  return { submission, student, assignment };
}

export async function finalizeReviewAdmin(submissionId, score, maxScore, comment = '') {
  const numericScore = Number(score);
  const numericMax = Number(maxScore);
  if (!Number.isFinite(numericScore) || !Number.isFinite(numericMax) || numericMax <= 0 || numericScore < 0 || numericScore > numericMax) {
    return null;
  }
  const rows = await sbPatch('homework_submissions', `id=eq.${encodeURIComponent(submissionId)}&status=eq.submitted`, {
    status: 'checked',
    checked_at: new Date().toISOString(),
    score: numericScore,
    max_score: numericMax,
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
