// Receives groups and lessons from the private Google Sheets Apps Script.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNC_SECRET = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;

const SB_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_SECRET_KEY,
  'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
};

async function upsert(table, rows) {
  if (!rows.length) return;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    throw new Error(`${table}: ${response.status} ${await response.text()}`);
  }
}

const cleanText = (value, maxLength = 500) =>
  value === null || value === undefined ? null : String(value).trim().slice(0, maxLength);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SYNC_SECRET || req.headers['x-tutoros-sync-secret'] !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const rawGroups = Array.isArray(req.body?.groups) ? req.body.groups : [];
  const rawLessons = Array.isArray(req.body?.lessons) ? req.body.lessons : [];
  if (rawGroups.length > 100 || rawLessons.length > 1000) {
    return res.status(400).json({ error: 'Payload is too large' });
  }

  const groups = rawGroups.map(group => ({
    id: cleanText(group.id, 120),
    name: cleanText(group.name, 120),
    program: ['base', 'advanced'].includes(group.program) ? group.program : null,
    sheet_key: cleanText(group.sheet_key, 200),
    active: group.active !== false,
    updated_at: new Date().toISOString(),
  }));
  const lessons = rawLessons.map(lesson => ({
    id: cleanText(lesson.id, 120),
    group_id: cleanText(lesson.group_id, 120),
    sheet_lesson_key: cleanText(lesson.sheet_lesson_key, 200),
    course_month: cleanText(lesson.course_month, 40),
    course_week: cleanText(lesson.course_week, 40),
    lesson_number: cleanText(lesson.lesson_number, 40),
    sequence: Number.isInteger(Number(lesson.sequence)) ? Number(lesson.sequence) : 0,
    topic: cleanText(lesson.topic, 500),
    block: cleanText(lesson.block, 200),
    event_type: ['lesson', 'webinar', 'test', 'half_mock', 'mock'].includes(lesson.event_type)
      ? lesson.event_type
      : 'lesson',
    scheduled_date: cleanText(lesson.scheduled_date, 10) || null,
    active: lesson.active !== false,
    updated_at: new Date().toISOString(),
  }));

  if (groups.some(group => !group.id || !group.name)) {
    return res.status(400).json({ error: 'Every group requires id and name' });
  }
  if (lessons.some(lesson =>
    !lesson.id || !lesson.group_id || !lesson.sheet_lesson_key || !lesson.topic
  )) {
    return res.status(400).json({ error: 'Every lesson requires id, group_id, sheet_lesson_key and topic' });
  }

  try {
    await upsert('groups', groups);
    await upsert('lessons', lessons);
    return res.status(200).json({ ok: true, groups: groups.length, lessons: lessons.length });
  } catch (error) {
    console.error(`Sheet import failed: ${error.message}`);
    return res.status(500).json({ error: 'Synchronization failed' });
  }
}
