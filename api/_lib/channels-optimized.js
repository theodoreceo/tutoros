import { AsyncLocalStorage } from 'node:async_hooks';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VK_GROUP_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const OWNER_VK_ID = process.env.OWNER_VK_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ACTIVE_UI_KEY = '_active_ui_message_id';
const UI_SESSION_OFFSET = 1000000000000000n;

const telegramUiTransitions = new AsyncLocalStorage();
const tgActiveUi = new Map();
const vkActiveUi = new Map();

function assertTelegram() {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
}

async function rawTelegram(method, payload = {}) {
  assertTelegram();
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(`Telegram ${method}: ${result?.description || response.status}`);
  return result.result;
}

function hasTelegramKeyboard(replyMarkup) {
  return Array.isArray(replyMarkup?.inline_keyboard) && replyMarkup.inline_keyboard.some(row => Array.isArray(row) && row.length);
}
function hasVkKeyboard(keyboard) {
  if (!keyboard) return false;
  try {
    const parsed = typeof keyboard === 'string' ? JSON.parse(keyboard) : keyboard;
    return Array.isArray(parsed?.buttons) && parsed.buttons.some(row => Array.isArray(row) && row.length);
  } catch { return false; }
}

function sessionConfig(channel) {
  return channel === 'telegram'
    ? { table: 'telegram_sessions', idField: 'telegram_user_id' }
    : { table: 'vk_sessions', idField: 'vk_user_id' };
}

function uiSessionId(externalId) {
  try {
    const raw = BigInt(String(externalId));
    const absolute = raw < 0n ? -raw : raw;
    return String(-(UI_SESSION_OFFSET + absolute));
  } catch {
    return null;
  }
}

