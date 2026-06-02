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
  [{ text: '📚 мои задания' }, { text: '📊 мои результаты' }],
  [{ text: '❓ помощь' }],
];
const CURATOR_KBD = [
  [{ text: '➕ создать дз' }, { text: '📋 мои задания' }],
  [{ text: '❓ помощь' }],
];

const rkbd = (rows) => ({
  reply_markup: JSON.stringify({ keyboard: rows, resize_keyboard: true, persistent: true }),
});

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
  if (text === '📚 мои задания'    && student)  return handleStudentListHw(chatId, student);
  if (text === '📊 мои результаты' && student)  return showStudentStats(chatId, student);
  if (text === '➕ создать дз'    && curator)  return startHwCreation(chatId, tid, curator);
  if (text === '📋 мои задания'    && curator)  return showMyDz(chatId, tid, curator, 0);
  if (text === '❓ помощь') {
    if (student) return send(chatId, 'Команды:\n/dz — активные задания\n/mydz — мои результаты\n/unlink — отвязать аккаунт', rkbd(STUDENT_KBD));
    if (curator) return send(chatId, 'Команды:\n/newdz — создать ДЗ\n/mydz — список ДЗ\n/unlink — отвязать аккаунт', rkbd(CURATOR_KBD));
    return send(chatId, 'Введи регистрационный код для подключения.');
  }

  // /start
  if (text === '/start') {
    if (student) {
      await setSession(tid, { step: 'student' });
      return send(chatId, `Привет, <b>${student.name}</b>! 👋\n\nИспользуй кнопки ниже или команды:\n/dz — задания · /mydz — результаты`, rkbd(STUDENT_KBD));
    }
    if (curator) {
      await setSession(tid, { step: 'curator' });
      return send(chatId, `Привет, <b>${curator.name}</b>! 👋\n\nИспользуй кнопки ниже или команды:\n/newdz — создать ДЗ · /mydz — мои ДЗ`, rkbd(CURATOR_KBD));
    }
    await setSession(tid, {});
    return send(chatId, `Добро пожаловать в бот TutorOS!\n\nВведи регистрационный код для подключения.\nКод есть в TutorOS: карточка ученика или страница Доступ.`);
  }

  // /unlink
  if (text === '/unlink') {
    if (!student && !curator) return send(chatId, 'Ты не зарегистрирован.');
    return send(chatId, `Отвязать аккаунт <b>${(student || curator).name}</b>?`,
      kbd([[{ text: '✅ да, отвязать', callback_data: 'unlink:confirm' }, { text: '❌ отмена', callback_data: 'unlink:cancel' }]]));
  }

  // /help
  if (text === '/help') {
    if (student) return send(chatId, '/dz — задания\n/mydz — результаты\n/unlink — отвязать аккаунт', rkbd(STUDENT_KBD));
    if (curator) return send(chatId, '/newdz — создать ДЗ\n/mydz — список ДЗ\n/unlink — отвязать аккаунт', rkbd(CURATOR_KBD));
    return send(chatId, 'Введи регистрационный код для подключения.');
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
        if (!files.length) return send(chatId, 'Пришли хотя бы один файл с выполненным заданием.');
        return finalizeStudentFiles(chatId, student, subId, files);
      }
      return send(chatId, 'Прикрепи фото или PDF-файл. Когда пришлёшь всё — нажми кнопку «Отправить работу».');
    }
    return send(chatId, 'Используй /dz для заданий или /help.');
  }

  // Curator commands
  if (curator) {
    if (text === '/newdz') return startHwCreation(chatId, tid, curator);
    if (text === '/mydz')  return showMyDz(chatId, tid, curator, 0);
    if (text === '/help')  return send(chatId, '/newdz — создать ДЗ\n/mydz — мои ДЗ\n/unlink — отвязать аккаунт');
    const sess = await getSession(tid);
    if (typeof sess.step === 'string' && sess.step.startsWith('edit_hw_topic:')) {
      const hwId = sess.step.slice('edit_hw_topic:'.length);
      await sbPatch('homework_assignments', `id=eq.${hwId}`, { topic: text });
      await setSession(tid, { step: 'curator' });
      return send(chatId, `✅ Тема обновлена: <b>${text}</b>`, kbd([[{ text: '← назад к дз', callback_data: `dz:${hwId}` }]]));
    }
    if (typeof sess.step === 'string' && sess.step.startsWith('edit_hw_date:')) {
      const hwId = sess.step.slice('edit_hw_date:'.length);
      const raw  = text === '-' ? '' : text;
      if (raw && !/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
        return send(chatId, 'Неверный формат. Введи ДД.ММ.ГГГГ или «-»:');
      }
      const due = raw ? raw.split('.').reverse().join('-') : '';
      await sbPatch('homework_assignments', `id=eq.${hwId}`, { due_date: due });
      await setSession(tid, { step: 'curator' });
      return send(chatId, `✅ Дедлайн обновлён: <b>${due || 'не указан'}</b>`, kbd([[{ text: '← назад к дз', callback_data: `dz:${hwId}` }]]));
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
      const hwType = newData.hw_type;
      return send(chatId, '📎 Файл получен!\n\n' + (hwType === 'brief'
        ? 'Сколько заданий (ответов) в этой работе?'
        : 'Сколько заданий в этой работе?'));
    }
  }

  // Student submitting work files
  if (student) {
    const sess = await getSession(tid);
    if (typeof sess.step === 'string' && sess.step.startsWith('await_files:')) {
      const subId = sess.step.slice('await_files:'.length);
      const files = [...(sess.data?.files || []), { type: fileType, file_id: fileId }];
      await setSession(tid, { step: `await_files:${subId}`, data: { ...sess.data, files } });
      return send(chatId, `📎 Файл получен (всего: ${files.length})`,
        kbd([[{ text: '✅ отправить работу', callback_data: `submit_files:${subId}` }],
             [{ text: '❌ отменить',         callback_data: 'cancel_files' }]]));
    }
    return send(chatId, 'Сначала открой задание через /dz.');
  }

  if (!student && !curator) {
    return send(chatId, 'Сначала зарегистрируйся, отправив регистрационный код.');
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
    return send(chatId, `✅ Подключён как <b>${sm.name}</b>!\n\nИспользуй кнопки ниже 👇`, rkbd(STUDENT_KBD));
  }
  if (rm) {
    if (rm.telegram_id) return send(chatId, 'Этот код уже использован.');
    await sbPatch('roles', `id=eq.${rm.id}`, { telegram_id: tid });
    await setSession(tid, { step: 'curator' });
    return send(chatId, `✅ Подключён как <b>${rm.name}</b>!\n\nИспользуй кнопки ниже 👇`, rkbd(CURATOR_KBD));
  }
  return send(chatId, 'Код не найден. Проверь и попробуй снова.');
}

