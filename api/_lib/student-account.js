import {
  linkStudentChannel,
  studentByTelegram,
  studentByToken,
  studentByVk,
} from './student-core.js';
import { unlinkStudentEverywhere } from './teacher-core.js';
import {
  sendTelegram,
  sendVk,
  tgInlineKeyboard,
  vkInlineButton,
  vkInlineKeyboard,
} from './channels.js';

const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const OWNER_VK_ID = process.env.OWNER_VK_ID;

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const isUnlinkCommand = text => /^\/unlink(?:@[a-z0-9_]+)?$/i.test(String(text || '').trim());

function tgHome() {
  return tgInlineKeyboard([
    [{ text: '📚 Задания', callback_data: 'cjm:hw' }],
    [{ text: '🎓 Занятия', callback_data: 'cjm:lessons' }],
    [{ text: '📊 Результаты', callback_data: 'cjm:results' }],
  ]);
}
function vkHome() {
  return vkInlineKeyboard([
    [vkInlineButton('📚 Задания', 'cjm:hw')],
    [vkInlineButton('🎓 Занятия', 'cjm:lessons')],
    [vkInlineButton('📊 Результаты', 'cjm:results')],
  ]);
}
function linkedText(name) {
  return `ты подключен как <b>${esc(name)}</b>.\n\nесли это не ты, напиши команду /unlink сюда, а после мне в личку!`;
}

export async function handleTelegramStudentAccount(update) {
  const message = update?.message;
  const userId = message?.from?.id;
  const chatId = message?.chat?.id;
  if (!userId || !chatId || (OWNER_TELEGRAM_ID && String(userId) === String(OWNER_TELEGRAM_ID))) return false;
  const text = String(message.text || '').trim();

  if (isUnlinkCommand(text)) {
    const student = await studentByTelegram(userId);
    if (!student) {
      await sendTelegram(chatId, 'этот Telegram сейчас не привязан к профилю ученика.');
      return true;
    }
    await unlinkStudentEverywhere(student.id);
    await sendTelegram(chatId, 'готово. профиль отвязан и от Telegram, и от VK. теперь открой правильную ссылку подключения.');
    return true;
  }

  if (!text.startsWith('/start ')) return false;
  const current = await studentByTelegram(userId);
  if (current) {
    await sendTelegram(chatId, `ты уже подключен как <b>${esc(current.name)}</b>. если это не ты — сначала отправь /unlink.`);
    return true;
  }
  const candidate = await studentByToken(text.slice(7));
  if (!candidate) {
    await sendTelegram(chatId, 'ссылка недействительна. попроси преподавателя прислать новую.');
    return true;
  }
  const linked = await linkStudentChannel(candidate, 'telegram', userId);
  if (!linked?.ok) {
    await sendTelegram(chatId, 'эта ссылка уже привязана к другому Telegram-аккаунту. напиши преподавателю.');
    return true;
  }
  await sendTelegram(chatId, linkedText(linked.student.name), { reply_markup: tgHome() });
  return true;
}

function normalizeVkMessage(update) {
  const message = update?.type === 'message_new' ? update?.object?.message : null;
  if (!message) return null;
  return {
    userId: message.from_id,
    peerId: message.peer_id,
    text: String(message.text || '').trim(),
    ref: message.ref || update.object?.ref || null,
  };
}

export async function handleVkStudentAccount(update) {
  const message = normalizeVkMessage(update);
  if (!message?.userId || !message?.peerId || (OWNER_VK_ID && String(message.userId) === String(OWNER_VK_ID))) return false;

  if (isUnlinkCommand(message.text)) {
    const student = await studentByVk(message.userId);
    if (!student) {
      await sendVk(message.peerId, 'этот VK сейчас не привязан к профилю ученика.');
      return true;
    }
    await unlinkStudentEverywhere(student.id);
    await sendVk(message.peerId, 'готово. профиль отвязан и от Telegram, и от VK. теперь открой правильную ссылку подключения.');
    return true;
  }

  const token = message.ref || (message.text && !message.text.startsWith('/') ? message.text : null);
  if (!token) return false;
  const current = await studentByVk(message.userId);
  if (current) {
    await sendVk(message.peerId, `ты уже подключен как ${current.name}. если это не ты — сначала отправь /unlink.`);
    return true;
  }
  const candidate = await studentByToken(token);
  if (!candidate) return false;
  const linked = await linkStudentChannel(candidate, 'vk', message.userId);
  if (!linked?.ok) {
    await sendVk(message.peerId, 'эта ссылка уже привязана к другому VK-аккаунту. напиши преподавателю.');
    return true;
  }
  await sendVk(message.peerId,
    `ты подключен как ${linked.student.name}.\n\nесли это не ты, напиши команду /unlink сюда, а после мне в личку!`,
    { keyboard: vkHome() });
  return true;
}
