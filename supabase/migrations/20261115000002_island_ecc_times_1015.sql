-- From Sat 21 Nov 2026 the early Island ECC HYROX slot is 10:00 and the
-- later slot is 11:15. Earlier Saturdays keep their saved times.
-- Capacity, price, and session functions stay as they are.

update public.operational_activity_templates
   set start_time = time '10:00'
 where activity_id = 'hyrox-quarry-bay-early';

update public.operational_activity_templates
   set start_time = time '11:15'
 where activity_id = 'hyrox-quarry-bay';

update public.operational_sessions
   set start_time = time '10:00',
       time_tbc = false
 where activity_id = 'hyrox-quarry-bay-early'
   and session_date >= date '2026-11-21';

update public.operational_sessions
   set start_time = time '11:15',
       time_tbc = false
 where activity_id = 'hyrox-quarry-bay'
   and session_date >= date '2026-11-21';

notify pgrst, 'reload schema';
