import telegramUiHandler from './telegram-ui.js';
import { telegram } from './_lib/channels.js';
import { handleTelegramStudentCjm } from './_lib/student-telegram-cjm.js';
import { handleTelegramHomeworkCard } from './_lib/telegram-homework-card.js';
import { handleTelegramHomeworkUpdate } from './_lib/telegram-homework.js';
import { handleTelegramNotesUpload } from './_lib/telegram-notes.js';
import { handleStoredHomeworkFile } from './_lib/telegram-storage-file.js';
import { handleTelegramReviewUpdate } from './_lib/telegram-review.js';
import { handleTelegramSubmissionFile } from './_lib/telegram-submission-files.js';
import { handleTelegramSubmissionUpdate } from './_lib/telegram-submissions.js';

const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

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

export default async function handler(req, res) {
  if (req.method === 'POST' && TELEGRAM_WEBHOOK_SECRET) {
    const actual = req.headers['x-telegram-bot-api-secret-token'];
    if (actual !== TELEGRAM_WEBHOOK_SECRET) return res.status(403).send('wrong secret');
  }

  if (req.method === 'POST') {
    try {
      // Canonical student flow always gets first refusal. Owner/admin updates
      // return false here and continue into the existing teacher handlers.
      if (await handleTelegramStudentCjm(req.body || {})) {
        return res.status(200).send('ok');
      }

      if (await handleTelegramReviewUpdate(req.body || {})) {
        return res.status(200).send('ok');
      }

      if (await handleTelegramHomeworkCard(req.body || {})) {
        return res.status(200).send('ok');
      }

      if (await handleStoredHomeworkFile(req.body || {})) {
        return res.status(200).send('ok');
      }

      if (await handleTelegramHomeworkUpdate(req.body || {})) {
        return res.status(200).send('ok');
      }

      if (await handleTelegramNotesUpload(req.body || {})) {
        return res.status(200).send('ok');
      }

      if (await handleTelegramSubmissionFile(req.body || {})) {
        return res.status(200).send('ok');
      }

      if (req.body?.message) {
        if (await handleTelegramSubmissionUpdate(req.body || {})) {
          return res.status(200).send('ok');
        }
      }

      if (req.body?.callback_query && String(req.body.callback_query.data || '').startsWith('done:')) {
        await cleanupFinalizePrompt(req.body || {});
        if (await handleTelegramSubmissionUpdate(req.body || {})) {
          return res.status(200).send('ok');
        }
      }
    } catch (error) {
      console.error('Telegram guarded flow failed:', error);
      const chatId = req.body?.message?.chat?.id || req.body?.callback_query?.message?.chat?.id;
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
