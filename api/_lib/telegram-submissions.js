import { sendTelegram, sendVk, telegram, tgInlineKeyboard } from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const OWNER_VK_ID = process.env.OWNER_VK_ID;

const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function sbOne(table, qs) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`, { headers: SB });
  if (!response.ok) throw new Error(`sbOne ${table}: ${await response.text()}`);
  const rows = await response.json();
  return rows[0] ?? null;
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

function moscowDate(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function submittedOnTime(assignment, submittedAt) {
  if (!assignment?.due_date || assignment?.archived_at) return null;
  return moscowDate(submittedAt) <= assignment.due_date;
}

async function getSession(userId) {
  const row = await sbOne('telegram_sessions', `telegram_user_id=eq.${userId}&select=state`);
  return row?.state || {};
}

async function setStudentSession(userId) {
  await sbPatch('telegram_sessions', `telegram_user_id=eq.${userId}`, {
    state: { step: 'student' },
    updated_at: new Date().toISOString(),
  });
}

async function studentByTelegram(userId) {
  return sbOne('students', `telegram_id=eq.${userId}&status=eq.active&select=id,name,group_id`);
}

function studentHomeKeyboard() {
  return tgInlineKeyboard([
    [{ text: '📚 мои задания', callback_data: 'student:homework' }],
    [
      { text: '📎 материалы', callback_data: 'student:materials' },
      { text: '📊 результаты', callback_data: 'student:results' },
    ],
  ]);
}

async function notifyOwner(studentName, topic) {
  const plain = `📥 ${studentName} сдал(а) ДЗ «${topic}» в Telegram.`;
  if (OWNER_TELEGRAM_ID) {
    await sendTelegram(
      OWNER_TELEGRAM_ID,
      `📥 ${esc(studentName)} сдал(а) ДЗ «${esc(topic)}» в Telegram.`
    ).catch(() => {});
  }
  if (OWNER_VK_ID) await sendVk(OWNER_VK_ID, plain).catch(() => {});
}

async function handleBriefAnswer(message, session) {
  if (session.step !== 'brief_answer') return false;
  const userId = message.from.id;
  const chatId = message.chat.id;
  const student = await studentByTelegram(userId);
  if (!student) return false;

  const subId = session.data?.submission_id;
  const assignmentId = session.data?.assignment_id;
  const [submission, assignment] = await Promise.all([
    sbOne('homework_submissions',
      `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}` +
      '&status=in.(assigned,revision)'),
    sbOne('homework_assignments', `id=eq.${encodeURIComponent(assignmentId)}`),
  ]);
  if (!submission || !assignment) {
    await setStudentSession(userId);
    await sendTelegram(chatId, 'эта работа уже была отправлена или больше не активна.', {
      reply_markup: studentHomeKeyboard(),
    });
    return true;
  }

  const given = String(message.text || '').split(';').map(value => value.trim().replace(',', '.'));
  const correct = Array.isArray(assignment.answers)
    ? assignment.answers.map(value => String(value).trim().replace(',', '.'))
    : [];
  const results = correct.length ? correct.map((value, index) => given[index] === value) : [];
  const score = results.length ? results.filter(Boolean).length : null;
  const maxScore = results.length || null;
  const now = new Date().toISOString();

  const updated = await sbPatch(
    'homework_submissions',
    `id=eq.${encodeURIComponent(submission.id)}&student_id=eq.${encodeURIComponent(student.id)}` +
      '&status=in.(assigned,revision)',
    {
      status: results.length ? 'checked' : 'submitted',
      submitted_at: now,
      checked_at: results.length ? now : null,
      score,
      max_score: maxScore,
      student_answers: given,
      task_scores: results.length ? results.map(ok => ok ? 1 : 0) : null,
      comment: results.length ? `${score}/${maxScore} верно` : 'ответ отправлен преподавателю',
      source: 'telegram',
      on_time: submittedOnTime(assignment, now),
    }
  );

  await setStudentSession(userId);
  if (!updated.length) {
    await sendTelegram(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.', {
      reply_markup: studentHomeKeyboard(),
    });
    return true;
  }

  await notifyOwner(student.name, assignment.topic || 'без темы');
  await sendTelegram(chatId,
    results.length ? `✅ проверено: ${score}/${maxScore}` : '✅ ответ отправлен преподавателю.', {
      reply_markup: studentHomeKeyboard(),
    });
  return true;
}

async function handleFileFinalize(query, session) {
  const data = String(query.data || '');
  if (!data.startsWith('done:')) return false;

  const userId = query.from?.id;
  const chatId = query.message?.chat?.id;
  const subId = data.slice('done:'.length);
  if (!userId || !chatId || !subId) return false;

  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  const student = await studentByTelegram(userId);
  if (!student) return false;

  if (session.step !== 'submission_files' || session.data?.submission_id !== subId) {
    await sendTelegram(chatId, 'сессия сдачи устарела. открой ДЗ заново.', {
      reply_markup: studentHomeKeyboard(),
    });
    return true;
  }

  const files = Array.isArray(session.data?.files) ? session.data.files : [];
  if (!files.length) {
    await sendTelegram(chatId, 'сначала пришли хотя бы один файл.');
    return true;
  }

  const submission = await sbOne(
    'homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}` +
      '&status=in.(assigned,revision)'
  );
  if (!submission) {
    await setStudentSession(userId);
    await sendTelegram(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.', {
      reply_markup: studentHomeKeyboard(),
    });
    return true;
  }

  const assignment = await sbOne(
    'homework_assignments',
    `id=eq.${encodeURIComponent(submission.assignment_id)}&select=id,topic,due_date,archived_at`
  );
  const now = new Date().toISOString();
  const updated = await sbPatch(
    'homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}` +
      '&status=in.(assigned,revision)',
    {
      status: 'submitted',
      submitted_at: now,
      submitted_files: files,
      source: 'telegram',
      on_time: submittedOnTime(assignment, now),
    }
  );

  await setStudentSession(userId);
  if (!updated.length) {
    await sendTelegram(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.', {
      reply_markup: studentHomeKeyboard(),
    });
    return true;
  }

  await notifyOwner(student.name, assignment?.topic || 'без темы');
  await sendTelegram(chatId, '✅ работа отправлена преподавателю.', {
    reply_markup: studentHomeKeyboard(),
  });
  return true;
}

export async function handleTelegramSubmissionUpdate(update) {
  const userId = update?.message?.from?.id || update?.callback_query?.from?.id;
  if (!userId || (OWNER_TELEGRAM_ID && String(userId) === String(OWNER_TELEGRAM_ID))) return false;
  const session = await getSession(userId);

  if (update.message?.text && !String(update.message.text).startsWith('/')) {
    if (await handleBriefAnswer(update.message, session)) return true;
  }
  if (update.callback_query) {
    if (await handleFileFinalize(update.callback_query, session)) return true;
  }
  return false;
}
