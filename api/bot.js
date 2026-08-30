// api/bot.js — VK Community Callback API (Vercel Serverless, Node 18+)
// Env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, VK_GROUP_TOKEN,
// VK_GROUP_ID, VK_CALLBACK_SECRET, OWNER_VK_ID

import { AsyncLocalStorage } from 'node:async_hooks';

const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const VK_GROUP_TOKEN     = process.env.VK_GROUP_TOKEN;
const VK_GROUP_ID        = process.env.VK_GROUP_ID;
const VK_CALLBACK_SECRET = process.env.VK_CALLBACK_SECRET;
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE;
const VK_API_VERSION     = process.env.VK_API_VERSION || '5.199';
const OWNER_VK_ID        = process.env.OWNER_VK_ID;
const UI_MESSAGE_IDS_KEY = '_ui_message_ids';
const HW_STORAGE_BUCKET = 'homework-materials';
const HW_STORAGE_PREFIX = 'storage:';
const uiMessageStorage   = new AsyncLocalStorage();

const isOwner = (vkUserId) =>
  Boolean(OWNER_VK_ID) && String(vkUserId) === String(OWNER_VK_ID);

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
    method: 'PATCH',
    headers: { ...SB, 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbPatch ${table}: ${await r.text()}`);
  return r.json();
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

async function sbRpc(fn, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: SB, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbRpc ${fn}: ${await r.text()}`);
  return r.json();
}

// ── Session ───────────────────────────────────────────────────────────────────

async function getSession(tid) {
  const row = await sbOne('vk_sessions', `vk_user_id=eq.${tid}`);
  return row?.state ?? {};
}

async function setSession(tid, state) {
  await sbUpsert('vk_sessions', { vk_user_id: tid, state, updated_at: new Date().toISOString() });
}

async function recordVkDiagnostic(update, phase, error = null) {
  const groupMatches = !VK_GROUP_ID || String(update?.group_id) === String(VK_GROUP_ID);
  const secretPresent = typeof update?.secret === 'string' && update.secret.length > 0;
  const secretMatches = !VK_CALLBACK_SECRET || update?.secret === VK_CALLBACK_SECRET;
  await sbUpsert('vk_sessions', {
    vk_user_id: -1,
    state: {
      diagnostic: true,
      received_at: new Date().toISOString(),
      type: String(update?.type || 'unknown').slice(0, 50),
      group_matches: groupMatches,
      secret_present: secretPresent,
      secret_matches: secretMatches,
      phase,
      error: error ? String(error).slice(0, 300) : null,
    },
    updated_at: new Date().toISOString(),
  });
}

// ── VK helpers ────────────────────────────────────────────────────────────────

async function vk(method, params = {}) {
  if (!VK_GROUP_TOKEN) throw new Error('VK_GROUP_TOKEN не настроен');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, access_token: VK_GROUP_TOKEN, v: VK_API_VERSION })) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const r = await fetch(`https://api.vk.com/method/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const result = await r.json().catch(() => null);
  if (!r.ok || result?.error) {
    throw new Error(`VK ${method}: ${result?.error?.error_msg || r.status}`);
  }
  return result?.response;
}

const storageObjectPath = path => String(path || '')
  .split('/')
  .map(part => encodeURIComponent(part))
  .join('/');

async function ensureHomeworkStorageBucket() {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: SB,
    body: JSON.stringify({
      id: HW_STORAGE_BUCKET,
      name: HW_STORAGE_BUCKET,
      public: false,
      file_size_limit: 20 * 1024 * 1024,
      allowed_mime_types: ['application/pdf'],
    }),
  });
  if (response.ok) return;
  const text = await response.text();
  if ((response.status === 400 || response.status === 409)
      && /already exists|duplicate/i.test(text)) return;
  throw new Error(`storage bucket: ${text || response.status}`);
}

async function uploadHomeworkStorageObject(path, bytes) {
  await ensureHomeworkStorageBucket();
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${HW_STORAGE_BUCKET}/${storageObjectPath(path)}`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/pdf',
        'x-upsert': 'true',
      },
      body: bytes,
    },
  );
  if (!response.ok) throw new Error(`storage upload: ${await response.text()}`);
}

