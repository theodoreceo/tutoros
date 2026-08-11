import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = 'sheet-secret';

const tables = {
  groups: [{ id: 'g1', name: 'Базовая А1', group_type: 'mini_group', active: true }],
  students: [
    { id: 's1', name: 'Иван', group_id: 'g1', status: 'active', vk_id: 101 },
    { id: 's2', name: 'Анна', group_id: 'g1', status: 'active', vk_id: null },
  ],
  lessons: [{ id: 'l1', group_id: 'g1', lesson_number: '1', topic: 'Уравнения', event_type: 'lesson' }],
  homework_assignments: [{
    id: 'a1', group_id: 'g1', lesson_id: 'l1', topic: 'Уравнения',
    due_date: '2026-01-10', hw_type: 'brief', is_advanced: false,
    assigned_at: '2026-01-01T10:00:00.000Z', archived_at: null,
  }],
  homework_submissions: [
    {
      id: 'sub1', assignment_id: 'a1', student_id: 's1', status: 'checked',
      submitted_at: '2026-01-09T10:00:00.000Z', checked_at: '2026-01-09T12:00:00.000Z',
      score: 8, max_score: 10, on_time: true, comment: '', task_scores: [1, 1, 0],
    },
    {
      id: 'sub2', assignment_id: 'a1', student_id: 's2', status: 'assigned',
      submitted_at: null, checked_at: null, score: null, max_score: null,
      on_time: null, comment: '', task_scores: null,
    },
  ],
};

globalThis.fetch = async url => {
  const match = String(url).match(/\/rest\/v1\/([^?]+)/);
  if (!match || !tables[match[1]]) throw new Error(`Unexpected URL: ${url}`);
  return Response.json(tables[match[1]]);
};

const { default: statsHandler } = await import('../api/stats-export.js');
const response = {
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
};

await statsHandler({
  method: 'POST',
  headers: { 'x-tutoros-sync-secret': 'sheet-secret' },
}, response);

assert.equal(response.statusCode, 200);
assert.equal(response.body.overview.awaiting_review, 0);
assert.equal(response.body.overview.overdue, 1);
assert.equal(response.body.overview.completion_rate, 0.5);
assert.equal(response.body.overview.average_score, 0.8);
assert.equal(response.body.overview.review_hours, 2);
assert.equal(response.body.groups[0].connected_rate, 0.5);
assert.equal(response.body.groups[0].overdue, 1);
assert.equal(
  response.body.students.find(row => row.student === 'Анна').attention,
  'Напомнить об одном просроченном ДЗ'
);
assert.equal(response.body.topics[0].topic, 'Уравнения');
assert.equal(response.body.topics[0].completion_rate, 0.5);

console.log('Stats export tests passed');
