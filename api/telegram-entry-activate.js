import { telegram } from './_lib/channels.js';

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(403).json({ ok: false, error: 'preview only' });
  }
  if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(500).json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET is not configured' });
  }

  const branchHost = String(process.env.VERCEL_BRANCH_URL || '').trim();
  if (!branchHost) return res.status(500).json({ ok: false, error: 'VERCEL_BRANCH_URL missing' });
  const url = `https://${branchHost}/api/telegram-entry`;
  const before = await telegram('getWebhookInfo');
  await telegram('setWebhook', {
    url,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
  const after = await telegram('getWebhookInfo');
  return res.status(200).json({
    ok: true,
    before: before.url,
    after: after.url,
  });
}
