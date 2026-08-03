import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
process.env.OWNER_TELEGRAM_ID = '123';
process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = 'sheet-secret';

const telegramCalls = [];
const insertedGroups = [];
const insertedStudents = [];
const insertedLessons = [];
let sessionState = {};
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes('/rest/v1/groups?')) {
    if (target.includes('name=eq.')) return Response.json([]);
    return Response.json([{
      id: 'g1', name: 'Базовая А1', program: 'base', target_score: 18,
      group_type: 'mini_group', active: true, created_at: '2026-08-02T08:00:00.000Z',
    }]);
  }
  if (target.endsWith('/rest/v1/groups') && options.method === 'POST') {
    const group = JSON.parse(options.body);
    insertedGroups.push(group);
    return Response.json([group]);
  }
  if (target.includes('/rest/v1/students?')) {
    return Response.json([{
      id: 's1', name: 'Иван Иванов', group_id: 'g1', status: 'active',
      target_score: 18, created_at: '2026-08-02T08:10:00.000Z',
    }]);
  }
  if (target.endsWith('/rest/v1/students') && options.method === 'POST') {
    const student = { reg_token: 'individual-token', ...JSON.parse(options.body) };
    insertedStudents.push(student);
    return Response.json([student]);
  }
  if (target.includes('/rest/v1/lessons?')) {
    if (target.includes('sheet_lesson_key=like.manual:*')) return Response.json([]);
    return Response.json([{
      id: 'l1', group_id: 'g1', lesson_number: '1', topic: 'Числа', event_type: 'lesson',
    }]);
  }
  if (target.endsWith('/rest/v1/lessons') && options.method === 'POST') {
    const lesson = JSON.parse(options.body);
    insertedLessons.push(lesson);
    return Response.json([lesson]);
  }
  if (target.includes('/rest/v1/homework_assignments?')) {
    return Response.json([{
      id: 'a1', group_id: 'g1', lesson_id: 'l1', topic: 'Числа',
      due_date: '2026-08-09', hw_type: 'brief', is_advanced: false,
      assigned_at: '2026-08-02T08:20:00.000Z',
    }]);
  }
  if (target.includes('/rest/v1/homework_submissions?')) {
    if (target.includes('status=eq.submitted')) {
      return Response.json([{
        id: 'sub1', assignment_id: 'a1', student_id: 's1', status: 'submitted',
        submitted_at: '2026-08-03T08:00:00.000Z', on_time: true,
        submitted_files: [{ type: 'photo', file_id: 'photo-1' }],
      }]);
    }
    return Response.json([{
      id: 'sub1', assignment_id: 'a1', student_id: 's1', status: 'checked',
      submitted_at: '2026-08-03T08:00:00.000Z', checked_at: '2026-08-03T08:05:00.000Z',
      score: 8, max_score: 10, on_time: true, comment: 'Хорошо',
      submitted_files: [{ type: 'photo', file_id: 'photo-1' }],
    }]);
  }
  if (target.includes('/rest/v1/bot_sessions?')) {
    return Response.json([{ state: sessionState }]);
  }
  if (target.endsWith('/rest/v1/bot_sessions') && options.method === 'POST') {
    const session = JSON.parse(options.body);
    sessionState = session.state;
    return Response.json([session]);
  }
  if (target.includes('api.telegram.org')) {
    telegramCalls.push(JSON.parse(options.body || '{}'));
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`Unexpected request: ${target}`);
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

const { default: botHandler } = await import('../api/bot.js');
const botResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: { message: { chat: { id: 123 }, from: { id: 123 }, text: '/start' } },
}, botResponse);

assert.equal(botResponse.statusCode, 200);
assert.equal(botResponse.body.ok, true);
assert.equal(telegramCalls.length, 1);
assert.match(telegramCalls[0].text, /панель преподавателя/);

const newGroupResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: { message: { chat: { id: 123 }, from: { id: 123 }, text: '/newgroup' } },
}, newGroupResponse);
assert.equal(newGroupResponse.statusCode, 200);
assert.match(telegramCalls.at(-1).text, /введи название группы/i);
assert.equal(sessionState.step, 'await_group_name');

const groupNameResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: { message: { chat: { id: 123 }, from: { id: 123 }, text: 'Базовая А2' } },
}, groupNameResponse);
assert.equal(insertedGroups.length, 1);
assert.equal(insertedGroups[0].group_type, 'mini_group');
assert.equal('program' in insertedGroups[0], false);
assert.equal('target_score' in insertedGroups[0], false);
assert.equal('template_id' in insertedGroups[0], false);

const newIndividualResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: { message: { chat: { id: 123 }, from: { id: 123 }, text: '/newindividual' } },
}, newIndividualResponse);
assert.match(telegramCalls.at(-1).text, /введи имя индивидуального ученика/i);
assert.equal(sessionState.step, 'await_individual_name');

const individualNameResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: { message: { chat: { id: 123 }, from: { id: 123 }, text: 'Мария Смирнова' } },
}, individualNameResponse);
assert.equal(insertedGroups.length, 2);
assert.equal(insertedGroups[1].name, 'Индивидуально · Мария Смирнова');
assert.equal(insertedGroups[1].group_type, 'individual');
assert.equal('program' in insertedGroups[1], false);
assert.equal('target_score' in insertedGroups[1], false);
assert.equal(insertedStudents.length, 1);
assert.equal(insertedStudents[0].group_id, insertedGroups[1].id);
assert.equal('target_score' in insertedStudents[0], false);
assert.equal(sessionState.step, 'owner');

const lessonChoiceResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: {
    callback_query: {
      id: 'cb-hw-group', data: 'hw_group:g1',
      message: { chat: { id: 123 } }, from: { id: 123 },
    },
  },
}, lessonChoiceResponse);
const lessonKeyboard = JSON.parse(telegramCalls.at(-1).reply_markup).inline_keyboard;
assert.equal(lessonKeyboard[0][0].callback_data, 'hw_new_lesson:g1');

const newLessonResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: {
    callback_query: {
      id: 'cb-new-lesson', data: 'hw_new_lesson:g1',
      message: { chat: { id: 123 } }, from: { id: 123 },
    },
  },
}, newLessonResponse);
assert.equal(sessionState.step, 'await_lesson_topic');

const lessonTopicResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: { message: { chat: { id: 123 }, from: { id: 123 }, text: 'Линейные уравнения' } },
}, lessonTopicResponse);
assert.equal(insertedLessons.length, 1);
assert.equal(insertedLessons[0].topic, 'Линейные уравнения');
assert.match(insertedLessons[0].sheet_lesson_key, /^manual:/);
assert.equal(sessionState.step, 'await_date');

sessionState = {
  step: 'brief_review:sub1',
  data: { correct: ['4', '9'], given: ['4', '8'] },
};
const briefSubmissionResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: {
    callback_query: {
      id: 'cb-brief-submit', data: 'brief_final_submit:sub1',
      message: { chat: { id: 456 } }, from: { id: 456 },
    },
  },
}, briefSubmissionResponse);
const ownerSubmissionNotice = telegramCalls.find(call =>
  String(call.chat_id) === '123' && /Сдано ДЗ/.test(call.text || '')
);
assert.ok(ownerSubmissionNotice);
assert.match(ownerSubmissionNotice.text, /Иван Иванов/);
assert.match(ownerSubmissionNotice.text, /Базовая А1/);
assert.match(ownerSubmissionNotice.text, /1\/2/);

const uncheckedResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: { message: { chat: { id: 123 }, from: { id: 123 }, text: '/unchecked' } },
}, uncheckedResponse);
assert.equal(uncheckedResponse.statusCode, 200);
assert.match(telegramCalls.at(-1).text, /Непроверенные работы: 1/);
assert.match(telegramCalls.at(-1).text, /Иван Иванов/);
const uncheckedKeyboard = JSON.parse(telegramCalls.at(-1).reply_markup).inline_keyboard;
assert.equal(uncheckedKeyboard[0][0].callback_data, 'review:sub1');

const photosBeforeReview = telegramCalls.filter(call => call.photo === 'photo-1').length;
assert.equal(photosBeforeReview, 0);
const reviewOpenResponse = responseRecorder();
await botHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: {
    callback_query: {
      id: 'cb-review-open', data: 'review:sub1',
      message: { chat: { id: 123 } }, from: { id: 123 },
    },
  },
}, reviewOpenResponse);
const photosAfterReview = telegramCalls.filter(call => call.photo === 'photo-1').length;
assert.equal(photosAfterReview, photosBeforeReview + 1);
assert.match(telegramCalls.at(-1).text, /введи итоговый результат/);

