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

async function getFileId(fileIdOrObj) {
  // Returns a Telegram file_id for later use with sendDocument
  return fileIdOrObj;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });
  const update = req.body ?? {};
  try {
    if (update.callback_query)       await handleCallback(update.callback_query);
    else if (update.message?.document) await handleDocument(update.message);
    else if (update.message?.text)   await handleText(update.message);
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

  // /start
  if (text === '/start') {
    if (student) {
      await setSession(tid, { step: 'student' });
      return send(chatId, `Привет, <b>${student.name}</b>!\n\n/dz — домашние задания\n/unlink — отвязать аккаунт`);
    }
    if (curator) {
      await setSession(tid, { step: 'curator' });
      return send(chatId, `Привет, <b>${curator.name}</b>!\n\n/newdz — создать домашнее задание\n/unlink — отвязать аккаунт`);
    }
    await setSession(tid, {});
    return send(chatId, `Добро пожаловать в бот TutorOS!\n\nВведи регистрационный код для подключения.\nКод есть в TutorOS: карточка ученика или страница Доступ.`);
  }

  // /unlink
  if (text === '/unlink') {
    if (!student && !curator) return send(chatId, 'Ты не зарегистрирован.');
    return send(chatId, `Отвязать аккаунт <b>${(student || curator).name}</b>?`,
      kbd([[{ text: '✅ Да, отвязать', callback_data: 'unlink:confirm' }, { text: '❌ Отмена', callback_data: 'unlink:cancel' }]]));
  }

  // /help
  if (text === '/help') {
    if (student)      return send(chatId, '/dz — задания\n/unlink — отвязать аккаунт');
    if (curator)      return send(chatId, '/newdz — создать ДЗ\n/unlink — отвязать аккаунт');
    return send(chatId, 'Введи регистрационный код для подключения.');
  }

  // Student commands
  if (student) {
    if (text === '/dz') return handleStudentListHw(chatId, student);
    const sess = await getSession(tid);
    if (typeof sess.step === 'string' && sess.step.startsWith('await_answer:')) {
      const subId = sess.step.slice('await_answer:'.length);
      await handleStudentAnswer(chatId, student, subId, text, sess);
      return;
    }
    return send(chatId, 'Используй /dz для заданий или /help.');
  }

  // Curator commands
  if (curator) {
    if (text === '/newdz') return startHwCreation(chatId, tid, curator);
    const sess = await getSession(tid);
    return handleCuratorStep(chatId, tid, curator, sess, text, null);
  }

  // Unregistered — try as reg_token
  return handleRegistration(chatId, tid, text);
}

// ── Document handler (PDF upload during HW creation) ─────────────────────────

async function handleDocument(msg) {
  const chatId = msg.chat.id;
  const tid    = msg.from.id;
  const curator = await sbOne('roles', `telegram_id=eq.${tid}`);
  if (!curator) return;

  const sess = await getSession(tid);
  if (sess.step !== 'await_pdf') {
    return send(chatId, 'Используй /newdz для создания задания.');
  }

  const fileId = msg.document.file_id;
  const newData = { ...sess.data, file_id: fileId };
  await setSession(tid, { step: 'await_count', data: newData });

  const hwType = newData.hw_type;
  if (hwType === 'brief') {
    await send(chatId, '📎 Файл получен!\n\nСколько заданий (ответов) в этой работе?');
  } else {
    await send(chatId, '📎 Файл получен!\n\nСколько заданий в этой работе?');
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
    if (sm.telegram_id) return send(chatId, 'Этот код уже использован.');
    await sbPatch('students', `id=eq.${sm.id}`, { telegram_id: tid });
    await setSession(tid, { step: 'student' });
    return send(chatId, `✅ Подключён как <b>${sm.name}</b>.\n/dz — задания`);
  }
  if (rm) {
    if (rm.telegram_id) return send(chatId, 'Этот код уже использован.');
    await sbPatch('roles', `id=eq.${rm.id}`, { telegram_id: tid });
    await setSession(tid, { step: 'curator' });
    return send(chatId, `✅ Подключён как <b>${rm.name}</b>.\n/newdz — создать ДЗ`);
  }
  return send(chatId, 'Код не найден. Проверь и попробуй снова.');
}

