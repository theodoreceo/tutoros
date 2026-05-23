-- Add color field to roles (for calendar display)
ALTER TABLE roles ADD COLUMN IF NOT EXISTS color text;

-- Settings table (also created in migration_forecast.sql — safe to re-run)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "settings_read" ON settings FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "settings_insert_auth" ON settings
    FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "settings_update_auth" ON settings
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO settings (key, value)
  VALUES ('default_retention_rate', '0.75'::jsonb)
  ON CONFLICT (key) DO NOTHING;
