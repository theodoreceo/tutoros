import { sendTelegram, sendTelegramDocument, telegram } from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
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

async function createSignedStorageUrl(materialRef) {
  const path = String(materialRef).slice(HW_STORAGE_PREFIX.length);
  const storageBase = `${SUPABASE_URL}/storage/v1`;
  const response = await fetch(
    `${storageBase}/object/sign/${HW_STORAGE_BUCKET}/${storageObjectPath(path)}`,
    {
      method: 'POST',
      headers: SB,
      body: JSON.stringify({ expiresIn: 600 }),
    },
  );
  if (!response.ok) throw new Error(`storage sign: ${await response.text()}`);
  const result = await response.json();
  const relative = result?.signedURL || result?.signedUrl;
  if (!relative) throw new Error('storage sign returned no URL');
  return /^https?:\/\//i.test(relative) ? relative : `${storageBase}${relative}`;
}

export async function handleStoredHomeworkFile(update) {
  const query = update?.callback_query;
  const data = String(query?.data || '');
  if (!data.startsWith('hwfile:')) return false;

  const chatId = query?.message?.chat?.id;
  const userId = query?.from?.id;
  const assignmentId = data.slice('hwfile:'.length);
  if (!chatId || !userId || !assignmentId) return false;

  const student = await sbOne('students',
    `telegram_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,group_id`);
  if (!student) return false;

  const assignment = await sbOne('homework_assignments',
    `id=eq.${encodeURIComponent(assignmentId)}&group_id=eq.${encodeURIComponent(student.group_id)}` +
    '&select=id,file_id,telegram_file_id,material_name');
  if (!assignment || assignment.telegram_file_id || !String(assignment.file_id || '').startsWith(HW_STORAGE_PREFIX)) {
    return false;
  }

  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  try {
    const url = await createSignedStorageUrl(assignment.file_id);
    await sendTelegramDocument(chatId, url, assignment.material_name || 'Материал к ДЗ');
  } catch (error) {
    console.error('Stored homework Telegram open failed:', error);
    await sendTelegram(chatId, 'не удалось открыть PDF. попробуй ещё раз через минуту.');
  }
  return true;
}