async function loadDurableUiState(channel, externalId) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return {};
  const syntheticId = uiSessionId(externalId);
  if (!syntheticId) return {};
  const { table, idField } = sessionConfig(channel);
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${idField}=eq.${encodeURIComponent(syntheticId)}&select=state&limit=1`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } },
  );
  if (!response.ok) return {};
  const rows = await response.json().catch(() => []);
  return rows[0]?.state && typeof rows[0].state === 'object' ? rows[0].state : {};
}

async function saveDurableUiState(channel, externalId, state, messageId) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return;
  const syntheticId = uiSessionId(externalId);
  if (!syntheticId) return;
  const { table, idField } = sessionConfig(channel);
  const next = { ...(state || {}), [ACTIVE_UI_KEY]: messageId || null, ui_registry: true };
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ [idField]: syntheticId, state: next, updated_at: new Date().toISOString() }),
  }).catch(() => {});
}

export async function telegram(method, payload = {}) {
  const transition = telegramUiTransitions.getStore();
  const chatKey = payload?.chat_id === undefined || payload?.chat_id === null ? null : String(payload.chat_id);

  if (transition && method === 'deleteMessage' && chatKey && payload.message_id) {
    transition.pendingDeletes.set(chatKey, { chat_id: payload.chat_id, message_id: payload.message_id });
    return true;
  }

  if (transition && method === 'sendMessage' && chatKey) {
    const pending = transition.pendingDeletes.get(chatKey);
    if (pending) {
      transition.pendingDeletes.delete(chatKey);
      try {
        const edited = await rawTelegram('editMessageText', {
          chat_id: payload.chat_id,
          message_id: pending.message_id,
          text: payload.text,
          parse_mode: payload.parse_mode,
          disable_web_page_preview: payload.disable_web_page_preview,
          reply_markup: payload.reply_markup || { inline_keyboard: [] },
        });
        if (hasTelegramKeyboard(payload.reply_markup)) tgActiveUi.set(chatKey, pending.message_id);
        else tgActiveUi.delete(chatKey);
        return edited;
      } catch (error) {
        if (/message is not modified/i.test(String(error?.message || error))) {
          return { message_id: pending.message_id, chat: { id: payload.chat_id } };
        }
        await rawTelegram('deleteMessage', pending).catch(() => {});
        tgActiveUi.delete(chatKey);
        const sent = await rawTelegram('sendMessage', payload);
        if (hasTelegramKeyboard(payload.reply_markup) && sent?.message_id) tgActiveUi.set(chatKey, sent.message_id);
        return sent;
      }
    }
  }

  return rawTelegram(method, payload);
}

export async function withTelegramUiTransition(callback) {
  const state = { pendingDeletes: new Map() };
  return telegramUiTransitions.run(state, async () => {
    try { return await callback(); }
    finally {
      const pending = [...state.pendingDeletes.values()];
      state.pendingDeletes.clear();
      await Promise.all(pending.map(item => rawTelegram('deleteMessage', item).catch(() => {})));
    }
  });
}

export async function deactivateTelegramActiveUi(chatId) {
  const key = String(chatId);
  let messageId = tgActiveUi.get(key) || null;
  if (!messageId) {
    const state = await loadDurableUiState('telegram', chatId);
    messageId = state[ACTIVE_UI_KEY] || null;
  }
  if (!messageId) return;
  tgActiveUi.delete(key);
  await rawTelegram('editMessageReplyMarkup', {
    chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] },
  }).catch(() => {});
}

export async function sendTelegram(chatId, text, extra = {}) {
  const payload = {
    chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra,
  };
  const interactive = hasTelegramKeyboard(payload.reply_markup);
  const transition = telegramUiTransitions.getStore();
  const pending = transition?.pendingDeletes?.get(String(chatId));
  let durableState = null;

  // Callback navigation edits the clicked screen in-place. Only genuinely new
  // interactive screens pay the durable-state cost, so hot-path navigation stays fast.
  if (interactive && !pending) {
    durableState = await loadDurableUiState('telegram', chatId);
    const previous = tgActiveUi.get(String(chatId)) || durableState[ACTIVE_UI_KEY] || null;
    if (previous) {
      await rawTelegram('editMessageReplyMarkup', {
        chat_id: chatId, message_id: previous, reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }
    tgActiveUi.delete(String(chatId));
  }

  const result = await telegram('sendMessage', payload);
  const messageId = result?.message_id || pending?.message_id || null;
  if (interactive && messageId) {
    tgActiveUi.set(String(chatId), messageId);
    if (!pending) await saveDurableUiState('telegram', chatId, durableState || {}, messageId);
  } else if (pending) {
    tgActiveUi.delete(String(chatId));
  }
  return result;
}

export async function sendTelegramDocument(chatId, fileIdOrUrl, caption = '') {
  if (!fileIdOrUrl) return null;
  return telegram('sendDocument', { chat_id: chatId, document: fileIdOrUrl, caption: caption || undefined });
}

export async function getTelegramFile(fileId) {
  const meta = await telegram('getFile', { file_id: fileId });
  if (!meta?.file_path) throw new Error('Telegram returned no file_path');
  const response = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${meta.file_path}`);
  if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);
  return { buffer: Buffer.from(await response.arrayBuffer()), path: meta.file_path };
}

async function vk(method, params = {}) {
  if (!VK_GROUP_TOKEN) throw new Error('VK_GROUP_TOKEN is not configured');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, access_token: VK_GROUP_TOKEN, v: VK_API_VERSION })) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.error) throw new Error(`VK ${method}: ${result?.error?.error_msg || response.status}`);
  return result?.response;
}

const randomId = () => Math.floor(Math.random() * 2147483647) || 1;

export async function deactivateVkActiveUi(peerId) {
  const key = String(peerId);
  let messageId = vkActiveUi.get(key) || null;
  if (!messageId) {
    const state = await loadDurableUiState('vk', peerId);
    messageId = state[ACTIVE_UI_KEY] || null;
  }
  if (!messageId) return;
  vkActiveUi.delete(key);
  await vk('messages.edit', {
    peer_id: peerId, message_id: messageId, keyboard: JSON.stringify({ inline: true, buttons: [] }),
  }).catch(() => {});
}

