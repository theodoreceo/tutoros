// api/cal.js — Apple Calendar subscription endpoint (Vercel Serverless)
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SB = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
};

export default async function handler(req, res) {
  const token = req.query?.token;
  if (!token) return res.status(401).send('Unauthorized');

  const settingsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/settings?key=eq.cal_token&select=value&limit=1`,
    { headers: SB }
  );
  const rows = await settingsRes.json();
  const stored = rows[0]?.value;
  if (!stored || stored !== token) return res.status(401).send('Invalid token');

  const [lessonsRes, groupsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/lessons?select=*&order=date.asc`, { headers: SB }),
    fetch(`${SUPABASE_URL}/rest/v1/groups?select=id,name`, { headers: SB }),
  ]);
  const lessons = await lessonsRes.json();
  const groups  = await groupsRes.json();
  const gMap    = Object.fromEntries(groups.map(g => [g.id, g.name]));

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//TutorOS//RU', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:TutorOS Занятия',
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
  ];

  for (const l of lessons) {
    if (!l.date) continue;
    const gr = gMap[l.group_id] || '';
    const [h, m] = (l.start_time || '09:00').split(':').map(Number);
    const dur     = l.duration || 60;
    const dt      = l.date.replace(/-/g, '');
    const pad     = n => String(n).padStart(2, '0');
    const dtStart = `${dt}T${pad(h)}${pad(m)}00`;
    const endMin  = h * 60 + m + dur;
    const dtEnd   = `${dt}T${pad(Math.floor(endMin / 60))}${pad(endMin % 60)}00`;
    lines.push('BEGIN:VEVENT');
    lines.push(`DTSTART;TZID=Europe/Moscow:${dtStart}`);
    lines.push(`DTEND;TZID=Europe/Moscow:${dtEnd}`);
    lines.push(`SUMMARY:${[l.topic || 'Занятие', gr].filter(Boolean).join(' · ')}`);
    lines.push(`UID:${l.id}@tutoros`);
    if (l.notes)          lines.push(`DESCRIPTION:${l.notes.replace(/\n/g, '\\n')}`);
    if (l.materials_link) lines.push(`URL:${l.materials_link}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.status(200).send(lines.join('\r\n'));
}
