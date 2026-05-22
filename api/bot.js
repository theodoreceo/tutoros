// api/bot.js — Telegram Bot Webhook (Vercel Serverless, Node 18+)
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN
//
// Register webhook once after deploying:
//   curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
//        -H "Content-Type: application/json" \
//        -d '{"url":"https://yourapp.vercel.app/api/bot"}'

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;

// ── Supabase REST helpers (service role bypasses all RLS) ─────────────────────

const SB_HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
};

async function sbSelect(table, qs = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB_HEADERS });
  if (!r.ok) throw new Error(`sbSelect ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbSelectOne(table, qs) {
  const rows = await sbSelect(table, qs + '&limit=1');
  return rows[0] ?? null;
}

async function sbInsert(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
    body:    JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbInsert ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbPatch(table, qs, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method:  'PATCH',
    headers: SB_HEADERS,
    body:    JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbPatch ${table}: ${r.status} ${await r.text()}`);
}

async function sbUpsert(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body:    JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbUpsert ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

// ── Session helpers ───────────────────────────────────────────────────────────

async function getSession(tid) {
  const row = await sbSelectOne('bot_sessions', `telegram_id=eq.${tid}`);
  return row?.state ?? {};
}

async function setSession(tid, state) {
  await sbUpsert('bot_sessions', { telegram_id: tid, state, updated_at: new Date().toISOString() });
}

// ── Telegram helpers ──────────────────────────────────────────────────────────

async function tgCall(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return r.json();
}

const send = (chatId, text, extra = {}) =>
  tgCall('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

const answerCbq = (id, text = '') =>
  tgCall('answerCallbackQuery', { callback_query_id: id, text });

const kbd = (rows) => ({ reply_markup: JSON.stringify({ inline_keyboard: rows }) });

// ── ID generator (bot-prefixed to avoid collisions with app-generated uids) ───

const botId = () =>
  'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ── Main export ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.status(200).json({ ok: true }); // acknowledge immediately (Telegram requires <10s)
  if (req.method !== 'POST') return;

  const update = req.body ?? {};

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message?.text) {
      await handleText(update.message);
    }
  } catch (err) {
    console.error('Bot handler error:', err);
  }
}

// ── Text message handler ──────────────────────────────────────────────────────

