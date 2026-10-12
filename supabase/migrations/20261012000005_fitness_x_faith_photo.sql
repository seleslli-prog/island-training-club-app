-- Give the live ITC Fitness x Faith 2 one-off event its event-specific photo.

alter table public.operational_activity_templates
  add column if not exists photo_url text;

update public.operational_activity_templates
   set photo_url = '/assets/itc/itc-fitness-x-faith-2.jpeg'
 where name = 'ITC Fitness x Faith 2';

notify pgrst, 'reload schema';