export async function sendVk(peerId, text, extra = {}) {
  const interactive = hasVkKeyboard(extra.keyboard);
  let durableState = null;
  if (interactive) {
    durableState = await loadDurableUiState('vk', peerId);
    const previous = vkActiveUi.get(String(peerId)) || durableState[ACTIVE_UI_KEY] || null;
    if (previous) {
      await vk('messages.edit', {
        peer_id: peerId, message_id: previous, keyboard: JSON.stringify({ inline: true, buttons: [] }),
      }).catch(() => {});
    }
    vkActiveUi.delete(String(peerId));
  }
  const messageId = await vk('messages.send', {
    peer_id: peerId, random_id: randomId(), message: String(text || '').replace(/<[^>]+>/g, ''), ...extra,
  });
  if (interactive && messageId) {
    vkActiveUi.set(String(peerId), messageId);
    await saveDurableUiState('vk', peerId, durableState || {}, messageId);
  }
  return messageId;
}

export async function sendVkAttachment(peerId, attachment, text = '') {
  if (!attachment) return null;
  return sendVk(peerId, text, { attachment });
}

export function vkInlineButton(label, command, color = 'primary') {
  return { action: { type: 'callback', label, payload: JSON.stringify({ cmd: command }) }, color };
}
export function vkInlineKeyboard(rows) { return JSON.stringify({ inline: true, buttons: rows }); }
export function tgInlineKeyboard(rows) { return { inline_keyboard: rows }; }

export async function uploadTelegramFileToVk(fileId, fileName = 'file.bin') {
  const { buffer } = await getTelegramFile(fileId);
  const uploadServer = await vk('docs.getMessagesUploadServer', { peer_id: OWNER_VK_ID || undefined, type: 'doc' });
  if (!uploadServer?.upload_url) throw new Error('VK returned no document upload URL');
  const form = new FormData();
  form.append('file', new Blob([buffer]), fileName || 'file.bin');
  const uploadResponse = await fetch(uploadServer.upload_url, { method: 'POST', body: form });
  const uploaded = await uploadResponse.json().catch(() => null);
  if (!uploadResponse.ok || !uploaded?.file) throw new Error(`VK document upload failed: ${uploadResponse.status}`);
  const saved = await vk('docs.save', { file: uploaded.file, title: fileName || 'TutorOS file' });
  const doc = saved?.doc || (Array.isArray(saved) ? saved[0] : saved);
  if (!doc?.owner_id || !doc?.id) throw new Error('VK docs.save returned no document');
  return `doc${doc.owner_id}_${doc.id}${doc.access_key ? `_${doc.access_key}` : ''}`;
}

function parseVkAttachment(ref) {
  const match = String(ref || '').match(/^(doc|photo)(-?\d+)_(\d+)(?:_([^_]+))?$/);
  return match ? { type: match[1], ownerId: match[2], id: match[3], accessKey: match[4] || null } : null;
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
  return [...sizes].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]?.url || null;
}

export async function sendStudentEverywhere(student, {
  text, telegramReplyMarkup, vkKeyboard, telegramFileId = null, vkAttachment = null,
} = {}) {
  const result = { telegram: null, vk: null };
  const tasks = [];
  if (student?.telegram_id) tasks.push((async () => {
    try {
      await sendTelegram(student.telegram_id, text, telegramReplyMarkup ? { reply_markup: telegramReplyMarkup } : {});
      if (telegramFileId) await sendTelegramDocument(student.telegram_id, telegramFileId);
      result.telegram = true;
    } catch (error) {
      console.error(`Telegram delivery failed for ${student.id}:`, error?.message || error); result.telegram = false;
    }
  })());
  if (student?.vk_id) tasks.push((async () => {
    try {
      await sendVk(student.vk_id, text, vkKeyboard ? { keyboard: vkKeyboard } : {});
      if (vkAttachment) await sendVkAttachment(student.vk_id, vkAttachment);
      result.vk = true;
    } catch (error) {
      console.error(`VK delivery failed for ${student.id}:`, error?.message || error); result.vk = false;
    }
  })());
  await Promise.all(tasks);
  return result;
}
