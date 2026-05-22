// api/tgfile.js — Proxy Telegram files to browser without exposing bot token
// Usage: GET /api/tgfile?id=FILE_ID

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export default async function handler(req, res) {
  const fileId = req.query?.id || '';
  if (!fileId) return res.status(400).end('Missing id');

  // Resolve file_path from Telegram
  const infoRes = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const info = await infoRes.json();
  if (!info.ok) return res.status(404).end('File not found');

  const filePath   = info.result.file_path;
  const downloadRes = await fetch(
    `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`
  );
  if (!downloadRes.ok) return res.status(502).end('Failed to download from Telegram');

  const buffer = Buffer.from(await downloadRes.arrayBuffer());

  const ext          = filePath.split('.').pop().toLowerCase();
  const contentTypes = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif',  webp: 'image/webp', pdf: 'application/pdf',
  };
  const contentType = contentTypes[ext] || downloadRes.headers.get('content-type') || 'application/octet-stream';
  const filename    = ext === 'pdf' ? 'homework.pdf' : `photo.${ext}`;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(buffer);
}
