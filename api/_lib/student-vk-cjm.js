import {
  beginBrief,
  canonicalizeStudent,
  finalizeBrief,
  finalizeFiles,
  formatDate,
  homeworkMaterial,
  homeworkOverview,
  humanDueDate,
  lessonDetail,
  lessonMaterial,
  lessonsOverview,
  linkStudentChannel,
  patchLessonMaterial,
  percentOf,
  resultDetail,
  resultsOverview,
  studentByToken,
  studentByVk,
  submissionCard,
  todayMoscow,
} from './student-core.js';
import {
  sendTelegram,
  sendVk,
  uploadTelegramFileToVk,
  vkInlineButton,
  vkInlineKeyboard,
} from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const VK_GROUP_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const OWNER_VK_ID = process.env.OWNER_VK_ID;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};
const UI_KEY = '_cjm_ui_message_ids';
const STORAGE_BUCKET = 'homework-materials';
const STORAGE_PREFIX = 'storage:';

const plain = value => String(value ?? '')
  .replace(/<\/?(?:b|code)>/g, '')
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function sbOne(table, qs) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`, { headers: SB });
  if (!response.ok) throw new Error(`sbOne ${table}: ${await response.text()}`);
  const rows = await response.json();
  return rows[0] ?? null;
}
async function sbUpsert(table, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbUpsert ${table}: ${await response.text()}`);
  return response.json();
}

