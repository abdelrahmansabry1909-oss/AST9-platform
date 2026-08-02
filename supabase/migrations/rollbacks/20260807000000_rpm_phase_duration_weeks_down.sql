-- ═══════════════════════════════════════════════════════════════
--  Rollback for 20260807000000_rpm_phase_duration_weeks.sql
--
--  Restores the previous shape: no `duration_weeks` column, and the duration
--  folded back into `milestone_label` as the "(N weeks) " prefix the manual
--  "+ Add phase" path used to write.
--
--  The re-prepend runs before the column is dropped, so no duration a coach
--  entered is silently lost — it returns to the display string it came from.
--  Rows whose label already carries a prefix are left alone, so this is safe to
--  run more than once.
--
--  ⚠ After this runs, the Reactive Graph axis has no duration to encode and
--  falls back to even spacing. Roll back only if the new column is causing
--  harm; it is additive and nullable, so it should not.
-- ═══════════════════════════════════════════════════════════════

begin;

update public.rpm_phases
   set milestone_label = '(' || duration_weeks || ' '
                       || case when duration_weeks = 1 then 'week' else 'weeks' end
                       || ') ' || coalesce(milestone_label, '')
 where duration_weeks is not null
   and coalesce(milestone_label, '') !~ '^\(\s*\d+\s+weeks?\s*\)';

alter table public.rpm_phases
  drop constraint if exists rpm_phases_duration_weeks_check;

alter table public.rpm_phases
  drop column if exists duration_weeks;

commit;
