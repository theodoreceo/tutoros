-- Switches TutorOS identity and sessions completely to VK.

alter table students
  add column if not exists vk_id bigint;

create unique index if not exists students_vk_id_unique
  on students(vk_id)
  where vk_id is not null;

create table if not exists vk_sessions (
  vk_user_id bigint primary key,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table vk_sessions enable row level security;

alter table homework_submissions
  alter column source set default 'vk';

drop table if exists bot_sessions;

alter table students
  drop column if exists telegram_id;
