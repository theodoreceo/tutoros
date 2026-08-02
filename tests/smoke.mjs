import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
process.env.OWNER_TELEGRAM_ID = '123';
process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = 'sheet-secret';

const telegramCalls = [];
const courseSyncBodies = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes('/rest/v1/groups?')) {
    return Response.json([{
      id: 'g1', name: 'Базовая А1', program: 'base', target_score: 18,
      active: true, created_at: '2026-08-02T08:00:00.000Z', template_id: 'm1',
    }]);
  }
  if (target.includes('/rest/v1/students?')) {
    return Response.json([{
      id: 's1', name: 'Иван Иванов', group_id: 'g1', status: 'active',
      target_score: 18, created_at: '2026-08-02T08:10:00.000Z',
    }]);
  }
  if (target.includes('/rest/v1/lessons?')) {
    return Response.json([{
      id: 'l1', group_id: 'g1', lesson_number: '1', topic: 'Числа', event_type: 'lesson',
    }]);
  }
  if (target.includes('/rest/v1/homework_assignments?')) {
    return Response.json([{
      id: 'a1', group_id: 'g1', lesson_id: 'l1', topic: 'Числа',
      due_date: '2026-08-09', hw_type: 'brief', is_advanced: false,
      assigned_at: '2026-08-02T08:20:00.000Z',
    }]);
  }
  if (target.includes('/rest/v1/homework_submissions?')) {
    return Response.json([{
      id: 'sub1', assignment_id: 'a1', student_id: 's1', status: 'checked',
      submitted_at: '2026-08-03T08:00:00.000Z', checked_at: '2026-08-03T08:05:00.000Z',
      score: 8, max_score: 10, on_time: true, comment: 'Хорошо',
    }]);
  }
  if (target.includes('/rest/v1/bot_sessions?')) {
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (target.includes('/rest/v1/bot_sessions')) {
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (target.includes('api.telegram.org')) {
    telegramCalls.push(JSON.parse(options.body || '{}'));
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (target.includes('/rest/v1/rpc/sync_course_catalog')) {
    courseSyncBodies.push(JSON.parse(options.body || '{}'));
    return new Response('{"templates":2,"lessons":95}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
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

const { default: syncHandler } = await import('../api/sync-lessons.js');
const syncResponse = responseRecorder();
await syncHandler({
  method: 'POST',
  headers: { 'x-tutoros-sync-secret': 'sheet-secret' },
  body: { groups: [], lessons: [] },
}, syncResponse);

assert.equal(syncResponse.statusCode, 200);
assert.deepEqual(syncResponse.body, { ok: true, groups: 0, lessons: 0 });

const badSyncResponse = responseRecorder();
await syncHandler({
  method: 'POST',
  headers: { 'x-tutoros-sync-secret': 'sheet-secret' },
  body: {
    groups: [{ id: '', name: '' }],
    lessons: [],
  },
}, badSyncResponse);

assert.equal(badSyncResponse.statusCode, 400);
assert.match(badSyncResponse.body.error, /group/i);

const unauthorizedSyncResponse = responseRecorder();
await syncHandler({
  method: 'POST',
  headers: { 'x-tutoros-sync-secret': 'wrong-secret' },
  body: { groups: [], lessons: [] },
}, unauthorizedSyncResponse);

assert.equal(unauthorizedSyncResponse.statusCode, 401);

const { default: courseSyncHandler } = await import('../api/sync-course.js');
const courseSyncResponse = responseRecorder();
await courseSyncHandler({
  method: 'POST',
  headers: { 'x-tutoros-sync-secret': 'sheet-secret' },
  body: {
    templates: [{
      id: 'm1234567890abcdef1234',
      name: 'Базовая',
      program: 'base',
      sheet_key: 'Базовая',
      active: true,
    }],
    lessons: [{
      id: 'e1234567890abcdef1234',
      template_id: 'm1234567890abcdef1234',
      sheet_lesson_key: '1',
      lesson_number: '1',
      sequence: 1,
      topic: 'Числа и вычисления',
      event_type: 'lesson',
      active: true,
    }, {
      // A broken client ID must not collide with another course lesson.
      id: 'e1234567890abcdef1234',
      template_id: 'm1234567890abcdef1234',
      sheet_lesson_key: '2',
      lesson_number: '2',
      sequence: 2,
      topic: 'Дроби и проценты',
      event_type: 'lesson',
      active: true,
    }],
  },
}, courseSyncResponse);

assert.equal(courseSyncResponse.statusCode, 200);
assert.deepEqual(courseSyncResponse.body, { ok: true, templates: 2, lessons: 95 });
assert.equal(courseSyncBodies.length, 1);
assert.equal(courseSyncBodies[0].p_templates[0].name, 'Базовая');
assert.equal(courseSyncBodies[0].p_lessons.length, 2);
assert.notEqual(courseSyncBodies[0].p_lessons[0].id, 'e1234567890abcdef1234');
assert.notEqual(courseSyncBodies[0].p_lessons[0].id, courseSyncBodies[0].p_lessons[1].id);

const emptyCourseSyncResponse = responseRecorder();
await courseSyncHandler({
  method: 'POST',
  headers: { 'x-tutoros-sync-secret': 'sheet-secret' },
  body: { templates: [], lessons: [] },
}, emptyCourseSyncResponse);
assert.equal(emptyCourseSyncResponse.statusCode, 400);

const { default: statsExportHandler } = await import('../api/stats-export.js');
const statsExportResponse = responseRecorder();
await statsExportHandler({
  method: 'POST',
  headers: { 'x-tutoros-sync-secret': 'sheet-secret' },
}, statsExportResponse);
assert.equal(statsExportResponse.statusCode, 200);
assert.equal(statsExportResponse.body.overview.active_groups, 1);
assert.equal(statsExportResponse.body.overview.active_students, 1);
assert.equal(statsExportResponse.body.groups[0].group, 'Базовая А1');
assert.equal(statsExportResponse.body.students[0].student, 'Иван Иванов');
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

console.log('Smoke tests passed');
