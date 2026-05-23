-- Add color field to roles (for calendar display)
ALTER TABLE roles ADD COLUMN IF NOT EXISTS color text;

-- Allow authenticated users (owner) to write to settings
-- (settings table was created in migration_forecast.sql with only SELECT policy)
CREATE POLICY IF NOT EXISTS "settings_insert_auth" ON settings
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "settings_update_auth" ON settings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