async function downloadHomeworkStorageObject(path) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${HW_STORAGE_BUCKET}/${storageObjectPath(path)}`,
    { headers: { 'apikey': SUPABASE_SECRET_KEY, 'Authorization': `Bearer ${SUPABASE_SECRET_KEY}` } },
  );
  if (!response.ok) throw new Error(`storage download: ${await response.text()}`);
  return response.arrayBuffer();
}

const materialPathFromRef = ref => String(ref || '').startsWith(HW_STORAGE_PREFIX)
  ? String(ref).slice(HW_STORAGE_PREFIX.length)
  : null;

const safePdfName = value => {
  const base = String(value || 'homework.pdf')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'homework.pdf';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
};

async function resolveVkDocumentInfo(document) {
  if (document?.url) return document;
  const fileId = document?.file_id;
  if (!fileId || !String(fileId).startsWith('doc')) return null;
  const response = await vk('docs.getById', { docs: String(fileId).slice(3) });
  const doc = Array.isArray(response) ? response[0] : response?.items?.[0] || response?.doc || null;
  return doc ? {
    ...document,
    url: doc.url,
    title: doc.title,
    ext: doc.ext,
    size: doc.size,
  } : null;
}

async function persistHomeworkMaterial(document, assignmentId) {
  const info = await resolveVkDocumentInfo(document);
  if (!info?.url) throw new Error('VK не дал ссылку на документ');
  const ext = String(info.ext || '').toLowerCase();
  const title = String(info.title || 'homework.pdf');
  if (ext && ext !== 'pdf' && !title.toLowerCase().endsWith('.pdf')) {
    throw new Error('нужен именно PDF-файл');
  }
  const source = await fetch(info.url);
  if (!source.ok) throw new Error(`VK download: ${source.status}`);
  const bytes = await source.arrayBuffer();
  if (!bytes.byteLength) throw new Error('пустой PDF');
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('PDF больше 20 МБ');
  const filename = safePdfName(title);
  const path = `${assignmentId}/${Date.now()}-${filename}`;
  await uploadHomeworkStorageObject(path, bytes);
  return `${HW_STORAGE_PREFIX}${path}`;
}

async function storedMaterialToVkAttachment(peerId, materialRef) {
  const path = materialPathFromRef(materialRef);
  if (!path) return null;
  const bytes = await downloadHomeworkStorageObject(path);
  const rawName = path.split('/').pop() || 'homework.pdf';
  const filename = safePdfName(rawName.replace(/^\d+-/, ''));
  const server = await vk('docs.getMessagesUploadServer', { peer_id: peerId, type: 'doc' });
  if (!server?.upload_url) throw new Error('VK не выдал upload_url');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  const uploadedResponse = await fetch(server.upload_url, { method: 'POST', body: form });
  const uploaded = await uploadedResponse.json().catch(() => null);
  if (!uploadedResponse.ok || !uploaded?.file) {
    throw new Error(`VK upload: ${uploaded?.error || uploadedResponse.status}`);
  }
  const saved = await vk('docs.save', { file: uploaded.file, title: filename });
  const doc = Array.isArray(saved) ? saved[0] : saved?.doc || saved?.items?.[0] || saved;
  if (doc?.owner_id === undefined || doc?.id === undefined) {
    throw new Error('VK docs.save не вернул документ');
  }
  return `doc${doc.owner_id}_${doc.id}${doc.access_key ? `_${doc.access_key}` : ''}`;
}

async function sendHomeworkMaterial(peerId, materialRef) {
  if (!materialRef) return false;
  const storedPath = materialPathFromRef(materialRef);
  const attachment = storedPath
    ? await storedMaterialToVkAttachment(peerId, materialRef)
    : materialRef;
  if (!attachment) return false;
  await sendAttachment(peerId, attachment);
  return true;
}

const randomId = () => Math.floor(Math.random() * 2147483647) || 1;
const plainText = value => String(value ?? '')
  .replace(/<\/?(?:b|code)>/g, '')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&amp;', '&');
async function prepareUiPeer(peerId) {
  const context = uiMessageStorage.getStore();
  if (!context) return null;

  const key = String(peerId);
  if (context.peers.has(key)) return context.peers.get(key);

  const peer = { peerId, messageIds: [] };
  context.peers.set(key, peer);

  const session = await getSession(peerId).catch(() => ({}));
  const previousIds = Array.isArray(session?.[UI_MESSAGE_IDS_KEY])
    ? session[UI_MESSAGE_IDS_KEY].filter(id => Number.isInteger(Number(id)))
    : [];
  if (previousIds.length) {
    await vk('messages.delete', {
      message_ids: previousIds.join(','),
      delete_for_all: 1,
    }).catch(error => {
      // VK can reject deletion of an old/already deleted message. A stale screen
      // must never block the next bot action.
      console.warn('VK previous screen cleanup failed:', error?.message || error);
    });
  }
  return peer;
}

async function rememberUiMessage(peerId, messageId) {
  if (!Number.isInteger(Number(messageId))) return;
  const peer = await prepareUiPeer(peerId);
  if (peer) peer.messageIds.push(Number(messageId));
}

async function persistUiMessages() {
  const context = uiMessageStorage.getStore();
  if (!context) return;

  for (const peer of context.peers.values()) {
    const session = await getSession(peer.peerId).catch(() => ({}));
    await setSession(peer.peerId, {
      ...session,
      [UI_MESSAGE_IDS_KEY]: peer.messageIds,
    }).catch(error => {
      console.warn('VK current screen state save failed:', error?.message || error);
    });
  }
}

const send = async (peerId, message, extra = {}) => {
  await prepareUiPeer(peerId);
  const messageId = await vk('messages.send', {
    peer_id: peerId,
    random_id: randomId(),
    message: plainText(message),
    ...extra,
  });
  await rememberUiMessage(peerId, messageId);
  return messageId;
};
const sendAttachment = async (peerId, attachment) => {
  await prepareUiPeer(peerId);
  const messageId = await vk('messages.send', {
    peer_id: peerId,
    random_id: randomId(),
    attachment,
  });
  await rememberUiMessage(peerId, messageId);
  return messageId;
};
const cbq = (eventId, text = '', context = {}) => vk('messages.sendMessageEventAnswer', {
  event_id: eventId,
  user_id: context.user_id,
  peer_id: context.peer_id,
  event_data: JSON.stringify({ type: 'show_snackbar', text: text || '✓' }),
});
const vkButton = (button, callback = true) => ({
  action: callback && button.callback_data
    ? { type: 'callback', label: button.text, payload: JSON.stringify({ cmd: button.callback_data }) }
    : { type: 'text', label: button.text, payload: '{}' },
  color: button.color || 'secondary',
});
const compactInlineRows = (rows) => {
  const cleanRows = rows.filter(row => Array.isArray(row) && row.length);
  if (cleanRows.length <= 6 && cleanRows.every(row => row.length <= 4)) return cleanRows;

  const buttons = cleanRows.flat();
  if (buttons.length > 24) {
    throw new Error(`слишком много кнопок на одном экране: ${buttons.length}`);
  }
  const buttonsPerRow = Math.max(1, Math.ceil(buttons.length / 6));
  const compact = [];
  for (let index = 0; index < buttons.length; index += buttonsPerRow) {
    compact.push(buttons.slice(index, index + buttonsPerRow));
  }
  return compact;
};
const kbd   = (rows) => {
  const compactRows = compactInlineRows(rows);
  for (const button of compactRows.flat()) {
    if (!button?.callback_data) continue;
    const length = new TextEncoder().encode(button.callback_data).length;
    if (length > 200) {
      throw new Error(`слишком длинная команда кнопки: ${button.callback_data.slice(0, 24)}…`);
    }
  }
  return {
    keyboard: JSON.stringify({
      inline: true,
      buttons: compactRows.map(row => row.map(button => vkButton(button))),
    }),
  };
};
const botId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const callbackNonce = () => Math.random().toString(36).slice(2, 8);
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
const moscowDateTime = (isoDate) => isoDate
  ? new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(isoDate))
  : '—';
const isSubmittedOnTime = (assignment, submittedAt) =>
  assignment?.due_date ? moscowDate(submittedAt) <= assignment.due_date : null;

const todayMoscow = () => moscowDate(new Date().toISOString());
const dateDiffDays = (fromDate, toDate) => {
  if (!fromDate || !toDate) return null;
  const from = new Date(`${fromDate}T12:00:00Z`);
  const to = new Date(`${toDate}T12:00:00Z`);
  return Math.round((to - from) / 86400000);
};
const humanDueDate = dueDate => {
  if (!dueDate) return 'без срока';
  const days = dateDiffDays(todayMoscow(), dueDate);
  if (days < 0) return `просрочено на ${Math.abs(days)} дн.`;
  if (days === 0) return 'сегодня';
  if (days === 1) return 'до завтра';
  if (days <= 7) return `через ${days} дн.`;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
    .format(new Date(`${dueDate}T12:00:00Z`));
};
const dueDateAfter = days => {
  const date = new Date(`${todayMoscow()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const averageNumber = values => {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};

const submissionPercent = (submission, assignment) => {
  if (submission?.score === null || submission?.score === undefined) return null;
  const maxScore = Number(submission.max_score)
    || (Array.isArray(assignment?.task_config)
      ? assignment.task_config.reduce((sum, value) => sum + Number(value || 0), 0)
      : 0);
  if (maxScore > 0) return Number(submission.score) / maxScore * 100;
  return Number(submission.score);
};

function buildStudentMetrics(submissions, assignmentMap) {
  const relevant = submissions.filter(row => row.status !== 'cancelled');
  const completed = relevant.filter(row => ['submitted', 'checked'].includes(row.status));
  const overdue = relevant.filter(row => {
    const assignment = assignmentMap.get(row.assignment_id);
    return ['assigned', 'revision'].includes(row.status)
      && assignment?.due_date
      && assignment.due_date < todayMoscow();
  });
  const scored = relevant
    .filter(row => row.status === 'checked')
    .sort((left, right) => String(right.checked_at || '').localeCompare(String(left.checked_at || '')))
    .map(row => ({
      percent: submissionPercent(row, assignmentMap.get(row.assignment_id)),
      assignment: assignmentMap.get(row.assignment_id),
      score: Number(row.score),
      maxScore: Number(row.max_score),
    }))
    .filter(item => Number.isFinite(item.percent));
  const recent = scored.slice(0, 3).map(item => item.percent);
  const previous = scored.slice(3, 6).map(item => item.percent);
  const trend = recent.length >= 2 && previous.length >= 2
    ? Math.round(averageNumber(recent) - averageNumber(previous))
    : null;
  const lastTrial = scored.find(item => item.assignment?.hw_type === 'trial') || null;

  let attention = 'всё стабильно — ничего менять не нужно.';
  if (overdue.length >= 2) {
    attention = `не сдано ${overdue.length} ДЗ — напомнить ученику и обсудить регулярность.`;
  } else if (scored.length >= 2 && scored.slice(0, 2).every(item => item.percent < 50)) {
    attention = 'два последних результата ниже 50% — повторить текущую тему на занятии.';
  } else if (trend !== null && trend <= -10) {
    attention = `результат снизился на ${Math.abs(trend)} п.п. — разобрать причины на ближайшем занятии.`;
  } else if (overdue.length === 1) {
    attention = 'одно ДЗ просрочено — напомнить ученику.';
  }

  return {
    total: relevant.length,
    completed: completed.length,
    overdue: overdue.length,
    recentAverage: recent.length ? Math.round(averageNumber(recent)) : null,
    trend,
    lastTrialPercent: lastTrial ? Math.round(lastTrial.percent) : null,
    lastTrialScore: lastTrial && Number.isFinite(lastTrial.score) ? lastTrial.score : null,
    lastTrialMaxScore: lastTrial && Number.isFinite(lastTrial.maxScore) && lastTrial.maxScore > 0
      ? lastTrial.maxScore
      : null,
    attention,
    needsAttention: attention !== 'всё стабильно — ничего менять не нужно.',
  };
}

const deadlineKeyboard = (prefix = 'hw_due') => kbd([
  [{ text: 'завтра', callback_data: `${prefix}:1` }, { text: 'через 3 дня', callback_data: `${prefix}:3` }],
  [{ text: 'через неделю', callback_data: `${prefix}:7` }, { text: 'без срока', callback_data: `${prefix}:none` }],
  [{ text: '❌ отменить создание', callback_data: 'hw_cancel' }],
]);

async function showHomeworkTypeSelection(chatId, tid, sess, dueDate) {
  await setSession(tid, { step: 'await_hwtype', data: { ...sess.data, due_date: dueDate } });
  return send(chatId, `дедлайн: <b>${dueDate || 'не указан'}</b>\n\nвыбери тип задания:`,
    kbd([
      [{ text: '🔢 краткий ответ', callback_data: 'hwtype:brief' }],
      [{ text: '📝 подробный — несложное', callback_data: 'hwtype:detailed_easy' }],
      [{ text: '📝 подробный — сложное', callback_data: 'hwtype:detailed_hard' }],
      [{ text: '📋 пробник', callback_data: 'hwtype:trial' }],
      [{ text: '❌ отменить создание', callback_data: 'hw_cancel' }],
    ]));
}

const homeworkTypeLabel = type => type === 'brief' ? 'краткий ответ'
  : type === 'trial' ? 'пробник'
  : type === 'detailed_hard' ? 'подробный — сложное'
  : 'подробный — несложное';

async function showHomeworkPreview(chatId, tid, data) {
  await setSession(tid, { step: 'confirm_hw', data });
  const taskCount = data.hw_type === 'brief'
    ? data.answers?.length || 0
    : data.task_config?.length || 0;
  return send(chatId,
    `проверь ДЗ перед отправкой:\n\n` +
    `группа: <b>${html(data.group_name)}</b>\n` +
    `тема: <b>${html(data.topic)}</b>\n` +
    `дедлайн: <b>${humanDueDate(data.due_date)}</b>\n` +
    `тип: <b>${homeworkTypeLabel(data.hw_type)}</b>\n` +
    `файл: <b>${data.file_id ? 'прикреплён' : 'без файла'}</b>\n` +
    `заданий: <b>${taskCount || 'без разбивки'}</b>`,
    kbd([
      [{ text: '✅ отправить ученикам', callback_data: 'hw_confirm', color: 'positive' }],
      [{ text: '❌ отменить создание', callback_data: 'hw_cancel' }],
    ]));
}

async function requestHomeworkConfig(chatId, tid, data) {
  const step = data.hw_type === 'brief' ? 'await_answers_bulk' : 'await_scores_bulk';
  await setSession(tid, { step, data });
  if (data.hw_type === 'brief') {
    return send(chatId,
      'введи все правильные ответы одной строкой через точку с запятой.\n\nнапример: <code>12; 0,5; -3</code>',
      kbd([[{ text: '❌ отменить создание', callback_data: 'hw_cancel' }]]));
  }
  return send(chatId,
    'введи максимальные баллы за задания одной строкой через точку с запятой.\n\nнапример: <code>1; 1; 2; 2</code>\nили отправь «-», если нужна только итоговая оценка.',
    kbd([[{ text: '❌ отменить создание', callback_data: 'hw_cancel' }]]));
}

async function updateAssignedSubmission(subId, studentId, changes) {
  const updated = await sbPatch(
    'homework_submissions',
    `id=eq.${encodeURIComponent(subId)}` +
      `&student_id=eq.${encodeURIComponent(studentId)}&status=in.(assigned,revision)`,
    changes
  );
  return updated[0] ?? null;
}

const studentInviteLink = token => VK_GROUP_ID
  ? `https://vk.com/write-${VK_GROUP_ID}?ref=${encodeURIComponent(token)}`
  : null;

// ── Reply keyboards (persistent bottom buttons) ───────────────────────────────

const STUDENT_KBD = [
  [{ text: '📚 мои задания' }, { text: '📊 мои результаты' }],
  [{ text: '❓ помощь' }],
];
const OWNER_KBD = [
  [{ text: '👥 группы' }, { text: '🕒 непроверено' }],
  [{ text: '📦 архив дз' }, { text: '❓ помощь' }],
];

const rkbd = (rows) => ({
  keyboard: JSON.stringify({
    one_time: false,
    inline: false,
    buttons: rows.map(row => row.map(button => vkButton(button, false))),
  }),
});

// ── Main handler ──────────────────────────────────────────────────────────────

function attachmentRef(attachment) {
  const object = attachment?.[attachment.type];
  if (!object?.owner_id || !object?.id) return null;
  return `${attachment.type}${object.owner_id}_${object.id}${object.access_key ? `_${object.access_key}` : ''}`;
}

function normalizeVkMessage(update) {
  const message = update?.object?.message;
  if (!message) return null;
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const photo = attachments.find(item => item.type === 'photo');
  const document = attachments.find(item => item.type === 'doc');
  return {
    chat: { id: message.peer_id },
    from: { id: message.from_id },
    text: String(message.text || ''),
    ref: message.ref || update.object?.ref || null,
    photo: photo ? [{ file_id: attachmentRef(photo) }] : null,
    document: document ? {
      file_id: attachmentRef(document),
      url: document.doc?.url || null,
      title: document.doc?.title || null,
      ext: document.doc?.ext || null,
      size: document.doc?.size || null,
    } : null,
  };
}

function normalizeVkCallback(update) {
  const object = update?.object || {};
  let payload = object.payload || {};
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  return {
    id: object.event_id,
    data: payload.cmd || payload.command || '',
    message: { chat: { id: object.peer_id } },
    from: { id: object.user_id },
    peer_id: object.peer_id,
    user_id: object.user_id,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('TutorOS VK bot');

  const update = req.body ?? {};
  await recordVkDiagnostic(update, 'received').catch(error => {
    console.error('VK diagnostic write failed:', error);
  });
  if (VK_GROUP_ID && String(update.group_id) !== String(VK_GROUP_ID)) {
    return res.status(403).send('wrong group');
  }
  if (update.type === 'confirmation') {
    // VK requires this exact value for the configured TutorOS community.
    // Keep it next to the group id so a token belonging to another group
    // cannot accidentally return an unrelated confirmation code.
    if (String(update.group_id) === '240647506') {
      return res.status(200).send('798aee9f');
    }
    if (VK_CONFIRMATION_CODE) return res.status(200).send(VK_CONFIRMATION_CODE);
    return res.status(500).send('VK_CONFIRMATION_CODE is not configured');
  }
  if (VK_CALLBACK_SECRET && update.secret !== VK_CALLBACK_SECRET) {
    return res.status(403).send('wrong secret');
  }

  const message = update.type === 'message_new' ? normalizeVkMessage(update) : null;
  const callback = update.type === 'message_event' ? normalizeVkCallback(update) : null;
  await uiMessageStorage.run({ peers: new Map() }, async () => {
    const chatId = callback?.message?.chat?.id ?? message?.chat?.id;
    if (chatId) await prepareUiPeer(chatId);

    try {
      if (callback?.data) await handleCallback(callback);
      else if (message?.photo || message?.document) await handleMedia(message);
      else if (message) await handleText(message);
      await recordVkDiagnostic(update, 'processed').catch(() => {});
    } catch (err) {
      console.error('VK bot error:', err);
      await recordVkDiagnostic(update, 'error', err?.message || 'unknown error').catch(() => {});
      const vkUserId = callback?.from?.id ?? message?.from?.id;
      if (chatId) {
        const details = isOwner(vkUserId)
          ? `\n\nпричина: <code>${html(err?.message || 'неизвестная ошибка')}</code>`
          : '';
        await send(chatId,
          `⚠️ не удалось выполнить действие из-за временной ошибки. данные не потеряны — попробуй ещё раз.${details}`
        ).catch(() => {});
      }
    } finally {
      await persistUiMessages();
    }
  });
  return res.status(200).send('ok');
}

// ── Text handler ──────────────────────────────────────────────────────────────

async function handleText(msg) {
  const chatId = msg.chat.id;
  const tid    = msg.from.id;
  const text   = String(msg.text || '').trim();

  const owner   = isOwner(tid);
  const student = owner ? null : await sbOne('students', `vk_id=eq.${tid}&status=eq.active`);

  if (msg.ref && !owner && !student) {
    return handleRegistration(chatId, tid, msg.ref);
  }

  // ── Menu button shortcuts (checked before slash commands so they always work) ──
  if (text === '📚 мои задания'    && student)  return handleStudentListHw(chatId, student);
  if (text === '📊 мои результаты' && student)  return showStudentStats(chatId, student);
  if (text === '👥 группы'            && owner) return showOwnerGroups(chatId);
  if (text === '➕ создать группу'     && owner) return startGroupCreation(chatId, tid);
  if (text === '➕ добавить ученика'  && owner) return startStudentCreation(chatId, tid);
  if (text === '👤 индивидуальный ученик' && owner) return startIndividualStudentCreation(chatId, tid);
  if (text === '➕ создать дз'         && owner) return startHwCreation(chatId, tid);
  if (text === '🕒 непроверено'        && owner) return showUncheckedSubmissions(chatId, 0);
  if (text === '📋 домашние задания'  && owner) return showOwnerAssignments(chatId, 0);
  if (text === '📦 архив дз'            && owner) return showOwnerAssignments(chatId, 0, true);
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
    if (text === '/newindividual') return startIndividualStudentCreation(chatId, tid);
    if (text === '/newdz')      return startHwCreation(chatId, tid);
    if (text === '/unchecked')  return showUncheckedSubmissions(chatId, 0);
    if (text === '/mydz')       return showOwnerAssignments(chatId, 0);
    if (text === '/archive')    return showOwnerAssignments(chatId, 0, true);
    const sess = await getSession(tid);
    if (text === '/cancel' || text.toLowerCase() === 'отмена') {
      await setSession(tid, { step: 'owner' });
      return send(chatId, 'создание отменено.', rkbd(OWNER_KBD));
    }
    if (sess.step === 'await_student_name') {
      return finishStudentCreation(chatId, tid, text, sess);
    }
    if (sess.step === 'await_individual_name') {
      return finishIndividualStudentCreation(chatId, tid, text, sess);
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
    'как работать с ботом:\n\n' +
    '👥 группы — все мини-группы и индивидуальные ученики. открой нужную группу, чтобы создать для неё ДЗ или управлять учениками.\n\n' +
    '🕒 непроверено — работы учеников, которые ждут проверки.\n\n' +
    '📦 архив дз — завершённые домашние задания и сохранённые результаты.\n\n' +
    'создание ДЗ: «группы» → нужная группа → «создать ДЗ».\n' +
    'новый индивидуальный ученик: «группы» → «создать группу» → «индивидуальный ученик».',
    rkbd(OWNER_KBD));
}

// ── Media handler (photos and documents) ─────────────────────────────────────

async function handleMedia(msg) {
  const chatId = msg.chat.id;
  const tid    = msg.from.id;

  const owner   = isOwner(tid);
  const student = owner ? null : await sbOne('students', `vk_id=eq.${tid}&status=eq.active`);

  const fileId   = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document?.file_id;
  const fileType = msg.photo ? 'photo' : 'document';

  // Owner uploading PDF for HW creation or replacing materials on an existing HW.
  if (owner) {
    const sess = await getSession(tid);
    if (sess.step === 'await_pdf') {
      if (fileType !== 'document' || !fileId) {
        return send(chatId, 'пришли PDF-файл документом.');
      }
      try {
        const assignmentId = sess.data?.assignment_id || botId();
        const durableRef = await persistHomeworkMaterial(msg.document, assignmentId);
        const newData = { ...sess.data, assignment_id: assignmentId, file_id: durableRef };
        await send(chatId, '✅ PDF сохранён в постоянное хранилище.');
        return requestHomeworkConfig(chatId, tid, newData);
      } catch (error) {
        console.error('Homework material persist failed:', error?.message || error);
        return send(chatId, `❌ не удалось сохранить PDF: ${error.message}

отправь файл ещё раз.`);
      }
    }
    if (String(sess.step || '').startsWith('replace_hw_material:')) {
      const hwId = String(sess.step).slice('replace_hw_material:'.length);
      if (fileType !== 'document' || !fileId) {
        return send(chatId, 'пришли новый PDF-файл документом.');
      }
      try {
        const durableRef = await persistHomeworkMaterial(msg.document, hwId);
        await sbPatch('homework_assignments', `id=eq.${encodeURIComponent(hwId)}`, { file_id: durableRef });
        await setSession(tid, { step: 'owner' });
        return send(chatId, '✅ материалы ДЗ заменены и сохранены в постоянное хранилище.',
          kbd([[{ text: '← назад к ДЗ', callback_data: `dz:${hwId}` }]]));
      } catch (error) {
        console.error('Homework material replacement failed:', error?.message || error);
        return send(chatId, `❌ не удалось сохранить PDF: ${error.message}

отправь файл ещё раз.`);
      }
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
             [{ text: '↩️ удалить последний файл', callback_data: `remove_last_file:${subId}` }],
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
  const sm = await sbOne('students', `reg_token=eq.${encodeURIComponent(clean)}&status=eq.active`);

  if (sm) {
    if (sm.vk_id) return send(chatId, 'эта ссылка уже была использована. напиши преподавателю.');
    await sbPatch('students', `id=eq.${sm.id}`, { vk_id: tid });
    await setSession(tid, { step: 'student' });
    return send(chatId,
      `готово! ты подключен как <b>${sm.name}</b>.\n\nесли это не ты, напиши преподавателю.`,
      rkbd(STUDENT_KBD));
  }
  return send(chatId, 'ссылка недействительна. попроси преподавателя создать новую.');
}

// ── Owner: groups and students ───────────────────────────────────────────────

async function showOwnerGroups(chatId, archived = false) {
  const groups = await sbSelect('groups', `active=eq.${archived ? 'false' : 'true'}&order=name.asc`);
  if (!groups.length) {
    return send(chatId, archived ? 'архив групп пуст.' : 'групп пока нет.', kbd(archived
      ? [[{ text: '← к активным группам', callback_data: 'owner_groups' }]]
      : [[{ text: '➕ создать первую группу', callback_data: 'new_group' }]]));
  }

  const buttons = groups.map(group => [{
    text: `${group.group_type === 'individual' ? '👤' : '👥'} ${group.name || 'Без названия'}`,
    callback_data: `owner_group:${group.id}`,
  }]);
  if (archived) {
    buttons.push([{ text: '← к активным группам', callback_data: 'owner_groups' }]);
  } else {
    buttons.push([{ text: '➕ создать группу', callback_data: 'new_group' }]);
    buttons.push([{ text: '➕ добавить ученика в группу', callback_data: 'add_student' }]);
    buttons.push([{ text: '📦 архив групп', callback_data: 'owner_groups_archived' }]);
  }
  return send(chatId, archived ? 'архив групп:' : 'выбери группу или индивидуального ученика:', kbd(buttons));
}

async function showOwnerGroup(chatId, groupId) {
  const [group, students, assignments] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`),
    sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&order=name.asc`),
    sbSelect('homework_assignments',
      `group_id=eq.${encodeURIComponent(groupId)}&archived_at=is.null&select=id,topic,due_date,hw_type,task_config`),
  ]);
  if (!group) return send(chatId, 'группа не найдена.');

  const assignmentIds = assignments.map(assignment => assignment.id);
  const submissions = assignmentIds.length
    ? await sbSelect('homework_submissions',
      `assignment_id=in.(${assignmentIds.join(',')})&select=assignment_id,student_id,status,score,max_score,checked_at,on_time`)
    : [];
  const assignmentMap = new Map(assignments.map(assignment => [assignment.id, assignment]));
  const pending = submissions.filter(row => row.status === 'submitted').length;
  const overdue = submissions.filter(row =>
    ['assigned', 'revision'].includes(row.status) &&
    assignmentMap.get(row.assignment_id)?.due_date &&
    assignmentMap.get(row.assignment_id).due_date < todayMoscow()
  ).length;
  const checkedRatios = submissions
    .filter(row => row.status === 'checked')
    .sort((left, right) => String(right.checked_at || '').localeCompare(String(left.checked_at || '')))
    .slice(0, Math.max(3, students.length * 3))
    .map(row => submissionPercent(row, assignmentMap.get(row.assignment_id)))
    .filter(Number.isFinite);
  const averageScore = averageNumber(checkedRatios);
  const attentionCount = students.filter(student => {
    const metrics = buildStudentMetrics(
      submissions.filter(row => row.student_id === student.id),
      assignmentMap
    );
    return metrics.needsAttention;
  }).length;

  const studentLines = students.length
    ? students.map((student, index) =>
      `${index + 1}. ${student.vk_id ? '✅' : '⏳'} ${html(student.name)}`
    ).join('\n')
    : 'учеников пока нет';
  const isIndividual = group.group_type === 'individual';
  const connected = students.filter(student => student.vk_id).length;
  const summary = [
    `учеников: <b>${students.length}</b> · подключены: <b>${connected}/${students.length}</b>`,
    `активных ДЗ: <b>${assignments.length}</b> · ждут проверки: <b>${pending}</b>`,
    `последние результаты: <b>${averageScore === null ? '—' : `${Math.round(averageScore)}%`}</b>`,
  ];
  if (overdue) summary.push(`🔴 просроченных работ: <b>${overdue}</b>`);
  if (attentionCount) summary.push(`⚠️ требуют внимания: <b>${attentionCount}</b>`);
  const buttons = [[{
    text: '➕ создать ДЗ',
    callback_data: `hw_for_group:${group.id}`,
    color: 'primary',
  }]];
  if (!isIndividual) {
    buttons.push([{ text: '➕ добавить ученика', callback_data: `student_group:${group.id}` }]);
  }
  if (assignments.length) {
    buttons.push([{ text: `📚 активные ДЗ (${assignments.length})`, callback_data: `group_hw:${group.id}:0` }]);
  }
  if (students.length) {
    buttons.push([{
      text: isIndividual ? '👤 ученик и ссылка' : '👥 ученики и ссылки',
      callback_data: `group_students:${group.id}:0`,
    }]);
  }
  buttons.push([group.active
    ? { text: '📦 архивировать группу', callback_data: `group_delete:${group.id}` }
    : { text: '♻️ восстановить группу', callback_data: `group_restore:${group.id}` }
  ]);
  buttons.push([{
    text: group.active ? '← ко всем группам' : '← к архиву групп',
    callback_data: group.active ? 'owner_groups' : 'owner_groups_archived',
  }]);

  return send(chatId,
    `<b>${html(group.name)}</b>\nформат: <b>${isIndividual ? 'индивидуально' : 'мини-группа'}</b>\n` +
    `${summary.join('\n')}\n\n${studentLines}\n\n✅ подключён к боту · ⏳ ждёт подключения`,
    kbd(buttons));
}

async function showGroupStudentsForDeletion(chatId, groupId, offset = 0) {
  const [group, students] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`),
    sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&order=name.asc`),
  ]);
  if (!group) return send(chatId, 'группа не найдена.');
  if (!students.length) return showOwnerGroup(chatId, groupId);

  const pageSize = 6;
  const safeOffset = Math.max(0, Math.min(offset, Math.floor((students.length - 1) / pageSize) * pageSize));
  const page = students.slice(safeOffset, safeOffset + pageSize);
  const buttons = page.map(student => [{
    text: `${student.vk_id ? '✅' : '⏳'} ${student.name || 'Без имени'}`,
    callback_data: `owner_student:${student.id}`,
  }]);
  const navigation = [];
  if (safeOffset > 0) {
    navigation.push({ text: '←', callback_data: `group_students:${group.id}:${safeOffset - pageSize}` });
  }
  if (safeOffset + pageSize < students.length) {
    navigation.push({ text: '→', callback_data: `group_students:${group.id}:${safeOffset + pageSize}` });
  }
  if (navigation.length) buttons.push(navigation);
  buttons.push([{ text: '← назад к группе', callback_data: `owner_group:${group.id}` }]);

  return send(chatId,
    `группа: <b>${html(group.name)}</b>\n\nвыбери ученика, чтобы посмотреть статус и ссылку:`,
    kbd(buttons));
}

