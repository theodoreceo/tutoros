import { telegram } from './_lib/channels.js';

async function checkSchema() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ready: false, error: 'Supabase is not configured' };
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const [students, materials] = await Promise.all([
      fetch(`${url}/rest/v1/students?select=telegram_id&limit=1`, { headers }),
      fetch(`${url}/rest/v1/lesson_materials?select=id&limit=1`, { headers }),
    ]);
    if (!students.ok) return { ready: false, error: `students.telegram_id: ${students.status}` };
    if (!materials.ok) return { ready: false, error: `lesson_materials: ${materials.status}` };
    return { ready: true, error: null };
  } catch (error) {
    return { ready: false, error: error.message };
  }
}

async function repairCanonicalData(req) {
  if (String(req.query?.repair || '') !== 'canonical-20260928') return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured');
  const response = await fetch(`${url}/rest/v1/homework_submissions?status=eq.revision`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ status: 'assigned', checked_at: null }),
  });
  if (!response.ok) throw new Error(`revision repair: ${response.status} ${await response.text()}`);
  const rows = await response.json();
  return { revisions_normalized: rows.length };
}

export default async function handler(req, res) {
  const configured = {
    telegram_bot_token: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    telegram_webhook_secret: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
    owner_telegram_id: Boolean(process.env.OWNER_TELEGRAM_ID),
    supabase_url: Boolean(process.env.SUPABASE_URL),
    supabase_secret_key: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  };

  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const branchHost = String(process.env.VERCEL_BRANCH_URL || '').trim();
  const host = branchHost || requestHost;
  const webhookUrl = host ? `${protocol}://${host}/api/telegram-entry` : null;

  let bot = null;
  let webhook = null;
  if (configured.telegram_bot_token) {
    bot = await telegram('getMe').catch(error => ({ error: error.message }));
    webhook = await telegram('getWebhookInfo').catch(error => ({ error: error.message }));
  }
  const schema = await checkSchema();
  const webhookMatches = Boolean(webhookUrl && webhook && !webhook.error && webhook.url === webhookUrl);
  const repair = await repairCanonicalData(req).catch(error => ({ error: error.message }));

  return res.status(200).json({
    ok: Object.values(configured).every(Boolean) && schema.ready && webhookMatches,
    configured,
    schema,
    repair,
    webhook_url: webhookUrl,
    webhook_matches_expected: webhookMatches,
    bot: bot && !bot.error ? { id: bot.id, username: bot.username, first_name: bot.first_name } : bot,
    webhook: webhook && !webhook.error ? {
      url: webhook.url,
      pending_update_count: webhook.pending_update_count,
      last_error_message: webhook.last_error_message || null,
    } : webhook,
  });
}
