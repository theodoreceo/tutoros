// TutorOS Telegram webhook. Telegram is the primary interface, VK stays a fallback.
// Requires supabase/add_telegram_mvp.sql.

import {
  sendTelegram,
  sendTelegramDocument,
  sendVk,
  sendStudentEverywhere,
  tgInlineKeyboard,
  vkInlineButton,
  vkInlineKeyboard,
  uploadTelegramFileToVk,
  resolveVkAttachmentUrl,
  telegram,
} from './_lib/channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const OWNER_VK_ID = process.env.OWNER_VK_ID;
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

async function sbSelect(table, qs = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB });
  if (!r.ok) throw new Error(`sbSelect ${table}: ${await r.text()}`);
  return r.json();
}
async function sbOne(table, qs) {
  const rows = await sbSelect(table, `${qs}&limit=1`);
  return rows[0] ?? null;
}
async function sbInsert(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbInsert ${table}: ${await r.text()}`);
  return r.json();
}
async function sbPatch(table, qs, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbPatch ${table}: ${await r.text()}`);
  return r.json();
}
async function sbUpsert(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbUpsert ${table}: ${await r.text()}`);
  return r.json();
}
async function sbRpc(fn, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: SB, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbRpc ${fn}: ${await r.text()}`);
  return r.json();
}

const botId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const isOwner = id => Boolean(OWNER_TELEGRAM_ID) && String(id) === String(OWNER_TELEGRAM_ID);
const tgButton = (text, callback_data) => ({ text, callback_data });

async function getSession(userId) {
  const row = await sbOne('telegram_sessions', `telegram_user_id=eq.${userId}`);
  return row?.state ?? {};
}
async function setSession(userId, state) {
  await sbUpsert('telegram_sessions', {
    telegram_user_id: userId,
    state,
    updated_at: new Date().toISOString(),
  });
}

async function studentByTelegram(id) {
  return sbOne('students', `telegram_id=eq.${id}&status=eq.active`);
}

async function latestLesson(groupId) {
  return sbOne('lessons',
    `group_id=eq.${encodeURIComponent(groupId)}&active=eq.true&order=sequence.desc&select=id,topic,scheduled_date,sequence`);
}

function parseDueDate(text) {
  const raw = String(text || '').trim();
  if (raw === '-' || raw.toLowerCase() === 'нет') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/);
  if (!match) return undefined;
  const year = match[3] || String(new Date().getFullYear());
  return `${year}-${match[2]}-${match[1]}`;
}

function studentHomeKeyboard() {
  return tgInlineKeyboard([
    [tgButton('📚 мои задания', 'student:homework')],
    [tgButton('📎 материалы', 'student:materials'), tgButton('📊 результаты', 'student:results')],
  ]);
}
function ownerHomeKeyboard() {
  return tgInlineKeyboard([
    [tgButton('👥 группы', 'owner:groups'), tgButton('🕒 непроверено', 'owner:unchecked')],
    [tgButton('📚 новое ДЗ', 'owner:newhw')],
    [tgButton('📝 конспект', 'owner:notes'), tgButton('🎥 запись', 'owner:recording')],
  ]);
}

async function sendOwnerHome(chatId, userId) {
  await setSession(userId, { step: 'owner' });
  return sendTelegram(chatId, '<b>TutorOS</b> · панель преподавателя', {
    reply_markup: ownerHomeKeyboard(),
  });
}
async function sendStudentHome(chatId, userId, student) {
  await setSession(userId, { step: 'student' });
  return sendTelegram(chatId,
    `привет, <b>${esc(student.name)}</b>!\n\nздесь ДЗ, материалы и записи занятий.`, {
      reply_markup: studentHomeKeyboard(),
    });
}

async function handleRegistration(chatId, userId, token) {
  const clean = String(token || '').trim().toLowerCase();
  const student = await sbOne('students', `reg_token=eq.${encodeURIComponent(clean)}&status=eq.active`);
  if (!student) return sendTelegram(chatId, 'ссылка недействительна. попроси преподавателя прислать новую.');
  if (student.telegram_id && String(student.telegram_id) !== String(userId)) {
    return sendTelegram(chatId, 'эта Telegram-ссылка уже привязана к другому аккаунту. напиши преподавателю.');
  }
  if (!student.telegram_id) {
    await sbPatch('students', `id=eq.${encodeURIComponent(student.id)}`, {
      telegram_id: userId,
      updated_at: new Date().toISOString(),
    });
  }
  return sendStudentHome(chatId, userId, { ...student, telegram_id: userId });
}

