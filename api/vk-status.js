const required = [
  'VK_GROUP_TOKEN',
  'VK_GROUP_ID',
  'VK_CALLBACK_SECRET',
  'VK_CONFIRMATION_CODE',
  'OWNER_VK_ID',
  'SUPABASE_URL',
];

export default function handler(req, res) {
  const missing = required.filter(name => !process.env[name]);
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push('SUPABASE_SECRET_KEY');
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'ваш-домен.vercel.app';
  return res.status(missing.length ? 503 : 200).json({
    ok: missing.length === 0,
    callback_url: `https://${host}/api/bot`,
    missing,
  });
}
