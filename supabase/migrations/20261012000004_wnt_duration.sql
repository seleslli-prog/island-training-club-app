-- Wednesday Night Training is a 90-minute recurring session.

update public.operational_activity_templates
   set duration_minutes = 90,
       updated_at = now()
 where activity_id = 'wnt'
   and duration_minutes is distinct from 90;

update public.operational_sessions
   set duration_minutes = 90,
       updated_at = now()
 where activity_id = 'wnt'
   and cancelled_at is null
   and duration_minutes is distinct from 90
   and session_date >= (now() at time zone 'Asia/Hong_Kong')::date;

notify pgrst, 'reload schema';
