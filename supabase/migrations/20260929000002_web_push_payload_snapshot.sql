-- Web push: include notification snapshot in the pg_net body.
-- AFTER INSERT + async http_post can race the Edge Function's SELECT by id
-- (skipped: missing_notification). Passing NEW fields lets send-web-push
-- deliver without waiting for the commit to become visible.

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
    return NEW;
end;
$$;

comment on function public.request_web_push_delivery() is
  'AFTER INSERT fan-out to Edge Function send-web-push. Sends notification snapshot to avoid commit races.';
