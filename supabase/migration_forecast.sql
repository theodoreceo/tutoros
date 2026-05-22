-- Add subscription_type to students
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS subscription_type TEXT NOT NULL DEFAULT 'monthly'
    CHECK (subscription_type IN ('monthly', '3month', '6month'));

-- Default retention rate setting (fallback when payment history is insufficient)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_read" ON settings FOR SELECT TO authenticated USING (true);

INSERT INTO settings (key, value)
  VALUES ('default_retention_rate', '0.75'::jsonb)
  ON CONFLICT (key) DO NOTHING;
