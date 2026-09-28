-- Canonical TutorOS workflow cleanup.
-- Idempotent migration for the post-VK/Telegram shared product model.

-- 1) Revision no longer exists in product semantics.
update homework_submissions
set status = 'assigned', checked_at = null
where status = 'revision';

alter table homework_submissions
  drop constraint if exists homework_submissions_status_check;

alter table homework_submissions
  add constraint homework_submissions_status_check
  check (status in ('assigned', 'submitted', 'checked', 'cancelled'));

-- 2) Keep one durable DB representation for detailed homework.
-- UI can still expose easy/hard; difficulty is stored in is_advanced.
update homework_assignments
set is_advanced = true, hw_type = 'detailed'
where hw_type = 'detailed_hard';

update homework_assignments
set is_advanced = false, hw_type = 'detailed'
where hw_type = 'detailed_easy';

alter table homework_assignments
  drop constraint if exists homework_assignments_hw_type_check;

alter table homework_assignments
  add constraint homework_assignments_hw_type_check
  check (hw_type in ('brief', 'detailed', 'trial'));

-- 3) Deadline and archive are separate concepts.
-- No SQL trigger or cron should archive homework merely because due_date passed.
-- set_homework_archived remains the explicit teacher-controlled archive operation.