async function showOwnerGroups(chatId, purpose = 'view') {
  const groups = await sbSelect('groups', 'active=eq.true&order=name.asc&select=id,name,group_type');
  if (!groups.length) return sendTelegram(chatId, 'активных групп пока нет.');
  const prefix = purpose === 'hw' ? 'newhw' : purpose === 'notes' ? 'notes' : purpose === 'recording' ? 'recording' : 'og';
  const rows = groups.map(group => [tgButton(
    `${group.group_type === 'individual' ? '👤' : '👥'} ${group.name}`,
    `${prefix}:${group.id}`
  )]);
  rows.push([tgButton('← меню', 'owner:home')]);
  return sendTelegram(chatId, purpose === 'view' ? 'выбери группу:' : 'для какой группы?', {
    reply_markup: tgInlineKeyboard(rows),
  });
}

async function showOwnerGroup(chatId, groupId) {
  const [group, students] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&select=id,name,group_type`),
    sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&order=name.asc&select=id,name,vk_id,telegram_id,reg_token`),
  ]);
  if (!group) return sendTelegram(chatId, 'группа не найдена.');
  const lines = students.length
    ? students.map((s, i) => `${i + 1}. ${s.telegram_id ? '✅TG' : '▫️TG'} ${s.vk_id ? '✅VK' : '▫️VK'} ${esc(s.name)}`).join('\n')
    : 'учеников пока нет';
  const rows = students.map(student => [tgButton(student.name, `studentinfo:${student.id}`)]);
  rows.push([tgButton('📚 создать ДЗ', `newhw:${group.id}`)]);
  rows.push([tgButton('📝 добавить конспект', `notes:${group.id}`), tgButton('🎥 добавить запись', `recording:${group.id}`)]);
  rows.push([tgButton('← группы', 'owner:groups')]);
  return sendTelegram(chatId, `<b>${esc(group.name)}</b>\n\n${lines}`, {
    reply_markup: tgInlineKeyboard(rows),
  });
}

async function showStudentInvite(chatId, studentId) {
  const student = await sbOne('students', `id=eq.${encodeURIComponent(studentId)}&select=id,name,group_id,vk_id,telegram_id,reg_token`);
  if (!student) return sendTelegram(chatId, 'ученик не найден.');
  const link = TELEGRAM_BOT_USERNAME
    ? `https://t.me/${TELEGRAM_BOT_USERNAME.replace(/^@/, '')}?start=${student.reg_token}`
    : null;
  return sendTelegram(chatId,
    `<b>${esc(student.name)}</b>\nTG: ${student.telegram_id ? 'подключён' : 'не подключён'}\nVK: ${student.vk_id ? 'подключён' : 'не подключён'}\n\n` +
    (link ? `Telegram-ссылка:\n${esc(link)}` : `код Telegram: <code>${esc(student.reg_token)}</code>`), {
      reply_markup: tgInlineKeyboard([[tgButton('← назад', `og:${student.group_id}`)]]),
    });
}

