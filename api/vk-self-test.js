const VK_GROUP_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const OWNER_VK_ID = process.env.OWNER_VK_ID;
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!VK_CONFIRMATION_CODE || req.headers['x-vk-test-code'] !== VK_CONFIRMATION_CODE) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = new URLSearchParams({
    peer_id: String(OWNER_VK_ID || ''),
    random_id: String(Math.floor(Math.random() * 2147483647) || 1),
    message: '✅ TutorOS: исходящие сообщения VK работают. Теперь проверяем входящие события.',
    access_token: VK_GROUP_TOKEN || '',
    v: VK_API_VERSION,
  });

  try {
    const response = await fetch('https://api.vk.com/method/messages.send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      return res.status(502).json({
        ok: false,
        vk_error_code: result.error?.error_code || response.status,
        vk_error: result.error?.error_msg || 'VK request failed',
      });
    }
    return res.status(200).json({ ok: true, message_id: result.response });
  } catch (error) {
    return res.status(502).json({ ok: false, vk_error: error.message });
  }
}
