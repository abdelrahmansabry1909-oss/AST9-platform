-- Rollback: Phase 13 system exercise library.
-- Removes ONLY the David Grey system import (source_key like 'dg:%').
-- Leaves coach-private exercises (source_key NULL) untouched.
delete from public.exercises where source_key like 'dg:%';
drop index if exists public.exercises_source_key_uniq;
alter table public.exercises
  drop column if exists source_section,
  drop column if exists source_program,
  drop column if exists source_file,
  drop column if exists source_key;
-- restore the original category constraint (modalities only)
alter table public.exercises drop constraint if exists exercises_category_check;
alter table public.exercises add constraint exercises_category_check
  check (category = any (array['Rehab','Mobility','Strength','Neurology','Breathing']));
