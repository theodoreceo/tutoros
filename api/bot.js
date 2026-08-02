// api/bot.js — Telegram Bot Webhook (Vercel Serverless, Node 18+)
// Env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, TELEGRAM_BOT_TOKEN,
// TELEGRAM_WEBHOOK_SECRET

const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN          = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET     = process.env.TELEGRAM_WEBHOOK_SECRET;
const OWNER_TELEGRAM_ID  = process.env.OWNER_TELEGRAM_ID;

const isOwner = (telegramId) =>
  Boolean(OWNER_TELEGRAM_ID) && String(telegramId) === String(OWNER_TELEGRAM_ID);

// ── Supabase REST helpers ─────────────────────────────────────────────────────

const SB = {
  'Content-Type':  'application/json',
  'apikey':        SUPABASE_SECRET_KEY,
  'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
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

async function sbDelete(table, qs) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'DELETE', headers: SB,
  });
  if (!r.ok) throw new Error(`sbDelete ${table}: ${await r.text()}`);
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
const html  = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');
const moscowDate = (isoDate) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(isoDate));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const isSubmittedOnTime = (assignment, submittedAt) =>
  assignment?.due_date ? moscowDate(submittedAt) <= assignment.due_date : null;

let cachedBotUsername;
async function getBotUsername() {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await tg('getMe', {});
  cachedBotUsername = me?.result?.username || '';
  return cachedBotUsername;
}

// ── Reply keyboards (persistent bottom buttons) ───────────────────────────────

const STUDENT_KBD = [
  [{ text: '📚 мои задания' }, { text: '📊 мои результаты' }],
  [{ text: '❓ помощь' }],
];
const OWNER_KBD = [
  [{ text: '👥 группы' }, { text: '➕ создать группу' }],
  [{ text: '➕ добавить ученика' }],
  [{ text: '➕ создать дз' }, { text: '📋 домашние задания' }],
  [{ text: '❓ помощь' }],
];

const rkbd = (rows) => ({
  reply_markup: JSON.stringify({ keyboard: rows, resize_keyboard: true, persistent: true }),
});

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

  const owner   = isOwner(tid);
  const student = owner ? null : await sbOne('students', `telegram_id=eq.${tid}`);

  // ── Menu button shortcuts (checked before slash commands so they always work) ──
  if (text === '📚 мои задания'    && student)  return handleStudentListHw(chatId, student);
  if (text === '📊 мои результаты' && student)  return showStudentStats(chatId, student);
  if (text === '👥 группы'            && owner) return showOwnerGroups(chatId);
  if (text === '➕ создать группу'     && owner) return startGroupCreation(chatId, tid);
  if (text === '➕ добавить ученика'  && owner) return startStudentCreation(chatId, tid);
  if (text === '➕ создать дз'         && owner) return startHwCreation(chatId, tid);
  if (text === '📋 домашние задания'  && owner) return showOwnerAssignments(chatId, 0);
  if (text === '❓ помощь') {
    if (student) return send(chatId, 'команды:\n/dz — активные задания\n/mydz — мои результаты\n/unlink — отвязать аккаунт\n\nесли возникла проблема, напиши преподавателю.', rkbd(STUDENT_KBD));
    if (owner) return sendOwnerHelp(chatId);
    return send(chatId, 'открой персональную ссылку, которую прислал преподаватель.');
  }

  // /start with personal student invitation
  if (text.startsWith('/start ')) {
    if (owner) return sendOwnerHome(chatId, tid);
    if (student) return sendStudentHome(chatId, tid, student);
    return handleRegistration(chatId, tid, text.slice(7));
  }

  if (text === '/start') {
    if (owner) return sendOwnerHome(chatId, tid);
    if (student) return sendStudentHome(chatId, tid, student);
    await setSession(tid, {});
    return send(chatId, 'добро пожаловать в бот домашних работ!\n\nоткрой персональную ссылку, которую прислал преподаватель.');
  }

  // /unlink
  if (text === '/unlink') {
    if (!student) return send(chatId, owner ? 'аккаунт преподавателя отвязывать не нужно.' : 'ты не зарегистрирован.');
    return send(chatId, `если ты не <b>${student.name}</b>, можно отвязать аккаунт`,
      kbd([[{ text: '✅ да, отвязать', callback_data: 'unlink:confirm' }, { text: '❌ отмена', callback_data: 'unlink:cancel' }]]));
  }

  // /help
  if (text === '/help') {
    if (student) return send(chatId, 'команды:\n/dz — активные задания\n/mydz — мои результаты\n/unlink — отвязать аккаунт\n\nесли возникла проблема, напиши преподавателю.', rkbd(STUDENT_KBD));
    if (owner) return sendOwnerHelp(chatId);
    return send(chatId, 'открой персональную ссылку, которую прислал преподаватель.');
  }

  // Student commands
  if (student) {
    if (text === '/dz')    return handleStudentListHw(chatId, student);
    if (text === '/mydz')  return showStudentStats(chatId, student);
    const sess = await getSession(tid);
    if (typeof sess.step === 'string' && sess.step.startsWith('brief_answer:')) {
      const subId = sess.step.slice('brief_answer:'.length);
      return handleBriefAnswerText(chatId, student, subId, text, sess);
    }
    if (typeof sess.step === 'string' && sess.step.startsWith('await_answer:')) {
      const subId = sess.step.slice('await_answer:'.length);
      return handleStudentAnswer(chatId, student, subId, text, sess);
    }
    if (typeof sess.step === 'string' && sess.step.startsWith('await_files:')) {
      const subId = sess.step.slice('await_files:'.length);
      const files = sess.data?.files || [];
      if (text.toLowerCase() === 'готово') {
        if (!files.length) return send(chatId, 'пришли хотя бы один файл с выполненным заданием!');
        return finalizeStudentFiles(chatId, student, subId, files);
      }
      return send(chatId, 'прикрепи фото или .pdf-файл. когда пришлёшь всё — нажми кнопку «отправить работу».');
    }
    return send(chatId, 'неизвестная команда.\nиспользуй /dz для заданий или /help.');
  }

  // Owner commands
  if (owner) {
    if (text === '/groups')     return showOwnerGroups(chatId);
    if (text === '/newgroup')   return startGroupCreation(chatId, tid);
    if (text === '/newstudent') return startStudentCreation(chatId, tid);
    if (text === '/newdz')      return startHwCreation(chatId, tid);
    if (text === '/mydz')       return showOwnerAssignments(chatId, 0);
    const sess = await getSession(tid);
    if (sess.step === 'await_student_name') {
      return finishStudentCreation(chatId, tid, text, sess);
    }
    if (sess.step === 'await_group_name') {
      return finishGroupCreation(chatId, tid, text, sess);
    }
    if (sess.step === 'await_lesson_topic') {
      return createLessonForHomework(chatId, tid, text, sess);
    }
    if (typeof sess.step === 'string' && sess.step.startsWith('edit_hw_topic:')) {
      const hwId = sess.step.slice('edit_hw_topic:'.length);
      await sbPatch('homework_assignments', `id=eq.${hwId}`, { topic: text });
      await setSession(tid, { step: 'owner' });
      return send(chatId, `✅ тема обновлена: <b>${text}</b>`, kbd([[{ text: '← назад к дз', callback_data: `dz:${hwId}` }]]));
    }
    if (typeof sess.step === 'string' && sess.step.startsWith('edit_hw_date:')) {
      const hwId = sess.step.slice('edit_hw_date:'.length);
      const raw  = text === '-' ? '' : text;
      if (raw && !/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
        return send(chatId, 'неверный формат. введи ДД.ММ.ГГГГ или «-»:');
      }
      const due = raw ? raw.split('.').reverse().join('-') : '';
      await sbPatch('homework_assignments', `id=eq.${hwId}`, { due_date: due });
      await setSession(tid, { step: 'owner' });
      return send(chatId, `✅ дедлайн обновлён: <b>${due || 'не указан'}</b>`, kbd([[{ text: '← назад к дз', callback_data: `dz:${hwId}` }]]));
    }
    return handleOwnerStep(chatId, tid, sess, text);
  }

  // Unregistered — try as reg_token
  return handleRegistration(chatId, tid, text);
}

