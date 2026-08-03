-- TutorOS minimal schema for a fresh Supabase project.
-- The bot is the only writer. Google Sheets will be a synchronized view.

create extension if not exists pgcrypto;

create table groups (
  id text primary key,
  name text not null,
  program text check (program in ('base', 'advanced')),
  group_type text not null default 'mini_group'
    check (group_type in ('mini_group', 'individual')),
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

-- Assignment and submission rows must be created in one transaction.
create or replace function public.create_homework_for_group(
  p_assignment_id text,
  p_group_id text,
  p_lesson_id text,
  p_topic text,
  p_due_date date,
  p_hw_type text,
  p_is_advanced boolean,
  p_file_id text,
  p_answers jsonb,
  p_task_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_count integer;
  v_assignment_inserted integer;
  v_existing_group_id text;
  v_existing_count integer;
begin
  if not exists (
    select 1 from groups where id = p_group_id and active = true
  ) then
    raise exception 'group_not_found_or_inactive';
  end if;

  if p_lesson_id is not null and not exists (
    select 1 from lessons
    where id = p_lesson_id and group_id = p_group_id and active = true
  ) then
    raise exception 'lesson_not_found_for_group';
  end if;

  select count(*)::integer
  into v_student_count
  from students
  where group_id = p_group_id and status = 'active';

  if v_student_count = 0 then
    raise exception 'group_has_no_active_students';
  end if;

  insert into homework_assignments (
    id, group_id, lesson_id, topic, description, due_date, hw_type,
    is_advanced, file_id, answers, task_config, assigned_at
  ) values (
    p_assignment_id, p_group_id, p_lesson_id, p_topic, '', p_due_date, p_hw_type,
    p_is_advanced, p_file_id, p_answers, p_task_config, now()
  )
  on conflict (id) do nothing;

  get diagnostics v_assignment_inserted = row_count;

  if v_assignment_inserted = 0 then
    select group_id
    into v_existing_group_id
    from homework_assignments
    where id = p_assignment_id;

    if v_existing_group_id is distinct from p_group_id then
      raise exception 'assignment_id_conflict';
    end if;

    select count(*)::integer
    into v_existing_count
    from homework_submissions
    where assignment_id = p_assignment_id;

    return jsonb_build_object(
      'assignment_id', p_assignment_id,
      'students_count', v_existing_count,
      'already_created', true
    );
  end if;

  insert into homework_submissions (
    id, assignment_id, student_id, status, source, submitted_at,
    score, comment
  )
  select
    'b' || replace(gen_random_uuid()::text, '-', ''),
    p_assignment_id,
    student.id,
    'assigned',
    'telegram',
    null,
    null,
    ''
  from students as student
  where student.group_id = p_group_id and student.status = 'active';

  return jsonb_build_object(
    'assignment_id', p_assignment_id,
    'students_count', v_student_count,
    'already_created', false
  );
end;
$$;

revoke all on function public.create_homework_for_group(
  text, text, text, text, date, text, boolean, text, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.create_homework_for_group(
  text, text, text, text, date, text, boolean, text, jsonb, jsonb
) to service_role;

-- No browser or client connects directly to these tables. RLS remains enabled
-- without anon/authenticated policies; the server-side Supabase secret bypasses it.
alter table groups enable row level security;
alter table lessons enable row level security;
alter table students enable row level security;
alter table homework_assignments enable row level security;
alter table homework_submissions enable row level security;
alter table bot_sessions enable row level security;
alter table sent_reminders enable row level security;
