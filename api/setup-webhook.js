const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

const html = (message = '', isError = false) => `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TutorOS — подключение Telegram</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; max-width: 520px; margin: 10vh auto; padding: 24px; color: #202124; }
    form { display: grid; gap: 12px; }
    input, button { box-sizing: border-box; width: 100%; padding: 12px; font: inherit; }
    button { cursor: pointer; }
    .message { padding: 12px; margin-bottom: 16px; background: ${isError ? '#fce8e6' : '#e6f4ea'}; }
  </style>
</head>
<body>
  <h1>Подключение Telegram-бота</h1>
  ${message ? `<p class="message">${message}</p>` : ''}
  <p>Введите секрет webhook из настроек Vercel. Токен Telegram при этом не показывается и не передаётся в браузер.</p>
  <form method="post">
    <input type="password" name="secret" autocomplete="off" required placeholder="Секрет webhook">
    <button type="submit">Подключить бота к этому адресу</button>
  </form>
</body>
</html>`;

const sendHtml = (res, status, body) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(body);
};

const requestBody = (req) => {
  if (typeof req.body === 'string') return Object.fromEntries(new URLSearchParams(req.body));
  return req.body || {};
};

export default async function handler(req, res) {
  if (req.method === 'GET') return sendHtml(res, 200, html());
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!BOT_TOKEN || !WEBHOOK_SECRET) {
    return sendHtml(res, 503, html('В Vercel не хватает настроек Telegram.', true));
  }

  if (requestBody(req).secret !== WEBHOOK_SECRET) {
    return sendHtml(res, 401, html('Неверный секрет.', true));
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    return sendHtml(res, 400, html('Не удалось определить адрес приложения.', true));
  }

  const webhookUrl = `https://${host}/api/bot`;
  const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    }),
  });
  const result = await telegramResponse.json().catch(() => ({}));

  if (!telegramResponse.ok || !result.ok) {
    console.error('Telegram setWebhook failed:', result.description || telegramResponse.status);
    return sendHtml(res, 502, html('Telegram не принял новый адрес. Попробуйте ещё раз.', true));
  }

  return sendHtml(res, 200, html('Готово: бот подключён к этой тестовой версии.'));
}
