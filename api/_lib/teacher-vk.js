import {
  addLessonMaterialAdmin,
  archiveGroup,
  archiveHomeworkAdmin,
  archiveStudent,
  createGroupAdmin,
  createHomeworkAdmin,
  createStudentAdmin,
  createTeacherLesson,
  finalizeReviewAdmin,
  groupAdminView,
  homeworkAdminView,
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
  updateHomeworkAdmin,
} from './teacher-core.js';
import {
  sendStudentEverywhere,
  sendTelegram,
  sendVk,
  sendVkAttachment,
  telegram,
  tgInlineKeyboard,
  vkInlineButton,
  vkInlineKeyboard,
} from './channels.js';

const OWNER_VK_ID = process.env.OWNER_VK_ID;
const VK_GROUP_ID = process.env.VK_GROUP_ID;
const VK_GROUP_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB = {
  'Content-Type': 'application/json', apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const plain = value => String(value ?? '').replace(/<\/?(?:b|code)>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const b = (text, callback_data, color = 'secondary') => ({ text, callback_data, color });

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
  const row = await sbOne('vk_sessions', `vk_user_id=eq.${encodeURIComponent(userId)}&select=state`);
  return row?.state || {};
}
async function setSession(userId, state) {
  await sbUpsert('vk_sessions', { vk_user_id: userId, state, updated_at: new Date().toISOString() });
}

async function vk(method, params = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, access_token: VK_GROUP_TOKEN, v: VK_API_VERSION })) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const response = await fetch(`https://api.vk.com/method/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.error) throw new Error(`VK ${method}: ${result?.error?.error_msg || response.status}`);
  return result?.response;
}
async function answerCallback(update) {
  const o = update?.object || {};
  if (!o.event_id) return;
  await vk('messages.sendMessageEventAnswer', {
    event_id: o.event_id, user_id: o.user_id, peer_id: o.peer_id,
    event_data: JSON.stringify({ type: 'show_snackbar', text: '✓' }),
  }).catch(() => {});
}

const homeRows = () => [
  [b('👥 Группы', 'teacher:groups', 'primary')],
  [b('🕒 Непроверенное', 'teacher:unchecked')],
  [b('📊 Аналитика', 'teacher:analytics')],
];
function keyboard(rows) {
  return vkInlineKeyboard(rows.map(row => row.map(x => vkInlineButton(x.text, x.callback_data, x.color))));
}
async function screen(peerId, text, rows = []) {
  return sendVk(peerId, plain(text), rows.length ? { keyboard: keyboard(rows) } : {});
}
async function home(peerId, userId) {
  await setSession(userId, { step: 'teacher_home' });
  return screen(peerId, 'TutorOS · панель преподавателя', homeRows());
}

function normalizeMessage(update) {
  const m = update?.object?.message;
  if (!m) return null;
  const attachments = Array.isArray(m.attachments) ? m.attachments : [];
  const files = attachments.map(item => {
    const obj = item?.[item.type];
    if (!obj?.owner_id || !obj?.id) return null;
    return {
      type: item.type,
      file_id: `${item.type}${obj.owner_id}_${obj.id}${obj.access_key ? `_${obj.access_key}` : ''}`,
      name: obj.title || `${item.type}-${obj.id}`,
      url: obj.url || null,
    };
  }).filter(Boolean);
  return { peerId: m.peer_id, userId: m.from_id, text: String(m.text || '').trim(), files };
}
function callback(update) {
  if (update?.type !== 'message_event') return null;
  let payload = update.object?.payload || {};
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = {}; } }
  return { peerId: update.object?.peer_id, userId: update.object?.user_id, data: String(payload.cmd || payload.command || '') };
}

async function showGroups(peerId) {
  const groups = await listTeacherGroups();
  const rows = groups.map(group => [b(`${group.group_type === 'individual' ? '👤' : '👥'} ${group.name}`.slice(0, 38), `teacher:group:${group.id}`)]);
  rows.push([b('➕ Создать группу', 'teacher:newgroup', 'primary')]);
  rows.push([b('← Меню', 'teacher:home')]);
  return screen(peerId, groups.length ? 'Группы' : 'Групп пока нет.', rows);
}

async function showGroup(peerId, groupId) {
  const data = await groupAdminView(groupId);
  if (!data) return screen(peerId, 'Группа не найдена.', [[b('← Группы', 'teacher:groups')]]);
  const { group, students, assignments, lessons, pending, overdue } = data;
  const text = `${group.name}\n\nучеников: ${students.length}\nактивных ДЗ: ${assignments.length}\nзанятий: ${lessons.length}\nна проверке: ${pending}${overdue ? `\n🔴 просрочено: ${overdue}` : ''}`;
  return screen(peerId, text, [
    [b('👥 Ученики', `teacher:students:${group.id}`)],
    [b('🎓 Занятия', `teacher:lessons:${group.id}`)],
    [b('📚 Домашние задания', `teacher:homework:${group.id}`)],
    [b('➕ Создать ДЗ', `teacher:newhw:${group.id}`, 'primary')],
    [b('⚙️ Настройки', `teacher:groupsettings:${group.id}`)],
    [b('← Группы', 'teacher:groups')],
  ]);
}

async function showStudents(peerId, groupId) {
  const students = await listGroupStudentsAdmin(groupId);
  const rows = students.map(student => [b(`${student.telegram_id ? '✅TG' : '▫️TG'} ${student.vk_id ? '✅VK' : '▫️VK'} ${student.name}`.slice(0, 38), `teacher:student:${student.id}`)]);
  rows.push([b('➕ Добавить ученика', `teacher:newstudent:${groupId}`, 'primary')]);
  rows.push([b('← К группе', `teacher:group:${groupId}`)]);
  return screen(peerId, students.length ? 'Ученики' : 'В группе пока нет учеников.', rows);
}

async function inviteLinks(student) {
  const bot = await telegram('getMe').catch(() => null);
  const tg = bot?.username && student.reg_token ? `https://t.me/${bot.username}?start=${encodeURIComponent(student.reg_token)}` : null;
  const vkLink = VK_GROUP_ID && student.reg_token ? `https://vk.com/write-${VK_GROUP_ID}?ref=${encodeURIComponent(student.reg_token)}` : null;
  return { tg, vk: vkLink };
}
async function showStudent(peerId, studentId) {
  const data = await studentAdminView(studentId);
  if (!data) return screen(peerId, 'Ученик не найден.', [[b('← Группы', 'teacher:groups')]]);
  const { student, group, results } = data;
  const links = await inviteLinks(student);
  let text = `${student.name}\nгруппа: ${group?.name || '—'}\n\n` +
    `Telegram: ${student.telegram_id ? '✅ подключён' : '⏳ не подключён'}\n` +
    `VK: ${student.vk_id ? '✅ подключён' : '⏳ не подключён'}\n\n` +
    `код подключения: ${student.reg_token || '—'}`;
  if (links.tg) text += `\n\nTelegram-ссылка:\n${links.tg}`;
  if (links.vk) text += `\n\nVK-ссылка:\n${links.vk}`;
  text += `\n\nРезультаты\nвыполнено: ${results.completed}/${results.total}\nпоследние 3 ДЗ: ${results.recentAverage === null ? '—' : `${results.recentAverage}%`}`;
  return screen(peerId, text, [
    [b('📊 Результаты', `teacher:studentresults:${student.id}`)],
    [b('⚙️ Управление', `teacher:studentsettings:${student.id}`)],
    [b('← К ученикам', `teacher:students:${student.group_id}`)],
  ]);
}
async function showStudentResults(peerId, studentId) {
  const data = await studentAdminView(studentId);
  if (!data) return screen(peerId, 'Ученик не найден.');
  const r = data.results;
  const trial = r.lastTrial ? `${r.lastTrial.row.score}/${r.lastTrial.row.max_score || 100}` : '—';
  return screen(peerId, `${data.student.name} · результаты\n\nвыполнено: ${r.completed}/${r.total}\nпоследние 3 ДЗ: ${r.recentAverage === null ? '—' : `${r.recentAverage}%`}\nдинамика: ${r.trend === null ? 'мало данных' : `${r.trend >= 0 ? '+' : ''}${r.trend} п.п.`}\nпоследний пробник: ${trial}`,
    [[b('← К ученику', `teacher:student:${studentId}`)]]);
}
async function showStudentSettings(peerId, studentId) {
  const data = await studentAdminView(studentId);
  if (!data) return screen(peerId, 'Ученик не найден.');
  return screen(peerId, `${data.student.name} · управление`, [
    [b('🔌 Отвязать TG + VK', `teacher:unlinkstudent:${studentId}`)],
    [b('🔄 Новый код подключения', `teacher:rotatetoken:${studentId}`)],
    [b('📦 Архивировать ученика', `teacher:archivestudent-confirm:${studentId}`)],
    [b('← К ученику', `teacher:student:${studentId}`)],
  ]);
}