async function startHomework(chatId, userId, groupId) {
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true&select=id,name`);
  if (!group) return sendTelegram(chatId, 'группа не найдена.');
  await setSession(userId, { step: 'hw_topic', data: { group_id: group.id, group_name: group.name } });
  return sendTelegram(chatId, `новое ДЗ для <b>${esc(group.name)}</b>.\n\nвведи тему:`);
}

async function finishHomework(chatId, userId, data) {
  const students = await sbSelect('students',
    `group_id=eq.${encodeURIComponent(data.group_id)}&status=eq.active&select=id,name,vk_id,telegram_id`);
  if (!students.length) throw new Error('в группе нет активных учеников');
  const lesson = await latestLesson(data.group_id);
  const assignmentId = botId();
  await sbRpc('create_homework_for_group', {
    p_assignment_id: assignmentId,
    p_group_id: data.group_id,
    p_lesson_id: lesson?.id || null,
    p_topic: data.topic,
    p_due_date: data.due_date || null,
    p_hw_type: 'detailed',
    p_is_advanced: false,
    p_file_id: data.vk_attachment || null,
    p_answers: null,
    p_task_config: null,
  });
  await sbPatch('homework_assignments', `id=eq.${encodeURIComponent(assignmentId)}`, {
    telegram_file_id: data.telegram_file_id || null,
    material_name: data.file_name || null,
  });
  const submissions = await sbSelect('homework_submissions',
    `assignment_id=eq.${encodeURIComponent(assignmentId)}&select=id,student_id`);
  const subMap = new Map(submissions.map(s => [s.student_id, s.id]));
  const due = data.due_date ? `\nдедлайн: <b>${esc(data.due_date)}</b>` : '';

  await Promise.all(students.map(student => {
    const subId = subMap.get(student.id);
    return sendStudentEverywhere(student, {
      text: `📚 новое ДЗ: <b>${esc(data.topic)}</b>${due}`,
      telegramReplyMarkup: subId ? tgInlineKeyboard([[tgButton('📚 открыть задание', `hw:${subId}`)]]) : undefined,
      vkKeyboard: subId ? vkInlineKeyboard([[vkInlineButton('📚 открыть задание', `hw:${subId}`)]]) : undefined,
      telegramFileId: data.telegram_file_id || null,
      vkAttachment: data.vk_attachment || null,
    });
  }));

  await setSession(userId, { step: 'owner' });
  return sendTelegram(chatId,
    `✅ ДЗ создано\nгруппа: <b>${esc(data.group_name)}</b>\nтема: <b>${esc(data.topic)}</b>\nучеников: <b>${students.length}</b>`, {
      reply_markup: ownerHomeKeyboard(),
    });
}

async function addNotes(chatId, userId, groupId) {
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true&select=id,name`);
  if (!group) return sendTelegram(chatId, 'группа не найдена.');
  await setSession(userId, { step: 'notes_file', data: { group_id: group.id, group_name: group.name } });
  return sendTelegram(chatId, `пришли конспект для <b>${esc(group.name)}</b> файлом или PDF.`);
}

async function saveNotes(chatId, userId, data, file) {
  const lesson = await latestLesson(data.group_id);
  const material = {
    id: botId(),
    group_id: data.group_id,
    lesson_id: lesson?.id || null,
    material_type: 'notes',
    title: lesson?.topic ? `Конспект · ${lesson.topic}` : `Конспект · ${data.group_name}`,
    telegram_file_id: file.telegram_file_id,
    vk_attachment: file.vk_attachment,
    file_name: file.file_name,
  };
  await sbInsert('lesson_materials', material);
  const students = await sbSelect('students',
    `group_id=eq.${encodeURIComponent(data.group_id)}&status=eq.active&select=id,name,vk_id,telegram_id`);
  await Promise.all(students.map(student => sendStudentEverywhere(student, {
    text: `📝 новый конспект: <b>${esc(material.title)}</b>`,
    telegramFileId: material.telegram_file_id,
    vkAttachment: material.vk_attachment,
  })));
  await setSession(userId, { step: 'owner' });
  return sendTelegram(chatId, `✅ конспект отправлен ${students.length} ученикам.`, {
    reply_markup: ownerHomeKeyboard(),
  });
}

