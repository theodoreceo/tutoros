-- ── MIGRATION: Bot v3 ────────────────────────────────────────────────────────
-- Run in Supabase SQL Editor AFTER migration_bot2.sql.

-- homework_submissions: per-task scores, max score, submitted files from Telegram
ALTER TABLE homework_submissions
  ADD COLUMN IF NOT EXISTS max_score       numeric,
  ADD COLUMN IF NOT EXISTS task_scores     jsonb,
  ADD COLUMN IF NOT EXISTS submitted_files jsonb;