async function showLessons(peerId, groupId) {
  const items = await listGroupLessonsAdmin(groupId);
  const rows = items.map(({ lesson, materials, homework }) => [b(`🎓 ${lesson.topic || 'Занятие'} · ${materials.length} мат. · ${homework.length} ДЗ`.slice(0, 38), `teacher:lesson:${groupId}:${lesson.id}`)]);
  rows.push([b('➕ Новое занятие', `teacher:newlesson:${groupId}`, 'primary')]);
  rows.push([b('← К группе', `teacher:group:${groupId}`)]);
  return screen(peerId, items.length ? 'Занятия' : 'Занятий пока нет.', rows);
}
async function showLesson(peerId, groupId, lessonId) {
  const data = await lessonAdminView(groupId, lessonId);
  if (!data) return screen(peerId, 'Занятие не найдено.', [[b('← К занятиям', `teacher:lessons:${groupId}`)]]);
  const notes = data.materials.filter(m => m.material_type === 'notes').length;
  const recordings = data.materials.filter(m => m.material_type === 'recording').length;
  return screen(peerId, `${data.lesson.topic || 'Занятие'}\n${data.lesson.scheduled_date || ''}\n\nконспекты: ${notes}\nзаписи: ${recordings}\nДЗ: ${data.homework.length}`, [
    [b(notes ? '📝 Заменить конспект' : '📝 Добавить конспект', `teacher:addnotes:${groupId}:${lessonId}`)],
    [b(recordings ? '🎥 Изменить запись' : '🎥 Добавить запись', `teacher:addrecording:${groupId}:${lessonId}`)],
    [b('➕ Создать ДЗ', `teacher:newhw:${groupId}:${lessonId}`, 'primary')],
    [b('← К занятиям', `teacher:lessons:${groupId}`)],
  ]);
}