async function handleText(msg) {
  const chatId = msg.chat.id;
  const tid    = msg.from.id;
  const text   = msg.text.trim();

  const [student, curator] = await Promise.all([
    sbSelectOne('students', `telegram_id=eq.${tid}`),
    sbSelectOne('roles',    `telegram_id=eq.${tid}`),
  ]);

  if (text === '/start') {
    if (student) {
      await setSession(tid, { step: 'student' });
      await send(chatId,
        `Привет, <b>${student.name}</b>! Ты уже зарегистрирован.\n\n` +
        `/dz — активные домашние задания\n/help — помощь`
      );
    } else if (curator) {
      await setSession(tid, { step: 'curator' });
      await send(chatId,
        `Привет, <b>${curator.name}</b>! Ты подключён как куратор.\n\n` +
        `/newdz — создать домашнее задание\n/help — помощь`
      );
    } else {
      await setSession(tid, {});
      await send(chatId,
        `Добро пожаловать в бот TutorOS!\n\n` +
        `Введи регистрационный код, чтобы подключиться.\n` +
        `Код выдаёт куратор или он указан в карточке ученика.`
      );
    }
    return;
  }

  if (text === '/help') {
    if (student)      await send(chatId, '/dz — домашние задания\n/start — главное меню');
    else if (curator) await send(chatId, '/newdz — создать ДЗ\n/start — главное меню');
    else              await send(chatId, 'Введи регистрационный код для подключения.');
    return;
  }

  if (student) {
    if (text === '/dz') {
      await handleStudentListHw(chatId, student);
      return;
    }
    const sess = await getSession(tid);
    if (typeof sess.step === 'string' && sess.step.startsWith('await_answer:')) {
      const subId = sess.step.slice('await_answer:'.length);
      await handleStudentBriefAnswer(chatId, student, subId, text);
      await setSession(tid, { step: 'student' });
      return;
    }
    await send(chatId, 'Используй /dz для просмотра заданий или /help для справки.');
    return;
  }

  if (curator) {
    if (text === '/newdz') {
      await startHwCreation(chatId, tid, curator);
      return;
    }
    const sess = await getSession(tid);
    switch (sess.step) {
      case 'await_topic':
        await setSession(tid, { step: 'await_desc', data: { ...sess.data, topic: text } });
        await send(chatId, 'Введи описание задания (или «-» чтобы пропустить):');
        return;

      case 'await_desc':
        await setSession(tid, {
          step: 'await_date',
          data: { ...sess.data, description: text === '-' ? '' : text },
        });
        await send(chatId, 'Введи дедлайн в формате ГГГГ-ММ-ДД (или «-» без дедлайна):');
        return;

      case 'await_date': {
        const due = text === '-' ? '' : text;
        if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
          await send(chatId, 'Неверный формат. Введи ГГГГ-ММ-ДД или «-»:');
          return;
        }
        await setSession(tid, { step: 'await_type', data: { ...sess.data, due_date: due } });
        await send(chatId, 'Выбери тип задания:',
          kbd([[
            { text: '📝 Подробный ответ', callback_data: 'hwtype:detailed' },
            { text: '🔢 Краткий ответ',   callback_data: 'hwtype:brief'    },
          ]])
        );
        return;
      }

      case 'await_correct_answer':
        await finishHwCreation(chatId, tid, curator, { ...sess.data, correct_answer: text });
        return;
    }
    await send(chatId, 'Используй /newdz для создания задания или /help для справки.');
    return;
  }

  // Unregistered — treat input as reg_token
  await handleRegistration(chatId, tid, text);
}

// ── Registration via reg_token ────────────────────────────────────────────────

async function handleRegistration(chatId, tid, token) {
  const clean = token.toLowerCase().trim();

  const [studentMatch, roleMatch] = await Promise.all([
    sbSelectOne('students', `reg_token=eq.${encodeURIComponent(clean)}`),
    sbSelectOne('roles',    `reg_token=eq.${encodeURIComponent(clean)}`),
  ]);

  if (studentMatch) {
    if (studentMatch.telegram_id) {
      await send(chatId, 'Этот код уже использован. Попроси куратора выдать новый.');
      return;
    }
    await sbPatch('students', `id=eq.${studentMatch.id}`, { telegram_id: tid });
    await setSession(tid, { step: 'student' });
    await send(chatId,
      `Отлично! Ты подключён как <b>${studentMatch.name}</b>.\n\n` +
      `/dz — посмотреть активные домашние задания`
    );
    return;
  }

  if (roleMatch) {
    if (roleMatch.telegram_id) {
      await send(chatId, 'Этот код уже использован.');
      return;
    }
    await sbPatch('roles', `id=eq.${roleMatch.id}`, { telegram_id: tid });
    await setSession(tid, { step: 'curator' });
    await send(chatId,
      `Отлично! Ты подключён как куратор <b>${roleMatch.name}</b>.\n\n` +
      `/newdz — создать домашнее задание`
    );
    return;
  }

  await send(chatId, 'Код не найден. Проверь и попробуй снова.');
}

// ── Student: list pending HW ──────────────────────────────────────────────────