async function vk(method, params = {}) {
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

async function getSession(userId) {
  const row = await sbOne('vk_sessions', `vk_user_id=eq.${encodeURIComponent(userId)}&select=state`);
  return row?.state || {};
}
async function setSession(userId, next) {
  const current = await getSession(userId).catch(() => ({}));
  await sbUpsert('vk_sessions', {
    vk_user_id: userId,
    state: { ...next, [UI_KEY]: current[UI_KEY] || [] },
    updated_at: new Date().toISOString(),
  });
}
async function saveUiIds(userId, ids) {
  const current = await getSession(userId).catch(() => ({}));
  await sbUpsert('vk_sessions', {
    vk_user_id: userId,
    state: { ...current, [UI_KEY]: ids },
    updated_at: new Date().toISOString(),
  });
}
async function clearScreen(userId) {
  const session = await getSession(userId).catch(() => ({}));
  const ids = Array.isArray(session[UI_KEY]) ? session[UI_KEY].filter(Boolean) : [];
  if (ids.length) {
    await vk('messages.delete', { message_ids: ids.join(','), delete_for_all: 1 }).catch(() => {});
    await saveUiIds(userId, []);
  }
}
async function sendUi(peerId, userId, text, rows = []) {
  const messageId = await vk('messages.send', {
    peer_id: peerId,
    random_id: randomId(),
    message: plain(text),
    ...(rows.length ? { keyboard: vkInlineKeyboard(rows.map(row => row.map(item => vkInlineButton(item.text, item.callback_data, item.color || 'secondary')))) } : {}),
  });
  const session = await getSession(userId).catch(() => ({}));
  const ids = [...(Array.isArray(session[UI_KEY]) ? session[UI_KEY] : []), messageId].filter(Boolean);
  await saveUiIds(userId, ids);
  return messageId;
}
async function sendAttachment(peerId, attachment) {
  return vk('messages.send', { peer_id: peerId, random_id: randomId(), attachment });
}
async function answerCallback(update) {
  const object = update?.object || {};
  if (!object.event_id) return;
  await vk('messages.sendMessageEventAnswer', {
    event_id: object.event_id,
    user_id: object.user_id,
    peer_id: object.peer_id,
    event_data: JSON.stringify({ type: 'show_snackbar', text: '✓' }),
  }).catch(() => {});
}
const b = (text, callback_data, color) => ({ text, callback_data, color });
const homeRows = () => [
  [b('📚 Задания', 'cjm:hw', 'primary')],
  [b('🎓 Занятия', 'cjm:lessons')],
  [b('📊 Результаты', 'cjm:results')],
];

function normalizeMessage(update) {
  const message = update?.object?.message;
  if (!message) return null;
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const files = attachments.map(item => {
    const obj = item?.[item.type];
    if (!obj?.owner_id || !obj?.id) return null;
    const fileId = `${item.type}${obj.owner_id}_${obj.id}${obj.access_key ? `_${obj.access_key}` : ''}`;
    return { type: item.type, file_id: fileId, name: obj.title || null };
  }).filter(Boolean);
  return {
    peerId: message.peer_id,
    userId: message.from_id,
    text: String(message.text || '').trim(),
    ref: message.ref || update.object?.ref || null,
    files,
  };
}
function callbackData(update) {
  const object = update?.object || {};
  let payload = object.payload || {};
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  return { peerId: object.peer_id, userId: object.user_id, data: String(payload.cmd || payload.command || '') };
}

async function home(peerId, userId, student) {
  await setSession(userId, { step: 'student_cjm' });
  return sendUi(peerId, userId, `привет, ${student.name}!\n\nЗдесь задания, занятия и твои результаты.`, homeRows());
}

async function showHomework(peerId, userId, student) {
  const { todo, review } = await homeworkOverview(student);
  const rows = [];
  const lines = [];
  if (todo.length) {
    lines.push('Нужно сделать');
    for (const { submission, assignment } of todo) {
      const overdue = assignment.due_date && assignment.due_date < todayMoscow();
      lines.push(`${overdue ? '🔴' : '📚'} ${assignment.topic} · ${humanDueDate(assignment.due_date)}`);
      rows.push([b(`${overdue ? '🔴' : '📚'} ${assignment.topic}`.slice(0, 38), `cjm:hwcard:${submission.id}`, overdue ? 'negative' : 'primary')]);
    }
  }
  if (review.length) {
    if (lines.length) lines.push('');
    lines.push('На проверке');
    for (const { submission, assignment } of review) {
      lines.push(`⏳ ${assignment.topic}`);
      rows.push([b(`⏳ ${assignment.topic}`.slice(0, 38), `cjm:hwcard:${submission.id}`)]);
    }
  }
  if (!todo.length && !review.length) lines.push('Все текущие задания закрыты.');
  rows.push([b('← Меню', 'cjm:home')]);
  return sendUi(peerId, userId, lines.join('\n'), rows);
}

async function sendHomeworkFile(peerId, student, assignmentId) {
  const assignment = await homeworkMaterial(student, assignmentId);
  if (!assignment) return sendVk(peerId, 'Файл задания не найден.');
  if (assignment.file_id?.startsWith(STORAGE_PREFIX)) {
    const path = assignment.file_id.slice(STORAGE_PREFIX.length);
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${STORAGE_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
    });
    if (!response.ok) return sendVk(peerId, 'Файл задания временно недоступен.');
    const bytes = await response.arrayBuffer();
    const server = await vk('docs.getMessagesUploadServer', { peer_id: peerId, type: 'doc' });
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), assignment.material_name || 'homework.pdf');
    const uploadedResponse = await fetch(server.upload_url, { method: 'POST', body: form });
    const uploaded = await uploadedResponse.json().catch(() => null);
    if (!uploaded?.file) return sendVk(peerId, 'Не удалось открыть PDF.');
    const saved = await vk('docs.save', { file: uploaded.file, title: assignment.material_name || 'homework.pdf' });
    const doc = Array.isArray(saved) ? saved[0] : saved?.doc || saved;
    const attachment = doc?.owner_id !== undefined && doc?.id !== undefined
      ? `doc${doc.owner_id}_${doc.id}${doc.access_key ? `_${doc.access_key}` : ''}` : null;
    if (!attachment) return sendVk(peerId, 'Не удалось открыть PDF.');
    await sendAttachment(peerId, attachment);
    return true;
  }
  if (assignment.file_id) { await sendAttachment(peerId, assignment.file_id); return true; }
  if (assignment.telegram_file_id) {
    const attachment = await uploadTelegramFileToVk(assignment.telegram_file_id, assignment.material_name || 'homework.pdf').catch(() => null);
    if (attachment) { await sendAttachment(peerId, attachment); return true; }
  }
  return sendVk(peerId, 'Файл задания не найден.');
}

async function showHomeworkCard(peerId, userId, student, submissionId) {
  const row = await submissionCard(student, submissionId);
  if (!row) return sendUi(peerId, userId, 'Задание не найдено.', homeRows());
  const { submission, assignment } = row;
  const status = submission.status === 'submitted' ? '⏳ на проверке'
    : submission.status === 'checked' ? '✅ проверено' : '📚 нужно сделать';
  const rows = [];
  if (assignment.file_id || assignment.telegram_file_id) rows.push([b('📎 Открыть задание', `cjm:hwfile:${assignment.id}`)]);
  if (submission.status === 'assigned') rows.push([b('📤 Сдать работу', `cjm:submit:${submission.id}`, 'primary')]);
  rows.push([b('← К заданиям', 'cjm:hw')]);
  let text = `${assignment.topic}\n\nстатус: ${status}`;
  if (assignment.due_date) text += `\nдедлайн: ${humanDueDate(assignment.due_date)}`;
  return sendUi(peerId, userId, text, rows);
}