function homeworkKind(value) {
  const type = value?.hw_type || value;
  if (type === 'brief') return 'краткий ответ';
  if (type === 'trial') return 'пробник';
  if (type === 'detailed_hard' || value?.is_advanced) return 'подробный · сложное';
  return 'подробный · несложное';
}

async function showHomework(peerId, groupId) {
  const items = await listGroupHomeworkAdmin(groupId);
  const rows = items.map(({ assignment, submitted, total, overdue }) => [b(
    `${overdue ? '🔴' : '📚'} ${assignment.topic} · ${submitted}/${total}`.slice(0, 38),
    `teacher:hwcard:${assignment.id}`,
  )]);
  rows.push([b('➕ Создать ДЗ', `teacher:newhw:${groupId}`, 'primary')]);
  rows.push([b('← К группе', `teacher:group:${groupId}`)]);
  return screen(peerId, items.length ? 'Домашние задания' : 'Активных ДЗ пока нет.', rows);
}

async function showHomeworkCard(peerId, assignmentId) {
  const data = await homeworkAdminView(assignmentId);
  if (!data) return screen(peerId, 'ДЗ не найдено.', [[b('← Группы', 'teacher:groups')]]);
  const a = data.assignment;
  const text = `${a.topic}\nгруппа: ${data.group.name}\n\n` +
    `тип: ${homeworkKind(a)}\n` +
    `дедлайн: ${a.due_date || 'без срока'}\n` +
    `сдали: ${data.submitted}/${data.submissions.length}\n` +
    `на проверке: ${data.pending}\n` +
    `проверено: ${data.checked}` +
    (data.overdue ? `\n🔴 просрочено: ${data.overdue}` : '') +
    `\nфайл: ${a.telegram_file_id || a.file_id ? 'есть' : 'нет'}`;
  return screen(peerId, text, [
    [b('✏️ Изменить тему', `teacher:hwedit-topic:${a.id}`)],
    [b('📅 Изменить дедлайн', `teacher:hwedit-due:${a.id}`)],
    [b('📎 Заменить файл', `teacher:hwedit-file:${a.id}`)],
    [b('📦 Архивировать ДЗ', `teacher:hwarchive-confirm:${a.id}`)],
    [b('← К ДЗ группы', `teacher:homework:${a.group_id}`)],
  ]);
}

