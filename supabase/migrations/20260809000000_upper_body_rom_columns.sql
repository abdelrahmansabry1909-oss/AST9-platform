-- ═══════════════════════════════════════════════════════════════
--  20260809000000_upper_body_rom_columns.sql
--
--  Give the upper-body measurements somewhere to live.
--
--  The objective assessment form collects shoulder abduction, thoracic,
--  cervical, elbow, wrist and lumbar range of motion. Every one of those is
--  read by `js/scoring.js`, scored, fed to the integration engine and drawn on
--  the scapular activation chart — and then discarded, because
--  `rehab_objective_assessments` has no column for any of them. A coach types a
--  number, sees it change the analysis, saves, and the number is gone.
--
--  Consequence before this migration: the analysis is correct only for the
--  session in which it is entered. A reassessment comparison shows change below
--  the pelvis and nothing above it, because nothing above the pelvis was ever
--  written down. Recorded as KNOWN_LIMITATIONS L21.
--
--  Every column added here is nullable and backed by a live input on the form.
--  Nothing is added speculatively: `hip_adduction_left/right` and the
--  `*_notes` / `toe_touch_observations` columns are likewise never written, but
--  they have no form input feeding them, so they are left exactly as they are
--  rather than being wired to invented data.
--
--  Types follow the neighbouring columns rather than a new convention:
--    · degrees              -> integer, matching hip_ir_left, shoulder_flexion_left
--    · free-text ranges     -> text,    matching spine_flexion_range
--    · pain / provocation   -> text,    matching ankle_pronation_left
--  No CHECK constraints, because no existing range column on this table has
--  one; adding them here alone would make the table inconsistent with itself
--  and would reject historical values the form has always allowed.
--
--  The 13 vestigial `spine_*` columns are deliberately NOT reused. They are
--  text buckets from an earlier design with no form input feeding them, and the
--  thoracic/lumbar data here is numeric degrees. Overloading them would bury
--  two different meanings in one column.
--
--  RLS and grants: unchanged, and none needed. Both policies on this table
--  (`rehab_obj_client_read`, `rehab_obj_coach_all`) are row-scoped with no
--  column list, and the table carries table-level grants only — verified
--  against supabase/baseline/production_public_schema.sql. New columns inherit
--  both automatically.
--
--  ⚠ DEPLOYMENT ORDER MATTERS. The write path in `js/dashboard.js` builds one
--  INSERT object; PostgREST rejects the entire insert if any column is unknown,
--  and that insert is wrapped in a catch that only console.warns
--  ("Supabase save (non-fatal)"). Shipping the frontend that writes these
--  columns BEFORE this migration is applied would therefore fail every
--  assessment save silently and lose all objective data, not just the new
--  fields. Apply this migration first; wire the frontend second.
--
--  Additive only: no existing column, constraint, policy, function or row is
--  modified. Safe to run against a live database.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.rehab_objective_assessments
  -- Shoulder abduction — the motion Neumann Fig. 5-51 actually measured, and
  -- the one the scapular activation chart prefers over flexion.
  ADD COLUMN IF NOT EXISTS shoulder_abduction_left   integer,
  ADD COLUMN IF NOT EXISTS shoulder_abduction_right  integer,

  -- Thoracic spine — the hinge between the shoulder girdle and the pelvis.
  -- Rotation here is what lets the girdle counter-rotate against the pelvis in
  -- gait; without a stored number, a stiff-but-painless thorax is invisible to
  -- every later comparison.
  ADD COLUMN IF NOT EXISTS thoracic_rotation_left    integer,
  ADD COLUMN IF NOT EXISTS thoracic_rotation_right   integer,
  ADD COLUMN IF NOT EXISTS thoracic_extension        integer,
  ADD COLUMN IF NOT EXISTS thoracic_flexion          integer,

  -- Cervical spine. Rotation is numeric on the form; flexion and extension are
  -- a free-text pain note ("P / NP"), so they are stored as written rather than
  -- coerced into a boolean that would lose the coach's qualifier.
  ADD COLUMN IF NOT EXISTS cervical_rotation_left    integer,
  ADD COLUMN IF NOT EXISTS cervical_rotation_right   integer,
  ADD COLUMN IF NOT EXISTS cervical_flexion_note     text,
  ADD COLUMN IF NOT EXISTS cervical_extension_note   text,

  -- Elbow and wrist. Collected and scored today, stored nowhere.
  ADD COLUMN IF NOT EXISTS elbow_flexion_left        integer,
  ADD COLUMN IF NOT EXISTS elbow_flexion_right       integer,
  ADD COLUMN IF NOT EXISTS elbow_extension_left      integer,
  ADD COLUMN IF NOT EXISTS elbow_extension_right     integer,
  ADD COLUMN IF NOT EXISTS wrist_flexion_left        integer,
  ADD COLUMN IF NOT EXISTS wrist_flexion_right       integer,
  ADD COLUMN IF NOT EXISTS wrist_extension_left      integer,
  ADD COLUMN IF NOT EXISTS wrist_extension_right     integer,

  -- Lumbar / sacrum. These two inputs are free text on the form (the engine
  -- parses the first number out of them), so the entered string is stored
  -- verbatim and the parse stays re-runnable. Note that the form's placeholder
  -- ranges disagree with the engine's Neumann norms — see KNOWN_LIMITATIONS
  -- L22. That is an unresolved clinical choice; this migration stores whatever
  -- the coach entered and takes no position on it.
  ADD COLUMN IF NOT EXISTS lumbar_flexion_range      text,
  ADD COLUMN IF NOT EXISTS lumbar_extension_range    text,
  ADD COLUMN IF NOT EXISTS si_joint_pain             text;

COMMENT ON COLUMN public.rehab_objective_assessments.shoulder_abduction_left IS
  'Degrees. Preferred over flexion by the scapular activation chart (Neumann Fig. 5-51 measured abduction).';
COMMENT ON COLUMN public.rehab_objective_assessments.thoracic_rotation_left IS
  'Degrees. Drives the gait counter-rotation and thoracic-shoulder rhythm rules in js/integrationEngine.js.';
COMMENT ON COLUMN public.rehab_objective_assessments.lumbar_flexion_range IS
  'Free text as entered by the coach; the engine parses the leading number. See KNOWN_LIMITATIONS L22.';
COMMENT ON COLUMN public.rehab_objective_assessments.si_joint_pain IS
  'Provocation test result as selected: ''yes'', ''no'', or empty when not assessed.';

COMMIT;