async function startRecording(chatId, userId, groupId) {
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true&select=id,name`);
  if (!group) return sendTelegram(chatId, 'группа не найдена.');
  await setSession(userId, { step: 'recording_url', data: { group_id: group.id, group_name: group.name } });
  return sendTelegram(chatId, `вставь ссылку на запись занятия для <b>${esc(group.name)}</b>:`);
}

async function saveRecording(chatId, userId, data, url) {
  if (!/^https?:\/\//i.test(url)) return sendTelegram(chatId, 'нужна обычная http/https-ссылка.');
  const lesson = await latestLesson(data.group_id);
  const title = lesson?.topic ? `Запись · ${lesson.topic}` : `Запись · ${data.group_name}`;
  await sbInsert('lesson_materials', {
    id: botId(),
    group_id: data.group_id,
    lesson_id: lesson?.id || null,
    material_type: 'recording',
    title,
    external_url: url,
  });
  const students = await sbSelect('students',
    `group_id=eq.${encodeURIComponent(data.group_id)}&status=eq.active&select=id,name,vk_id,telegram_id`);
  await Promise.all(students.map(student => sendStudentEverywhere(student, {
    text: `🎥 <b>${esc(title)}</b>\n${esc(url)}`,
  })));
  await setSession(userId, { step: 'owner' });
  return sendTelegram(chatId, `✅ запись отправлена ${students.length} ученикам.`, {
    reply_markup: ownerHomeKeyboard(),
  });
}

async function showStudentHomework(chatId, student) {
  const submissions = await sbSelect('homework_submissions',
    `student_id=eq.${encodeURIComponent(student.id)}&status=not.eq.cancelled&select=id,assignment_id,status,score,max_score,submitted_at`);
  if (!submissions.length) return sendTelegram(chatId, 'активных заданий пока нет.', { reply_markup: studentHomeKeyboard() });
  const ids = [...new Set(submissions.map(s => s.assignment_id))];
  const assignments = await sbSelect('homework_assignments',
    `id=in.(${ids.join(',')})&archived_at=is.null&select=id,topic,due_date,hw_type,assigned_at,telegram_file_id,material_name`);
  const aMap = new Map(assignments.map(a => [a.id, a]));
  const visible = submissions.filter(s => aMap.has(s.assignment_id))
    .sort((a, b) => String(aMap.get(b.assignment_id)?.assigned_at || '').localeCompare(String(aMap.get(a.assignment_id)?.assigned_at || '')));
  if (!visible.length) return sendTelegram(chatId, 'активных заданий пока нет.', { reply_markup: studentHomeKeyboard() });
  const rows = visible.map(sub => {
    const a = aMap.get(sub.assignment_id);
    const mark = sub.status === 'checked' ? '✅' : sub.status === 'submitted' ? '⏳' : sub.status === 'revision' ? '↩️' : '📚';
    return [tgButton(`${mark} ${a.topic}`.slice(0, 60), `hw:${sub.id}`)];
  });
  rows.push([tgButton('← меню', 'student:home')]);
  return sendTelegram(chatId, 'твои задания:', { reply_markup: tgInlineKeyboard(rows) });
}

async function showHomework(chatId, student, subId) {
  const sub = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}`);
  if (!sub) return sendTelegram(chatId, 'задание не найдено.');
  const a = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(sub.assignment_id)}`);
  if (!a) return sendTelegram(chatId, 'задание не найдено.');
  const status = { assigned: 'не сдано', submitted: 'ждёт проверки', checked: 'проверено', revision: 'на доработке' }[sub.status] || sub.status;
  const rows = [];
  if (a.telegram_file_id) rows.push([tgButton('📎 файл задания', `hwfile:${a.id}`)]);
  if (['assigned', 'revision'].includes(sub.status)) rows.push([tgButton('📤 сдать работу', `submit:${sub.id}`)]);
  rows.push([tgButton('← к заданиям', 'student:homework')]);
  return sendTelegram(chatId,
    `<b>${esc(a.topic)}</b>\nстатус: <b>${esc(status)}</b>` +
    (a.due_date ? `\nдедлайн: <b>${esc(a.due_date)}</b>` : '') +
    (sub.score !== null && sub.score !== undefined ? `\nрезультат: <b>${esc(sub.score)}${sub.max_score ? `/${esc(sub.max_score)}` : ''}</b>` : '') +
    (sub.comment ? `\n\n${esc(sub.comment)}` : ''), {
      reply_markup: tgInlineKeyboard(rows),
    });
}

async function showHomeworkFile(chatId, student, assignmentId) {
  const a = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(assignmentId)}&group_id=eq.${encodeURIComponent(student.group_id)}`);
  if (!a?.telegram_file_id) return sendTelegram(chatId, 'файл к этому ДЗ не найден.');
  return sendTelegramDocument(chatId, a.telegram_file_id, a.material_name ? esc(a.material_name) : 'Материал к ДЗ');
}

async function showStudentMaterials(chatId, student) {
  const materials = await sbSelect('lesson_materials',
    `group_id=eq.${encodeURIComponent(student.group_id)}&order=created_at.desc&limit=20`);
  if (!materials.length) return sendTelegram(chatId, 'материалов пока нет.', { reply_markup: studentHomeKeyboard() });
  const rows = materials.map(m => [tgButton(`${m.material_type === 'recording' ? '🎥' : '📝'} ${m.title}`.slice(0, 60), `mat:${m.id}`)]);
  rows.push([tgButton('← меню', 'student:home')]);
  return sendTelegram(chatId, 'материалы:', { reply_markup: tgInlineKeyboard(rows) });
}