function answerRows(submissionId, count) {
  const rows = [];
  for (let i = 0; i < count; i += 4) {
    rows.push(Array.from({ length: Math.min(4, count - i) }, (_, offset) => {
      const index = i + offset;
      return b(String(index + 1), `cjm:briefedit:${submissionId}:${index}`);
    }));
  }
  return rows;
}

async function showBriefReview(peerId, userId, session) {
  const given = session.data?.given || [];
  const subId = session.data?.submission_id;
  const list = given.map((answer, index) => `${index + 1}. ${answer || '—'}`).join('\n');
  await setSession(userId, { step: 'cjm_brief_review', data: session.data });
  return sendUi(peerId, userId, `проверь ответы:\n\n${list}`, [
    ...answerRows(subId, given.length),
    [b('✅ Отправить работу', `cjm:brieffinal:${subId}`, 'positive')],
    [b('❌ Отменить', 'cjm:hw')],
  ]);
}

async function startSubmission(peerId, userId, student, subId) {
  const row = await submissionCard(student, subId);
  if (!row || row.submission.status !== 'assigned') return sendUi(peerId, userId, 'Это задание уже отправлено.', [[b('← К заданиям', 'cjm:hw')]]);
  if (row.assignment.hw_type === 'brief') {
    const brief = await beginBrief(student, subId);
    if (!brief) return sendUi(peerId, userId, 'В этом задании нет настроенных ответов. Напиши преподавателю.', [[b('← К заданиям', 'cjm:hw')]]);
    const given = new Array(brief.answers.length).fill('');
    await setSession(userId, { step: 'cjm_brief_input', data: { submission_id: subId, current: 0, given, mode: 'collect', count: brief.answers.length } });
    return sendUi(peerId, userId, `Задание 1 из ${brief.answers.length}\n\nВведи ответ:`);
  }
  await setSession(userId, { step: 'cjm_files', data: { submission_id: subId, files: [] } });
  return sendUi(peerId, userId, 'Отправь фото или PDF выполненной работы. Можно несколько файлов.', [
    [b('✅ Отправить работу (0)', `cjm:filesend:${subId}`, 'positive')],
    [b('❌ Отменить', 'cjm:hw')],
  ]);
}

async function handleBriefText(peerId, userId, student, text, session) {
  const data = session.data || {};
  const brief = await beginBrief(student, data.submission_id);
  if (!brief) { await setSession(userId, { step: 'student_cjm' }); return home(peerId, userId, student); }
  const given = [...(data.given || new Array(brief.answers.length).fill(''))];
  const current = Math.max(0, Math.min(Number(data.current) || 0, brief.answers.length - 1));
  given[current] = text.trim();
  if (data.mode === 'edit' || current + 1 >= brief.answers.length) {
    return showBriefReview(peerId, userId, { data: { submission_id: data.submission_id, given, count: brief.answers.length } });
  }
  await setSession(userId, { step: 'cjm_brief_input', data: { submission_id: data.submission_id, current: current + 1, given, mode: 'collect', count: brief.answers.length } });
  return sendUi(peerId, userId, `Задание ${current + 2} из ${brief.answers.length}\n\nВведи ответ:`);
}

async function notifyOwner(student, assignment, subId, options = {}) {
  const scoreLine = options.score !== undefined ? `\nрезультат: <b>${options.score}/${options.maxScore}</b>` : '';
  const text = `📥 <b>Сдано ДЗ</b>\nученик: <b>${esc(student.name)}</b>\nтема: <b>${esc(assignment.topic)}</b>${scoreLine}`;
  if (OWNER_TELEGRAM_ID) {
    await sendTelegram(OWNER_TELEGRAM_ID, text, options.needsReview ? {
      reply_markup: { inline_keyboard: [[{ text: '✅ Проверить работу', callback_data: `review:${subId}` }]] },
    } : {}).catch(() => {});
  }
  if (OWNER_VK_ID) {
    await sendVk(OWNER_VK_ID, text, options.needsReview ? {
      keyboard: vkInlineKeyboard([[vkInlineButton('✅ Проверить работу', `review:${subId}`)]]),
    } : {}).catch(() => {});
  }
}