async function sendStudentHome(chatId, tid, student) {
  await setSession(tid, { step: 'student' });
  return send(chatId,
    `привет, <b>${student.name}</b>!\n\nздесь находятся твои домашние задания и результаты.`,
    rkbd(STUDENT_KBD));
}

async function sendOwnerHome(chatId, tid) {
  await setSession(tid, { step: 'owner' });
  return send(chatId, 'панель преподавателя', rkbd(OWNER_KBD));
}

function sendOwnerHelp(chatId) {
  return send(chatId,
    'команды:\n/groups — группы и ученики\n/newgroup — создать группу\n/newstudent — добавить ученика\n/newdz — создать ДЗ\n/mydz — домашние задания',
    rkbd(OWNER_KBD));
}

// ── Media handler (photos and documents) ─────────────────────────────────────

async function handleMedia(msg) {
  const chatId = msg.chat.id;
  const tid    = msg.from.id;

  const owner   = isOwner(tid);
  const student = owner ? null : await sbOne('students', `telegram_id=eq.${tid}`);

  const fileId   = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document?.file_id;
  const fileType = msg.photo ? 'photo' : 'document';

  // Owner uploading PDF for HW creation
  if (owner) {
    const sess = await getSession(tid);
    if (sess.step === 'await_pdf') {
      const newData = { ...sess.data, file_id: fileId };
      await setSession(tid, { step: 'await_count', data: newData });
      const hwType = newData.hw_type;
      return send(chatId, 'файл получен!\n\n' + (hwType === 'brief'
        ? 'сколько заданий (ответов) в этой работе?'
        : 'сколько заданий в этой работе?'));
    }
  }

  // Student submitting work files
  if (student) {
    const sess = await getSession(tid);
    if (typeof sess.step === 'string' && sess.step.startsWith('await_files:')) {
      const subId = sess.step.slice('await_files:'.length);
      const files = [...(sess.data?.files || []), { type: fileType, file_id: fileId }];
      await setSession(tid, { step: `await_files:${subId}`, data: { ...sess.data, files } });
      return send(chatId, `📎 файл получен (всего: ${files.length})`,
        kbd([[{ text: '✅ отправить работу', callback_data: `submit_files:${subId}` }],
             [{ text: '❌ отменить',         callback_data: 'cancel_files' }]]));
    }
    return send(chatId, 'сначала открой задание через /dz.');
  }

  if (!student && !owner) {
    return send(chatId, 'сначала открой персональную ссылку от преподавателя.');
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

async function handleRegistration(chatId, tid, token) {
  const clean = token.replace(/^\/start\s+/i, '').toLowerCase().trim();
  const sm = await sbOne('students', `reg_token=eq.${encodeURIComponent(clean)}`);

  if (sm) {
    if (sm.telegram_id) return send(chatId, 'эта ссылка уже была использована. напиши преподавателю.');
    await sbPatch('students', `id=eq.${sm.id}`, { telegram_id: tid });
    await setSession(tid, { step: 'student' });
    return send(chatId,
      `готово! ты подключен как <b>${sm.name}</b>.\n\nесли это не ты, напиши преподавателю.`,
      rkbd(STUDENT_KBD));
  }
  return send(chatId, 'ссылка недействительна. попроси преподавателя создать новую.');
}

// ── Owner: groups and students ───────────────────────────────────────────────

async function showOwnerGroups(chatId) {
  const groups = await sbSelect('groups', 'active=eq.true&order=name.asc');
  if (!groups.length) {
    return send(chatId, 'групп пока нет.', kbd([
      [{ text: '➕ создать первую группу', callback_data: 'new_group' }],
    ]));
  }

  const buttons = groups.map(group => [{
    text: group.name || 'Без названия',
    callback_data: `owner_group:${group.id}`,
  }]);
  buttons.push([{ text: '➕ создать группу', callback_data: 'new_group' }]);
  return send(chatId, 'выбери группу:', kbd(buttons));
}

async function showOwnerGroup(chatId, groupId) {
  const [group, students] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`),
    sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&order=name.asc`),
  ]);
  if (!group) return send(chatId, 'группа не найдена.');

  const studentLines = students.length
    ? students.map((student, index) =>
      `${index + 1}. ${student.telegram_id ? '✅' : '⏳'} ${html(student.name)}`
    ).join('\n')
    : 'учеников пока нет';
  const targetScore = group.target_score || (group.program === 'advanced' ? 23 : 18);

  return send(chatId,
    `<b>${html(group.name)}</b>\nцель: <b>${targetScore}+ баллов</b>\n\n${studentLines}\n\n✅ подключён к боту · ⏳ ещё не открыл ссылку`,
    kbd([
      [{ text: '➕ добавить ученика', callback_data: `student_group:${group.id}` }],
      [{ text: '← ко всем группам', callback_data: 'owner_groups' }],
    ]));
}

async function startGroupCreation(chatId, tid) {
  await setSession(tid, { step: 'choose_group_program' });
  return send(chatId, 'какая программа будет у группы?', kbd([
    [{ text: 'Базовая · цель 18+ баллов', callback_data: 'ngp:base' }],
    [{ text: 'Продвинутая · цель 23+ балла', callback_data: 'ngp:advanced' }],
  ]));
}

