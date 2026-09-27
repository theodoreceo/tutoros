import telegramHandler from './telegram.js';
import { telegram } from './_lib/channels.js';

const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

function shouldKeepSourceMessage(query) {
  const data = String(query?.data || '');
  const text = String(query?.message?.text || query?.message?.caption || '').trim();

  // Notifications are useful history. Opening them should not erase them.
  if (data.startsWith('hw:') && /^(📚 новое ДЗ|⏰|🔔)/u.test(text)) return true;
  if (data.startsWith('mat:') && /^(📝 новый конспект|🎥)/u.test(text)) return true;
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

export default async function handler(req, res) {
  if (req.method === 'POST' && TELEGRAM_WEBHOOK_SECRET) {
    const actual = req.headers['x-telegram-bot-api-secret-token'];
    if (actual !== TELEGRAM_WEBHOOK_SECRET) return res.status(403).send('wrong secret');
  }

  if (req.method === 'POST') {
    await cleanupPreviousUiMessage(req.body || {});
  }
  return telegramHandler(req, res);
}
