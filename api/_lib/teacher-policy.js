import {
  sendTelegram,
  sendVk,
  telegram,
  tgInlineKeyboard,
  vkInlineButton,
  vkInlineKeyboard,
} from './channels.js';

const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const OWNER_VK_ID = process.env.OWNER_VK_ID;
const VK_GROUP_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB = {
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

async function session(table, idField, id) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return {};
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${idField}=eq.${encodeURIComponent(id)}&select=state&limit=1`,
    { headers: SB },
  );
  if (!response.ok) return {};
  const rows = await response.json().catch(() => []);
  return rows[0]?.state || {};
}

function detachedHomeworkGroup(data) {
  const parts = String(data || '').split(':');
  return parts[0] === 'teacher' && parts[1] === 'newhw' && parts.length === 3
    ? parts[2]
    : null;
}

function validMaxScore(text) {
  const raw = String(text || '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return false;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0;
}

async function answerVk(update) {
  const object = update?.object || {};
  if (!VK_GROUP_TOKEN || !object.event_id) return;
  const body = new URLSearchParams({
    access_token: VK_GROUP_TOKEN,
    v: VK_API_VERSION,
    event_id: String(object.event_id),
    user_id: String(object.user_id),
    peer_id: String(object.peer_id),
    event_data: JSON.stringify({ type: 'show_snackbar', text: '✓' }),
  });
  await fetch('https://api.vk.com/method/messages.sendMessageEventAnswer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(() => {});
}

function vkCommand(update) {
  if (update?.type !== 'message_event') return '';
  let payload = update?.object?.payload || {};
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  return String(payload.cmd || payload.command || '');
}

export async function handleTelegramTeacherPolicy(update) {
  const userId = update?.message?.from?.id || update?.callback_query?.from?.id;
  if (!userId || !OWNER_TELEGRAM_ID || String(userId) !== String(OWNER_TELEGRAM_ID)) return false;

  if (update?.callback_query) {
    const q = update.callback_query;
    const data = String(q.data || '');
    const chatId = q.message?.chat?.id;
    const groupId = detachedHomeworkGroup(data);
    if (groupId) {
      await telegram('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
      if (chatId) {
        await sendTelegram(chatId, 'ДЗ создаётся только из конкретного занятия. Открой занятие и нажми «Создать ДЗ».', {
          reply_markup: tgInlineKeyboard([[
            { text: '🎓 К занятиям', callback_data: `teacher:lessons:${groupId}` },
          ]]),
        });
      }
      return true;
    }

    if (data === 'teacher:hwconfirm') {
      const state = await session('telegram_sessions', 'telegram_user_id', userId);
      if (state.step === 'teacher_hw_confirm' && !state.data?.lesson_id) {
        await telegram('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
        const groupId = state.data?.group_id;
        if (chatId) {
          await sendTelegram(chatId, 'Не отправляю ДЗ без привязки к занятию. Открой нужное занятие и создай ДЗ из него.', groupId ? {
            reply_markup: tgInlineKeyboard([[
              { text: '🎓 К занятиям', callback_data: `teacher:lessons:${groupId}` },
            ]]),
          } : {});
        }
        return true;
      }
    }
  }

  if (update?.message?.text) {
    const state = await session('telegram_sessions', 'telegram_user_id', userId);
    if (state.step === 'teacher_hw_config' && state.data?.hw_type !== 'brief') {
      if (!validMaxScore(update.message.text)) {
        await sendTelegram(update.message.chat.id, 'Введи один максимальный балл за всё ДЗ. Например: <code>10</code>.');
        return true;
      }
    }
  }

  return false;
}

export async function handleVkTeacherPolicy(update) {
  const userId = update?.object?.message?.from_id || update?.object?.user_id;
  const peerId = update?.object?.message?.peer_id || update?.object?.peer_id;
  if (!userId || !OWNER_VK_ID || String(userId) !== String(OWNER_VK_ID)) return false;

  if (update?.type === 'message_event') {
    const data = vkCommand(update);
    const groupId = detachedHomeworkGroup(data);
    if (groupId) {
      await answerVk(update);
      if (peerId) {
        await sendVk(peerId, 'ДЗ создаётся только из конкретного занятия. Открой занятие и нажми «Создать ДЗ».', {
          keyboard: vkInlineKeyboard([[
            vkInlineButton('🎓 К занятиям', `teacher:lessons:${groupId}`),
          ]]),
        });
      }
      return true;
    }

    if (data === 'teacher:hwconfirm') {
      const state = await session('vk_sessions', 'vk_user_id', userId);
      if (state.step === 'teacher_hw_confirm' && !state.data?.lesson_id) {
        await answerVk(update);
        const groupId = state.data?.group_id;
        if (peerId) {
          await sendVk(peerId, 'Не отправляю ДЗ без привязки к занятию. Открой нужное занятие и создай ДЗ из него.', groupId ? {
            keyboard: vkInlineKeyboard([[
              vkInlineButton('🎓 К занятиям', `teacher:lessons:${groupId}`),
            ]]),
          } : {});
        }
        return true;
      }
    }
  }

  if (update?.type === 'message_new') {
    const text = String(update?.object?.message?.text || '').trim();
    if (text) {
      const state = await session('vk_sessions', 'vk_user_id', userId);
      if (state.step === 'teacher_hw_config' && state.data?.hw_type !== 'brief' && !validMaxScore(text)) {
        await sendVk(peerId, 'Введи один максимальный балл за всё ДЗ. Например: 10.');
        return true;
      }
    }
  }

  return false;
}
