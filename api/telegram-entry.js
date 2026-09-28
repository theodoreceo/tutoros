import telegramUiHandler from './telegram-ui.js';
import { telegram, withTelegramUiTransition } from './_lib/channels.js';
import { handleTelegramStudentAccount } from './_lib/student-account.js';
import { handleTelegramStudentCjm } from './_lib/student-telegram-cjm.js';
import { handleTelegramTeacher } from './_lib/teacher-telegram.js';
import { handleTelegramHomeworkCard } from './_lib/telegram-homework-card.js';
import { handleTelegramHomeworkUpdate } from './_lib/telegram-homework.js';
import { handleTelegramNotesUpload } from './_lib/telegram-notes.js';
import { handleStoredHomeworkFile } from './_lib/telegram-storage-file.js';
import { handleTelegramReviewUpdate } from './_lib/telegram-review.js';
import { handleTelegramSubmissionFile } from './_lib/telegram-submission-files.js';
import { handleTelegramSubmissionUpdate } from './_lib/telegram-submissions.js';

const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const recentCallbacks = new Map();
const CALLBACK_DEDUPE_MS = 3500;

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

function callbackFingerprint(query) {
  const userId = query?.from?.id;
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  const data = String(query?.data || '');
  if (!userId || !chatId || !messageId || !data) return null;
  return `${userId}:${chatId}:${messageId}:${data}`;
}

function isDuplicateCallback(query) {
  const key = callbackFingerprint(query);
  if (!key) return false;
  const now = Date.now();
  for (const [oldKey, timestamp] of recentCallbacks) {
    if (now - timestamp > 10000) recentCallbacks.delete(oldKey);
  }
  const previous = recentCallbacks.get(key);
  recentCallbacks.set(key, now);
  return previous !== undefined && now - previous < CALLBACK_DEDUPE_MS;
}

async function acknowledgeCallbackImmediately(update) {
  const query = update?.callback_query;
  if (!query?.id) return { duplicate: false };
  const data = String(query.data || '');
  // Keep the dedicated revision handler's explanatory callback response.
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
  if (req.method === 'POST' && TELEGRAM_WEBHOOK_SECRET) {
    const actual = req.headers['x-telegram-bot-api-secret-token'];
    if (actual !== TELEGRAM_WEBHOOK_SECRET) return res.status(403).send('wrong secret');
  }

  if (req.method === 'POST') {
    const update = req.body || {};
    try {
      const { duplicate } = await acknowledgeCallbackImmediately(update);
      if (duplicate) return res.status(200).send('ok');

      if (await blockRevisionAction(update)) return res.status(200).send('ok');

      if (await handleTelegramStudentAccount(update)) return res.status(200).send('ok');

      if (await handleTelegramStudentCjm(studentCjmUpdate(update))) {
        return res.status(200).send('ok');
      }

      if (await handleTelegramTeacher(update)) {
        return res.status(200).send('ok');
      }

      if (await handleTelegramReviewUpdate(update)) return res.status(200).send('ok');
      if (await handleTelegramHomeworkCard(update)) return res.status(200).send('ok');
      if (await handleStoredHomeworkFile(update)) return res.status(200).send('ok');
      if (await handleTelegramHomeworkUpdate(update)) return res.status(200).send('ok');
      if (await handleTelegramNotesUpload(update)) return res.status(200).send('ok');
      if (await handleTelegramSubmissionFile(update)) return res.status(200).send('ok');

      if (update.message) {
        if (await handleTelegramSubmissionUpdate(update)) return res.status(200).send('ok');
      }

      if (update.callback_query && String(update.callback_query.data || '').startsWith('done:')) {
        await cleanupFinalizePrompt(update);
        if (await handleTelegramSubmissionUpdate(update)) return res.status(200).send('ok');
      }
    } catch (error) {
      console.error('Telegram guarded flow failed:', error);
      const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
      if (chatId) {
        await telegram('sendMessage', {
          chat_id: chatId,
          text: '⚠️ не удалось обработать действие. попробуй ещё раз.',
        }).catch(() => {});
      }
      return res.status(200).send('ok');
    }
  }

  return telegramUiHandler(req, res);
}

export default async function handler(req, res) {
  return withTelegramUiTransition(() => runHandler(req, res));
}
