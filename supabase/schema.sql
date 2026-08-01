-- TutorOS minimal schema for a fresh Supabase project.
-- The bot is the only writer. Google Sheets will be a synchronized view.

create extension if not exists pgcrypto;

create table course_templates (
  id text primary key,
  name text not null,
  program text not null check (program in ('base', 'advanced')),
  sheet_key text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table course_lessons (
  id text primary key,
  template_id text not null references course_templates(id) on delete cascade,
  sheet_lesson_key text not null,
  course_month text,
  course_week text,
  lesson_number text,
  sequence integer not null,
  topic text not null,
  block text,
  event_type text not null default 'lesson'
    check (event_type in ('lesson', 'webinar', 'test', 'half_mock', 'mock')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, sheet_lesson_key)
);

create table groups (
  id text primary key,
  name text not null,
  program text check (program in ('base', 'advanced')),
  template_id text references course_templates(id) on delete set null,
  target_score numeric,
  sheet_key text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lessons (
  id text primary key,
  group_id text not null references groups(id) on delete cascade,
  template_lesson_id text references course_lessons(id) on delete set null,
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
create index course_lessons_template_order_idx on course_lessons(template_id, sequence);
create index students_group_status_idx on students(group_id, status);
create index assignments_group_lesson_idx on homework_assignments(group_id, lesson_id);
create index submissions_student_status_idx on homework_submissions(student_id, status);

-- No browser or client connects directly to these tables. RLS remains enabled
-- without anon/authenticated policies; the server-side Supabase secret bypasses it.
alter table groups enable row level security;
alter table course_templates enable row level security;
alter table course_lessons enable row level security;
alter table lessons enable row level security;
alter table students enable row level security;
alter table homework_assignments enable row level security;
alter table homework_submissions enable row level security;
alter table bot_sessions enable row level security;
alter table sent_reminders enable row level security;

-- Applies one validated Google Sheets catalog snapshot in a single transaction.
create or replace function sync_course_catalog(
  p_templates jsonb,
  p_lessons jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  template_count integer;
  lesson_count integer;
begin
  insert into course_templates (
    id, name, program, sheet_key, active, updated_at
  )
  select
    item.id, item.name, item.program, item.sheet_key, item.active, now()
  from jsonb_to_recordset(p_templates) as item(
    id text, name text, program text, sheet_key text, active boolean
  )
  on conflict (id) do update set
    name = excluded.name,
    program = excluded.program,
    sheet_key = excluded.sheet_key,
    active = excluded.active,
    updated_at = now();

  update course_templates
  set active = false, updated_at = now()
  where id not in (
    select value->>'id' from jsonb_array_elements(p_templates)
  );

  insert into course_lessons (
    id, template_id, sheet_lesson_key, course_month, course_week,
    lesson_number, sequence, topic, block, event_type, active, updated_at
  )
  select
    item.id, item.template_id, item.sheet_lesson_key, item.course_month,
    item.course_week, item.lesson_number, item.sequence, item.topic,
    item.block, item.event_type, item.active, now()
  from jsonb_to_recordset(p_lessons) as item(
    id text, template_id text, sheet_lesson_key text, course_month text,
    course_week text, lesson_number text, sequence integer, topic text,
    block text, event_type text, active boolean
  )
  on conflict (id) do update set
    template_id = excluded.template_id,
    sheet_lesson_key = excluded.sheet_lesson_key,
    course_month = excluded.course_month,
    course_week = excluded.course_week,
    lesson_number = excluded.lesson_number,
    sequence = excluded.sequence,
    topic = excluded.topic,
    block = excluded.block,
    event_type = excluded.event_type,
    active = excluded.active,
    updated_at = now();

  update course_lessons
  set active = false, updated_at = now()
  where id not in (
    select value->>'id' from jsonb_array_elements(p_lessons)
  );

  select count(*) into template_count
  from course_templates where active = true;
  select count(*) into lesson_count
  from course_lessons where active = true;

  return jsonb_build_object(
    'templates', template_count,
    'lessons', lesson_count
  );
end;
$$;
