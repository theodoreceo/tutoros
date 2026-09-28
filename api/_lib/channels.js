import { AsyncLocalStorage } from 'node:async_hooks';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VK_GROUP_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const OWNER_VK_ID = process.env.OWNER_VK_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const telegramUiTransitions = new AsyncLocalStorage();
const ACTIVE_UI_KEY = '_active_ui_message_id';
const VK_CJM_UI_KEY = '_cjm_ui_message_ids';
const SHADOW_BASE = -7000000000000000000n;

const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

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

function shadowSessionId(rawId) {
  try {
    let value = BigInt(String(rawId));
    if (value < 0n) value = -value;
    return String(SHADOW_BASE + value);
  } catch {
    return null;
  }
}

async function sessionState(table, idColumn, id) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || id === null || id === undefined) return {};
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${idColumn}=eq.${encodeURIComponent(id)}&select=state&limit=1`,
    { headers: SB },
  );
  if (!response.ok) return {};
  const rows = await response.json().catch(() => []);
  return rows?.[0]?.state || {};
}

async function saveShadowState(platform, externalId, state) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return;
  const id = shadowSessionId(externalId);
  if (!id) return;
  const table = platform === 'telegram' ? 'telegram_sessions' : 'vk_sessions';
  const idColumn = platform === 'telegram' ? 'telegram_user_id' : 'vk_user_id';
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      [idColumn]: id,
      state,
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});
}

async function activeUiState(platform, externalId) {
  const id = shadowSessionId(externalId);
  if (!id) return {};
  return platform === 'telegram'
    ? sessionState('telegram_sessions', 'telegram_user_id', id)
    : sessionState('vk_sessions', 'vk_user_id', id);
}

async function saveActiveUi(platform, externalId, messageId) {
  await saveShadowState(platform, externalId, {
    [ACTIVE_UI_KEY]: messageId || null,
    updated_at: new Date().toISOString(),
  });
}

function hasTelegramKeyboard(replyMarkup) {
  return Array.isArray(replyMarkup?.inline_keyboard)
    && replyMarkup.inline_keyboard.some(row => Array.isArray(row) && row.length);
}

function hasVkKeyboard(keyboard) {
  if (!keyboard) return false;
  try {
    const parsed = typeof keyboard === 'string' ? JSON.parse(keyboard) : keyboard;
    return Array.isArray(parsed?.buttons)
      && parsed.buttons.some(row => Array.isArray(row) && row.length);
  } catch {
    return false;
  }
}

async function deactivateTelegramUi(chatId, keepMessageId = null) {
  const state = await activeUiState('telegram', chatId);
  const messageId = state?.[ACTIVE_UI_KEY];
  if (!messageId || String(messageId) === String(keepMessageId || '')) return;
  try {
    await rawTelegram('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  } catch {
    await rawTelegram('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
  }
  await saveActiveUi('telegram', chatId, null);
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

async function deactivateVkMessage(peerId, messageId) {
  if (!messageId) return;
  try {
    await vk('messages.edit', {
      peer_id: peerId,
      message_id: messageId,
      keyboard: JSON.stringify({ inline: true, buttons: [] }),
    });
  } catch {
    await vk('messages.delete', { message_ids: String(messageId), delete_for_all: 1 }).catch(() => {});
  }
}

async function deactivateVkUi(peerId, keepMessageId = null) {
  const ids = new Set();
  const shadow = await activeUiState('vk', peerId);
  if (shadow?.[ACTIVE_UI_KEY]) ids.add(String(shadow[ACTIVE_UI_KEY]));

  // The canonical VK student CJM predates the shared active-UI registry and
  // stores its own UI message ids. Include them so notifications/teacher UI
  // can still replace the current student screen cleanly.
  const live = await sessionState('vk_sessions', 'vk_user_id', peerId);
  for (const id of Array.isArray(live?.[VK_CJM_UI_KEY]) ? live[VK_CJM_UI_KEY] : []) {
    if (id) ids.add(String(id));
  }

  for (const id of ids) {
    if (String(id) === String(keepMessageId || '')) continue;
    await deactivateVkMessage(peerId, id);
  }
  if (shadow?.[ACTIVE_UI_KEY] && String(shadow[ACTIVE_UI_KEY]) !== String(keepMessageId || '')) {
    await saveActiveUi('vk', peerId, null);
  }
}

export async function deactivateVkActiveUi(peerId) {
  if (!peerId) return;
  await deactivateVkUi(peerId).catch(() => {});
}

export async function deactivateTelegramActiveUi(chatId) {
  if (!chatId) return;
  await deactivateTelegramUi(chatId).catch(() => {});
}

export async function telegram(method, payload = {}) {
  const transition = telegramUiTransitions.getStore();
  const chatKey = payload?.chat_id === undefined || payload?.chat_id === null
    ? null
    : String(payload.chat_id);

  // UI handlers historically do deleteMessage -> sendMessage. Keep the old
  // message visible while the next screen is prepared, then edit it in place.
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
          // If the new screen has no buttons, explicitly remove the old ones.
          reply_markup: payload.reply_markup || { inline_keyboard: [] },
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
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  };
  const interactive = hasTelegramKeyboard(payload.reply_markup);
  const transition = telegramUiTransitions.getStore();
  const pending = transition?.pendingDeletes?.get(String(chatId));
  const keepMessageId = pending?.message_id || null;

  if (interactive) await deactivateTelegramUi(chatId, keepMessageId).catch(() => {});
  const result = await telegram('sendMessage', payload);
  const messageId = result?.message_id || keepMessageId || null;

  if (interactive && messageId) {
    await saveActiveUi('telegram', chatId, messageId).catch(() => {});
  } else if (keepMessageId) {
    // The active screen was edited into a non-interactive prompt.
    await saveActiveUi('telegram', chatId, null).catch(() => {});
  }
  return result;
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

const randomId = () => Math.floor(Math.random() * 2147483647) || 1;

export async function sendVk(peerId, text, extra = {}) {
  const interactive = hasVkKeyboard(extra.keyboard);
  if (interactive) await deactivateVkUi(peerId).catch(() => {});
  const messageId = await vk('messages.send', {
    peer_id: peerId,
    random_id: randomId(),
    message: String(text || '').replace(/<[^>]+>/g, ''),
    ...extra,
  });
  if (interactive && messageId) await saveActiveUi('vk', peerId, messageId).catch(() => {});
  return messageId;
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
