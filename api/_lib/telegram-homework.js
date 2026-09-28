import {
  getTelegramFile,
  resolveVkAttachmentUrl,
  sendStudentEverywhere,
  sendTelegram,
  sendTelegramDocument,
  telegram,
  tgInlineKeyboard,
  vkInlineButton,
  vkInlineKeyboard,
} from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const HW_STORAGE_BUCKET = 'homework-materials';
const HW_STORAGE_PREFIX = 'storage:';

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

async function sbPatch(table, qs, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbPatch ${table}: ${await response.text()}`);
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

async function sbRpc(fn, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: SB, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbRpc ${fn}: ${await response.text()}`);
  return response.json();
}

function storageObjectPath(path) {
  return String(path || '').split('/').map(part => encodeURIComponent(part)).join('/');
}

function safePdfName(value) {
  const base = String(value || 'homework.pdf')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'homework.pdf';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

async function ensureHomeworkStorageBucket() {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: SB,
    body: JSON.stringify({
      id: HW_STORAGE_BUCKET,
      name: HW_STORAGE_BUCKET,
      public: false,
      file_size_limit: 20 * 1024 * 1024,
      allowed_mime_types: ['application/pdf'],
    }),
  });
  if (response.ok) return;
  const text = await response.text();
  if ((response.status === 400 || response.status === 409) && /already exists|duplicate/i.test(text)) return;
  throw new Error(`storage bucket: ${text || response.status}`);
}

async function uploadHomeworkPdf(path, bytes) {
  await ensureHomeworkStorageBucket();
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${HW_STORAGE_BUCKET}/${storageObjectPath(path)}`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/pdf',
        'x-upsert': 'true',
      },
      body: bytes,
    },
  );
  if (!response.ok) throw new Error(`storage upload: ${await response.text()}`);
}

async function signedHomeworkUrl(materialRef) {
  if (!String(materialRef || '').startsWith(HW_STORAGE_PREFIX)) return null;
  const path = String(materialRef).slice(HW_STORAGE_PREFIX.length);
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${HW_STORAGE_BUCKET}/${storageObjectPath(path)}`,
    {
      method: 'POST',
      headers: SB,
      body: JSON.stringify({ expiresIn: 600 }),
    },
  );
  if (!response.ok) throw new Error(`storage sign: ${await response.text()}`);
  const result = await response.json();
  const signed = result?.signedURL || result?.signedUrl;
  if (!signed) throw new Error('storage sign returned no URL');
  return /^https?:\/\//i.test(signed) ? signed : `${SUPABASE_URL}${signed}`;
}

function moscowDateParts(iso = new Date().toISOString()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { iso: `${values.year}-${values.month}-${values.day}`, short: `${values.day}.${values.month}` };
}

async function ensureCurrentManualLesson(groupId, topic) {
  const today = moscowDateParts();
  const current = await sbOne('lessons',
    `group_id=eq.${encodeURIComponent(groupId)}` +
    '&active=eq.true&sheet_lesson_key=like.manual:*&order=created_at.desc' +
    '&select=id,topic,created_at');
  if (current?.created_at && moscowDateParts(current.created_at).iso === today.iso) {
    if (topic && /^Урок \d{2}\.\d{2}$/u.test(String(current.topic || ''))) {
      await sbPatch('lessons', `id=eq.${encodeURIComponent(current.id)}`, {
        topic,
        updated_at: new Date().toISOString(),
      });
    }
    return current.id;
  }

  const latest = await sbOne('lessons',
    `group_id=eq.${encodeURIComponent(groupId)}&order=sequence.desc&select=sequence`);
  const sequence = Math.max(0, Number(latest?.sequence) || 0) + 1;
  const lessonId = botId();
  const now = new Date().toISOString();
  await sbInsert('lessons', {
    id: lessonId,
    group_id: groupId,
    sheet_lesson_key: `manual:${lessonId}`,
    lesson_number: String(sequence),
    sequence,
    topic: topic || `Урок ${today.short}`,
    event_type: 'lesson',
    scheduled_date: null,
    active: true,
    created_at: now,
    updated_at: now,
  });
  return lessonId;
}

function ownerHomeKeyboard() {
  return tgInlineKeyboard([
    [{ text: '👥 группы', callback_data: 'owner:groups' }, { text: '🕒 непроверено', callback_data: 'owner:unchecked' }],
    [{ text: '📚 новое ДЗ', callback_data: 'owner:newhw' }],
    [{ text: '📝 конспект', callback_data: 'owner:notes' }, { text: '🎥 запись', callback_data: 'owner:recording' }],
  ]);
}