const { default: statsExportHandler } = await import('../api/stats-export.js');
const statsExportResponse = responseRecorder();
await statsExportHandler({
  method: 'POST',
  headers: { 'x-tutoros-sync-secret': 'sheet-secret' },
}, statsExportResponse);
assert.equal(statsExportResponse.statusCode, 200);
assert.equal(statsExportResponse.body.overview.active_groups, 1);
assert.equal(statsExportResponse.body.overview.active_mini_groups, 1);
assert.equal(statsExportResponse.body.overview.active_individuals, 0);
assert.equal(statsExportResponse.body.overview.active_students, 1);
assert.equal(statsExportResponse.body.groups[0].group, 'Базовая А1');
assert.equal(statsExportResponse.body.groups[0].format, 'Мини-группа');
assert.equal(statsExportResponse.body.students[0].student, 'Иван Иванов');
assert.equal(statsExportResponse.body.students[0].format, 'Мини-группа');
assert.equal(statsExportResponse.body.results[0].result, 0.8);

const unauthorizedStatsResponse = responseRecorder();
await statsExportHandler({
  method: 'POST',
  headers: { 'x-tutoros-sync-secret': 'wrong-secret' },
}, unauthorizedStatsResponse);
assert.equal(unauthorizedStatsResponse.statusCode, 401);

const { default: setupWebhookHandler } = await import('../api/setup-webhook.js');
const setupWebhookResponse = responseRecorder();
await setupWebhookHandler({
  method: 'POST',
  headers: { host: 'preview.example.vercel.app' },
  body: { secret: 'webhook-secret' },
}, setupWebhookResponse);

assert.equal(setupWebhookResponse.statusCode, 200);
assert.match(setupWebhookResponse.body, /бот подключён/i);
assert.deepEqual(telegramCalls.at(-1), {
  url: 'https://preview.example.vercel.app/api/bot',
  secret_token: 'webhook-secret',
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: false,
});

const badWebhookResponse = responseRecorder();
await setupWebhookHandler({
  method: 'POST',
  headers: { host: 'preview.example.vercel.app' },
  body: { secret: 'wrong-secret' },
}, badWebhookResponse);

assert.equal(badWebhookResponse.statusCode, 401);

