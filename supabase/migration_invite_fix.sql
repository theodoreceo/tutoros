-- Fix "permission denied for table users" when creating invite links
-- auth.users is not accessible to authenticated role; use auth.email() instead

DROP POLICY IF EXISTS "invites_self_read" ON invites;
CREATE POLICY "invites_self_read" ON invites FOR SELECT TO authenticated
  USING (email = auth.email());
