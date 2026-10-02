-- Expanded by verify_retired_hyrox_drift.py --sql. Disposable local only.
-- All fixtures, observed drift and repeated repair roll back, including on RED.
\set ON_ERROR_STOP on
begin;
create function pg_temp.drift_assert(ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'drift assertion failed'; end if; end;
$$;
create function pg_temp.drift_rows() returns jsonb language plpgsql as $$
declare t record; result jsonb := '{}'::jsonb; value text;
begin
  for t in select schemaname,tablename from pg_tables
    where schemaname in ('public','auth','supabase_migrations') order by 1,2 loop
    execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from %I.%I t',t.schemaname,t.tablename) into value;
    result := result || jsonb_build_object(t.schemaname||'.'||t.tablename,value);
  end loop;
  return result;
end;
$$;
create function pg_temp.drift_catalog() returns jsonb language sql as $$
select jsonb_build_array(
 (select jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proacl) order by p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
 (select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
 (select jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relowner) order by c.oid)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r'),
 (select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
 (select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r));
$$;
create temporary table drift_functions(signature text primary key);
-- POOL FUNCTION SIGNATURES
select pg_temp.drift_assert(count(*)=18) from drift_functions;
grant select on drift_functions to anon,authenticated;
-- Invoker rights: test actual permission errors for EVERY exact overload.
create function pg_temp.drift_denials() returns void language plpgsql as $$
declare f text; args text;
begin
 for f in select signature from drift_functions order by signature loop
  perform pg_temp.drift_assert(not has_function_privilege(current_user,f,'EXECUTE'));
  select string_agg('null::'||t,',') into args
   from unnest(string_to_array(substring(f from '\((.*)\)'),', ')) t;
  begin
   execute 'select '||split_part(f,'(',1)||'('||args||')';
   raise exception 'unexpected pool execute: %',f;
  exception when insufficient_privilege then null;
  end;
 end loop;
end; $$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('a2230000-0000-0000-0000-000000000001','drift-member@itc.invalid','{}');
update public.profiles set role='member' where id='a2230000-0000-0000-0000-000000000001';
insert into public.operational_sessions(id,activity_id,session_date,start_time,duration_minutes,venue,capacity,price_hkd,is_open)
 select activity_id||'-2098-01-04',activity_id,'2098-01-04',start_time,duration_minutes,venue,capacity,price_hkd,true
 from public.operational_activity_templates where activity_id in ('hyrox-bft','hyrox-midtown','hyrox-quarry-bay');
insert into public.operational_hyrox_cycles(id,session_date,bft_session_id,midtown_session_id,
 registration_opens_at,payment_deadline_at,holder_grace_deadline_at,promoted_payment_deadline_at,venue_choice_deadline_at)
 values('hyrox-pool-2098-01-04','2098-01-04','hyrox-bft-2098-01-04','hyrox-midtown-2098-01-04',
 '2098-01-01','2098-01-02','2098-01-02 01:00Z','2098-01-02 02:00Z','2098-01-03');
create temporary table drift_before as select pg_temp.drift_rows() rows,pg_temp.drift_catalog() catalog;

-- Exact private diagnostic drift: no PUBLIC ACL, two PUBLIC policies, browser
-- EXECUTE on the reviewed empty generator, three reminders and deadline sweeper.
create policy "public read HYROX cycles" on public.operational_hyrox_cycles for select to public using (true);
create policy "member read own HYROX cycle queues" on public.operational_hyrox_queue_entries
 for select to public using ((profile_id = (select auth.uid())) or public.operational_is_admin());
grant select on public.operational_hyrox_cycles to anon,authenticated;
grant select on public.operational_hyrox_queue_entries to authenticated;
grant execute on function public.ensure_hyrox_cycles(date,integer) to anon,authenticated;
grant execute on function public.send_hyrox_member_payment_reminders(timestamptz),
 public.send_hyrox_collector_payment_reminder(timestamptz),
 public.send_hyrox_venue_reminders(timestamptz),
 public.sweep_hyrox_cycle_deadlines(timestamptz) to authenticated;
select pg_temp.drift_assert(bool_and(has_function_privilege('authenticated',f,'EXECUTE')))
 from unnest(array['public.send_hyrox_member_payment_reminders(timestamptz)',
 'public.send_hyrox_collector_payment_reminder(timestamptz)',
 'public.send_hyrox_venue_reminders(timestamptz)',
 'public.sweep_hyrox_cycle_deadlines(timestamptz)']) f;
set local role authenticated;
select set_config('request.jwt.claim.sub','a2230000-0000-0000-0000-000000000001',true);
select pg_temp.drift_assert(exists(select 1 from public.operational_hyrox_cycles where id='hyrox-pool-2098-01-04'));
reset role;

-- APPLY 00003

select pg_temp.drift_assert(rows=pg_temp.drift_rows() and catalog=pg_temp.drift_catalog()) from drift_before;
-- Second application must be catalog- and row-idempotent, with no history edit.
-- APPLY 00003
select pg_temp.drift_assert(rows=pg_temp.drift_rows() and catalog=pg_temp.drift_catalog()) from drift_before;
do $$ declare r text; t text;
begin
 foreach r in array array['anon','authenticated'] loop
  foreach t in array array['operational_hyrox_cycles','operational_hyrox_queue_entries'] loop
   perform pg_temp.drift_assert(not has_table_privilege(r,'public.'||t,'SELECT'));
   perform pg_temp.drift_assert(not has_any_column_privilege(r,'public.'||t,'SELECT'));
  end loop;
  perform pg_temp.drift_assert(not has_function_privilege(r,'public.ensure_hyrox_cycles(date,integer)','EXECUTE'));
 end loop;
 for t in select signature from drift_functions loop
  foreach r in array array['anon','authenticated'] loop
   perform pg_temp.drift_assert(not has_function_privilege(r,t,'EXECUTE'));
  end loop;
  perform pg_temp.drift_assert(not exists(select 1 from pg_proc p,
   lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where p.oid=t::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'));
  foreach r in array array['postgres','service_role'] loop
   perform pg_temp.drift_assert(has_function_privilege(r,t,'EXECUTE'));
  end loop;
 end loop;
 perform pg_temp.drift_assert(has_table_privilege('service_role','public.operational_hyrox_cycles','SELECT'));
end; $$;
-- Actual SQL permission denials, not an empty retained-cohort success.
set local role anon;
select pg_temp.drift_denials();
do $$ begin
 begin perform public.send_hyrox_member_payment_reminders(now()); raise exception 'unexpected reminder execute'; exception when insufficient_privilege then null; end;
 begin perform public.send_hyrox_collector_payment_reminder(now()); raise exception 'unexpected reminder execute'; exception when insufficient_privilege then null; end;
 begin perform public.send_hyrox_venue_reminders(now()); raise exception 'unexpected reminder execute'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.operational_hyrox_cycles; raise exception 'unexpected read'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.operational_hyrox_queue_entries; raise exception 'unexpected read'; exception when insufficient_privilege then null; end;
 begin perform public.ensure_hyrox_cycles(current_date,1); raise exception 'unexpected execute'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
set local role authenticated;
select pg_temp.drift_denials();
do $$ begin
 begin perform public.send_hyrox_member_payment_reminders(now()); raise exception 'unexpected reminder execute'; exception when insufficient_privilege then null; end;
 begin perform public.send_hyrox_collector_payment_reminder(now()); raise exception 'unexpected reminder execute'; exception when insufficient_privilege then null; end;
 begin perform public.send_hyrox_venue_reminders(now()); raise exception 'unexpected reminder execute'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.operational_hyrox_cycles; raise exception 'unexpected read'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.operational_hyrox_queue_entries; raise exception 'unexpected read'; exception when insufficient_privilege then null; end;
 begin perform public.ensure_hyrox_cycles(current_date,1); raise exception 'unexpected execute'; exception when insufficient_privilege then null; end;
end; $$;
reset role;

-- Worst case: restore the FULL historical pool-only surface simultaneously,
-- including inherited PUBLIC plus explicit anon/authenticated EXECUTE on all 18.
create policy "public read HYROX cycles" on public.operational_hyrox_cycles for select to public using (true);
create policy "member read own HYROX cycle queues" on public.operational_hyrox_queue_entries
 for select to public using ((profile_id = (select auth.uid())) or public.operational_is_admin());
grant select on public.operational_hyrox_cycles,public.operational_hyrox_queue_entries to public,anon,authenticated;
do $$ declare f text; begin
 for f in select signature from drift_functions loop
  execute 'grant execute on function '||f||' to public,anon,authenticated';
  perform pg_temp.drift_assert(has_function_privilege('anon',f,'EXECUTE') and has_function_privilege('authenticated',f,'EXECUTE'));
 end loop;
end; $$;
-- ONE application closes every grant/policy, and preserves every other ACL/body/row.
-- APPLY 00003
select pg_temp.drift_assert(rows=pg_temp.drift_rows() and catalog=pg_temp.drift_catalog()) from drift_before;
set local role anon;
select pg_temp.drift_denials();
reset role;
set local role authenticated;
select pg_temp.drift_denials();
-- Shared guarded RPCs must stay authenticated, including payment approval.
select pg_temp.drift_assert(bool_and(has_function_privilege('authenticated',f,'EXECUTE')))
 from unnest(array['public.get_operational_attendee_names(text)',
 'public.reserve_operational_session(text)','public.mark_operational_payment(uuid,text,text)',
 'public.join_operational_queue(text,text)','public.release_operational_reservation(uuid)',
 'public.approve_operational_payment(uuid)','public.defer_operational_booking(uuid,text)',
 'public.set_operational_attendance(uuid,boolean)',
 'public.suppress_opted_out_hyrox_payment_reminder()']) f;
select pg_temp.drift_assert(exists(select 1 from public.operational_sessions where id='hyrox-quarry-bay-2098-01-04'));
select set_config(
  'itc.clock',
  ((((select session_date from public.operational_sessions where id='hyrox-quarry-bay-2098-01-04') - 5)
    + time '18:00') at time zone 'Asia/Hong_Kong')::text,
  true
);
select pg_temp.drift_assert((public.reserve_operational_session('hyrox-quarry-bay-2098-01-04')).session_id='hyrox-quarry-bay-2098-01-04');
reset role;
-- Independent inherited PUBLIC grants must also be closed; no default ACL fix.
grant select on public.operational_hyrox_cycles,public.operational_hyrox_queue_entries to public;
grant execute on function public.ensure_hyrox_cycles(date,integer),
 public.send_hyrox_member_payment_reminders(timestamptz),
 public.send_hyrox_collector_payment_reminder(timestamptz),
 public.send_hyrox_venue_reminders(timestamptz) to public,anon;
-- APPLY 00003
select pg_temp.drift_assert(catalog=pg_temp.drift_catalog()) from drift_before;
select 'OK: observed sweep/reminder drift, full 18-function re-grants, browser denial, preservation, idempotence, PUBLIC and Island ECC';
rollback;
