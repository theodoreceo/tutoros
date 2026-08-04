import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.VK_GROUP_TOKEN = 'vk-test-token';
process.env.VK_GROUP_ID = '777';
process.env.VK_CALLBACK_SECRET = 'callback-secret';
process.env.VK_API_VERSION = '5.199';
process.env.OWNER_VK_ID = '123';
process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = 'sheet-secret';

const vkCalls = [];
const insertedGroups = [];
const insertedStudents = [];
const studentPatches = [];
const rpcCalls = [];
let sessionState = {};
let registeredStudent = {
  id: 's1', name: 'Иван Иванов', group_id: 'g1', status: 'active',
  reg_token: 'student-token', vk_id: null, created_at: '2026-08-02T08:10:00.000Z',
};

const json = body => Response.json(body);

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  const method = options.method || 'GET';

  if (target.includes('/rest/v1/vk_sessions?')) {
    return json(Object.keys(sessionState).length ? [{ state: sessionState }] : []);
  }
  if (target.endsWith('/rest/v1/vk_sessions') && method === 'POST') {
    sessionState = JSON.parse(options.body).state;
    return json([{ state: sessionState }]);
  }
  if (target.includes('/rest/v1/students?vk_id=eq.')) {
    const requested = target.match(/vk_id=eq\.([^&]+)/)?.[1];
    return json(String(registeredStudent.vk_id) === requested ? [registeredStudent] : []);
  }
  if (target.includes('/rest/v1/students?reg_token=eq.student-token')) {
    return json([registeredStudent]);
  }
  if (target.includes('/rest/v1/students?') && method === 'PATCH') {
    const changes = JSON.parse(options.body);
    studentPatches.push(changes);
    registeredStudent = { ...registeredStudent, ...changes };
    return json([registeredStudent]);
  }
  if (target.includes('/rest/v1/students?') && target.includes('status=eq.assigned')) {
    return json([]);
  }
  if (target.includes('/rest/v1/homework_submissions?')) {
    return json([]);
  }
  if (target.includes('/rest/v1/rpc/set_homework_archived')) {
    const body = JSON.parse(options.body);
    rpcCalls.push(body);
    return json({ assignment_id: body.p_assignment_id, archived: body.p_archived });
  }
  if (target.includes('/rest/v1/groups?name=eq.')) return json([]);
  if (target.includes('/rest/v1/groups?')) {
    return json([{
      id: 'g1', name: 'Базовая А1', group_type: 'mini_group', active: true,
      created_at: '2026-08-02T08:00:00.000Z',
    }]);
  }
  if (target.endsWith('/rest/v1/groups') && method === 'POST') {
    const group = JSON.parse(options.body);
    insertedGroups.push(group);
    return json([group]);
  }
  if (target.endsWith('/rest/v1/students') && method === 'POST') {
    const student = { reg_token: 'new-token', vk_id: null, ...JSON.parse(options.body) };
    insertedStudents.push(student);
    return json([student]);
  }
  if (target.includes('/rest/v1/lessons?')) return json([]);

  if (target.includes('api.vk.com/method/')) {
    const params = Object.fromEntries(new URLSearchParams(String(options.body || '')));
    const apiMethod = target.split('/method/')[1];
    vkCalls.push({ method: apiMethod, ...params });
    return json({ response: apiMethod === 'groups.getCallbackConfirmationCode'
      ? { code: 'confirmation-code' }
      : 1 });
  }

  throw new Error(`Unexpected request: ${method} ${target}`);
};

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

const vkUpdate = (type, object, overrides = {}) => ({
  method: 'POST',
  body: {
    type,
    group_id: 777,
    secret: 'callback-secret',
    object,
    ...overrides,
  },
});

const messageUpdate = (fromId, text, extra = {}) => vkUpdate('message_new', {
  message: {
    peer_id: fromId,
    from_id: fromId,
    text,
    attachments: [],
    ...extra,
  },
});

const { default: botHandler } = await import('../api/bot.js');

const confirmationResponse = responseRecorder();
await botHandler(vkUpdate('confirmation', {}, { secret: undefined }), confirmationResponse);
assert.equal(confirmationResponse.statusCode, 200);
assert.equal(confirmationResponse.body, 'confirmation-code');

const wrongSecretResponse = responseRecorder();
await botHandler(vkUpdate('message_new', {}, { secret: 'wrong' }), wrongSecretResponse);
assert.equal(wrongSecretResponse.statusCode, 403);

const ownerStartResponse = responseRecorder();
await botHandler(messageUpdate(123, '/start'), ownerStartResponse);
assert.equal(ownerStartResponse.statusCode, 200);
assert.equal(ownerStartResponse.body, 'ok');
assert.equal(sessionState.step, 'owner');
const ownerHome = vkCalls.find(call => call.method === 'messages.send' && call.peer_id === '123');
assert.ok(ownerHome);
assert.equal(ownerHome.message, 'панель преподавателя');
const ownerKeyboard = JSON.parse(ownerHome.keyboard);
assert.equal(ownerKeyboard.inline, false);
assert.equal(ownerKeyboard.buttons[0][0].action.label, '👥 группы');

const callbackResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-1', peer_id: 123, user_id: 123,
  payload: { cmd: 'new_group' },
}), callbackResponse);
assert.equal(sessionState.step, 'await_group_name');
assert.ok(vkCalls.some(call =>
  call.method === 'messages.sendMessageEventAnswer' && call.event_id === 'event-1'
));

const groupNameResponse = responseRecorder();
await botHandler(messageUpdate(123, 'Базовая А2'), groupNameResponse);
assert.equal(insertedGroups.length, 1);
assert.equal(insertedGroups[0].name, 'Базовая А2');
assert.equal(insertedGroups[0].group_type, 'mini_group');

const archiveResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-archive', peer_id: 123, user_id: 123,
  payload: { cmd: 'dz_arcok:hw1' },
}), archiveResponse);
assert.deepEqual(rpcCalls.at(-1), { p_assignment_id: 'hw1', p_archived: true });
assert.ok(vkCalls.some(call =>
  call.method === 'messages.send' && /убрано в архив/.test(call.message)
));

sessionState = {};
const registrationResponse = responseRecorder();
await botHandler(messageUpdate(456, 'Начать', { ref: 'student-token' }), registrationResponse);
assert.deepEqual(studentPatches.at(-1), { vk_id: 456 });
assert.equal(sessionState.step, 'student');
assert.ok(vkCalls.some(call =>
  call.method === 'messages.send' && call.peer_id === '456' && /подключен как Иван Иванов/.test(call.message)
));

sessionState = { step: 'await_files:sub1', data: { files: [] } };
const photoResponse = responseRecorder();
await botHandler(messageUpdate(456, '', {
  attachments: [{
    type: 'photo',
    photo: { owner_id: 456, id: 999, access_key: 'photo-access' },
  }],
}), photoResponse);
assert.equal(sessionState.step, 'await_files:sub1');
assert.deepEqual(sessionState.data.files, [{
  type: 'photo', file_id: 'photo456_999_photo-access',
}]);
const photoAck = vkCalls.at(-1);
assert.equal(photoAck.method, 'messages.send');
assert.match(photoAck.message, /файл получен/);
assert.equal(JSON.parse(photoAck.keyboard).inline, true);

for (const call of vkCalls) {
  if (call.method !== 'messages.send') continue;
  assert.equal(call.access_token, 'vk-test-token');
  assert.equal(call.v, '5.199');
  assert.ok(Number(call.random_id) > 0);
  assert.doesNotMatch(call.message || '', /<\/?(?:b|code)>/);
}

console.log('VK smoke tests passed');
