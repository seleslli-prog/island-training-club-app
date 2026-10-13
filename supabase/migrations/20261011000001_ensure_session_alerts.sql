-- Live production is missing applications.session_alerts. Allow on this phone
-- was PATCHing that column through the full privacy payload, and PostgREST
-- rejected the write. Add the column idempotently and reload the schema cache.

alter table public.applications
  add column if not exists session_alerts boolean not null default true;

notify pgrst, 'reload schema';