// ── Student: list HW ──────────────────────────────────────────────────────────

async function handleStudentListHw(chatId, student) {
  const subs = await sbSelect('homework_submissions', `student_id=eq.${student.id}&status=eq.assigned`);
  if (!subs.length) return send(chatId, 'Нет активных заданий. Всё сдано! ✅');

  const aIds = [...new Set(subs.map(s => s.assignment_id))];
  const assignments = await sbSelect('homework_assignments',
    `id=in.(${aIds.join(',')})&select=id,topic,due_date,hw_type`);
  const aMap = Object.fromEntries(assignments.map(a => [a.id, a]));

  const buttons = [];
  const lines   = [];
  subs.forEach((sub, i) => {
    const a = aMap[sub.assignment_id];
    if (!a) return;
    const due  = a.due_date ? ` · срок: ${a.due_date}` : '';
    const type = a.hw_type === 'brief' ? ' [краткий]' : a.hw_type === 'trial' ? ' [пробник]' : '';
    lines.push(`${i + 1}. <b>${a.topic || 'Без темы'}</b>${type}${due}`);
    buttons.push([{ text: `${i + 1}. ${(a.topic || 'ДЗ').slice(0, 32)}`, callback_data: `hw:${sub.id}` }]);
  });

  if (!lines.length) return send(chatId, 'Нет активных заданий.');
  return send(chatId, `Задания (${lines.length}):\n\n${lines.join('\n')}\n\nВыбери для сдачи:`, kbd(buttons));
}

// ── Student: answer submission ────────────────────────────────────────────────

async function handleStudentAnswer(chatId, student, subId, text, sess) {
  const sub = await sbOne('homework_submissions', `id=eq.${subId}&student_id=eq.${student.id}`);
  if (!sub) return send(chatId, 'Задание не найдено.');

  const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);
  if (!assignment) return send(chatId, 'Задание не найдено.');

  const now = new Date().toISOString();

  // Multi-answer brief
  if (assignment.answers && Array.isArray(assignment.answers)) {
    const correct = assignment.answers;
    const given   = text.split(/[,;]/).map(s => s.trim());
    if (given.length !== correct.length) {
      return send(chatId,
        `Ожидается <b>${correct.length}</b> ответов через запятую.\nПример: <code>3, 15, да</code>`);
    }
    const results   = correct.map((c, i) => given[i]?.toLowerCase() === c.toLowerCase());
    const numCorrect = results.filter(Boolean).length;
    const score      = Math.round((numCorrect / correct.length) * 100);
    const feedback   = results.map((ok, i) => `${i + 1}. ${ok ? '✅' : `❌ (верно: ${correct[i]})`}`).join('\n');

    await sbPatch('homework_submissions', `id=eq.${subId}`, {
      status: 'checked', submitted_at: now, checked_at: now,
      score, comment: `${numCorrect}/${correct.length} верно`,
      student_answers: given, source: 'telegram',
    });
    await setSession(student.telegram_id, { step: 'student' });
    return send(chatId,
      `Результат: <b>${numCorrect}/${correct.length}</b> (${score}%)\n\n${feedback}`);
  }

  // Single correct_answer (legacy)
  const correct   = (assignment.correct_answer ?? '').trim();
  const isCorrect = correct !== '' && text.trim() === correct;
  await sbPatch('homework_submissions', `id=eq.${subId}`, {
    status: 'checked', submitted_at: now, checked_at: now,
    score: isCorrect ? 100 : 0,
    comment: isCorrect ? 'Верно!' : `Неверно. Правильный ответ: ${correct || 'не указан'}`,
    source: 'telegram',
  });
  if (student.telegram_id) await setSession(student.telegram_id, { step: 'student' });
  return send(chatId, isCorrect ? `✅ Верно! Отлично, <b>${student.name}</b>!`
    : `❌ Неверно.\nПравильный ответ: <b>${correct || 'не указан'}</b>`);
}

