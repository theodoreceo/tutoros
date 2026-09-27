import { AsyncLocalStorage } from 'node:async_hooks';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VK_GROUP_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const OWNER_VK_ID = process.env.OWNER_VK_ID;
const telegramUiTransitions = new AsyncLocalStorage();

function assertTelegram() {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
}

async function rawTelegram(method, payload = {}) {
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

export async function telegram(method, payload = {}) {
  const transition = telegramUiTransitions.getStore();
  const chatKey = payload?.chat_id === undefined || payload?.chat_id === null
    ? null
    : String(payload.chat_id);

  // UI handlers historically do deleteMessage -> sendMessage. Keep the old
  // message visible while the next screen is prepared, then edit it in place.
  // This removes the visible blank gap without forcing every handler to know
  // about Telegram-specific rendering details.
  if (transition && method === 'deleteMessage' && chatKey && payload.message_id) {
    transition.pendingDeletes.set(chatKey, {
      chat_id: payload.chat_id,
      message_id: payload.message_id,
    });
    return true;
  }

  if (transition && method === 'sendMessage' && chatKey) {
    const pending = transition.pendingDeletes.get(chatKey);
    if (pending) {
      transition.pendingDeletes.delete(chatKey);
      try {
        return await rawTelegram('editMessageText', {
          chat_id: payload.chat_id,
          message_id: pending.message_id,
          text: payload.text,
          parse_mode: payload.parse_mode,
          disable_web_page_preview: payload.disable_web_page_preview,
          reply_markup: payload.reply_markup,
        });
      } catch (error) {
        if (/message is not modified/i.test(String(error?.message || error))) {
          return { message_id: pending.message_id, chat: { id: payload.chat_id } };
        }
        // Some Telegram messages cannot be edited (old messages, special
        // message types, etc.). Fall back to the original behavior.
        await rawTelegram('deleteMessage', pending).catch(() => {});
        return rawTelegram('sendMessage', payload);
      }
    }
  }

  return rawTelegram(method, payload);
}

export async function withTelegramUiTransition(callback) {
  const state = { pendingDeletes: new Map() };
  return telegramUiTransitions.run(state, async () => {
    try {
      return await callback();
    } finally {
      // A delete that was not followed by sendMessage was a real deletion.
      const pending = [...state.pendingDeletes.values()];
      state.pendingDeletes.clear();
      await Promise.all(pending.map(item => rawTelegram('deleteMessage', item).catch(() => {})));
    }
  });
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