// ── Student: list HW ──────────────────────────────────────────────────────────

async function handleStudentListHw(chatId, student) {
  const subs = await sbSelect('homework_submissions', `student_id=eq.${student.id}&status=eq.assigned`);
  if (!subs.length) return send(chatId, 'Нет активных заданий. Всё сдано! ✅');

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

  if (!lines.length) return send(chatId, 'Нет активных заданий.');
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

  return send(chatId, header + `\n\nпоследние работы (${done.length}):`, kbd(buttons));
}

async function showStudentSubDetail(chatId, student, subId) {
  const sub = await sbOne('homework_submissions', `id=eq.${subId}&student_id=eq.${student.id}`);
  if (!sub) return send(chatId, 'Не найдено.');

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

  return send(chatId, `проверь свои ответы:\n\n${reviewList}\n\nОтправить работу или исправить?`, kbd([
    [{ text: '✏️ исправить ответы', callback_data: `brief_back_to_edit:${subId}` }],
    [{ text: '✅ отправить работу', callback_data: `brief_final_submit:${subId}` }]
  ]));
}

async function submitBriefAnswers(chatId, student, subId, correct, given) {
  const now = new Date().toISOString();
  const results    = correct.map((c, i) => given[i]?.toLowerCase().trim() === c.toLowerCase().trim());
  const numCorrect = results.filter(Boolean).length;
  const score      = numCorrect;
  const maxScore   = correct.length;

  await sbPatch('homework_submissions', `id=eq.${subId}`, {
    status: 'checked', submitted_at: now, checked_at: now,
    score, max_score: maxScore,
    comment: `${numCorrect}/${correct.length} верно`,
    student_answers: given, source: 'telegram',
  });
  await setSession(student.telegram_id, { step: 'student' });

  const feedback = results.map((ok, i) => `${i + 1}. ${ok ? '✅' : `❌ (верно: ${correct[i]})`}\n   ты: <code>${given[i] || 'не ответил'}</code>`).join('\n');
  return send(chatId, `результат: <b>${numCorrect}/${correct.length}</b>\n\n${feedback}`);
}

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
    score: isCorrect ? 100 : 0, max_score: 100,
    comment: isCorrect ? 'Верно!' : `Неверно. Правильный ответ: ${correct || 'не указан'}`,
    source: 'telegram',
  });
  if (student.telegram_id) await setSession(student.telegram_id, { step: 'student' });
  return send(chatId, isCorrect ? `✅ Верно! Отлично, <b>${student.name}</b>!`
    : `❌ Неверно.\nПравильный ответ: <b>${correct || 'не указан'}</b>`);
}

