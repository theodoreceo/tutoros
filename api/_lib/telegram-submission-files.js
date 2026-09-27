import {
  sendTelegram,
  tgInlineKeyboard,
  uploadTelegramFileToVk,
} from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;

const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

async function sbOne(table, qs) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`, { headers: SB });
  if (!response.ok) throw new Error(`sbOne ${table}: ${await response.text()}`);
  const rows = await response.json();
  return rows[0] ?? null;
}

async function sbUpsert(table, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbUpsert ${table}: ${await response.text()}`);
  return response.json();
}

export async function handleTelegramSubmissionFile(update) {
  const message = update?.message;
  const userId = message?.from?.id;
  const chatId = message?.chat?.id;
  if (!userId || !chatId) return false;
  if (OWNER_TELEGRAM_ID && String(userId) === String(OWNER_TELEGRAM_ID)) return false;

  const telegramFileId = message.document?.file_id
    || message.photo?.[message.photo.length - 1]?.file_id;
  if (!telegramFileId) return false;

  const [student, sessionRow] = await Promise.all([
    sbOne('students', `telegram_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id`),
    sbOne('telegram_sessions', `telegram_user_id=eq.${encodeURIComponent(userId)}&select=state`),
  ]);
  const session = sessionRow?.state || {};
  if (!student || session.step !== 'submission_files' || !session.data?.submission_id) return false;

  const submission = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(session.data.submission_id)}` +
      `&student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,revision)&select=id`);
  if (!submission) {
    await sendTelegram(chatId, 'эта работа уже была отправлена. открой ДЗ заново.');
    return true;
  }

  const fileName = message.document?.file_name || `photo-${Date.now()}.jpg`;
  let vkAttachment = null;
  try {
    vkAttachment = await uploadTelegramFileToVk(telegramFileId, fileName);
  } catch (error) {
    // Telegram is the primary channel. VK mirroring is best-effort and must not
    // prevent a student from submitting work when VK is unavailable.
    console.warn('TG→VK submission mirror failed; keeping Telegram original:', error?.message || error);
  }

  const files = [...(Array.isArray(session.data?.files) ? session.data.files : []), {
    type: message.document ? 'document' : 'photo',
    file_id: vkAttachment,
    telegram_file_id: telegramFileId,
    name: fileName,
  }];

  await sbUpsert('telegram_sessions', {
    telegram_user_id: userId,
    state: { step: 'submission_files', data: { ...session.data, files } },
    updated_at: new Date().toISOString(),
  });

  await sendTelegram(chatId,
    vkAttachment
      ? `📎 файл добавлен (${files.length}).`
      : `📎 файл добавлен (${files.length}). VK-копия пока не создалась, но сдаче это не мешает.`, {
      reply_markup: tgInlineKeyboard([[
        { text: '✅ отправить', callback_data: `done:${session.data.submission_id}` },
      ]]),
    });
  return true;
}
