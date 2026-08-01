// Imports reusable course templates from the private Google Sheet.
// Actual student groups are created by the owner in Telegram.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNC_SECRET = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;

const SB_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_SECRET_KEY,
  'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
};

const cleanText = (value, maxLength = 500) =>
  value === null || value === undefined ? null : String(value).trim().slice(0, maxLength);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SYNC_SECRET || req.headers['x-tutoros-sync-secret'] !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const rawTemplates = Array.isArray(req.body?.templates) ? req.body.templates : [];
  const rawLessons = Array.isArray(req.body?.lessons) ? req.body.lessons : [];
  if (!rawTemplates.length) {
    return res.status(400).json({ error: 'At least one course template is required' });
  }
  if (rawTemplates.length > 20 || rawLessons.length > 1000) {
    return res.status(400).json({ error: 'Payload is too large' });
  }

  const templates = rawTemplates.map(template => ({
    id: cleanText(template.id, 32),
    name: cleanText(template.name, 120),
    program: ['base', 'advanced'].includes(template.program) ? template.program : null,
    sheet_key: cleanText(template.sheet_key, 200),
    active: template.active !== false,
  }));
  const lessons = rawLessons.map(lesson => ({
    id: cleanText(lesson.id, 32),
    template_id: cleanText(lesson.template_id, 32),
    sheet_lesson_key: cleanText(lesson.sheet_lesson_key, 100),
    course_month: cleanText(lesson.course_month, 40),
    course_week: cleanText(lesson.course_week, 40),
    lesson_number: cleanText(lesson.lesson_number, 40),
    sequence: Number.isInteger(Number(lesson.sequence)) ? Number(lesson.sequence) : 0,
    topic: cleanText(lesson.topic, 500),
    block: cleanText(lesson.block, 200),
    event_type: ['lesson', 'webinar', 'test', 'half_mock', 'mock'].includes(lesson.event_type)
      ? lesson.event_type
      : 'lesson',
    active: lesson.active !== false,
  }));

  const templateIds = new Set(templates.map(template => template.id));
  if (templates.some(template =>
    !template.id || !template.name || !template.program || !template.sheet_key
  )) {
    return res.status(400).json({ error: 'Every template requires id, name, program and sheet_key' });
  }
  if (lessons.some(lesson =>
    !lesson.id || !lesson.template_id || !lesson.sheet_lesson_key ||
    !lesson.topic || !templateIds.has(lesson.template_id)
  )) {
    return res.status(400).json({ error: 'Every lesson must belong to an imported template' });
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_course_catalog`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify({ p_templates: templates, p_lessons: lessons }),
  });
  if (!response.ok) {
    console.error(`Course import failed: ${response.status} ${await response.text()}`);
    return res.status(500).json({ error: 'Synchronization failed' });
  }

  const result = await response.json();
  return res.status(200).json({ ok: true, ...result });
}
