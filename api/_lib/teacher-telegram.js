import {
  addLessonMaterialAdmin,
  archiveGroup,
  archiveStudent,
  createGroupAdmin,
  createHomeworkAdmin,
  createStudentAdmin,
  finalizeReviewAdmin,
  groupAdminView,
  lessonAdminView,
  listGroupHomeworkAdmin,
  listGroupLessonsAdmin,
  listGroupStudentsAdmin,
  listTeacherGroups,
  listUncheckedAdmin,
  rotateStudentToken,
  studentAdminView,
  teacherAnalytics,
  uncheckedAdminView,
  unlinkStudentEverywhere,
} from './teacher-core.js';
import {
  resolveVkAttachmentUrl,
  sendStudentEverywhere,
  sendTelegram,
  sendTelegramDocument,
  telegram,
  tgInlineKeyboard,
  uploadTelegramFileToVk,
  vkInlineButton,
  vkInlineKeyboard,
} from './channels.js';

const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const VK_GROUP_ID = process.env.VK_GROUP_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB = {
  'Content-Type': 'application/json', apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const b = (text, callback_data) => ({ text, callback_data });

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
async function getSession(userId) {
  const row = await sbOne('telegram_sessions', `telegram_user_id=eq.${encodeURIComponent(userId)}&select=state`);
  return row?.state || {};
}
async function setSession(userId, state) {
  await sbUpsert('telegram_sessions', { telegram_user_id: userId, state, updated_at: new Date().toISOString() });
}

const homeRows = () => [
  [b('👥 Группы', 'teacher:groups')],
  [b('🕒 Непроверенное', 'teacher:unchecked')],
  [b('📊 Аналитика', 'teacher:analytics')],
];

async function cleanup(query) {
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  if (!chatId || !messageId) return;
  await telegram('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
}
async function screen(chatId, text, rows = []) {
  return sendTelegram(chatId, text, rows.length ? { reply_markup: tgInlineKeyboard(rows) } : {});
}
async function home(chatId, userId) {
  await setSession(userId, { step: 'teacher_home' });
  return screen(chatId, '<b>TutorOS</b> · панель преподавателя', homeRows());
}

async function showGroups(chatId) {
  const groups = await listTeacherGroups();
  const rows = groups.map(group => [b(`${group.group_type === 'individual' ? '👤' : '👥'} ${group.name}`.slice(0, 58), `teacher:group:${group.id}`)]);
  rows.push([b('➕ Создать группу', 'teacher:newgroup')]);
  rows.push([b('← Меню', 'teacher:home')]);
  return screen(chatId, groups.length ? '<b>Группы</b>' : 'Групп пока нет.', rows);
}

async function showGroup(chatId, groupId) {
  const data = await groupAdminView(groupId);
  if (!data) return screen(chatId, 'Группа не найдена.', [[b('← Группы', 'teacher:groups')]]);
  const { group, students, assignments, lessons, pending, overdue } = data;
  const text = `<b>${esc(group.name)}</b>\n\n` +
    `учеников: <b>${students.length}</b>\n` +
    `активных ДЗ: <b>${assignments.length}</b>\n` +
    `занятий: <b>${lessons.length}</b>\n` +
    `на проверке: <b>${pending}</b>${overdue ? `\n🔴 просрочено: <b>${overdue}</b>` : ''}`;
  return screen(chatId, text, [
    [b('👥 Ученики', `teacher:students:${group.id}`)],
    [b('🎓 Занятия', `teacher:lessons:${group.id}`)],
    [b('📚 Домашние задания', `teacher:homework:${group.id}`)],
    [b('➕ Создать ДЗ', `teacher:newhw:${group.id}`)],
    [b('⚙️ Настройки', `teacher:groupsettings:${group.id}`)],
    [b('← Группы', 'teacher:groups')],
  ]);
}

async function showStudents(chatId, groupId) {
  const students = await listGroupStudentsAdmin(groupId);
  const rows = students.map(student => [b(`${student.telegram_id ? '✅TG' : '▫️TG'} ${student.vk_id ? '✅VK' : '▫️VK'} ${student.name}`.slice(0, 58), `teacher:student:${student.id}`)]);
  rows.push([b('➕ Добавить ученика', `teacher:newstudent:${groupId}`)]);
  rows.push([b('← К группе', `teacher:group:${groupId}`)]);
  return screen(chatId, students.length ? '<b>Ученики</b>' : 'В группе пока нет учеников.', rows);
}

async function inviteLinks(student) {
  const bot = await telegram('getMe').catch(() => null);
  const tg = bot?.username && student.reg_token ? `https://t.me/${bot.username}?start=${encodeURIComponent(student.reg_token)}` : null;
  const vk = VK_GROUP_ID && student.reg_token ? `https://vk.com/write-${VK_GROUP_ID}?ref=${encodeURIComponent(student.reg_token)}` : null;
  return { tg, vk };
}

async function showStudent(chatId, studentId) {
  const data = await studentAdminView(studentId);
  if (!data) return screen(chatId, 'Ученик не найден.', [[b('← Группы', 'teacher:groups')]]);
  const { student, group, results } = data;
  const links = await inviteLinks(student);
  let text = `<b>${esc(student.name)}</b>\nгруппа: <b>${esc(group?.name || '—')}</b>\n\n` +
    `Telegram: ${student.telegram_id ? '✅ подключён' : '⏳ не подключён'}\n` +
    `VK: ${student.vk_id ? '✅ подключён' : '⏳ не подключён'}\n\n` +
    `код подключения: <code>${esc(student.reg_token || '—')}</code>`;
  if (links.tg) text += `\n\nTelegram-ссылка:\n${esc(links.tg)}`;
  if (links.vk) text += `\n\nVK-ссылка:\n${esc(links.vk)}`;
  text += `\n\n<b>Результаты</b>\nвыполнено: <b>${results.completed}/${results.total}</b>\n` +
    `последние 3 ДЗ: <b>${results.recentAverage === null ? '—' : `${results.recentAverage}%`}</b>`;
  return screen(chatId, text, [
    [b('📊 Результаты', `teacher:studentresults:${student.id}`)],
    [b('⚙️ Управление', `teacher:studentsettings:${student.id}`)],
    [b('← К ученикам', `teacher:students:${student.group_id}`)],
  ]);
}

async function showStudentResults(chatId, studentId) {
  const data = await studentAdminView(studentId);
  if (!data) return screen(chatId, 'Ученик не найден.');
  const r = data.results;
  const trial = r.lastTrial ? `${r.lastTrial.row.score}/${r.lastTrial.row.max_score || 100}` : '—';
  return screen(chatId,
    `<b>${esc(data.student.name)} · результаты</b>\n\n` +
    `выполнено: <b>${r.completed}/${r.total}</b>\n` +
    `последние 3 ДЗ: <b>${r.recentAverage === null ? '—' : `${r.recentAverage}%`}</b>\n` +
    `динамика: <b>${r.trend === null ? 'мало данных' : `${r.trend >= 0 ? '+' : ''}${r.trend} п.п.`}</b>\n` +
    `последний пробник: <b>${trial}</b>`,
    [[b('← К ученику', `teacher:student:${studentId}`)]]);
}

async function showStudentSettings(chatId, studentId) {
  const data = await studentAdminView(studentId);
  if (!data) return screen(chatId, 'Ученик не найден.');
  return screen(chatId, `<b>${esc(data.student.name)}</b> · управление`, [
    [b('🔌 Отвязать TG + VK', `teacher:unlinkstudent:${studentId}`)],
    [b('🔄 Новый код подключения', `teacher:rotatetoken:${studentId}`)],
    [b('📦 Архивировать ученика', `teacher:archivestudent:${studentId}`)],
    [b('← К ученику', `teacher:student:${studentId}`)],
  ]);
}

async function showLessons(chatId, groupId) {
  const items = await listGroupLessonsAdmin(groupId);
  const rows = items.map(({ lesson, materials, homework }) => [b(`🎓 ${lesson.topic || 'Занятие'} · ${materials.length} мат. · ${homework.length} ДЗ`.slice(0, 58), `teacher:lesson:${groupId}:${lesson.id}`)]);
  rows.push([b('➕ Новое занятие', `teacher:newlesson:${groupId}`)]);
  rows.push([b('← К группе', `teacher:group:${groupId}`)]);
  return screen(chatId, items.length ? '<b>Занятия</b>' : 'Занятий пока нет.', rows);
}

async function showLesson(chatId, groupId, lessonId) {
  const data = await lessonAdminView(groupId, lessonId);
  if (!data) return screen(chatId, 'Занятие не найдено.', [[b('← К занятиям', `teacher:lessons:${groupId}`)]]);
  const notes = data.materials.filter(m => m.material_type === 'notes').length;
  const recordings = data.materials.filter(m => m.material_type === 'recording').length;
  return screen(chatId,
    `<b>${esc(data.lesson.topic || 'Занятие')}</b>\n${esc(data.lesson.scheduled_date || '')}\n\n` +
    `конспекты: <b>${notes}</b>\nзаписи: <b>${recordings}</b>\nДЗ: <b>${data.homework.length}</b>`, [
      [b('📝 Добавить конспект', `teacher:addnotes:${groupId}:${lessonId}`)],
      [b('🎥 Добавить запись', `teacher:addrecording:${groupId}:${lessonId}`)],
      [b('➕ Создать ДЗ', `teacher:newhw:${groupId}:${lessonId}`)],
      [b('← К занятиям', `teacher:lessons:${groupId}`)],
    ]);
}

async function showHomework(chatId, groupId) {
  const items = await listGroupHomeworkAdmin(groupId);
  const lines = items.map(({ assignment, total, submitted, pending, overdue }) =>
    `• <b>${esc(assignment.topic)}</b> · сдали ${submitted}/${total}${pending ? ` · ⏳ ${pending}` : ''}${overdue ? ` · 🔴 ${overdue}` : ''}`);
  return screen(chatId, items.length ? `<b>Домашние задания</b>\n\n${lines.join('\n')}` : 'Активных ДЗ пока нет.', [
    [b('➕ Создать ДЗ', `teacher:newhw:${groupId}`)],
    [b('← К группе', `teacher:group:${groupId}`)],
  ]);
}

async function showUnchecked(chatId) {
  const items = await listUncheckedAdmin();
  const rows = items.map(({ submission, student, assignment }) => [b(`${student.name} · ${assignment.topic}`.slice(0, 58), `teacher:review:${submission.id}`)]);
  rows.push([b('← Меню', 'teacher:home')]);
  return screen(chatId, items.length ? `<b>Непроверенное</b> · ${items.length}` : '✅ Непроверенных работ нет.', rows);
}

async function sendSubmittedFiles(chatId, submission) {
  const files = Array.isArray(submission.submitted_files) ? submission.submitted_files : [];
  for (const file of files) {
    if (file.telegram_file_id) {
      await sendTelegramDocument(chatId, file.telegram_file_id, file.name || 'Работа ученика').catch(() => {});
    } else if (file.file_id) {
      const url = await resolveVkAttachmentUrl(file.file_id).catch(() => null);
      if (url) await sendTelegramDocument(chatId, url, file.name || 'Работа ученика').catch(() => {});
    }
  }
}

async function showReview(chatId, userId, submissionId) {
  const data = await uncheckedAdminView(submissionId);
  if (!data) return screen(chatId, 'Работа уже проверена или не найдена.', [[b('← Непроверенное', 'teacher:unchecked')]]);
  await sendSubmittedFiles(chatId, data.submission);
  await setSession(userId, { step: 'teacher_review_score', data: { submission_id: submissionId } });
  return screen(chatId,
    `<b>${esc(data.student.name)}</b>\n${esc(data.assignment.topic)}\n\nФайлы работы отправлены выше.\n\nВведи оценку в формате <code>7/10</code>:`,
    [[b('❌ Отмена', 'teacher:unchecked')]]);
}

async function showAnalytics(chatId) {
  const a = await teacherAnalytics();
  return screen(chatId,
    `<b>📊 Аналитика</b>\n\n` +
    `групп: <b>${a.groups}</b>\nучеников: <b>${a.students}</b>\n` +
    `активных ДЗ: <b>${a.activeHomework}</b>\nна проверке: <b>${a.unchecked}</b>\n` +
    `проверено (последние 100): <b>${a.checked}</b>\nсредний результат: <b>${a.average === null ? '—' : `${a.average}%`}</b>`,
    [[b('← Меню', 'teacher:home')]]);
}

function dueDate(days) {
  if (days === null) return null;
  const d = new Date(); d.setDate(d.getDate() + Number(days));
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(d);
}
function parseCustomDueDate(text) {
  const raw = String(text || '').trim();
  let year;
  let month;
  let day;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    [year, month, day] = raw.split('-').map(Number);
  } else {
    const match = raw.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    year = match[3] ? Number(match[3]) : Number(dueDate(0).slice(0, 4));
  }
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const check = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(check.getTime())) return null;
  const normalized = new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC' }).format(check);
  if (normalized !== iso || iso < dueDate(0)) return null;
  return iso;
}
function parseList(text) {
  return String(text || '').split(';').map(v => v.trim()).filter(Boolean);
}
function homeworkTypeRows(groupId, lessonId = '') {
  const suffix = `${groupId}:${lessonId}`;
  return [
    [b('🔢 Краткий ответ', `teacher:hwtype:brief:${suffix}`)],
    [b('📝 Подробный — несложное', `teacher:hwtype:detailed_easy:${suffix}`)],
    [b('📝 Подробный — сложное', `teacher:hwtype:detailed_hard:${suffix}`)],
    [b('📋 Пробник', `teacher:hwtype:trial:${suffix}`)],
  ];
}