async function handleStudentListHw(chatId, student) {
  const subs = await sbSelect(
    'homework_submissions',
    `student_id=eq.${student.id}&status=eq.assigned`
  );
  if (!subs.length) {
    await send(chatId, 'Нет активных заданий. Всё сдано!');
    return;
  }

  const aIds       = [...new Set(subs.map(s => s.assignment_id))];
  const assignments = await sbSelect(
    'homework_assignments',
    `id=in.(${aIds.join(',')})&select=id,topic,description,due_date,hw_type`
  );
  const aMap = Object.fromEntries(assignments.map(a => [a.id, a]));

  const lines   = [];
  const buttons = [];
  subs.forEach((sub, i) => {
    const a = aMap[sub.assignment_id];
    if (!a) return;
    const due  = a.due_date ? ` · срок: ${a.due_date}` : '';
    const type = a.hw_type === 'brief' ? ' [краткий]' : '';
    lines.push(`${i + 1}. <b>${a.topic || 'Без темы'}</b>${type}${due}`);
    buttons.push([{ text: `${i + 1}. ${(a.topic || 'ДЗ').slice(0, 32)}`, callback_data: `hw:${sub.id}` }]);
  });

  if (!lines.length) { await send(chatId, 'Нет активных заданий.'); return; }

  await send(chatId,
    `Активные задания (${lines.length}):\n\n${lines.join('\n')}\n\nВыбери для сдачи:`,
    kbd(buttons)
  );
}

// ── Student: submit brief answer (auto-check) ─────────────────────────────────

async function handleStudentBriefAnswer(chatId, student, subId, answer) {
  const sub = await sbSelectOne('homework_submissions',
    `id=eq.${subId}&student_id=eq.${student.id}`);
  if (!sub) { await send(chatId, 'Задание не найдено.'); return; }

  const assignment = await sbSelectOne('homework_assignments', `id=eq.${sub.assignment_id}`);
  if (!assignment) { await send(chatId, 'Задание не найдено.'); return; }

  const correct   = (assignment.correct_answer ?? '').trim();
  const isCorrect = correct !== '' && answer.trim() === correct;
  const now       = new Date().toISOString();

  await sbPatch('homework_submissions', `id=eq.${subId}`, {
    status:       'checked',
    submitted_at: now,
    checked_at:   now,
    score:        isCorrect ? 100 : 0,
    comment:      isCorrect ? 'Верно!' : `Неверно. Правильный ответ: ${correct || 'не указан'}`,
    source:       'telegram',
  });

  if (isCorrect) {
    await send(chatId, `✅ Верно! Отлично, <b>${student.name}</b>!`);
  } else {
    await send(chatId,
      `❌ Неверно.\nПравильный ответ: <b>${correct || 'не указан'}</b>`
    );
  }
}

// ── Curator: begin HW creation ────────────────────────────────────────────────

async function startHwCreation(chatId, tid, curator) {
  const agRows = await sbSelect('assistant_groups', `assistant_id=eq.${curator.id}`);
  if (!agRows.length) {
    await send(chatId, 'У тебя нет назначенных групп. Обратись к владельцу школы.');
    return;
  }
  const groupIds = agRows.map(ag => ag.group_id);
  const groups   = await sbSelect('groups', `id=in.(${groupIds.join(',')})`);

  if (!groups.length) {
    await send(chatId, 'Группы не найдены.');
    return;
  }

  const buttons = groups.map(g => [{ text: g.name, callback_data: `grp:${g.id}` }]);
  await setSession(tid, { step: 'await_group', data: {} });
  await send(chatId, 'Выбери группу для нового ДЗ:', kbd(buttons));
}

// ── Curator: finalise HW creation ────────────────────────────────────────────

async function finishHwCreation(chatId, tid, curator, hwData) {
  const assignmentId = botId();
  await sbInsert('homework_assignments', {
    id:             assignmentId,
    group_id:       hwData.group_id,
    lesson_id:      null,
    topic:          hwData.topic,
    description:    hwData.description ?? '',
    due_date:       hwData.due_date ?? '',
    hw_type:        hwData.hw_type,
    is_advanced:    false,
    correct_answer: hwData.correct_answer ?? null,
    assigned_at:    new Date().toISOString(),
  });

  const students = await sbSelect(
    'students',
    `group_id=eq.${hwData.group_id}&crm_status=in.(active,trial)`
  );

  for (const stu of students) {
    await sbInsert('homework_submissions', {
      id:             botId(),
      assignment_id:  assignmentId,
      student_id:     stu.id,
      status:         'assigned',
      source:         'telegram',
      submitted_at:   null,
      score:          null,
      comment:        '',
      errors:         [],
      checked_by:     null,
      checked_at:     null,
      submission_url: '',
    });
  }

  await setSession(tid, { step: 'curator' });
  await send(chatId,
    `✅ ДЗ создано!\n` +
    `Группа: <b>${hwData.group_name}</b>\n` +
    `Тема: <b>${hwData.topic}</b>\n` +
    `Тип: <b>${hwData.hw_type === 'brief' ? 'Краткий ответ' : 'Подробный ответ'}</b>\n` +
    `Дедлайн: <b>${hwData.due_date || 'не указан'}</b>\n` +
    `Учеников: <b>${students.length}</b>`
  );
}