async function openMaterial(chatId, student, materialId) {
  const m = await sbOne('lesson_materials',
    `id=eq.${encodeURIComponent(materialId)}&group_id=eq.${encodeURIComponent(student.group_id)}`);
  if (!m) return sendTelegram(chatId, 'материал не найден.');
  if (m.telegram_file_id) return sendTelegramDocument(chatId, m.telegram_file_id, esc(m.title));
  return sendTelegram(chatId, `<b>${esc(m.title)}</b>\n${esc(m.external_url || 'ссылка не указана')}`);
}

async function showStudentResults(chatId, student) {
  const subs = await sbSelect('homework_submissions',
    `student_id=eq.${encodeURIComponent(student.id)}&status=eq.checked&order=checked_at.desc&limit=10&select=assignment_id,score,max_score,checked_at`);
  if (!subs.length) return sendTelegram(chatId, 'проверенных работ пока нет.', { reply_markup: studentHomeKeyboard() });
  const ids = [...new Set(subs.map(s => s.assignment_id))];
  const assignments = await sbSelect('homework_assignments', `id=in.(${ids.join(',')})&select=id,topic`);
  const map = new Map(assignments.map(a => [a.id, a.topic]));
  const lines = subs.map((s, i) => `${i + 1}. ${esc(map.get(s.assignment_id) || 'ДЗ')} — <b>${esc(s.score ?? '—')}${s.max_score ? `/${esc(s.max_score)}` : ''}</b>`);
  return sendTelegram(chatId, lines.join('\n'), { reply_markup: studentHomeKeyboard() });
}

async function beginSubmission(chatId, userId, student, subId) {
  const sub = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}`);
  if (!sub || !['assigned', 'revision'].includes(sub.status)) return sendTelegram(chatId, 'это задание уже нельзя пересдать.');
  const a = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(sub.assignment_id)}`);
  if (a?.hw_type === 'brief') {
    await setSession(userId, { step: 'brief_answer', data: { submission_id: sub.id, assignment_id: a.id } });
    return sendTelegram(chatId, 'введи ответы одной строкой через точку с запятой:');
  }
  await setSession(userId, { step: 'submission_files', data: { submission_id: sub.id, files: [] } });
  return sendTelegram(chatId, 'пришли фото/PDF выполненной работы. можно несколько файлов. когда закончишь — нажми «отправить».', {
    reply_markup: tgInlineKeyboard([[tgButton('✅ отправить', `done:${sub.id}`)], [tgButton('❌ отменить', 'student:homework')]]),
  });
}

async function finishBriefAnswer(chatId, userId, student, sess, text) {
  const sub = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(sess.data.submission_id)}&student_id=eq.${encodeURIComponent(student.id)}`);
  const a = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(sess.data.assignment_id)}`);
  if (!sub || !a) throw new Error('submission not found');
  const given = String(text).split(';').map(v => v.trim().replace(',', '.'));
  const correct = Array.isArray(a.answers) ? a.answers.map(v => String(v).trim().replace(',', '.')) : [];
  const results = correct.length ? correct.map((value, i) => given[i] === value) : [];
  const score = results.length ? results.filter(Boolean).length : null;
  const maxScore = results.length || null;
  const now = new Date().toISOString();
  await sbPatch('homework_submissions', `id=eq.${encodeURIComponent(sub.id)}&student_id=eq.${encodeURIComponent(student.id)}`, {
    status: results.length ? 'checked' : 'submitted',
    submitted_at: now,
    checked_at: results.length ? now : null,
    score,
    max_score: maxScore,
    student_answers: given,
    task_scores: results.length ? results.map(ok => ok ? 1 : 0) : null,
    comment: results.length ? `${score}/${maxScore} верно` : 'ответ отправлен преподавателю',
    source: 'telegram',
  });
  await setSession(userId, { step: 'student' });
  await notifyOwner(`📥 ${student.name} сдал(а) ДЗ «${a.topic}» в Telegram.`);
  return sendTelegram(chatId, results.length ? `✅ проверено: ${score}/${maxScore}` : '✅ ответ отправлен преподавателю.', {
    reply_markup: studentHomeKeyboard(),
  });
}

