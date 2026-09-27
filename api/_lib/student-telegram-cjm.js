import {
  beginBrief,
  canonicalizeStudent,
  finalizeBrief,
  finalizeFiles,
  formatDate,
  homeworkOverview,
  humanDueDate,
  lessonDetail,
  lessonMaterial,
  lessonsOverview,
  linkStudentChannel,
  percentOf,
  resultDetail,
  resultsOverview,
  studentByTelegram,
  studentByToken,
  submissionCard,
} from './student-core.js';
import {
  resolveVkAttachmentUrl,
  sendTelegram,
  sendTelegramDocument,
  sendVk,
  telegram,
  tgInlineKeyboard,
  uploadTelegramFileToVk,
  vkInlineButton,
  vkInlineKeyboard,
} from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const OWNER_VK_ID = process.env.OWNER_VK_ID;
const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const btn = (text, callback_data) => ({ text, callback_data });

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

const homeKeyboard = () => tgInlineKeyboard([
  [btn('📚 Задания', 'cjm:hw')],
  [btn('🎓 Занятия', 'cjm:lessons')],
  [btn('📊 Результаты', 'cjm:results')],
]);

async function cleanup(query) {
  const data = String(query?.data || '');
  if (!data.startsWith('cjm:') || data.startsWith('cjm:mat:')) return;
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  if (!chatId || !messageId) return;
  await telegram('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
}

async function home(chatId, userId, student) {
  await setSession(userId, { step: 'student_cjm' });
  return sendTelegram(chatId,
    `привет, <b>${esc(student.name)}</b>!\n\nЗдесь задания, занятия и твои результаты.`, {
      reply_markup: homeKeyboard(),
    });
}

async function showHomework(chatId, student) {
  const { todo, review } = await homeworkOverview(student);
  const rows = [];
  const lines = [];
  if (todo.length) {
    lines.push('<b>Нужно сделать</b>');
    for (const { submission, assignment } of todo) {
      const overdue = assignment.due_date && assignment.due_date < new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
      lines.push(`${overdue ? '🔴' : '📚'} ${esc(assignment.topic)} · ${esc(humanDueDate(assignment.due_date))}`);
      rows.push([btn(`${overdue ? '🔴' : '📚'} ${assignment.topic}`.slice(0, 58), `cjm:hwcard:${submission.id}`)]);
    }
  }
  if (review.length) {
    if (lines.length) lines.push('');
    lines.push('<b>На проверке</b>');
    for (const { submission, assignment } of review) {
      lines.push(`⏳ ${esc(assignment.topic)}`);
      rows.push([btn(`⏳ ${assignment.topic}`.slice(0, 58), `cjm:hwcard:${submission.id}`)]);
    }
  }
  if (!todo.length && !review.length) lines.push('Все текущие задания закрыты.');
  rows.push([btn('← Меню', 'cjm:home')]);
  return sendTelegram(chatId, lines.join('\n'), { reply_markup: tgInlineKeyboard(rows) });
}

async function showHomeworkCard(chatId, student, submissionId) {
  const row = await submissionCard(student, submissionId);
  if (!row) return sendTelegram(chatId, 'Задание не найдено.', { reply_markup: homeKeyboard() });
  const { submission, assignment } = row;
  const status = submission.status === 'submitted' ? '⏳ на проверке'
    : submission.status === 'checked' ? '✅ проверено'
    : '📚 нужно сделать';
  const rows = [];
  if (assignment.file_id || assignment.telegram_file_id) {
    rows.push([btn('📎 Открыть задание', `hwfile:${assignment.id}`)]);
  }
  if (submission.status === 'assigned') rows.push([btn('📤 Сдать работу', `cjm:submit:${submission.id}`)]);
  rows.push([btn('← К заданиям', 'cjm:hw')]);
  let text = `<b>${esc(assignment.topic)}</b>\n\nстатус: <b>${status}</b>`;
  if (assignment.due_date) text += `\nдедлайн: <b>${esc(humanDueDate(assignment.due_date))}</b>`;
  if (submission.status === 'checked' && submission.score !== null && submission.score !== undefined) {
    const pct = percentOf(submission, assignment);
    text += `\nрезультат: <b>${esc(submission.score)}/${esc(submission.max_score || 100)}${pct !== null ? ` · ${pct}%` : ''}</b>`;
  }
  return sendTelegram(chatId, text, { reply_markup: tgInlineKeyboard(rows) });
}

function answerRows(submissionId, count) {
  const buttons = [];
  for (let i = 0; i < count; i += 4) {
    buttons.push(Array.from({ length: Math.min(4, count - i) }, (_, offset) => {
      const index = i + offset;
      return btn(String(index + 1), `cjm:briefedit:${submissionId}:${index}`);
    }));
  }
  return buttons;
}

async function showBriefReview(chatId, userId, session) {
  const given = session.data?.given || [];
  const subId = session.data?.submission_id;
  const list = given.map((answer, index) => `${index + 1}. ${esc(answer || '—')}`).join('\n');
  await setSession(userId, { step: 'cjm_brief_review', data: session.data });
  return sendTelegram(chatId, `проверь ответы:\n\n${list}`, {
    reply_markup: tgInlineKeyboard([
      ...answerRows(subId, given.length),
      [btn('✅ Отправить работу', `cjm:brieffinal:${subId}`)],
      [btn('❌ Отменить', 'cjm:hw')],
    ]),
  });
}

async function startSubmission(chatId, userId, student, submissionId) {
  const row = await submissionCard(student, submissionId);
  if (!row || row.submission.status !== 'assigned') return sendTelegram(chatId, 'Это задание уже отправлено.');
  if (row.assignment.hw_type === 'brief') {
    const brief = await beginBrief(student, submissionId);
    if (!brief) return sendTelegram(chatId, 'В этом задании нет настроенных ответов. Напиши преподавателю.');
    const given = new Array(brief.answers.length).fill('');
    await setSession(userId, {
      step: 'cjm_brief_input',
      data: { submission_id: submissionId, current: 0, given, mode: 'collect', count: brief.answers.length },
    });
    return sendTelegram(chatId, `<b>Задание 1 из ${brief.answers.length}</b>\n\nВведи ответ:`);
  }
  await setSession(userId, { step: 'cjm_files', data: { submission_id: submissionId, files: [] } });
  return sendTelegram(chatId,
    'Отправь фото или PDF выполненной работы. Можно несколько файлов.', {
      reply_markup: tgInlineKeyboard([
        [btn('✅ Отправить работу (0)', `cjm:filesend:${submissionId}`)],
        [btn('❌ Отменить', 'cjm:hw')],
      ]),
    });
}

async function handleBriefText(chatId, userId, student, text, session) {
  const data = session.data || {};
  const subId = data.submission_id;
  const brief = await beginBrief(student, subId);
  if (!brief) {
    await setSession(userId, { step: 'student_cjm' });
    return sendTelegram(chatId, 'Задание уже отправлено или недоступно.', { reply_markup: homeKeyboard() });
  }
  const given = [...(data.given || new Array(brief.answers.length).fill(''))];
  const current = Math.max(0, Math.min(Number(data.current) || 0, brief.answers.length - 1));
  given[current] = text.trim();
  if (data.mode === 'edit') {
    return showBriefReview(chatId, userId, { data: { submission_id: subId, given, count: brief.answers.length } });
  }
  if (current + 1 >= brief.answers.length) {
    return showBriefReview(chatId, userId, { data: { submission_id: subId, given, count: brief.answers.length } });
  }
  await setSession(userId, {
    step: 'cjm_brief_input',
    data: { submission_id: subId, current: current + 1, given, mode: 'collect', count: brief.answers.length },
  });
  return sendTelegram(chatId, `<b>Задание ${current + 2} из ${brief.answers.length}</b>\n\nВведи ответ:`);
}

async function notifyOwner(student, assignment, submissionId, options = {}) {
  const scoreLine = options.score !== undefined ? `\nрезультат: <b>${options.score}/${options.maxScore}</b>` : '';
  const text = `📥 <b>Сдано ДЗ</b>\nученик: <b>${esc(student.name)}</b>\nтема: <b>${esc(assignment.topic)}</b>${scoreLine}`;
  if (OWNER_TELEGRAM_ID) {
    await sendTelegram(OWNER_TELEGRAM_ID, text, options.needsReview ? {
      reply_markup: tgInlineKeyboard([[btn('✅ Проверить работу', `review:${submissionId}`)]]),
    } : {}).catch(() => {});
  }
  if (OWNER_VK_ID) {
    await sendVk(OWNER_VK_ID, text, options.needsReview ? {
      keyboard: vkInlineKeyboard([[vkInlineButton('✅ Проверить работу', `review:${submissionId}`)]]),
    } : {}).catch(() => {});
  }
}

async function finalizeBriefFlow(chatId, userId, student, subId, session) {
  if (session.step !== 'cjm_brief_review' || session.data?.submission_id !== subId) {
    return sendTelegram(chatId, 'Эта кнопка устарела. Открой задание заново.');
  }
  const given = session.data?.given || [];
  const result = await finalizeBrief(student, subId, given, 'telegram');
  if (!result) return sendTelegram(chatId, 'Работа уже отправлена или задание изменилось.');
  await setSession(userId, { step: 'student_cjm' });
  await notifyOwner(student, result.assignment, subId, { score: result.score, maxScore: result.maxScore });
  const feedback = result.results.map((ok, index) =>
    `${index + 1}. ${ok ? '✅' : `❌ верно: ${esc(result.correct[index])}`} · ты: ${esc(result.given[index])}`
  ).join('\n');
  return sendTelegram(chatId,
    `✅ <b>${result.score}/${result.maxScore}</b>\n\n${feedback}`, {
      reply_markup: tgInlineKeyboard([[btn('📊 Результаты', 'cjm:results')], [btn('← Меню', 'cjm:home')]]),
    });
}

async function handleSubmissionMedia(chatId, userId, student, message, session) {
  const telegramFileId = message.document?.file_id || message.photo?.[message.photo.length - 1]?.file_id;
  if (!telegramFileId) return false;
  const fileName = message.document?.file_name || `photo-${Date.now()}.jpg`;
  let vkAttachment = null;
  try { vkAttachment = await uploadTelegramFileToVk(telegramFileId, fileName); }
  catch (error) { console.warn('CJM TG→VK mirror failed:', error?.message || error); }
  const files = [...(session.data?.files || []), {
    type: message.document ? 'document' : 'photo',
    telegram_file_id: telegramFileId,
    file_id: vkAttachment,
    name: fileName,
  }];
  const subId = session.data.submission_id;
  await setSession(userId, { step: 'cjm_files', data: { submission_id: subId, files } });
  await sendTelegram(chatId, `📎 Добавлено: ${files.length} файл(ов)`, {
    reply_markup: tgInlineKeyboard([
      [btn(`✅ Отправить работу (${files.length})`, `cjm:filesend:${subId}`)],
      [btn('❌ Отменить', 'cjm:hw')],
    ]),
  });
  return true;
}

async function finalizeFileFlow(chatId, userId, student, subId, session) {
  if (session.step !== 'cjm_files' || session.data?.submission_id !== subId) {
    return sendTelegram(chatId, 'Эта кнопка устарела. Открой задание заново.');
  }
  const files = session.data?.files || [];
  if (!files.length) return sendTelegram(chatId, 'Сначала пришли хотя бы один файл.');
  const result = await finalizeFiles(student, subId, files, 'telegram');
  if (!result) return sendTelegram(chatId, 'Работа уже отправлена.');
  await setSession(userId, { step: 'student_cjm' });
  await notifyOwner(student, result.assignment, subId, { needsReview: true });
  return sendTelegram(chatId, '✅ Работа отправлена. Теперь она находится в разделе «На проверке».', {
    reply_markup: tgInlineKeyboard([[btn('📚 Задания', 'cjm:hw')], [btn('← Меню', 'cjm:home')]]),
  });
}

async function showLessons(chatId, student) {
  const lessons = await lessonsOverview(student);
  const rows = lessons.map(lesson => [btn(
    `🎓 ${lesson.topic || `Занятие ${lesson.lesson_number || ''}`}`.slice(0, 58),
    `cjm:lesson:${lesson.id}`
  )]);
  rows.push([btn('← Меню', 'cjm:home')]);
  const text = lessons.length ? 'Занятия:' : 'Занятий с материалами пока нет.';
  return sendTelegram(chatId, text, { reply_markup: tgInlineKeyboard(rows) });
}

async function showLesson(chatId, student, lessonId) {
  const data = await lessonDetail(student, lessonId);
  if (!data) return sendTelegram(chatId, 'Занятие не найдено.');
  const rows = [];
  for (const material of data.materials) {
    const icon = material.material_type === 'recording' ? '🎥' : '📝';
    rows.push([btn(`${icon} ${material.title}`.slice(0, 58), `cjm:mat:${material.id}`)]);
  }
  for (const item of data.homework) {
    if (item.submission) rows.push([btn(`📚 ${item.assignment.topic}`.slice(0, 58), `cjm:hwcard:${item.submission.id}`)]);
  }
  rows.push([btn('← К занятиям', 'cjm:lessons')]);
  const date = data.lesson.scheduled_date || formatDate(data.lesson.created_at);
  return sendTelegram(chatId,
    `<b>${esc(data.lesson.topic || 'Занятие')}</b>${date ? `\n${esc(date)}` : ''}`, {
      reply_markup: tgInlineKeyboard(rows),
    });
}

async function openMaterial(chatId, student, materialId) {
  const material = await lessonMaterial(student, materialId);
  if (!material) return sendTelegram(chatId, 'Материал не найден.');
  if (material.external_url) return sendTelegram(chatId, `<b>${esc(material.title)}</b>\n${esc(material.external_url)}`);
  if (material.telegram_file_id) return sendTelegramDocument(chatId, material.telegram_file_id, material.title || 'Материал');
  if (material.vk_attachment) {
    const url = await resolveVkAttachmentUrl(material.vk_attachment).catch(() => null);
    if (url) return sendTelegramDocument(chatId, url, material.title || 'Материал');
  }
  return sendTelegram(chatId, 'Файл материала сейчас недоступен.');
}

async function showResults(chatId, student) {
  const data = await resultsOverview(student);
  const trial = data.lastTrial
    ? `${data.lastTrial.row.score}/${data.lastTrial.row.max_score || 100}${student.target_score ? ` · цель ${student.target_score}` : ''}`
    : 'ещё не проводился';
  let text = `<b>📊 Результаты</b>\n\n` +
    `выполнено: <b>${data.completed}/${data.total}</b>\n` +
    `последние 3 ДЗ: <b>${data.recentAverage === null ? '—' : `${data.recentAverage}%`}</b>\n` +
    `динамика: <b>${data.trend === null ? 'мало данных' : `${data.trend >= 0 ? '+' : ''}${data.trend} п.п.`}</b>\n` +
    `последний пробник: <b>${esc(trial)}</b>`;
  const rows = data.rows.map(({ submission, assignment }) => {
    const pct = percentOf(submission, assignment);
    return [btn(`${pct === null ? '✅' : `${pct}%`} ${assignment.topic}`.slice(0, 58), `cjm:result:${submission.id}`)];
  });
  if (!rows.length) text += '\n\nПроверенных работ пока нет.';
  rows.push([btn('← Меню', 'cjm:home')]);
  return sendTelegram(chatId, text, { reply_markup: tgInlineKeyboard(rows) });
}

async function showResult(chatId, student, submissionId) {
  const data = await resultDetail(student, submissionId);
  if (!data) return sendTelegram(chatId, 'Результат не найден.');
  const { submission, assignment, percent } = data;
  let text = `<b>${esc(assignment.topic)}</b>\n\n✅ проверено`;
  if (submission.score !== null && submission.score !== undefined) {
    text += `: <b>${esc(submission.score)}/${esc(submission.max_score || 100)}${percent !== null ? ` · ${percent}%` : ''}</b>`;
  }
  if (submission.comment) text += `\n\n💬 комментарий:\n${esc(submission.comment)}`;
  if (assignment.due_date) text += `\n\n📅 дедлайн: ${esc(assignment.due_date)}`;
  if (submission.submitted_at) text += `\n📤 сдано: ${esc(formatDate(submission.submitted_at))}`;
  if (submission.checked_at) text += `\n🔍 проверено: ${esc(formatDate(submission.checked_at))}`;
  if (Array.isArray(submission.student_answers) && submission.student_answers.length) {
    text += `\n\n📝 твои ответы: ${submission.student_answers.map(esc).join('; ')}`;
  }
  return sendTelegram(chatId, text, {
    reply_markup: tgInlineKeyboard([[btn('← К результатам', 'cjm:results')]]),
  });
}

async function handleCallback(update, student) {
  const query = update.callback_query;
  let data = String(query.data || '');
  if (data === 'student:home') data = 'cjm:home';
  else if (data === 'student:homework') data = 'cjm:hw';
  else if (data === 'student:materials') data = 'cjm:lessons';
  else if (data === 'student:results') data = 'cjm:results';
  else if (data.startsWith('hw:')) data = `cjm:hwcard:${data.slice(3)}`;
  if (!data.startsWith('cjm:')) return false;
  const chatId = query.message?.chat?.id;
  const userId = query.from?.id;
  if (!chatId || !userId) return false;
  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  await cleanup({ ...query, data });
  if (data === 'cjm:home') return home(chatId, userId, student), true;
  if (data === 'cjm:hw') { await setSession(userId, { step: 'student_cjm' }); await showHomework(chatId, student); return true; }
  if (data === 'cjm:lessons') { await setSession(userId, { step: 'student_cjm' }); await showLessons(chatId, student); return true; }
  if (data === 'cjm:results') { await setSession(userId, { step: 'student_cjm' }); await showResults(chatId, student); return true; }
  if (data.startsWith('cjm:hwcard:')) { await showHomeworkCard(chatId, student, data.slice('cjm:hwcard:'.length)); return true; }
  if (data.startsWith('cjm:submit:')) { await startSubmission(chatId, userId, student, data.slice('cjm:submit:'.length)); return true; }
  if (data.startsWith('cjm:filesend:')) {
    const session = await getSession(userId);
    await finalizeFileFlow(chatId, userId, student, data.slice('cjm:filesend:'.length), session);
    return true;
  }
  if (data.startsWith('cjm:briefedit:')) {
    const [, , subId, rawIndex] = data.split(':');
    const session = await getSession(userId);
    if (session.step !== 'cjm_brief_review' || session.data?.submission_id !== subId) {
      await sendTelegram(chatId, 'Эта кнопка устарела.'); return true;
    }
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= (session.data.given || []).length) {
      await sendTelegram(chatId, 'Ответ не найден.'); return true;
    }
    await setSession(userId, { step: 'cjm_brief_input', data: { ...session.data, current: index, mode: 'edit' } });
    await sendTelegram(chatId, `<b>Исправить ответ ${index + 1}</b>\n\nСейчас: ${esc(session.data.given[index] || '—')}\n\nВведи новый ответ:`);
    return true;
  }
  if (data.startsWith('cjm:brieffinal:')) {
    const session = await getSession(userId);
    await finalizeBriefFlow(chatId, userId, student, data.slice('cjm:brieffinal:'.length), session);
    return true;
  }
  if (data.startsWith('cjm:lesson:')) { await showLesson(chatId, student, data.slice('cjm:lesson:'.length)); return true; }
  if (data.startsWith('cjm:mat:')) { await openMaterial(chatId, student, data.slice('cjm:mat:'.length)); return true; }
  if (data.startsWith('cjm:result:')) { await showResult(chatId, student, data.slice('cjm:result:'.length)); return true; }
  return false;
}