async function showOwnerStudent(chatId, studentId) {
  const student = await sbOne('students', `id=eq.${encodeURIComponent(studentId)}`);
  if (!student) return send(chatId, 'ученик не найден.');
  const [group, assignments] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(student.group_id)}&select=id,name,group_type`),
    sbSelect('homework_assignments',
      `group_id=eq.${encodeURIComponent(student.group_id)}&select=id,topic,due_date,hw_type,task_config`),
  ]);
  const assignmentMap = new Map(assignments.map(assignment => [assignment.id, assignment]));
  const submissions = assignments.length
    ? await sbSelect('homework_submissions',
      `student_id=eq.${encodeURIComponent(student.id)}&select=assignment_id,status,score,max_score,checked_at`)
    : [];
  const metrics = buildStudentMetrics(submissions, assignmentMap);
  const inviteLink = !student.vk_id ? studentInviteLink(student.reg_token) : null;
  const connection = student.vk_id
    ? '✅ подключён к боту'
    : `⏳ ждёт подключения\n\nссылка:\n<code>${inviteLink || '—'}</code>\n\nкод:\n<code>${student.reg_token}</code>`;
  const buttons = [];
  if (!student.vk_id && inviteLink) {
    buttons.push([{ text: '🔗 показать ссылку ещё раз', callback_data: `owner_student:${student.id}` }]);
  }
  buttons.push([{
    text: '📦 архивировать ученика',
    callback_data: `student_delete:${student.id}`,
  }]);
  buttons.push([{ text: '← к ученикам', callback_data: `group_students:${student.group_id}:0` }]);
  const trialResult = metrics.lastTrialScore !== null && metrics.lastTrialMaxScore
    ? `${metrics.lastTrialScore}/${metrics.lastTrialMaxScore}`
    : metrics.lastTrialPercent !== null ? `${metrics.lastTrialPercent}%` : 'ещё не проводился';
  const trial = `${trialResult}${student.target_score ? ` · цель ${student.target_score}` : ''}`;
  return send(chatId,
    `<b>${html(student.name)}</b>\nгруппа: <b>${html(group?.name || '—')}</b>\n\n${connection}\n\n` +
    `<b>показатели</b>\n` +
    `выполнение: <b>${metrics.completed}/${metrics.total}</b>\n` +
    `последние 3 ДЗ: <b>${metrics.recentAverage === null ? '—' : `${metrics.recentAverage}%`}</b>\n` +
    `динамика: <b>${metrics.trend === null ? 'мало данных' : `${metrics.trend >= 0 ? '+' : ''}${metrics.trend} п.п.`}</b>\n` +
    `последний пробник: <b>${trial}</b>\n\n` +
    `<b>что делать:</b> ${metrics.attention}`,
    kbd(buttons));
}

async function showGroupAssignments(chatId, groupId, offset = 0) {
  const pageSize = 8;
  const [group, assignments] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&select=id,name`),
    sbSelect('homework_assignments',
      `group_id=eq.${encodeURIComponent(groupId)}&archived_at=is.null` +
      `&order=assigned_at.desc&limit=${pageSize}&offset=${Math.max(0, offset)}`),
  ]);
  if (!group) return send(chatId, 'группа не найдена.');
  if (!assignments.length) return send(chatId, 'в этой группе нет активных ДЗ.', kbd([
    [{ text: '← назад к группе', callback_data: `owner_group:${group.id}` }],
  ]));

  const assignmentIds = assignments.map(assignment => assignment.id);
  const submissions = await sbSelect('homework_submissions',
    `assignment_id=in.(${assignmentIds.join(',')})&select=assignment_id,status`);
  const lines = assignments.map((assignment, index) => {
    const rows = submissions.filter(row => row.assignment_id === assignment.id);
    const submitted = rows.filter(row => ['submitted', 'checked'].includes(row.status)).length;
    const overdue = rows.filter(row => ['assigned', 'revision'].includes(row.status))
      .filter(() => assignment.due_date && assignment.due_date < todayMoscow()).length;
    return `${offset + index + 1}. <b>${html(assignment.topic)}</b> · ${humanDueDate(assignment.due_date)}\n` +
      `   сдали ${submitted}/${rows.length}${overdue ? ` · 🔴 просрочили ${overdue}` : ''}`;
  });
  const buttons = assignments.map(assignment => [{
    text: (assignment.topic || 'Без темы').slice(0, 40),
    callback_data: `dz:${assignment.id}`,
  }]);
  const nav = [];
  if (offset > 0) nav.push({ text: '←', callback_data: `group_hw:${group.id}:${Math.max(0, offset - pageSize)}` });
  if (assignments.length === pageSize) nav.push({ text: '→', callback_data: `group_hw:${group.id}:${offset + pageSize}` });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: '← назад к группе', callback_data: `owner_group:${group.id}` }]);
  return send(chatId,
    `<b>${html(group.name)}</b> · активные ДЗ\n\n${lines.join('\n\n')}`,
    kbd(buttons));
}

