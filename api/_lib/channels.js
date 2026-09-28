import { AsyncLocalStorage } from 'node:async_hooks';
import {
  sendStudentEverywhere as baseSendStudentEverywhere,
  sendTelegram as baseSendTelegram,
  sendVk as baseSendVk,
  telegram as baseTelegram,
  tgInlineKeyboard,
  vkInlineButton,
  vkInlineKeyboard,
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

function canonicalCallback(value) {
  const data = String(value || '');
  // Student submission notifications used the pre-teacher-core callback name.
  // Normalize it here so old and new producers both open the canonical review.
  if (data.startsWith('review:')) return `teacher:review:${data.slice('review:'.length)}`;
  return data;
}

function studentButtonLabel(label) {
  const text = String(label || '');
  if (text === '📚 Задания' || text === '📚 задания' || text === '📚 мои задания') return '✅ Надо выполнить';
  if (text === '← К заданиям' || text === '← к заданиям') return '← К списку';
  return text;
}

function isDetachedHomeworkCreate(callbackData) {
  const parts = String(callbackData || '').split(':');
  return parts[0] === 'teacher' && parts[1] === 'newhw' && parts.length === 3;
}

function normalizeTelegramReplyMarkup(replyMarkup) {
  if (!Array.isArray(replyMarkup?.inline_keyboard)) return replyMarkup;
  const inline_keyboard = replyMarkup.inline_keyboard
    .map(row => (Array.isArray(row) ? row : []).map(button => {
      if (!button || typeof button !== 'object') return button;
      const callback_data = button.callback_data ? canonicalCallback(button.callback_data) : button.callback_data;
      return {
        ...button,
        text: studentButtonLabel(button.text),
        ...(callback_data ? { callback_data } : {}),
      };
    }).filter(button => !isDetachedHomeworkCreate(button?.callback_data)))
    .filter(row => row.length);
  return { ...replyMarkup, inline_keyboard };
}

function normalizeVkKeyboard(keyboard) {
  if (!keyboard) return keyboard;
  let parsed;
  try { parsed = typeof keyboard === 'string' ? JSON.parse(keyboard) : structuredClone(keyboard); }
  catch { return keyboard; }
  if (!Array.isArray(parsed?.buttons)) return keyboard;
  parsed.buttons = parsed.buttons
    .map(row => (Array.isArray(row) ? row : []).map(button => {
      if (!button?.action) return button;
      let payload = button.action.payload;
      let command = '';
      if (payload) {
        try {
          const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
          command = canonicalCallback(value?.cmd || value?.command || '');
          if (command) payload = JSON.stringify({ ...value, cmd: command });
        } catch { /* keep unknown payloads untouched */ }
      }
      return {
        ...button,
        action: {
          ...button.action,
          label: studentButtonLabel(button.action.label),
          ...(payload ? { payload } : {}),
        },
      };
    }).filter(button => {
      try {
        const payload = typeof button?.action?.payload === 'string'
          ? JSON.parse(button.action.payload)
          : button?.action?.payload;
        return !isDetachedHomeworkCreate(payload?.cmd || payload?.command || '');
      } catch { return true; }
    }))
    .filter(row => row.length);
  return typeof keyboard === 'string' ? JSON.stringify(parsed) : parsed;
}

function normalizeTutorText(value) {
  let text = String(value ?? '');
  text = text
    .replace('Здесь задания, занятия и твои результаты.', 'Здесь то, что надо выполнить, занятия и твои результаты.')
    .replace(/Введи максимальные баллы за задания[^\n]*/giu, 'Введи максимальный балл за ДЗ одним числом. Например: 10.')
    .replace(/баллы по заданиям:/giu, 'максимальный балл:');

  // Recording notifications should not leak the recording URL before the
  // student explicitly opens the lesson. The URL remains in lesson materials.
  if (/^🎥/u.test(text)) {
    text = text.split('\n').filter(line => !/^https?:\/\//iu.test(line.trim())).join('\n').trim();
  }
  return text;
}

function lazyMaterialPayload(payload = {}) {
  const text = normalizeTutorText(payload.text || '');
  const isNotes = /^📝\s*(новый\s+конспект|Конспект)/iu.test(text);
  const isRecording = /^🎥/u.test(text);

  let telegramReplyMarkup = normalizeTelegramReplyMarkup(payload.telegramReplyMarkup);
  let vkKeyboard = normalizeVkKeyboard(payload.vkKeyboard);

  // Notes/recordings are notifications only. Resource delivery starts after an
  // explicit Open click; cjm:lessons then shows the exact lesson/material card.
  if ((isNotes || isRecording) && !telegramReplyMarkup) {
    telegramReplyMarkup = tgInlineKeyboard([[
      { text: 'Открыть', callback_data: 'cjm:lessons' },
    ]]);
  }
  if ((isNotes || isRecording) && !vkKeyboard) {
    vkKeyboard = vkInlineKeyboard([[
      vkInlineButton('Открыть', 'cjm:lessons'),
    ]]);
  }

  return {
    ...payload,
    text,
    telegramReplyMarkup,
    vkKeyboard,
    // Never push homework/material files proactively. Homework cards and lesson
    // materials deliver them only after the student asks to open the resource.
    telegramFileId: null,
    vkAttachment: null,
  };
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

  const normalizedPayload = method === 'sendMessage' || method === 'editMessageText'
    ? {
      ...payload,
      text: normalizeTutorText(payload.text),
      ...(payload.reply_markup ? { reply_markup: normalizeTelegramReplyMarkup(payload.reply_markup) } : {}),
    }
    : method === 'editMessageReplyMarkup' && payload.reply_markup
      ? { ...payload, reply_markup: normalizeTelegramReplyMarkup(payload.reply_markup) }
      : payload;

  return baseTelegram(method, normalizedPayload);
}

export async function sendTelegram(chatId, text, extra = {}) {
  const state = telegramScreenTransitions.getStore();
  const chatKey = String(chatId);
  const target = state?.editTargets?.get(chatKey) || null;
  const normalizedText = normalizeTutorText(text);
  const normalizedExtra = extra?.reply_markup
    ? { ...extra, reply_markup: normalizeTelegramReplyMarkup(extra.reply_markup) }
    : extra;

  if (target) {
    state.editTargets.delete(chatKey);
    try {
      return await baseTelegram('editMessageText', {
        chat_id: chatId,
        message_id: target.message_id,
        text: normalizedText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: normalizedExtra.reply_markup || { inline_keyboard: [] },
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

  return baseSendTelegram(chatId, normalizedText, normalizedExtra);
}

export async function sendVk(peerId, text, extra = {}) {
  const normalizedExtra = extra?.keyboard
    ? { ...extra, keyboard: normalizeVkKeyboard(extra.keyboard) }
    : extra;
  return baseSendVk(peerId, normalizeTutorText(text), normalizedExtra);
}

export async function sendStudentEverywhere(student, payload = {}) {
  return baseSendStudentEverywhere(student, lazyMaterialPayload(payload));
}