async function addSubmissionFile(chatId, userId, student, sess, message) {
  const telegramFileId = message.document?.file_id || message.photo?.[message.photo.length - 1]?.file_id;
  const fileName = message.document?.file_name || `photo-${Date.now()}.jpg`;
  if (!telegramFileId) return;
  let vkAttachment;
  try {
    vkAttachment = await uploadTelegramFileToVk(telegramFileId, fileName);
  } catch (error) {
    console.error('TG→VK submission mirror failed:', error);
    return sendTelegram(chatId, 'не смог синхронизировать файл с VK. файл пока не добавлен — попробуй ещё раз.');
  }
  const files = [...(sess.data?.files || []), {
    type: 'document',
    file_id: vkAttachment,
    telegram_file_id: telegramFileId,
    name: fileName,
  }];
  await setSession(userId, { step: 'submission_files', data: { ...sess.data, files } });
  return sendTelegram(chatId, `📎 файл добавлен (${files.length}).`, {
    reply_markup: tgInlineKeyboard([[tgButton('✅ отправить', `done:${sess.data.submission_id}`)]]),
  });
}

async function finalizeSubmission(chatId, userId, student, subId) {
  const sess = await getSession(userId);
  if (sess.step !== 'submission_files' || sess.data?.submission_id !== subId) return sendTelegram(chatId, 'сессия сдачи устарела. открой ДЗ заново.');
  const files = sess.data?.files || [];
  if (!files.length) return sendTelegram(chatId, 'сначала пришли хотя бы один файл.');
  const sub = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}`);
  const a = sub ? await sbOne('homework_assignments', `id=eq.${encodeURIComponent(sub.assignment_id)}`) : null;
  const now = new Date().toISOString();
  await sbPatch('homework_submissions', `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}`, {
    status: 'submitted',
    submitted_at: now,
    submitted_files: files,
    source: 'telegram',
  });
  await setSession(userId, { step: 'student' });
  await notifyOwner(`📥 ${student.name} сдал(а) ДЗ «${a?.topic || 'без темы'}» в Telegram.`);
  return sendTelegram(chatId, '✅ работа отправлена преподавателю.', { reply_markup: studentHomeKeyboard() });
}

async function notifyOwner(text) {
  if (OWNER_TELEGRAM_ID) await sendTelegram(OWNER_TELEGRAM_ID, esc(text)).catch(() => {});
  if (OWNER_VK_ID) await sendVk(OWNER_VK_ID, text).catch(() => {});
}

async function showUnchecked(chatId) {
  const subs = await sbSelect('homework_submissions',
    'status=eq.submitted&order=submitted_at.asc&limit=20&select=id,assignment_id,student_id,submitted_at');
  if (!subs.length) return sendTelegram(chatId, '✅ непроверенных работ нет.', { reply_markup: ownerHomeKeyboard() });
  const sids = [...new Set(subs.map(s => s.student_id))];
  const aids = [...new Set(subs.map(s => s.assignment_id))];
  const [students, assignments] = await Promise.all([
    sbSelect('students', `id=in.(${sids.join(',')})&select=id,name`),
    sbSelect('homework_assignments', `id=in.(${aids.join(',')})&select=id,topic`),
  ]);
  const sm = new Map(students.map(s => [s.id, s.name]));
  const am = new Map(assignments.map(a => [a.id, a.topic]));
  const rows = subs.map(s => [tgButton(`${sm.get(s.student_id) || 'ученик'} · ${am.get(s.assignment_id) || 'ДЗ'}`.slice(0, 60), `review:${s.id}`)]);
  rows.push([tgButton('← меню', 'owner:home')]);
  return sendTelegram(chatId, 'ждут проверки:', { reply_markup: tgInlineKeyboard(rows) });
}

async function reviewSubmission(chatId, subId) {
  const sub = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(subId)}`);
  if (!sub) return sendTelegram(chatId, 'работа не найдена.');
  const [student, assignment] = await Promise.all([
    sbOne('students', `id=eq.${encodeURIComponent(sub.student_id)}&select=id,name,vk_id,telegram_id`),
    sbOne('homework_assignments', `id=eq.${encodeURIComponent(sub.assignment_id)}&select=id,topic`),
  ]);
  for (const file of Array.isArray(sub.submitted_files) ? sub.submitted_files : []) {
    if (file.telegram_file_id) {
      await sendTelegramDocument(chatId, file.telegram_file_id, file.name || '').catch(() => {});
    } else if (file.file_id) {
      const url = await resolveVkAttachmentUrl(file.file_id).catch(() => null);
      if (url) await sendTelegramDocument(chatId, url, file.name || '').catch(() => {});
    }
  }
  return sendTelegram(chatId,
    `<b>${esc(student?.name || 'ученик')}</b>\n${esc(assignment?.topic || 'ДЗ')}`, {
      reply_markup: tgInlineKeyboard([
        [tgButton('✅ засчитать', `reviewok:${sub.id}`), tgButton('↩️ доработка', `reviewrev:${sub.id}`)],
        [tgButton('← непроверено', 'owner:unchecked')],
      ]),
    });
}