async function confirmStudentDeletion(chatId, studentId) {
  const student = await sbOne('students', `id=eq.${encodeURIComponent(studentId)}`);
  if (!student) return send(chatId, 'ученик уже архивирован или не найден.');
  return send(chatId,
    `архивировать ученика <b>${html(student.name)}</b>?\n\nОн исчезнет из активной группы, но все сдачи и результаты сохранятся.`,
    kbd([
      [{ text: '✅ да, в архив', callback_data: `student_delete_ok:${student.id}` }],
      [{ text: '❌ отмена', callback_data: `owner_student:${student.id}` }],
    ]));
}

async function deleteStudent(chatId, studentId) {
  const student = await sbOne('students', `id=eq.${encodeURIComponent(studentId)}`);
  if (!student) return send(chatId, 'ученик уже архивирован или не найден.');
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(student.group_id)}`);

  await sbPatch('students', `id=eq.${encodeURIComponent(student.id)}`, {
    status: 'left',
    updated_at: new Date().toISOString(),
  });
  await sbPatch('homework_submissions',
    `student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,revision)`,
    { status: 'cancelled' });
  if (student.vk_id) {
    await sbDelete('vk_sessions', `vk_user_id=eq.${encodeURIComponent(student.vk_id)}`).catch(() => {});
  }

  if (group?.group_type === 'individual') {
    await sbPatch('groups', `id=eq.${encodeURIComponent(group.id)}`, {
      active: false,
      updated_at: new Date().toISOString(),
    });
    return send(chatId, `✅ ${html(student.name)} и его индивидуальная группа архивированы.`, kbd([
      [{ text: '← ко всем группам', callback_data: 'owner_groups' }],
    ]));
  }

  return send(chatId, `✅ ученик ${html(student.name)} архивирован. История сохранена.`, kbd([
    [{ text: '← назад к группе', callback_data: `owner_group:${student.group_id}` }],
  ]));
}

async function confirmGroupDeletion(chatId, groupId) {
  const [group, students] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`),
    sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&order=name.asc`),
  ]);
  if (!group) return send(chatId, 'группа уже архивирована или не найдена.');
  return send(chatId,
    `архивировать группу <b>${html(group.name)}</b>?\n\n${students.length} ученик(ов) исчезнут из активных списков, но вся история и результаты сохранятся.`,
    kbd([
      [{ text: '✅ да, в архив', callback_data: `group_delete_ok:${group.id}` }],
      [{ text: '❌ отмена', callback_data: `owner_group:${group.id}` }],
    ]));
}

async function deleteGroup(chatId, groupId) {
  const [group, students, assignments] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`),
    sbSelect('students', `group_id=eq.${encodeURIComponent(groupId)}&status=eq.active&order=name.asc`),
    sbSelect('homework_assignments',
      `group_id=eq.${encodeURIComponent(groupId)}&archived_at=is.null&select=id`),
  ]);
  if (!group) return send(chatId, 'группа уже архивирована или не найдена.');

  await sbPatch('groups', `id=eq.${encodeURIComponent(group.id)}`, {
    active: false,
    updated_at: new Date().toISOString(),
  });
  await Promise.all(assignments.map(assignment =>
    sbRpc('set_homework_archived', { p_assignment_id: assignment.id, p_archived: true })
  ));
  return send(chatId,
    `✅ группа ${html(group.name)} архивирована. Ученики и результаты сохранены.`,
    kbd([[{ text: '← ко всем группам', callback_data: 'owner_groups' }]]));
}

