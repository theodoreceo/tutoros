// api/notify.js — Send Telegram notification to student after homework review
// Called by TutorOS frontend after saveReview. POST { submission_id }

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;

const SB = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
};

async function sbOne(table, qs) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`, { headers: SB });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] ?? null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { submission_id } = req.body ?? {};
  if (!submission_id) return res.status(400).json({ error: 'Missing submission_id' });

  try {
    const sub = await sbOne('homework_submissions', `id=eq.${submission_id}`);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    const student = await sbOne('students', `id=eq.${sub.student_id}`);
    if (!student?.telegram_id) return res.status(200).json({ ok: true, skipped: 'no_telegram' });

    const assignment = await sbOne('homework_assignments', `id=eq.${sub.assignment_id}`);
    const checker    = sub.checked_by ? await sbOne('roles', `id=eq.${sub.checked_by}`) : null;

    const checkerName  = checker?.name || 'Куратор';
    const topic        = assignment?.topic || '—';
    const taskConfig   = assignment?.task_config;
    const taskScores   = sub.task_scores;

    let scoreText = '';
    if (Array.isArray(taskConfig) && taskConfig.length && Array.isArray(taskScores)) {
      const lines    = taskConfig.map((max, i) => `  Задание ${i + 1}: ${taskScores[i] ?? 0}/${max}`);
      const total    = taskScores.reduce((a, b) => a + (b || 0), 0);
      const maxTotal = taskConfig.reduce((a, b) => a + b, 0);
      scoreText = `\n\nРасбалловка:\n${lines.join('\n')}\n\n<b>Итого: ${total}/${maxTotal}</b>`;
    } else if (sub.score !== null && sub.score !== undefined) {
      const max = sub.max_score ?? 100;
      scoreText = `\n\nОценка: <b>${sub.score}/${max}</b>`;
    }

    const commentText = sub.comment ? `\n\nКомментарий: ${sub.comment}` : '';
    const message     = `✅ Твоя работа «<b>${topic}</b>» проверена!${scoreText}${commentText}\n\nПроверил: ${checkerName}`;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: student.telegram_id, text: message, parse_mode: 'HTML' }),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
