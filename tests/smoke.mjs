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
const groupPatches = [];
const assignmentPatches = [];
const deletedRequests = [];
const rpcCalls = [];
const homeworkRpcCalls = [];
const insertedLessons = [];
let returnManyGroups = false;
let sessionState = {};
let diagnosticState = {};
let submissionRows = [];
let assignmentRows = [];
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
  if (target.includes('/rest/v1/students?id=in.(') && method === 'GET') {
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
  if (target.endsWith('/rest/v1/homework_submissions') && method === 'POST') {
    const row = JSON.parse(options.body);
    submissionRows.push(row);
    return json([row]);
  }
  if (target.includes('/rest/v1/homework_submissions?')) {
    if (method === 'PATCH') {
      const changes = JSON.parse(options.body);
      const id = decodeURIComponent(target.match(/id=eq\.([^&]+)/)?.[1] || '');
      const row = submissionRows.find(item => item.id === id);
      if (!row) return json([]);
      Object.assign(row, changes);
      return json([row]);
    }
    return json(submissionRows);
  }
  if (target.includes('/rest/v1/homework_assignments?') && method === 'PATCH') {
    const changes = JSON.parse(options.body);
    assignmentPatches.push(changes);
    const requestedId = decodeURIComponent(target.match(/id=eq\.([^&]+)/)?.[1] || '');
    const matched = assignmentRows.filter(row => !requestedId || row.id === requestedId);
    matched.forEach(row => Object.assign(row, changes));
    return json(matched);
  }
  if (target.includes('/rest/v1/homework_assignments?')) {
    return json(assignmentRows);
  }
  if (target.includes('/rest/v1/rpc/set_homework_archived')) {
    const body = JSON.parse(options.body);
    rpcCalls.push(body);
    return json({ assignment_id: body.p_assignment_id, archived: body.p_archived });
  }
  if (target.includes('/rest/v1/rpc/create_homework_for_group')) {
    const body = JSON.parse(options.body);
    homeworkRpcCalls.push(body);
    return json({ assignment_id: body.p_assignment_id, students_count: 1 });
  }
  if (target.includes('/rest/v1/groups?name=eq.')) return json([]);
  if (target.includes('/rest/v1/groups?') && method === 'PATCH') {
    const changes = JSON.parse(options.body);
    groupPatches.push(changes);
    return json([{ id: 'g1', name: 'Базовая А1', ...changes }]);
  }
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
  if (target.endsWith('/rest/v1/lessons') && method === 'POST') {
    const lesson = JSON.parse(options.body);
    insertedLessons.push(lesson);
    return json([lesson]);
  }

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
const previousScreenDelete = vkCalls.find(call =>
  call.method === 'messages.delete' && call.message_ids === '1'
);
assert.ok(previousScreenDelete);
assert.equal(previousScreenDelete.delete_for_all, '1');
const groupsMessage = vkCalls.at(-1);
const groupsKeyboard = JSON.parse(groupsMessage.keyboard);
assert.ok(groupsKeyboard.buttons.length <= 6);
assert.equal(groupsKeyboard.buttons.flat().length, 11);
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
  button.action.label === '👥 ученики и ссылки'
));
assert.ok(ownerGroupKeyboard.buttons.flat().some(button =>
  button.action.label === '📦 архивировать группу'
));

const groupHomeworkResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-group-homework', peer_id: 123, user_id: 123,
  payload: { cmd: 'hw_for_group:g1' },
}), groupHomeworkResponse);
assert.equal(sessionState.step, 'await_lesson_topic');
assert.equal(sessionState.data.group_id, 'g1');
const groupHomeworkMessage = vkCalls.at(-1);
assert.match(groupHomeworkMessage.message, /группа: Базовая А1/);
const groupHomeworkKeyboard = JSON.parse(groupHomeworkMessage.keyboard);
assert.ok(groupHomeworkKeyboard.buttons.flat().some(button =>
  button.action.label === '❌ отменить создание'
));

const topicResponse = responseRecorder();
await botHandler(messageUpdate(123, 'Квадратные уравнения'), topicResponse);
assert.equal(sessionState.step, 'await_date');
assert.equal(insertedLessons.length, 0);

const dueResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-due', peer_id: 123, user_id: 123,
  payload: { cmd: 'hw_due:3' },
}), dueResponse);
assert.equal(sessionState.step, 'await_hwtype');

const typeResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-type', peer_id: 123, user_id: 123,
  payload: { cmd: 'hwtype:detailed_easy' },
}), typeResponse);
assert.equal(sessionState.step, 'await_pdf');

const noFileResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-no-file', peer_id: 123, user_id: 123,
  payload: { cmd: 'hw_no_file' },
}), noFileResponse);
assert.equal(sessionState.step, 'await_scores_bulk');

const scoresResponse = responseRecorder();
await botHandler(messageUpdate(123, '1; 1; 2'), scoresResponse);
assert.equal(sessionState.step, 'confirm_hw');
assert.equal(insertedLessons.length, 0);
assert.match(vkCalls.at(-1).message, /проверь ДЗ перед отправкой/);

const confirmHomeworkResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-confirm-homework', peer_id: 123, user_id: 123,
  payload: { cmd: 'hw_confirm' },
}), confirmHomeworkResponse);
assert.equal(insertedLessons.length, 1);
assert.equal(homeworkRpcCalls.length, 1);
assert.deepEqual(homeworkRpcCalls[0].p_task_config, [1, 1, 2]);
assert.equal(sessionState.step, 'owner');

const studentDeleteConfirmResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-student-delete', peer_id: 123, user_id: 123,
  payload: { cmd: 'student_delete:s1' },
}), studentDeleteConfirmResponse);
assert.match(vkCalls.at(-1).message, /архивировать ученика Иван Иванов/);
assert.equal(deletedRequests.length, 0);

const studentDeleteResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-student-delete-ok', peer_id: 123, user_id: 123,
  payload: { cmd: 'student_delete_ok:s1' },
}), studentDeleteResponse);
assert.ok(studentPatches.some(changes => changes.status === 'left'));
assert.match(vkCalls.at(-1).message, /ученик Иван Иванов архивирован/);

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
assert.match(vkCalls.at(-1).message, /архивировать группу Базовая А1/);

const groupDeleteResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-group-delete-ok', peer_id: 123, user_id: 123,
  payload: { cmd: 'group_delete_ok:g1' },
}), groupDeleteResponse);
assert.ok(studentPatches.some(changes => changes.status === 'left'));
assert.ok(groupPatches.some(changes => changes.active === false));
assert.match(vkCalls.at(-1).message, /группа Базовая А1 архивирована/);

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

assignmentRows = [{
  id: 'hw1', group_id: 'g1', topic: 'Архивируемое ДЗ', due_date: '2026-08-10',
  hw_type: 'detailed', archived_at: null,
}];
const archiveResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-archive', peer_id: 123, user_id: 123,
  payload: { cmd: 'dz_arcok:hw1' },
}), archiveResponse);
assert.ok(assignmentPatches.at(-1).archived_at);
assert.ok(assignmentRows[0].archived_at);
assert.ok(vkCalls.some(call =>
  call.method === 'messages.send' && /убрано в архив/.test(call.message)
));

assignmentRows = [{
  id: 'a-current', group_id: 'g1', topic: 'Текущее ДЗ', due_date: '2026-09-01',
  hw_type: 'detailed', archived_at: null,
}];
submissionRows = [];
sessionState = {};
const registrationResponse = responseRecorder();
await botHandler(messageUpdate(456, 'Начать', { ref: 'student-token' }), registrationResponse);
assert.deepEqual(studentPatches.at(-1), { vk_id: 456 });
assert.equal(sessionState.step, 'student');
assert.ok(vkCalls.some(call =>
  call.method === 'messages.send' && call.peer_id === '456' && /подключен как Иван Иванов/.test(call.message)
));
assert.ok(submissionRows.some(row =>
  row.assignment_id === 'a-current' && row.student_id === 's1' && row.status === 'assigned'
));

assignmentRows = [{
  id: 'a-old', group_id: 'g1', topic: 'Старое ДЗ', due_date: '2026-08-01',
  hw_type: 'brief', archived_at: '2026-08-02T00:05:00.000Z', answers: ['42'],
}];
submissionRows = [];
const studentArchiveResponse = responseRecorder();
await botHandler(messageUpdate(456, '/archive'), studentArchiveResponse);
assert.match(vkCalls.at(-1).message, /архив заданий/);
assert.ok(JSON.parse(vkCalls.at(-1).keyboard).buttons.flat().some(button =>
  button.action.payload.includes('arch_hw:a-old')
));

const archivedHomeworkResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-archived-homework', peer_id: 456, user_id: 456,
  payload: { cmd: 'arch_hw:a-old' },
}), archivedHomeworkResponse);
assert.equal(submissionRows.length, 1);
assert.equal(submissionRows[0].assignment_id, 'a-old');
assert.equal(submissionRows[0].status, 'assigned');
assert.match(sessionState.step, /^brief_answer:/);

assignmentRows = [];
submissionRows = [];
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

registeredStudent = {
  ...registeredStudent, id: 's1', status: 'active', vk_id: 456,
};
assignmentRows = [{
  id: 'a-revision', group_id: 'g1', lesson_id: 'l1', topic: 'Геометрия',
  due_date: '2026-09-01', hw_type: 'detailed', task_config: null,
  archived_at: null, file_id: 'doc-geometry',
}];
submissionRows = [{
  id: 'sub-revision', assignment_id: 'a-revision', student_id: 's1', status: 'submitted',
  submitted_files: [], submitted_at: '2026-08-11T10:00:00.000Z', checked_at: null,
  score: null, max_score: null, comment: '',
}];

const reviewResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-review', peer_id: 123, user_id: 123,
  payload: { cmd: 'review:sub-revision' },
}), reviewResponse);
assert.equal(sessionState.step, 'review_total:sub-revision');
assert.ok(JSON.parse(vkCalls.at(-1).keyboard).buttons.flat().some(button =>
  button.action.label === '🔁 вернуть на доработку'
));

const revisionResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-revision', peer_id: 123, user_id: 123,
  payload: { cmd: 'review_revision:sub-revision' },
}), revisionResponse);
assert.equal(sessionState.step, 'revision_comment:sub-revision');

const revisionCommentResponse = responseRecorder();
await botHandler(messageUpdate(123, 'Исправь оформление второго задания'), revisionCommentResponse);
assert.equal(submissionRows[0].status, 'revision');
assert.equal(submissionRows[0].comment, 'Исправь оформление второго задания');
assert.equal(sessionState.step, 'owner');

const reopenRevisionResponse = responseRecorder();
const reopenCallsStart = vkCalls.length;
await botHandler(vkUpdate('message_event', {
  event_id: 'event-reopen-revision', peer_id: 456, user_id: 456,
  payload: { cmd: 'hw:sub-revision' },
}), reopenRevisionResponse);
assert.equal(sessionState.step, 'await_files:sub-revision');
assert.match(vkCalls.at(-1).message, /что исправить/);
const reopenCalls = vkCalls.slice(reopenCallsStart);
assert.equal(reopenCalls.filter(call => call.method === 'messages.delete').length, 1);
assert.equal(reopenCalls.filter(call => call.method === 'messages.send').length, 2);
assert.equal(
  reopenCalls.findIndex(call => call.method === 'messages.delete')
    < reopenCalls.findIndex(call => call.method === 'messages.send'),
  true
);
assert.deepEqual(sessionState._ui_message_ids, [1, 1]);

const reminderResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-reminder', peer_id: 123, user_id: 123,
  payload: { cmd: 'dz_remind:a-revision' },
}), reminderResponse);
assert.ok(vkCalls.some(call =>
  call.method === 'messages.send' && call.peer_id === '456' && /ждём исправленную работу/.test(call.message)
));

const repeatResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-repeat', peer_id: 123, user_id: 123,
  payload: { cmd: 'dz_repeat:a-revision' },
}), repeatResponse);
assert.equal(sessionState.step, 'repeat_due');

const repeatDueResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-repeat-due', peer_id: 123, user_id: 123,
  payload: { cmd: 'repeat_due:1' },
}), repeatDueResponse);
assert.equal(sessionState.step, 'confirm_hw');
assert.match(vkCalls.at(-1).message, /проверь ДЗ перед отправкой/);

for (const call of vkCalls) {
  if (call.method !== 'messages.send') continue;
  assert.equal(call.access_token, 'vk-test-token');
  assert.equal(call.v, '5.199');
  assert.ok(Number(call.random_id) > 0);
  assert.doesNotMatch(call.message || '', /<\/?(?:b|code)>/);
}

console.log('VK smoke tests passed');
