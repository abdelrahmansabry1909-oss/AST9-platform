-- ═══════════════════════════════════════════════════════════════
--  20260809000000_upper_body_rom_columns_down.sql
--
--  Reverses 20260809000000_upper_body_rom_columns.sql by dropping the 21
--  columns it added.
--
--  ⚠ THIS IS DESTRUCTIVE IF THE FRONTEND HAS ALREADY WRITTEN TO THEM.
--  The forward migration is additive and loses nothing; this rollback drops
--  columns, and any upper-body measurement a coach has saved since it was
--  applied goes with them. There is no way to restore that data afterwards —
--  the values exist nowhere else, which is the entire reason the columns were
--  added.
--
--  Run this only while the columns are still empty — that is, before the
--  frontend write path ships. Once coaches are saving upper-body ROM, treat
--  this file as unusable and fix forward instead.
--
--  Reversing this rollback restores the columns but NOT their contents.
--
--  Safe to run when the columns are unused: no other column, constraint,
--  policy, function or row is touched, and the column COMMENTs are dropped
--  with their columns.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.rehab_objective_assessments
  DROP COLUMN IF EXISTS shoulder_abduction_left,
  DROP COLUMN IF EXISTS shoulder_abduction_right,
  DROP COLUMN IF EXISTS thoracic_rotation_left,
  DROP COLUMN IF EXISTS thoracic_rotation_right,
  DROP COLUMN IF EXISTS thoracic_extension,
  DROP COLUMN IF EXISTS thoracic_flexion,
  DROP COLUMN IF EXISTS cervical_rotation_left,
  DROP COLUMN IF EXISTS cervical_rotation_right,
  DROP COLUMN IF EXISTS cervical_flexion_note,
  DROP COLUMN IF EXISTS cervical_extension_note,
  DROP COLUMN IF EXISTS elbow_flexion_left,
  DROP COLUMN IF EXISTS elbow_flexion_right,
  DROP COLUMN IF EXISTS elbow_extension_left,
  DROP COLUMN IF EXISTS elbow_extension_right,
  DROP COLUMN IF EXISTS wrist_flexion_left,
  DROP COLUMN IF EXISTS wrist_flexion_right,
  DROP COLUMN IF EXISTS wrist_extension_left,
  DROP COLUMN IF EXISTS wrist_extension_right,
  DROP COLUMN IF EXISTS lumbar_flexion_range,
  DROP COLUMN IF EXISTS lumbar_extension_range,
  DROP COLUMN IF EXISTS si_joint_pain;

COMMIT;
