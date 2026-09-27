import vkHandler from './bot.js';
import { relayVkChanges, snapshotVkRelay } from './_lib/vk-relay.js';

const VK_GROUP_ID = process.env.VK_GROUP_ID;
const VK_CALLBACK_SECRET = process.env.VK_CALLBACK_SECRET;

function validRelayRequest(req) {
  if (req.method !== 'POST') return false;
  const update = req.body || {};
  if (update.type === 'confirmation') return false;
  if (VK_GROUP_ID && String(update.group_id) !== String(VK_GROUP_ID)) return false;
  if (VK_CALLBACK_SECRET && update.secret !== VK_CALLBACK_SECRET) return false;
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