// Reliability: homework is created by one atomic RPC, notification failures are
// reported by student name, and a repeated file submission changes state once.
const reliabilityTelegramCalls = [];
const reliabilityRpcCalls = [];
let reliabilitySession = {
  step: 'await_answers',
  data: {
    assignment_id: 'a-reliable',
    group_id: 'g-reliable',
    group_name: 'Базовая Надёжная',
    lesson_id: 'l-reliable',
    lesson_number: '3',
    topic: 'Дроби',
    due_date: '2026-08-20',
    hw_type: 'brief',
    total: 1,
    collected: [],
  },
};
let reliabilitySubmissionStatus = 'assigned';
let reliabilitySubmissionPatches = 0;
let directAssignmentWrites = 0;

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  const method = options.method || 'GET';
  if (target.includes('/rest/v1/bot_sessions?')) {
    return Response.json([{ state: reliabilitySession }]);
  }
  if (target.endsWith('/rest/v1/bot_sessions') && method === 'POST') {
    reliabilitySession = JSON.parse(options.body).state;
    return Response.json([{ state: reliabilitySession }]);
  }
  if (target.includes('/rest/v1/students?telegram_id=eq.456')) {
    return Response.json([{
      id: 's-reliable-1', name: 'Анна', group_id: 'g-reliable',
      status: 'active', telegram_id: 456,
    }]);
  }
  if (target.includes('/rest/v1/students?group_id=eq.g-reliable')) {
    return Response.json([
      { id: 's-reliable-1', name: 'Анна', status: 'active', telegram_id: 456 },
      { id: 's-reliable-2', name: 'Пётр', status: 'active', telegram_id: 789 },
    ]);
  }
  if (target.endsWith('/rest/v1/rpc/create_homework_for_group') && method === 'POST') {
    const body = JSON.parse(options.body);
    reliabilityRpcCalls.push(body);
    return Response.json({
      assignment_id: body.p_assignment_id,
      students_count: 2,
      already_created: false,
    });
  }
  if (target.endsWith('/rest/v1/homework_assignments') && method === 'POST') {
    directAssignmentWrites++;
    return Response.json([]);
  }
  if (target.includes('/rest/v1/homework_submissions?') && method === 'PATCH') {
    if (!target.includes('status=eq.assigned') || reliabilitySubmissionStatus !== 'assigned') {
      return Response.json([]);
    }
    reliabilitySubmissionPatches++;
    reliabilitySubmissionStatus = 'submitted';
    return Response.json([{ id: 'sub-reliable', status: 'submitted' }]);
  }
  if (target.includes('/rest/v1/homework_submissions?')) {
    if (target.includes('status=eq.assigned') && reliabilitySubmissionStatus !== 'assigned') {
      return Response.json([]);
    }
    return Response.json([{
      id: 'sub-reliable', assignment_id: 'a-file', student_id: 's-reliable-1',
      status: reliabilitySubmissionStatus,
    }]);
  }
  if (target.includes('/rest/v1/homework_assignments?')) {
    return Response.json([{
      id: 'a-file', group_id: 'g-reliable', topic: 'Геометрия',
      due_date: '2026-08-20', hw_type: 'detailed',
    }]);
  }
  if (target.includes('/rest/v1/groups?')) {
    return Response.json([{ id: 'g-reliable', name: 'Базовая Надёжная', active: true }]);
  }
  if (target.includes('api.telegram.org')) {
    const body = JSON.parse(options.body || '{}');
    reliabilityTelegramCalls.push(body);
    if (String(body.chat_id) === '789') {
      return Response.json({ ok: false, description: 'Forbidden: bot was blocked by the user' });
    }
    return Response.json({ ok: true, result: {} });
  }
  throw new Error(`Unexpected reliability request: ${method} ${target}`);
};

const { default: reliabilityBotHandler } = await import(`../api/bot.js?reliability=${Date.now()}`);
const reliableHomeworkResponse = responseRecorder();
await reliabilityBotHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: { message: { chat: { id: 123 }, from: { id: 123 }, text: '4' } },
}, reliableHomeworkResponse);
assert.equal(reliabilityRpcCalls.length, 1);
assert.equal(directAssignmentWrites, 0);
assert.equal(reliabilityRpcCalls[0].p_assignment_id, 'a-reliable');
assert.deepEqual(reliabilityRpcCalls[0].p_answers, ['4']);
assert.match(reliabilityTelegramCalls.at(-1).text, /задание выдано: <b>2\/2<\/b>/);
assert.match(reliabilityTelegramCalls.at(-1).text, /уведомления: <b>1\/2<\/b>/);
assert.match(reliabilityTelegramCalls.at(-1).text, /Пётр/);

reliabilitySession = {
  step: 'await_files:sub-reliable',
  data: { files: [{ type: 'photo', file_id: 'reliable-photo' }] },
};
const firstFileSubmissionResponse = responseRecorder();
await reliabilityBotHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: {
    callback_query: {
      id: 'cb-file-first', data: 'submit_files:sub-reliable',
      message: { chat: { id: 456 } }, from: { id: 456 },
    },
  },
}, firstFileSubmissionResponse);

const repeatedFileSubmissionResponse = responseRecorder();
await reliabilityBotHandler({
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
  body: {
    callback_query: {
      id: 'cb-file-repeat', data: 'submit_files:sub-reliable',
      message: { chat: { id: 456 } }, from: { id: 456 },
    },
  },
}, repeatedFileSubmissionResponse);

assert.equal(reliabilitySubmissionPatches, 1);
const reliableOwnerNotices = reliabilityTelegramCalls.filter(call =>
  String(call.chat_id) === '123' && /Сдано ДЗ/.test(call.text || '')
);
assert.equal(reliableOwnerNotices.length, 1);
assert.match(reliabilityTelegramCalls.at(-1).text, /уже была отправлена/i);

console.log('Smoke tests passed');
