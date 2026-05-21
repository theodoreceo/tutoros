// api/remind.js — Vercel Cron Function (runs at 09:05 UTC daily)
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, CRON_SECRET
// Vercel automatically injects "Authorization: Bearer {CRON_SECRET}" for cron invocations.

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;

const SB_HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
};

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/pending_reminders?sent_at=is.null&order=id.asc`,
    { headers: SB_HEADERS }
  );
  const reminders = await r.json();

  if (!Array.isArray(reminders) || !reminders.length) {
    return res.status(200).json({ sent: 0 });
  }

  let sent = 0, failed = 0;
  for (const rem of reminders) {
    try {
      const tgRes = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            chat_id:    rem.telegram_id,
            text:       rem.message,
            parse_mode: 'HTML',
          }),
        }
      );
      const tgBody = await tgRes.json();
      if (!tgBody.ok) {
        console.warn(`TG error for reminder ${rem.id}:`, tgBody.description);
        failed++;
      } else {
        sent++;
      }
    } catch (err) {
      console.error(`Reminder ${rem.id} threw:`, err.message);
      failed++;
    }

    // Mark sent regardless of TG result to avoid retry loops (e.g. blocked bot)
    await fetch(
      `${SUPABASE_URL}/rest/v1/pending_reminders?id=eq.${rem.id}`,
      {
        method:  'PATCH',
        headers: SB_HEADERS,
        body:    JSON.stringify({ sent_at: new Date().toISOString() }),
      }
    );
  }

  return res.status(200).json({ sent, failed });
}
