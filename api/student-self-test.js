import {
  beginBrief,
  canonicalizeStudent,
  finalizeBrief,
  finalizeFiles,
  homeworkOverview,
  lessonDetail,
  lessonMaterial,
  lessonsOverview,
  linkStudentChannel,
  resultDetail,
  resultsOverview,
  studentByTelegram,
  studentByVk,
  submissionCard,
  todayMoscow,
} from './_lib/student-core.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

async function sb(table, method = 'GET', query = '', body = undefined, prefer = '') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    headers: { ...SB, ...(prefer ? { Prefer: prefer } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${table}: ${text || response.status}`);
  return text ? JSON.parse(text) : null;
}

const insert = (table, body) => sb(table, 'POST', '', body, 'return=representation');
const patch = (table, query, body) => sb(table, 'PATCH', query, body, 'return=representation');
const del = (table, query) => sb(table, 'DELETE', query);
const select = (table, query) => sb(table, 'GET', query);

function assert(condition, label, details = undefined) {
  if (!condition) {
    const error = new Error(label);
    error.details = details;
    throw error;
  }
}

function tomorrowMoscow() {
  const base = new Date(`${todayMoscow()}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(403).json({ ok: false, error: 'preview only' });
  }
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ ok: false, error: 'supabase not configured' });
  }

  const run = `e2e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const ids = {
    group: `${run}_g`, student: `${run}_s`, lesson: `${run}_l`,
    detailed: `${run}_hd`, brief: `${run}_hb`,
    notes: `${run}_mn`, recording: `${run}_mr`,
  };
  const fakeTelegram = -Math.floor(Date.now() / 10);
  const fakeVk = -Math.floor(Date.now() / 100) - 1000000000;
  const checks = [];
  const pass = (name, details = undefined) => checks.push({ name, ok: true, ...(details === undefined ? {} : { details }) });

  try {
    const now = new Date().toISOString();
    const due = tomorrowMoscow();

    await insert('groups', {
      id: ids.group,
      name: `SELF TEST ${run}`,
      group_type: 'mini_group',
      sheet_key: null,
      active: true,
      created_at: now,
      updated_at: now,
    });

    const studentRows = await insert('students', {
      id: ids.student,
      name: `Self Test ${run}`,
      group_id: ids.group,
      status: 'active',
      target_score: 23,
      created_at: now,
      updated_at: now,
    });
    let student = studentRows[0];

    await insert('lessons', {
      id: ids.lesson,
      group_id: ids.group,
      sheet_lesson_key: `self:${run}`,
      lesson_number: 1,
      sequence: 1,
      topic: 'Self-test lesson',
      scheduled_date: todayMoscow(),
      active: true,
      created_at: now,
      updated_at: now,
    });

    await insert('homework_assignments', [
      {
        id: ids.detailed,
        group_id: ids.group,
        lesson_id: ids.lesson,
        topic: 'Self-test detailed',
        description: 'isolated e2e',
        due_date: due,
        hw_type: 'detailed',
        is_advanced: false,
        task_config: [2, 3, 5],
        file_id: null,
        assigned_at: now,
      },
      {
        id: ids.brief,
        group_id: ids.group,
        lesson_id: ids.lesson,
        topic: 'Self-test brief',
        description: 'isolated e2e',
        due_date: due,
        hw_type: 'brief',
        is_advanced: false,
        answers: ['2', '4', '6'],
        assigned_at: now,
      },
    ]);

    await insert('lesson_materials', [
      {
        id: ids.notes,
        group_id: ids.group,
        lesson_id: ids.lesson,
        material_type: 'notes',
        title: 'Self-test notes',
        external_url: 'https://example.invalid/self-test-notes',
      },
      {
        id: ids.recording,
        group_id: ids.group,
        lesson_id: ids.lesson,
        material_type: 'recording',
        title: 'Self-test recording',
        external_url: 'https://example.invalid/self-test-recording',
      },
    ]);

    let linked = await linkStudentChannel(student, 'telegram', fakeTelegram);
    assert(linked?.ok, 'telegram link failed', linked);
    student = linked.student;
    linked = await linkStudentChannel(student, 'vk', fakeVk);
    assert(linked?.ok, 'vk link failed', linked);
    student = linked.student;
    const [byTg, byVk] = await Promise.all([studentByTelegram(fakeTelegram), studentByVk(fakeVk)]);
    assert(byTg?.id === ids.student && byVk?.id === ids.student, 'channels do not resolve to same student', { byTg: byTg?.id, byVk: byVk?.id });
    pass('one student across TG and VK');

    await canonicalizeStudent(student);
    let overview = await homeworkOverview(student);
    assert(overview.todo.length === 2 && overview.review.length === 0, 'initial homework overview mismatch', { todo: overview.todo.length, review: overview.review.length });
    pass('new homework appears in Need to do', { todo: 2 });

    const detailedSub = overview.todo.find(row => row.assignment.id === ids.detailed)?.submission;
    const briefSub = overview.todo.find(row => row.assignment.id === ids.brief)?.submission;
    assert(detailedSub?.id && briefSub?.id, 'submission rows were not created');

    await patch('homework_submissions', `id=eq.${encodeURIComponent(detailedSub.id)}`, { status: 'revision', checked_at: now });
    await canonicalizeStudent(student);
    const normalized = await submissionCard(student, detailedSub.id);
    assert(normalized?.submission?.status === 'assigned', 'legacy revision was not normalized', normalized?.submission);
    pass('legacy revision normalizes to assigned');

    const brief = await beginBrief(student, briefSub.id);
    assert(brief?.answers?.length === 3, 'brief answers unavailable', brief);
    const briefResult = await finalizeBrief(student, briefSub.id, ['2', 'wrong', '6'], 'self_test');
    assert(briefResult?.score === 2 && briefResult?.maxScore === 3, 'brief scoring mismatch', briefResult);
    assert(briefResult?.submission?.status === 'checked', 'brief did not become checked');
    assert(briefResult?.submission?.on_time === true, 'brief on_time mismatch', briefResult?.submission?.on_time);
    pass('brief auto-check', { score: '2/3', on_time: true });

    const files = [{ type: 'document', name: 'self-test.pdf', telegram_file_id: 'self_test_tg', file_id: 'doc1_1_selftest' }];
    const fileResult = await finalizeFiles(student, detailedSub.id, files, 'self_test');
    assert(fileResult?.submission?.status === 'submitted', 'file homework did not become submitted', fileResult);
    assert(fileResult?.submission?.on_time === true, 'file on_time mismatch', fileResult?.submission?.on_time);
    const duplicate = await finalizeFiles(student, detailedSub.id, files, 'self_test');
    assert(duplicate === null, 'duplicate finalization was accepted', duplicate);
    pass('file submit is atomic and idempotent', { on_time: true });

    overview = await homeworkOverview(student);
    assert(overview.todo.length === 0 && overview.review.length === 1 && overview.review[0].assignment.id === ids.detailed,
      'post-submit overview mismatch', { todo: overview.todo.length, review: overview.review.map(row => row.assignment.id) });
    pass('submitted work moves to On review');

    await patch('homework_submissions', `id=eq.${encodeURIComponent(detailedSub.id)}&status=eq.submitted`, {
      status: 'checked',
      checked_at: new Date().toISOString(),
      score: 7,
      max_score: 10,
      comment: 'self-test checked',
    });
    overview = await homeworkOverview(student);
    assert(overview.todo.length === 0 && overview.review.length === 0, 'checked work still appears active', overview);
    pass('checked work leaves active homework');

    const results = await resultsOverview(student);
    assert(results.total === 2 && results.completed === 2 && results.rows.length === 2,
      'results overview mismatch', { total: results.total, completed: results.completed, rows: results.rows.length });
    const detail = await resultDetail(student, detailedSub.id);
    assert(detail?.percent === 70 && detail?.submission?.comment === 'self-test checked', 'result detail mismatch', detail);
    pass('results history and score calculation', { total: 2, completed: 2, detailed_percent: 70 });

    const lessons = await lessonsOverview(student);
    assert(lessons.length === 1 && lessons[0].id === ids.lesson && lessons[0].materials.length === 2 && lessons[0].homework_count === 2,
      'lesson overview mismatch', lessons);
    const lesson = await lessonDetail(student, ids.lesson);
    assert(lesson?.materials?.length === 2 && lesson?.homework?.length === 2,
      'lesson detail mismatch', { materials: lesson?.materials?.length, homework: lesson?.homework?.length });
    const material = await lessonMaterial(student, ids.recording);
    assert(material?.material_type === 'recording', 'lesson material lookup mismatch', material);
    pass('lesson combines notes, recording and homework', { materials: 2, homework: 2 });

    return res.status(200).json({ ok: true, run, checks });
  } catch (error) {
    return res.status(500).json({ ok: false, run, checks, error: error.message, details: error.details || null });
  } finally {
    await del('lesson_materials', `id=in.(${ids.notes},${ids.recording})`).catch(() => {});
    await del('homework_submissions', `student_id=eq.${encodeURIComponent(ids.student)}`).catch(() => {});
    await del('homework_assignments', `id=in.(${ids.detailed},${ids.brief})`).catch(() => {});
    await del('students', `id=eq.${encodeURIComponent(ids.student)}`).catch(() => {});
    await del('lessons', `id=eq.${encodeURIComponent(ids.lesson)}`).catch(() => {});
    await del('groups', `id=eq.${encodeURIComponent(ids.group)}`).catch(() => {});
  }
}
