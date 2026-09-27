import vkHandler from './vk-legacy.js';
import { sendVk } from './_lib/channels.js';
import { handleVkStudentCjm } from './_lib/student-vk-cjm.js';
import { relayVkChanges, snapshotVkRelay } from './_lib/vk-relay.js';

const VK_GROUP_ID = process.env.VK_GROUP_ID;
const VK_CALLBACK_SECRET = process.env.VK_CALLBACK_SECRET;
const OWNER_VK_ID = process.env.OWNER_VK_ID;

function validRelayRequest(req) {
  if (req.method !== 'POST') return false;
  const update = req.body || {};
  if (update.type === 'confirmation') return false;
  if (VK_GROUP_ID && String(update.group_id) !== String(VK_GROUP_ID)) return false;
  if (VK_CALLBACK_SECRET && update.secret !== VK_CALLBACK_SECRET) return false;
  return true;
}

function callbackCommand(update) {
  if (update?.type !== 'message_event') return '';
  let payload = update?.object?.payload || {};
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  return String(payload.cmd || payload.command || '');
}

async function blockRevisionAction(update) {
  const userId = update?.object?.user_id;
  const peerId = update?.object?.peer_id;
  const command = callbackCommand(update);
  if (!command.startsWith('review_revision:') || !OWNER_VK_ID || String(userId) !== String(OWNER_VK_ID)) {
    return false;
  }
  if (peerId) {
    await sendVk(peerId,
      'Функция «доработка» убрана. Поставь работе балл и комментарий; если нужно решить заново — создай новое ДЗ.'
    ).catch(() => {});
  }
  return true;
}

function capturedResponse() {
  const state = {
    statusCode: 200,
    body: 'ok',
    isJson: false,
    headers: {},
  };
  const proxy = {
    status(code) {
      state.statusCode = code;
      return proxy;
    },
    send(body) {
      state.body = body;
      state.isJson = false;
      return proxy;
    },
    json(body) {
      state.body = body;
      state.isJson = true;
      return proxy;
    },
    end(body) {
      if (body !== undefined) state.body = body;
      return proxy;
    },
    setHeader(name, value) {
      state.headers[String(name).toLowerCase()] = value;
      return proxy;
    },
    getHeader(name) {
      return state.headers[String(name).toLowerCase()];
    },
  };
  return { state, proxy };
}

export default async function handler(req, res) {
  let before = null;

  if (validRelayRequest(req)) {
    if (await blockRevisionAction(req.body || {})) {
      return res.status(200).send('ok');
    }

    try {
      // Students use the canonical TutorOS CJM. Owner/admin updates deliberately
      // return false and continue into the proven legacy teacher handler below.
      if (await handleVkStudentCjm(req.body || {})) {
        return res.status(200).send('ok');
      }
    } catch (error) {
      // Never let VK retry a student action through the legacy state machine: a
      // retry there could create a second, different journey after a partial write.
      console.error('VK canonical student CJM failed:', error?.message || error);
      return res.status(200).send('ok');
    }

    before = await snapshotVkRelay(req.body || {}).catch(error => {
      console.warn('VK relay snapshot failed:', error?.message || error);
      return null;
    });
  }

  const { state, proxy } = capturedResponse();
  await vkHandler(req, proxy);

  if (before && state.statusCode >= 200 && state.statusCode < 300) {
    await relayVkChanges(before, req.body || {}).catch(error => {
      // The canonical VK action already succeeded. Cross-channel delivery must
      // never turn that success into a VK webhook failure/retry.
      console.error('VK→Telegram relay failed:', error?.message || error);
    });
  }

  for (const [name, value] of Object.entries(state.headers)) {
    res.setHeader(name, value);
  }
  if (state.isJson) return res.status(state.statusCode).json(state.body);
  return res.status(state.statusCode).send(state.body);
}
