import telegramHandler from './telegram.js';
import {
  telegram,
  sendTelegram,
  sendTelegramDocument,
  resolveVkAttachmentUrl,
  tgInlineKeyboard,
} from './_lib/channels.js';

const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;

const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const botId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function sbOne(table, qs) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`, { headers: SB });
  if (!response.ok) throw new Error(`sbOne ${table}: ${await response.text()}`);
  const rows = await response.json();
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

function moscowDateParts(iso = new Date().toISOString()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    iso: `${values.year}-${values.month}-${values.day}`,
    short: `${values.day}.${values.month}`,
  };
}

async function getTelegramSession(userId) {
  const row = await sbOne('telegram_sessions', `telegram_user_id=eq.${encodeURIComponent(userId)}&select=state`);
  return row?.state || {};
}

async function ensureCurrentManualLesson(groupId, preferredTopic = '') {
  if (!groupId) return null;
  const today = moscowDateParts();
  const current = await sbOne(
    'lessons',
    `group_id=eq.${encodeURIComponent(groupId)}` +
      '&active=eq.true&sheet_lesson_key=like.manual:*&order=created_at.desc' +
      '&select=id,topic,sequence,lesson_number,created_at'
  );

  if (current?.created_at && moscowDateParts(current.created_at).iso === today.iso) {
    const placeholder = /^Урок \d{2}\.\d{2}$/u.test(String(current.topic || ''));
    if (preferredTopic && placeholder) {
      await sbPatch('lessons', `id=eq.${encodeURIComponent(current.id)}`, {
        topic: preferredTopic,
        updated_at: new Date().toISOString(),
      });
    }
    return current.id;
  }

  const latest = await sbOne(
    'lessons',
    `group_id=eq.${encodeURIComponent(groupId)}&order=sequence.desc&select=sequence`
  );
  const sequence = Math.max(0, Number(latest?.sequence) || 0) + 1;
  const lessonId = botId();
  const now = new Date().toISOString();
  await sbInsert('lessons', {
    id: lessonId,
    group_id: groupId,
    sheet_lesson_key: `manual:${lessonId}`,
    lesson_number: String(sequence),
    sequence,
    topic: preferredTopic || `Урок ${today.short}`,
    event_type: 'lesson',
    scheduled_date: null,
    active: true,
    created_at: now,
    updated_at: now,
  });
  return lessonId;
}

async function handleSessionPreflight(update) {
  const message = update?.message;
  if (!message?.from?.id || !message?.chat?.id) return false;

  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();
  if (text.startsWith('/')) return false;

  const session = await getTelegramSession(userId);
  const owner = OWNER_TELEGRAM_ID && String(userId) === String(OWNER_TELEGRAM_ID);
  const hasMedia = Boolean(message.document || message.photo);

  if (owner) {
    if (session.step === 'notes_file') {
      if (hasMedia) {
        await ensureCurrentManualLesson(session.data?.group_id);
        return false;
      }
      if (text) {
        await sendTelegram(chatId, 'сейчас жду PDF/файл с конспектом. чтобы выйти — отправь /menu.');
        return true;
      }
    }

    if (session.step === 'hw_file') {
      if (hasMedia) {
        await ensureCurrentManualLesson(session.data?.group_id, session.data?.topic || '');
        return false;
      }
      if (text === '-' || text.toLowerCase() === 'нет') {
        await ensureCurrentManualLesson(session.data?.group_id, session.data?.topic || '');
        return false;
      }
      if (text) {
        await sendTelegram(chatId, 'пришли PDF/файл к ДЗ или «-», если файла нет. чтобы выйти — отправь /menu.');
        return true;
      }
    }

    if (session.step === 'recording_url' && /^https?:\/\//i.test(text)) {
      await ensureCurrentManualLesson(session.data?.group_id);
      return false;
    }
    return false;
  }

  if (session.step === 'submission_files' && text) {
    const submissionId = session.data?.submission_id;
    const rows = submissionId
      ? [[{ text: '✅ отправить', callback_data: `done:${submissionId}` }], [{ text: '❌ отменить', callback_data: 'student:homework' }]]
      : [[{ text: '← к заданиям', callback_data: 'student:homework' }]];
    await sendTelegram(chatId, 'сейчас жду фото/PDF работы. текст не сбросил сдачу — можешь продолжать загружать файлы.', {
      reply_markup: tgInlineKeyboard(rows),
    });
    return true;
  }

  return false;
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

async function handleStudentInvite(update) {
  const query = update?.callback_query;
  const data = String(query?.data || '');
  if (!data.startsWith('studentinfo:')) return false;

  const chatId = query?.message?.chat?.id;
  const userId = query?.from?.id;
  const studentId = data.slice('studentinfo:'.length);
  if (!chatId || !userId || !studentId) return false;
  if (!OWNER_TELEGRAM_ID || String(userId) !== String(OWNER_TELEGRAM_ID)) return false;

  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  const student = await sbOne(
    'students',
    `id=eq.${encodeURIComponent(studentId)}&select=id,name,group_id,vk_id,telegram_id,reg_token`
  );
  if (!student) {
    await sendTelegram(chatId, 'ученик не найден.');
    return true;
  }

  const bot = await telegram('getMe');
  const inviteLink = bot?.username && student.reg_token
    ? `https://t.me/${bot.username}?start=${encodeURIComponent(student.reg_token)}`
    : null;

  await sendTelegram(chatId,
    `<b>${esc(student.name)}</b>\nTG: ${student.telegram_id ? 'подключён' : 'не подключён'}\nVK: ${student.vk_id ? 'подключён' : 'не подключён'}\n\n` +
    (inviteLink
      ? `Telegram-ссылка:\n${esc(inviteLink)}`
      : `код Telegram: <code>${esc(student.reg_token)}</code>`), {
      reply_markup: tgInlineKeyboard([[{ text: '← назад', callback_data: `og:${student.group_id}` }]]),
    });
  return true;
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
    try {
      if (await handleSessionPreflight(req.body || {})) {
        return res.status(200).send('ok');
      }
    } catch (error) {
      console.error('Telegram preflight failed:', error);
      const chatId = req.body?.message?.chat?.id;
      if (chatId) await sendTelegram(chatId, '⚠️ не удалось подготовить текущий урок. попробуй ещё раз.').catch(() => {});
      return res.status(200).send('ok');
    }

    await cleanupPreviousUiMessage(req.body || {});
    if (await handleStudentInvite(req.body || {})) {
      return res.status(200).send('ok');
    }
    if (await handlePortableHomeworkFile(req.body || {})) {
      return res.status(200).send('ok');
    }
  }
  return telegramHandler(req, res);
}
