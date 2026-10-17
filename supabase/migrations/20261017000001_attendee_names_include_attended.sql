-- Island Training Club — Who's coming keeps arrived members
--
-- Marking attendance changes a booking from confirmed to attended. Places
-- already counts those spots. Who's coming must keep the same people for
-- both Island ECC HYROX sessions.

create or replace function public.get_operational_attendee_names(
  p_session_id text
)
returns table(display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_is_roster_event boolean;
  v_profile_expr text;
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    return;
  end if;

  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select coalesce(t.price_hkd, 0) > 0 or coalesce(t.requires_rsvp, false)
    into v_is_roster_event
    from public.operational_sessions s
    join public.operational_activity_templates t
      on t.activity_id = s.activity_id
   where s.id = p_session_id;

  if not coalesce(v_is_roster_event, false) then
    return;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_bookings'
       and column_name = 'replacement_profile_id'
  ) then
    v_profile_expr := 'coalesce(b.replacement_profile_id, b.profile_id)';
  else
    v_profile_expr := 'b.profile_id';
  end if;

  return query execute format($query$
    select (
             coalesce(
               nullif(
                 trim(split_part(
                   trim(coalesce(nullif(trim(a.preferred_name), ''), p.full_name, 'Member')),
                   ' ',
                   1
                 )),
                 ''
               ),
               'Member'
             )
             || case
               when position(
                      ' ' in trim(coalesce(nullif(trim(p.full_name), ''), a.preferred_name, ''))
                    ) > 0
                 then ' ' || upper(left(
                   regexp_replace(
                     trim(coalesce(nullif(trim(p.full_name), ''), a.preferred_name)),
                     '^.*[[:space:]]+',
                     ''
                   ),
                   1
                 )) || '.'
               else ''
             end
           )::text
      from public.operational_bookings b
      join public.profiles p on p.id = %s
      left join public.applications a on a.profile_id = p.id
     where b.session_id = $1
       and b.status in ('confirmed', 'attended')
     order by b.created_at, b.id
  $query$, v_profile_expr)
  using p_session_id;
end;
$$;

revoke all on function public.get_operational_attendee_names(text)
  from public, anon, authenticated;
grant execute on function public.get_operational_attendee_names(text)
  to authenticated;

notify pgrst, 'reload schema';
