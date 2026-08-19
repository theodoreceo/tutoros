// api/archive.js — Vercel Cron Function: move expired homework into the archive.
// Runs shortly after midnight Moscow time. Archiving only changes the assignment
// visibility; student submissions stay intact so archived homework remains solvable.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;

const SB_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_SECRET_KEY,
  'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
};

async function sbSelect(table, qs = '') {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: SB_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`sbSelect ${table}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function sbPatch(table, qs, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`sbPatch ${table}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

const moscowDate = isoDate => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(isoDate));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const today = moscowDate(new Date().toISOString());
    const expired = await sbSelect(
      'homework_assignments',
      `archived_at=is.null&due_date=lt.${today}&select=id`
    );

    if (!expired.length) {
      return res.status(200).json({ archived: 0, date: today });
    }

    const ids = expired.map(row => row.id);
    const archivedAt = new Date().toISOString();
    const updated = await sbPatch(
      'homework_assignments',
      `id=in.(${ids.join(',')})&archived_at=is.null`,
      { archived_at: archivedAt }
    );

    return res.status(200).json({ archived: updated.length, date: today });
  } catch (error) {
    console.error('Homework archive cron failed:', error);
    return res.status(500).json({ error: error.message });
  }
}
