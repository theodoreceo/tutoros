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

update homework_submissions
set source = 'vk'
where source = 'telegram';

-- Keep homework creation atomic, but mark every new submission as coming from VK.
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
  if not exists (select 1 from groups where id = p_group_id and active = true) then
    raise exception 'group_not_found_or_inactive';
  end if;

  if p_lesson_id is not null and not exists (
    select 1 from lessons
    where id = p_lesson_id and group_id = p_group_id and active = true
  ) then
    raise exception 'lesson_not_found_for_group';
  end if;

  select count(*)::integer into v_student_count
  from students where group_id = p_group_id and status = 'active';

  if v_student_count = 0 then raise exception 'group_has_no_active_students'; end if;

  insert into homework_assignments (
    id, group_id, lesson_id, topic, description, due_date, hw_type,
    is_advanced, file_id, answers, task_config, assigned_at
  ) values (
    p_assignment_id, p_group_id, p_lesson_id, p_topic, '', p_due_date, p_hw_type,
    p_is_advanced, p_file_id, p_answers, p_task_config, now()
  ) on conflict (id) do nothing;

  get diagnostics v_assignment_inserted = row_count;
  if v_assignment_inserted = 0 then
    select group_id into v_existing_group_id
    from homework_assignments where id = p_assignment_id;

    if v_existing_group_id is distinct from p_group_id then
      raise exception 'assignment_id_conflict';
    end if;

    select count(*)::integer into v_existing_count
    from homework_submissions where assignment_id = p_assignment_id;

    return jsonb_build_object(
      'assignment_id', p_assignment_id,
      'students_count', v_existing_count,
      'already_created', true
    );
  end if;

  insert into homework_submissions (
    id, assignment_id, student_id, status, source, submitted_at, score, comment
  )
  select
    'b' || replace(gen_random_uuid()::text, '-', ''),
    p_assignment_id, student.id, 'assigned', 'vk', null, null, ''
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

alter table homework_assignments
  add column if not exists archived_at timestamptz;

alter table homework_submissions
  drop constraint if exists homework_submissions_status_check;

alter table homework_submissions
  add constraint homework_submissions_status_check
  check (status in ('assigned', 'submitted', 'checked', 'revision', 'cancelled'));

create or replace function public.set_homework_archived(
  p_assignment_id text,
  p_archived boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer;
  v_pending_changed integer;
begin
  update homework_assignments
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end
  where id = p_assignment_id;

  get diagnostics v_changed = row_count;
  if v_changed = 0 then raise exception 'homework_not_found'; end if;

  if p_archived then
    update homework_submissions set status = 'cancelled'
    where assignment_id = p_assignment_id and status = 'assigned';
  else
    update homework_submissions set status = 'assigned'
    where assignment_id = p_assignment_id and status = 'cancelled';
  end if;

  get diagnostics v_pending_changed = row_count;
  return jsonb_build_object(
    'assignment_id', p_assignment_id,
    'archived', p_archived,
    'pending_changed', v_pending_changed
  );
end;
$$;

revoke all on function public.set_homework_archived(text, boolean)
from public, anon, authenticated;

grant execute on function public.set_homework_archived(text, boolean)
to service_role;

drop table if exists bot_sessions;

alter table students
  drop column if exists telegram_id;