async function finishGroupCreation(chatId, tid, rawName, sess) {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 80) {
    return send(chatId, 'введи название группы длиной от 2 до 80 символов:');
  }

  const program = sess.data?.program;
  if (!['base', 'advanced'].includes(program)) {
    await setSession(tid, { step: 'owner' });
    return send(chatId, 'программа не выбрана. начни создание группы заново.');
  }

  const sameName = await sbOne('groups',
    `name=eq.${encodeURIComponent(name)}&active=eq.true`);
  if (sameName) {
    return send(chatId, 'активная группа с таким названием уже существует. введи другое название:');
  }

  const groupId = botId();
  const targetScore = program === 'advanced' ? 23 : 18;
  try {
    await sbInsert('groups', {
      id: groupId,
      name,
      program,
      target_score: targetScore,
      sheet_key: null,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    await sbDelete('groups', `id=eq.${encodeURIComponent(groupId)}`).catch(() => {});
    await setSession(tid, { step: 'owner' });
    return send(chatId, `❌ не удалось создать группу:\n<code>${html(error.message)}</code>`);
  }

  await setSession(tid, { step: 'owner' });
  const programName = program === 'advanced' ? 'Продвинутая' : 'Базовая';
  return send(chatId,
    `✅ группа <b>${html(name)}</b> создана.\n\nпрограмма: <b>${programName}</b>\nцель: <b>${targetScore}+ баллов</b>\n\nуроки будут добавляться по факту при создании ДЗ.`,
    kbd([
      [{ text: '➕ добавить ученика', callback_data: `student_group:${groupId}` }],
      [{ text: '← ко всем группам', callback_data: 'owner_groups' }],
    ]));
}

async function startStudentCreation(chatId, tid) {
  const groups = await sbSelect('groups', 'active=eq.true&order=name.asc');
  if (!groups.length) {
    return send(chatId, 'сначала создай группу в боте.');
  }

  await setSession(tid, { step: 'choose_student_group' });
  return send(chatId, 'в какую группу добавить ученика?', kbd(
    groups.map(group => [{
      text: group.name || 'Без названия',
      callback_data: `student_group:${group.id}`,
    }])
  ));
}

async function finishStudentCreation(chatId, tid, rawName, sess) {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 80) {
    return send(chatId, 'введи имя ученика длиной от 2 до 80 символов:');
  }

  const groupId = sess.data?.group_id;
  const group = groupId
    ? await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`)
    : null;
  if (!group) {
    await setSession(tid, { step: 'owner' });
    return send(chatId, 'группа не найдена. начни добавление ученика заново.');
  }

  const inserted = await sbInsert('students', {
    id: botId(),
    name,
    group_id: groupId,
    target_score: group.target_score || (group.program === 'advanced' ? 23 : 18),
    status: 'active',
    created_at: new Date().toISOString(),
  });
  const student = inserted?.[0];
  const token = student?.reg_token;
  const username = await getBotUsername();
  const inviteLink = username && token
    ? `https://t.me/${username}?start=${token}`
    : null;

  await setSession(tid, { step: 'owner' });

  const inviteText = inviteLink
    ? `\n\nперешли ученику эту ссылку:\n<code>${inviteLink}</code>`
    : token
      ? `\n\nрегистрационный код: <code>${token}</code>`
      : '\n\nне удалось получить ссылку. открой группу и повтори попытку.';

  return send(chatId,
    `✅ <b>${html(name)}</b> добавлен в группу «${html(group.name)}».${inviteText}`,
    rkbd(OWNER_KBD));
}

// ── Student: list HW ──────────────────────────────────────────────────────────

async function handleStudentListHw(chatId, student) {
  const subs = await sbSelect('homework_submissions', `student_id=eq.${student.id}&status=eq.assigned`);
  if (!subs.length) return send(chatId, 'все задания сданы, молодец:)');

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
    lines.push(`${i + 1}. <b>${a.topic || 'без темы'}</b>${type}${due}`);
    buttons.push([{ text: `${i + 1}. ${(a.topic || 'домашки').slice(0, 28)}${dueBtn}`, callback_data: `hw:${sub.id}` }]);
  });

  if (!lines.length) return send(chatId, 'нет активных заданий!');
  return send(chatId, `задания (${lines.length}):\n\n${lines.join('\n')}\n\nвыбери для сдачи:`, kbd(buttons));
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

  const header = `📊 <b>мои результаты</b> · ${student.name}\n\n` +
    `⏳ ждут сдачи: <b>${assigned}</b>\n` +
    `📤 на проверке: <b>${submitted}</b>\n` +
    `✅ проверено: <b>${checked.length}</b>\n` +
    `⭐ средний балл: <b>${scoreBar}</b>`;

  if (!done.length) return send(chatId, header + '\n\nпока нет сданных работ:(');

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

  return send(chatId, header + `\n\nпоследние работы (${done.length}):`, kbd(buttons));
}

async function showStudentSubDetail(chatId, student, subId) {
  const sub = await sbOne('homework_submissions', `id=eq.${subId}&student_id=eq.${student.id}`);
  if (!sub) return send(chatId, 'не найдено.');

  const assignment = await sbOne('homework_assignments',
    `id=eq.${sub.assignment_id}&select=id,topic,description,due_date,hw_type,task_config`);

  const pct = toPercent(sub.score, sub.max_score, assignment?.task_config);
  const statusLine = sub.status === 'submitted' ? '📤 на проверке'
    : sub.status === 'checked' && pct !== null ? `✅ проверено: <b>${pct}%</b>`
    : sub.status === 'checked' ? '✅ проверено'
    : sub.status;

  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null;

  let text = `<b>${assignment?.topic || '—'}</b>\n\n${statusLine}`;
  if (sub.comment)       text += `\n\n💬 комментарий:\n${sub.comment}`;
  if (assignment?.due_date) text += `\n\n📅 дедлайн: ${assignment.due_date}`;
  if (sub.submitted_at)  text += `\n📤 сдано: ${fmtDate(sub.submitted_at)}`;
  if (sub.checked_at)    text += `\n🔍 проверено: ${fmtDate(sub.checked_at)}`;
  if (sub.student_answers?.length) text += `\n\n📝 твои ответы: <code>${sub.student_answers.join(', ')}</code>`;

  return send(chatId, text, kbd([[{ text: '← назад к результатам', callback_data: 'my_stats_back' }]]));
}

// ── Student: answer submission (brief) ───────────────────────────────────────

