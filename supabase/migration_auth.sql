-- ─── MIGRATION: Supabase Auth integration ─────────────────────────────────────
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- PREREQUISITE: Disable email confirmations in Supabase Dashboard →
--   Authentication → Settings → Email Auth → uncheck "Enable email confirmations"

-- 1. Add user_id column to roles
ALTER TABLE roles ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) UNIQUE;

-- 2. Insert owner role if not exists
INSERT INTO roles (id, name, role_type, pages, can_edit, "canEdit", "isOwner", created_at)
SELECT 'owner', 'Владелец', 'owner', '[]'::jsonb, true, true, true, now()::text
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE id = 'owner');

-- 3. Create invites table
CREATE TABLE IF NOT EXISTS invites (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email     text        NOT NULL,
  role_id   text        NOT NULL,
  token     uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  used_at   timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- 4. Replace anon_all policies with authenticated policies
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'groups','students','payments','expenses','modules','tasks','roles',
    'folders','lessons','atasks','events','student_notes','hw_submissions',
    'history_log','homework_assignments','homework_submissions','assistant_groups'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon_all" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth_all" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "auth_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t
    );
  END LOOP;
END $$;

-- 5. RLS for invites
DROP POLICY IF EXISTS "invites_owner_rw" ON invites;
CREATE POLICY "invites_owner_rw" ON invites FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM roles WHERE user_id = auth.uid() AND role_type = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM roles WHERE user_id = auth.uid() AND role_type = 'owner'));

DROP POLICY IF EXISTS "invites_self_read" ON invites;
CREATE POLICY "invites_self_read" ON invites FOR SELECT TO authenticated
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- 6. Function: accept_invite — links authenticated user to the invited role
CREATE OR REPLACE FUNCTION accept_invite(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invite RECORD;
  v_user_email text;
BEGIN
  SELECT * INTO v_invite FROM invites WHERE token = p_token AND used_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Приглашение не найдено или уже использовано');
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();

  IF lower(v_invite.email) != lower(v_user_email) THEN
    RETURN jsonb_build_object('error', 'Email не совпадает с приглашением. Ожидался: ' || v_invite.email);
  END IF;

  IF EXISTS (SELECT 1 FROM roles WHERE id = v_invite.role_id AND user_id IS NOT NULL) THEN
    RETURN jsonb_build_object('error', 'Эта роль уже привязана к другому пользователю');
  END IF;

  UPDATE roles SET user_id = auth.uid() WHERE id = v_invite.role_id;
  UPDATE invites SET used_at = now() WHERE id = v_invite.id;

  RETURN jsonb_build_object('success', true, 'role_id', v_invite.role_id);
END;
$$;
GRANT EXECUTE ON FUNCTION accept_invite(uuid) TO authenticated;

-- 7. Function: claim_owner — first user to call this becomes the owner
CREATE OR REPLACE FUNCTION claim_owner()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roles WHERE role_type = 'owner' AND user_id IS NULL) THEN
    RETURN jsonb_build_object('error', 'Владелец уже назначен');
  END IF;
  UPDATE roles SET user_id = auth.uid() WHERE role_type = 'owner' AND user_id IS NULL;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION claim_owner() TO authenticated;

-- 8. Function: is_owner_claimed — callable by anon (no sensitive data)
CREATE OR REPLACE FUNCTION is_owner_claimed()
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM roles WHERE role_type = 'owner' AND user_id IS NOT NULL);
$$;
GRANT EXECUTE ON FUNCTION is_owner_claimed() TO anon, authenticated;
