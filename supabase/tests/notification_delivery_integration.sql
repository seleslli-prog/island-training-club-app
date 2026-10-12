\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'verification failed: %', message;
  end if;
end;
$$;

select pg_temp.assert_true(
  to_regclass('public.notifications') is not null,
  'notifications table must exist'
);
select pg_temp.assert_true(
  to_regclass('public.push_subscriptions') is not null,
  'push_subscriptions table must exist'
);
select pg_temp.assert_true(
  to_regclass('private.web_push_settings') is not null,
  'private web-push settings table must exist'
);

select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'applications'
       and column_name = 'session_alerts'
  ),
  'applications.session_alerts must exist'
);
select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'applications'
       and column_name = 'web_push_ops'
  ),
  'applications.web_push_ops must exist'
);
select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notifications'
       and column_name = 'destination'
  ),
  'notifications.destination must exist'
);

select pg_temp.assert_true(
  public.web_push_ops_kind_eligible('admin_application_submitted', 'Membership application submitted')
  and public.web_push_ops_kind_eligible('admin_application_approved', 'Application approved')
  and public.web_push_ops_kind_eligible('admin_role_promoted', 'Member promoted')
  and public.web_push_ops_kind_eligible('admin_membership_revoked', 'Membership revoked')
  and public.web_push_ops_kind_eligible('welcome', 'Welcome to Island Training Club')
  and public.web_push_ops_kind_eligible('operational_session_reminder_morning', 'Session this morning')
  and public.web_push_ops_kind_eligible('community_announcement_published', 'Announcement')
  and public.web_push_ops_kind_eligible('operational_session_venue_updated', 'Venue updated'),
  'all trusted notification categories must be push-eligible'
);

select pg_temp.assert_true(
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.applications'::regclass
       and tgname = 'applications_notify_admins_submitted'
  ),
  'application submission trigger must exist'
);
select pg_temp.assert_true(
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname = 'profiles_audit_role_change'
  ),
  'role-change trigger must exist'
);
select pg_temp.assert_true(
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.notifications'::regclass
       and tgname = 'notifications_request_web_push'
  ),
  'web-push delivery trigger must exist'
);

select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT')
  and has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT')
  and has_table_privilege('authenticated', 'public.push_subscriptions', 'UPDATE')
  and has_table_privilege('authenticated', 'public.push_subscriptions', 'DELETE'),
  'authenticated members must manage only their own subscriptions through RLS'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.push_subscriptions', 'SELECT'),
  'anonymous clients must not read push subscriptions'
);

select pg_temp.assert_true(
  pg_get_functiondef('public.request_web_push_delivery()'::regprocedure)
    like '%notification_id%'
    and pg_get_functiondef('public.request_web_push_delivery()'::regprocedure)
      like '%profile_id%'
    and pg_get_functiondef('public.request_web_push_delivery()'::regprocedure)
      like '%destination%',
  'delivery trigger must pass a notification snapshot to pg_net'
);

rollback;
\echo 'Notification creation and delivery contract verification passed.'