// ── Curator: start HW creation ────────────────────────────────────────────────

async function startHwCreation(chatId, tid, curator) {
  const agRows = await sbSelect('assistant_groups', `assistant_id=eq.${curator.id}`);

  // Owners can see all groups
  let groups;
  if (curator.role_type === 'owner' || curator['isOwner']) {
    groups = await sbSelect('groups', 'order=name.asc');
  } else {
    if (!agRows.length) return send(chatId, 'У тебя нет назначенных групп.');
    const gIds = agRows.map(ag => ag.group_id);
    groups = await sbSelect('groups', `id=in.(${gIds.join(',')})`);
  }

  if (!groups.length) return send(chatId, 'Группы не найдены.');
  const buttons = groups.map(g => [{ text: g.name, callback_data: `grp:${g.id}` }]);
  await setSession(tid, { step: 'await_group', data: {} });
  return send(chatId, 'Выбери группу:', kbd(buttons));
}

// ── Curator: step-by-step text input ─────────────────────────────────────────

async function handleCuratorStep(chatId, tid, curator, sess, text, fileId) {
  switch (sess.step) {
    case 'await_topic':
      await setSession(tid, { step: 'await_date', data: { ...sess.data, topic: text } });
      return send(chatId, 'Введи дедлайн (ГГГГ-ММ-ДД) или «-» без дедлайна:');

    case 'await_date': {
      const due = text === '-' ? '' : text;
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
        return send(chatId, 'Неверный формат. Введи ГГГГ-ММ-ДД или «-»:');
      }
      await setSession(tid, { step: 'await_hwtype', data: { ...sess.data, due_date: due } });
      return send(chatId, 'Выбери тип задания:',
        kbd([
          [{ text: '🔢 Краткий ответ',         callback_data: 'hwtype:brief'         }],
          [{ text: '📝 Подробный — несложное',  callback_data: 'hwtype:detailed_easy' }],
          [{ text: '📝 Подробный — сложное',    callback_data: 'hwtype:detailed_hard' }],
          [{ text: '📋 Пробник',                callback_data: 'hwtype:trial'         }],
        ]));
    }

    case 'await_pdf': {
      // Text '-' means skip PDF
      if (text !== '-') return send(chatId, 'Отправь PDF-файл или напиши «-» чтобы пропустить:');
      const newData = { ...sess.data, file_id: null };
      await setSession(tid, { step: 'await_count', data: newData });
      const hwType = newData.hw_type;
      return send(chatId, hwType === 'brief'
        ? 'Сколько заданий (ответов) в этой работе?'
        : 'Сколько заданий в этой работе?');
    }

    case 'await_count': {
      const n = parseInt(text, 10);
      if (!n || n < 1 || n > 50) return send(chatId, 'Введи число от 1 до 50:');
      const hwType = sess.data.hw_type;
      if (hwType === 'brief') {
        await setSession(tid, { step: 'await_answers', data: { ...sess.data, total: n, collected: [] } });
        return send(chatId, `Введи ответ на <b>задание 1</b> из ${n}:`);
      } else {
        await setSession(tid, { step: 'await_scores', data: { ...sess.data, total: n, scores: [] } });
        return send(chatId, `Максимальный балл за <b>задание 1</b> из ${n}:`);
      }
    }

    case 'await_answers': {
      const collected = [...(sess.data.collected || []), text];
      const total     = sess.data.total;
      if (collected.length < total) {
        await setSession(tid, { step: 'await_answers', data: { ...sess.data, collected } });
        return send(chatId, `Введи ответ на <b>задание ${collected.length + 1}</b> из ${total}:`);
      }
      return finishHwCreation(chatId, tid, curator, { ...sess.data, answers: collected });
    }

    case 'await_scores': {
      const score = parseFloat(text.replace(',', '.'));
      if (isNaN(score) || score < 0) return send(chatId, 'Введи число (например: 5 или 2.5):');
      const scores = [...(sess.data.scores || []), score];
      const total  = sess.data.total;
      if (scores.length < total) {
        await setSession(tid, { step: 'await_scores', data: { ...sess.data, scores } });
        return send(chatId, `Максимальный балл за <b>задание ${scores.length + 1}</b> из ${total}:`);
      }
      return finishHwCreation(chatId, tid, curator, { ...sess.data, task_config: scores });
    }

    default:
      return send(chatId, 'Используй /newdz для создания задания.');
  }
}

