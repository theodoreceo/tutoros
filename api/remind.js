// api/remind.js — Vercel Cron Function (runs at 09:05 UTC daily)
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, CRON_SECRET
// Vercel automatically injects "Authorization: Bearer {CRON_SECRET}" for cron invocations.
// No pg_cron needed — this function queries deadlines directly.

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;

const SB_HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
};

async function sbSelect(table, qs = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB_HEADERS });
  if (!r.ok) throw new Error(`sbSelect ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbInsert(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
    body:    JSON.stringify(body),
  });
  // 409 Conflict = already sent today (duplicate primary key) — that's fine
  if (!r.ok && r.status !== 409) throw new Error(`sbInsert ${table}: ${r.status} ${await r.text()}`);
  return r.status !== 409;
}

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Tomorrow's date in YYYY-MM-DD (matches how due_date is stored in the app)
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  // Find all assigned submissions with a deadline tomorrow, where student has a telegram_id
  const submissions = await sbSelect(
    'homework_submissions',
    `status=eq.assigned&select=id,student_id,assignment_id`
  );

  if (!submissions.length) return res.status(200).json({ sent: 0 });

  const assignmentIds = [...new Set(submissions.map(s => s.assignment_id))];
  const studentIds    = [...new Set(submissions.map(s => s.student_id))];

  const [assignments, students] = await Promise.all([
    sbSelect('homework_assignments',
      `id=in.(${assignmentIds.join(',')})&due_date=eq.${tomorrowStr}&select=id,topic`),
    sbSelect('students',
      `id=in.(${studentIds.join(',')})&telegram_id=not.is.null&select=id,telegram_id,name`),
  ]);

  if (!assignments.length || !students.length) return res.status(200).json({ sent: 0 });

  const aSet   = new Set(assignments.map(a => a.id));
  const aMap   = Object.fromEntries(assignments.map(a => [a.id, a]));
  const stuMap = Object.fromEntries(students.map(s => [s.id, s]));

  const targets = submissions.filter(sub =>
    aSet.has(sub.assignment_id) && stuMap[sub.student_id]
  );

  let sent = 0, skipped = 0, failed = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const sub of targets) {
    const stu        = stuMap[sub.student_id];
    const assignment = aMap[sub.assignment_id];

    // Insert into sent_reminders — returns false if already sent today (409)
    const isNew = await sbInsert('sent_reminders', {
      student_id:    sub.student_id,
      assignment_id: sub.assignment_id,
      sent_date:     today,
    });

    if (!isNew) { skipped++; continue; }

    try {
      const tgRes = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            chat_id:    stu.telegram_id,
            text:       `⏰ Напоминание: завтра дедлайн по ДЗ «${assignment.topic}». Не забудь сдать!`,
            parse_mode: 'HTML',
          }),
        }
      );
      const tgBody = await tgRes.json();
      if (tgBody.ok) { sent++; } else {
        console.warn(`TG error for ${stu.id}:`, tgBody.description);
        failed++;
      }
    } catch (err) {
      console.error(`Reminder threw for ${stu.id}:`, err.message);
      failed++;
    }
  }

  return res.status(200).json({ sent, skipped, failed });
}
