import { telegram } from './_lib/channels.js';

export default async function handler(req, res) {
  const configured = {
    telegram_bot_token: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    telegram_bot_username: Boolean(process.env.TELEGRAM_BOT_USERNAME),
    telegram_webhook_secret: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
    owner_telegram_id: Boolean(process.env.OWNER_TELEGRAM_ID),
    supabase_url: Boolean(process.env.SUPABASE_URL),
    supabase_secret_key: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  };

  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const webhookUrl = host ? `${protocol}://${host}/api/telegram` : null;

  let bot = null;
  let webhook = null;
  if (configured.telegram_bot_token) {
    bot = await telegram('getMe').catch(error => ({ error: error.message }));
    webhook = await telegram('getWebhookInfo').catch(error => ({ error: error.message }));
  }

  return res.status(200).json({
    ok: Object.values(configured).every(Boolean),
    configured,
    webhook_url: webhookUrl,
    bot: bot && !bot.error ? { id: bot.id, username: bot.username, first_name: bot.first_name } : bot,
    webhook: webhook && !webhook.error ? {
      url: webhook.url,
      pending_update_count: webhook.pending_update_count,
      last_error_message: webhook.last_error_message || null,
    } : webhook,
  });
}