async function restoreGroup(chatId, groupId) {
  const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`);
  if (!group) return send(chatId, 'группа не найдена.');
  await sbPatch('groups', `id=eq.${encodeURIComponent(group.id)}`, {
    active: true,
    updated_at: new Date().toISOString(),
  });
  if (group.group_type === 'individual') {
    await sbPatch('students', `group_id=eq.${encodeURIComponent(group.id)}&status=eq.left`, {
      status: 'active',
      updated_at: new Date().toISOString(),
    });
  }
  return send(chatId,
    `✅ группа ${html(group.name)} восстановлена. Старые ДЗ остались в архиве.`,
    kbd([[{ text: 'открыть группу', callback_data: `owner_group:${group.id}` }]]));
}

async function startGroupCreation(chatId, tid) {
  await setSession(tid, { step: 'await_group_name' });
  return send(chatId, 'введи название группы, например «Базовая А1» или «Продвинутая Б1»:');
}

function showGroupCreationMenu(chatId) {
  return send(chatId, 'что создать?', kbd([
    [{ text: '👥 мини-группу', callback_data: 'new_mini_group' }],
    [{ text: '👤 индивидуального ученика', callback_data: 'new_individual' }],
    [{ text: '← ко всем группам', callback_data: 'owner_groups' }],
  ]));
}

async function finishGroupCreation(chatId, tid, rawName, sess) {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 80) {
    return send(chatId, 'введи название группы длиной от 2 до 80 символов:');
  }

  const sameName = await sbOne('groups',
    `name=eq.${encodeURIComponent(name)}&active=eq.true`);
  if (sameName) {
    return send(chatId, 'активная группа с таким названием уже существует. введи другое название:');
  }

  const groupId = botId();
  try {
    await sbInsert('groups', {
      id: groupId,
      name,
      group_type: 'mini_group',
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
  return send(chatId,
    `✅ группа <b>${html(name)}</b> создана.\n\nуроки будут добавляться по факту при создании ДЗ.`,
    kbd([
      [{ text: '➕ добавить ученика', callback_data: `student_group:${groupId}` }],
      [{ text: '← ко всем группам', callback_data: 'owner_groups' }],
    ]));
}

async function startStudentCreation(chatId, tid) {
  const groups = await sbSelect('groups', 'active=eq.true&group_type=eq.mini_group&order=name.asc');
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
  if (group.group_type === 'individual') {
    await setSession(tid, { step: 'owner' });
    return send(chatId, 'в персональную группу нельзя добавить второго ученика.');
  }

  const inserted = await sbInsert('students', {
    id: botId(),
    name,
    group_id: groupId,
    status: 'active',
    created_at: new Date().toISOString(),
  });
  const student = inserted?.[0];
  const token = student?.reg_token;
  const inviteLink = token ? studentInviteLink(token) : null;

  await setSession(tid, { step: 'owner' });

  const inviteText = inviteLink
    ? `\n\nперешли ученику ссылку:\n<code>${inviteLink}</code>` +
      `\n\nесли VK не подключит автоматически, пусть пришлёт боту код:\n<code>${token}</code>`
    : token
      ? `\n\nрегистрационный код: <code>${token}</code>`
      : '\n\nне удалось получить ссылку. открой группу и повтори попытку.';

  return send(chatId,
    `✅ <b>${html(name)}</b> добавлен в группу «${html(group.name)}».${inviteText}`,
    rkbd(OWNER_KBD));
}

async function startIndividualStudentCreation(chatId, tid) {
  await setSession(tid, { step: 'await_individual_name' });
  return send(chatId, 'введи имя индивидуального ученика:');
}

async function finishIndividualStudentCreation(chatId, tid, rawName, sess) {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 80) {
    return send(chatId, 'введи имя ученика длиной от 2 до 80 символов:');
  }

  const groupName = `Индивидуально · ${name}`;
  const sameName = await sbOne('groups',
    `name=eq.${encodeURIComponent(groupName)}&active=eq.true`);
  if (sameName) {
    return send(chatId, 'индивидуальный ученик с таким именем уже существует. уточни имя:');
  }

  const groupId = botId();
  const studentId = botId();
  const now = new Date().toISOString();
  let student;
  try {
    await sbInsert('groups', {
      id: groupId,
      name: groupName,
      group_type: 'individual',
      sheet_key: null,
      active: true,
      created_at: now,
      updated_at: now,
    });
    const inserted = await sbInsert('students', {
      id: studentId,
      name,
      group_id: groupId,
      status: 'active',
      created_at: now,
    });
    student = inserted?.[0];
  } catch (error) {
    await sbDelete('groups', `id=eq.${encodeURIComponent(groupId)}`).catch(() => {});
    await setSession(tid, { step: 'owner' });
    return send(chatId, `❌ не удалось добавить ученика:\n<code>${html(error.message)}</code>`);
  }

  const token = student?.reg_token;
  const inviteLink = token ? studentInviteLink(token) : null;
  const inviteText = inviteLink
    ? `\n\nперешли ученику ссылку:\n<code>${inviteLink}</code>` +
      `\n\nесли VK не подключит автоматически, пусть пришлёт боту код:\n<code>${token}</code>`
    : token
      ? `\n\nрегистрационный код: <code>${token}</code>`
      : '\n\nне удалось получить ссылку. открой ученика в списке и повтори попытку.';
  await setSession(tid, { step: 'owner' });
  return send(chatId,
    `✅ индивидуальный ученик <b>${html(name)}</b> добавлен.${inviteText}`,
    rkbd(OWNER_KBD));
}

// ── Student: list HW ──────────────────────────────────────────────────────────

async function handleStudentListHw(chatId, student) {
  const subs = await sbSelect('homework_submissions',
    `student_id=eq.${student.id}&status=in.(assigned,revision)`);
  if (!subs.length) return send(chatId, 'все задания сданы, молодец:)');

  const aIds      = [...new Set(subs.map(s => s.assignment_id))];
  const assignments = await sbSelect('homework_assignments',
    `id=in.(${aIds.join(',')})&select=id,topic,due_date,hw_type`);
  const aMap = Object.fromEntries(assignments.map(a => [a.id, a]));

  const buttons = [];
  const lines   = [];
  const pending = subs
    .map(sub => ({ sub, assignment: aMap[sub.assignment_id] }))
    .filter(item => item.assignment)
    .sort((left, right) => {
      const leftDue = left.assignment.due_date || '9999-12-31';
      const rightDue = right.assignment.due_date || '9999-12-31';
      return leftDue.localeCompare(rightDue);
    });
  pending.forEach(({ sub, assignment: a }, i) => {
    const dueLabel = humanDueDate(a.due_date);
    const overdue = a.due_date && a.due_date < todayMoscow();
    const due = ` · ${overdue ? '🔴 ' : ''}${dueLabel}`;
    const type   = a.hw_type === 'brief' ? ' [краткий]' : a.hw_type === 'trial' ? ' [пробник]' : '';
    const revision = sub.status === 'revision' ? ' · 🔁 доработка' : '';
    lines.push(`${i + 1}. <b>${a.topic || 'без темы'}</b>${type}${revision}${due}`);
    buttons.push([{
      text: `${overdue ? '🔴' : sub.status === 'revision' ? '🔁' : '📚'} ${(a.topic || 'домашки').slice(0, 28)} · ${dueLabel}`,
      callback_data: `hw:${sub.id}`,
    }]);
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
  const rawSubs = await sbSelect('homework_submissions',
    `student_id=eq.${student.id}&order=submitted_at.desc.nullsfirst`);
  const allSubs = rawSubs.filter(s => s.status !== 'cancelled');

  const done = allSubs.filter(s => ['submitted', 'checked'].includes(s.status));
  const aIds = allSubs.length ? [...new Set(allSubs.map(s => s.assignment_id))] : [];
  const assignments = aIds.length
    ? await sbSelect('homework_assignments', `id=in.(${aIds.join(',')})&select=id,topic,due_date,hw_type,task_config`)
    : [];
  const aMap = Object.fromEntries(assignments.map(a => [a.id, a]));
  const assignmentMap = new Map(assignments.map(assignment => [assignment.id, assignment]));
  const metrics = buildStudentMetrics(allSubs, assignmentMap);
  const trial = metrics.lastTrialScore !== null && metrics.lastTrialMaxScore
    ? `${metrics.lastTrialScore}/${metrics.lastTrialMaxScore}`
    : metrics.lastTrialPercent !== null ? `${metrics.lastTrialPercent}%` : 'ещё не проводился';
  const target = student.target_score ? ` · цель ${student.target_score}` : '';
  const header = `📊 <b>мои результаты</b> · ${student.name}\n\n` +
    `выполнение: <b>${metrics.completed}/${metrics.total}</b>\n` +
    `последние 3 ДЗ: <b>${metrics.recentAverage === null ? '—' : `${metrics.recentAverage}%`}</b>\n` +
    `динамика: <b>${metrics.trend === null ? 'мало данных' : `${metrics.trend >= 0 ? '+' : ''}${metrics.trend} п.п.`}</b>\n` +
    `последний пробник: <b>${trial}${target}</b>\n\n` +
    `<b>что делать:</b> ${metrics.attention}`;

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
    return showBriefReviewPage(chatId, student.vk_id, subId, correct, given);
  }

  // Otherwise move to next question
  const nextCurrent = current + 1;
  return showBriefAnswerStep(chatId, student.vk_id, subId, correct, given, nextCurrent);
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
  const sub = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,revision)`);
  if (!sub) {
    await setSession(student.vk_id, { step: 'student' });
    return send(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.');
  }
  const assignment = sub
    ? await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`)
    : null;
  if (!assignment) return send(chatId, 'задание не найдено. сообщи преподавателю.');
  const results    = correct.map((c, i) => given[i]?.toLowerCase().trim() === c.toLowerCase().trim());
  const numCorrect = results.filter(Boolean).length;
  const score      = numCorrect;
  const maxScore   = correct.length;

  const updated = await updateAssignedSubmission(subId, student.id, {
    status: 'checked', submitted_at: now, checked_at: now,
    score, max_score: maxScore,
    comment: `${numCorrect}/${correct.length} верно`,
    student_answers: given, task_scores: results.map(ok => ok ? 1 : 0), source: 'vk',
    on_time: isSubmittedOnTime(assignment, now),
  });
  if (!updated) {
    await setSession(student.vk_id, { step: 'student' });
    return send(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.');
  }
  await setSession(student.vk_id, { step: 'student' });
  if (assignment) {
    await notifyOwnerSubmission(subId, assignment, student, {
      score,
      maxScore,
      submittedAt: now,
    });
  }

  const feedback = results.map((ok, i) => `${i + 1}. ${ok ? '✅' : `❌ (верно: ${correct[i]})`}\n   ты: <code>${given[i] || 'не ответил'}</code>`).join('\n');
  return send(chatId, `результат: <b>${numCorrect}/${correct.length}</b>\n\n${feedback}`);
}

async function handleStudentAnswer(chatId, student, subId, text, sess) {
  const sub = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,revision)`);
  if (!sub) {
    await setSession(student.vk_id, { step: 'student' });
    return send(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.');
  }

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

    const updated = await updateAssignedSubmission(subId, student.id, {
      status: 'checked', submitted_at: now, checked_at: now,
      score, max_score: maxScore,
      comment: `${numCorrect}/${correct.length} верно`,
      student_answers: given, task_scores: results.map(ok => ok ? 1 : 0), source: 'vk',
      on_time: isSubmittedOnTime(assignment, now),
    });
    if (!updated) {
      await setSession(student.vk_id, { step: 'student' });
      return send(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.');
    }
    await setSession(student.vk_id, { step: 'student' });
    await notifyOwnerSubmission(subId, assignment, student, {
      score,
      maxScore,
      submittedAt: now,
    });
    return send(chatId,
      `результат: <b>${numCorrect}/${correct.length}</b> (${score}%)\n\n${feedback}`);
  }

  // Single correct_answer (legacy)
  const correct   = (assignment.correct_answer ?? '').trim();
  const isCorrect = correct !== '' && text.trim() === correct;
  const updated = await updateAssignedSubmission(subId, student.id, {
    status: 'checked', submitted_at: now, checked_at: now,
    score: isCorrect ? 100 : 0, max_score: 100,
    comment: isCorrect ? 'верно!' : `неверно. правильный ответ: ${correct || 'не указан'}`,
    task_scores: [isCorrect ? 1 : 0], source: 'vk',
    on_time: isSubmittedOnTime(assignment, now),
  });
  if (!updated) {
    await setSession(student.vk_id, { step: 'student' });
    return send(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.');
  }
  if (student.vk_id) await setSession(student.vk_id, { step: 'student' });
  await notifyOwnerSubmission(subId, assignment, student, {
    score: isCorrect ? 100 : 0,
    maxScore: 100,
    submittedAt: now,
  });
  return send(chatId, isCorrect ? `✅ верно! молодец, <b>${student.name}</b>!`
    : `❌ неверно:(\nправильный ответ: <b>${correct || 'не указан'}</b>`);
}

// ── Student: finalize file submission ─────────────────────────────────────────

async function finalizeStudentFiles(chatId, student, subId, files) {
  const sub = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,revision)`);
  if (!sub) {
    await setSession(student.vk_id, { step: 'student' });
    return send(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.');
  }

  const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);

  const submittedAt = new Date().toISOString();
  const updated = await updateAssignedSubmission(subId, student.id, {
    status:          'submitted',
    submitted_at:    submittedAt,
    submitted_files: files,
    source:          'vk',
    on_time:          isSubmittedOnTime(assignment, submittedAt),
  });
  if (!updated) {
    await setSession(student.vk_id, { step: 'student' });
    return send(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.');
  }
  await setSession(student.vk_id, { step: 'student' });

  if (assignment) await notifyOwnerWithFiles(subId, assignment, student, files, submittedAt);

  return send(chatId,
    `✅ работа отправлена (${files.length} файл(ов))!\nкогда преподаватель проверит её, ты получишь уведомление.`);
}

// ── Owner: start HW creation for a concrete lesson ────────────────────────────

async function startHwCreation(chatId, tid) {
  await setSession(tid, { step: 'owner' });
  return send(chatId,
    'сначала открой группу, для которой нужно создать ДЗ:',
    kbd([[{ text: '👥 открыть группы', callback_data: 'owner_groups' }]]));
}

async function showLessonsForHomework(chatId, tid, groupId, offset = 0) {
  const pageSize = 12;
  const [group, lessons] = await Promise.all([
    sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`),
    sbSelect('lessons',
      `group_id=eq.${encodeURIComponent(groupId)}&active=eq.true&sheet_lesson_key=like.manual:*&order=sequence.desc&limit=${pageSize}&offset=${offset}`),
  ]);
  if (!group) return send(chatId, 'группа не найдена.');

  const nonce = callbackNonce();
  await setSession(tid, {
    step: 'choose_hw_lesson',
    data: {
      nonce,
      group_id: group.id,
      group_name: group.name,
      lesson_ids: lessons.map(lesson => lesson.id),
    },
  });

  const buttons = [[{
    text: '➕ создать новый урок',
    callback_data: `hwn:${nonce}`,
  }], ...lessons.map((lesson, index) => [{
    text: `${lesson.lesson_number || '—'}. ${(lesson.topic || 'Без темы').slice(0, 42)}`,
    callback_data: `hwl:${nonce}:${index}`,
  }])];
  const nav = [];
  if (offset > 0) nav.push({
    text: '← назад',
    callback_data: `hwp:${nonce}:${Math.max(0, offset - pageSize)}`,
  });
  if (lessons.length === pageSize) nav.push({
    text: 'дальше →',
    callback_data: `hwp:${nonce}:${offset + pageSize}`,
  });
  if (nav.length) buttons.push(nav);
  buttons.push([{
    text: '← назад к группе',
    callback_data: `owner_group:${group.id}`,
  }]);

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

  await setSession(tid, {
    step: 'await_date',
    data: {
      group_id: groupId,
      group_name: group.name,
      lesson_id: lessonId,
      lesson_number: String(sequence),
      topic,
      assignment_id: botId(),
      pending_lesson: {
        id: lessonId,
        group_id: groupId,
        sheet_lesson_key: `manual:${lessonId}`,
        lesson_number: String(sequence),
        sequence,
        topic,
        event_type: 'lesson',
        scheduled_date: null,
        active: true,
      },
    },
  });
  return send(chatId,
    `тема: <b>${html(topic)}</b>\n\nвыбери дедлайн или введи дату в формате ДД.ММ.ГГГГ:`,
    deadlineKeyboard());
}

// ── Owner: step-by-step text input ───────────────────────────────────────────