// ── Callback query handler ────────────────────────────────────────────────────

async function handleCallback(cq) {
  const chatId = cq.message.chat.id;
  const tid    = cq.from.id;
  const data   = cq.data;

  await answerCbq(cq.id);

  const [student, curator, sess] = await Promise.all([
    sbSelectOne('students', `telegram_id=eq.${tid}`),
    sbSelectOne('roles',    `telegram_id=eq.${tid}`),
    getSession(tid),
  ]);

  if (data.startsWith('hw:') && student) {
    const subId = data.slice(3);
    const sub   = await sbSelectOne('homework_submissions',
      `id=eq.${subId}&student_id=eq.${student.id}&status=eq.assigned`);
    if (!sub) { await send(chatId, 'Задание уже сдано или не найдено.'); return; }

    const assignment = await sbSelectOne('homework_assignments', `id=eq.${sub.assignment_id}`);
    if (!assignment) { await send(chatId, 'Задание не найдено.'); return; }

    if (assignment.hw_type === 'brief') {
      await setSession(tid, { step: `await_answer:${subId}` });
      const desc = assignment.description ? `\n\n${assignment.description}` : '';
      await send(chatId, `<b>${assignment.topic}</b>${desc}\n\nВведи свой ответ:`);
    } else {
      await sbPatch('homework_submissions', `id=eq.${subId}`, {
        status:       'submitted',
        submitted_at: new Date().toISOString(),
        source:       'telegram',
      });
      await notifyCurators(assignment, student);
      const desc = assignment.description ? `\n\n${assignment.description}` : '';
      await send(chatId,
        `<b>${assignment.topic}</b>${desc}\n\n` +
        `Задание отмечено как сданное. Куратор проверит его в TutorOS.`
      );
    }
    return;
  }

  if (data.startsWith('grp:') && curator && sess.step === 'await_group') {
    const groupId = data.slice(4);
    const group   = await sbSelectOne('groups', `id=eq.${groupId}`);
    await setSession(tid, {
      step: 'await_topic',
      data: { group_id: groupId, group_name: group?.name ?? groupId },
    });
    await send(chatId, `Группа: <b>${group?.name ?? groupId}</b>\n\nВведи тему задания:`);
    return;
  }

  if (data.startsWith('hwtype:') && curator && sess.step === 'await_type') {
    const hwType = data.slice(7);
    if (hwType === 'brief') {
      await setSession(tid, { step: 'await_correct_answer', data: { ...sess.data, hw_type: 'brief' } });
      await send(chatId, 'Введи правильный ответ для автоматической проверки:');
    } else {
      await finishHwCreation(chatId, tid, curator, { ...sess.data, hw_type: 'detailed', correct_answer: null });
    }
    return;
  }
}

// ── Notify curators when student submits detailed HW ─────────────────────────

async function notifyCurators(assignment, student) {
  const agRows = await sbSelect('assistant_groups', `group_id=eq.${assignment.group_id}`);
  if (!agRows.length) return;
  const rIds     = agRows.map(ag => ag.assistant_id);
  const curators = await sbSelect('roles',
    `id=in.(${rIds.join(',')})&telegram_id=not.is.null&select=telegram_id,name`);
  for (const c of curators) {
    if (!c.telegram_id) continue;
    await send(c.telegram_id,
      `Ученик <b>${student.name}</b> сдал задание «${assignment.topic}».\nПроверь в TutorOS.`
    ).catch(() => {});
  }
}
