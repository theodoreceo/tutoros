-- Safe, non-destructive migration from the previous TutorOS database.
-- This script adds fields required by the minimal bot and preserves old tables.
-- Obsolete CRM tables should be dropped only after the new bot is verified.

create extension if not exists pgcrypto;

alter table groups
  add column if not exists program text,
  add column if not exists group_type text not null default 'mini_group',
  add column if not exists sheet_key text,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

-- Groups are managed directly in Telegram. A missing sheet_key is normal.

update groups
set group_type = 'mini_group'
where group_type is null or group_type not in ('mini_group', 'individual');

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'groups_group_type_check'
  ) then
    alter table groups
      add constraint groups_group_type_check
      check (group_type in ('mini_group', 'individual'));
  end if;
end $$;

alter table lessons
  add column if not exists sheet_lesson_key text,
  add column if not exists course_month text,
  add column if not exists course_week text,
  add column if not exists lesson_number text,
  add column if not exists sequence integer,
  add column if not exists block text,
  add column if not exists event_type text not null default 'lesson',
  add column if not exists scheduled_date date,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table students
  add column if not exists status text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists target_score numeric,
  add column if not exists telegram_id bigint,
  add column if not exists reg_token text default encode(gen_random_bytes(12), 'hex');

update students
set status = case
  when crm_status in ('active', 'trial') then 'active'
  when crm_status in ('paused') then 'paused'
  else 'left'
end
where status is null;

alter table students alter column status set default 'active';
alter table students alter column status set not null;

alter table homework_assignments
  add column if not exists lesson_id text,
  add column if not exists file_id text,
  add column if not exists answers jsonb,
  add column if not exists task_numbers jsonb,
  add column if not exists task_config jsonb,
  add column if not exists archived_at timestamptz;

alter table homework_submissions
  add column if not exists max_score numeric,
  add column if not exists student_answers jsonb,
  add column if not exists task_scores jsonb,
  add column if not exists submitted_files jsonb,
  add column if not exists on_time boolean,
  add column if not exists rno_status text not null default 'not_required';

create table if not exists bot_sessions (
  telegram_id bigint primary key,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists sent_reminders (
  student_id text not null,
  assignment_id text not null,
  sent_date date not null default current_date,
  primary key (student_id, assignment_id, sent_date)
);

-- The old website no longer exists, so browser roles must not retain broad access.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'groups', 'lessons', 'students', 'homework_assignments',
    'homework_submissions', 'bot_sessions', 'sent_reminders'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('drop policy if exists "anon_all" on %I', table_name);
    execute format('drop policy if exists "auth_all" on %I', table_name);
  end loop;
end $$;
