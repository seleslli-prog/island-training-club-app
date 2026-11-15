-- From Sat 21 Nov 2026 Post-Training Lunch is 12:30. Earlier Saturdays
-- keep their saved time. Capacity and session functions stay as they are.

update public.operational_activity_templates
   set start_time = time '12:30'
 where activity_id = 'lunch';

update public.operational_sessions
   set start_time = time '12:30',
       time_tbc = false
 where activity_id = 'lunch'
   and session_date >= date '2026-11-21';

notify pgrst, 'reload schema';
