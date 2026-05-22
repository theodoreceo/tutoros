-- ── MIGRATION: Telegram Bot integration ──────────────────────────────────────
-- Run in Supabase SQL Editor AFTER migration_auth.sql.

-- 1. Extend students with Telegram fields
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS telegram_id bigint UNIQUE,
  ADD COLUMN IF NOT EXISTS reg_token   text   UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex');

-- 2. Extend roles with Telegram fields
ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS telegram_id bigint UNIQUE,
  ADD COLUMN IF NOT EXISTS reg_token   text   UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex');

-- NOTE: correct_answer already exists in homework_assignments. No action needed.

-- 3. Session state table (service role only — RLS ON with zero policies blocks anon/authenticated)
CREATE TABLE IF NOT EXISTS bot_sessions (
  telegram_id bigint      PRIMARY KEY,
  state       jsonb       NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bot_sessions ENABLE ROW LEVEL SECURITY;

-- 4. Sent-reminders log (dedup: prevents double-sending if cron runs twice)
--    Populated and drained by Vercel cron /api/remind (no pg_cron needed)
CREATE TABLE IF NOT EXISTS sent_reminders (
  student_id    text        NOT NULL,
  assignment_id text        NOT NULL,
  sent_date     date        NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (student_id, assignment_id, sent_date)
);
ALTER TABLE sent_reminders ENABLE ROW LEVEL SECURITY;
