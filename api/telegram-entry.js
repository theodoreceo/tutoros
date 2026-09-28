import { telegram, withTelegramUiTransition } from './_lib/channels.js';
import { handleTelegramStudentAccount } from './_lib/student-account.js';
import { handleTelegramStudentCjm } from './_lib/student-telegram-cjm.js';
import { handleTelegramNotificationOpen } from './_lib/student-notification-open.js';
import { handleTelegramTeacher } from './_lib/teacher-telegram.js';
import { handleTelegramTeacherPolicy } from './_lib/teacher-policy.js';
import { handleTelegramHomeworkCard } from './_lib/telegram-homework-card.js';
import { handleTelegramHomeworkUpdate } from './_lib/telegram-homework.js';
import { handleTelegramNotesUpload } from './_lib/telegram-notes.js';
import { handleStoredHomeworkFile } from './_lib/telegram-storage-file.js';
import { handleTelegramReviewUpdate } from './_lib/telegram-review.js';
import { handleTelegramSubmissionFile } from './_lib/telegram-submission-files.js';
import { handleTelegramSubmissionUpdate } from './_lib/telegram-submissions.js';

const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const recentCallbackIds = new Map();
const CALLBACK_DEDUPE_TTL_MS = 10000;

function studentCjmUpdate(update) {
  const query = update?.callback_query;
  const data = String(query?.data || '');
  if (!data.startsWith('hw:') || !query?.message?.chat) return update;
  return {
    ...update,
    callback_query: {
      ...query,
      message: { chat: query.message.chat },
    },
  };
}

function isDuplicateCallback(query) {
  const callbackId = query?.id ? String(query.id) : null;
  if (!callbackId) return false;
  const now = Date.now();
  for (const [oldId, timestamp] of recentCallbackIds) {
    if (now - timestamp > CALLBACK_DEDUPE_TTL_MS) recentCallbackIds.delete(oldId);
  }
  if (recentCallbackIds.has(callbackId)) return true;
  recentCallbackIds.set(callbackId, now);
  return false;
}

async function acknowledgeCallbackImmediately(update) {
  const query = update?.callback_query;
  if (!query?.id) return { duplicate: false };
  const data = String(query.data || '');
  if (data.startsWith('reviewrev:')) return { duplicate: false };
  const duplicate = isDuplicateCallback(query);
  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  return { duplicate };
}

async function blockRevisionAction(update) {
  const query = update?.callback_query;
  const data = String(query?.data || '');
  const userId = query?.from?.id;
  const chatId = query?.message?.chat?.id;
  if (!data.startsWith('reviewrev:') || !OWNER_TELEGRAM_ID || String(userId) !== String(OWNER_TELEGRAM_ID)) {
    return false;
  }
  await telegram('answerCallbackQuery', {
    callback_query_id: query.id,
    text: 'Доработка убрана из TutorOS',
    show_alert: false,
  }).catch(() => {});
  if (chatId) {
    await telegram('sendMessage', {
      chat_id: chatId,
      text: 'Функция «доработка» убрана. Поставь работе балл и комментарий; если нужно решить заново — создай новое ДЗ.',
    }).catch(() => {});
  }
  return true;
}

async function cleanupFinalizePrompt(update) {
  const query = update?.callback_query;
  const data = String(query?.data || '');
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  if (!data.startsWith('done:') || !chatId || !messageId) return;
  await telegram('deleteMessage', {
    chat_id: chatId,
    message_id: messageId,
  }).catch(() => {});
}

async function runHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (TELEGRAM_WEBHOOK_SECRET) {
    const actual = req.headers['x-telegram-bot-api-secret-token'];
    if (actual !== TELEGRAM_WEBHOOK_SECRET) return res.status(403).send('wrong secret');
  }

  const update = req.body || {};
  try {
    const { duplicate } = await acknowledgeCallbackImmediately(update);
    if (duplicate) return res.status(200).send('ok');

    if (await blockRevisionAction(update)) return res.status(200).send('ok');
    if (await handleTelegramStudentAccount(update)) return res.status(200).send('ok');
    if (await handleTelegramNotificationOpen(update)) return res.status(200).send('ok');
    if (await handleTelegramStudentCjm(studentCjmUpdate(update))) return res.status(200).send('ok');
    if (await handleTelegramTeacherPolicy(update)) return res.status(200).send('ok');
    if (await handleTelegramTeacher(update)) return res.status(200).send('ok');

    // Specialized compatibility handlers remain until their file/review payloads
    // are fully moved into the canonical adapters. There is no generic legacy
    // state-machine fallback anymore.
    if (await handleTelegramReviewUpdate(update)) return res.status(200).send('ok');
    if (await handleTelegramHomeworkCard(update)) return res.status(200).send('ok');
    if (await handleStoredHomeworkFile(update)) return res.status(200).send('ok');
    if (await handleTelegramHomeworkUpdate(update)) return res.status(200).send('ok');
    if (await handleTelegramNotesUpload(update)) return res.status(200).send('ok');
    if (await handleTelegramSubmissionFile(update)) return res.status(200).send('ok');

    if (update.message && await handleTelegramSubmissionUpdate(update)) {
      return res.status(200).send('ok');
    }

    if (update.callback_query && String(update.callback_query.data || '').startsWith('done:')) {
      await cleanupFinalizePrompt(update);
      if (await handleTelegramSubmissionUpdate(update)) return res.status(200).send('ok');
    }
  } catch (error) {
    console.error('Telegram canonical flow failed:', error);
    const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
    if (chatId) {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: '⚠️ не удалось обработать действие. попробуй ещё раз.',
      }).catch(() => {});
    }
    return res.status(200).send('ok');
  }

  // Unknown callbacks from old keyboards are intentionally inert.
  return res.status(200).send('ok');
}

export default async function handler(req, res) {
  return withTelegramUiTransition(() => runHandler(req, res));
}