async function setReviewResult(chatId, subId, status) {
  const sub = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(subId)}`);
  if (!sub) return sendTelegram(chatId, 'работа не найдена.');
  const student = await sbOne('students', `id=eq.${encodeURIComponent(sub.student_id)}&select=id,name,vk_id,telegram_id`);
  const a = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(sub.assignment_id)}&select=id,topic`);
  const checked = status === 'checked';
  await sbPatch('homework_submissions', `id=eq.${encodeURIComponent(sub.id)}`, {
    status,
    checked_at: checked ? new Date().toISOString() : null,
    comment: checked ? 'проверено преподавателем' : 'вернись к работе и отправь исправленный вариант',
  });
  if (student) await sendStudentEverywhere(student, {
    text: checked
      ? `✅ ДЗ «<b>${esc(a?.topic || 'без темы')}</b>» проверено.`
      : `↩️ ДЗ «<b>${esc(a?.topic || 'без темы')}</b>» возвращено на доработку.`,
  });
  return showUnchecked(chatId);
}

async function handleOwnerText(chatId, userId, text, sess) {
  if (sess.step === 'hw_topic') {
    await setSession(userId, { step: 'hw_due', data: { ...sess.data, topic: text } });
    return sendTelegram(chatId, 'дедлайн: ДД.ММ.ГГГГ, YYYY-MM-DD или «-» без дедлайна.');
  }
  if (sess.step === 'hw_due') {
    const due = parseDueDate(text);
    if (due === undefined) return sendTelegram(chatId, 'не понял дату. пример: 03.10.2026 или «-».');
    await setSession(userId, { step: 'hw_file', data: { ...sess.data, due_date: due } });
    return sendTelegram(chatId, 'пришли PDF/файл к ДЗ или отправь «-», если файла нет.');
  }
  if (sess.step === 'hw_file' && (text === '-' || text.toLowerCase() === 'нет')) {
    return finishHomework(chatId, userId, sess.data);
  }
  if (sess.step === 'recording_url') return saveRecording(chatId, userId, sess.data, text);
  return sendOwnerHome(chatId, userId);
}

async function handleStudentText(chatId, userId, text, student, sess) {
  if (sess.step === 'brief_answer') return finishBriefAnswer(chatId, userId, student, sess, text);
  return sendStudentHome(chatId, userId, student);
}

async function handleMedia(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const owner = isOwner(userId);
  const student = owner ? null : await studentByTelegram(userId);
  const sess = await getSession(userId);
  const telegramFileId = message.document?.file_id || message.photo?.[message.photo.length - 1]?.file_id;
  const fileName = message.document?.file_name || `photo-${Date.now()}.jpg`;
  if (!telegramFileId) return;

  if (owner && sess.step === 'hw_file') {
    let vkAttachment;
    try { vkAttachment = await uploadTelegramFileToVk(telegramFileId, fileName); }
    catch (error) { return sendTelegram(chatId, `не удалось синхронизировать файл с VK: <code>${esc(error.message)}</code>`); }
    return finishHomework(chatId, userId, {
      ...sess.data,
      telegram_file_id: telegramFileId,
      vk_attachment: vkAttachment,
      file_name: fileName,
    });
  }

  if (owner && sess.step === 'notes_file') {
    let vkAttachment;
    try { vkAttachment = await uploadTelegramFileToVk(telegramFileId, fileName); }
    catch (error) { return sendTelegram(chatId, `не удалось синхронизировать конспект с VK: <code>${esc(error.message)}</code>`); }
    return saveNotes(chatId, userId, sess.data, {
      telegram_file_id: telegramFileId,
      vk_attachment: vkAttachment,
      file_name: fileName,
    });
  }

  if (student && sess.step === 'submission_files') {
    return addSubmissionFile(chatId, userId, student, sess, message);
  }
  return sendTelegram(chatId, 'сейчас я не жду файл.');
}

