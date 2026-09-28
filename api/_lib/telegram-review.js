import { sendStudentEverywhere, sendTelegram, telegram, tgInlineKeyboard } from './channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;

const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function sbSelect(table, qs = '') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB });
  if (!response.ok) throw new Error(`sbSelect ${table}: ${await response.text()}`);
  return response.json();
}
async function sbOne(table, qs) {
  const rows = await sbSelect(table, `${qs}&limit=1`);
  return rows[0] ?? null;
}
async function sbPatch(table, qs, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: { ...SB, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbPatch ${table}: ${await response.text()}`);
  return response.json();
}
async function sbUpsert(table, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sbUpsert ${table}: ${await response.text()}`);
  return response.json();
}

async function getSession(userId) {
  const row = await sbOne('telegram_sessions', `telegram_user_id=eq.${userId}&select=state`);
  return row?.state || {};
}
async function setSession(userId, state) {
  await sbUpsert('telegram_sessions', {
    telegram_user_id: userId,
    state,
    updated_at: new Date().toISOString(),
  });
}

function ownerKeyboard() {
  return tgInlineKeyboard([
    [{ text: '🕒 непроверено', callback_data: 'owner:unchecked' }],
    [{ text: '← меню', callback_data: 'owner:home' }],
  ]);
}

