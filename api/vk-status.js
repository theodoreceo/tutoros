const required = [
  'VK_GROUP_TOKEN',
  'VK_GROUP_ID',
  'VK_CALLBACK_SECRET',
  'VK_CONFIRMATION_CODE',
  'OWNER_VK_ID',
  'SUPABASE_URL',
];

export default async function handler(req, res) {
  const missing = required.filter(name => !process.env[name]);
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push('SUPABASE_SECRET_KEY');
  }
  let lastCallback = null;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.SUPABASE_URL && supabaseKey) {
    try {
      const response = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/vk_sessions?vk_user_id=eq.-1&select=state&limit=1`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      if (response.ok) {
        const rows = await response.json();
        if (rows[0]?.state?.diagnostic) lastCallback = rows[0].state;
      }
    } catch {
      // Read-only diagnostics must not make the status endpoint fail.
    }
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'ваш-домен.vercel.app';
  return res.status(missing.length ? 503 : 200).json({
    ok: missing.length === 0,
    callback_url: `https://${host}/api/bot`,
    missing,
    last_callback: lastCallback,
  });
}
