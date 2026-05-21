-- TutorOS Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- ── Groups ────────────────────────────────────────────────────────────────────
create table if not exists groups (
  id text primary key,
  name text not null,
  schedule text,
  price_per_student numeric default 0,
  capacity integer,
  type text,
  created_at timestamptz default now()
);

-- ── Roles (assistants) ────────────────────────────────────────────────────────
create table if not exists roles (
  id text primary key,
  name text not null,
  role_type text,
  pages jsonb default '[]'::jsonb,
  can_edit boolean default false,
  pin text,
  created_at timestamptz default now()
);

-- ── Students ─────────────────────────────────────────────────────────────────
create table if not exists students (
  id text primary key,
  name text not null,
  contact text,
  grade text,
  group_id text references groups(id) on delete set null,
  format text default 'group',
  crm_status text default 'lead',
  price_per_hour numeric,
  lessons_per_month integer,
  paid boolean default false,
  trial_score numeric,
  target_score numeric,
  source text,
  notes text,
  risk_reset_at timestamptz,
  left_at text,
  first_contact_at text,
  status_history jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- ── Payments ─────────────────────────────────────────────────────────────────
create table if not exists payments (
  id text primary key,
  student_id text references students(id) on delete cascade,
  amount numeric default 0,
  date text,
  sub_end text,
  note text,
  created_at timestamptz default now()
);

-- ── Expenses ─────────────────────────────────────────────────────────────────
create table if not exists expenses (
  id text primary key,
  amount numeric default 0,
  date text,
  category text,
  note text,
  channel text,
  created_at timestamptz default now()
);

-- ── Lessons ──────────────────────────────────────────────────────────────────
create table if not exists lessons (
  id text primary key,
  group_id text references groups(id) on delete cascade,
  date text,
  start_time text,
  duration integer default 60,
  topic text,
  lesson_link text,
  materials_link text,
  homework_link text,
  led_by text,
  task_ids jsonb default '[]'::jsonb,
  notes text,
  student_attendance jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- ── Homework Assignments ──────────────────────────────────────────────────────
create table if not exists homework_assignments (
  id text primary key,
  group_id text references groups(id) on delete cascade,
  lesson_id text,
  topic text,
  description text,
  due_date text,
  hw_type text default 'detailed',
  is_advanced boolean default false,
  correct_answer text,
  assigned_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ── Homework Submissions ──────────────────────────────────────────────────────
create table if not exists homework_submissions (
  id text primary key,
  assignment_id text references homework_assignments(id) on delete cascade,
  student_id text references students(id) on delete cascade,
  status text default 'assigned',
  submission_url text,
  source text default 'manual',
  score numeric,
  comment text,
  errors jsonb default '[]'::jsonb,
  checked_by text,
  checked_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz default now()
);

-- ── Assistant ↔ Groups (many-to-many) ────────────────────────────────────────
create table if not exists assistant_groups (
  id text primary key,
  assistant_id text references roles(id) on delete cascade,
  group_id text references groups(id) on delete cascade,
  unique(assistant_id, group_id)
);

-- ── Events (student timeline) ─────────────────────────────────────────────────
create table if not exists events (
  id text primary key,
  entity_type text,
  entity_id text,
  event_type text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ── Student Notes ─────────────────────────────────────────────────────────────
create table if not exists student_notes (
  id text primary key,
  student_id text references students(id) on delete cascade,
  text text,
  author text,
  created_at timestamptz default now()
);

-- ── History Log ──────────────────────────────────────────────────────────────
create table if not exists history_log (
  id text primary key,
  action text,
  description text,
  entity_type text,
  entity_id text,
  payload jsonb,
  role_id text,
  created_at timestamptz default now()
);

-- ── Tasks ────────────────────────────────────────────────────────────────────
create table if not exists tasks (
  id text primary key,
  title text,
  description text,
  status text default 'open',
  assigned_to text,
  due_date text,
  created_at timestamptz default now()
);

-- ── Assistant Tasks ───────────────────────────────────────────────────────────
create table if not exists atasks (
  id text primary key,
  title text,
  description text,
  status text default 'open',
  assigned_to text,
  priority text,
  due_date text,
  created_at timestamptz default now()
);

-- ── Legacy HW submissions ────────────────────────────────────────────────────
create table if not exists hw_submissions (
  id text primary key,
  lesson_id text,
  student_id text,
  status text default 'pending',
  created_at timestamptz default now()
);

-- ── Modules & Folders (structure, kept for completeness) ─────────────────────
create table if not exists modules (
  id text primary key,
  name text,
  created_at timestamptz default now()
);

create table if not exists folders (
  id text primary key,
  name text,
  created_at timestamptz default now()
);

-- ── Disable RLS (internal tool — add policies before going public) ────────────
alter table groups              disable row level security;
alter table roles               disable row level security;
alter table students            disable row level security;
alter table payments            disable row level security;
alter table expenses            disable row level security;
alter table lessons             disable row level security;
alter table homework_assignments disable row level security;
alter table homework_submissions disable row level security;
alter table assistant_groups    disable row level security;
alter table events              disable row level security;
alter table student_notes       disable row level security;
alter table history_log         disable row level security;
alter table tasks               disable row level security;
alter table atasks              disable row level security;
alter table hw_submissions      disable row level security;
alter table modules             disable row level security;
alter table folders             disable row level security;
