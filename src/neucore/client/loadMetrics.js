// src/neucore/client/loadMetrics.js
// Pure functions — turn raw assessment / gait data into a per-region
// load profile (0-100 %) for the Client Dashboard's Load Visualizer.
//
// Inputs are intentionally loose-typed so the function works whether
// the caller has a full assessment, a partial one, or nothing at all.
// When data is missing we fall back to illustrative defaults so the
// visualization remains useful for new clients.
//
// Returned shape:
//   {
//     currentA: { 'Lower Back': 70, 'Right Hip': 62, ... },
//     targetB:  { 'Lower Back': 25, 'Right Hip': 30, ... },
//     hasRealData: boolean,
//   }
//
// Phase-B note: the derivation here is a placeholder formula, not a
// clinically-validated one. It is deterministic, monotonic in pain +
// ROM deficit, and bounded 0-100. A future ADR can lock the real
// clinical formula in; the public surface of this module stays.

const REGIONS = ['Lower Back', 'Right Hip', 'Left Hip', 'Right Knee', 'Left Knee', 'Cervical'];

// Target state (Point B) — a reasonable "well-balanced" load profile.
// Same numbers for every region today; can be per-region later.
const TARGET_LOAD = {
  'Lower Back': 25,
  'Right Hip':  28,
  'Left Hip':   28,
  'Right Knee': 22,
  'Left Knee':  22,
  'Cervical':   18,
};

// Fallback Current state (Point A) when no real assessment exists yet.
// Matches the Phase-A mocked numbers so the look is consistent.
const FALLBACK_A = {
  'Lower Back': 70,
  'Right Hip':  62,
  'Left Hip':   55,
  'Right Knee': 45,
  'Left Knee':  40,
  'Cervical':   38,
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// joint_data is keyed by joint name (LumbarSpine, RightHip, …) and
// carries { pain_scale (0-10), rom fields, location[] } from the
// AssessmentPanel — same store used by the 3D body map.
function _painOf(jointData, key) {
  const v = jointData?.[key]?.pain_scale;
  return typeof v === 'number' ? clamp(v, 0, 10) : 0;
}

// Normalize a ROM deficit: actual is given in degrees / cm,
// `norm` is the normative value. Higher deficit → higher load.
function _romDeficit(actual, norm) {
  if (typeof actual !== 'number' || typeof norm !== 'number' || norm <= 0) return 0;
  const ratio = clamp(actual / norm, 0, 1);     // 1 = full ROM, 0 = none
  return (1 - ratio) * 100;                      // 0-100 deficit %
}

// Average two contributors, weighting joint pain more (pain is the
// strongest patient-perceived signal).
function _blend(painScale0to10, romDeficit0to100, baseline = 20) {
  const painLoad = painScale0to10 * 10;          // 0-10 → 0-100
  return clamp(baseline + 0.55 * painLoad + 0.45 * romDeficit0to100, 0, 100);
}

export function deriveLoadProfile(assessment) {
  if (!assessment || typeof assessment !== 'object') {
    return {
      currentA:    { ...FALLBACK_A },
      targetB:     { ...TARGET_LOAD },
      hasRealData: false,
    };
  }

  const j  = assessment.joint_data || {};
  const a  = assessment;

  const currentA = {
    'Lower Back': _blend(
      _painOf(j, 'LumbarSpine'),
      // Spine pain flags bump load even without ROM measurements
      (a.sp_flex_pain ? 30 : 0) + (a.sp_ext_pain ? 20 : 0),
    ),
    'Right Hip':  _blend(
      _painOf(j, 'RightHip'),
      Math.max(_romDeficit(a.hip_ir_right, 40), _romDeficit(a.hip_extension_right, 15)),
    ),
    'Left Hip':   _blend(
      _painOf(j, 'LeftHip'),
      Math.max(_romDeficit(a.hip_ir_left, 40), _romDeficit(a.hip_extension_left, 15)),
    ),
    'Right Knee': _blend(_painOf(j, 'RightKnee'), 0),
    'Left Knee':  _blend(_painOf(j, 'LeftKnee'),  0),
    'Cervical':   _blend(_painOf(j, 'CervicalSpine'), 0),
  };

  // hasRealData: at least one signal in the data
  const hasRealData =
    Object.values(j).some(v => v?.pain_scale > 0) ||
    REGIONS.some(r => currentA[r] > 25);

  return {
    currentA,
    targetB: { ...TARGET_LOAD },
    hasRealData,
  };
}

// Color map: 0 % = teal (balanced), 100 % = magenta (severe overload).
// Steps roughly match the platform's existing severity palette.
export function loadToColor(pct) {
  if (pct < 25) return '#3DF5C1';
  if (pct < 45) return '#67E8F9';
  if (pct < 60) return '#FACC15';
  if (pct < 75) return '#FF8800';
  return '#FF2D78';
}

// Region → joint hotspot key in GLBSkeleton.jointMeshes.
export const REGION_TO_JOINT = {
  'Lower Back':  'LumbarSpine',
  'Right Hip':   'RightHip',
  'Left Hip':    'LeftHip',
  'Right Knee':  'RightKnee',
  'Left Knee':   'LeftKnee',
  'Cervical':    'CervicalSpine',
};

export const ALL_REGIONS = REGIONS;
