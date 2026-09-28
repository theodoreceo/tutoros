import {
  sendStudentEverywhere,
  sendTelegram,
  uploadTelegramFileToVk,
} from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;

const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const botId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function sbSelect(table, qs = '') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB });
  if (!response.ok) throw new Error(`sbSelect ${table}: ${await response.text()}`);
  return response.json();
}
async function sbOne(table, qs) {
  const rows = await sbSelect(table, `${qs}&limit=1`);
  return rows[0] ?? null;
}
async function sbInsert(table, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbInsert ${table}: ${await response.text()}`);
  return response.json();
}
async function sbUpsert(table, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbUpsert ${table}: ${await response.text()}`);
  return response.json();
}

function ownerHomeKeyboard() {
  return { inline_keyboard: [
    [{ text: '👥 группы', callback_data: 'owner:groups' }, { text: '🕒 непроверено', callback_data: 'owner:unchecked' }],
    [{ text: '📚 новое ДЗ', callback_data: 'owner:newhw' }],
    [{ text: '📝 конспект', callback_data: 'owner:notes' }, { text: '🎥 запись', callback_data: 'owner:recording' }],
  ] };
}

export async function handleTelegramNotesUpload(update) {
  const message = update?.message;
  const userId = message?.from?.id;
  const chatId = message?.chat?.id;
  if (!userId || !chatId || !OWNER_TELEGRAM_ID || String(userId) !== String(OWNER_TELEGRAM_ID)) return false;

  const telegramFileId = message.document?.file_id || message.photo?.[message.photo.length - 1]?.file_id;
  if (!telegramFileId) return false;

  const sessionRow = await sbOne('telegram_sessions',
    `telegram_user_id=eq.${encodeURIComponent(userId)}&select=state`);
  const session = sessionRow?.state || {};
  if (session.step !== 'notes_file' || !session.data?.group_id) return false;

  const fileName = message.document?.file_name || `photo-${Date.now()}.jpg`;
  let vkAttachment = null;
  let vkMirrorError = null;
  try {
    vkAttachment = await uploadTelegramFileToVk(telegramFileId, fileName);
  } catch (error) {
    vkMirrorError = error;
    console.warn('TG→VK notes mirror failed; keeping Telegram original:', error?.message || error);
  }

  const lesson = await sbOne('lessons',
    `group_id=eq.${encodeURIComponent(session.data.group_id)}` +
      '&active=eq.true&order=sequence.desc&select=id,topic');
  const title = lesson?.topic
    ? `Конспект · ${lesson.topic}`
    : `Конспект · ${session.data.group_name || 'занятие'}`;

  await sbInsert('lesson_materials', {
    id: botId(),
    group_id: session.data.group_id,
    lesson_id: lesson?.id || null,
    material_type: 'notes',
    title,
    telegram_file_id: telegramFileId,
    vk_attachment: vkAttachment,
    file_name: fileName,
  });

  const students = await sbSelect('students',
    `group_id=eq.${encodeURIComponent(session.data.group_id)}` +
      '&status=eq.active&select=id,name,vk_id,telegram_id');
  await Promise.all(students.map(student => sendStudentEverywhere(student, {
    text: `📝 новый конспект: <b>${esc(title)}</b>` +
      (student.vk_id && !vkAttachment ? '\nVK-копия временно недоступна — конспект уже есть в Telegram.' : ''),
    telegramFileId,
    vkAttachment,
  })));

  await sbUpsert('telegram_sessions', {
    telegram_user_id: userId,
    state: { step: 'owner' },
    updated_at: new Date().toISOString(),
  });

  await sendTelegram(chatId,
    vkMirrorError
      ? `✅ конспект сохранён и отправлен в Telegram.\n⚠️ VK-копию создать не удалось, но материал не потерян.`
      : `✅ конспект отправлен ${students.length} ученикам в подключённые каналы.`, {
      reply_markup: ownerHomeKeyboard(),
    });
  return true;
}
