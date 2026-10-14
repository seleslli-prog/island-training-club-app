-- Members cannot read other people's bookings, so spots left must not be
-- counted from the bookings each browser can see. Keep one count on the
-- session row, which every viewer can read and realtime already refreshes.

alter table public.operational_sessions
  add column if not exists held_count integer not null default 0;

update public.operational_sessions s
   set held_count = (
     select count(*)
       from public.operational_bookings b
      where b.session_id = s.id
        and b.status in ('reserved', 'confirmed', 'attended')
   );

create or replace function public.refresh_operational_session_held_count(
  p_session_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_session_id is null then
    return;
  end if;
  update public.operational_sessions s
     set held_count = (
       select count(*)
         from public.operational_bookings b
        where b.session_id = p_session_id
          and b.status in ('reserved', 'confirmed', 'attended')
     )
   where s.id = p_session_id;
end;
$$;

create or replace function public.sync_operational_session_held_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_operational_session_held_count(old.session_id);
    return old;
  end if;
  perform public.refresh_operational_session_held_count(new.session_id);
  if tg_op = 'UPDATE' and old.session_id is distinct from new.session_id then
    perform public.refresh_operational_session_held_count(old.session_id);
  end if;
  return new;
end;
$$;

drop trigger if exists operational_bookings_sync_held_count on public.operational_bookings;
create trigger operational_bookings_sync_held_count
  after insert or update or delete on public.operational_bookings
  for each row execute function public.sync_operational_session_held_count();

revoke all on function public.refresh_operational_session_held_count(text)
  from public, anon, authenticated;
revoke all on function public.sync_operational_session_held_count()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