// ── Student: finalize file submission ─────────────────────────────────────────

async function finalizeStudentFiles(chatId, student, subId, files) {
  const sub = await sbOne('homework_submissions', `id=eq.${subId}&student_id=eq.${student.id}`);
  if (!sub) return send(chatId, 'Задание не найдено.');

  const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);

  await sbPatch('homework_submissions', `id=eq.${subId}`, {
    status:          'submitted',
    submitted_at:    new Date().toISOString(),
    submitted_files: files,
    source:          'telegram',
  });
  await setSession(student.telegram_id, { step: 'student' });

  if (assignment) await notifyCuratorsWithFiles(assignment, student, files);

  return send(chatId,
    `✅ Работа отправлена (${files.length} файл(ов))!\nКуратор получит уведомление и проверит в TutorOS.`);
}

// ── Curator: start HW creation with multi-group ───────────────────────────────

async function startHwCreation(chatId, tid, curator) {
  const agRows = await sbSelect('assistant_groups', `assistant_id=eq.${curator.id}`);

  let groups;
  if (curator.role_type === 'owner' || curator['isOwner']) {
    groups = await sbSelect('groups', 'order=name.asc');
  } else {
    if (!agRows.length) return send(chatId, 'У тебя нет назначенных групп.');
    const gIds = agRows.map(ag => ag.group_id);
    groups = await sbSelect('groups', `id=in.(${gIds.join(',')})`);
  }

  if (!groups.length) return send(chatId, 'Группы не найдены.');

  const allGroups      = groups.map(g => ({ id: g.id, name: g.name }));
  const selectedGroups = [];
  await setSession(tid, { step: 'await_group', data: { all_groups: allGroups, selected_groups: selectedGroups } });

  return send(chatId, 'выбери группы (можно несколько):',
    kbd(buildGroupKbd(allGroups, selectedGroups)));
}

function buildGroupKbd(allGroups, selectedIds) {
  const rows = allGroups.map(g => [{
    text:          (selectedIds.includes(g.id) ? '✅ ' : '☐ ') + g.name,
    callback_data: `grp_toggle:${g.id}`,
  }]);
  rows.push([{ text: '✅ подтвердить выбор', callback_data: 'grp_confirm' }]);
  return rows;
}