async function handleBriefAnswerText(chatId, student, subId, text, sess) {
  const { correct, given, current } = sess.data;

  // Save answer to current question
  given[current] = text;

  // If this is the last question — show review page
  if (current === correct.length - 1) {
    return showBriefReviewPage(chatId, student.telegram_id, subId, correct, given);
  }

  // Otherwise move to next question
  const nextCurrent = current + 1;
  return showBriefAnswerStep(chatId, student.telegram_id, subId, correct, given, nextCurrent);
}

async function showBriefAnswerStep(chatId, tid, subId, correct, given, current) {
  await setSession(tid, {
    step: `brief_answer:${subId}`,
    data: { subId, correct, given, current }
  });

  const progressText = current === correct.length - 1
    ? `\n\n(это последнее задание)`
    : `\n\n(${current + 1}/${correct.length})`;

  return send(chatId, `<b>задание ${current + 1} из ${correct.length}</b>\n\n${given[current] || '(ответ не введён)'}` + progressText);
}

async function showBriefReviewPage(chatId, tid, subId, correct, given) {
  const reviewList = given.map((ans, i) =>
    `${i + 1}. ${ans || '(ответ не введён)'}`
  ).join('\n');

  await setSession(tid, {
    step: `brief_review:${subId}`,
    data: { subId, correct, given }
  });

  return send(chatId, `проверь свои ответы:\n\n${reviewList}\n\nотправить работу или исправить?`, kbd([
    [{ text: '✏️ исправить ответы', callback_data: `brief_back_to_edit:${subId}` }],
    [{ text: '✅ отправить работу', callback_data: `brief_final_submit:${subId}` }]
  ]));
}

async function submitBriefAnswers(chatId, student, subId, correct, given) {
  const now = new Date().toISOString();
  const sub = await sbOne('homework_submissions', `id=eq.${subId}&student_id=eq.${student.id}`);
  const assignment = sub
    ? await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`)
    : null;
  const results    = correct.map((c, i) => given[i]?.toLowerCase().trim() === c.toLowerCase().trim());
  const numCorrect = results.filter(Boolean).length;
  const score      = numCorrect;
  const maxScore   = correct.length;

  await sbPatch('homework_submissions', `id=eq.${subId}`, {
    status: 'checked', submitted_at: now, checked_at: now,
    score, max_score: maxScore,
    comment: `${numCorrect}/${correct.length} верно`,
    student_answers: given, source: 'telegram',
    on_time: isSubmittedOnTime(assignment, now),
  });
  await setSession(student.telegram_id, { step: 'student' });

  const feedback = results.map((ok, i) => `${i + 1}. ${ok ? '✅' : `❌ (верно: ${correct[i]})`}\n   ты: <code>${given[i] || 'не ответил'}</code>`).join('\n');
  return send(chatId, `результат: <b>${numCorrect}/${correct.length}</b>\n\n${feedback}`);
}

async function handleStudentAnswer(chatId, student, subId, text, sess) {
  const sub = await sbOne('homework_submissions', `id=eq.${subId}&student_id=eq.${student.id}`);
  if (!sub) return send(chatId, 'задание не найдено.');

  const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);
  if (!assignment) return send(chatId, 'задание не найдено.');

  const now = new Date().toISOString();

  // Multi-answer brief
  if (assignment.answers && Array.isArray(assignment.answers)) {
    const correct = assignment.answers;
    const given   = text.split(/[,;]/).map(s => s.trim());
    if (given.length !== correct.length) {
      return send(chatId,
        `отправь <b>${correct.length}</b> ответов через запятую.\nПример: <code>3, 15, да</code>`);
    }
    const results    = correct.map((c, i) => given[i]?.toLowerCase() === c.toLowerCase());
    const numCorrect = results.filter(Boolean).length;
    const score      = Math.round((numCorrect / correct.length) * 100);
    const maxScore   = 100;
    const feedback   = results.map((ok, i) => `${i + 1}. ${ok ? '✅' : `❌ (верно: ${correct[i]})`}`).join('\n');

    await sbPatch('homework_submissions', `id=eq.${subId}`, {
      status: 'checked', submitted_at: now, checked_at: now,
      score, max_score: maxScore,
      comment: `${numCorrect}/${correct.length} верно`,
      student_answers: given, source: 'telegram',
      on_time: isSubmittedOnTime(assignment, now),
    });
    await setSession(student.telegram_id, { step: 'student' });
    return send(chatId,
      `результат: <b>${numCorrect}/${correct.length}</b> (${score}%)\n\n${feedback}`);
  }

  // Single correct_answer (legacy)
  const correct   = (assignment.correct_answer ?? '').trim();
  const isCorrect = correct !== '' && text.trim() === correct;
  await sbPatch('homework_submissions', `id=eq.${subId}`, {
    status: 'checked', submitted_at: now, checked_at: now,
    score: isCorrect ? 100 : 0, max_score: 100,
    comment: isCorrect ? 'верно!' : `неверно. правильный ответ: ${correct || 'не указан'}`,
    source: 'telegram',
    on_time: isSubmittedOnTime(assignment, now),
  });
  if (student.telegram_id) await setSession(student.telegram_id, { step: 'student' });
  return send(chatId, isCorrect ? `✅ верно! молодец, <b>${student.name}</b>!`
    : `❌ неверно:(\nправильный ответ: <b>${correct || 'не указан'}</b>`);
}

// ── Student: finalize file submission ─────────────────────────────────────────

async function finalizeStudentFiles(chatId, student, subId, files) {
  const sub = await sbOne('homework_submissions', `id=eq.${subId}&student_id=eq.${student.id}`);
  if (!sub) return send(chatId, 'задание не найдено.');

  const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);

  const submittedAt = new Date().toISOString();
  await sbPatch('homework_submissions', `id=eq.${subId}`, {
    status:          'submitted',
    submitted_at:    submittedAt,
    submitted_files: files,
    source:          'telegram',
    on_time:          isSubmittedOnTime(assignment, submittedAt),
  });
  await setSession(student.telegram_id, { step: 'student' });

  if (assignment) await notifyOwnerWithFiles(subId, assignment, student, files);

  return send(chatId,
    `✅ работа отправлена (${files.length} файл(ов))!\nкогда преподаватель проверит её, ты получишь уведомление.`);
}

// ── Owner: start HW creation for a concrete lesson ────────────────────────────

async function startHwCreation(chatId, tid) {
  const groups = await sbSelect('groups', 'active=eq.true&order=name.asc');

  if (!groups.length) return send(chatId, 'группы не найдены.');

  await setSession(tid, { step: 'choose_hw_group' });
  return send(chatId, 'для какой группы создать ДЗ?', kbd(
    groups.map(group => [{
      text: group.name || 'Без названия',
      callback_data: `hw_group:${group.id}`,
    }])
  ));
}

async function showLessonsForHomework(chatId, groupId, offset = 0) {
  const pageSize = 12;
  const [group, lessons] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`),
    sbSelect('lessons',
      `group_id=eq.${encodeURIComponent(groupId)}&active=eq.true&sheet_lesson_key=like.manual:*&order=sequence.desc&limit=${pageSize}&offset=${offset}`),
  ]);
  if (!group) return send(chatId, 'группа не найдена.');

  const buttons = [[{
    text: '➕ создать новый урок',
    callback_data: `hw_new_lesson:${groupId}`,
  }], ...lessons.map(lesson => [{
    text: `${lesson.lesson_number || '—'}. ${(lesson.topic || 'Без темы').slice(0, 42)}`,
    callback_data: `hw_lesson:${lesson.id}`,
  }])];
  const nav = [];
  if (offset > 0) nav.push({
    text: '← назад',
    callback_data: `hw_lessons:${groupId}:${Math.max(0, offset - pageSize)}`,
  });
  if (lessons.length === pageSize) nav.push({
    text: 'дальше →',
    callback_data: `hw_lessons:${groupId}:${offset + pageSize}`,
  });
  if (nav.length) buttons.push(nav);

  const hint = lessons.length
    ? 'выбери существующий урок или создай новый:'
    : 'фактических уроков пока нет. создай первый:';
  return send(chatId,
    `группа: <b>${html(group.name)}</b>\n\n${hint}`,
    kbd(buttons));
}

