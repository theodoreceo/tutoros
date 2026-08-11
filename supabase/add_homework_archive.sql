-- Adds reversible homework archiving. Pending work is cancelled while
-- submitted and checked results remain untouched.

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
  set archived_at = case
    when p_archived then coalesce(archived_at, now())
    else null
  end
  where id = p_assignment_id;

  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    raise exception 'homework_not_found';
  end if;

  if p_archived then
    update homework_submissions
    set status = 'cancelled'
    where assignment_id = p_assignment_id and status in ('assigned', 'revision');
  else
    update homework_submissions
    set status = 'assigned'
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
