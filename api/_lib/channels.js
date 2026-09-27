const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VK_GROUP_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const OWNER_VK_ID = process.env.OWNER_VK_ID;

function assertTelegram() {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
}

export async function telegram(method, payload = {}) {
  assertTelegram();
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    throw new Error(`Telegram ${method}: ${result?.description || response.status}`);
  }
  return result.result;
}

export async function sendTelegram(chatId, text, extra = {}) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function sendTelegramDocument(chatId, fileIdOrUrl, caption = '') {
  if (!fileIdOrUrl) return null;
  return telegram('sendDocument', {
    chat_id: chatId,
    document: fileIdOrUrl,
    caption: caption || undefined,
    parse_mode: 'HTML',
  });
}

export async function getTelegramFile(fileId) {
  const meta = await telegram('getFile', { file_id: fileId });
  if (!meta?.file_path) throw new Error('Telegram returned no file_path');
  const response = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${meta.file_path}`);
  if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    path: meta.file_path,
  };
}

async function vk(method, params = {}) {
  if (!VK_GROUP_TOKEN) throw new Error('VK_GROUP_TOKEN is not configured');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, access_token: VK_GROUP_TOKEN, v: VK_API_VERSION })) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.error) {
    throw new Error(`VK ${method}: ${result?.error?.error_msg || response.status}`);
  }
  return result?.response;
}

const randomId = () => Math.floor(Math.random() * 2147483647) || 1;

export async function sendVk(peerId, text, extra = {}) {
  return vk('messages.send', {
    peer_id: peerId,
    random_id: randomId(),
    message: String(text || '').replace(/<[^>]+>/g, ''),
    ...extra,
  });
}

export async function sendVkAttachment(peerId, attachment, text = '') {
  if (!attachment) return null;
  return sendVk(peerId, text, { attachment });
}

export function vkInlineButton(label, command, color = 'primary') {
  return {
    action: {
      type: 'callback',
      label,
      payload: JSON.stringify({ cmd: command }),
    },
    color,
  };
}

export function vkInlineKeyboard(rows) {
  return JSON.stringify({ inline: true, buttons: rows });
}

export function tgInlineKeyboard(rows) {
  return { inline_keyboard: rows };
}

export async function uploadTelegramFileToVk(fileId, fileName = 'file.bin') {
  const { buffer } = await getTelegramFile(fileId);
  const uploadServer = await vk('docs.getMessagesUploadServer', {
    peer_id: OWNER_VK_ID || undefined,
    type: 'doc',
  });
  if (!uploadServer?.upload_url) throw new Error('VK returned no document upload URL');

  const form = new FormData();
  form.append('file', new Blob([buffer]), fileName || 'file.bin');
  const uploadResponse = await fetch(uploadServer.upload_url, { method: 'POST', body: form });
  const uploaded = await uploadResponse.json().catch(() => null);
  if (!uploadResponse.ok || !uploaded?.file) {
    throw new Error(`VK document upload failed: ${uploadResponse.status}`);
  }

  const saved = await vk('docs.save', { file: uploaded.file, title: fileName || 'TutorOS file' });
  const doc = saved?.doc || (Array.isArray(saved) ? saved[0] : saved);
  if (!doc?.owner_id || !doc?.id) throw new Error('VK docs.save returned no document');
  return `doc${doc.owner_id}_${doc.id}${doc.access_key ? `_${doc.access_key}` : ''}`;
}

function parseVkAttachment(ref) {
  const value = String(ref || '');
  const match = value.match(/^(doc|photo)(-?\d+)_(\d+)(?:_([^_]+))?$/);
  if (!match) return null;
  return { type: match[1], ownerId: match[2], id: match[3], accessKey: match[4] || null };
}

export async function resolveVkAttachmentUrl(ref) {
  const parsed = parseVkAttachment(ref);
  if (!parsed) return null;
  const key = `${parsed.ownerId}_${parsed.id}${parsed.accessKey ? `_${parsed.accessKey}` : ''}`;
  if (parsed.type === 'doc') {
    const docs = await vk('docs.getById', { docs: key });
    return docs?.[0]?.url || null;
  }
  const photos = await vk('photos.getById', { photos: key, photo_sizes: 1 });
  const sizes = photos?.[0]?.sizes || [];
  const largest = [...sizes].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
  return largest?.url || null;
}

export async function sendStudentEverywhere(student, {
  text,
  telegramReplyMarkup = undefined,
  vkKeyboard = undefined,
  telegramFileId = null,
  vkAttachment = null,
} = {}) {
  const result = { telegram: null, vk: null };

  if (student?.telegram_id) {
    try {
      await sendTelegram(student.telegram_id, text, telegramReplyMarkup
        ? { reply_markup: telegramReplyMarkup }
        : {});
      if (telegramFileId) await sendTelegramDocument(student.telegram_id, telegramFileId);
      result.telegram = true;
    } catch (error) {
      console.error(`Telegram delivery failed for ${student.id}:`, error?.message || error);
      result.telegram = false;
    }
  }

  if (student?.vk_id) {
    try {
      await sendVk(student.vk_id, text, vkKeyboard ? { keyboard: vkKeyboard } : {});
      if (vkAttachment) await sendVkAttachment(student.vk_id, vkAttachment);
      result.vk = true;
    } catch (error) {
      console.error(`VK delivery failed for ${student.id}:`, error?.message || error);
      result.vk = false;
    }
  }

  return result;
}