export async function handleTelegramStudentCjm(update) {
  const userId = update?.message?.from?.id || update?.callback_query?.from?.id;
  const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
  if (!userId || !chatId || (OWNER_TELEGRAM_ID && String(userId) === String(OWNER_TELEGRAM_ID))) return false;

  let student = await studentByTelegram(userId);
  const text = String(update?.message?.text || '').trim();

  if (!student && text.startsWith('/start ')) {
    const candidate = await studentByToken(text.slice(7));
    if (!candidate) {
      await sendTelegram(chatId, 'Ссылка недействительна. Попроси преподавателя прислать новую.');
      return true;
    }
    const linked = await linkStudentChannel(candidate, 'telegram', userId);
    if (!linked?.ok) {
      await sendTelegram(chatId, 'Эта ссылка уже привязана к другому Telegram-аккаунту. Напиши преподавателю.');
      return true;
    }
    student = linked.student;
    await home(chatId, userId, student);
    return true;
  }
  if (!student) return false;
  await canonicalizeStudent(student);

  if (update.callback_query) return handleCallback(update, student);
  if (update.message?.document || update.message?.photo) {
    const session = await getSession(userId);
    if (session.step === 'cjm_files') return handleSubmissionMedia(chatId, userId, student, update.message, session);
    return false;
  }
  if (!update.message) return false;
  if (text === '/start' || text === '/menu') { await home(chatId, userId, student); return true; }
  const session = await getSession(userId);
  if (session.step === 'cjm_brief_input' && text && !text.startsWith('/')) {
    await handleBriefText(chatId, userId, student, text, session);
    return true;
  }
  return false;
}
