-- TutorOS minimal schema for a fresh Supabase project.
-- The bot is the only writer. Google Sheets will be a synchronized view.

create extension if not exists pgcrypto;

create table groups (
  id text primary key,
  name text not null,
  program text check (program in ('base', 'advanced')),
  target_score numeric,
  sheet_key text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lessons (
  id text primary key,
  group_id text not null references groups(id) on delete cascade,
  sheet_lesson_key text not null,
  course_month text,
  course_week text,
  lesson_number text,
  sequence integer not null,
  topic text not null,
  block text,
  event_type text not null default 'lesson'
    check (event_type in ('lesson', 'webinar', 'test', 'half_mock', 'mock')),
  scheduled_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, sheet_lesson_key)
);

create table students (
  id text primary key,
  name text not null,
  group_id text not null references groups(id),
  status text not null default 'active'
    check (status in ('active', 'paused', 'left')),
  telegram_id bigint unique,
  reg_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  target_score numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table homework_assignments (
  id text primary key,
  group_id text not null references groups(id) on delete cascade,
  lesson_id text references lessons(id) on delete set null,
  topic text not null,
  description text not null default '',
  due_date date,
  hw_type text not null default 'detailed'
    check (hw_type in ('brief', 'detailed', 'trial')),
  is_advanced boolean not null default false,
  file_id text,
  correct_answer text,
  answers jsonb,
  task_numbers jsonb,
  task_config jsonb,
  assigned_at timestamptz not null default now()
);

create table homework_submissions (
  id text primary key,
  assignment_id text not null references homework_assignments(id) on delete cascade,
  student_id text not null references students(id) on delete cascade,
  status text not null default 'assigned'
    check (status in ('assigned', 'submitted', 'checked', 'revision')),
  source text not null default 'telegram',
  submitted_at timestamptz,
  checked_at timestamptz,
  score numeric,
  max_score numeric,
  student_answers jsonb,
  task_scores jsonb,
  submitted_files jsonb,
  comment text not null default '',
  on_time boolean,
  rno_status text not null default 'not_required'
    check (rno_status in ('not_required', 'required', 'completed')),
  unique (assignment_id, student_id)
);

create table bot_sessions (
  telegram_id bigint primary key,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table sent_reminders (
  student_id text not null references students(id) on delete cascade,
  assignment_id text not null references homework_assignments(id) on delete cascade,
  sent_date date not null default current_date,
  primary key (student_id, assignment_id, sent_date)
);

create index lessons_group_order_idx on lessons(group_id, sequence);
create index students_group_status_idx on students(group_id, status);
create index assignments_group_lesson_idx on homework_assignments(group_id, lesson_id);
create index submissions_student_status_idx on homework_submissions(student_id, status);

-- No browser or client connects directly to these tables. RLS remains enabled
-- without anon/authenticated policies; the server-side Supabase secret bypasses it.
alter table groups enable row level security;
alter table lessons enable row level security;
alter table students enable row level security;
alter table homework_assignments enable row level security;
alter table homework_submissions enable row level security;
alter table bot_sessions enable row level security;
alter table sent_reminders enable row level security;
