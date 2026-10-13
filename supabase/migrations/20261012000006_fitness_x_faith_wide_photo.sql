-- Refresh the Fitness x Faith event photo after the poster was replaced.
-- The query string bypasses the previously cached portrait asset.

update public.operational_activity_templates
   set photo_url = '/assets/itc/itc-fitness-x-faith-2.jpeg?v=wide'
 where name = 'ITC Fitness x Faith 2';

notify pgrst, 'reload schema';
