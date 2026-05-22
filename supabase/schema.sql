-- TutorOS Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

drop table if exists history_log, hw_submissions, atasks, tasks, student_notes,
  homework_submissions, assistant_groups, events, payments, homework_assignments,
  lessons, students, expenses, modules, folders, groups, roles cascade;

create table groups (
  id text primary key, name text, schedule text,
  price_per_student numeric default 0, capacity integer,
  type text, created_at text
);

create table roles (
  id text primary key, name text, pin text,
  pages jsonb default '[]', can_edit boolean default false,
  "canEdit" boolean default false, "isOwner" boolean default false,
  role_type text, group_ids jsonb default '[]', created_at text
);

create table students (
  id text primary key, name text, contact text, grade text,
  group_id text, format text, crm_status text,
  price_per_hour numeric default 0, lessons_per_month numeric default 0,
  paid boolean default false, trial_score numeric, target_score numeric,
  source text, notes text, created_at text, first_contact_at text,
  left_at text, status_history jsonb default '[]', risk_reset_at text
);

create table payments (
  id text primary key, student_id text, date text,
  amount numeric default 0, method text, period text,
  sub_end text, note text, created_at text
);

create table expenses (
  id text primary key, date text, category text,
  amount numeric default 0, note text, channel text, created_at text
);

create table lessons (
  id text primary key, group_id text, date text, time text,
  topic text, hw_text text, hw text, hw_link text, materials_link text,
  student_attendance jsonb default '[]', led_by text,
  notes text, absent_ids jsonb default '[]', task_ids jsonb default '[]',
  difficulty text, mood text, created_at text
);

create table homework_assignments (
  id text primary key, group_id text, lesson_id text,
  title text, topic text, description text, due_date text,
  assigned_at text, hw_type text default 'detailed',
  is_advanced boolean default false, correct_answer text
);

create table homework_submissions (
  id text primary key, assignment_id text, student_id text,
  submission_url text, source text default 'manual',
  submitted_at text, status text default 'assigned',
  score numeric, comment text, errors jsonb default '[]',
  checked_by text, checked_at text
);

create table assistant_groups (
  id text primary key, role_id text, assistant_id text, group_id text
);

create table events (
  id text primary key, student_id text, date text, type text, text text,
  entity_type text, entity_id text, payload jsonb
);

create table student_notes (
  id text primary key, student_id text, date text, text text, author text
);

create table tasks (
  id text primary key, title text, description text, student_id text,
  type text, due_date text, done boolean default false,
  status text, created_at text
);

create table atasks (
  id text primary key, role_id text, title text, description text,
  assignee text, comment text, deadline text,
  status text default 'assigned', created_at text
);

create table hw_submissions (
  id text primary key, assignment_id text, student_id text,
  group_id text, assigned_at text, status text,
  submitted_at text, reviewed_at text
);

create table history_log (
  id text primary key, action text, description text,
  entity_type text, entity_id text, actor text,
  timestamp text, undo_data jsonb
);

create table modules (
  id text primary key, group_id text, title text, order_num numeric
);

create table folders (
  id text primary key, group_id text, module_id text, title text, color text
);

-- RLS: разрешить всё для anon
do $$
declare t text;
begin
  foreach t in array array[
    'groups','students','payments','expenses','modules','tasks','roles',
    'folders','lessons','atasks','events','student_notes','hw_submissions',
    'history_log','homework_assignments','homework_submissions','assistant_groups'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "anon_all" on %I for all to anon using (true) with check (true)', t
    );
  end loop;
end $$;
