import { sendVk } from './_lib/channels.js';
import { handleVkStudentAccount } from './_lib/student-account.js';
import { handleVkNotificationOpen } from './_lib/student-notification-open.js';
import { handleVkStudentFastNav } from './_lib/student-vk-fast-nav.js';
import { handleVkStudentCjm } from './_lib/student-vk-cjm.js';
import { handleVkTeacher } from './_lib/teacher-vk.js';
import { handleVkTeacherPolicy } from './_lib/teacher-policy.js';

const VK_GROUP_ID = process.env.VK_GROUP_ID;
const VK_CALLBACK_SECRET = process.env.VK_CALLBACK_SECRET;
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE
  || (String(VK_GROUP_ID || '') === '240647506' ? '798aee9f' : null);
const OWNER_VK_ID = process.env.OWNER_VK_ID;

function callbackCommand(update) {
  if (update?.type !== 'message_event') return '';
  let payload = update?.object?.payload || {};
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  return String(payload.cmd || payload.command || '');
}

async function blockRemovedLegacyAction(update) {
  const userId = update?.object?.user_id;
  const peerId = update?.object?.peer_id;
  const command = callbackCommand(update);
  if (!command.startsWith('review_revision:') || !OWNER_VK_ID || String(userId) !== String(OWNER_VK_ID)) return false;
  if (peerId) {
    await sendVk(peerId,
      'Функция «доработка» убрана. Поставь работе балл и комментарий; если нужно решить заново — создай новое ДЗ.'
    ).catch(() => {});
  }
  return true;
}

function requestIsForThisGroup(update) {
  return !VK_GROUP_ID || String(update?.group_id || '') === String(VK_GROUP_ID);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const update = req.body || {};

  if (!requestIsForThisGroup(update)) return res.status(403).send('wrong group');

  if (update.type === 'confirmation') {
    if (!VK_CONFIRMATION_CODE) return res.status(503).send('confirmation code not configured');
    return res.status(200).send(VK_CONFIRMATION_CODE);
  }

  if (VK_CALLBACK_SECRET && update.secret !== VK_CALLBACK_SECRET) {
    return res.status(403).send('wrong secret');
  }

  if (await blockRemovedLegacyAction(update)) return res.status(200).send('ok');

  try {
    if (await handleVkStudentAccount(update)) return res.status(200).send('ok');
    if (await handleVkNotificationOpen(update)) return res.status(200).send('ok');
    if (await handleVkStudentFastNav(update)) return res.status(200).send('ok');
    if (await handleVkStudentCjm(update)) return res.status(200).send('ok');
    if (await handleVkTeacherPolicy(update)) return res.status(200).send('ok');
    if (await handleVkTeacher(update)) return res.status(200).send('ok');
  } catch (error) {
    // Callback API retries non-200 responses. Canonical writes are conditional,
    // so log the failure but acknowledge the event to avoid duplicate actions.
    console.error('VK canonical flow failed:', error?.message || error);
    return res.status(200).send('ok');
  }

  // Old keyboards may still exist in chat history. Unknown legacy callbacks are
  // deliberately inert instead of falling through to the retired state machine.
  return res.status(200).send('ok');
}