async function finalizeBriefFlow(peerId, userId, student, subId, session) {
  if (session.step !== 'cjm_brief_review' || session.data?.submission_id !== subId) {
    return sendUi(peerId, userId, 'Эта кнопка устарела.', [[b('← К заданиям', 'cjm:hw')]]);
  }
  const result = await finalizeBrief(student, subId, session.data?.given || [], 'vk');
  if (!result) return sendUi(peerId, userId, 'Работа уже отправлена или задание изменилось.', [[b('← К заданиям', 'cjm:hw')]]);
  await setSession(userId, { step: 'student_cjm' });
  await notifyOwner(student, result.assignment, subId, { score: result.score, maxScore: result.maxScore });
  const feedback = result.results.map((ok, index) =>
    `${index + 1}. ${ok ? '✅' : `❌ верно: ${result.correct[index]}`} · ты: ${result.given[index]}`
  ).join('\n');
  return sendUi(peerId, userId, `✅ ${result.score}/${result.maxScore}\n\n${feedback}`, [
    [b('📊 Результаты', 'cjm:results', 'primary')], [b('← Меню', 'cjm:home')],
  ]);
}

async function handleSubmissionFiles(peerId, userId, message, session) {
  if (!message.files.length) return false;
  const files = [...(session.data?.files || []), ...message.files];
  const subId = session.data.submission_id;
  await setSession(userId, { step: 'cjm_files', data: { submission_id: subId, files } });
  await sendUi(peerId, userId, `📎 Добавлено: ${files.length} файл(ов)`, [
    [b(`✅ Отправить работу (${files.length})`, `cjm:filesend:${subId}`, 'positive')],
    [b('❌ Отменить', 'cjm:hw')],
  ]);
  return true;
}

async function finalizeFileFlow(peerId, userId, student, subId, session) {
  if (session.step !== 'cjm_files' || session.data?.submission_id !== subId) return sendUi(peerId, userId, 'Эта кнопка устарела.', [[b('← К заданиям', 'cjm:hw')]]);
  const files = session.data?.files || [];
  if (!files.length) return sendUi(peerId, userId, 'Сначала пришли хотя бы один файл.', [[b('❌ Отменить', 'cjm:hw')]]);
  const result = await finalizeFiles(student, subId, files, 'vk');
  if (!result) return sendUi(peerId, userId, 'Работа уже отправлена.', [[b('📚 Задания', 'cjm:hw')]]);
  await setSession(userId, { step: 'student_cjm' });
  await notifyOwner(student, result.assignment, subId, { needsReview: true });
  return sendUi(peerId, userId, '✅ Работа отправлена. Теперь она находится в разделе «На проверке».', [
    [b('📚 Задания', 'cjm:hw', 'primary')], [b('← Меню', 'cjm:home')],
  ]);
}

async function showLessons(peerId, userId, student) {
  const lessons = await lessonsOverview(student);
  const rows = lessons.map(lesson => [b(`🎓 ${lesson.topic || `Занятие ${lesson.lesson_number || ''}`}`.slice(0, 38), `cjm:lesson:${lesson.id}`)]);
  rows.push([b('← Меню', 'cjm:home')]);
  return sendUi(peerId, userId, lessons.length ? 'Занятия:' : 'Занятий с материалами пока нет.', rows);
}

async function showLesson(peerId, userId, student, lessonId) {
  const data = await lessonDetail(student, lessonId);
  if (!data) return sendUi(peerId, userId, 'Занятие не найдено.', [[b('← К занятиям', 'cjm:lessons')]]);
  const rows = [];
  for (const material of data.materials) {
    const icon = material.material_type === 'recording' ? '🎥' : '📝';
    rows.push([b(`${icon} ${material.title}`.slice(0, 38), `cjm:mat:${material.id}`)]);
  }
  for (const item of data.homework) {
    if (item.submission) rows.push([b(`📚 ${item.assignment.topic}`.slice(0, 38), `cjm:hwcard:${item.submission.id}`)]);
  }
  rows.push([b('← К занятиям', 'cjm:lessons')]);
  const date = data.lesson.scheduled_date || formatDate(data.lesson.created_at);
  return sendUi(peerId, userId, `${data.lesson.topic || 'Занятие'}${date ? `\n${date}` : ''}`, rows);
}

