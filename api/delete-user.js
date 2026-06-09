// api/delete-user.js — Delete Supabase Auth user when a role is removed
// POST { role_id }

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SB = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { role_id } = req.body ?? {};
  if (!role_id) return res.status(400).json({ error: 'Missing role_id' });

  try {
    // 1. Get user_id from roles table
    const rolesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/roles?id=eq.${role_id}&select=user_id&limit=1`,
      { headers: SB }
    );
    if (!rolesRes.ok) return res.status(500).json({ error: 'Failed to fetch role' });

    const rows = await rolesRes.json();
    const user_id = rows[0]?.user_id;

    if (!user_id) {
      // No auth account linked — nothing to delete
      return res.status(200).json({ deleted: false, reason: 'no_auth_user' });
    }

    // 2. Delete auth user via Admin API
    const delRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${user_id}`,
      { method: 'DELETE', headers: SB }
    );

    if (!delRes.ok) {
      const err = await delRes.text();
      return res.status(500).json({ error: `Auth delete failed: ${err}` });
    }

    return res.status(200).json({ deleted: true, user_id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
