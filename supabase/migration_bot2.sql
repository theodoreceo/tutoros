-- ── MIGRATION: Telegram Bot v2 ───────────────────────────────────────────────
-- Run in Supabase SQL Editor AFTER migration_bot.sql.

-- homework_assignments: PDF file, multi-answer support, per-task config
ALTER TABLE homework_assignments
  ADD COLUMN IF NOT EXISTS file_id     text,
  ADD COLUMN IF NOT EXISTS answers     jsonb,
  ADD COLUMN IF NOT EXISTS task_config jsonb;

-- homework_submissions: store student's submitted answers for auto-check
ALTER TABLE homework_submissions
  ADD COLUMN IF NOT EXISTS student_answers jsonb;