async function openMaterial(peerId, student, materialId) {
  const material = await lessonMaterial(student, materialId);
  if (!material) return sendVk(peerId, 'Материал не найден.');
  if (material.external_url) return sendVk(peerId, `${material.title}\n${material.external_url}`);
  let attachment = material.vk_attachment || null;
  if (!attachment && material.telegram_file_id) {
    attachment = await uploadTelegramFileToVk(material.telegram_file_id, material.file_name || 'material.pdf').catch(() => null);
    if (attachment) await patchLessonMaterial(material.id, { vk_attachment: attachment }).catch(() => {});
  }
  if (attachment) return sendAttachment(peerId, attachment);
  return sendVk(peerId, 'Файл материала сейчас недоступен.');
}

async function showResults(peerId, userId, student) {
  const data = await resultsOverview(student);
  const trial = data.lastTrial
    ? `${data.lastTrial.row.score}/${data.lastTrial.row.max_score || 100}${student.target_score ? ` · цель ${student.target_score}` : ''}`
    : 'ещё не проводился';
  let text = `📊 Результаты\n\nвыполнено: ${data.completed}/${data.total}\n` +
    `последние 3 ДЗ: ${data.recentAverage === null ? '—' : `${data.recentAverage}%`}\n` +
    `динамика: ${data.trend === null ? 'мало данных' : `${data.trend >= 0 ? '+' : ''}${data.trend} п.п.`}\n` +
    `последний пробник: ${trial}`;
  const rows = data.rows.map(({ submission, assignment }) => {
    const pct = percentOf(submission, assignment);
    return [b(`${pct === null ? '✅' : `${pct}%`} ${assignment.topic}`.slice(0, 38), `cjm:result:${submission.id}`)];
  });
  if (!rows.length) text += '\n\nПроверенных работ пока нет.';
  rows.push([b('← Меню', 'cjm:home')]);
  return sendUi(peerId, userId, text, rows);
}

async function showResult(peerId, userId, student, submissionId) {
  const data = await resultDetail(student, submissionId);
  if (!data) return sendUi(peerId, userId, 'Результат не найден.', [[b('← К результатам', 'cjm:results')]]);
  const { submission, assignment, percent } = data;
  let text = `${assignment.topic}\n\n✅ проверено`;
  if (submission.score !== null && submission.score !== undefined) text += `: ${submission.score}/${submission.max_score || 100}${percent !== null ? ` · ${percent}%` : ''}`;
  if (submission.comment) text += `\n\n💬 комментарий:\n${submission.comment}`;
  if (assignment.due_date) text += `\n\n📅 дедлайн: ${assignment.due_date}`;
  if (submission.submitted_at) text += `\n📤 сдано: ${formatDate(submission.submitted_at)}`;
  if (submission.checked_at) text += `\n🔍 проверено: ${formatDate(submission.checked_at)}`;
  if (Array.isArray(submission.student_answers) && submission.student_answers.length) text += `\n\n📝 твои ответы: ${submission.student_answers.join('; ')}`;
  return sendUi(peerId, userId, text, [[b('← К результатам', 'cjm:results')]]);
}

