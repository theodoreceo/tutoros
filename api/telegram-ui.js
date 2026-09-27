import telegramHandler from './telegram.js';
import {
  telegram,
  sendTelegram,
  sendTelegramDocument,
  resolveVkAttachmentUrl,
} from './_lib/channels.js';

const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;

const SB = {
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

async function sbOne(table, qs) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`, { headers: SB });
  if (!response.ok) throw new Error(`sbOne ${table}: ${await response.text()}`);
  const rows = await response.json();
  return rows[0] ?? null;
}

function shouldKeepSourceMessage(query) {
  const data = String(query?.data || '');
  const text = String(query?.message?.text || query?.message?.caption || '').trim();

  // Opening a file/material should not destroy the screen that lets the user go back.
  if (data.startsWith('hwfile:') || data.startsWith('mat:')) return true;

  // Notifications are useful history. Opening them should not erase them.
  if (data.startsWith('hw:') && /^(📚 новое ДЗ|⏰|🔔)/u.test(text)) return true;
  return false;
}

async function cleanupPreviousUiMessage(update) {
  const query = update?.callback_query;
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  if (!query || !chatId || !messageId || shouldKeepSourceMessage(query)) return;

  await telegram('deleteMessage', {
    chat_id: chatId,
    message_id: messageId,
  }).catch(error => {
    // UI cleanup must never break the actual bot action.
    console.warn('Telegram UI cleanup failed:', error?.message || error);
  });
}

async function handlePortableHomeworkFile(update) {
  const query = update?.callback_query;
  const data = String(query?.data || '');
  if (!data.startsWith('hwfile:')) return false;

  const chatId = query?.message?.chat?.id;
  const userId = query?.from?.id;
  const assignmentId = data.slice('hwfile:'.length);
  if (!chatId || !userId || !assignmentId) return false;

  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});

  const student = await sbOne(
    'students',
    `telegram_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,group_id`
  );
  if (!student) {
    await sendTelegram(chatId, 'сначала подключись к боту по персональной ссылке.');
    return true;
  }

  const assignment = await sbOne(
    'homework_assignments',
    `id=eq.${encodeURIComponent(assignmentId)}&group_id=eq.${encodeURIComponent(student.group_id)}` +
      '&select=id,telegram_file_id,file_id,material_name'
  );
  if (!assignment) {
    await sendTelegram(chatId, 'задание не найдено.');
    return true;
  }

  const caption = assignment.material_name || 'Материал к ДЗ';
  if (assignment.telegram_file_id) {
    await sendTelegramDocument(chatId, assignment.telegram_file_id, caption);
    return true;
  }

  if (assignment.file_id) {
    const url = await resolveVkAttachmentUrl(assignment.file_id).catch(() => null);
    if (url) {
      await sendTelegramDocument(chatId, url, caption);
      return true;
    }
  }

  await sendTelegram(chatId, 'файл к этому ДЗ не найден.');
  return true;
}

export default async function handler(req, res) {
  if (req.method === 'POST' && TELEGRAM_WEBHOOK_SECRET) {
    const actual = req.headers['x-telegram-bot-api-secret-token'];
    if (actual !== TELEGRAM_WEBHOOK_SECRET) return res.status(403).send('wrong secret');
  }

  if (req.method === 'POST') {
    await cleanupPreviousUiMessage(req.body || {});
    if (await handlePortableHomeworkFile(req.body || {})) {
      return res.status(200).send('ok');
    }
  }
  return telegramHandler(req, res);
}