async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  const userId = query.from?.id;
  const data = String(query.data || '');
  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  if (!chatId || !userId) return;
  const owner = isOwner(userId);
  const student = owner ? null : await studentByTelegram(userId);

  if (owner) {
    if (data === 'owner:home') return sendOwnerHome(chatId, userId);
    if (data === 'owner:groups') return showOwnerGroups(chatId);
    if (data === 'owner:newhw') return showOwnerGroups(chatId, 'hw');
    if (data === 'owner:notes') return showOwnerGroups(chatId, 'notes');
    if (data === 'owner:recording') return showOwnerGroups(chatId, 'recording');
    if (data === 'owner:unchecked') return showUnchecked(chatId);
    if (data.startsWith('og:')) return showOwnerGroup(chatId, data.slice(3));
    if (data.startsWith('studentinfo:')) return showStudentInvite(chatId, data.slice('studentinfo:'.length));
    if (data.startsWith('newhw:')) return startHomework(chatId, userId, data.slice(6));
    if (data.startsWith('notes:')) return addNotes(chatId, userId, data.slice(6));
    if (data.startsWith('recording:')) return startRecording(chatId, userId, data.slice('recording:'.length));
    if (data.startsWith('review:')) return reviewSubmission(chatId, data.slice(7));
    if (data.startsWith('reviewok:')) return setReviewResult(chatId, data.slice(9), 'checked');
    if (data.startsWith('reviewrev:')) return setReviewResult(chatId, data.slice(10), 'revision');
  }

  if (student) {
    if (data === 'student:home') return sendStudentHome(chatId, userId, student);
    if (data === 'student:homework') return showStudentHomework(chatId, student);
    if (data === 'student:materials') return showStudentMaterials(chatId, student);
    if (data === 'student:results') return showStudentResults(chatId, student);
    if (data.startsWith('hw:')) return showHomework(chatId, student, data.slice(3));
    if (data.startsWith('hwfile:')) return showHomeworkFile(chatId, student, data.slice(7));
    if (data.startsWith('mat:')) return openMaterial(chatId, student, data.slice(4));
    if (data.startsWith('submit:')) return beginSubmission(chatId, userId, student, data.slice(7));
    if (data.startsWith('done:')) return finalizeSubmission(chatId, userId, student, data.slice(5));
  }
  return sendTelegram(chatId, 'команда устарела. открой меню заново.');
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = String(message.text || '').trim();
  const owner = isOwner(userId);
  const student = owner ? null : await studentByTelegram(userId);

  if (message.document || message.photo) return handleMedia(message);

  if (text.startsWith('/start ')) {
    if (owner) return sendOwnerHome(chatId, userId);
    if (student) return sendStudentHome(chatId, userId, student);
    return handleRegistration(chatId, userId, text.slice(7));
  }
  if (text === '/start' || text === '/menu') {
    if (owner) return sendOwnerHome(chatId, userId);
    if (student) return sendStudentHome(chatId, userId, student);
    return sendTelegram(chatId, 'открой персональную ссылку от преподавателя.');
  }
  if (!owner && !student) return sendTelegram(chatId, 'сначала открой персональную ссылку от преподавателя.');

  const sess = await getSession(userId);
  if (owner) return handleOwnerText(chatId, userId, text, sess);
  return handleStudentText(chatId, userId, text, student, sess);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('TutorOS Telegram bot');
  if (TELEGRAM_WEBHOOK_SECRET) {
    const actual = req.headers['x-telegram-bot-api-secret-token'];
    if (actual !== TELEGRAM_WEBHOOK_SECRET) return res.status(403).send('wrong secret');
  }
  try {
    const update = req.body || {};
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
    return res.status(200).send('ok');
  } catch (error) {
    console.error('Telegram bot error:', error);
    const chatId = req.body?.message?.chat?.id || req.body?.callback_query?.message?.chat?.id;
    if (chatId) await sendTelegram(chatId, `⚠️ временная ошибка. попробуй ещё раз.${isOwner(req.body?.message?.from?.id || req.body?.callback_query?.from?.id) ? `\n<code>${esc(error.message)}</code>` : ''}`).catch(() => {});
    return res.status(200).send('ok');
  }
}
