-- Post-Training Lunch recurring default is 12:00. Sessions already at
-- another time are left as they are.

update public.operational_activity_templates
   set start_time = time '12:00'
 where activity_id = 'lunch'
   and start_time is distinct from time '12:00';

update public.operational_sessions
   set start_time = time '12:00'
 where activity_id = 'lunch'
   and start_time = time '12:45'
   and session_date >= date '2026-10-18';
