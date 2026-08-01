import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
process.env.OWNER_TELEGRAM_ID = '123';
process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = 'sheet-secret';

const telegramCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
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
  throw new Error(`Unexpected request: ${target}`);
};

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
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

console.log('Smoke tests passed');
