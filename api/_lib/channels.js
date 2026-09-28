import { AsyncLocalStorage } from 'node:async_hooks';
import {
  telegram as baseTelegram,
  sendTelegram as baseSendTelegram,
} from './channels-optimized.js';

export * from './channels-optimized.js';

// Canonical Telegram navigation layer.
// Legacy/student/teacher handlers still express screen changes as
// deleteMessage -> sendMessage. We treat that pair as an edit target instead
// of actually deleting the current screen. If rendering the next screen fails,
// the old screen remains visible and usable rather than disappearing.
const telegramScreenTransitions = new AsyncLocalStorage();

export async function withTelegramUiTransition(callback) {
  return telegramScreenTransitions.run({ editTargets: new Map(), ackedCallbacks: new Set() }, callback);
}

export async function telegram(method, payload = {}) {
  const state = telegramScreenTransitions.getStore();
  const chatKey = payload?.chat_id === undefined || payload?.chat_id === null
    ? null
    : String(payload.chat_id);

  if (state && method === 'answerCallbackQuery' && payload.callback_query_id) {
    const callbackId = String(payload.callback_query_id);
    if (state.ackedCallbacks.has(callbackId)) return true;
    state.ackedCallbacks.add(callbackId);
  }

  if (state && method === 'deleteMessage' && chatKey && payload.message_id) {
    state.editTargets.set(chatKey, {
      chat_id: payload.chat_id,
      message_id: payload.message_id,
    });
    return true;
  }

  return baseTelegram(method, payload);
}

export async function sendTelegram(chatId, text, extra = {}) {
  const state = telegramScreenTransitions.getStore();
  const chatKey = String(chatId);
  const target = state?.editTargets?.get(chatKey) || null;

  if (target) {
    state.editTargets.delete(chatKey);
    try {
      return await baseTelegram('editMessageText', {
        chat_id: chatId,
        message_id: target.message_id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: extra.reply_markup || { inline_keyboard: [] },
      });
    } catch (error) {
      if (/message is not modified/i.test(String(error?.message || error))) {
        return { message_id: target.message_id, chat: { id: chatId } };
      }

      // Never delete the old screen as a fallback. At worst remove its buttons
      // and send the new screen. This avoids the blank-chat failure mode.
      await baseTelegram('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: target.message_id,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }
  }

  return baseSendTelegram(chatId, text, extra);
}