// ── Curator: step-by-step text input ─────────────────────────────────────────

async function handleCuratorStep(chatId, tid, curator, sess, text) {
  switch (sess.step) {
    case 'await_topic':
      await setSession(tid, { step: 'await_date', data: { ...sess.data, topic: text } });
      return send(chatId, 'Введи дедлайн (ДД.ММ.ГГГГ) или «-» без дедлайна:');

    case 'await_date': {
      const due = text === '-' ? '' : text;
      if (due && !/^\d{2}\.\d{2}\.\d{4}$/.test(due)) {
        return send(chatId, 'Неверный формат. Введи ДД.ММ.ГГГГ или «-»:');
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
      if (text !== '-') return send(chatId, 'Отправь PDF-файл или напиши «-» чтобы пропустить:');
      const newData = { ...sess.data, file_id: null };
      await setSession(tid, { step: 'await_count', data: newData });
      return send(chatId, newData.hw_type === 'brief'
        ? 'Сколько заданий (ответов) в этой работе?'
        : 'Сколько заданий в этой работе?');
    }

    case 'await_count': {
      const n = parseInt(text, 10);
      if (!n || n < 1 || n > 50) return send(chatId, 'Введи число от 1 до 50:');
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
      return finishHwCreation(chatId, tid, curator, { ...sess.data, answers: collected });
    }

    case 'await_scores': {
      const score = parseFloat(text.replace(',', '.'));
      if (isNaN(score) || score < 0) return send(chatId, 'Введи число (например: 5 или 2.5):');
      const scores = [...(sess.data.scores || []), score];
      const total  = sess.data.total;
      if (scores.length < total) {
        await setSession(tid, { step: 'await_scores', data: { ...sess.data, scores } });
        return send(chatId, `максимальный балл за <b>задание ${scores.length + 1}</b> из ${total}:`);
      }
      return finishHwCreation(chatId, tid, curator, { ...sess.data, task_config: scores });
    }

    default:
      return send(chatId, 'Используй /newdz для создания задания.');
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
      return send(chatId, `❌ ошибка при создании задания:\n<code>${err.message}</code>`);
    }

    const students = await sbSelect('students',
      `group_id=eq.${groupId}&crm_status=in.(active,trial)`);
    totalStudents += students.length;

    const typeLabel = hw_type === 'brief' ? 'краткий ответ'
      : hw_type === 'trial' ? 'пробник'
      : is_advanced ? 'подробный (сложный)' : 'подробный';
    const due = data.due_date ? `\nДедлайн: <b>${data.due_date}</b>` : '';
    const notifyText = `📚 Новое ДЗ: <b>${data.topic}</b>\nТип: ${typeLabel}${due}\n\n/dz — открыть задания`;

    for (const stu of students) {
      try {
        await sbInsert('homework_submissions', {
          id: botId(), assignment_id: assignmentId, student_id: stu.id,
          status: 'assigned', source: 'telegram',
          submitted_at: null, score: null, comment: '', errors: [],
          checked_by: null, checked_at: null, submission_url: '',
        });
      } catch { subErrors++; }
      if (stu.telegram_id) await send(stu.telegram_id, notifyText).catch(() => {});
    }
  }

  await setSession(tid, { step: 'curator' });

  const typeLabel = hw_type === 'brief' ? 'краткий ответ'
    : hw_type === 'trial' ? 'пробник'
    : is_advanced ? 'подробный (сложный)' : 'подробный (несложный)';

  const extra = hw_type === 'brief' && data.answers
    ? `\nОтветы: <code>${data.answers.join(', ')}</code>`
    : hw_type !== 'brief' && data.task_config
    ? `\nБаллов за задания: <code>${data.task_config.join(', ')}</code> (сумма: ${data.task_config.reduce((a, b) => a + b, 0)})`
    : '';

  const groupsLine  = groupIds.length > 1 ? `Групп: <b>${groupIds.length}</b> (${groupNames})` : `Группа: <b>${groupNames}</b>`;
  const warnLine    = subErrors ? `\n⚠️ Ошибок при создании записей: ${subErrors}` : '';

  return send(chatId,
    `✅ ДЗ создано!\n${groupsLine}\nТема: <b>${data.topic}</b>\n` +
    `Тип: <b>${typeLabel}</b>\nДедлайн: <b>${data.due_date || 'не указан'}</b>\n` +
    `Учеников: <b>${totalStudents}</b>${extra}${warnLine}\n\n` +
    `В TutorOS обнови страницу (F5) чтобы увидеть ДЗ.`);
}

