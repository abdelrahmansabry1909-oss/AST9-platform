-- ═══════════════════════════════════════════════════════════════
--  20260807000000_rpm_phase_duration_weeks.sql
--
--  Give an RPM phase a real duration, so the Reactive Graph axis can encode
--  planned time instead of decoration.
--
--  Today the diagonal places phases at evenly spaced fractions
--  (t = (i + 1) / (N + 1)) — position carries sequence and nothing else. To make
--  distance mean duration, duration has to exist as a number. It does not.
--
--  It is worse than missing. `milestone_label` is a clinical statement — the four
--  rows in production hold text like "Bear weight in standing with quiet…" — but
--  the manual "+ Add phase" path in js/rpm/graph-builder.js writes
--  `milestone_label = "(6 weeks) "`, i.e. a duration and no milestone at all. Two
--  creation paths write incompatible content into one semantic field, and the
--  number a coach types is only recoverable by parsing a display string.
--
--  This migration separates the two concerns:
--    · `duration_weeks` holds the number.
--    · `milestone_label` goes back to holding only the clinical statement.
--
--  The backfill parses a leading "(N week)" / "(N weeks)" prefix into the new
--  column and strips it from the label. Against production today that matches
--  **zero of four rows**, so the data change is a verified no-op on current
--  content; it exists to correct any row the manual path has written since, and
--  to make the forward behaviour unambiguous.
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.rpm_phases
  add column if not exists duration_weeks integer;

-- A phase lasting zero or negative weeks is not a phase. NULL stays legal and
-- means "not scheduled yet" — the builder renders those as unscheduled rather
-- than guessing a length.
alter table public.rpm_phases
  drop constraint if exists rpm_phases_duration_weeks_check;
alter table public.rpm_phases
  add constraint rpm_phases_duration_weeks_check
  check (duration_weeks is null or (duration_weeks > 0 and duration_weeks <= 260));

comment on column public.rpm_phases.duration_weeks is
  'Planned length of the phase in whole weeks. NULL means unscheduled. The Reactive Graph positions phases by cumulative duration, so this drives layout, not just display.';

-- Backfill: lift a "(N weeks) " prefix out of the label and into the column.
update public.rpm_phases
   set duration_weeks = substring(milestone_label from '^\(\s*(\d+)\s+weeks?\s*\)')::integer
 where duration_weeks is null
   and milestone_label ~ '^\(\s*\d+\s+weeks?\s*\)'
   and substring(milestone_label from '^\(\s*(\d+)\s+weeks?\s*\)')::integer between 1 and 260;

-- …then remove that prefix so the label holds only the clinical statement again.
update public.rpm_phases
   set milestone_label = btrim(regexp_replace(milestone_label, '^\(\s*\d+\s+weeks?\s*\)\s*', ''))
 where duration_weeks is not null
   and milestone_label ~ '^\(\s*\d+\s+weeks?\s*\)';

commit;
