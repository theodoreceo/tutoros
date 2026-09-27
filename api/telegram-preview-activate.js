import { telegram } from './_lib/channels.js';

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(403).json({ ok: false, error: 'preview only' });
  }
  if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(500).json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET is not configured' });
  }

  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const url = `${protocol}://${host}/api/telegram`;

  const before = await telegram('getWebhookInfo');
  const result = await telegram('setWebhook', {
    url,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
  const after = await telegram('getWebhookInfo');

  if (process.env.OWNER_TELEGRAM_ID) {
    await telegram('sendMessage', {
      chat_id: process.env.OWNER_TELEGRAM_ID,
      text: 'TutorOS preview подключён. Отправь /start — проверяем новую Telegram-версию.',
    }).catch(() => null);
  }

  return res.status(200).json({
    ok: Boolean(result),
    before: { url: before.url, pending_update_count: before.pending_update_count },
    after: { url: after.url, pending_update_count: after.pending_update_count },
  });
}