// ── Curator: list my DZ ───────────────────────────────────────────────────────

async function showMyDz(chatId, tid, curator, offset) {
  let assignments;
  if (curator.role_type === 'owner' || curator['isOwner']) {
    assignments = await sbSelect('homework_assignments',
      `order=assigned_at.desc&limit=10&offset=${offset}`);
  } else {
    const agRows = await sbSelect('assistant_groups', `assistant_id=eq.${curator.id}`);
    if (!agRows.length) return send(chatId, 'Нет назначенных групп.');
    const gIds = agRows.map(ag => ag.group_id);
    assignments = await sbSelect('homework_assignments',
      `group_id=in.(${gIds.join(',')})&order=assigned_at.desc&limit=10&offset=${offset}`);
  }

  if (!assignments.length) return send(chatId, offset === 0 ? 'ДЗ не найдено.' : 'Больше ДЗ нет.');

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
  if (!a) return send(chatId, 'ДЗ не найдено.');

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
    [{ text: '✏️ изменить тему',    callback_data: `dz_et:${hwId}` },
     { text: '📅 изменить дедлайн', callback_data: `dz_ed:${hwId}` }],
    [{ text: '🗑️ удалить дз',      callback_data: `dz_del:${hwId}` }],
    [{ text: '← к списку',          callback_data: 'dz_pg:0' }],
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
    return send(chatId, 'Введи новую тему:');
  }
  if (data.startsWith('dz_ed:') && curator) {
    const hwId = data.slice(6);
    await setSession(tid, { step: `edit_hw_date:${hwId}` });
    return send(chatId, 'Введи новый дедлайн (ДД.ММ.ГГГГ) или «-» чтобы убрать:');
  }
  if (data.startsWith('dz_del:') && curator) {
    const hwId = data.slice(7);
    const a    = await sbOne('homework_assignments', `id=eq.${hwId}&select=topic`);
    return send(chatId, `удалить дз «<b>${a?.topic || hwId}</b>» и все записи учеников?`,
      kbd([[{ text: '✅ да, удалить', callback_data: `dz_delok:${hwId}` },
             { text: '❌ отмена',     callback_data: `dz:${hwId}` }]]));
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
    return send(chatId, '✅ дз удалено.');
  }

  // Unlink
  if (data === 'unlink:confirm') {
    if (student) await sbPatch('students', `id=eq.${student.id}`, { telegram_id: null });
    if (curator) await sbPatch('roles',    `id=eq.${curator.id}`, { telegram_id: null });
    await setSession(tid, {});
    return send(chatId, 'Аккаунт отвязан. Введи новый регистрационный код для повторного подключения.');
  }
  if (data === 'unlink:cancel') return send(chatId, 'Отмена.');

  // Multi-group toggle
  if (data.startsWith('grp_toggle:') && curator && sess.step === 'await_group') {
    const groupId    = data.slice('grp_toggle:'.length);
    const allGroups  = sess.data?.all_groups || [];
    const selected   = sess.data?.selected_groups || [];
    const newSelected = selected.includes(groupId)
      ? selected.filter(id => id !== groupId)
      : [...selected, groupId];

    await setSession(tid, { step: 'await_group', data: { ...sess.data, selected_groups: newSelected } });

    const selectedNames = allGroups.filter(g => newSelected.includes(g.id)).map(g => g.name);
    const statusText    = newSelected.length
      ? `Выбрано: ${selectedNames.join(', ')}\n\nДобавь ещё или подтверди:`
      : 'Выбери группы (можно несколько):';

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
    if (!selected.length) return send(chatId, 'Выбери хотя бы одну группу.');
    const groupNames = allGroups.filter(g => selected.includes(g.id)).map(g => g.name).join(', ');
    await setSession(tid, { step: 'await_topic', data: { ...sess.data, group_ids: selected, group_names: groupNames } });
    return send(chatId, `Группы: <b>${groupNames}</b>\n\nВведи тему задания:`);
  }

  // Curator: HW type selection
  if (data.startsWith('hwtype:') && curator && sess.step === 'await_hwtype') {
    const hwType = data.slice(7);
    await setSession(tid, { step: 'await_pdf', data: { ...sess.data, hw_type: hwType } });
    return send(chatId, 'Отправь PDF-файл с заданием (или напиши «-» чтобы пропустить):');
  }

  // Student taps HW
  if (data.startsWith('hw:') && student) {
    const subId = data.slice(3);
    const sub   = await sbOne('homework_submissions',
      `id=eq.${subId}&student_id=eq.${student.id}&status=eq.assigned`);
    if (!sub) return send(chatId, 'Задание уже сдано или не найдено.');

    const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);
    if (!assignment) return send(chatId, 'Задание не найдено.');

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
      return send(chatId, `<b>${assignment.topic}</b>${desc}\n\nВведи ответ:`);
    }

    // detailed / trial → collect files from student
    await setSession(tid, { step: `await_files:${subId}`, data: { files: [] } });
    return send(chatId,
      `<b>${assignment.topic}</b>${desc}\n\nОтправь выполненное задание фото или PDF-файлом.\nМожно несколько файлов — нажми «Отправить работу», когда пришлёшь всё.`,
      kbd([[{ text: '✅ Отправить работу', callback_data: `submit_files:${subId}` }],
           [{ text: '❌ Отменить',         callback_data: 'cancel_files' }]]));
  }

  // Student submits collected files
  if (data.startsWith('submit_files:') && student) {
    const subId = data.slice('submit_files:'.length);
    const files = sess.data?.files || [];
    if (!files.length) return send(chatId, 'Пришли хотя бы один файл с выполненным заданием.');
    return finalizeStudentFiles(chatId, student, subId, files);
  }

  // Student cancels file submission
  if (data === 'cancel_files' && student) {
    await setSession(tid, { step: 'student' });
    return send(chatId, 'Сдача отменена. /dz — посмотреть задания.');
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

// ── Notify curators on detailed/trial submission (with files) ─────────────────

async function notifyCuratorsWithFiles(assignment, student, files) {
  const agRows = await sbSelect('assistant_groups', `group_id=eq.${assignment.group_id}`);
  if (!agRows.length) return;
  const rIds     = agRows.map(ag => ag.assistant_id);
  const curators = await sbSelect('roles',
    `id=in.(${rIds.join(',')})&telegram_id=not.is.null&select=telegram_id,name`);

  for (const c of curators) {
    if (!c.telegram_id) continue;
    await send(c.telegram_id,
      `📤 Ученик <b>${student.name}</b> сдал «${assignment.topic}» (${files.length} файл(ов)). Проверь в TutorOS.`
    ).catch(() => {});
    for (const f of files) {
      if (f.type === 'photo') {
        await tg('sendPhoto', { chat_id: c.telegram_id, photo: f.file_id }).catch(() => {});
      } else {
        await tg('sendDocument', { chat_id: c.telegram_id, document: f.file_id }).catch(() => {});
      }
    }
  }
}
