-- Adds reusable course templates without deleting or rewriting existing groups.
-- Run once in the Supabase SQL editor before deploying the matching bot version.

create table if not exists course_templates (
  id text primary key,
  name text not null,
  program text not null check (program in ('base', 'advanced')),
  sheet_key text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists course_lessons (
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

alter table groups
  add column if not exists template_id text,
  add column if not exists target_score numeric;

alter table lessons
  add column if not exists template_lesson_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'groups_template_id_fkey'
  ) then
    alter table groups
      add constraint groups_template_id_fkey
      foreign key (template_id) references course_templates(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lessons_template_lesson_id_fkey'
  ) then
    alter table lessons
      add constraint lessons_template_lesson_id_fkey
      foreign key (template_lesson_id) references course_lessons(id) on delete set null;
  end if;
end $$;

create index if not exists course_lessons_template_order_idx
  on course_lessons(template_id, sequence);

alter table course_templates enable row level security;
alter table course_lessons enable row level security;

-- One request replaces the complete Google Sheets course catalog atomically.
-- Missing template lessons become inactive so historical group lessons survive.
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
