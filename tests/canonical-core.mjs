import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';

const rpcCalls = [];
const patchCalls = [];
const deleteCalls = [];
const getCalls = [];
let assignmentId = null;

const json = body => Response.json(body);

const student = {
  id: 's1', name: 'Иван', group_id: 'g1', status: 'active',
  telegram_id: 111, vk_id: 222, reg_token: 'token', target_score: 25,
};
const group = { id: 'g1', name: 'ОГЭ-1', active: true, group_type: 'mini_group' };

function queryOf(target) {
  const url = new URL(target);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  const decodedTarget = decodeURIComponent(target);
  const method = options.method || 'GET';
  const query = queryOf(target);
  if (method === 'GET') getCalls.push(query);

  if (target.includes('/rest/v1/rpc/create_homework_for_group')) {
    const body = JSON.parse(options.body || '{}');
    rpcCalls.push(body);
    assignmentId = body.p_assignment_id;
    return json({ assignment_id: assignmentId, students_count: 1 });
  }

  if (target.includes('/rest/v1/rpc/set_homework_archived')) {
    const body = JSON.parse(options.body || '{}');
    rpcCalls.push({ fn: 'set_homework_archived', ...body });
    return json({ assignment_id: body.p_assignment_id, archived: body.p_archived });
  }

  if (target.includes('/rest/v1/homework_assignments?') && method === 'PATCH') {
    const body = JSON.parse(options.body || '{}');
    patchCalls.push({ table: 'homework_assignments', target, body });
    return json([{
      id: assignmentId || 'a1', group_id: 'g1', lesson_id: 'l1', topic: 'Тема',
      hw_type: 'detailed', is_advanced: true, due_date: '2026-10-01', ...body,
    }]);
  }

  if (target.includes('/rest/v1/homework_assignments?') && method === 'GET') {
    if (target.includes('id=eq.a1')) {
      return json([{ id: 'a1', group_id: 'g1', lesson_id: 'l1', topic: 'Тема', due_date: '2026-10-01', hw_type: 'detailed', is_advanced: false }]);
    }
    return json([]);
  }

  if (target.includes('/rest/v1/groups?') && method === 'GET') {
    return json([group]);
  }
  if (target.includes('/rest/v1/groups?') && method === 'PATCH') {
    const body = JSON.parse(options.body || '{}');
    patchCalls.push({ table: 'groups', target, body });
    return json([{ ...group, ...body }]);
  }

  if (target.includes('/rest/v1/students?group_id=eq.g1') && method === 'GET') {
    return json([student]);
  }
  if (target.includes('/rest/v1/students?') && method === 'PATCH') {
    const body = JSON.parse(options.body || '{}');
    patchCalls.push({ table: 'students', target, body });
    return json([{ ...student, ...body }]);
  }

  if (target.includes('/rest/v1/homework_submissions?') && method === 'PATCH') {
    const body = JSON.parse(options.body || '{}');
    patchCalls.push({ table: 'homework_submissions', target, body });
    if (target.includes('id=eq.sub-review')) {
      return json([{ id: 'sub-review', student_id: 's1', assignment_id: 'a1', status: body.status || 'submitted', ...body }]);
    }
    return json([]);
  }

  if (target.includes('/rest/v1/homework_submissions?') && method === 'GET') {
    if (assignmentId && target.includes(`assignment_id=eq.${assignmentId}`)) {
      return json([{ id: 'sub-created', assignment_id: assignmentId, student_id: 's1', status: 'assigned' }]);
    }
    if (decodedTarget.includes('student_id=eq.s1') && decodedTarget.includes('status=in.(assigned,submitted)')) {
      return json([{ id: 'sub1', assignment_id: 'a1', student_id: 's1', status: 'assigned', submitted_at: null }]);
    }
    return json([]);
  }

  if (target.includes('/rest/v1/telegram_sessions?') && method === 'DELETE') {
    deleteCalls.push({ table: 'telegram_sessions', target });
    return json([]);
  }
  if (target.includes('/rest/v1/vk_sessions?') && method === 'DELETE') {
    deleteCalls.push({ table: 'vk_sessions', target });
    return json([]);
  }

  throw new Error(`Unexpected request: ${method} ${target}`);
};

const teacher = await import('../api/_lib/teacher-core.js');
const studentCore = await import('../api/_lib/student-core.js');

// UI may expose easy/hard, but DB must store one canonical detailed type.
const created = await teacher.createHomeworkAdmin({
  group_id: 'g1', lesson_id: 'l1', topic: 'Тема', due_date: '2026-10-01',
  hw_type: 'detailed_hard', telegram_file_id: 'tg-file', file_id: 'vk-doc',
  material_name: 'hw.pdf', task_config: [1, 2],
});
assert.ok(created.assignment);
assert.equal(rpcCalls[0].p_hw_type, 'detailed');
assert.equal(rpcCalls[0].p_is_advanced, true);
assert.deepEqual(rpcCalls[0].p_task_config, [1, 2]);

// Impossible scores must never reach the database.
const patchesBeforeInvalidReview = patchCalls.length;
assert.equal(await teacher.finalizeReviewAdmin('sub-review', 12, 10, 'bad'), null);
assert.equal(await teacher.finalizeReviewAdmin('sub-review', 7, 0, 'bad'), null);
assert.equal(patchCalls.length, patchesBeforeInvalidReview);
const validReview = await teacher.finalizeReviewAdmin('sub-review', 7, 10, 'ok');
assert.equal(validReview.score, 7);
assert.equal(validReview.max_score, 10);
assert.equal(validReview.status, 'checked');

// Archiving a group must also deactivate students, cancel outstanding work and
// clear both messenger sessions, otherwise invisible students keep using the bot.
const archived = await teacher.archiveGroup('g1');
assert.equal(archived.archived_students, 1);
assert.ok(patchCalls.some(call => call.table === 'groups' && call.body.active === false));
assert.ok(patchCalls.some(call => call.table === 'students' && call.body.status === 'left' && call.body.telegram_id === null && call.body.vk_id === null));
assert.ok(patchCalls.some(call => call.table === 'homework_submissions' && call.body.status === 'cancelled'));
assert.ok(deleteCalls.some(call => call.table === 'telegram_sessions'));
assert.ok(deleteCalls.some(call => call.table === 'vk_sessions'));

// Canonical student navigation must not query or expose the removed revision state.
const homework = await studentCore.homeworkOverview({ id: 's1', group_id: 'g1' });
assert.equal(homework.todo.length, 1);
const overviewRequest = getCalls.find(call => call.includes('/rest/v1/homework_submissions') && call.includes('student_id=eq.s1'));
assert.ok(overviewRequest);
assert.match(decodeURIComponent(overviewRequest), /status=in\.\(assigned,submitted\)/);
assert.doesNotMatch(decodeURIComponent(overviewRequest), /revision/);

console.log('Canonical TutorOS core tests passed');
