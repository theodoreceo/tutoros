const required = [
  'VK_GROUP_TOKEN',
  'VK_GROUP_ID',
  'VK_CALLBACK_SECRET',
  'OWNER_VK_ID',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
];

export default function handler(req, res) {
  const missing = required.filter(name => !process.env[name]);
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'ваш-домен.vercel.app';
  return res.status(missing.length ? 503 : 200).json({
    ok: missing.length === 0,
    callback_url: `https://${host}/api/bot`,
    missing,
  });
}