async function createLessonForHomework(chatId, tid, rawTopic, sess) {
  const topic = rawTopic.trim();
  if (topic.length < 2 || topic.length > 180) {
    return send(chatId, 'введи тему урока длиной от 2 до 180 символов:');
  }

  const groupId = sess.data?.group_id;
  const group = groupId
    ? await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true`)
    : null;
  if (!group) {
    await setSession(tid, { step: 'owner' });
    return send(chatId, 'группа не найдена. начни создание ДЗ заново.');
  }

  const latest = await sbSelect('lessons',
    `group_id=eq.${encodeURIComponent(groupId)}&sheet_lesson_key=like.manual:*&order=sequence.desc&limit=1`);
  const sequence = Math.max(0, Number(latest[0]?.sequence) || 0) + 1;
  const lessonId = botId();
  const now = new Date().toISOString();
  try {
    await sbInsert('lessons', {
      id: lessonId,
      group_id: groupId,
      sheet_lesson_key: `manual:${lessonId}`,
      lesson_number: String(sequence),
      sequence,
      topic,
      event_type: 'lesson',
      scheduled_date: null,
      active: true,
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    await setSession(tid, { step: 'owner' });
    return send(chatId, `❌ не удалось создать урок:\n<code>${html(error.message)}</code>`);
  }

  await setSession(tid, {
    step: 'await_date',
    data: {
      group_id: groupId,
      group_name: group.name,
      lesson_id: lessonId,
      lesson_number: String(sequence),
      topic,
    },
  });
  return send(chatId,
    `урок <b>${sequence}. ${html(topic)}</b> создан.\n\nвведи дедлайн ДЗ (ДД.ММ.ГГГГ) или «-»:`);
}

// ── Owner: step-by-step text input ───────────────────────────────────────────

async function handleOwnerStep(chatId, tid, sess, text) {
  if (typeof sess.step === 'string' && sess.step.startsWith('review_task:')) {
    const subId = sess.step.slice('review_task:'.length);
    const taskConfig = sess.data?.task_config || [];
    const current = sess.data?.current || 0;
    const maxScore = Number(taskConfig[current]);
    const score = Number(text.replace(',', '.'));
    if (!Number.isFinite(score) || score < 0 || score > maxScore) {
      return send(chatId, `введи число от 0 до ${maxScore}:`);
    }

    const taskScores = [...(sess.data?.task_scores || []), score];
    if (current + 1 < taskConfig.length) {
      await setSession(tid, {
        step: `review_task:${subId}`,
        data: { ...sess.data, current: current + 1, task_scores: taskScores },
      });
      return send(chatId,
        `задание ${current + 2} из ${taskConfig.length}: сколько баллов из ${taskConfig[current + 1]}?`);
    }

    await setSession(tid, {
      step: `review_comment:${subId}`,
      data: { task_scores: taskScores, max_score: taskConfig.reduce((sum, value) => sum + Number(value || 0), 0) },
    });
    return send(chatId, 'напиши комментарий ученику или отправь «-», чтобы пропустить:');
  }

  if (typeof sess.step === 'string' && sess.step.startsWith('review_total:')) {
    const subId = sess.step.slice('review_total:'.length);
    const score = Number(text.replace(',', '.'));
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return send(chatId, 'введи итоговый результат от 0 до 100:');
    }
    await setSession(tid, {
      step: `review_comment:${subId}`,
      data: { score, max_score: 100, task_scores: null },
    });
    return send(chatId, 'напиши комментарий ученику или отправь «-», чтобы пропустить:');
  }

  if (typeof sess.step === 'string' && sess.step.startsWith('review_comment:')) {
    const subId = sess.step.slice('review_comment:'.length);
    return saveOwnerReview(chatId, tid, subId, text === '-' ? '' : text, sess.data || {});
  }

  switch (sess.step) {
    case 'await_date': {
      const due = text === '-' ? '' : text;
      if (due && !/^\d{2}\.\d{2}\.\d{4}$/.test(due)) {
        return send(chatId, 'неверный формат. введи ДД.ММ.ГГГГ или «-»:');
      }
      const dueFmt = due ? due.split('.').reverse().join('-') : '';
      await setSession(tid, { step: 'await_hwtype', data: { ...sess.data, due_date: dueFmt } });
      return send(chatId, 'выбери тип задания:',
        kbd([
          [{ text: '🔢 краткий ответ',         callback_data: 'hwtype:brief'         }],
          [{ text: '📝 подробный — несложное',  callback_data: 'hwtype:detailed_easy' }],
          [{ text: '📝 подробный — сложное',    callback_data: 'hwtype:detailed_hard' }],
          [{ text: '📋 пробник',                callback_data: 'hwtype:trial'         }],
        ]));
    }

    case 'await_pdf': {
      if (text !== '-') return send(chatId, 'отправь PDF-файл с заданием (или напиши «-» чтобы пропустить):');
      const newData = { ...sess.data, file_id: null };
      await setSession(tid, { step: 'await_count', data: newData });
      return send(chatId, newData.hw_type === 'brief'
        ? 'сколько заданий (ответов) в этой работе?'
        : 'сколько заданий в этой работе?');
    }

    case 'await_count': {
      const n = parseInt(text, 10);
      if (!n || n < 1 || n > 50) return send(chatId, 'введи число от 1 до 50:');
      if (sess.data.hw_type === 'brief') {
        await setSession(tid, { step: 'await_answers', data: { ...sess.data, total: n, collected: [] } });
        return send(chatId, `введи ответ на <b>задание 1</b> из ${n}:`);
      } else {
        await setSession(tid, { step: 'await_scores', data: { ...sess.data, total: n, scores: [] } });
        return send(chatId, `максимальный балл за <b>задание 1</b> из ${n}:`);
      }
    }

    case 'await_answers': {
      const collected = [...(sess.data.collected || []), text];
      const total     = sess.data.total;
      if (collected.length < total) {
        await setSession(tid, { step: 'await_answers', data: { ...sess.data, collected } });
        return send(chatId, `введи ответ на <b>задание ${collected.length + 1}</b> из ${total}:`);
      }
      return finishHwCreation(chatId, tid, { ...sess.data, answers: collected });
    }

    case 'await_scores': {
      const score = parseFloat(text.replace(',', '.'));
      if (isNaN(score) || score < 0) return send(chatId, 'введи число (например: 5 или 2.5):');
      const scores = [...(sess.data.scores || []), score];
      const total  = sess.data.total;
      if (scores.length < total) {
        await setSession(tid, { step: 'await_scores', data: { ...sess.data, scores } });
        return send(chatId, `максимальный балл за <b>задание ${scores.length + 1}</b> из ${total}:`);
      }
      return finishHwCreation(chatId, tid, { ...sess.data, task_config: scores });
    }

    default:
      return send(chatId, 'используй /newdz для создания задания.');
  }
}

// ── Owner: finish creating HW ─────────────────────────────────────────────────

async function finishHwCreation(chatId, tid, data) {
  const hw_type     = data.hw_type === 'trial' ? 'trial'
    : data.hw_type.startsWith('detailed') ? 'detailed'
    : 'brief';
  const is_advanced = data.hw_type === 'detailed_hard';

  const assignmentId = botId();
  try {
    await sbInsert('homework_assignments', {
      id:             assignmentId,
      group_id:       data.group_id,
      lesson_id:      data.lesson_id,
      topic:          data.topic,
      description:    '',
      due_date:       data.due_date || null,
      hw_type,
      is_advanced,
      assigned_at:    new Date().toISOString(),
      file_id:        data.file_id     ?? null,
      answers:        data.answers     ?? null,
      task_config:    data.task_config ?? null,
    });
  } catch (err) {
    await setSession(tid, { step: 'owner' });
    return send(chatId, `❌ ошибка при создании задания:\n<code>${html(err.message)}</code>`);
  }

  const students = await sbSelect('students',
    `group_id=eq.${encodeURIComponent(data.group_id)}&status=eq.active`);
  let subErrors = 0;
  const due = data.due_date ? `\nдедлайн: <b>${data.due_date}</b>` : '';
  const notifyText = `📚 новое ДЗ: <b>${html(data.topic)}</b>${due}\n/dz — открыть задания`;

  for (const student of students) {
    try {
      await sbInsert('homework_submissions', {
        id: botId(),
        assignment_id: assignmentId,
        student_id: student.id,
        status: 'assigned',
        source: 'telegram',
        submitted_at: null,
        score: null,
        comment: '',
      });
    } catch { subErrors++; }
    if (student.telegram_id) await send(student.telegram_id, notifyText).catch(() => {});
  }

  await setSession(tid, { step: 'owner' });

  const typeLabel = hw_type === 'brief' ? 'краткий ответ'
    : hw_type === 'trial' ? 'пробник'
    : is_advanced ? 'подробный (сложный)' : 'подробный (несложный)';

  const extra = hw_type === 'brief' && data.answers
    ? `\nответы: <code>${data.answers.join(', ')}</code>`
    : hw_type !== 'brief' && data.task_config
    ? `\nбаллов за задания: <code>${data.task_config.join(', ')}</code> (сумма: ${data.task_config.reduce((a, b) => a + b, 0)})`
    : '';

  const warnLine    = subErrors ? `\n⚠️ ошибок при создании записей: ${subErrors}` : '';

  return send(chatId,
    `✅ дз создано!\nгруппа: <b>${html(data.group_name)}</b>\nурок: <b>${html(data.lesson_number || '—')}</b>\nтема: <b>${html(data.topic)}</b>\n` +
    `тип: <b>${typeLabel}</b>\nдедлайн: <b>${data.due_date || 'не указан'}</b>\n` +
    `учеников: <b>${students.length}</b>${extra}${warnLine}`,
    rkbd(OWNER_KBD));
}

// ── Owner: list assignments ───────────────────────────────────────────────────

async function showOwnerAssignments(chatId, offset) {
  const assignments = await sbSelect('homework_assignments',
    `order=assigned_at.desc&limit=10&offset=${offset}`);

  if (!assignments.length) return send(chatId, offset === 0 ? 'дз не найдено.' : 'больше ДЗ нет :)');

  const typeEmoji = { brief: '🔢', detailed: '📝', trial: '📋' };
  const lines   = assignments.map((a, i) =>
    `${offset + i + 1}. ${typeEmoji[a.hw_type] || '📝'} <b>${a.topic || '—'}</b>${a.due_date ? ` · ${a.due_date}` : ''}`
  );
  const buttons = assignments.map(a => [{ text: (a.topic || '—').slice(0, 40), callback_data: `dz:${a.id}` }]);

  const nav = [];
  if (offset > 0) nav.push({ text: '← назад', callback_data: `dz_pg:${offset - 10}` });
  if (assignments.length === 10) nav.push({ text: 'ещё →', callback_data: `dz_pg:${offset + 10}` });
  if (nav.length) buttons.push(nav);

  return send(chatId, `домашние задания:\n\n${lines.join('\n')}\n\nвыбери для управления:`, kbd(buttons));
}

async function showDzDetail(chatId, hwId) {
  const a = await sbOne('homework_assignments', `id=eq.${hwId}`);
  if (!a) return send(chatId, 'дз не найдено.');

  const groups    = await sbSelect('groups', `id=eq.${a.group_id}&select=name`);
  const groupName = groups[0]?.name || '—';
  const subsCount = await sbSelect('homework_submissions', `assignment_id=eq.${hwId}&select=status`);
  const submitted = subsCount.filter(s => ['submitted', 'checked'].includes(s.status)).length;
  const typeLabel = a.hw_type === 'brief' ? '🔢 краткий' : a.hw_type === 'trial' ? '📋 пробник' : '📝 подробный';
  const advLabel  = a.is_advanced ? ' (сложный)' : '';

  const text =
    `<b>${a.topic || '—'}</b>\n` +
    `группа: ${groupName}\n` +
    `тип: ${typeLabel}${advLabel}\n` +
    `дедлайн: ${a.due_date || 'не указан'}\n` +
    `сдано: ${submitted}/${subsCount.length}`;

  return send(chatId, text, kbd([
    [{ text: '✏️ изменить тему',    callback_data: `dz_et:${hwId}` },
     { text: '📅 изменить дедлайн', callback_data: `dz_ed:${hwId}` }],
    [{ text: '🗑️ удалить дз',      callback_data: `dz_del:${hwId}` }],
    [{ text: '← к списку',          callback_data: 'dz_pg:0' }],
  ]));
}

// ── Callback handler ──────────────────────────────────────────────────────────

async function handleCallback(cq) {
  const chatId = cq.message.chat.id;
  const tid    = cq.from.id;
  const data   = cq.data;
  await cbq(cq.id);

  const owner = isOwner(tid);
  const [student, sess] = await Promise.all([
    owner ? Promise.resolve(null) : sbOne('students', `telegram_id=eq.${tid}`),
    getSession(tid),
  ]);

  // Owner: groups and adding students
  if (data === 'owner_groups' && owner) {
    return showOwnerGroups(chatId);
  }
  if (data === 'new_group' && owner) {
    return startGroupCreation(chatId, tid);
  }
  if (data.startsWith('ngp:') && owner) {
    const program = data.slice(4);
    if (!['base', 'advanced'].includes(program)) return send(chatId, 'неизвестная программа.');
    await setSession(tid, {
      step: 'await_group_name',
      data: { program },
    });
    const programName = program === 'advanced' ? 'Продвинутая' : 'Базовая';
    return send(chatId,
      `программа: <b>${programName}</b>\n\nвведи название группы, например «Базовая А1»: `);
  }
  if (data.startsWith('owner_group:') && owner) {
    return showOwnerGroup(chatId, data.slice('owner_group:'.length));
  }
  if (data.startsWith('student_group:') && owner) {
    const groupId = data.slice('student_group:'.length);
    const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`);
    if (!group) return send(chatId, 'группа не найдена.');
    await setSession(tid, { step: 'await_student_name', data: { group_id: groupId } });
    return send(chatId, `группа: <b>${html(group.name)}</b>\n\nвведи имя ученика:`);
  }
  if (data.startsWith('review:') && owner) {
    return startOwnerReview(chatId, tid, data.slice('review:'.length));
  }

  // /mydz navigation and management
  if (data.startsWith('dz_pg:') && owner) {
    return showOwnerAssignments(chatId, parseInt(data.slice(6), 10) || 0);
  }
  if (data.startsWith('dz:') && owner) {
    return showDzDetail(chatId, data.slice(3));
  }
  if (data.startsWith('dz_et:') && owner) {
    const hwId = data.slice(6);
    await setSession(tid, { step: `edit_hw_topic:${hwId}` });
    return send(chatId, 'введи новую тему:');
  }
  if (data.startsWith('dz_ed:') && owner) {
    const hwId = data.slice(6);
    await setSession(tid, { step: `edit_hw_date:${hwId}` });
    return send(chatId, 'введи новый дедлайн (ДД.ММ.ГГГГ) или «-» чтобы убрать:');
  }
  if (data.startsWith('dz_del:') && owner) {
    const hwId = data.slice(7);
    const a    = await sbOne('homework_assignments', `id=eq.${hwId}&select=topic`);
    return send(chatId, `удалить дз «<b>${a?.topic || hwId}</b>» и все записи учеников?`,
      kbd([[{ text: '✅ да, удалить', callback_data: `dz_delok:${hwId}` },
             { text: '❌ отмена',     callback_data: `dz:${hwId}` }]]));
  }
  if (data.startsWith('dz_delok:') && owner) {
    const hwId = data.slice(9);
    const subs = await sbSelect('homework_submissions', `assignment_id=eq.${hwId}&select=id`);
    for (const s of subs) {
      await fetch(`${SUPABASE_URL}/rest/v1/homework_submissions?id=eq.${s.id}`,
        { method: 'DELETE', headers: SB });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/homework_assignments?id=eq.${hwId}`,
      { method: 'DELETE', headers: SB });
    await setSession(tid, { step: 'owner' });
    return send(chatId, '✅ дз удалено.');
  }

  // Unlink
  if (data === 'unlink:confirm' && student) {
    if (student) await sbPatch('students', `id=eq.${student.id}`, { telegram_id: null });
    await setSession(tid, {});
    return send(chatId, 'аккаунт отвязан. попроси преподавателя прислать новую ссылку.');
  }
  if (data === 'unlink:cancel') return send(chatId, 'отмена.');

  // Select group and lesson for a homework assignment
  if (data.startsWith('hw_group:') && owner) {
    return showLessonsForHomework(chatId, data.slice('hw_group:'.length), 0);
  }
  if (data.startsWith('hw_lessons:') && owner) {
    const value = data.slice('hw_lessons:'.length);
    const separator = value.lastIndexOf(':');
    const groupId = value.slice(0, separator);
    const offset = parseInt(value.slice(separator + 1), 10) || 0;
    return showLessonsForHomework(chatId, groupId, offset);
  }
  if (data.startsWith('hw_new_lesson:') && owner) {
    const groupId = data.slice('hw_new_lesson:'.length);
    const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true`);
    if (!group) return send(chatId, 'группа не найдена.');
    await setSession(tid, {
      step: 'await_lesson_topic',
      data: { group_id: group.id, group_name: group.name },
    });
    return send(chatId,
      `группа: <b>${html(group.name)}</b>\n\nвведи фактическую тему урока:`);
  }
  if (data.startsWith('hw_lesson:') && owner) {
    const lessonId = data.slice('hw_lesson:'.length);
    const lesson = await sbOne('lessons', `id=eq.${encodeURIComponent(lessonId)}`);
    if (!lesson) return send(chatId, 'урок не найден. обнови список уроков.');
    const group = await sbOne('groups', `id=eq.${encodeURIComponent(lesson.group_id)}`);
    if (!group) return send(chatId, 'группа урока не найдена.');

    await setSession(tid, {
      step: 'await_date',
      data: {
        group_id: lesson.group_id,
        group_name: group.name,
        lesson_id: lesson.id,
        lesson_number: lesson.lesson_number,
        topic: lesson.topic,
      },
    });
    return send(chatId,
      `урок: <b>${html(lesson.lesson_number || '—')}. ${html(lesson.topic)}</b>\n\nвведи дедлайн ДЗ (ДД.ММ.ГГГГ) или «-»:`);
  }

  // Owner: HW type selection
  if (data.startsWith('hwtype:') && owner && sess.step === 'await_hwtype') {
    const hwType = data.slice(7);
    await setSession(tid, { step: 'await_pdf', data: { ...sess.data, hw_type: hwType } });
    return send(chatId, 'отправь PDF-файл с заданием (или напиши «-» чтобы пропустить):');
  }

  // Student taps HW
  if (data.startsWith('hw:') && student) {
    const subId = data.slice(3);
    const sub   = await sbOne('homework_submissions',
      `id=eq.${subId}&student_id=eq.${student.id}&status=eq.assigned`);
    if (!sub) return send(chatId, 'задание уже сдано или не найдено.');

    const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);
    if (!assignment) return send(chatId, 'задание не найдено.');

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
      return send(chatId, `<b>${assignment.topic}</b>${desc}\n\nвведи ответ:`);
    }

    // detailed / trial → collect files from student
    await setSession(tid, { step: `await_files:${subId}`, data: { files: [] } });
    return send(chatId,
      `<b>${assignment.topic}</b>${desc}\n\nотправь выполненное задание фото или .pdf-файлом.\nможно несколько файлов — нажми «отправить работу», когда пришлёшь всё.`,
      kbd([[{ text: '✅ отправить работу', callback_data: `submit_files:${subId}` }],
           [{ text: '❌ отменить',         callback_data: 'cancel_files' }]]));
  }

  // Student submits collected files
  if (data.startsWith('submit_files:') && student) {
    const subId = data.slice('submit_files:'.length);
    const files = sess.data?.files || [];
    if (!files.length) return send(chatId, 'пришли хотя бы один файл с выполненным заданием!');
    return finalizeStudentFiles(chatId, student, subId, files);
  }

  // Student cancels file submission
  if (data === 'cancel_files' && student) {
    await setSession(tid, { step: 'student' });
    return send(chatId, 'сдача отменена. /dz — посмотреть задания.');
  }

  // Brief answer: go back to edit
  if (data.startsWith('brief_back_to_edit:') && student && sess.step?.startsWith('brief_review:')) {
    const subId = data.slice('brief_back_to_edit:'.length);
    const { correct, given } = sess.data;
    return showBriefAnswerStep(chatId, tid, subId, correct, given, 0);
  }

  // Brief answer: final submit
  if (data.startsWith('brief_final_submit:') && student && sess.step?.startsWith('brief_review:')) {
    const subId = data.slice('brief_final_submit:'.length);
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

// ── Owner: review detailed/trial submission ───────────────────────────────────

async function startOwnerReview(chatId, tid, subId) {
  const sub = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(subId)}`);
  if (!sub) return send(chatId, 'работа не найдена.');

  const [assignment, student] = await Promise.all([
    sbOne('homework_assignments', `id=eq.${encodeURIComponent(sub.assignment_id)}`),
    sbOne('students', `id=eq.${encodeURIComponent(sub.student_id)}`),
  ]);
  if (!assignment || !student) return send(chatId, 'не удалось загрузить данные работы.');

  const taskConfig = Array.isArray(assignment.task_config)
    ? assignment.task_config.map(Number).filter(Number.isFinite)
    : [];

  if (taskConfig.length) {
    await setSession(tid, {
      step: `review_task:${subId}`,
      data: { task_config: taskConfig, task_scores: [], current: 0 },
    });
    return send(chatId,
      `<b>${html(student.name)}</b> · ${html(assignment.topic)}\n\nзадание 1 из ${taskConfig.length}: сколько баллов из ${taskConfig[0]}?`);
  }

  await setSession(tid, { step: `review_total:${subId}`, data: {} });
  return send(chatId,
    `<b>${html(student.name)}</b> · ${html(assignment.topic)}\n\nвведи итоговый результат от 0 до 100:`);
}

async function saveOwnerReview(chatId, tid, subId, comment, review) {
  const sub = await sbOne('homework_submissions', `id=eq.${encodeURIComponent(subId)}`);
  if (!sub) return send(chatId, 'работа не найдена.');
  const [assignment, student] = await Promise.all([
    sbOne('homework_assignments', `id=eq.${encodeURIComponent(sub.assignment_id)}`),
    sbOne('students', `id=eq.${encodeURIComponent(sub.student_id)}`),
  ]);
  if (!assignment || !student) return send(chatId, 'не удалось загрузить данные работы.');

  const taskScores = Array.isArray(review.task_scores) ? review.task_scores : null;
  const score = taskScores
    ? taskScores.reduce((sum, value) => sum + Number(value || 0), 0)
    : Number(review.score);
  const maxScore = Number(review.max_score) || 100;
  const checkedAt = new Date().toISOString();

  await sbPatch('homework_submissions', `id=eq.${encodeURIComponent(subId)}`, {
    status: 'checked',
    score,
    max_score: maxScore,
    task_scores: taskScores,
    comment,
    checked_at: checkedAt,
  });
  await setSession(tid, { step: 'owner' });

  if (student.telegram_id) {
    const breakdown = taskScores
      ? `\n\nбаллы по заданиям: ${taskScores.join(', ')}`
      : '';
    const commentText = comment ? `\n\nкомментарий: ${html(comment)}` : '';
    await send(student.telegram_id,
      `✅ работа «<b>${html(assignment.topic)}</b>» проверена.\nрезультат: <b>${score}/${maxScore}</b>${breakdown}${commentText}`
    ).catch(() => {});
  }

  return send(chatId,
    `✅ работа <b>${html(student.name)}</b> проверена: <b>${score}/${maxScore}</b>`,
    rkbd(OWNER_KBD));
}

// ── Notify owner on detailed/trial submission (with files) ────────────────────

async function notifyOwnerWithFiles(subId, assignment, student, files) {
  if (!OWNER_TELEGRAM_ID) return;

  await send(OWNER_TELEGRAM_ID,
    `📤 <b>${html(student.name)}</b> сдал «${html(assignment.topic)}» (${files.length} файл(ов)).`,
    kbd([[{ text: '✅ проверить работу', callback_data: `review:${subId}` }]])
  ).catch(() => {});
  for (const f of files) {
    if (f.type === 'photo') {
      await tg('sendPhoto', { chat_id: OWNER_TELEGRAM_ID, photo: f.file_id }).catch(() => {});
    } else {
      await tg('sendDocument', { chat_id: OWNER_TELEGRAM_ID, document: f.file_id }).catch(() => {});
    }
  }
}