async function handleCallback(update, student) {
  const parsed = callbackData(update);
  const { peerId, userId } = parsed;
  let data = parsed.data;
  if (data.startsWith('hw:')) data = `cjm:hwcard:${data.slice(3)}`;
  else if (data === 'my_stats_back') data = 'cjm:results';
  if (!data.startsWith('cjm:')) return false;
  await answerCallback(update);
  if (!data.startsWith('cjm:hwfile:') && !data.startsWith('cjm:mat:')) await clearScreen(userId);
  if (data === 'cjm:home') { await home(peerId, userId, student); return true; }
  if (data === 'cjm:hw') { await setSession(userId, { step: 'student_cjm' }); await showHomework(peerId, userId, student); return true; }
  if (data === 'cjm:lessons') { await setSession(userId, { step: 'student_cjm' }); await showLessons(peerId, userId, student); return true; }
  if (data === 'cjm:results') { await setSession(userId, { step: 'student_cjm' }); await showResults(peerId, userId, student); return true; }
  if (data.startsWith('cjm:hwcard:')) { await showHomeworkCard(peerId, userId, student, data.slice('cjm:hwcard:'.length)); return true; }
  if (data.startsWith('cjm:hwfile:')) { await sendHomeworkFile(peerId, student, data.slice('cjm:hwfile:'.length)); return true; }
  if (data.startsWith('cjm:submit:')) { await startSubmission(peerId, userId, student, data.slice('cjm:submit:'.length)); return true; }
  if (data.startsWith('cjm:filesend:')) { const session = await getSession(userId); await finalizeFileFlow(peerId, userId, student, data.slice('cjm:filesend:'.length), session); return true; }
  if (data.startsWith('cjm:briefedit:')) {
    const [, , subId, rawIndex] = data.split(':');
    const session = await getSession(userId);
    if (session.step !== 'cjm_brief_review' || session.data?.submission_id !== subId) { await sendUi(peerId, userId, 'Эта кнопка устарела.', [[b('← К заданиям', 'cjm:hw')]]); return true; }
    const index = Number(rawIndex);
    await setSession(userId, { step: 'cjm_brief_input', data: { ...session.data, current: index, mode: 'edit' } });
    await sendUi(peerId, userId, `Исправить ответ ${index + 1}\n\nСейчас: ${session.data.given[index] || '—'}\n\nВведи новый ответ:`);
    return true;
  }
  if (data.startsWith('cjm:brieffinal:')) { const session = await getSession(userId); await finalizeBriefFlow(peerId, userId, student, data.slice('cjm:brieffinal:'.length), session); return true; }
  if (data.startsWith('cjm:lesson:')) { await showLesson(peerId, userId, student, data.slice('cjm:lesson:'.length)); return true; }
  if (data.startsWith('cjm:mat:')) { await openMaterial(peerId, student, data.slice('cjm:mat:'.length)); return true; }
  if (data.startsWith('cjm:result:')) { await showResult(peerId, userId, student, data.slice('cjm:result:'.length)); return true; }
  return false;
}

export async function handleVkStudentCjm(update) {
  const message = update?.type === 'message_new' ? normalizeMessage(update) : null;
  const callback = update?.type === 'message_event' ? callbackData(update) : null;
  const userId = callback?.userId || message?.userId;
  const peerId = callback?.peerId || message?.peerId;
  if (!userId || !peerId || (OWNER_VK_ID && String(userId) === String(OWNER_VK_ID))) return false;

  let student = await studentByVk(userId);
  if (!student && message) {
    const token = message.ref || (message.text && !message.text.startsWith('/') ? message.text : null);
    if (token) {
      const candidate = await studentByToken(token);
      if (candidate) {
        const linked = await linkStudentChannel(candidate, 'vk', userId);
        if (!linked?.ok) { await sendVk(peerId, 'Эта ссылка уже привязана к другому VK-аккаунту. Напиши преподавателю.'); return true; }
        student = linked.student;
        await clearScreen(userId);
        await home(peerId, userId, student);
        return true;
      }
    }
  }
  if (!student) return false;
  await canonicalizeStudent(student);

  if (callback) return handleCallback(update, student);
  if (!message) return false;
  const session = await getSession(userId);
  if (message.files.length && session.step === 'cjm_files') {
    await clearScreen(userId);
    return handleSubmissionFiles(peerId, userId, message, session);
  }
  if (message.text === '/start' || message.text === '/menu' || message.text.toLowerCase() === 'меню') {
    await clearScreen(userId); await home(peerId, userId, student); return true;
  }
  if (message.text === '📚 мои задания' || message.text === '📚 Задания') {
    await clearScreen(userId); await setSession(userId, { step: 'student_cjm' }); await showHomework(peerId, userId, student); return true;
  }
  if (message.text === '📊 мои результаты' || message.text === '📊 Результаты') {
    await clearScreen(userId); await setSession(userId, { step: 'student_cjm' }); await showResults(peerId, userId, student); return true;
  }
  if (message.text === '🎓 Занятия') {
    await clearScreen(userId); await setSession(userId, { step: 'student_cjm' }); await showLessons(peerId, userId, student); return true;
  }
  if (session.step === 'cjm_brief_input' && message.text && !message.text.startsWith('/')) {
    await clearScreen(userId); await handleBriefText(peerId, userId, student, message.text, session); return true;
  }
  if (message.text || message.files.length) {
    await clearScreen(userId); await home(peerId, userId, student); return true;
  }
  return false;
}
