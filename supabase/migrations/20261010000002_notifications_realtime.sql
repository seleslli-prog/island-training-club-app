-- Island Training Club — live inbox / bell invalidation
--
-- Inbox rows are identity-scoped (self-read RLS). Adding them to Realtime lets
-- the signed-in Home Screen app update the bell and Notifications tab without
-- waiting for a manual tap on the icon.

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