async function showUnchecked(peerId) {
  const items = await listUncheckedAdmin();
  const rows = items.map(({ submission, student, assignment }) => [b(`${student.name} · ${assignment.topic}`.slice(0, 38), `teacher:review:${submission.id}`)]);
  rows.push([b('← Меню', 'teacher:home')]);
  return screen(peerId, items.length ? `Непроверенное · ${items.length}` : '✅ Непроверенных работ нет.', rows);
}
async function showReview(peerId, userId, submissionId) {
  const data = await uncheckedAdminView(submissionId);
  if (!data) return screen(peerId, 'Работа уже проверена или не найдена.', [[b('← Непроверенное', 'teacher:unchecked')]]);
  const files = Array.isArray(data.submission.submitted_files) ? data.submission.submitted_files : [];
  for (const file of files) {
    let attachment = file.file_id || null;
    if (!attachment && file.telegram_file_id) {
      const { uploadTelegramFileToVk } = await import('./channels.js');
      attachment = await uploadTelegramFileToVk(file.telegram_file_id, file.name || 'work.pdf').catch(() => null);
    }
    if (attachment) await sendVkAttachment(peerId, attachment, '').catch(() => {});
  }
  await setSession(userId, { step: 'teacher_review_score', data: { submission_id: submissionId } });
  return screen(peerId, `${data.student.name}\n${data.assignment.topic}\n\nФайлы работы отправлены выше.\n\nВведи оценку в формате 7/10:`, [[b('❌ Отмена', 'teacher:unchecked')]]);
}
async function showAnalytics(peerId) {
  const a = await teacherAnalytics();
  return screen(peerId, `📊 Аналитика\n\nгрупп: ${a.groups}\nучеников: ${a.students}\nактивных ДЗ: ${a.activeHomework}\nна проверке: ${a.unchecked}\nпроверено (последние 100): ${a.checked}\nсредний результат: ${a.average === null ? '—' : `${a.average}%`}`,
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
  let yearExplicit = false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    [year, month, day] = raw.split('-').map(Number);
    yearExplicit = true;
  } else {
    const match = raw.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    yearExplicit = Boolean(match[3]);
    year = match[3] ? Number(match[3]) : Number(dueDate(0).slice(0, 4));
  }
  const build = y => `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  let iso = build(year);
  if (!yearExplicit && iso < dueDate(0)) iso = build(year + 1);
  const check = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(check.getTime())) return null;
  const normalized = new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC' }).format(check);
  if (normalized !== iso || iso < dueDate(0)) return null;
  return iso;
}
const parseList = text => String(text || '').split(';').map(v => v.trim()).filter(Boolean);
const homeworkTypeRows = () => [
  [b('🔢 Краткий ответ', 'teacher:hwtype:brief')],
  [b('📝 Подробный — несложное', 'teacher:hwtype:detailed_easy')],
  [b('📝 Подробный — сложное', 'teacher:hwtype:detailed_hard')],
  [b('📋 Пробник', 'teacher:hwtype:trial')],
];

async function showHomeworkPreview(peerId, userId, data) {
  await setSession(userId, { step: 'teacher_hw_confirm', data });
  const config = data.hw_type === 'brief'
    ? `ответов: ${data.answers?.length || 0}`
    : `баллы по заданиям: ${data.task_config?.length ? data.task_config.join('; ') : 'общая оценка'}`;
  return screen(peerId,
    `Проверь ДЗ перед отправкой\n\n` +
    `тема: ${data.topic}\n` +
    `дедлайн: ${data.due_date || 'без срока'}\n` +
    `тип: ${homeworkKind(data)}\n` +
    `файл: ${data.file_id || data.telegram_file_id ? data.material_name || 'есть' : 'нет'}\n${config}`,
    [
      [b('✅ Создать и отправить', 'teacher:hwconfirm', 'positive')],
      [b('✏️ Начать заново', `teacher:newhw:${data.group_id}:${data.lesson_id || ''}`)],
      [b('❌ Отмена', `teacher:group:${data.group_id}`)],
    ]);
}

async function finalizeHomework(peerId, userId, data) {
  const result = await createHomeworkAdmin(data);
  const subMap = new Map(result.submissions.map(s => [s.student_id, s.id]));
  const due = data.due_date ? `\nдедлайн: <b>${data.due_date}</b>` : '';
  await Promise.all(result.students.map(student => {
    const subId = subMap.get(student.id);
    return sendStudentEverywhere(student, {
      text: `📚 новое ДЗ: <b>${data.topic}</b>${due}`,
      telegramReplyMarkup: subId ? tgInlineKeyboard([[{ text: '📚 Открыть задание', callback_data: `hw:${subId}` }]]) : undefined,
      vkKeyboard: subId ? vkInlineKeyboard([[vkInlineButton('📚 Открыть задание', `hw:${subId}`)]]) : undefined,
      telegramFileId: data.telegram_file_id || null,
      vkAttachment: data.file_id || null,
    });
  }));
  await setSession(userId, { step: 'teacher_home' });
  return screen(peerId, `✅ ДЗ «${data.topic}» создано и отправлено ${result.students.length} ученикам.`, [[b('← К ДЗ группы', `teacher:homework:${data.group_id}`)]]);
}

async function handleMessage(message) {
  const { peerId, userId, text, files } = message;
  const session = await getSession(userId);
  if (text === '/start' || text === '/menu' || text.toLowerCase() === 'меню') { await home(peerId, userId); return true; }
  if (session.step === 'teacher_group_name' && text && !text.startsWith('/')) {
    const group = await createGroupAdmin(text, session.data?.group_type || 'mini_group'); await setSession(userId, { step: 'teacher_home' }); await showGroup(peerId, group.id); return true;
  }
  if (session.step === 'teacher_student_name' && text && !text.startsWith('/')) {
    const student = await createStudentAdmin(session.data.group_id, text); await setSession(userId, { step: 'teacher_home' }); await showStudent(peerId, student.id); return true;
  }
  if (session.step === 'teacher_lesson_topic' && text && !text.startsWith('/')) {
    const lessonId = await createTeacherLesson(session.data.group_id, text); await setSession(userId, { step: 'teacher_home' }); await showLesson(peerId, session.data.group_id, lessonId); return true;
  }
  if (session.step === 'teacher_recording_url' && text && !text.startsWith('/')) {
    if (!/^https?:\/\//i.test(text)) { await screen(peerId, 'Нужна обычная http/https-ссылка.'); return true; }
    const title = `Запись · ${session.data.lesson_topic || 'занятие'}`;
    const result = await addLessonMaterialAdmin({ ...session.data, material_type: 'recording', title, external_url: text });
    await Promise.all(result.students.map(student => sendStudentEverywhere(student, { text: `🎥 <b>${title}</b>\n${text}` })));
    await setSession(userId, { step: 'teacher_home' }); await showLesson(peerId, session.data.group_id, session.data.lesson_id); return true;
  }
  if (session.step === 'teacher_notes_file') {
    const file = files[0]; if (!file) { await screen(peerId, 'Пришли конспект документом.'); return true; }
    const title = `Конспект · ${session.data.lesson_topic || 'занятие'}`;
    const result = await addLessonMaterialAdmin({ ...session.data, material_type: 'notes', title, vk_attachment: file.file_id, file_name: file.name });
    await Promise.all(result.students.map(student => sendStudentEverywhere(student, { text: `📝 новый конспект: <b>${title}</b>`, vkAttachment: file.file_id })));
    await setSession(userId, { step: 'teacher_home' }); await showLesson(peerId, session.data.group_id, session.data.lesson_id); return true;
  }
  if (session.step === 'teacher_hw_topic' && text && !text.startsWith('/')) {
    await setSession(userId, { step: 'teacher_hw_due', data: { ...session.data, topic: text } });
    await screen(peerId, `Тема: ${text}\n\nВыбери дедлайн:`, [
      [b('завтра', 'teacher:hwdue:1'), b('через 3 дня', 'teacher:hwdue:3')],
      [b('через неделю', 'teacher:hwdue:7'), b('без срока', 'teacher:hwdue:none')],
      [b('📅 Своя дата', 'teacher:hwdue:custom')],
    ]); return true;
  }
  if (session.step === 'teacher_hw_due_custom' && text && !text.startsWith('/')) {
    const custom = parseCustomDueDate(text);
    if (!custom) { await screen(peerId, 'Не понял дату. Введи ДД.ММ или ДД.ММ.ГГГГ. Дата не должна быть в прошлом.'); return true; }
    const next = { ...session.data, due_date: custom };
    await setSession(userId, { step: 'teacher_hw_type', data: next });
    await screen(peerId, `Дедлайн: ${custom}\n\nВыбери тип задания:`, homeworkTypeRows());
    return true;
  }
  if (session.step === 'teacher_hw_file') {
    if (text === '-' || text.toLowerCase() === 'нет') {
      const next = { ...session.data, file_id: null, telegram_file_id: null, material_name: null };
      await setSession(userId, { step: 'teacher_hw_config', data: next });
      await screen(peerId, next.hw_type === 'brief' ? 'Введи правильные ответы через точку с запятой.' : 'Введи максимальные баллы за задания через точку с запятой или «-» для общей оценки.'); return true;
    }
    const file = files[0]; if (!file) { await screen(peerId, 'Пришли PDF/документ или отправь «-».'); return true; }
    const next = { ...session.data, file_id: file.file_id, telegram_file_id: null, material_name: file.name };
    await setSession(userId, { step: 'teacher_hw_config', data: next });
    await screen(peerId, next.hw_type === 'brief' ? 'Введи правильные ответы через точку с запятой.' : 'Введи максимальные баллы за задания через точку с запятой или «-» для общей оценки.'); return true;
  }
  if (session.step === 'teacher_hw_config' && text && !text.startsWith('/')) {
    const data = { ...session.data };
    if (data.hw_type === 'brief') { data.answers = parseList(text); if (!data.answers.length) { await screen(peerId, 'Нужен хотя бы один правильный ответ.'); return true; } }
    else data.task_config = text === '-' ? null : parseList(text).map(Number).filter(v => Number.isFinite(v) && v > 0);
    await showHomeworkPreview(peerId, userId, data); return true;
  }
  if (session.step === 'teacher_hw_edit_topic' && text && !text.startsWith('/')) {
    await updateHomeworkAdmin(session.data.assignment_id, { topic: text }); await setSession(userId, { step: 'teacher_home' }); await showHomeworkCard(peerId, session.data.assignment_id); return true;
  }
  if (session.step === 'teacher_hw_edit_due_custom' && text && !text.startsWith('/')) {
    const custom = parseCustomDueDate(text);
    if (!custom) { await screen(peerId, 'Не понял дату. Введи ДД.ММ или ДД.ММ.ГГГГ.'); return true; }
    await updateHomeworkAdmin(session.data.assignment_id, { due_date: custom }); await setSession(userId, { step: 'teacher_home' }); await showHomeworkCard(peerId, session.data.assignment_id); return true;
  }
  if (session.step === 'teacher_hw_edit_file') {
    if (text === '-' || text.toLowerCase() === 'нет') {
      await updateHomeworkAdmin(session.data.assignment_id, { telegram_file_id: null, file_id: null, material_name: null });
      await setSession(userId, { step: 'teacher_home' }); await showHomeworkCard(peerId, session.data.assignment_id); return true;
    }
    const file = files[0]; if (!file) { await screen(peerId, 'Пришли новый PDF/документ или «-», чтобы убрать файл.'); return true; }
    await updateHomeworkAdmin(session.data.assignment_id, { telegram_file_id: null, file_id: file.file_id, material_name: file.name });
    await setSession(userId, { step: 'teacher_home' }); await showHomeworkCard(peerId, session.data.assignment_id); return true;
  }
  if (session.step === 'teacher_review_score' && text && !text.startsWith('/')) {
    const match = text.match(/^\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*$/);
    if (!match) { await screen(peerId, 'Формат: 7/10.'); return true; }
    const score = Number(match[1].replace(',', '.'));
    const maxScore = Number(match[2].replace(',', '.'));
    if (!(maxScore > 0) || score < 0 || score > maxScore) { await screen(peerId, 'Оценка должна быть от 0 до максимума. Например: 7/10.'); return true; }
    await setSession(userId, { step: 'teacher_review_comment', data: { submission_id: session.data.submission_id, score, max_score: maxScore } });
    await screen(peerId, 'Добавь комментарий или отправь «-», если комментарий не нужен.'); return true;
  }
  if (session.step === 'teacher_review_comment' && text && !text.startsWith('/')) {
    const view = await uncheckedAdminView(session.data.submission_id);
    if (!view) { await setSession(userId, { step: 'teacher_home' }); await showUnchecked(peerId); return true; }
    const checked = await finalizeReviewAdmin(session.data.submission_id, session.data.score, session.data.max_score, text === '-' ? '' : text);
    if (checked) {
      await sendStudentEverywhere(view.student, {
        text: `✅ работа проверена: <b>${session.data.score}/${session.data.max_score}</b>` + (text !== '-' ? `\n\n💬 ${text}` : ''),
        telegramReplyMarkup: tgInlineKeyboard([[{ text: '📊 Результаты', callback_data: 'cjm:results' }]]),
        vkKeyboard: vkInlineKeyboard([[vkInlineButton('📊 Результаты', 'cjm:results')]]),
      });
    }
    await setSession(userId, { step: 'teacher_home' }); await showUnchecked(peerId); return true;
  }
  return false;
}

async function handleCallback(update, parsed) {
  const { peerId, userId } = parsed; let data = parsed.data;
  if (data === 'owner_groups') data = 'teacher:groups';
  else if (data === 'owner_home') data = 'teacher:home';
  if (!data.startsWith('teacher:')) return false;
  await answerCallback(update);
  if (data === 'teacher:home') { await home(peerId, userId); return true; }
  if (data === 'teacher:groups') { await showGroups(peerId); return true; }
  if (data === 'teacher:unchecked') { await showUnchecked(peerId); return true; }
  if (data === 'teacher:analytics') { await showAnalytics(peerId); return true; }
  if (data === 'teacher:newgroup') {
    await screen(peerId, 'Какой формат создать?', [
      [b('👥 Мини-группа', 'teacher:newgroup-type:mini_group', 'primary')],
      [b('👤 Индивидуально', 'teacher:newgroup-type:individual')],
      [b('← Группы', 'teacher:groups')],
    ]); return true;
  }
  if (data.startsWith('teacher:newgroup-type:')) {
    const groupType = data.slice('teacher:newgroup-type:'.length);
    await setSession(userId, { step: 'teacher_group_name', data: { group_type: groupType } });
    await screen(peerId, 'Введи название новой группы:'); return true;
  }
  if (data.startsWith('teacher:group:')) { await showGroup(peerId, data.slice('teacher:group:'.length)); return true; }
  if (data.startsWith('teacher:students:')) { await showStudents(peerId, data.slice('teacher:students:'.length)); return true; }
  if (data.startsWith('teacher:newstudent:')) { const groupId = data.slice('teacher:newstudent:'.length); await setSession(userId, { step: 'teacher_student_name', data: { group_id: groupId } }); await screen(peerId, 'Введи имя ученика:'); return true; }
  if (data.startsWith('teacher:studentresults:')) { await showStudentResults(peerId, data.slice('teacher:studentresults:'.length)); return true; }
  if (data.startsWith('teacher:studentsettings:')) { await showStudentSettings(peerId, data.slice('teacher:studentsettings:'.length)); return true; }
  if (data.startsWith('teacher:student:')) { await showStudent(peerId, data.slice('teacher:student:'.length)); return true; }
  if (data.startsWith('teacher:unlinkstudent:')) { const id = data.slice('teacher:unlinkstudent:'.length); await unlinkStudentEverywhere(id); await showStudent(peerId, id); return true; }
  if (data.startsWith('teacher:rotatetoken:')) { const id = data.slice('teacher:rotatetoken:'.length); await rotateStudentToken(id); await showStudent(peerId, id); return true; }
  if (data.startsWith('teacher:archivestudent-confirm:')) {
    const id = data.slice('teacher:archivestudent-confirm:'.length); const s = await studentAdminView(id);
    await screen(peerId, `Архивировать ${s?.student?.name || 'ученика'}? Несданные ДЗ будут отменены, TG/VK отвязаны.`, [
      [b('✅ Да, архивировать', `teacher:archivestudent:${id}`, 'negative')], [b('← Отмена', `teacher:studentsettings:${id}`)],
    ]); return true;
  }
  if (data.startsWith('teacher:archivestudent:')) { const id = data.slice('teacher:archivestudent:'.length); const student = await archiveStudent(id); await showStudents(peerId, student?.group_id || ''); return true; }
  if (data.startsWith('teacher:lessons:')) { await showLessons(peerId, data.slice('teacher:lessons:'.length)); return true; }
  if (data.startsWith('teacher:newlesson:')) { const groupId = data.slice('teacher:newlesson:'.length); await setSession(userId, { step: 'teacher_lesson_topic', data: { group_id: groupId } }); await screen(peerId, 'Введи тему занятия:'); return true; }
  if (data.startsWith('teacher:lesson:')) { const [, , groupId, lessonId] = data.split(':'); await showLesson(peerId, groupId, lessonId); return true; }
  if (data.startsWith('teacher:addnotes:')) { const [, , groupId, lessonId] = data.split(':'); const lesson = await lessonAdminView(groupId, lessonId); await setSession(userId, { step: 'teacher_notes_file', data: { group_id: groupId, lesson_id: lessonId, lesson_topic: lesson?.lesson?.topic } }); await screen(peerId, 'Пришли конспект документом. Новый файл заменит текущий конспект занятия.'); return true; }
  if (data.startsWith('teacher:addrecording:')) { const [, , groupId, lessonId] = data.split(':'); const lesson = await lessonAdminView(groupId, lessonId); await setSession(userId, { step: 'teacher_recording_url', data: { group_id: groupId, lesson_id: lessonId, lesson_topic: lesson?.lesson?.topic } }); await screen(peerId, 'Вставь ссылку на запись занятия. Новая ссылка заменит текущую.'); return true; }
  if (data.startsWith('teacher:homework:')) { await showHomework(peerId, data.slice('teacher:homework:'.length)); return true; }
  if (data.startsWith('teacher:hwcard:')) { await showHomeworkCard(peerId, data.slice('teacher:hwcard:'.length)); return true; }
  if (data.startsWith('teacher:hwedit-topic:')) { const id = data.slice('teacher:hwedit-topic:'.length); await setSession(userId, { step: 'teacher_hw_edit_topic', data: { assignment_id: id } }); await screen(peerId, 'Введи новую тему ДЗ:'); return true; }
  if (data.startsWith('teacher:hwedit-due:')) {
    const id = data.slice('teacher:hwedit-due:'.length);
    await screen(peerId, 'Новый дедлайн:', [
      [b('завтра', `teacher:hweditdue:1:${id}`), b('через 3 дня', `teacher:hweditdue:3:${id}`)],
      [b('через неделю', `teacher:hweditdue:7:${id}`), b('без срока', `teacher:hweditdue:none:${id}`)],
      [b('📅 Своя дата', `teacher:hweditdue:custom:${id}`)], [b('← Назад', `teacher:hwcard:${id}`)],
    ]); return true;
  }
  if (data.startsWith('teacher:hweditdue:')) {
    const parts = data.split(':'); const raw = parts[2]; const id = parts.slice(3).join(':');
    if (raw === 'custom') { await setSession(userId, { step: 'teacher_hw_edit_due_custom', data: { assignment_id: id } }); await screen(peerId, 'Введи дату: ДД.ММ или ДД.ММ.ГГГГ.'); return true; }
    await updateHomeworkAdmin(id, { due_date: raw === 'none' ? null : dueDate(Number(raw)) }); await showHomeworkCard(peerId, id); return true;
  }
  if (data.startsWith('teacher:hwedit-file:')) { const id = data.slice('teacher:hwedit-file:'.length); await setSession(userId, { step: 'teacher_hw_edit_file', data: { assignment_id: id } }); await screen(peerId, 'Пришли новый PDF/документ или «-», чтобы убрать файл.'); return true; }
  if (data.startsWith('teacher:hwarchive-confirm:')) {
    const id = data.slice('teacher:hwarchive-confirm:'.length); const hw = await homeworkAdminView(id);
    await screen(peerId, `Архивировать ДЗ «${hw?.assignment?.topic || ''}»? Несданные работы будут отменены, проверенные результаты сохранятся.`, [
      [b('✅ Архивировать', `teacher:hwarchive:${id}`, 'negative')], [b('← Отмена', `teacher:hwcard:${id}`)],
    ]); return true;
  }
  if (data.startsWith('teacher:hwarchive:')) { const id = data.slice('teacher:hwarchive:'.length); const hw = await homeworkAdminView(id); await archiveHomeworkAdmin(id); await showHomework(peerId, hw?.assignment?.group_id || ''); return true; }
  if (data.startsWith('teacher:newhw:')) { const parts = data.split(':'); await setSession(userId, { step: 'teacher_hw_topic', data: { group_id: parts[2], lesson_id: parts[3] || null } }); await screen(peerId, 'Введи тему ДЗ:'); return true; }
  if (data.startsWith('teacher:hwdue:')) {
    const raw = data.slice('teacher:hwdue:'.length);
    const session = await getSession(userId);
    if (session.step !== 'teacher_hw_due') return true;
    if (raw === 'custom') {
      await setSession(userId, { step: 'teacher_hw_due_custom', data: session.data });
      await screen(peerId, 'Введи дату дедлайна: ДД.ММ или ДД.ММ.ГГГГ.');
      return true;
    }
    await setSession(userId, { step: 'teacher_hw_type', data: { ...session.data, due_date: raw === 'none' ? null : dueDate(Number(raw)) } });
    await screen(peerId, 'Выбери тип задания:', homeworkTypeRows());
    return true;
  }
  if (data.startsWith('teacher:hwtype:')) { const hwType = data.slice('teacher:hwtype:'.length); const session = await getSession(userId); if (session.step !== 'teacher_hw_type') return true; await setSession(userId, { step: 'teacher_hw_file', data: { ...session.data, hw_type: hwType } }); await screen(peerId, 'Пришли PDF/документ или отправь «-», если файла нет.'); return true; }
  if (data === 'teacher:hwconfirm') {
    const session = await getSession(userId);
    if (session.step !== 'teacher_hw_confirm') { await screen(peerId, 'Черновик ДЗ устарел. Создай его заново.', [[b('← Меню', 'teacher:home')]]); return true; }
    await finalizeHomework(peerId, userId, session.data); return true;
  }
  if (data.startsWith('teacher:review:')) { await showReview(peerId, userId, data.slice('teacher:review:'.length)); return true; }
  if (data.startsWith('teacher:groupsettings:')) { const groupId = data.slice('teacher:groupsettings:'.length); const g = await groupAdminView(groupId); await screen(peerId, `${g?.group?.name || 'Группа'} · настройки`, [[b('📦 Архивировать группу', `teacher:archivegroup-confirm:${groupId}`)], [b('← К группе', `teacher:group:${groupId}`)]]); return true; }
  if (data.startsWith('teacher:archivegroup-confirm:')) {
    const groupId = data.slice('teacher:archivegroup-confirm:'.length); const g = await groupAdminView(groupId);
    await screen(peerId, `Архивировать группу ${g?.group?.name || ''}? Все ${g?.students?.length || 0} активных учеников будут архивированы и отвязаны от TG/VK.`, [
      [b('✅ Да, архивировать', `teacher:archivegroup:${groupId}`, 'negative')], [b('← Отмена', `teacher:groupsettings:${groupId}`)],
    ]); return true;
  }
  if (data.startsWith('teacher:archivegroup:')) { const groupId = data.slice('teacher:archivegroup:'.length); await archiveGroup(groupId); await showGroups(peerId); return true; }
  return false;
}

export async function handleVkTeacher(update) {
  const message = update?.type === 'message_new' ? normalizeMessage(update) : null;
  const cb = callback(update);
  const userId = cb?.userId || message?.userId;
  const peerId = cb?.peerId || message?.peerId;
  if (!userId || !peerId || !OWNER_VK_ID || String(userId) !== String(OWNER_VK_ID)) return false;
  if (cb) return handleCallback(update, cb);
  if (message) return handleMessage(message);
  return false;
}