async function createHomeworkFromTelegramPdf(message, session) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const document = message.document;
  const fileName = document?.file_name || 'homework.pdf';
  const mimeType = String(document?.mime_type || '').toLowerCase();
  if (!document?.file_id) return false;

  if (!fileName.toLowerCase().endsWith('.pdf') && mimeType !== 'application/pdf') {
    await sendTelegram(chatId, 'для ДЗ пришли именно PDF-файл документом.');
    return true;
  }
  if (Number(document.file_size || 0) > 20 * 1024 * 1024) {
    await sendTelegram(chatId, 'PDF больше 20 МБ. сожми файл и отправь ещё раз.');
    return true;
  }

  const students = await sbSelect('students',
    `group_id=eq.${encodeURIComponent(session.data.group_id)}&status=eq.active&select=id,name,vk_id,telegram_id`);
  if (!students.length) {
    await sendTelegram(chatId, 'в группе нет активных учеников.');
    return true;
  }

  const assignmentId = botId();
  const { buffer } = await getTelegramFile(document.file_id);
  if (!buffer.length) throw new Error('пустой PDF');
  if (buffer.length > 20 * 1024 * 1024) throw new Error('PDF больше 20 МБ');

  const durableName = safePdfName(fileName);
  const path = `${assignmentId}/${Date.now()}-${durableName}`;
  await uploadHomeworkPdf(path, buffer);
  const durableRef = `${HW_STORAGE_PREFIX}${path}`;
  const lessonId = await ensureCurrentManualLesson(session.data.group_id, session.data.topic || '');

  await sbRpc('create_homework_for_group', {
    p_assignment_id: assignmentId,
    p_group_id: session.data.group_id,
    p_lesson_id: lessonId,
    p_topic: session.data.topic,
    p_due_date: session.data.due_date || null,
    p_hw_type: 'detailed',
    p_is_advanced: false,
    p_file_id: durableRef,
    p_answers: null,
    p_task_config: null,
  });
  await sbPatch('homework_assignments', `id=eq.${encodeURIComponent(assignmentId)}`, {
    telegram_file_id: document.file_id,
    material_name: durableName,
  });

  const submissions = await sbSelect('homework_submissions',
    `assignment_id=eq.${encodeURIComponent(assignmentId)}&select=id,student_id`);
  const subMap = new Map(submissions.map(row => [row.student_id, row.id]));
  const due = session.data.due_date ? `\nдедлайн: <b>${esc(session.data.due_date)}</b>` : '';

  await Promise.all(students.map(student => {
    const subId = subMap.get(student.id);
    return sendStudentEverywhere(student, {
      text: `📚 новое ДЗ: <b>${esc(session.data.topic)}</b>${due}`,
      telegramReplyMarkup: subId ? tgInlineKeyboard([[
        { text: '📚 открыть задание', callback_data: `hw:${subId}` },
      ]]) : undefined,
      vkKeyboard: subId ? vkInlineKeyboard([[
        vkInlineButton('📚 открыть задание', `hw:${subId}`),
      ]]) : undefined,
      telegramFileId: document.file_id,
      vkAttachment: null,
    });
  }));

  await sbUpsert('telegram_sessions', {
    telegram_user_id: userId,
    state: { step: 'owner' },
    updated_at: new Date().toISOString(),
  });
  await sendTelegram(chatId,
    `✅ ДЗ создано\nгруппа: <b>${esc(session.data.group_name)}</b>\nтема: <b>${esc(session.data.topic)}</b>\nучеников: <b>${students.length}</b>`, {
      reply_markup: ownerHomeKeyboard(),
    });
  return true;
}

async function openHomeworkFile(query) {
  const data = String(query?.data || '');
  if (!data.startsWith('hwfile:')) return false;
  const chatId = query.message?.chat?.id;
  const userId = query.from?.id;
  const assignmentId = data.slice('hwfile:'.length);
  if (!chatId || !userId || !assignmentId) return false;

  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  const student = await sbOne('students',
    `telegram_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,group_id`);
  if (!student) return false;

  const assignment = await sbOne('homework_assignments',
    `id=eq.${encodeURIComponent(assignmentId)}&group_id=eq.${encodeURIComponent(student.group_id)}` +
    '&select=id,telegram_file_id,file_id,material_name');
  if (!assignment) {
    await sendTelegram(chatId, 'задание не найдено.');
    return true;
  }

  const caption = assignment.material_name || 'Материал к ДЗ';
  if (assignment.telegram_file_id) {
    await sendTelegramDocument(chatId, assignment.telegram_file_id, caption);
    return true;
  }
  if (String(assignment.file_id || '').startsWith(HW_STORAGE_PREFIX)) {
    const url = await signedHomeworkUrl(assignment.file_id);
    await sendTelegramDocument(chatId, url, caption);
    return true;
  }
  if (assignment.file_id) {
    const url = await resolveVkAttachmentUrl(assignment.file_id).catch(() => null);
    if (url) {
      await sendTelegramDocument(chatId, url, caption);
      return true;
    }
  }
  await sendTelegram(chatId, 'файл к этому ДЗ не найден.');
  return true;
}

export async function handleTelegramHomeworkUpdate(update) {
  const userId = update?.message?.from?.id || update?.callback_query?.from?.id;
  if (!userId) return false;

  if (update.callback_query && String(update.callback_query.data || '').startsWith('hwfile:')) {
    return openHomeworkFile(update.callback_query);
  }

  if (!OWNER_TELEGRAM_ID || String(userId) !== String(OWNER_TELEGRAM_ID)) return false;
  const message = update.message;
  if (!message?.document) return false;
  const session = await sbOne('telegram_sessions', `telegram_user_id=eq.${userId}&select=state`);
  if (session?.state?.step !== 'hw_file') return false;
  return createHomeworkFromTelegramPdf(message, session.state);
}
