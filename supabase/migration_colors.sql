-- Add color field to roles (for calendar display)
ALTER TABLE roles ADD COLUMN IF NOT EXISTS color text;

-- Allow authenticated users (owner) to write to settings
-- (settings table was created in migration_forecast.sql with only SELECT policy)
DO $$ BEGIN
  CREATE POLICY "settings_insert_auth" ON settings
    FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "settings_update_auth" ON settings
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
