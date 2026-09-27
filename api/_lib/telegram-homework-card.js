import { sendTelegram, telegram, tgInlineKeyboard } from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function isPersistentNotification(query) {
  const text = String(query?.message?.text || query?.message?.caption || '').trim();
  return /^(📚 новое ДЗ|⏰|🔔)/u.test(text);
}

async function deleteSourceScreen(query) {
  if (isPersistentNotification(query)) return;
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  if (!chatId || !messageId) return;
  await telegram('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
}

export async function handleTelegramHomeworkCard(update) {
  const query = update?.callback_query;
  const data = String(query?.data || '');
  if (!data.startsWith('hw:')) return false;

  const chatId = query?.message?.chat?.id;
  const userId = query?.from?.id;
  const subId = data.slice(3);
  if (!chatId || !userId || !subId) return false;

  const student = await sbOne('students',
    `telegram_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,group_id`);
  if (!student) return false;

  const submission = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}` +
    '&select=id,assignment_id,status,score,max_score,comment');
  if (!submission) {
    await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
    await deleteSourceScreen(query);
    await sendTelegram(chatId, 'задание не найдено.');
    return true;
  }

  const assignment = await sbOne('homework_assignments',
    `id=eq.${encodeURIComponent(submission.assignment_id)}` +
    '&select=id,group_id,topic,due_date,telegram_file_id,file_id');
  if (!assignment || String(assignment.group_id) !== String(student.group_id)) {
    await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
    await deleteSourceScreen(query);
    await sendTelegram(chatId, 'задание не найдено.');
    return true;
  }

  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  await deleteSourceScreen(query);

  const status = {
    assigned: 'не сдано',
    submitted: 'ждёт проверки',
    checked: 'проверено',
    revision: 'на доработке',
  }[submission.status] || submission.status;

  const rows = [];
  if (assignment.telegram_file_id || assignment.file_id) {
    rows.push([{ text: '📎 файл задания', callback_data: `hwfile:${assignment.id}` }]);
  }
  if (['assigned', 'revision'].includes(submission.status)) {
    rows.push([{ text: '📤 сдать работу', callback_data: `submit:${submission.id}` }]);
  }
  rows.push([{ text: '← к заданиям', callback_data: 'student:homework' }]);

  await sendTelegram(chatId,
    `<b>${esc(assignment.topic)}</b>\nстатус: <b>${esc(status)}</b>` +
    (assignment.due_date ? `\nдедлайн: <b>${esc(assignment.due_date)}</b>` : '') +
    (submission.score !== null && submission.score !== undefined
      ? `\nрезультат: <b>${esc(submission.score)}${submission.max_score ? `/${esc(submission.max_score)}` : ''}</b>`
      : '') +
    (submission.comment ? `\n\n${esc(submission.comment)}` : ''), {
      reply_markup: tgInlineKeyboard(rows),
    });
  return true;
}
