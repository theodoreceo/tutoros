import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.CRON_SECRET = 'cron-secret';

const calls = [];

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  const method = options.method || 'GET';
  calls.push({ target, method, body: options.body ? JSON.parse(options.body) : null });

  if (target.includes('/rest/v1/homework_assignments?') && method === 'GET') {
    assert.match(target, /archived_at=is\.null/);
    assert.match(target, /due_date=lt\./);
    return Response.json([{ id: 'a1' }, { id: 'a2' }]);
  }

  if (target.includes('/rest/v1/homework_assignments?') && method === 'PATCH') {
    assert.match(target, /id=in\.\(a1,a2\)/);
    const body = JSON.parse(options.body);
    assert.ok(body.archived_at);
    return Response.json([{ id: 'a1', ...body }, { id: 'a2', ...body }]);
  }

  throw new Error(`Unexpected request: ${method} ${target}`);
};

const responseRecorder = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const { default: archiveHandler } = await import('../api/archive.js');

const unauthorized = responseRecorder();
await archiveHandler({ headers: {} }, unauthorized);
assert.equal(unauthorized.statusCode, 401);

const authorized = responseRecorder();
await archiveHandler({ headers: { authorization: 'Bearer cron-secret' } }, authorized);
assert.equal(authorized.statusCode, 200);
assert.equal(authorized.body.archived, 2);
assert.equal(calls.filter(call => call.method === 'PATCH').length, 1);

console.log('Archive cron tests passed');
