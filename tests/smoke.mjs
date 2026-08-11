import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.VK_GROUP_TOKEN = 'vk-test-token';
process.env.VK_GROUP_ID = '777';
process.env.VK_CALLBACK_SECRET = 'callback-secret';
process.env.VK_CONFIRMATION_CODE = 'confirmation-code';
process.env.VK_API_VERSION = '5.199';
process.env.OWNER_VK_ID = '123';
process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = 'sheet-secret';

const vkCalls = [];
const insertedGroups = [];
const insertedStudents = [];
const studentPatches = [];
const deletedRequests = [];
const rpcCalls = [];
let returnManyGroups = false;
let sessionState = {};
let diagnosticState = {};
let registeredStudent = {
  id: 's1', name: 'Иван Иванов', group_id: 'g1', status: 'active',
  reg_token: 'student-token', vk_id: null, created_at: '2026-08-02T08:10:00.000Z',
};

const json = body => Response.json(body);

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  const method = options.method || 'GET';

  if (target.includes('/rest/v1/') && method === 'DELETE') {
    deletedRequests.push(target);
    return json([]);
  }

  if (target.includes('/rest/v1/vk_sessions?')) {
    if (target.includes('vk_user_id=eq.-1')) {
      return json(Object.keys(diagnosticState).length ? [{ state: diagnosticState }] : []);
    }
    return json(Object.keys(sessionState).length ? [{ state: sessionState }] : []);
  }
  if (target.endsWith('/rest/v1/vk_sessions') && method === 'POST') {
    const session = JSON.parse(options.body);
    if (session.vk_user_id === -1) diagnosticState = session.state;
    else sessionState = session.state;
    return json([{ state: session.state }]);
  }
  if (target.includes('/rest/v1/students?vk_id=eq.')) {
    const requested = target.match(/vk_id=eq\.([^&]+)/)?.[1];
    return json(String(registeredStudent.vk_id) === requested ? [registeredStudent] : []);
  }
  if (target.includes('/rest/v1/students?reg_token=eq.student-token')) {
    return json([registeredStudent]);
  }
  if (target.includes('/rest/v1/students?id=eq.') && method === 'GET') {
    return json([registeredStudent]);
  }
  if (target.includes('/rest/v1/students?group_id=eq.g1') && method === 'GET') {
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
    if (returnManyGroups) {
      return json(Array.from({ length: 8 }, (_, index) => ({
        id: `g${index + 1}`,
        name: `Группа ${index + 1}`,
        group_type: index === 1 ? 'individual' : 'mini_group',
        active: true,
        created_at: '2026-08-02T08:00:00.000Z',
      })));
    }
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
assert.equal(diagnosticState.type, 'confirmation');

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
assert.deepEqual(
  ownerKeyboard.buttons.flat().map(button => button.action.label),
  ['👥 группы', '🕒 непроверено', '📦 архив дз', '❓ помощь']
);

returnManyGroups = true;
const groupsResponse = responseRecorder();
await botHandler(messageUpdate(123, '👥 группы'), groupsResponse);
returnManyGroups = false;
const groupsMessage = vkCalls.at(-1);
const groupsKeyboard = JSON.parse(groupsMessage.keyboard);
assert.ok(groupsKeyboard.buttons.length <= 6);
assert.equal(groupsKeyboard.buttons.flat().length, 10);
assert.ok(groupsKeyboard.buttons.flat().some(button =>
  button.action.label === '👥 Группа 1'
));
assert.ok(groupsKeyboard.buttons.flat().some(button =>
  button.action.label === '👤 Группа 2'
));
assert.ok(groupsKeyboard.buttons.flat().some(button =>
  button.action.label === '➕ создать группу'
));
assert.ok(groupsKeyboard.buttons.flat().some(button =>
  button.action.label === '➕ добавить ученика в группу'
));

const addStudentResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-add-student', peer_id: 123, user_id: 123,
  payload: { cmd: 'add_student' },
}), addStudentResponse);
assert.equal(sessionState.step, 'choose_student_group');
assert.match(vkCalls.at(-1).message, /в какую группу добавить ученика/);

const ownerGroupResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-owner-group', peer_id: 123, user_id: 123,
  payload: { cmd: 'owner_group:g1' },
}), ownerGroupResponse);
const ownerGroupMessage = vkCalls.at(-1);
const ownerGroupKeyboard = JSON.parse(ownerGroupMessage.keyboard);
assert.ok(ownerGroupKeyboard.buttons.flat().some(button =>
  button.action.label === '➕ создать ДЗ'
));
assert.ok(ownerGroupKeyboard.buttons.flat().some(button =>
  button.action.label === '🗑 удалить ученика из группы'
));
assert.ok(ownerGroupKeyboard.buttons.flat().some(button =>
  button.action.label === '🗑 удалить группу'
));

const groupHomeworkResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-group-homework', peer_id: 123, user_id: 123,
  payload: { cmd: 'hw_for_group:g1' },
}), groupHomeworkResponse);
assert.equal(sessionState.step, 'choose_hw_lesson');
assert.equal(sessionState.data.group_id, 'g1');
const groupHomeworkMessage = vkCalls.at(-1);
assert.match(groupHomeworkMessage.message, /группа: Базовая А1/);
const groupHomeworkKeyboard = JSON.parse(groupHomeworkMessage.keyboard);
assert.ok(groupHomeworkKeyboard.buttons.flat().some(button =>
  button.action.label === '➕ создать новый урок'
));
assert.ok(groupHomeworkKeyboard.buttons.flat().some(button =>
  button.action.label === '← назад к группе'
));

const studentDeleteConfirmResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-student-delete', peer_id: 123, user_id: 123,
  payload: { cmd: 'student_delete:s1' },
}), studentDeleteConfirmResponse);
assert.match(vkCalls.at(-1).message, /точно удалить ученика Иван Иванов/);
assert.equal(deletedRequests.length, 0);

const studentDeleteResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-student-delete-ok', peer_id: 123, user_id: 123,
  payload: { cmd: 'student_delete_ok:s1' },
}), studentDeleteResponse);
assert.ok(deletedRequests.some(target => target.includes('/rest/v1/students?id=eq.s1')));
assert.match(vkCalls.at(-1).message, /ученик Иван Иванов удалён/);

const beforeUnauthorizedDelete = deletedRequests.length;
const unauthorizedDeleteResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-unauthorized-delete', peer_id: 999, user_id: 999,
  payload: { cmd: 'group_delete_ok:g1' },
}), unauthorizedDeleteResponse);
assert.equal(deletedRequests.length, beforeUnauthorizedDelete);

const groupDeleteConfirmResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-group-delete', peer_id: 123, user_id: 123,
  payload: { cmd: 'group_delete:g1' },
}), groupDeleteConfirmResponse);
assert.match(vkCalls.at(-1).message, /точно удалить группу Базовая А1/);

const groupDeleteResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-group-delete-ok', peer_id: 123, user_id: 123,
  payload: { cmd: 'group_delete_ok:g1' },
}), groupDeleteResponse);
assert.ok(deletedRequests.some(target => target.includes('/rest/v1/students?group_id=eq.g1')));
assert.ok(deletedRequests.some(target => target.includes('/rest/v1/groups?id=eq.g1')));
assert.match(vkCalls.at(-1).message, /группа Базовая А1 удалена/);

const callbackResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-1', peer_id: 123, user_id: 123,
  payload: { cmd: 'new_group' },
}), callbackResponse);
const groupCreationMenu = JSON.parse(vkCalls.at(-1).keyboard);
assert.deepEqual(
  groupCreationMenu.buttons.flat().map(button => button.action.label),
  ['👥 мини-группу', '👤 индивидуального ученика', '← ко всем группам']
);
assert.ok(vkCalls.some(call =>
  call.method === 'messages.sendMessageEventAnswer' && call.event_id === 'event-1'
));

const miniGroupResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-mini-group', peer_id: 123, user_id: 123,
  payload: { cmd: 'new_mini_group' },
}), miniGroupResponse);
assert.equal(sessionState.step, 'await_group_name');
assert.ok(vkCalls.some(call =>
  call.method === 'messages.sendMessageEventAnswer' && call.event_id === 'event-mini-group'
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
