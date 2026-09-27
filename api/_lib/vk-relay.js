import { sendTelegram, tgInlineKeyboard } from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const OWNER_VK_ID = process.env.OWNER_VK_ID;

const SB = {
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function sbSelect(table, qs = '') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB });
  if (!response.ok) throw new Error(`sbSelect ${table}: ${await response.text()}`);
  return response.json();
}

async function sbOne(table, qs) {
  const rows = await sbSelect(table, `${qs}&limit=1`);
  return rows[0] ?? null;
}

function actorVkId(update) {
  return update?.object?.message?.from_id
    ?? update?.object?.user_id
    ?? update?.object?.message?.peer_id
    ?? null;
}

function rowFingerprint(row) {
  return JSON.stringify({
    status: row.status || null,
    submitted_at: row.submitted_at || null,
    checked_at: row.checked_at || null,
    source: row.source || null,
  });
}

async function snapshotOwner() {
  const [assignments, submissions] = await Promise.all([
    sbSelect('homework_assignments', 'select=id,assigned_at&limit=500'),
    sbSelect('homework_submissions',
      'status=in.(checked,revision)&select=id,status,checked_at,submitted_at,source,student_id,assignment_id&limit=1000'),
  ]);
  return {
    role: 'owner',
    assignments: new Set(assignments.map(row => row.id)),
    submissions: new Map(submissions.map(row => [row.id, rowFingerprint(row)])),
  };
}

async function snapshotStudent(vkId) {
  const student = await sbOne('students',
    `vk_id=eq.${encodeURIComponent(vkId)}&status=eq.active&select=id,name`);
  if (!student) return { role: 'other' };
  const submissions = await sbSelect('homework_submissions',
    `student_id=eq.${encodeURIComponent(student.id)}` +
      '&select=id,status,submitted_at,checked_at,source,student_id,assignment_id&limit=500');
  return {
    role: 'student',
    student,
    submissions: new Map(submissions.map(row => [row.id, rowFingerprint(row)])),
  };
}

export async function snapshotVkRelay(update) {
  const actor = actorVkId(update);
  if (!actor || update?.type === 'confirmation') return { role: 'other' };
  if (OWNER_VK_ID && String(actor) === String(OWNER_VK_ID)) return snapshotOwner();
  return snapshotStudent(actor);
}

async function relayNewAssignment(assignmentId) {
  const assignment = await sbOne('homework_assignments',
    `id=eq.${encodeURIComponent(assignmentId)}&select=id,topic,due_date`);
  if (!assignment) return;

  const submissions = await sbSelect('homework_submissions',
    `assignment_id=eq.${encodeURIComponent(assignmentId)}&select=id,student_id`);
  await Promise.all(submissions.map(async submission => {
    const student = await sbOne('students',
      `id=eq.${encodeURIComponent(submission.student_id)}&status=eq.active&select=id,telegram_id`);
    if (!student?.telegram_id) return;
    const due = assignment.due_date ? `\nдедлайн: <b>${esc(assignment.due_date)}</b>` : '';
    await sendTelegram(student.telegram_id,
      `📚 новое ДЗ: <b>${esc(assignment.topic || 'без темы')}</b>${due}`, {
        reply_markup: tgInlineKeyboard([[
          { text: '📚 открыть задание', callback_data: `hw:${submission.id}` },
        ]]),
      });
  }));
}

async function relayOwnerReview(submissionId) {
  const submission = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(submissionId)}` +
      '&select=id,status,student_id,assignment_id,checked_at');
  if (!submission || !['checked', 'revision'].includes(submission.status)) return;
  const [student, assignment] = await Promise.all([
    sbOne('students', `id=eq.${encodeURIComponent(submission.student_id)}&select=id,telegram_id`),
    sbOne('homework_assignments', `id=eq.${encodeURIComponent(submission.assignment_id)}&select=id,topic`),
  ]);
  if (!student?.telegram_id) return;
  const topic = esc(assignment?.topic || 'без темы');
  await sendTelegram(student.telegram_id,
    submission.status === 'checked'
      ? `✅ ДЗ «<b>${topic}</b>» проверено.`
      : `↩️ ДЗ «<b>${topic}</b>» возвращено на доработку.`);
}

async function relayStudentSubmission(submissionId, studentName) {
  if (!OWNER_TELEGRAM_ID) return;
  const submission = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(submissionId)}` +
      '&select=id,status,assignment_id,source,submitted_at');
  if (!submission || submission.source !== 'vk' || !['submitted', 'checked'].includes(submission.status)) return;
  const assignment = await sbOne('homework_assignments',
    `id=eq.${encodeURIComponent(submission.assignment_id)}&select=id,topic`);
  const suffix = submission.status === 'checked' ? ' (проверено автоматически)' : '';
  await sendTelegram(OWNER_TELEGRAM_ID,
    `📥 ${esc(studentName)} сдал(а) ДЗ «${esc(assignment?.topic || 'без темы')}» в VK${suffix}.`);
}

export async function relayVkChanges(before, update) {
  if (!before || before.role === 'other') return;

  if (before.role === 'owner') {
    const afterAssignments = await sbSelect('homework_assignments', 'select=id&limit=500');
    const newAssignments = afterAssignments.filter(row => !before.assignments.has(row.id));
    for (const assignment of newAssignments) {
      await relayNewAssignment(assignment.id);
    }

    const afterSubs = await sbSelect('homework_submissions',
      'status=in.(checked,revision)&select=id,status,checked_at,submitted_at,source,student_id,assignment_id&limit=1000');
    for (const row of afterSubs) {
      if (before.submissions.get(row.id) !== rowFingerprint(row)) {
        await relayOwnerReview(row.id);
      }
    }
    return;
  }

  if (before.role === 'student') {
    const afterSubs = await sbSelect('homework_submissions',
      `student_id=eq.${encodeURIComponent(before.student.id)}` +
        '&select=id,status,submitted_at,checked_at,source,student_id,assignment_id&limit=500');
    for (const row of afterSubs) {
      if (before.submissions.get(row.id) !== rowFingerprint(row)) {
        await relayStudentSubmission(row.id, before.student.name);
      }
    }
  }
}