async function handleOwnerStep(chatId, tid, sess, text) {
  if (typeof sess.step === 'string' && sess.step.startsWith('revision_comment:')) {
    const subId = sess.step.slice('revision_comment:'.length);
    if (text.trim().length < 2) return send(chatId, 'напиши коротко, что ученику нужно исправить:');
    return saveRevisionRequest(chatId, tid, subId, text.trim());
  }
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
      return showHomeworkTypeSelection(chatId, tid, sess, dueFmt);
    }

    case 'await_pdf': {
      if (text !== '-') return send(chatId, 'отправь PDF-файл с заданием (или напиши «-» чтобы пропустить):');
      return requestHomeworkConfig(chatId, tid, { ...sess.data, file_id: null });
    }

    case 'await_answers_bulk': {
      const answers = text.split(';').map(value => value.trim()).filter(Boolean);
      if (!answers.length || answers.length > 50) {
        return send(chatId, 'введи от 1 до 50 ответов через точку с запятой.');
      }
      return showHomeworkPreview(chatId, tid, { ...sess.data, answers });
    }

    case 'await_scores_bulk': {
      if (text === '-') {
        return showHomeworkPreview(chatId, tid, { ...sess.data, task_config: null });
      }
      const scores = text.split(';').map(value => Number(value.trim().replace(',', '.')));
      if (!scores.length || scores.length > 50 || scores.some(value => !Number.isFinite(value) || value <= 0)) {
        return send(chatId, 'введи от 1 до 50 положительных чисел через точку с запятой.');
      }
      return showHomeworkPreview(chatId, tid, { ...sess.data, task_config: scores });
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

  const assignmentId = data.assignment_id || botId();
  let students;
  let createdLessonId = null;
  try {
    if (data.pending_lesson) {
      const now = new Date().toISOString();
      await sbInsert('lessons', { ...data.pending_lesson, created_at: now, updated_at: now });
      createdLessonId = data.pending_lesson.id;
      data = { ...data, lesson_id: createdLessonId };
    }
    students = await sbSelect('students',
      `group_id=eq.${encodeURIComponent(data.group_id)}&status=eq.active`);
    if (!students.length) {
      await setSession(tid, { step: 'owner' });
      return send(chatId, '⚠️ в группе нет активных учеников. сначала добавь ученика, затем создай ДЗ.');
    }

    const result = await sbRpc('create_homework_for_group', {
      p_assignment_id: assignmentId,
      p_group_id: data.group_id,
      p_lesson_id: data.lesson_id,
      p_topic: data.topic,
      p_due_date: data.due_date || null,
      p_hw_type: hw_type,
      p_is_advanced: is_advanced,
      p_file_id: data.file_id ?? null,
      p_answers: data.answers ?? null,
      p_task_config: data.task_config ?? null,
    });
    const assignedCount = Number(result?.students_count);
    if (assignedCount !== students.length) {
      throw new Error(`ожидалось учеников: ${students.length}, создано записей: ${assignedCount}`);
    }
  } catch (err) {
    if (createdLessonId) {
      await sbDelete('lessons', `id=eq.${encodeURIComponent(createdLessonId)}`).catch(() => {});
    }
    await setSession(tid, { step: 'owner' });
    return send(chatId,
      `❌ ДЗ не создано и никому не отправлено.\n\n<code>${html(err.message)}</code>`);
  }

  const due = data.due_date ? `\nдедлайн: <b>${data.due_date}</b>` : '';
  const createdSubmissions = await sbSelect('homework_submissions',
    `assignment_id=eq.${encodeURIComponent(assignmentId)}&select=id,student_id`);
  const submissionByStudent = new Map(createdSubmissions.map(row => [row.student_id, row]));
  const notifyText = `📚 новое ДЗ: <b>${html(data.topic)}</b>${due}`;
  const connectedStudents = students.filter(student => student.vk_id);
  const notificationResults = await Promise.all(connectedStudents.map(async student => {
    try {
      const submission = submissionByStudent.get(student.id);
      await send(student.vk_id, notifyText, submission ? kbd([[
        { text: '📚 открыть задание', callback_data: `hw:${submission.id}`, color: 'primary' },
      ]]) : {});
      return { student, sent: true };
    } catch (error) {
      console.error(`Homework notification failed for ${student.id}:`, error);
      return { student, sent: false };
    }
  }));
  const failedNotifications = notificationResults
    .filter(result => !result.sent)
    .map(result => result.student);
  const disconnectedStudents = students.filter(student => !student.vk_id);
  const sentNotifications = notificationResults.length - failedNotifications.length;

  await setSession(tid, { step: 'owner' });

  const typeLabel = hw_type === 'brief' ? 'краткий ответ'
    : hw_type === 'trial' ? 'пробник'
    : is_advanced ? 'подробный (сложный)' : 'подробный (несложный)';

  const extra = hw_type === 'brief' && data.answers
    ? `\nответы: <code>${data.answers.join(', ')}</code>`
    : hw_type !== 'brief' && data.task_config
    ? `\nбаллов за задания: <code>${data.task_config.join(', ')}</code> (сумма: ${data.task_config.reduce((a, b) => a + b, 0)})`
    : '';

  const deliveryLine = `\nзадание выдано: <b>${students.length}/${students.length}</b>` +
    `\nуведомления: <b>${sentNotifications}/${connectedStudents.length}</b>`;
  const disconnectedLine = disconnectedStudents.length
    ? `\n⏳ не подключены к боту: ${disconnectedStudents.map(student => html(student.name)).join(', ')}`
    : '';
  const failedLine = failedNotifications.length
    ? `\n⚠️ уведомление не доставлено: ${failedNotifications.map(student => html(student.name)).join(', ')}`
    : '';

  return send(chatId,
    `✅ дз создано!\nгруппа: <b>${html(data.group_name)}</b>\nурок: <b>${html(data.lesson_number || '—')}</b>\nтема: <b>${html(data.topic)}</b>\n` +
    `тип: <b>${typeLabel}</b>\nдедлайн: <b>${data.due_date || 'не указан'}</b>\n` +
    `учеников: <b>${students.length}</b>${extra}${deliveryLine}${disconnectedLine}${failedLine}`,
    rkbd(OWNER_KBD));
}

// ── Owner: list assignments ───────────────────────────────────────────────────

async function showOwnerAssignments(chatId, offset, archived = false) {
  const assignments = await sbSelect('homework_assignments',
    `${archived ? 'archived_at=not.is.null' : 'archived_at=is.null'}` +
    `&order=assigned_at.desc&limit=10&offset=${offset}`);

  if (!assignments.length) {
    const empty = archived ? 'архив ДЗ пуст.' : 'активные ДЗ не найдены.';
    return send(chatId, offset === 0 ? empty : 'больше ДЗ нет :)', rkbd(OWNER_KBD));
  }

  const typeEmoji = { brief: '🔢', detailed: '📝', trial: '📋' };
  const lines   = assignments.map((a, i) =>
    `${offset + i + 1}. ${typeEmoji[a.hw_type] || '📝'} <b>${a.topic || '—'}</b>${a.due_date ? ` · ${a.due_date}` : ''}`
  );
  const buttons = assignments.map(a => [{ text: (a.topic || '—').slice(0, 40), callback_data: `dz:${a.id}` }]);

  const nav = [];
  const pageCommand = archived ? 'dz_arcpg' : 'dz_pg';
  if (offset > 0) nav.push({ text: '← назад', callback_data: `${pageCommand}:${offset - 10}` });
  if (assignments.length === 10) nav.push({ text: 'ещё →', callback_data: `${pageCommand}:${offset + 10}` });
  if (nav.length) buttons.push(nav);
  buttons.push([{
    text: archived ? '📋 к активным ДЗ' : '📦 открыть архив',
    callback_data: archived ? 'dz_pg:0' : 'dz_arcpg:0',
  }]);

  const title = archived ? 'архив ДЗ' : 'активные домашние задания';
  return send(chatId, `${title}:\n\n${lines.join('\n')}\n\nвыбери для управления:`, kbd(buttons));
}

async function showUncheckedSubmissions(chatId, offset = 0) {
  const pageSize = 8;
  const allSubmissions = await sbSelect('homework_submissions',
    'status=eq.submitted&order=submitted_at.asc&select=id,assignment_id,student_id,submitted_at,on_time');

  if (!allSubmissions.length) {
    return send(chatId, '✅ непроверенных работ нет.', rkbd(OWNER_KBD));
  }

  const safeOffset = Math.max(0, Math.min(offset, Math.floor((allSubmissions.length - 1) / pageSize) * pageSize));
  const submissions = allSubmissions.slice(safeOffset, safeOffset + pageSize);
  const assignmentIds = [...new Set(submissions.map(row => row.assignment_id).filter(Boolean))];
  const studentIds = [...new Set(submissions.map(row => row.student_id).filter(Boolean))];
  const [assignments, students] = await Promise.all([
    assignmentIds.length
      ? sbSelect('homework_assignments', `id=in.(${assignmentIds.join(',')})&select=id,group_id,topic,hw_type`)
      : [],
    studentIds.length
      ? sbSelect('students', `id=in.(${studentIds.join(',')})&select=id,name`)
      : [],
  ]);
  const groupIds = [...new Set(assignments.map(row => row.group_id).filter(Boolean))];
  const groups = groupIds.length
    ? await sbSelect('groups', `id=in.(${groupIds.join(',')})&select=id,name`)
    : [];
  const assignmentMap = new Map(assignments.map(row => [row.id, row]));
  const studentMap = new Map(students.map(row => [row.id, row]));
  const groupMap = new Map(groups.map(row => [row.id, row]));

  const lines = submissions.map((submission, index) => {
    const assignment = assignmentMap.get(submission.assignment_id);
    const student = studentMap.get(submission.student_id);
    const group = groupMap.get(assignment?.group_id);
    const number = safeOffset + index + 1;
    return `${number}. <b>${html(student?.name || 'Неизвестный ученик')}</b> · ${html(group?.name || '—')}\n` +
      `   ${html(assignment?.topic || 'Без темы')} · ${moscowDateTime(submission.submitted_at)}`;
  });
  const buttons = submissions.map((submission, index) => {
    const assignment = assignmentMap.get(submission.assignment_id);
    const student = studentMap.get(submission.student_id);
    const number = safeOffset + index + 1;
    return [{
      text: `${number}. ${(student?.name || 'Ученик').slice(0, 18)} · ${(assignment?.topic || 'Без темы').slice(0, 24)}`,
      callback_data: `review:${submission.id}`,
    }];
  });
  const nav = [];
  if (safeOffset > 0) nav.push({
    text: '← назад', callback_data: `unchecked_pg:${Math.max(0, safeOffset - pageSize)}`,
  });
  if (safeOffset + pageSize < allSubmissions.length) nav.push({
    text: 'дальше →', callback_data: `unchecked_pg:${safeOffset + pageSize}`,
  });
  if (nav.length) buttons.push(nav);

  return send(chatId,
    `🕒 <b>Непроверенные работы: ${allSubmissions.length}</b>\n\n${lines.join('\n\n')}\n\nНажми на работу, чтобы проверить:`,
    kbd(buttons));
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

  const buttons = a.archived_at
    ? [
        [{ text: '📎 материалы', callback_data: `dz_materials:${hwId}` }],
        [{ text: a.file_id ? '♻️ заменить материалы' : '📤 загрузить материалы', callback_data: `dz_material_replace:${hwId}` }],
        [{ text: '♻️ вернуть из архива', callback_data: `dz_restore:${hwId}` }],
        [{ text: '← к архиву', callback_data: 'dz_arcpg:0' }],
      ]
    : [
        [{ text: '📎 материалы', callback_data: `dz_materials:${hwId}` }],
        [{ text: a.file_id ? '♻️ заменить материалы' : '📤 загрузить материалы', callback_data: `dz_material_replace:${hwId}` }],
        [{ text: '✏️ изменить тему', callback_data: `dz_et:${hwId}` },
         { text: '📅 изменить дедлайн', callback_data: `dz_ed:${hwId}` }],
        [{ text: '🔔 напомнить несдавшим', callback_data: `dz_remind:${hwId}` }],
        [{ text: '🔁 повторить ДЗ', callback_data: `dz_repeat:${hwId}` }],
        [{ text: '📦 убрать в архив', callback_data: `dz_arc:${hwId}` }],
        [{ text: '← к списку', callback_data: 'dz_pg:0' }],
      ];

  return send(chatId, `${text}\nстатус: ${a.archived_at ? 'в архиве' : 'активно'}`, kbd(buttons));
}

async function showDzMaterials(chatId, hwId) {
      const assignment = await sbOne('homework_assignments',
        `id=eq.${encodeURIComponent(hwId)}&select=id,topic,file_id,archived_at`);
      if (!assignment) return send(chatId, 'ДЗ не найдено.');

      const back = kbd([[{ text: '← назад к ДЗ', callback_data: `dz:${hwId}` }]]);
      if (!assignment.file_id) {
        return send(chatId, `к ДЗ «${html(assignment.topic || '—')}» материалы не прикреплены.`, back);
      }

      try {
        await sendHomeworkMaterial(chatId, assignment.file_id);
      } catch (error) {
        console.warn('VK homework material send failed:', error?.message || error);
        return send(chatId,
          `⚠️ материал к ДЗ «${html(assignment.topic || '—')}» сохранён в базе, но VK больше не даёт открыть это вложение.`,
          back);
      }

      return send(chatId,
        `📎 материал к ДЗ «${html(assignment.topic || '—')}»`,
        back);
    }

    async function remindMissingStudents(chatId, hwId) {
  const assignment = await sbOne('homework_assignments',
    `id=eq.${encodeURIComponent(hwId)}&archived_at=is.null`);
  if (!assignment) return send(chatId, 'ДЗ не найдено или уже в архиве.');
  const submissions = await sbSelect('homework_submissions',
    `assignment_id=eq.${encodeURIComponent(hwId)}&status=in.(assigned,revision)` +
    `&select=id,student_id,status`);
  if (!submissions.length) return send(chatId, 'все ученики уже сдали это ДЗ.', kbd([
    [{ text: '← назад к ДЗ', callback_data: `dz:${hwId}` }],
  ]));
  const studentIds = [...new Set(submissions.map(row => row.student_id))];
  const students = await sbSelect('students',
    `id=in.(${studentIds.join(',')})&status=eq.active&select=id,name,vk_id`);
  const studentMap = new Map(students.map(student => [student.id, student]));
  const results = await Promise.all(submissions.map(async submission => {
    const student = studentMap.get(submission.student_id);
    if (!student?.vk_id) return { student, sent: false, disconnected: true };
    try {
      const prefix = submission.status === 'revision' ? '🔁 ждём исправленную работу' : '⏰ напоминание о ДЗ';
      await send(student.vk_id,
        `${prefix}: <b>${html(assignment.topic)}</b>\nсрок: <b>${humanDueDate(assignment.due_date)}</b>`,
        kbd([[{ text: '📚 открыть задание', callback_data: `hw:${submission.id}`, color: 'primary' }]])
      );
      return { student, sent: true };
    } catch {
      return { student, sent: false, disconnected: false };
    }
  }));
  const sentCount = results.filter(result => result.sent).length;
  const unavailable = results.filter(result => !result.sent).map(result => result.student?.name).filter(Boolean);
  return send(chatId,
    `🔔 напоминание отправлено: <b>${sentCount}/${submissions.length}</b>` +
    (unavailable.length ? `\nне удалось отправить: ${unavailable.map(html).join(', ')}` : ''),
    kbd([[{ text: '← назад к ДЗ', callback_data: `dz:${hwId}` }]]));
}

