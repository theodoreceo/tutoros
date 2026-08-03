-- Adds support for one-student personal groups without changing existing groups.

alter table groups
  add column if not exists group_type text not null default 'mini_group';

update groups
set group_type = 'mini_group'
where group_type is null or group_type not in ('mini_group', 'individual');

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'groups_group_type_check'
  ) then
    alter table groups
      add constraint groups_group_type_check
      check (group_type in ('mini_group', 'individual'));
  end if;
end $$;