async function finalizeHomework(chatId, userId, data) {
  const result = await createHomeworkAdmin(data);
  const subMap = new Map(result.submissions.map(s => [s.student_id, s.id]));
  const due = data.due_date ? `\nдедлайн: <b>${esc(data.due_date)}</b>` : '';
  await Promise.all(result.students.map(student => {
    const subId = subMap.get(student.id);
    return sendStudentEverywhere(student, {
      text: `📚 новое ДЗ: <b>${esc(data.topic)}</b>${due}`,
      telegramReplyMarkup: subId ? tgInlineKeyboard([[b('📚 Открыть задание', `hw:${subId}`)]]) : undefined,
      vkKeyboard: subId ? vkInlineKeyboard([[vkInlineButton('📚 Открыть задание', `hw:${subId}`)]]) : undefined,
      telegramFileId: data.telegram_file_id || null,
      vkAttachment: data.file_id || null,
    });
  }));
  await setSession(userId, { step: 'teacher_home' });
  return screen(chatId, `✅ ДЗ «<b>${esc(data.topic)}</b>» создано и отправлено ${result.students.length} ученикам.`, [[b('← К группе', `teacher:group:${data.group_id}`)]]);
}

async function handleMessage(update) {
  const message = update.message;
  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();
  const session = await getSession(userId);

  if (text === '/start' || text === '/menu') { await home(chatId, userId); return true; }
  if (session.step === 'teacher_group_name' && text && !text.startsWith('/')) {
    const group = await createGroupAdmin(text);
    await setSession(userId, { step: 'teacher_home' });
    await showGroup(chatId, group.id); return true;
  }
  if (session.step === 'teacher_student_name' && text && !text.startsWith('/')) {
    const student = await createStudentAdmin(session.data.group_id, text);
    await setSession(userId, { step: 'teacher_home' });
    await showStudent(chatId, student.id); return true;
  }
  if (session.step === 'teacher_lesson_topic' && text && !text.startsWith('/')) {
    const { ensureTeacherLesson } = await import('./teacher-core.js');
    const lessonId = await ensureTeacherLesson(session.data.group_id, text);
    await setSession(userId, { step: 'teacher_home' });
    await showLesson(chatId, session.data.group_id, lessonId); return true;
  }
  if (session.step === 'teacher_recording_url' && text && !text.startsWith('/')) {
    if (!/^https?:\/\//i.test(text)) { await screen(chatId, 'Нужна обычная http/https-ссылка.'); return true; }
    const title = `Запись · ${session.data.lesson_topic || 'занятие'}`;
    const result = await addLessonMaterialAdmin({ ...session.data, material_type: 'recording', title, external_url: text });
    await Promise.all(result.students.map(student => sendStudentEverywhere(student, { text: `🎥 <b>${esc(title)}</b>\n${esc(text)}` })));
    await setSession(userId, { step: 'teacher_home' });
    await showLesson(chatId, session.data.group_id, session.data.lesson_id); return true;
  }
  if (session.step === 'teacher_notes_file') {
    if (!message.document?.file_id) { await screen(chatId, 'Пришли конспект документом/PDF.'); return true; }
    const tgId = message.document.file_id;
    const fileName = message.document.file_name || 'notes.pdf';
    const vkAttachment = await uploadTelegramFileToVk(tgId, fileName).catch(() => null);
    const title = `Конспект · ${session.data.lesson_topic || 'занятие'}`;
    const result = await addLessonMaterialAdmin({ ...session.data, material_type: 'notes', title, telegram_file_id: tgId, vk_attachment: vkAttachment, file_name: fileName });
    await Promise.all(result.students.map(student => sendStudentEverywhere(student, { text: `📝 новый конспект: <b>${esc(title)}</b>`, telegramFileId: tgId, vkAttachment })));
    await setSession(userId, { step: 'teacher_home' });
    await showLesson(chatId, session.data.group_id, session.data.lesson_id); return true;
  }
  if (session.step === 'teacher_hw_topic' && text && !text.startsWith('/')) {
    await setSession(userId, { step: 'teacher_hw_due', data: { ...session.data, topic: text } });
    await screen(chatId, `Тема: <b>${esc(text)}</b>\n\nВыбери дедлайн:`, [
      [b('завтра', `teacher:hwdue:1`), b('через 3 дня', `teacher:hwdue:3`)],
      [b('через неделю', `teacher:hwdue:7`), b('без срока', 'teacher:hwdue:none')],
      [b('📅 Своя дата', 'teacher:hwdue:custom')],
    ]); return true;
  }
  if (session.step === 'teacher_hw_due_custom' && text && !text.startsWith('/')) {
    const custom = parseCustomDueDate(text);
    if (!custom) {
      await screen(chatId, 'Не понял дату. Введи <code>ДД.ММ</code> или <code>ДД.ММ.ГГГГ</code>. Дата не должна быть в прошлом.');
      return true;
    }
    const next = { ...session.data, due_date: custom };
    await setSession(userId, { step: 'teacher_hw_type', data: next });
    await screen(chatId, `Дедлайн: <b>${esc(custom)}</b>\n\nВыбери тип задания:`, homeworkTypeRows(next.group_id, next.lesson_id || ''));
    return true;
  }
  if (session.step === 'teacher_hw_file') {
    if (text === '-' || text.toLowerCase() === 'нет') {
      const next = { ...session.data, telegram_file_id: null, file_id: null, material_name: null };
      if (next.hw_type === 'brief') {
        await setSession(userId, { step: 'teacher_hw_config', data: next });
        await screen(chatId, 'Введи правильные ответы через точку с запятой. Например: <code>12; 0,5; -3</code>');
      } else {
        await setSession(userId, { step: 'teacher_hw_config', data: next });
        await screen(chatId, 'Введи максимальные баллы за задания через точку с запятой, например <code>1; 1; 2</code>, или «-» для общей оценки.');
      }
      return true;
    }
    if (!message.document?.file_id) { await screen(chatId, 'Пришли PDF документом или отправь «-».'); return true; }
    const tgId = message.document.file_id;
    const fileName = message.document.file_name || 'homework.pdf';
    const vkAttachment = await uploadTelegramFileToVk(tgId, fileName).catch(() => null);
    const next = { ...session.data, telegram_file_id: tgId, file_id: vkAttachment, material_name: fileName };
    await setSession(userId, { step: 'teacher_hw_config', data: next });
    await screen(chatId, next.hw_type === 'brief'
      ? 'Введи правильные ответы через точку с запятой.'
      : 'Введи максимальные баллы за задания через точку с запятой или «-» для общей оценки.');
    return true;
  }
  if (session.step === 'teacher_hw_config' && text && !text.startsWith('/')) {
    const data = { ...session.data };
    if (data.hw_type === 'brief') {
      data.answers = parseList(text);
      if (!data.answers.length) { await screen(chatId, 'Нужен хотя бы один правильный ответ.'); return true; }
    } else {
      data.task_config = text === '-' ? null : parseList(text).map(Number).filter(v => Number.isFinite(v) && v > 0);
    }
    await finalizeHomework(chatId, userId, data); return true;
  }
  if (session.step === 'teacher_review_score' && text && !text.startsWith('/')) {
    const match = text.match(/^\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*$/);
    if (!match) { await screen(chatId, 'Формат: <code>7/10</code>.'); return true; }
    await setSession(userId, { step: 'teacher_review_comment', data: { submission_id: session.data.submission_id, score: Number(match[1].replace(',', '.')), max_score: Number(match[2].replace(',', '.')) } });
    await screen(chatId, 'Добавь комментарий или отправь «-», если комментарий не нужен.'); return true;
  }
  if (session.step === 'teacher_review_comment' && text && !text.startsWith('/')) {
    const view = await uncheckedAdminView(session.data.submission_id);
    if (!view) { await setSession(userId, { step: 'teacher_home' }); await showUnchecked(chatId); return true; }
    const checked = await finalizeReviewAdmin(session.data.submission_id, session.data.score, session.data.max_score, text === '-' ? '' : text);
    if (checked) {
      await sendStudentEverywhere(view.student, {
        text: `✅ работа проверена: <b>${esc(session.data.score)}/${esc(session.data.max_score)}</b>` + (text !== '-' ? `\n\n💬 ${esc(text)}` : ''),
        telegramReplyMarkup: tgInlineKeyboard([[b('📊 Результаты', 'cjm:results')]]),
        vkKeyboard: vkInlineKeyboard([[vkInlineButton('📊 Результаты', 'cjm:results')]]),
      });
    }
    await setSession(userId, { step: 'teacher_home' }); await showUnchecked(chatId); return true;
  }
  return false;
}

async function handleCallback(update) {
  const q = update.callback_query;
  const chatId = q.message?.chat?.id;
  const userId = q.from?.id;
  let data = String(q.data || '');
  if (data === 'owner:home') data = 'teacher:home';
  else if (data === 'owner:groups') data = 'teacher:groups';
  else if (data === 'owner:unchecked') data = 'teacher:unchecked';
  if (!data.startsWith('teacher:')) return false;
  await telegram('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
  await cleanup(q);
  if (data === 'teacher:home') { await home(chatId, userId); return true; }
  if (data === 'teacher:groups') { await setSession(userId, { step: 'teacher_home' }); await showGroups(chatId); return true; }
  if (data === 'teacher:unchecked') { await setSession(userId, { step: 'teacher_home' }); await showUnchecked(chatId); return true; }
  if (data === 'teacher:analytics') { await setSession(userId, { step: 'teacher_home' }); await showAnalytics(chatId); return true; }
  if (data === 'teacher:newgroup') { await setSession(userId, { step: 'teacher_group_name' }); await screen(chatId, 'Введи название новой группы:'); return true; }
  if (data.startsWith('teacher:group:')) { await showGroup(chatId, data.slice('teacher:group:'.length)); return true; }
  if (data.startsWith('teacher:students:')) { await showStudents(chatId, data.slice('teacher:students:'.length)); return true; }
  if (data.startsWith('teacher:newstudent:')) { const groupId = data.slice('teacher:newstudent:'.length); await setSession(userId, { step: 'teacher_student_name', data: { group_id: groupId } }); await screen(chatId, 'Введи имя ученика:'); return true; }
  if (data.startsWith('teacher:studentresults:')) { await showStudentResults(chatId, data.slice('teacher:studentresults:'.length)); return true; }
  if (data.startsWith('teacher:studentsettings:')) { await showStudentSettings(chatId, data.slice('teacher:studentsettings:'.length)); return true; }
  if (data.startsWith('teacher:student:')) { await showStudent(chatId, data.slice('teacher:student:'.length)); return true; }
  if (data.startsWith('teacher:unlinkstudent:')) { const id = data.slice('teacher:unlinkstudent:'.length); await unlinkStudentEverywhere(id); await showStudent(chatId, id); return true; }
  if (data.startsWith('teacher:rotatetoken:')) { const id = data.slice('teacher:rotatetoken:'.length); await rotateStudentToken(id); await showStudent(chatId, id); return true; }
  if (data.startsWith('teacher:archivestudent:')) { const id = data.slice('teacher:archivestudent:'.length); const student = await archiveStudent(id); await showStudents(chatId, student?.group_id || ''); return true; }
  if (data.startsWith('teacher:lessons:')) { await showLessons(chatId, data.slice('teacher:lessons:'.length)); return true; }
  if (data.startsWith('teacher:newlesson:')) { const groupId = data.slice('teacher:newlesson:'.length); await setSession(userId, { step: 'teacher_lesson_topic', data: { group_id: groupId } }); await screen(chatId, 'Введи тему занятия:'); return true; }
  if (data.startsWith('teacher:lesson:')) { const [, , groupId, lessonId] = data.split(':'); await showLesson(chatId, groupId, lessonId); return true; }
  if (data.startsWith('teacher:addnotes:')) { const [, , groupId, lessonId] = data.split(':'); const lesson = await lessonAdminView(groupId, lessonId); await setSession(userId, { step: 'teacher_notes_file', data: { group_id: groupId, lesson_id: lessonId, lesson_topic: lesson?.lesson?.topic } }); await screen(chatId, 'Пришли конспект документом/PDF.'); return true; }
  if (data.startsWith('teacher:addrecording:')) { const [, , groupId, lessonId] = data.split(':'); const lesson = await lessonAdminView(groupId, lessonId); await setSession(userId, { step: 'teacher_recording_url', data: { group_id: groupId, lesson_id: lessonId, lesson_topic: lesson?.lesson?.topic } }); await screen(chatId, 'Вставь ссылку на запись занятия:'); return true; }
  if (data.startsWith('teacher:homework:')) { await showHomework(chatId, data.slice('teacher:homework:'.length)); return true; }
  if (data.startsWith('teacher:newhw:')) {
    const parts = data.split(':'); const groupId = parts[2]; const lessonId = parts[3] || null;
    await setSession(userId, { step: 'teacher_hw_topic', data: { group_id: groupId, lesson_id: lessonId } });
    await screen(chatId, 'Введи тему ДЗ:'); return true;
  }
  if (data.startsWith('teacher:hwdue:')) {
    const raw = data.slice('teacher:hwdue:'.length); const session = await getSession(userId);
    if (session.step !== 'teacher_hw_due') return true;
    if (raw === 'custom') {
      await setSession(userId, { step: 'teacher_hw_due_custom', data: session.data });
      await screen(chatId, 'Введи дату дедлайна: <code>ДД.ММ</code> или <code>ДД.ММ.ГГГГ</code>.');
      return true;
    }
    const next = { ...session.data, due_date: raw === 'none' ? null : dueDate(Number(raw)) };
    await setSession(userId, { step: 'teacher_hw_type', data: next });
    await screen(chatId, 'Выбери тип задания:', homeworkTypeRows(next.group_id, next.lesson_id || '')); return true;
  }
  if (data.startsWith('teacher:hwtype:')) {
    const parts = data.split(':'); const hwType = parts[2]; const session = await getSession(userId);
    if (session.step !== 'teacher_hw_type') return true;
    await setSession(userId, { step: 'teacher_hw_file', data: { ...session.data, hw_type: hwType } });
    await screen(chatId, 'Пришли PDF документом или отправь «-», если файла нет.'); return true;
  }
  if (data.startsWith('teacher:review:')) { await showReview(chatId, userId, data.slice('teacher:review:'.length)); return true; }
  if (data.startsWith('teacher:groupsettings:')) { const groupId = data.slice('teacher:groupsettings:'.length); const g = await groupAdminView(groupId); await screen(chatId, `<b>${esc(g?.group?.name || 'Группа')}</b> · настройки`, [[b('📦 Архивировать группу', `teacher:archivegroup:${groupId}`)], [b('← К группе', `teacher:group:${groupId}`)]]); return true; }
  if (data.startsWith('teacher:archivegroup:')) { const groupId = data.slice('teacher:archivegroup:'.length); await archiveGroup(groupId); await showGroups(chatId); return true; }
  return false;
}

export async function handleTelegramTeacher(update) {
  const userId = update?.message?.from?.id || update?.callback_query?.from?.id;
  const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
  if (!userId || !chatId || !OWNER_TELEGRAM_ID || String(userId) !== String(OWNER_TELEGRAM_ID)) return false;
  if (update.callback_query) return handleCallback(update);
  if (update.message) return handleMessage(update);
  return false;
}
