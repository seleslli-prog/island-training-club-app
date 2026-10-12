-- Wednesday Night Training is a 90-minute recurring session.

update public.operational_activity_templates
   set duration_minutes = 90,
       updated_at = now()
 where activity_id = 'wnt';

update public.operational_sessions
   set duration_minutes = 90,
       updated_at = now()
 where activity_id = 'wnt'
   and cancelled_at is null
   and session_date >= current_date;

notify pgrst, 'reload schema';