async function deleteSource(query) {
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  if (!chatId || !messageId) return;
  await telegram('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
}

async function loadPendingReview(subId) {
  const submission = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&status=eq.submitted` +
      '&select=id,student_id,assignment_id,status');
  if (!submission) return null;
  const [assignment, student] = await Promise.all([
    sbOne('homework_assignments',
      `id=eq.${encodeURIComponent(submission.assignment_id)}` +
        '&select=id,topic,task_config'),
    sbOne('students',
      `id=eq.${encodeURIComponent(submission.student_id)}` +
        '&select=id,name,vk_id,telegram_id'),
  ]);
  if (!assignment || !student) return null;
  return { submission, assignment, student };
}

async function startAccept(query, subId) {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const data = await loadPendingReview(subId);
  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  await deleteSource(query);
  if (!data) {
    await sendTelegram(chatId, 'эта работа уже обработана или больше не ждёт проверки.', {
      reply_markup: ownerKeyboard(),
    });
    return true;
  }

  const taskConfig = Array.isArray(data.assignment.task_config)
    ? data.assignment.task_config.map(Number).filter(value => Number.isFinite(value) && value >= 0)
    : [];

  if (taskConfig.length) {
    await setSession(userId, {
      step: 'tg_review_task',
      data: {
        sub_id: subId,
        topic: data.assignment.topic,
        student_name: data.student.name,
        task_config: taskConfig,
        current: 0,
        task_scores: [],
      },
    });
    await sendTelegram(chatId,
      `<b>${esc(data.student.name)}</b> · ${esc(data.assignment.topic || 'ДЗ')}\n\n` +
      `задание 1 из ${taskConfig.length}: сколько баллов из ${taskConfig[0]}?`);
    return true;
  }

  await setSession(userId, {
    step: 'tg_review_total',
    data: {
      sub_id: subId,
      topic: data.assignment.topic,
      student_name: data.student.name,
    },
  });
  await sendTelegram(chatId,
    `<b>${esc(data.student.name)}</b> · ${esc(data.assignment.topic || 'ДЗ')}\n\n` +
    'введи итоговый результат от 0 до 100:');
  return true;
}

async function startRevision(query, subId) {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const data = await loadPendingReview(subId);
  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  await deleteSource(query);
  if (!data) {
    await sendTelegram(chatId, 'эта работа уже обработана или больше не ждёт проверки.', {
      reply_markup: ownerKeyboard(),
    });
    return true;
  }
  await setSession(userId, {
    step: 'tg_revision_comment',
    data: {
      sub_id: subId,
      topic: data.assignment.topic,
      student_name: data.student.name,
    },
  });
  await sendTelegram(chatId,
    `<b>${esc(data.student.name)}</b> · ${esc(data.assignment.topic || 'ДЗ')}\n\n` +
    'напиши, что нужно исправить:');
  return true;
}

async function finalizeChecked(chatId, userId, data, commentText) {
  const pending = await loadPendingReview(data.sub_id);
  if (!pending) {
    await setSession(userId, { step: 'owner' });
    await sendTelegram(chatId, 'эта работа уже была проверена. повторная оценка не сохранена.', {
      reply_markup: ownerKeyboard(),
    });
    return true;
  }

  const score = Number(data.score);
  const maxScore = Number(data.max_score);
  const comment = String(commentText || '').trim() === '-'
    ? 'проверено преподавателем'
    : String(commentText || '').trim();
  const checkedAt = new Date().toISOString();
  const updated = await sbPatch('homework_submissions',
    `id=eq.${encodeURIComponent(data.sub_id)}&status=eq.submitted`, {
      status: 'checked',
      score,
      max_score: maxScore,
      task_scores: Array.isArray(data.task_scores) ? data.task_scores : null,
      comment,
      checked_at: checkedAt,
    });
  await setSession(userId, { step: 'owner' });
  if (!updated.length) {
    await sendTelegram(chatId, 'эта работа уже была проверена. повторная оценка не сохранена.', {
      reply_markup: ownerKeyboard(),
    });
    return true;
  }

  await sendStudentEverywhere(pending.student, {
    text: `✅ ДЗ «<b>${esc(pending.assignment.topic || 'без темы')}</b>» проверено: ` +
      `<b>${score}/${maxScore}</b>.${comment ? `\n${esc(comment)}` : ''}`,
  });
  await sendTelegram(chatId,
    `✅ проверено: <b>${esc(pending.student.name)}</b> · ${score}/${maxScore}`, {
      reply_markup: ownerKeyboard(),
    });
  return true;
}

async function finalizeRevision(chatId, userId, data, commentText) {
  const pending = await loadPendingReview(data.sub_id);
  if (!pending) {
    await setSession(userId, { step: 'owner' });
    await sendTelegram(chatId, 'эта работа уже обработана.', { reply_markup: ownerKeyboard() });
    return true;
  }
  const comment = String(commentText || '').trim();
  if (!comment || comment === '-') {
    await sendTelegram(chatId, 'для доработки нужен короткий комментарий: что именно исправить?');
    return true;
  }
  const updated = await sbPatch('homework_submissions',
    `id=eq.${encodeURIComponent(data.sub_id)}&status=eq.submitted`, {
      status: 'revision',
      comment,
      checked_at: new Date().toISOString(),
    });
  await setSession(userId, { step: 'owner' });
  if (!updated.length) {
    await sendTelegram(chatId, 'эта работа уже обработана.', { reply_markup: ownerKeyboard() });
    return true;
  }
  await sendStudentEverywhere(pending.student, {
    text: `↩️ ДЗ «<b>${esc(pending.assignment.topic || 'без темы')}</b>» возвращено на доработку.\n${esc(comment)}`,
  });
  await sendTelegram(chatId, `↩️ отправлено на доработку: <b>${esc(pending.student.name)}</b>`, {
    reply_markup: ownerKeyboard(),
  });
  return true;
}

async function handleOwnerText(message, session) {
  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();

  if (session.step === 'tg_review_task') {
    const current = Number(session.data?.current || 0);
    const taskConfig = Array.isArray(session.data?.task_config) ? session.data.task_config.map(Number) : [];
    const max = Number(taskConfig[current]);
    const score = Number(text.replace(',', '.'));
    if (!Number.isFinite(score) || score < 0 || score > max) {
      await sendTelegram(chatId, `введи число от 0 до ${max}:`);
      return true;
    }
    const taskScores = [...(session.data?.task_scores || []), score];
    if (current + 1 < taskConfig.length) {
      await setSession(userId, {
        step: 'tg_review_task',
        data: { ...session.data, current: current + 1, task_scores: taskScores },
      });
      await sendTelegram(chatId,
        `задание ${current + 2} из ${taskConfig.length}: сколько баллов из ${taskConfig[current + 1]}?`);
      return true;
    }
    await setSession(userId, {
      step: 'tg_review_comment',
      data: {
        ...session.data,
        score: taskScores.reduce((sum, value) => sum + Number(value || 0), 0),
        max_score: taskConfig.reduce((sum, value) => sum + Number(value || 0), 0),
        task_scores: taskScores,
      },
    });
    await sendTelegram(chatId, 'напиши комментарий ученику или «-», чтобы пропустить:');
    return true;
  }

  if (session.step === 'tg_review_total') {
    const score = Number(text.replace(',', '.'));
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      await sendTelegram(chatId, 'введи итоговый результат от 0 до 100:');
      return true;
    }
    await setSession(userId, {
      step: 'tg_review_comment',
      data: { ...session.data, score, max_score: 100, task_scores: null },
    });
    await sendTelegram(chatId, 'напиши комментарий ученику или «-», чтобы пропустить:');
    return true;
  }

  if (session.step === 'tg_review_comment') {
    return finalizeChecked(chatId, userId, session.data || {}, text);
  }
  if (session.step === 'tg_revision_comment') {
    return finalizeRevision(chatId, userId, session.data || {}, text);
  }
  return false;
}

export async function handleTelegramReviewUpdate(update) {
  const userId = update?.message?.from?.id || update?.callback_query?.from?.id;
  if (!userId || !OWNER_TELEGRAM_ID || String(userId) !== String(OWNER_TELEGRAM_ID)) return false;

  const query = update?.callback_query;
  if (query) {
    const data = String(query.data || '');
    if (data.startsWith('reviewok:')) return startAccept(query, data.slice('reviewok:'.length));
    if (data.startsWith('reviewrev:')) return startRevision(query, data.slice('reviewrev:'.length));
  }

  if (update?.message?.text && !String(update.message.text).startsWith('/')) {
    const session = await getSession(userId);
    return handleOwnerText(update.message, session);
  }
  return false;
}