async function startHomeworkRepeat(chatId, tid, hwId) {
  const assignment = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(hwId)}`);
  if (!assignment) return send(chatId, 'ДЗ не найдено.');
  const group = await sbOne('groups',
    `id=eq.${encodeURIComponent(assignment.group_id)}&active=eq.true`);
  if (!group) return send(chatId, 'группа не найдена или находится в архиве.');
  await setSession(tid, {
    step: 'repeat_due',
    data: {
      assignment_id: botId(),
      group_id: group.id,
      group_name: group.name,
      lesson_id: assignment.lesson_id,
      lesson_number: '',
      topic: assignment.topic,
      hw_type: assignment.hw_type === 'detailed'
        ? assignment.is_advanced ? 'detailed_hard' : 'detailed_easy'
        : assignment.hw_type,
      file_id: assignment.file_id || null,
      answers: assignment.answers || null,
      task_config: assignment.task_config || null,
    },
  });
  return send(chatId,
    `повторяем ДЗ «<b>${html(assignment.topic)}</b>». выбери новый дедлайн:`,
    deadlineKeyboard('repeat_due'));
}

// ── Callback handler ──────────────────────────────────────────────────────────

async function handleCallback(cq) {
  const chatId = cq.message.chat.id;
  const tid    = cq.from.id;
  const data   = cq.data;
  await cbq(cq.id, '', { user_id: cq.user_id, peer_id: cq.peer_id }).catch(() => {});

  const owner = isOwner(tid);
  const [student, sess] = await Promise.all([
    owner ? Promise.resolve(null) : sbOne('students', `vk_id=eq.${tid}&status=eq.active`),
    getSession(tid),
  ]);

  // Owner: groups and adding students
  if (data === 'owner_groups' && owner) {
    return showOwnerGroups(chatId);
  }
  if (data === 'owner_groups_archived' && owner) {
    return showOwnerGroups(chatId, true);
  }
  if (data === 'new_group' && owner) {
    return showGroupCreationMenu(chatId);
  }
  if (data === 'new_mini_group' && owner) {
    return startGroupCreation(chatId, tid);
  }
  if (data === 'new_individual' && owner) {
    return startIndividualStudentCreation(chatId, tid);
  }
  if (data === 'add_student' && owner) {
    return startStudentCreation(chatId, tid);
  }
  if (data.startsWith('ngp:') && owner) {
    return startGroupCreation(chatId, tid);
  }
  if (data.startsWith('nip:') && owner) {
    return startIndividualStudentCreation(chatId, tid);
  }
  if (data.startsWith('owner_group:') && owner) {
    return showOwnerGroup(chatId, data.slice('owner_group:'.length));
  }
  if (data.startsWith('owner_student:') && owner) {
    return showOwnerStudent(chatId, data.slice('owner_student:'.length));
  }
  if (data.startsWith('group_hw:') && owner) {
    const value = data.slice('group_hw:'.length);
    const separator = value.lastIndexOf(':');
    const groupId = value.slice(0, separator);
    const offset = Number(value.slice(separator + 1)) || 0;
    return showGroupAssignments(chatId, groupId, offset);
  }
  if (data.startsWith('group_students:') && owner) {
    const value = data.slice('group_students:'.length);
    const separator = value.lastIndexOf(':');
    const groupId = value.slice(0, separator);
    const offset = parseInt(value.slice(separator + 1), 10) || 0;
    return showGroupStudentsForDeletion(chatId, groupId, offset);
  }
  if (data.startsWith('student_delete_ok:') && owner) {
    return deleteStudent(chatId, data.slice('student_delete_ok:'.length));
  }
  if (data.startsWith('student_delete:') && owner) {
    return confirmStudentDeletion(chatId, data.slice('student_delete:'.length));
  }
  if (data.startsWith('group_delete_ok:') && owner) {
    return deleteGroup(chatId, data.slice('group_delete_ok:'.length));
  }
  if (data.startsWith('group_delete:') && owner) {
    return confirmGroupDeletion(chatId, data.slice('group_delete:'.length));
  }
  if (data.startsWith('group_restore:') && owner) {
    return restoreGroup(chatId, data.slice('group_restore:'.length));
  }
  if (data.startsWith('student_group:') && owner) {
    const groupId = data.slice('student_group:'.length);
    const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}`);
    if (!group) return send(chatId, 'группа не найдена.');
    if (group.group_type === 'individual') {
      return send(chatId, 'в персональную группу нельзя добавить второго ученика.');
    }
    await setSession(tid, { step: 'await_student_name', data: { group_id: groupId } });
    return send(chatId, `группа: <b>${html(group.name)}</b>\n\nвведи имя ученика:`);
  }
  if (data.startsWith('hw_for_group:') && owner) {
    const groupId = data.slice('hw_for_group:'.length);
    const group = await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true`);
    if (!group) return send(chatId, 'группа не найдена.');
    await setSession(tid, {
      step: 'await_lesson_topic',
      data: { group_id: group.id, group_name: group.name },
    });
    return send(chatId,
      `группа: <b>${html(group.name)}</b>\n\nвведи тему нового ДЗ:`,
      kbd([[{ text: '❌ отменить создание', callback_data: 'hw_cancel' }]]));
  }
  if (data.startsWith('review:') && owner) {
    return startOwnerReview(chatId, tid, data.slice('review:'.length));
  }
  if (data.startsWith('review_revision:') && owner) {
    const subId = data.slice('review_revision:'.length);
    const sub = await sbOne('homework_submissions',
      `id=eq.${encodeURIComponent(subId)}&status=eq.submitted`);
    if (!sub) return send(chatId, 'эта работа уже обработана.');
    await setSession(tid, { step: `revision_comment:${subId}`, data: {} });
    return send(chatId, 'напиши коротко, что ученику нужно исправить:');
  }
  if (data.startsWith('unchecked_pg:') && owner) {
    return showUncheckedSubmissions(chatId, parseInt(data.slice('unchecked_pg:'.length), 10) || 0);
  }

  // /mydz navigation and management
  if (data.startsWith('dz_pg:') && owner) {
    return showOwnerAssignments(chatId, parseInt(data.slice(6), 10) || 0);
  }
  if (data.startsWith('dz_arcpg:') && owner) {
    return showOwnerAssignments(chatId, parseInt(data.slice('dz_arcpg:'.length), 10) || 0, true);
  }
  if (data.startsWith('dz_material_replace:') && owner) {
    const hwId = data.slice('dz_material_replace:'.length);
    const assignment = await sbOne('homework_assignments', `id=eq.${encodeURIComponent(hwId)}&select=id,topic`);
    if (!assignment) return send(chatId, 'ДЗ не найдено.');
    await setSession(tid, { step: `replace_hw_material:${hwId}`, data: { hwId } });
    return send(chatId, `пришли новый PDF для ДЗ «${html(assignment.topic || '—')}».\n\nОн будет сохранён независимо от VK.`,
      kbd([[{ text: '❌ отменить', callback_data: `dz:${hwId}` }]]));
  }
  if (data.startsWith('dz_materials:') && owner) {
    return showDzMaterials(chatId, data.slice('dz_materials:'.length));
  }
  if (data.startsWith('dz:') && owner) {
    return showDzDetail(chatId, data.slice(3));
  }
  if (data.startsWith('dz_remind:') && owner) {
    return remindMissingStudents(chatId, data.slice('dz_remind:'.length));
  }
  if (data.startsWith('dz_repeat:') && owner) {
    return startHomeworkRepeat(chatId, tid, data.slice('dz_repeat:'.length));
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
  if ((data.startsWith('dz_arc:') || data.startsWith('dz_del:')) && owner) {
    const hwId = data.slice(data.indexOf(':') + 1);
    const a    = await sbOne('homework_assignments', `id=eq.${hwId}&select=topic`);
    return send(chatId, `убрать ДЗ «<b>${a?.topic || hwId}</b>» в архив?\n\nОно исчезнет у учеников, но результаты и файлы сохранятся.`,
      kbd([[{ text: '✅ да, в архив', callback_data: `dz_arcok:${hwId}` },
             { text: '❌ отмена',     callback_data: `dz:${hwId}` }]]));
  }
  if ((data.startsWith('dz_arcok:') || data.startsWith('dz_delok:')) && owner) {
    const hwId = data.slice(data.indexOf(':') + 1);
    await sbRpc('set_homework_archived', { p_assignment_id: hwId, p_archived: true });
    await setSession(tid, { step: 'owner' });
    return send(chatId, '✅ ДЗ убрано в архив. Результаты и файлы сохранены.', rkbd(OWNER_KBD));
  }
  if (data.startsWith('dz_restore:') && owner) {
    const hwId = data.slice('dz_restore:'.length);
    await sbRpc('set_homework_archived', { p_assignment_id: hwId, p_archived: false });
    await setSession(tid, { step: 'owner' });
    return send(chatId, '✅ ДЗ снова активно и вернулось ученикам.', rkbd(OWNER_KBD));
  }

  // Unlink
  if (data === 'unlink:confirm' && student) {
    if (student) await sbPatch('students', `id=eq.${student.id}`, { vk_id: null });
    await setSession(tid, {});
    return send(chatId, 'аккаунт отвязан. попроси преподавателя прислать новую ссылку.');
  }
  if (data === 'unlink:cancel') return send(chatId, 'отмена.');

  // Select group and lesson for a homework assignment
  if (data.startsWith('hwg:') && owner) {
    const [, nonce, rawIndex] = data.split(':');
    const groupId = sess.step === 'choose_hw_group' && sess.data?.nonce === nonce
      ? sess.data.group_ids?.[Number(rawIndex)]
      : null;
    if (!groupId) return send(chatId, 'список групп устарел. нажми «➕ создать дз» ещё раз.');
    return showLessonsForHomework(chatId, tid, groupId, 0);
  }
  if (data.startsWith('hwp:') && owner) {
    const [, nonce, rawOffset] = data.split(':');
    const groupId = sess.step === 'choose_hw_lesson' && sess.data?.nonce === nonce
      ? sess.data.group_id
      : null;
    if (!groupId) return send(chatId, 'список уроков устарел. начни создание ДЗ ещё раз.');
    return showLessonsForHomework(chatId, tid, groupId, Number(rawOffset) || 0);
  }
  if (data.startsWith('hwn:') && owner) {
    const nonce = data.slice('hwn:'.length);
    const groupId = sess.step === 'choose_hw_lesson' && sess.data?.nonce === nonce
      ? sess.data.group_id
      : null;
    const group = groupId
      ? await sbOne('groups', `id=eq.${encodeURIComponent(groupId)}&active=eq.true`)
      : null;
    if (!group) return send(chatId, 'список уроков устарел. начни создание ДЗ ещё раз.');
    await setSession(tid, {
      step: 'await_lesson_topic',
      data: { group_id: group.id, group_name: group.name },
    });
    return send(chatId,
      `группа: <b>${html(group.name)}</b>\n\nвведи фактическую тему урока:`);
  }
  if (data.startsWith('hwl:') && owner) {
    const [, nonce, rawIndex] = data.split(':');
    const lessonId = sess.step === 'choose_hw_lesson' && sess.data?.nonce === nonce
      ? sess.data.lesson_ids?.[Number(rawIndex)]
      : null;
    const lesson = lessonId
      ? await sbOne('lessons', `id=eq.${encodeURIComponent(lessonId)}`)
      : null;
    if (!lesson) return send(chatId, 'список уроков устарел. начни создание ДЗ ещё раз.');
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
        assignment_id: botId(),
      },
    });
    return send(chatId,
      `урок: <b>${html(lesson.lesson_number || '—')}. ${html(lesson.topic)}</b>\n\nвыбери дедлайн или введи дату в формате ДД.ММ.ГГГГ:`,
      deadlineKeyboard());
  }

  // Compatibility with buttons sent by the previous version.
  if (data.startsWith('hw_group:') && owner) {
    return showLessonsForHomework(chatId, tid, data.slice('hw_group:'.length), 0);
  }
  if (data.startsWith('hw_lessons:') && owner) {
    const value = data.slice('hw_lessons:'.length);
    const separator = value.lastIndexOf(':');
    const groupId = value.slice(0, separator);
    const offset = parseInt(value.slice(separator + 1), 10) || 0;
    return showLessonsForHomework(chatId, tid, groupId, offset);
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
        assignment_id: botId(),
      },
    });
    return send(chatId,
      `урок: <b>${html(lesson.lesson_number || '—')}. ${html(lesson.topic)}</b>\n\nвыбери дедлайн или введи дату в формате ДД.ММ.ГГГГ:`,
      deadlineKeyboard());
  }

  if (data.startsWith('hw_due:') && owner && sess.step === 'await_date') {
    const value = data.slice('hw_due:'.length);
    const dueDate = value === 'none' ? '' : dueDateAfter(Number(value));
    if (value !== 'none' && !['1', '3', '7'].includes(value)) {
      return send(chatId, 'эта кнопка дедлайна устарела. введи дату вручную.');
    }
    return showHomeworkTypeSelection(chatId, tid, sess, dueDate);
  }
  if (data.startsWith('repeat_due:') && owner && sess.step === 'repeat_due') {
    const value = data.slice('repeat_due:'.length);
    if (value !== 'none' && !['1', '3', '7'].includes(value)) {
      return send(chatId, 'эта кнопка дедлайна устарела. повтори действие.');
    }
    const dueDate = value === 'none' ? '' : dueDateAfter(Number(value));
    return showHomeworkPreview(chatId, tid, { ...sess.data, due_date: dueDate });
  }

  // Owner: HW type selection
  if (data.startsWith('hwtype:') && owner && sess.step === 'await_hwtype') {
    const hwType = data.slice(7);
    await setSession(tid, { step: 'await_pdf', data: { ...sess.data, hw_type: hwType } });
    return send(chatId, 'отправь PDF-файл с заданием или нажми «без файла»:', kbd([
      [{ text: 'без файла', callback_data: 'hw_no_file' }],
      [{ text: '❌ отменить создание', callback_data: 'hw_cancel' }],
    ]));
  }
  if (data === 'hw_no_file' && owner && sess.step === 'await_pdf') {
    return requestHomeworkConfig(chatId, tid, { ...sess.data, file_id: null });
  }
  if (data === 'hw_confirm' && owner && sess.step === 'confirm_hw') {
    return finishHwCreation(chatId, tid, sess.data || {});
  }
  if (data === 'hw_cancel' && owner) {
    await setSession(tid, { step: 'owner' });
    return send(chatId, 'создание ДЗ отменено.', rkbd(OWNER_KBD));
  }

  // Student taps HW
  if (data.startsWith('hw:') && student) {
    const subId = data.slice(3);
    const sub   = await sbOne('homework_submissions',
      `id=eq.${subId}&student_id=eq.${student.id}&status=in.(assigned,revision)`);
    if (!sub) return send(chatId, 'задание уже сдано или не найдено.');

    const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);
    if (!assignment) return send(chatId, 'задание не найдено.');

    if (assignment.file_id) {
      await sendHomeworkMaterial(chatId, assignment.file_id);
    }

    const desc = assignment.description ? `\n${assignment.description}` : '';
    const revisionNote = sub.status === 'revision' && sub.comment
      ? `\n\n🔁 <b>что исправить:</b>\n${html(sub.comment)}`
      : '';

    if (assignment.hw_type === 'brief') {
      const answers = assignment.answers;
      if (answers && Array.isArray(answers) && answers.length > 0) {
        if (revisionNote) await send(chatId, `<b>${assignment.topic}</b>${revisionNote}`);
        const given = new Array(answers.length).fill('');
        return showBriefAnswerStep(chatId, tid, subId, answers, given, 0);
      }
      await setSession(tid, { step: `await_answer:${subId}` });
      return send(chatId, `<b>${assignment.topic}</b>${desc}${revisionNote}\n\nвведи ответ:`);
    }

    // detailed / trial → collect files from student
    await setSession(tid, { step: `await_files:${subId}`, data: { files: [] } });
    return send(chatId,
      `<b>${assignment.topic}</b>${desc}${revisionNote}\n\nотправь выполненное задание фото или .pdf-файлом.\nможно несколько файлов — нажми «отправить работу», когда пришлёшь всё.`,
      kbd([[{ text: '✅ отправить работу', callback_data: `submit_files:${subId}` }],
           [{ text: '❌ отменить',         callback_data: 'cancel_files' }]]));
  }

  // Student submits collected files
  if (data.startsWith('submit_files:') && student) {
    const subId = data.slice('submit_files:'.length);
    const activeSubmission = await sbOne('homework_submissions',
      `id=eq.${encodeURIComponent(subId)}` +
      `&student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,revision)`);
    if (!activeSubmission) {
      await setSession(tid, { step: 'student' });
      return send(chatId, 'эта работа уже была отправлена. повторно сдавать её не нужно.');
    }
    if (sess.step !== `await_files:${subId}`) {
      return send(chatId, 'эта кнопка устарела. снова открой задание через /dz.');
    }
    const files = sess.data?.files || [];
    if (!files.length) return send(chatId, 'пришли хотя бы один файл с выполненным заданием!');
    return finalizeStudentFiles(chatId, student, subId, files);
  }

  if (data.startsWith('remove_last_file:') && student) {
    const subId = data.slice('remove_last_file:'.length);
    if (sess.step !== `await_files:${subId}`) {
      return send(chatId, 'эта кнопка устарела. снова открой задание.');
    }
    const files = [...(sess.data?.files || [])];
    if (!files.length) return send(chatId, 'пока нет загруженных файлов.');
    files.pop();
    await setSession(tid, { step: `await_files:${subId}`, data: { ...sess.data, files } });
    return send(chatId,
      files.length ? `последний файл удалён. осталось: ${files.length}` : 'последний файл удалён. список пуст.',
      kbd([
        [{ text: '✅ отправить работу', callback_data: `submit_files:${subId}` }],
        ...(files.length ? [[{ text: '↩️ удалить последний файл', callback_data: `remove_last_file:${subId}` }]] : []),
        [{ text: '❌ отменить', callback_data: 'cancel_files' }],
      ]));
  }

  // Student cancels file submission
  if (data === 'cancel_files' && student) {
    await setSession(tid, { step: 'student' });
    return send(chatId, 'сдача отменена. /dz — посмотреть задания.');
  }

  // Brief answer: go back to edit
  if (data.startsWith('brief_back_to_edit:') && student) {
    const subId = data.slice('brief_back_to_edit:'.length);
    if (sess.step !== `brief_review:${subId}`) {
      return send(chatId, 'эта кнопка устарела. снова открой задание через /dz.');
    }
    const { correct, given } = sess.data;
    return showBriefAnswerStep(chatId, tid, subId, correct, given, 0);
  }

  // Brief answer: final submit
  if (data.startsWith('brief_final_submit:') && student) {
    const subId = data.slice('brief_final_submit:'.length);
    if (sess.step !== `brief_review:${subId}`) {
      const activeSubmission = await sbOne('homework_submissions',
        `id=eq.${encodeURIComponent(subId)}` +
        `&student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,revision)`);
      return send(chatId, activeSubmission
        ? 'эта кнопка устарела. снова открой задание через /dz.'
        : 'эта работа уже была отправлена. повторно сдавать её не нужно.');
    }
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
  const sub = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&status=eq.submitted`);
  if (!sub) return send(chatId, 'эта работа уже проверена или больше не находится в очереди.');

  const [assignment, student] = await Promise.all([
    sbOne('homework_assignments', `id=eq.${encodeURIComponent(sub.assignment_id)}`),
    sbOne('students', `id=eq.${encodeURIComponent(sub.student_id)}`),
  ]);
  if (!assignment || !student) return send(chatId, 'не удалось загрузить данные работы.');

  await sendSubmissionFiles(chatId, sub.submitted_files);

  const taskConfig = Array.isArray(assignment.task_config)
    ? assignment.task_config.map(Number).filter(Number.isFinite)
    : [];

  if (taskConfig.length) {
    await setSession(tid, {
      step: `review_task:${subId}`,
      data: { task_config: taskConfig, task_scores: [], current: 0 },
    });
    return send(chatId,
      `<b>${html(student.name)}</b> · ${html(assignment.topic)}\n\nзадание 1 из ${taskConfig.length}: сколько баллов из ${taskConfig[0]}?`,
      kbd([[{ text: '🔁 вернуть на доработку', callback_data: `review_revision:${subId}` }]]));
  }

  await setSession(tid, { step: `review_total:${subId}`, data: {} });
  return send(chatId,
    `<b>${html(student.name)}</b> · ${html(assignment.topic)}\n\nвведи итоговый результат от 0 до 100:`,
    kbd([[{ text: '🔁 вернуть на доработку', callback_data: `review_revision:${subId}` }]]));
}

