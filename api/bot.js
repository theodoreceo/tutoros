// api/bot.js — Telegram Bot Webhook (Vercel Serverless, Node 18+)
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;

// ── Supabase REST helpers ─────────────────────────────────────────────────────

const SB = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
};

async function sbSelect(table, qs = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB });
  if (!r.ok) throw new Error(`sbSelect ${table}: ${await r.text()}`);
  return r.json();
}

async function sbOne(table, qs) {
  const rows = await sbSelect(table, qs + '&limit=1');
  return rows[0] ?? null;
}

async function sbInsert(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbInsert ${table}: ${await r.text()}`);
  return r.json();
}

async function sbPatch(table, qs, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH', headers: SB, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbPatch ${table}: ${await r.text()}`);
}

async function sbUpsert(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbUpsert ${table}: ${await r.text()}`);
  return r.json();
}

// ── Session ───────────────────────────────────────────────────────────────────

async function getSession(tid) {
  const row = await sbOne('bot_sessions', `telegram_id=eq.${tid}`);
  return row?.state ?? {};
}

async function setSession(tid, state) {
  await sbUpsert('bot_sessions', { telegram_id: tid, state, updated_at: new Date().toISOString() });
}

// ── Telegram helpers ──────────────────────────────────────────────────────────

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

const send  = (chatId, text, extra = {}) => tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
const cbq   = (id, text = '') => tg('answerCallbackQuery', { callback_query_id: id, text });
const kbd   = (rows) => ({ reply_markup: JSON.stringify({ inline_keyboard: rows }) });
const botId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ── Reply keyboards (persistent bottom buttons) ───────────────────────────────

const STUDENT_KBD = [
  [{ text: '📚 Мои задания' }, { text: '📊 Мои результаты' }],
  [{ text: '❓ Помощь' }],
];
const CURATOR_KBD = [
  [{ text: '➕ Создать ДЗ' }, { text: '📋 Мои задания' }],
  [{ text: '❓ Помощь' }],
];

const rkbd = (rows) => ({
  reply_markup: JSON.stringify({ keyboard: rows, resize_keyboard: true, persistent: true }),
});

// ── Bot messages (edit here) ──────────────────────────────────────────────────

const MSGS = {
  // /start
  startStudent:     (name) => `привет, <b>${name}</b>!\nиспользуй кнопки ниже или команды:\n/dz - посмотреть домашки, которые надо сдать\n/mydz - посмотреть все сданные домашки и статистику по ним`,
  startCurator:     (name) => `привет, <b>${name}</b>!\nиспользуй кнопки ниже или команды:\n\n/newdz - добавить новую домашку\n/mydz - посмотреть уже созданные домашки`,
  startUnknown:     `приветствую, это твой бот для домашек!\nчтобы начать им пользоваться, введи код, который тебе скинет куратор\n(если еще не скинул, напиши ему в лс)\n\nпо всем вопросам с ботом пиши в чат курса или мне в лс: @repeteddy`,

  // /help
  helpStudent:      `команды, доступные в боте:\n/dz - домашки, которые надо сдать\n/mydz - сданные домашки\n/unlink - отвязать аккаунт (не жми просто так)`,
  helpCurator:      `команды, доступные в боте:\n/newdz - создать ДЗ\n/mydz - созданные домашки\n/unlink - отвязать аккаунт`,
  helpUnknown:      `введи код, который тебе пришлет куратор\nпо всем вопросам с ботом пиши в чат или в лс: @repeteddy`,

  // /unlink
  unlinkNotReg:     `ты не зарегистрирован`,
  unlinkAsk:        (name) => `ты не <b>${name}</b>? если да, тогда отвяжи свой аккаунт`,
  unlinkDone:       `аккаунт отвязан. введи новый код, чтобы пользоваться ботом.\nполучи его у куратора или у меня в лс: @repeteddy`,
  unlinkCancel:     `отмена.`,

  // Регистрация
  tokenUsed:        `этот код уже использован. напиши куратору или мне в лс: @repeteddy`,
  tokenOk:          (name) => `все супер! ты подключен как <b>${name}</b>! 👇`,
  tokenNotFound:    `код не найден. проверь, точно ли ты правильно вставил код, который тебе отправил куратор.\nесли все правильно, скинь ему скриншот этого сообщения.`,

  // Ученик: список заданий
  noHw:             `нет активных домашек. все сдано, ты молодец!`,
  noHw2:            `все домашки сданы, хорош!`,
  hwList:           (n, lines) => `задания (${n}):\n${lines}\n\nвыбери, что сдать:`,
  unknownCmd:       `напиши /help, чтобы увидеть список всех команд`,

  // Ученик: открытие задания
  hwBriefMulti:     (topic, desc, n) => `<b>${topic}</b>${desc}\n\nЗаданий: <b>${n}</b>\nВведи все ответы через запятую:\nПример: <code>3, 15, да</code>`,
  hwBriefSingle:    (topic, desc)    => `<b>${topic}</b>${desc}\n\nВведи ответ:`,
  hwDetailed:       (topic, desc)    => `<b>${topic}</b>${desc}\n\nОтправь выполненное задание фото или PDF-файлом.\nМожно несколько файлов — нажми «Отправить работу», когда пришлёшь всё.`,
  hwGone:           `Задание уже сдано или не найдено.`,
  hwNotFound:       `Задание не найдено.`,

  // Ученик: ответы (краткий тип)
  briefAnswerStep:  (num, total, answer) => `<b>задание ${num} из ${total}</b>\n\n${answer || '(ответ не введён)'}`,
  briefResults:     (correct, total, feedback) => `результат: <b>${correct}/${total}</b>\n\n${feedback}`,
  answersExpected:  (n)       => `Ожидается <b>${n}</b> ответов через запятую.\nПример: <code>3, 15, да</code>`,
  answerCorrect:    (name)    => `✅ Верно! Отлично, <b>${name}</b>!`,
  answerWrong:      (correct) => `❌ Неверно.\nПравильный ответ: <b>${correct || 'не указан'}</b>`,

  // Ученик: сдача файлов
  fileReceived:     (n) => `📎 Файл получен (всего: ${n})`,
  filePrompt:       `Прикрепи фото или PDF-файл. Когда пришлёшь всё — нажми кнопку «Отправить работу».`,
  fileRequired:     `Пришли хотя бы один файл с выполненным заданием.`,
  fileSubmitted:    (n) => `✅ Работа отправлена (${n} файл(ов))!\nКуратор получит уведомление и проверит в TutorOS.`,
  fileCancelled:    `Сдача отменена. /dz — посмотреть задания.`,
  fileNoContext:    `Сначала открой задание через /dz.`,
  subNotFound:      `Не найдено.`,

  // Уведомления
  hwNotify:         (topic, typeLabel, due) => `📚 Новое ДЗ: <b>${topic}</b>\nТип: ${typeLabel}${due}\n\n/dz — открыть задания`,
  curatorNotify:    (name, topic, n) => `📤 Ученик <b>${name}</b> сдал «${topic}» (${n} файл(ов)). Проверь в TutorOS.`,

  // Куратор: создание ДЗ
  noGroups:         `У тебя нет назначенных групп.`,
  groupsNotFound:   `Группы не найдены.`,
  selectGroups:     `Выбери группы (можно несколько):`,
  groupsSelected:   (names) => `Выбрано: ${names}\n\nДобавь ещё или подтверди:`,
  groupsNone:       `Выбери хотя бы одну группу.`,
  groupsConfirmed:  (names) => `Группы: <b>${names}</b>\n\nВведи тему задания:`,
  askDeadline:      `Введи дедлайн (ДД.ММ.ГГГГ) или «-» без дедлайна:`,
  invalidDate:      `Неверный формат. Введи ДД.ММ.ГГГГ или «-»:`,
  selectHwType:     `Выбери тип задания:`,
  askPdf:           `Отправь PDF-файл с заданием (или напиши «-» чтобы пропустить):`,
  pdfReceived:      (brief) => `📎 Файл получен!\n\n${brief ? 'Сколько заданий (ответов) в этой работе?' : 'Сколько заданий в этой работе?'}`,
  askCountBrief:    `Сколько заданий (ответов) в этой работе?`,
  askCountOther:    `Сколько заданий в этой работе?`,
  invalidCount:     `Введи число от 1 до 50:`,
  askAnswer:        (i, n) => `Введи ответ на <b>задание ${i}</b> из ${n}:`,
  askScore:         (i, n) => `Максимальный балл за <b>задание ${i}</b> из ${n}:`,
  invalidScore:     `Введи число (например: 5 или 2.5):`,
  hwCreateError:    (msg) => `❌ Ошибка при создании задания:\n<code>${msg}</code>`,
  hwCreated:        (groupsLine, topic, typeLabel, due, students, extra, warnLine) =>
    `✅ ДЗ создано!\n${groupsLine}\nТема: <b>${topic}</b>\nТип: <b>${typeLabel}</b>\nДедлайн: <b>${due || 'не указан'}</b>\nУчеников: <b>${students}</b>${extra}${warnLine}\n\nВ TutorOS обнови страницу (F5) чтобы увидеть ДЗ.`,
  dzUnknownCmd:     `Используй /newdz для создания задания.`,

  // Куратор: управление ДЗ
  noAssignedGroups: `Нет назначенных групп.`,
  dzNone:           `ДЗ не найдено.`,
  dzNoMore:         `Больше ДЗ нет.`,
  dzList:           (lines) => `Домашние задания:\n\n${lines}\n\nВыбери для управления:`,
  dzTopicUpdated:   (topic) => `✅ Тема обновлена: <b>${topic}</b>`,
  askNewTopic:      `Введи новую тему:`,
  dzDateUpdated:    (due)   => `✅ Дедлайн обновлён: <b>${due || 'не указан'}</b>`,
  askNewDate:       `Введи новый дедлайн (ДД.ММ.ГГГГ) или «-» чтобы убрать:`,
  dzDeleteAsk:      (topic) => `Удалить ДЗ «<b>${topic}</b>» и все записи учеников?`,
  dzDeleted:        `✅ ДЗ удалено.`,

  // Прочее
  registerFirst:    `Сначала зарегистрируйся, отправив регистрационный код.`,
};

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });
  const update = req.body ?? {};
  try {
    if (update.callback_query)                                   await handleCallback(update.callback_query);
    else if (update.message?.photo || update.message?.document) await handleMedia(update.message);
    else if (update.message?.text)                               await handleText(update.message);
  } catch (err) {
    console.error('Bot error:', err);
  }
  res.status(200).json({ ok: true });
}

// ── Text handler ──────────────────────────────────────────────────────────────

async function handleText(msg) {
  const chatId = msg.chat.id;
  const tid    = msg.from.id;
  const text   = msg.text.trim();

  const [student, curator] = await Promise.all([
    sbOne('students', `telegram_id=eq.${tid}`),
    sbOne('roles',    `telegram_id=eq.${tid}`),
  ]);

  // ── Menu button shortcuts (checked before slash commands so they always work) ──
  if (text === '📚 Мои задания'    && student)  return handleStudentListHw(chatId, student);
  if (text === '📊 Мои результаты' && student)  return showStudentStats(chatId, student);
  if (text === '➕ Создать ДЗ'    && curator)  return startHwCreation(chatId, tid, curator);
  if (text === '📋 Мои задания'    && curator)  return showMyDz(chatId, tid, curator, 0);
  if (text === '❓ Помощь') {
    if (student) return send(chatId, MSGS.helpStudent, rkbd(STUDENT_KBD));
    if (curator) return send(chatId, MSGS.helpCurator, rkbd(CURATOR_KBD));
    return send(chatId, MSGS.helpUnknown);
  }

  // /start
  if (text === '/start') {
    if (student) {
      await setSession(tid, { step: 'student' });
      return send(chatId, MSGS.startStudent(student.name), rkbd(STUDENT_KBD));
    }
    if (curator) {
      await setSession(tid, { step: 'curator' });
      return send(chatId, MSGS.startCurator(curator.name), rkbd(CURATOR_KBD));
    }
    await setSession(tid, {});
    return send(chatId, MSGS.startUnknown);
  }

  // /unlink
  if (text === '/unlink') {
    if (!student && !curator) return send(chatId, MSGS.unlinkNotReg);
    return send(chatId, MSGS.unlinkAsk((student || curator).name),
      kbd([[{ text: '✅ Да, отвязать', callback_data: 'unlink:confirm' }, { text: '❌ Отмена', callback_data: 'unlink:cancel' }]]));
  }

  // /help
  if (text === '/help') {
    if (student) return send(chatId, MSGS.helpStudent, rkbd(STUDENT_KBD));
    if (curator) return send(chatId, MSGS.helpCurator, rkbd(CURATOR_KBD));
    return send(chatId, MSGS.helpUnknown);
  }

  // Student commands
  if (student) {
    if (text === '/dz')   return handleStudentListHw(chatId, student);
    if (text === '/mydz') return showStudentStats(chatId, student);
    const sess = await getSession(tid);
    if (typeof sess.step === 'string' && sess.step.startsWith('await_answer:')) {
      const subId = sess.step.slice('await_answer:'.length);
      return handleStudentAnswer(chatId, student, subId, text, sess);
    }
    if (typeof sess.step === 'string' && sess.step.startsWith('await_files:')) {
      const subId = sess.step.slice('await_files:'.length);
      const files = sess.data?.files || [];
      if (text.toLowerCase() === 'готово') {
        if (!files.length) return send(chatId, MSGS.fileRequired);
        return finalizeStudentFiles(chatId, student, subId, files);
      }
      return send(chatId, MSGS.filePrompt);
    }
    return send(chatId, MSGS.unknownCmd);
  }

  // Curator commands
  if (curator) {
    if (text === '/newdz') return startHwCreation(chatId, tid, curator);
    if (text === '/mydz')  return showMyDz(chatId, tid, curator, 0);
    if (text === '/help')  return send(chatId, MSGS.helpCurator, rkbd(CURATOR_KBD));
    const sess = await getSession(tid);
    if (typeof sess.step === 'string' && sess.step.startsWith('edit_hw_topic:')) {
      const hwId = sess.step.slice('edit_hw_topic:'.length);
      await sbPatch('homework_assignments', `id=eq.${hwId}`, { topic: text });
      await setSession(tid, { step: 'curator' });
      return send(chatId, MSGS.dzTopicUpdated(text), kbd([[{ text: '← Назад к ДЗ', callback_data: `dz:${hwId}` }]]));
    }
    if (typeof sess.step === 'string' && sess.step.startsWith('edit_hw_date:')) {
      const hwId = sess.step.slice('edit_hw_date:'.length);
      const raw  = text === '-' ? '' : text;
      if (raw && !/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
        return send(chatId, MSGS.invalidDate);
      }
      const due = raw ? raw.split('.').reverse().join('-') : '';
      await sbPatch('homework_assignments', `id=eq.${hwId}`, { due_date: due });
      await setSession(tid, { step: 'curator' });
      return send(chatId, MSGS.dzDateUpdated(due), kbd([[{ text: '← Назад к ДЗ', callback_data: `dz:${hwId}` }]]));
    }
    return handleCuratorStep(chatId, tid, curator, sess, text);
  }

  // Unregistered — try as reg_token
  return handleRegistration(chatId, tid, text);
}

// ── Media handler (photos and documents) ─────────────────────────────────────

async function handleMedia(msg) {
  const chatId = msg.chat.id;
  const tid    = msg.from.id;

  const [student, curator] = await Promise.all([
    sbOne('students', `telegram_id=eq.${tid}`),
    sbOne('roles',    `telegram_id=eq.${tid}`),
  ]);

  const fileId   = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document?.file_id;
  const fileType = msg.photo ? 'photo' : 'document';

  // Curator uploading PDF for HW creation
  if (curator) {
    const sess = await getSession(tid);
    if (sess.step === 'await_pdf') {
      const newData = { ...sess.data, file_id: fileId };
      await setSession(tid, { step: 'await_count', data: newData });
      return send(chatId, MSGS.pdfReceived(newData.hw_type === 'brief'));
    }
  }

  // Student submitting work files
  if (student) {
    const sess = await getSession(tid);
    if (typeof sess.step === 'string' && sess.step.startsWith('await_files:')) {
      const subId = sess.step.slice('await_files:'.length);
      const files = [...(sess.data?.files || []), { type: fileType, file_id: fileId }];
      await setSession(tid, { step: `await_files:${subId}`, data: { ...sess.data, files } });
      return send(chatId, MSGS.fileReceived(files.length),
        kbd([[{ text: '✅ Отправить работу', callback_data: `submit_files:${subId}` }],
             [{ text: '❌ Отменить',         callback_data: 'cancel_files' }]]));
    }
    return send(chatId, MSGS.fileNoContext);
  }

  if (!student && !curator) {
    return send(chatId, MSGS.registerFirst);
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

async function handleRegistration(chatId, tid, token) {
  const clean = token.toLowerCase().trim();
  const [sm, rm] = await Promise.all([
    sbOne('students', `reg_token=eq.${encodeURIComponent(clean)}`),
    sbOne('roles',    `reg_token=eq.${encodeURIComponent(clean)}`),
  ]);

  if (sm) {
    if (sm.telegram_id) return send(chatId, MSGS.tokenUsed);
    await sbPatch('students', `id=eq.${sm.id}`, { telegram_id: tid });
    await setSession(tid, { step: 'student' });
    return send(chatId, MSGS.tokenOk(sm.name), rkbd(STUDENT_KBD));
  }
  if (rm) {
    if (rm.telegram_id) return send(chatId, MSGS.tokenUsed);
    await sbPatch('roles', `id=eq.${rm.id}`, { telegram_id: tid });
    await setSession(tid, { step: 'curator' });
    return send(chatId, MSGS.tokenOk(rm.name), rkbd(CURATOR_KBD));
  }
  return send(chatId, MSGS.tokenNotFound);
}

// ── Student: list HW ──────────────────────────────────────────────────────────

async function handleStudentListHw(chatId, student) {
  const subs = await sbSelect('homework_submissions', `student_id=eq.${student.id}&status=eq.assigned`);
  if (!subs.length) return send(chatId, MSGS.noHw);

  const aIds      = [...new Set(subs.map(s => s.assignment_id))];
  const assignments = await sbSelect('homework_assignments',
    `id=in.(${aIds.join(',')})&select=id,topic,due_date,hw_type`);
  const aMap = Object.fromEntries(assignments.map(a => [a.id, a]));

  const buttons = [];
  const lines   = [];
  subs.forEach((sub, i) => {
    const a = aMap[sub.assignment_id];
    if (!a) return;
    const due    = a.due_date ? ` · срок: ${a.due_date}` : '';
    const dueBtn = a.due_date ? ` · ${a.due_date.slice(8)}.${a.due_date.slice(5, 7)}` : '';
    const type   = a.hw_type === 'brief' ? ' [краткий]' : a.hw_type === 'trial' ? ' [пробник]' : '';
    lines.push(`${i + 1}. <b>${a.topic || 'Без темы'}</b>${type}${due}`);
    buttons.push([{ text: `${i + 1}. ${(a.topic || 'ДЗ').slice(0, 28)}${dueBtn}`, callback_data: `hw:${sub.id}` }]);
  });

  if (!lines.length) return send(chatId, MSGS.noHw2);
  return send(chatId, MSGS.hwList(lines.length, lines.join('\n')), kbd(buttons));
}

// ── Student: my results (/mydz) ───────────────────────────────────────────────

function toPercent(score, maxScore, taskConfig) {
  if (score === null || score === undefined) return null;
  if (maxScore) return Math.round(score / maxScore * 100);
  if (Array.isArray(taskConfig) && taskConfig.length)
    return Math.round(score / taskConfig.reduce((a, b) => a + b, 0) * 100);
  return score; // brief HW already stores 0-100
}

async function showStudentStats(chatId, student) {
  const allSubs = await sbSelect('homework_submissions',
    `student_id=eq.${student.id}&order=submitted_at.desc.nullsfirst`);

  const assigned  = allSubs.filter(s => s.status === 'assigned').length;
  const submitted = allSubs.filter(s => s.status === 'submitted').length;
  const checked   = allSubs.filter(s => s.status === 'checked');

  const done = allSubs.filter(s => s.status !== 'assigned');
  const aIds = done.length ? [...new Set(done.map(s => s.assignment_id))] : [];
  const assignments = aIds.length
    ? await sbSelect('homework_assignments', `id=in.(${aIds.join(',')})&select=id,topic,due_date,hw_type,task_config`)
    : [];
  const aMap = Object.fromEntries(assignments.map(a => [a.id, a]));

  const checkedWithScore = checked.filter(s => s.score !== null);
  const avgPct = checkedWithScore.length
    ? Math.round(checkedWithScore.reduce((sum, s) => {
        return sum + (toPercent(s.score, s.max_score, aMap[s.assignment_id]?.task_config) ?? 0);
      }, 0) / checkedWithScore.length)
    : null;

  const scoreBar = avgPct !== null
    ? (avgPct >= 80 ? '🟢' : avgPct >= 50 ? '🟡' : '🔴') + ` ${avgPct}%`
    : '—';

  const header = `📊 <b>Мои результаты</b> · ${student.name}\n\n` +
    `⏳ Ждут сдачи: <b>${assigned}</b>\n` +
    `📤 На проверке: <b>${submitted}</b>\n` +
    `✅ Проверено: <b>${checked.length}</b>\n` +
    `⭐ Средний балл: <b>${scoreBar}</b>`;

  if (!done.length) return send(chatId, header + '\n\nПока нет сданных работ.');

  const buttons = done.slice(0, 10).map(sub => {
    const a    = aMap[sub.assignment_id];
    const pct  = toPercent(sub.score, sub.max_score, a?.task_config);
    const icon = sub.status === 'submitted' ? '📤'
      : pct !== null && pct >= 80 ? '✅'
      : pct !== null && pct >= 50 ? '🟡' : pct !== null ? '❌' : '✅';
    const scoreStr = pct !== null ? ` ${pct}%` : '';
    const label    = (a?.topic || '—').slice(0, 30);
    return [{ text: `${icon}${scoreStr} ${label}`, callback_data: `my_sub:${sub.id}` }];
  });

  return send(chatId, header + `\n\nПоследние работы (${done.length}):`, kbd(buttons));
}

async function showStudentSubDetail(chatId, student, subId) {
  const sub = await sbOne('homework_submissions', `id=eq.${subId}&student_id=eq.${student.id}`);
  if (!sub) return send(chatId, MSGS.subNotFound);

  const assignment = await sbOne('homework_assignments',
    `id=eq.${sub.assignment_id}&select=id,topic,description,due_date,hw_type,task_config`);

  const pct = toPercent(sub.score, sub.max_score, assignment?.task_config);
  const statusLine = sub.status === 'submitted' ? '📤 На проверке'
    : sub.status === 'checked' && pct !== null ? `✅ Проверено: <b>${pct}%</b>`
    : sub.status === 'checked' ? '✅ Проверено'
    : sub.status;

  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null;

  let text = `<b>${assignment?.topic || '—'}</b>\n\n${statusLine}`;
  if (sub.comment)          text += `\n\n💬 Комментарий:\n${sub.comment}`;
  if (assignment?.due_date) text += `\n\n📅 Дедлайн: ${assignment.due_date}`;
  if (sub.submitted_at)     text += `\n📤 Сдано: ${fmtDate(sub.submitted_at)}`;
  if (sub.checked_at)       text += `\n🔍 Проверено: ${fmtDate(sub.checked_at)}`;
  if (sub.student_answers?.length) text += `\n\n📝 Твои ответы: <code>${sub.student_answers.join(', ')}</code>`;

  return send(chatId, text, kbd([[{ text: '← Назад к результатам', callback_data: 'my_stats_back' }]]));
}

// ── Student: answer submission (brief) ───────────────────────────────────────

async function handleStudentAnswer(chatId, student, subId, text, sess) {
  const sub = await sbOne('homework_submissions', `id=eq.${subId}&student_id=eq.${student.id}`);
  if (!sub) return send(chatId, MSGS.hwNotFound);

  const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);
  if (!assignment) return send(chatId, MSGS.hwNotFound);

  // Multi-answer brief - step-by-step mode
  if (assignment.answers && Array.isArray(assignment.answers)) {
    const correct = assignment.answers;
    const given = sess.data?.given || new Array(correct.length).fill('');
    const current = sess.data?.current ?? 0;

    // Сохраняем ответ на текущий вопрос
    given[current] = text;

    // Показываем следующий вопрос с навигацией
    return showBriefAnswerStep(chatId, student.telegram_id, subId, correct, given, current);
  }

  // Single correct_answer (legacy)
  const correct   = (assignment.correct_answer ?? '').trim();
  const isCorrect = correct !== '' && text.trim() === correct;
  const now = new Date().toISOString();
  await sbPatch('homework_submissions', `id=eq.${subId}`, {
    status: 'checked', submitted_at: now, checked_at: now,
    score: isCorrect ? 100 : 0, max_score: 100,
    comment: isCorrect ? 'Верно!' : `Неверно. Правильный ответ: ${correct || 'не указан'}`,
    source: 'telegram',
  });
  if (student.telegram_id) await setSession(student.telegram_id, { step: 'student' });
  return send(chatId, isCorrect ? MSGS.answerCorrect(student.name) : MSGS.answerWrong(correct));
}

async function showBriefAnswerStep(chatId, tid, subId, correct, given, current) {
  const buttons = [];
  if (current > 0) buttons.push({ text: '← назад', callback_data: `brief_prev:${subId}:${current}` });
  if (current < correct.length - 1) buttons.push({ text: 'вперед →', callback_data: `brief_next:${subId}:${current}` });
  buttons.push({ text: '✅ отправить', callback_data: `brief_submit:${subId}` });

  await setSession(tid, {
    step: `brief_answer:${subId}`,
    data: { subId, correct, given, current }
  });

  return send(chatId, MSGS.briefAnswerStep(current + 1, correct.length, given[current]), kbd([buttons]));
}

async function submitBriefAnswers(chatId, student, subId, correct, given) {
  const now = new Date().toISOString();
  const results    = correct.map((c, i) => given[i]?.toLowerCase().trim() === c.toLowerCase().trim());
  const numCorrect = results.filter(Boolean).length;
  const score      = Math.round((numCorrect / correct.length) * 100);
  const maxScore   = 100;

  await sbPatch('homework_submissions', `id=eq.${subId}`, {
    status: 'checked', submitted_at: now, checked_at: now,
    score, max_score: maxScore,
    comment: `${numCorrect}/${correct.length} верно`,
    student_answers: given, source: 'telegram',
  });
  await setSession(student.telegram_id, { step: 'student' });

  const feedback = results.map((ok, i) => `${i + 1}. ${ok ? '✅' : `❌ (верно: ${correct[i]})`}\n   ты: <code>${given[i] || 'не ответил'}</code>`).join('\n');
  return send(chatId, MSGS.briefResults(numCorrect, correct.length, feedback));
}

// ── Student: finalize file submission ─────────────────────────────────────────

async function finalizeStudentFiles(chatId, student, subId, files) {
  const sub = await sbOne('homework_submissions', `id=eq.${subId}&student_id=eq.${student.id}`);
  if (!sub) return send(chatId, MSGS.hwNotFound);

  const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);

  await sbPatch('homework_submissions', `id=eq.${subId}`, {
    status:          'submitted',
    submitted_at:    new Date().toISOString(),
    submitted_files: files,
    source:          'telegram',
  });
  await setSession(student.telegram_id, { step: 'student' });

  if (assignment) await notifyCuratorsWithFiles(assignment, student, files);

  return send(chatId, MSGS.fileSubmitted(files.length));
}

// ── Curator: start HW creation with multi-group ───────────────────────────────

async function startHwCreation(chatId, tid, curator) {
  const agRows = await sbSelect('assistant_groups', `assistant_id=eq.${curator.id}`);

  let groups;
  if (curator.role_type === 'owner' || curator['isOwner']) {
    groups = await sbSelect('groups', 'order=name.asc');
  } else {
    if (!agRows.length) return send(chatId, MSGS.noGroups);
    const gIds = agRows.map(ag => ag.group_id);
    groups = await sbSelect('groups', `id=in.(${gIds.join(',')})`);
  }

  if (!groups.length) return send(chatId, MSGS.groupsNotFound);

  const allGroups      = groups.map(g => ({ id: g.id, name: g.name }));
  const selectedGroups = [];
  await setSession(tid, { step: 'await_group', data: { all_groups: allGroups, selected_groups: selectedGroups } });

  return send(chatId, MSGS.selectGroups, kbd(buildGroupKbd(allGroups, selectedGroups)));
}

function buildGroupKbd(allGroups, selectedIds) {
  const rows = allGroups.map(g => [{
    text:          (selectedIds.includes(g.id) ? '✅ ' : '☐ ') + g.name,
    callback_data: `grp_toggle:${g.id}`,
  }]);
  rows.push([{ text: '✅ Подтвердить выбор', callback_data: 'grp_confirm' }]);
  return rows;
}

// ── Curator: step-by-step text input ─────────────────────────────────────────

async function handleCuratorStep(chatId, tid, curator, sess, text) {
  switch (sess.step) {
    case 'await_topic':
      await setSession(tid, { step: 'await_date', data: { ...sess.data, topic: text } });
      return send(chatId, MSGS.askDeadline);

    case 'await_date': {
      const due = text === '-' ? '' : text;
      if (due && !/^\d{2}\.\d{2}\.\d{4}$/.test(due)) {
        return send(chatId, MSGS.invalidDate);
      }
      const dueFmt = due ? due.split('.').reverse().join('-') : '';
      await setSession(tid, { step: 'await_hwtype', data: { ...sess.data, due_date: dueFmt } });
      return send(chatId, MSGS.selectHwType,
        kbd([
          [{ text: '🔢 Краткий ответ',         callback_data: 'hwtype:brief'         }],
          [{ text: '📝 Подробный — несложное',  callback_data: 'hwtype:detailed_easy' }],
          [{ text: '📝 Подробный — сложное',    callback_data: 'hwtype:detailed_hard' }],
          [{ text: '📋 Пробник',                callback_data: 'hwtype:trial'         }],
        ]));
    }

    case 'await_pdf': {
      if (text !== '-') return send(chatId, MSGS.askPdf);
      const newData = { ...sess.data, file_id: null };
      await setSession(tid, { step: 'await_count', data: newData });
      return send(chatId, newData.hw_type === 'brief' ? MSGS.askCountBrief : MSGS.askCountOther);
    }

    case 'await_count': {
      const n = parseInt(text, 10);
      if (!n || n < 1 || n > 50) return send(chatId, MSGS.invalidCount);
      if (sess.data.hw_type === 'brief') {
        await setSession(tid, { step: 'await_answers', data: { ...sess.data, total: n, collected: [] } });
        return send(chatId, MSGS.askAnswer(1, n));
      } else {
        await setSession(tid, { step: 'await_scores', data: { ...sess.data, total: n, scores: [] } });
        return send(chatId, MSGS.askScore(1, n));
      }
    }

    case 'await_answers': {
      const collected = [...(sess.data.collected || []), text];
      const total     = sess.data.total;
      if (collected.length < total) {
        await setSession(tid, { step: 'await_answers', data: { ...sess.data, collected } });
        return send(chatId, MSGS.askAnswer(collected.length + 1, total));
      }
      return finishHwCreation(chatId, tid, curator, { ...sess.data, answers: collected });
    }

    case 'await_scores': {
      const score = parseFloat(text.replace(',', '.'));
      if (isNaN(score) || score < 0) return send(chatId, MSGS.invalidScore);
      const scores = [...(sess.data.scores || []), score];
      const total  = sess.data.total;
      if (scores.length < total) {
        await setSession(tid, { step: 'await_scores', data: { ...sess.data, scores } });
        return send(chatId, MSGS.askScore(scores.length + 1, total));
      }
      return finishHwCreation(chatId, tid, curator, { ...sess.data, task_config: scores });
    }

    default:
      return send(chatId, MSGS.dzUnknownCmd);
  }
}

// ── Curator: finish creating HW (multi-group) ─────────────────────────────────

async function finishHwCreation(chatId, tid, curator, data) {
  const hw_type     = data.hw_type === 'trial' ? 'trial'
    : data.hw_type.startsWith('detailed') ? 'detailed'
    : 'brief';
  const is_advanced = data.hw_type === 'detailed_hard';

  const groupIds   = data.group_ids  || [data.group_id];
  const groupNames = data.group_names || data.group_name || groupIds.join(', ');

  let totalStudents = 0;
  let subErrors     = 0;

  for (const groupId of groupIds) {
    const assignmentId = botId();
    try {
      await sbInsert('homework_assignments', {
        id:             assignmentId,
        group_id:       groupId,
        lesson_id:      null,
        topic:          data.topic,
        description:    '',
        due_date:       data.due_date ?? '',
        hw_type,
        is_advanced,
        correct_answer: null,
        assigned_at:    new Date().toISOString(),
        file_id:        data.file_id     ?? null,
        answers:        data.answers     ?? null,
        task_config:    data.task_config ?? null,
      });
    } catch (err) {
      await setSession(tid, { step: 'curator' });
      return send(chatId, MSGS.hwCreateError(err.message));
    }

    const students = await sbSelect('students',
      `group_id=eq.${groupId}&crm_status=in.(active,trial)`);
    totalStudents += students.length;

    const typeLabel = hw_type === 'brief' ? 'Краткий ответ'
      : hw_type === 'trial' ? 'Пробник'
      : is_advanced ? 'Подробный (сложный)' : 'Подробный';
    const due = data.due_date ? `\nДедлайн: <b>${data.due_date}</b>` : '';

    for (const stu of students) {
      try {
        await sbInsert('homework_submissions', {
          id: botId(), assignment_id: assignmentId, student_id: stu.id,
          status: 'assigned', source: 'telegram',
          submitted_at: null, score: null, comment: '', errors: [],
          checked_by: null, checked_at: null, submission_url: '',
        });
      } catch { subErrors++; }
      if (stu.telegram_id) await send(stu.telegram_id, MSGS.hwNotify(data.topic, typeLabel, due)).catch(() => {});
    }
  }

  await setSession(tid, { step: 'curator' });

  const typeLabel = hw_type === 'brief' ? 'Краткий ответ'
    : hw_type === 'trial' ? 'Пробник'
    : is_advanced ? 'Подробный (сложный)' : 'Подробный (несложный)';

  const extra = hw_type === 'brief' && data.answers
    ? `\nОтветы: <code>${data.answers.join(', ')}</code>`
    : hw_type !== 'brief' && data.task_config
    ? `\nБаллов за задания: <code>${data.task_config.join(', ')}</code> (сумма: ${data.task_config.reduce((a, b) => a + b, 0)})`
    : '';

  const groupsLine = groupIds.length > 1
    ? `Групп: <b>${groupIds.length}</b> (${groupNames})`
    : `Группа: <b>${groupNames}</b>`;
  const warnLine = subErrors ? `\n⚠️ Ошибок при создании записей: ${subErrors}` : '';

  return send(chatId, MSGS.hwCreated(groupsLine, data.topic, typeLabel, data.due_date, totalStudents, extra, warnLine));
}

// ── Curator: list my DZ ───────────────────────────────────────────────────────

async function showMyDz(chatId, tid, curator, offset) {
  let assignments;
  if (curator.role_type === 'owner' || curator['isOwner']) {
    assignments = await sbSelect('homework_assignments',
      `order=assigned_at.desc&limit=10&offset=${offset}`);
  } else {
    const agRows = await sbSelect('assistant_groups', `assistant_id=eq.${curator.id}`);
    if (!agRows.length) return send(chatId, MSGS.noAssignedGroups);
    const gIds = agRows.map(ag => ag.group_id);
    assignments = await sbSelect('homework_assignments',
      `group_id=in.(${gIds.join(',')})&order=assigned_at.desc&limit=10&offset=${offset}`);
  }

  if (!assignments.length) return send(chatId, offset === 0 ? MSGS.dzNone : MSGS.dzNoMore);

  const typeEmoji = { brief: '🔢', detailed: '📝', trial: '📋' };
  const lines   = assignments.map((a, i) =>
    `${offset + i + 1}. ${typeEmoji[a.hw_type] || '📝'} <b>${a.topic || '—'}</b>${a.due_date ? ` · ${a.due_date}` : ''}`
  );
  const buttons = assignments.map(a => [{ text: (a.topic || '—').slice(0, 40), callback_data: `dz:${a.id}` }]);

  const nav = [];
  if (offset > 0) nav.push({ text: '← Назад', callback_data: `dz_pg:${offset - 10}` });
  if (assignments.length === 10) nav.push({ text: 'Ещё →', callback_data: `dz_pg:${offset + 10}` });
  if (nav.length) buttons.push(nav);

  return send(chatId, MSGS.dzList(lines.join('\n')), kbd(buttons));
}

async function showDzDetail(chatId, hwId) {
  const a = await sbOne('homework_assignments', `id=eq.${hwId}`);
  if (!a) return send(chatId, MSGS.dzNone);

  const groups    = await sbSelect('groups', `id=eq.${a.group_id}&select=name`);
  const groupName = groups[0]?.name || '—';
  const subsCount = await sbSelect('homework_submissions', `assignment_id=eq.${hwId}&select=status`);
  const submitted = subsCount.filter(s => ['submitted', 'checked'].includes(s.status)).length;
  const typeLabel = a.hw_type === 'brief' ? '🔢 Краткий' : a.hw_type === 'trial' ? '📋 Пробник' : '📝 Подробный';
  const advLabel  = a.is_advanced ? ' (сложный)' : '';

  const text =
    `<b>${a.topic || '—'}</b>\n` +
    `Группа: ${groupName}\n` +
    `Тип: ${typeLabel}${advLabel}\n` +
    `Дедлайн: ${a.due_date || 'не указан'}\n` +
    `Сдано: ${submitted}/${subsCount.length}`;

  return send(chatId, text, kbd([
    [{ text: '✏️ Изменить тему',    callback_data: `dz_et:${hwId}` },
     { text: '📅 Изменить дедлайн', callback_data: `dz_ed:${hwId}` }],
    [{ text: '🗑️ Удалить ДЗ',      callback_data: `dz_del:${hwId}` }],
    [{ text: '← К списку',          callback_data: 'dz_pg:0' }],
  ]));
}

// ── Callback handler ──────────────────────────────────────────────────────────

async function handleCallback(cq) {
  const chatId = cq.message.chat.id;
  const msgId  = cq.message.message_id;
  const tid    = cq.from.id;
  const data   = cq.data;
  await cbq(cq.id);

  const [student, curator, sess] = await Promise.all([
    sbOne('students', `telegram_id=eq.${tid}`),
    sbOne('roles',    `telegram_id=eq.${tid}`),
    getSession(tid),
  ]);

  // /mydz navigation and management
  if (data.startsWith('dz_pg:') && curator) {
    return showMyDz(chatId, tid, curator, parseInt(data.slice(6), 10) || 0);
  }
  if (data.startsWith('dz:') && curator) {
    return showDzDetail(chatId, data.slice(3));
  }
  if (data.startsWith('dz_et:') && curator) {
    const hwId = data.slice(6);
    await setSession(tid, { step: `edit_hw_topic:${hwId}` });
    return send(chatId, MSGS.askNewTopic);
  }
  if (data.startsWith('dz_ed:') && curator) {
    const hwId = data.slice(6);
    await setSession(tid, { step: `edit_hw_date:${hwId}` });
    return send(chatId, MSGS.askNewDate);
  }
  if (data.startsWith('dz_del:') && curator) {
    const hwId = data.slice(7);
    const a    = await sbOne('homework_assignments', `id=eq.${hwId}&select=topic`);
    return send(chatId, MSGS.dzDeleteAsk(a?.topic || hwId),
      kbd([[{ text: '✅ Да, удалить', callback_data: `dz_delok:${hwId}` },
             { text: '❌ Отмена',     callback_data: `dz:${hwId}` }]]));
  }
  if (data.startsWith('dz_delok:') && curator) {
    const hwId = data.slice(9);
    const subs = await sbSelect('homework_submissions', `assignment_id=eq.${hwId}&select=id`);
    for (const s of subs) {
      await fetch(`${SUPABASE_URL}/rest/v1/homework_submissions?id=eq.${s.id}`,
        { method: 'DELETE', headers: SB });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/homework_assignments?id=eq.${hwId}`,
      { method: 'DELETE', headers: SB });
    await setSession(tid, { step: 'curator' });
    return send(chatId, MSGS.dzDeleted);
  }

  // Unlink
  if (data === 'unlink:confirm') {
    if (student) await sbPatch('students', `id=eq.${student.id}`, { telegram_id: null });
    if (curator) await sbPatch('roles',    `id=eq.${curator.id}`, { telegram_id: null });
    await setSession(tid, {});
    return send(chatId, MSGS.unlinkDone);
  }
  if (data === 'unlink:cancel') return send(chatId, MSGS.unlinkCancel);

  // Multi-group toggle
  if (data.startsWith('grp_toggle:') && curator && sess.step === 'await_group') {
    const groupId     = data.slice('grp_toggle:'.length);
    const allGroups   = sess.data?.all_groups || [];
    const selected    = sess.data?.selected_groups || [];
    const newSelected = selected.includes(groupId)
      ? selected.filter(id => id !== groupId)
      : [...selected, groupId];

    await setSession(tid, { step: 'await_group', data: { ...sess.data, selected_groups: newSelected } });

    const selectedNames = allGroups.filter(g => newSelected.includes(g.id)).map(g => g.name);
    const statusText    = newSelected.length
      ? MSGS.groupsSelected(selectedNames.join(', '))
      : MSGS.selectGroups;

    await tg('editMessageText', {
      chat_id:      chatId,
      message_id:   msgId,
      text:         statusText,
      parse_mode:   'HTML',
      reply_markup: JSON.stringify({ inline_keyboard: buildGroupKbd(allGroups, newSelected) }),
    });
    return;
  }

  // Confirm group selection
  if (data === 'grp_confirm' && curator && sess.step === 'await_group') {
    const allGroups  = sess.data?.all_groups || [];
    const selected   = sess.data?.selected_groups || [];
    if (!selected.length) return send(chatId, MSGS.groupsNone);
    const groupNames = allGroups.filter(g => selected.includes(g.id)).map(g => g.name).join(', ');
    await setSession(tid, { step: 'await_topic', data: { ...sess.data, group_ids: selected, group_names: groupNames } });
    return send(chatId, MSGS.groupsConfirmed(groupNames));
  }

  // Curator: HW type selection
  if (data.startsWith('hwtype:') && curator && sess.step === 'await_hwtype') {
    const hwType = data.slice(7);
    await setSession(tid, { step: 'await_pdf', data: { ...sess.data, hw_type: hwType } });
    return send(chatId, MSGS.askPdf);
  }

  // Student taps HW
  if (data.startsWith('hw:') && student) {
    const subId = data.slice(3);
    const sub   = await sbOne('homework_submissions',
      `id=eq.${subId}&student_id=eq.${student.id}&status=eq.assigned`);
    if (!sub) return send(chatId, MSGS.hwGone);

    const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);
    if (!assignment) return send(chatId, MSGS.hwNotFound);

    if (assignment.file_id) {
      await tg('sendDocument', { chat_id: chatId, document: assignment.file_id });
    }

    const desc = assignment.description ? `\n${assignment.description}` : '';

    if (assignment.hw_type === 'brief') {
      const answers = assignment.answers;
      if (answers && Array.isArray(answers) && answers.length > 0) {
        const given = new Array(answers.length).fill('');
        return showBriefAnswerStep(chatId, tid, subId, answers, given, 0);
      }
      await setSession(tid, { step: `await_answer:${subId}` });
      return send(chatId, MSGS.hwBriefSingle(assignment.topic, desc));
    }

    // detailed / trial → collect files from student
    await setSession(tid, { step: `await_files:${subId}`, data: { files: [] } });
    return send(chatId, MSGS.hwDetailed(assignment.topic, desc),
      kbd([[{ text: '✅ Отправить работу', callback_data: `submit_files:${subId}` }],
           [{ text: '❌ Отменить',         callback_data: 'cancel_files' }]]));
  }

  // Student submits collected files
  if (data.startsWith('submit_files:') && student) {
    const subId = data.slice('submit_files:'.length);
    const files = sess.data?.files || [];
    if (!files.length) return send(chatId, MSGS.fileRequired);
    return finalizeStudentFiles(chatId, student, subId, files);
  }

  // Student cancels file submission
  if (data === 'cancel_files' && student) {
    await setSession(tid, { step: 'student' });
    return send(chatId, MSGS.fileCancelled);
  }

  // Brief answers navigation and submission
  if (data.startsWith('brief_prev:') && student && sess.step && sess.step.startsWith('brief_answer:')) {
    const parts = data.slice('brief_prev:'.length).split(':');
    const subId = parts[0];
    const current = Math.max(0, parseInt(parts[1]) - 1);
    const { correct, given } = sess.data;
    return showBriefAnswerStep(chatId, tid, subId, correct, given, current);
  }

  if (data.startsWith('brief_next:') && student && sess.step && sess.step.startsWith('brief_answer:')) {
    const parts = data.slice('brief_next:'.length).split(':');
    const subId = parts[0];
    const current = Math.min(sess.data.correct.length - 1, parseInt(parts[1]) + 1);
    const { correct, given } = sess.data;
    return showBriefAnswerStep(chatId, tid, subId, correct, given, current);
  }

  if (data.startsWith('brief_submit:') && student && sess.step && sess.step.startsWith('brief_answer:')) {
    const subId = data.slice('brief_submit:'.length);
    const { correct, given } = sess.data;
    return submitBriefAnswers(chatId, student, subId, correct, given);
  }

  // Student: view specific submission detail
  if (data.startsWith('my_sub:') && student) {
    const subId = data.slice('my_sub:'.length);
    return showStudentSubDetail(chatId, student, subId);
  }

  // Student: back to stats
  if (data === 'my_stats_back' && student) {
    return showStudentStats(chatId, student);
  }
}

// ── Notify curators on detailed/trial submission (with files) ─────────────────

async function notifyCuratorsWithFiles(assignment, student, files) {
  const agRows = await sbSelect('assistant_groups', `group_id=eq.${assignment.group_id}`);
  if (!agRows.length) return;
  const rIds     = agRows.map(ag => ag.assistant_id);
  const curators = await sbSelect('roles',
    `id=in.(${rIds.join(',')})&telegram_id=not.is.null&select=telegram_id,name`);

  for (const c of curators) {
    if (!c.telegram_id) continue;
    await send(c.telegram_id, MSGS.curatorNotify(student.name, assignment.topic, files.length)).catch(() => {});
    for (const f of files) {
      if (f.type === 'photo') {
        await tg('sendPhoto', { chat_id: c.telegram_id, photo: f.file_id }).catch(() => {});
      } else {
        await tg('sendDocument', { chat_id: c.telegram_id, document: f.file_id }).catch(() => {});
      }
    }
  }
}
