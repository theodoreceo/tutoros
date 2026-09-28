import {
  resolveVkAttachmentUrl,
  sendTelegram,
  sendTelegramDocument,
  sendVk,
  sendVkAttachment,
} from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const VK_GROUP_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const HW_STORAGE_BUCKET = 'homework-materials';
const HW_STORAGE_PREFIX = 'storage:';
const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

async function sbOne(table, qs) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`, { headers: SB });
  if (!response.ok) throw new Error(`sbOne ${table}: ${await response.text()}`);
  const rows = await response.json();
  return rows[0] ?? null;
}

const storageObjectPath = path => String(path || '')
  .split('/')
  .map(part => encodeURIComponent(part))
  .join('/');

async function signedHomeworkUrl(fileRef) {
  if (!String(fileRef || '').startsWith(HW_STORAGE_PREFIX)) return null;
  const path = String(fileRef).slice(HW_STORAGE_PREFIX.length);
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${HW_STORAGE_BUCKET}/${storageObjectPath(path)}`,
    {
      method: 'POST',
      headers: SB,
      body: JSON.stringify({ expiresIn: 600 }),
    },
  );
  if (!response.ok) return null;
  const result = await response.json().catch(() => null);
  const signed = result?.signedURL || result?.signedUrl;
  if (!signed) return null;
  return /^https?:\/\//i.test(signed) ? signed : `${SUPABASE_URL}${signed}`;
}

async function assignmentForSubmission(studentId, submissionId) {
  const submission = await sbOne(
    'homework_submissions',
    `id=eq.${encodeURIComponent(submissionId)}&student_id=eq.${encodeURIComponent(studentId)}` +
      '&status=in.(assigned,submitted,checked)&select=id,assignment_id',
  );
  if (!submission) return null;
  return sbOne(
    'homework_assignments',
    `id=eq.${encodeURIComponent(submission.assignment_id)}&archived_at=is.null` +
      '&select=id,topic,file_id,telegram_file_id,material_name',
  );
}

async function latestMaterial(groupId, type) {
  return sbOne(
    'lesson_materials',
    `group_id=eq.${encodeURIComponent(groupId)}&material_type=eq.${encodeURIComponent(type)}` +
      '&order=created_at.desc&select=id,title,external_url,telegram_file_id,vk_attachment,file_name',
  );
}

async function sendTelegramHomework(chatId, assignment) {
  if (!assignment) return sendTelegram(chatId, 'Задание не найдено.');
  if (assignment.telegram_file_id) {
    return sendTelegramDocument(chatId, assignment.telegram_file_id, assignment.material_name || assignment.topic || 'Задание');
  }
  if (String(assignment.file_id || '').startsWith(HW_STORAGE_PREFIX)) {
    const url = await signedHomeworkUrl(assignment.file_id);
    if (url) return sendTelegramDocument(chatId, url, assignment.material_name || assignment.topic || 'Задание');
  }
  if (assignment.file_id) {
    const url = await resolveVkAttachmentUrl(assignment.file_id).catch(() => null);
    if (url) return sendTelegramDocument(chatId, url, assignment.material_name || assignment.topic || 'Задание');
  }
  return sendTelegram(chatId, 'У этого ДЗ нет отдельного файла.');
}

async function sendVkHomework(peerId, assignment) {
  if (!assignment) return sendVk(peerId, 'Задание не найдено.');
  if (assignment.file_id && !String(assignment.file_id).startsWith(HW_STORAGE_PREFIX)) {
    return sendVkAttachment(peerId, assignment.file_id, assignment.material_name || assignment.topic || 'Задание');
  }
  if (String(assignment.file_id || '').startsWith(HW_STORAGE_PREFIX)) {
    const url = await signedHomeworkUrl(assignment.file_id);
    if (url) return sendVk(peerId, `${assignment.material_name || assignment.topic || 'Задание'}\n${url}`);
  }
  return sendVk(peerId, 'У этого ДЗ нет отдельного файла.');
}

async function sendTelegramMaterial(chatId, material, type) {
  if (!material) return sendTelegram(chatId, type === 'recording' ? 'Запись пока не найдена.' : 'Конспект пока не найден.');
  if (type === 'recording') {
    return material.external_url
      ? sendTelegram(chatId, `🎥 ${material.title || 'Запись занятия'}\n${material.external_url}`)
      : sendTelegram(chatId, 'Ссылка на запись пока не добавлена.');
  }
  if (material.telegram_file_id) {
    return sendTelegramDocument(chatId, material.telegram_file_id, material.file_name || material.title || 'Конспект');
  }
  if (material.vk_attachment) {
    const url = await resolveVkAttachmentUrl(material.vk_attachment).catch(() => null);
    if (url) return sendTelegramDocument(chatId, url, material.file_name || material.title || 'Конспект');
  }
  return sendTelegram(chatId, 'Файл конспекта пока не найден.');
}

async function sendVkMaterial(peerId, material, type) {
  if (!material) return sendVk(peerId, type === 'recording' ? 'Запись пока не найдена.' : 'Конспект пока не найден.');
  if (type === 'recording') {
    return material.external_url
      ? sendVk(peerId, `🎥 ${material.title || 'Запись занятия'}\n${material.external_url}`)
      : sendVk(peerId, 'Ссылка на запись пока не добавлена.');
  }
  if (material.vk_attachment) {
    return sendVkAttachment(peerId, material.vk_attachment, material.file_name || material.title || 'Конспект');
  }
  return sendVk(peerId, 'Файл конспекта пока не найден.');
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
    event_data: JSON.stringify({ type: 'show_snackbar', text: 'Открываю' }),
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

export async function handleTelegramNotificationOpen(update) {
  const query = update?.callback_query;
  const data = String(query?.data || '');
  if (!data.startsWith('notify:')) return false;
  const userId = query?.from?.id;
  const chatId = query?.message?.chat?.id;
  if (!userId || !chatId) return false;
  const student = await sbOne('students', `telegram_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,group_id`);
  if (!student) return false;

  if (data.startsWith('notify:homework:')) {
    const assignment = await assignmentForSubmission(student.id, data.slice('notify:homework:'.length));
    await sendTelegramHomework(chatId, assignment);
    return true;
  }
  if (data === 'notify:notes') {
    await sendTelegramMaterial(chatId, await latestMaterial(student.group_id, 'notes'), 'notes');
    return true;
  }
  if (data === 'notify:recording') {
    await sendTelegramMaterial(chatId, await latestMaterial(student.group_id, 'recording'), 'recording');
    return true;
  }
  return false;
}

export async function handleVkNotificationOpen(update) {
  const data = vkCommand(update);
  if (!data.startsWith('notify:')) return false;
  const userId = update?.object?.user_id;
  const peerId = update?.object?.peer_id;
  if (!userId || !peerId) return false;
  const student = await sbOne('students', `vk_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,group_id`);
  if (!student) return false;
  await answerVk(update);

  if (data.startsWith('notify:homework:')) {
    const assignment = await assignmentForSubmission(student.id, data.slice('notify:homework:'.length));
    await sendVkHomework(peerId, assignment);
    return true;
  }
  if (data === 'notify:notes') {
    await sendVkMaterial(peerId, await latestMaterial(student.group_id, 'notes'), 'notes');
    return true;
  }
  if (data === 'notify:recording') {
    await sendVkMaterial(peerId, await latestMaterial(student.group_id, 'recording'), 'recording');
    return true;
  }
  return false;
}