// ── Curator: finish creating HW ───────────────────────────────────────────────

async function finishHwCreation(chatId, tid, curator, data) {
  const hw_type     = data.hw_type === 'trial' ? 'trial'
    : data.hw_type.startsWith('detailed') ? 'detailed'
    : 'brief';
  const is_advanced = data.hw_type === 'detailed_hard';

  const assignmentId = botId();
  try {
    await sbInsert('homework_assignments', {
      id:             assignmentId,
      group_id:       data.group_id,
      lesson_id:      null,
      topic:          data.topic,
      description:    '',
      due_date:       data.due_date ?? '',
      hw_type,
      is_advanced,
      correct_answer: null,
      assigned_at:    new Date().toISOString(),
      file_id:        data.file_id ?? null,
      answers:        data.answers     ?? null,
      task_config:    data.task_config ?? null,
    });
  } catch (err) {
    await setSession(tid, { step: 'curator' });
    return send(chatId, `❌ Ошибка при создании задания:\n<code>${err.message}</code>`);
  }

  const students = await sbSelect('students',
    `group_id=eq.${data.group_id}&crm_status=in.(active,trial)`);

  let subErrors = 0;
  for (const stu of students) {
    try {
      await sbInsert('homework_submissions', {
        id: botId(), assignment_id: assignmentId, student_id: stu.id,
        status: 'assigned', source: 'telegram',
        submitted_at: null, score: null, comment: '', errors: [],
        checked_by: null, checked_at: null, submission_url: '',
      });
    } catch { subErrors++; }
  }

  await setSession(tid, { step: 'curator' });

  const typeLabel = hw_type === 'brief' ? 'Краткий ответ'
    : hw_type === 'trial' ? 'Пробник'
    : is_advanced ? 'Подробный (сложное)' : 'Подробный (несложное)';

  const extra = hw_type === 'brief' && data.answers
    ? `\nОтветы: <code>${data.answers.join(', ')}</code>`
    : hw_type !== 'brief' && data.task_config
    ? `\nБаллов за задания: <code>${data.task_config.join(', ')}</code> (сумма: ${data.task_config.reduce((a, b) => a + b, 0)})`
    : '';

  const warnLine = subErrors ? `\n⚠️ Ошибок при создании записей: ${subErrors}` : '';
  return send(chatId,
    `✅ ДЗ создано!\nГруппа: <b>${data.group_name}</b>\nТема: <b>${data.topic}</b>\n` +
    `Тип: <b>${typeLabel}</b>\nДедлайн: <b>${data.due_date || 'не указан'}</b>\n` +
    `Учеников: <b>${students.length}</b>${extra}${warnLine}\n\n` +
    `В TutorOS обнови страницу (F5) чтобы увидеть ДЗ.`);
}

// ── Callback handler ──────────────────────────────────────────────────────────

