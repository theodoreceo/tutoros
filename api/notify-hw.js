// api/notify-hw.js — Notify students about a new homework assignment
// Called by TutorOS after saveNewHw. POST { assignment_id }

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;

const SB = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
};

async function sbSelect(table, qs = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB });
  if (!r.ok) return [];
  return r.json();
}

async function sbOne(table, qs) {
  const rows = await sbSelect(table, qs + '&limit=1');
  return rows[0] ?? null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { assignment_id } = req.body ?? {};
  if (!assignment_id) return res.status(400).json({ error: 'Missing assignment_id' });

  try {
    const assignment = await sbOne('homework_assignments', `id=eq.${assignment_id}`);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const subs = await sbSelect('homework_submissions',
      `assignment_id=eq.${assignment_id}&select=student_id`);
    const studentIds = [...new Set(subs.map(s => s.student_id))];
    if (!studentIds.length) return res.status(200).json({ ok: true, sent: 0 });

    const students = await sbSelect('students',
      `id=in.(${studentIds.join(',')})&telegram_id=not.is.null&select=telegram_id`);

    const typeLabel = assignment.hw_type === 'brief' ? 'Краткий ответ'
      : assignment.hw_type === 'trial' ? 'Пробник'
      : assignment.is_advanced ? 'Подробный (сложный)' : 'Подробный';
    const due  = assignment.due_date ? `\nДедлайн: <b>${assignment.due_date}</b>` : '';
    const text = `📚 Новое ДЗ: <b>${assignment.topic || '—'}</b>\nТип: ${typeLabel}${due}\n\n/dz — открыть задания`;

    let sent = 0;
    for (const stu of students) {
      if (!stu.telegram_id) continue;
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chat_id: stu.telegram_id, text, parse_mode: 'HTML' }),
      }).catch(() => {});
      sent++;
    }

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('notify-hw error:', err);
    return res.status(500).json({ error: err.message });
  }
}
