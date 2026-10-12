-- Island Training Club — production notification delivery repair
--
-- This is an idempotent convergence migration for environments where the
-- notification/push migrations were only partially applied. It preserves the
-- inbox as the source of truth and makes every trusted inbox event eligible
-- for push when the recipient has opted in and has a browser subscription.

create extension if not exists pg_net with schema extensions;

-- Older production attempts used session_reminders for this preference.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'applications'
       and column_name = 'session_reminders'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'applications'
       and column_name = 'session_alerts'
  ) then
    alter table public.applications rename column session_reminders to session_alerts;
  end if;
end $$;

alter table public.applications
  add column if not exists session_alerts boolean not null default true,
  add column if not exists web_push_ops boolean not null default false;

alter table public.notifications
  add column if not exists destination text;

-- Reassert the trusted application and role event producers. These triggers
-- are deliberately server-owned; browser clients still cannot insert inbox
-- rows or role audit records directly.
create or replace function public.notify_admins_application_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  applicant_name text;
  should_notify boolean := false;
begin
  if TG_OP = 'INSERT' then
    should_notify := NEW.submitted_at is not null;
  elsif TG_OP = 'UPDATE' then
    should_notify := OLD.submitted_at is null and NEW.submitted_at is not null;
  end if;

  if not should_notify then
    return NEW;
  end if;

  select coalesce(nullif(full_name, ''), email, 'A member')
    into applicant_name
    from public.profiles
   where id = NEW.profile_id;

  insert into public.notifications (profile_id, kind, title, body, destination)
  select id,
         'admin_application_submitted',
         'Membership application submitted',
         applicant_name || ' submitted a membership application.',
         '#/admin/approvals'
    from public.profiles
   where role in ('admin', 'super_admin');

  return NEW;
end;
$$;

drop trigger if exists applications_notify_admins_submitted on public.applications;
create trigger applications_notify_admins_submitted
  after insert or update of submitted_at on public.applications
  for each row execute function public.notify_admins_application_submitted();

create or replace function public.record_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_name text;
  actor_profile_id uuid;
  actor_name text;
  event_kind text;
  event_title text;
  event_body text;
  event_destination text;
begin
  if OLD.role is distinct from NEW.role then
    select id, coalesce(nullif(full_name, ''), email, 'An administrator')
      into actor_profile_id, actor_name
      from public.profiles
     where id = auth.uid();
    actor_name := coalesce(actor_name, 'An administrator');

    insert into public.role_changes (profile_id, changed_by, old_role, new_role)
    values (NEW.id, actor_profile_id, OLD.role, NEW.role);

    if NEW.role = 'member' then
      insert into public.notifications (profile_id, kind, title, body, destination)
      values (
        NEW.id,
        'welcome',
        'Welcome to Island Training Club',
        'Your application has been approved. You can now book sessions and access the member area.',
        '#/account'
      );
    end if;

    target_name := coalesce(nullif(NEW.full_name, ''), NEW.email, 'A member');
    event_kind := case
      when OLD.role = 'pending' and NEW.role = 'member' then 'admin_application_approved'
      when OLD.role = 'pending' and NEW.role = 'declined' then 'admin_application_declined'
      when OLD.role = 'member' and NEW.role = 'admin' then 'admin_role_promoted'
      when OLD.role = 'admin' and NEW.role = 'member' then 'admin_role_demoted'
      when OLD.role in ('member', 'admin') and NEW.role = 'pending' then 'admin_membership_revoked'
      else null
    end;

    if event_kind is not null then
      case event_kind
        when 'admin_application_approved' then
          event_title := 'Application approved';
          event_body := target_name || ' was approved by ' || actor_name || '.';
        when 'admin_application_declined' then
          event_title := 'Application declined';
          event_body := target_name || ' was declined by ' || actor_name || '.';
        when 'admin_role_promoted' then
          event_title := 'Member promoted';
          event_body := actor_name || ' promoted ' || target_name || ' from Member to Admin.';
        when 'admin_role_demoted' then
          event_title := 'Admin demoted';
          event_body := actor_name || ' changed ' || target_name || ' from Admin to Member.';
        when 'admin_membership_revoked' then
          event_title := 'Membership revoked';
          event_body := actor_name || ' revoked ' || target_name || '’s member access.';
      end case;
      event_destination := '#/admin/members';

      insert into public.notifications (profile_id, kind, title, body, destination)
      select id, event_kind, event_title, event_body, event_destination
        from public.profiles
       where role in ('admin', 'super_admin');
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists profiles_audit_role_change on public.profiles;
create trigger profiles_audit_role_change
  after update on public.profiles
  for each row execute function public.record_role_change();

create schema if not exists private;

create table if not exists private.web_push_settings (
  id          integer primary key default 1 check (id = 1),
  hook_secret text not null,
  hook_url    text,
  updated_at  timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.web_push_settings from public, anon, authenticated;

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
  on public.push_subscriptions for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
  on public.push_subscriptions for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
  on public.push_subscriptions for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
  on public.push_subscriptions for delete to authenticated
  using (profile_id = auth.uid());

revoke all on table public.push_subscriptions from public, anon;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;

-- Every trusted inbox category is eligible: application events, member/admin
-- role changes, welcome/member alerts, operations, reminders, and community
-- announcements. This includes admin_application_submitted,
-- admin_application_approved, admin_application_declined, admin_role_promoted,
-- admin_role_demoted, admin_membership_revoked, welcome,
-- community_announcement_published, operational_session_reminder_tomorrow,
-- and operational_session_reminder_morning. The notification insert boundary
-- remains trigger-owned and web_push_ops plus a subscription remain mandatory
-- delivery gates.
create or replace function public.web_push_ops_kind_eligible(p_kind text, p_title text)
returns boolean
language sql
immutable
as $$
  select true;
$$;

create or replace function public.request_web_push_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, private
as $$
declare
  v_url text;
  v_secret text;
  v_wants boolean;
  v_has_sub boolean;
begin
  if not public.web_push_ops_kind_eligible(NEW.kind, NEW.title) then
    return NEW;
  end if;

  select coalesce(a.web_push_ops, false) into v_wants
    from public.applications a
   where a.profile_id = NEW.profile_id;
  if not coalesce(v_wants, false) then
    return NEW;
  end if;

  select exists(
    select 1 from public.push_subscriptions s where s.profile_id = NEW.profile_id
  ) into v_has_sub;
  if not v_has_sub then
    return NEW;
  end if;

  select nullif(s.hook_secret, ''), nullif(s.hook_url, '')
    into v_secret, v_url
    from private.web_push_settings s
   where s.id = 1;

  v_url := coalesce(
    v_url,
    'https://krxbvgyolxvmzgysfjkj.supabase.co/functions/v1/send-web-push'
  );
  if v_secret is null then
    return NEW;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-web-push-secret', v_secret
    ),
    body := jsonb_build_object(
      'notification_id', NEW.id,
      'profile_id', NEW.profile_id,
      'kind', NEW.kind,
      'title', NEW.title,
      'body', NEW.body,
      'destination', NEW.destination
    )
  );
  return NEW;
exception
  when others then
    -- Inbox writes must never fail because an external push provider is down.
    return NEW;
end;
$$;

drop trigger if exists notifications_request_web_push on public.notifications;
create trigger notifications_request_web_push
  after insert on public.notifications
  for each row execute function public.request_web_push_delivery();

revoke all on function public.web_push_ops_kind_eligible(text, text)
  from public, anon, authenticated;
revoke all on function public.request_web_push_delivery()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
