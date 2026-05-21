-- ── MIGRATION: Telegram Bot integration ──────────────────────────────────────
-- Run in Supabase SQL Editor AFTER migration_auth.sql.
-- PREREQUISITE: Enable pg_cron extension first:
--   Dashboard → Database → Extensions → pg_cron → Enable

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

-- 4. Outbound reminder queue (filled by pg_cron, drained by Vercel cron /api/remind)
CREATE TABLE IF NOT EXISTS pending_reminders (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id bigint      NOT NULL,
  message     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
ALTER TABLE pending_reminders ENABLE ROW LEVEL SECURITY;

-- 5. pg_cron job: enqueue deadline reminders daily at 09:00 UTC
--    due_date is stored as text 'YYYY-MM-DD' throughout the app
SELECT cron.schedule(
  'hw-reminder-enqueue',
  '0 9 * * *',
  $$
    INSERT INTO pending_reminders (telegram_id, message)
    SELECT
      s.telegram_id,
      'Напоминание: завтра дедлайн по ДЗ «' || a.topic || '». Не забудь сдать!'
    FROM homework_submissions sub
    JOIN homework_assignments a ON a.id = sub.assignment_id
    JOIN students             s ON s.id = sub.student_id
    WHERE a.due_date    = to_char(CURRENT_DATE + INTERVAL '1 day', 'YYYY-MM-DD')
      AND sub.status    = 'assigned'
      AND s.telegram_id IS NOT NULL;
  $$
);