async function saveRevisionRequest(chatId, tid, subId, comment) {
  const sub = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&status=eq.submitted`);
  if (!sub) return send(chatId, 'эта работа уже обработана.');
  const [assignment, student] = await Promise.all([
    sbOne('homework_assignments', `id=eq.${encodeURIComponent(sub.assignment_id)}`),
    sbOne('students', `id=eq.${encodeURIComponent(sub.student_id)}`),
  ]);
  if (!assignment || !student) return send(chatId, 'не удалось загрузить данные работы.');
  const updated = await sbPatch('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&status=eq.submitted`, {
      status: 'revision',
      comment,
      checked_at: new Date().toISOString(),
    });
  if (!updated.length) return send(chatId, 'эта работа уже обработана.');
  await setSession(tid, { step: 'owner' });
  if (student.vk_id) {
    await send(student.vk_id,
      `🔁 работа «<b>${html(assignment.topic)}</b>» возвращена на доработку.\n\n` +
      `<b>что исправить:</b> ${html(comment)}`,
      kbd([[{ text: '📚 открыть и пересдать', callback_data: `hw:${sub.id}`, color: 'primary' }]])
    ).catch(() => {});
  }
  return send(chatId,
    `🔁 работа <b>${html(student.name)}</b> возвращена на доработку.`,
    kbd([[{ text: '🕒 к непроверенным', callback_data: 'unchecked_pg:0' }]]));
}

async function saveOwnerReview(chatId, tid, subId, comment, review) {
  const sub = await sbOne('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&status=eq.submitted`);
  if (!sub) {
    await setSession(tid, { step: 'owner' });
    return send(chatId, 'эта работа уже проверена или больше не находится в очереди.');
  }
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

  const updated = await sbPatch('homework_submissions',
    `id=eq.${encodeURIComponent(subId)}&status=eq.submitted`, {
    status: 'checked',
    score,
    max_score: maxScore,
    task_scores: taskScores,
    comment,
    checked_at: checkedAt,
  });
  if (!updated.length) {
    await setSession(tid, { step: 'owner' });
    return send(chatId, 'эта работа уже была проверена. повторная оценка не сохранена.');
  }
  await setSession(tid, { step: 'owner' });

  if (student.vk_id) {
    const breakdown = taskScores
      ? `\n\nбаллы по заданиям: ${taskScores.join(', ')}`
      : '';
    const commentText = comment ? `\n\nкомментарий: ${html(comment)}` : '';
    await send(student.vk_id,
      `✅ работа «<b>${html(assignment.topic)}</b>» проверена.\nрезультат: <b>${score}/${maxScore}</b>${breakdown}${commentText}`
    ).catch(() => {});
  }

  return send(chatId,
    `✅ работа <b>${html(student.name)}</b> проверена: <b>${score}/${maxScore}</b>`,
    kbd([[{ text: '🕒 к непроверенным', callback_data: 'unchecked_pg:0' }]]));
}

// ── Notify owner about every submitted homework ───────────────────────────────

async function notifyOwnerSubmission(subId, assignment, student, options = {}) {
  if (!OWNER_VK_ID) return;

  const group = assignment.group_id
    ? await sbOne('groups', `id=eq.${encodeURIComponent(assignment.group_id)}&select=name`)
      .catch(() => null)
    : null;
  const submittedAt = options.submittedAt || new Date().toISOString();
  const onTime = isSubmittedOnTime(assignment, submittedAt);
  const timing = onTime === null ? '' : onTime ? '\nсрок: ✅ вовремя' : '\nсрок: ⚠️ после дедлайна';
  const hasResult = Number.isFinite(Number(options.score))
    && Number.isFinite(Number(options.maxScore));
  const result = hasResult
    ? `\nрезультат автопроверки: <b>${options.score}/${options.maxScore}</b>`
    : '';
  const filesCount = Number(options.filesCount) || 0;
  const filesLine = filesCount ? `\nфайлов: <b>${filesCount}</b>` : '';
  const extra = options.needsReview
    ? kbd([[{ text: '✅ проверить работу', callback_data: `review:${subId}` }]])
    : {};

  await send(OWNER_VK_ID,
    `📥 <b>Сдано ДЗ</b>\nученик: <b>${html(student.name)}</b>` +
    `\nгруппа: <b>${html(group?.name || '—')}</b>` +
    `\nтема: <b>${html(assignment.topic)}</b>${result}${filesLine}${timing}`,
    extra
  ).catch(() => {});
}

async function notifyOwnerWithFiles(subId, assignment, student, files, submittedAt) {
  if (!OWNER_VK_ID) return;
  await notifyOwnerSubmission(subId, assignment, student, {
    submittedAt,
    filesCount: files.length,
    needsReview: true,
  });
}

async function sendSubmissionFiles(chatId, files) {
  for (const file of Array.isArray(files) ? files : []) {
    if (!file?.file_id) continue;
    await sendAttachment(chatId, file.file_id).catch(() => {});
  }
}
