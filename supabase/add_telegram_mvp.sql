-- Adds Telegram as a second TutorOS channel without replacing VK.
-- Safe to run repeatedly in Supabase SQL Editor.

alter table students
  add column if not exists telegram_id bigint;

create unique index if not exists students_telegram_id_unique
  on students(telegram_id)
  where telegram_id is not null;

create table if not exists telegram_sessions (
  telegram_user_id bigint primary key,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table telegram_sessions enable row level security;

alter table homework_assignments
  add column if not exists telegram_file_id text,
  add column if not exists material_name text,
  add column if not exists material_url text;

create table if not exists lesson_materials (
  id text primary key,
  group_id text not null references groups(id) on delete cascade,
  lesson_id text references lessons(id) on delete set null,
  material_type text not null
    check (material_type in ('notes', 'recording', 'other')),
  title text not null,
  external_url text,
  telegram_file_id text,
  vk_attachment text,
  file_name text,
  created_at timestamptz not null default now(),
  constraint lesson_materials_payload_check check (
    external_url is not null
    or telegram_file_id is not null
    or vk_attachment is not null
  )
);

alter table lesson_materials enable row level security;

create index if not exists lesson_materials_group_created_idx
  on lesson_materials(group_id, created_at desc);
create index if not exists lesson_materials_lesson_idx
  on lesson_materials(lesson_id, created_at desc);

-- Existing homework_submissions.source is intentionally not constrained.
-- New Telegram submissions use source='telegram'; VK keeps source='vk'.