async function handleCallback(cq) {
  const chatId = cq.message.chat.id;
  const tid    = cq.from.id;
  const data   = cq.data;
  await cbq(cq.id);

  const [student, curator, sess] = await Promise.all([
    sbOne('students', `telegram_id=eq.${tid}`),
    sbOne('roles',    `telegram_id=eq.${tid}`),
    getSession(tid),
  ]);

  // Unlink
  if (data === 'unlink:confirm') {
    if (student) await sbPatch('students', `id=eq.${student.id}`, { telegram_id: null });
    if (curator) await sbPatch('roles',    `id=eq.${curator.id}`, { telegram_id: null });
    await setSession(tid, {});
    return send(chatId, 'Аккаунт отвязан. Введи новый регистрационный код для повторного подключения.');
  }
  if (data === 'unlink:cancel') return send(chatId, 'Отмена.');

  // Student taps HW
  if (data.startsWith('hw:') && student) {
    const subId = data.slice(3);
    const sub   = await sbOne('homework_submissions',
      `id=eq.${subId}&student_id=eq.${student.id}&status=eq.assigned`);
    if (!sub) return send(chatId, 'Задание уже сдано или не найдено.');

    const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);
    if (!assignment) return send(chatId, 'Задание не найдено.');

    // Send PDF if exists
    if (assignment.file_id) {
      await tg('sendDocument', { chat_id: chatId, document: assignment.file_id });
    }

    const desc = assignment.description ? `\n${assignment.description}` : '';

    if (assignment.hw_type === 'brief') {
      const answers = assignment.answers;
      if (answers && Array.isArray(answers) && answers.length > 0) {
        await setSession(tid, { step: `await_answer:${subId}` });
        return send(chatId,
          `<b>${assignment.topic}</b>${desc}\n\nЗаданий: <b>${answers.length}</b>\n` +
          `Введи все ответы через запятую:\nПример: <code>3, 15, да</code>`);
      }
      await setSession(tid, { step: `await_answer:${subId}` });
      return send(chatId, `<b>${assignment.topic}</b>${desc}\n\nВведи ответ:`);
    }

    // detailed / trial → mark submitted
    await sbPatch('homework_submissions', `id=eq.${subId}`, {
      status: 'submitted', submitted_at: new Date().toISOString(), source: 'telegram',
    });
    await notifyCurators(assignment, student);
    return send(chatId,
      `<b>${assignment.topic}</b>${desc}\n\nЗадание отмечено как сданное. Куратор проверит в TutorOS.`);
  }

  // Curator: group selection
  if (data.startsWith('grp:') && curator && sess.step === 'await_group') {
    const groupId = data.slice(4);
    const group   = await sbOne('groups', `id=eq.${groupId}`);
    await setSession(tid, { step: 'await_topic', data: { group_id: groupId, group_name: group?.name ?? groupId } });
    return send(chatId, `Группа: <b>${group?.name}</b>\n\nВведи тему задания:`);
  }

  // Curator: HW type selection
  if (data.startsWith('hwtype:') && curator && sess.step === 'await_hwtype') {
    const hwType = data.slice(7);
    await setSession(tid, { step: 'await_pdf', data: { ...sess.data, hw_type: hwType } });
    return send(chatId, 'Отправь PDF-файл с заданием (или напиши «-» чтобы пропустить):');
  }
}

// ── Notify curators on detailed/trial submission ──────────────────────────────

async function notifyCurators(assignment, student) {
  const agRows = await sbSelect('assistant_groups', `group_id=eq.${assignment.group_id}`);
  if (!agRows.length) return;
  const rIds     = agRows.map(ag => ag.assistant_id);
  const curators = await sbSelect('roles',
    `id=in.(${rIds.join(',')})&telegram_id=not.is.null&select=telegram_id,name`);
  for (const c of curators) {
    if (!c.telegram_id) continue;
    await send(c.telegram_id,
      `Ученик <b>${student.name}</b> сдал «${assignment.topic}». Проверь в TutorOS.`
    ).catch(() => {});
  }
}
