// src/neucore/gait/GaitRules.js
// Deficit → phase → compensation mappings for the simulation page.
//
// This engine and js/gaitEngine.js read the same assessment and are meant to
// say the same thing, but this one had ten rules to the other's fifteen, and
// eight of the ten were lower-limb. The simulation page — the one a coach
// actually looks at — therefore reported a purely lower-limb study even for a
// client whose shoulder and thoracic spine had been measured. The five rules
// the other engine already had are now here too.
//
// Phase keys must come from GAIT_PHASES in ../simulation/MuscleActivationDB.js.
// js/gaitEngine.js also uses 'initial_contact', which this engine has no phase
// for; initial contact is the start of loading response, so it maps there.

const RULES = [
  {
    id: 'limited_df',
    label: 'Limited Dorsiflexion',
    test: (a) => (parseFloat(a.ankle_dorsiflexion_left_cm) < 10 || parseFloat(a.ankle_dorsiflexion_right_cm) < 10),
    phases: ['loading_response', 'mid_stance', 'terminal_stance'],
    compensations: ['Early heel rise', 'Knee hyperextension', 'Forward trunk lean', 'Increased hip flexion'],
    future_risk: ['Plantar fasciitis', 'Patellar tendinopathy', 'Lumbar overload'],
    severity: { mild: 7, moderate: 5, severe: 3 },
    activeSeverity: 'moderate',
  },
  {
    id: 'over_pronation',
    label: 'Over-Pronation',
    test: (a) => (parseFloat(a.ankle_pronation_left) > 10 || parseFloat(a.ankle_pronation_right) > 10),
    phases: ['loading_response', 'mid_stance'],
    compensations: ['Knee valgus', 'Hip internal rotation', 'Arch collapse'],
    future_risk: ['Medial knee pain', 'IT band syndrome', 'Tibial stress fracture'],
    severity: { mild: 10, moderate: 15, severe: 20 },
    activeSeverity: 'mild',
  },
  {
    id: 'stuck_supination',
    label: 'Stuck Supination',
    test: (a) => (parseFloat(a.ankle_supination_left) > 10 || parseFloat(a.ankle_supination_right) > 10),
    phases: ['loading_response', 'mid_stance'],
    compensations: ['Lateral foot loading', 'Hip abduction compensation', 'Lateral knee stress'],
    future_risk: ['Peroneal tendinopathy', 'Lateral ankle sprain', 'IT band syndrome'],
    severity: { mild: 10, moderate: 15, severe: 20 },
    activeSeverity: 'mild',
  },
  {
    id: 'limited_hip_ir',
    label: 'Limited Hip Internal Rotation',
    test: (a) => (parseFloat(a.hip_ir_left) < 35 || parseFloat(a.hip_ir_right) < 35),
    phases: ['loading_response', 'mid_stance', 'terminal_stance'],
    compensations: ['Toe-out gait pattern', 'Pelvic rotation compensation', 'Femoral external rotation'],
    future_risk: ['Femoroacetabular impingement', 'Hip labral tear', 'Lumbar rotation overload'],
    severity: { mild: 35, moderate: 25, severe: 15 },
    activeSeverity: 'moderate',
  },
  {
    id: 'hip_ir_asymmetry',
    label: 'Hip IR Asymmetry',
    // `|| 0` turned an unmeasured side into a measured zero, so a client with
    // only the left hip recorded at 45 read as a 45-degree asymmetry. A
    // comparison needs both sides — the same guard AsymmetryDetector uses.
    test: (a) => {
      const l = parseFloat(a.hip_ir_left);
      const r = parseFloat(a.hip_ir_right);
      return !isNaN(l) && !isNaN(r) && Math.abs(l - r) > 15;
    },
    phases: ['mid_stance', 'terminal_stance', 'pre_swing'],
    compensations: ['Pelvic obliquity', 'Lumbar rotation', 'Asymmetric arm swing'],
    future_risk: ['Lumbar disc pathology', 'Hip labral tear', 'Sacroiliac joint dysfunction'],
    severity: { mild: 15, moderate: 20, severe: 30 },
    activeSeverity: 'moderate',
  },
  {
    id: 'limited_hip_extension',
    label: 'Limited Hip Extension',
    test: (a) => (parseFloat(a.hip_extension_left) < 10 || parseFloat(a.hip_extension_right) < 10),
    phases: ['terminal_stance', 'pre_swing'],
    compensations: ['Anterior pelvic tilt', 'Lumbar hyperextension', 'Premature heel rise'],
    future_risk: ['Lumbar facet syndrome', 'Hip flexor tendinopathy', 'Patellar tendinopathy'],
    severity: { mild: 10, moderate: 5, severe: 0 },
    activeSeverity: 'moderate',
  },
  {
    id: 'trendelenburg',
    label: 'Trendelenburg Sign',
    test: (a) => (parseFloat(a.sl_squat_l) < 3 || parseFloat(a.sl_squat_r) < 3),
    phases: ['mid_stance', 'terminal_stance'],
    compensations: ['Ipsilateral trunk lean', 'Contralateral pelvic drop', 'Compensatory arm abduction'],
    future_risk: ['Stress fracture', 'Hip OA progression', 'Lumbar lateral shift'],
    severity: { mild: 4, moderate: 3, severe: 2 },
    activeSeverity: 'severe',
  },
  {
    id: 'poor_balance_eo',
    label: 'Poor Single-Leg Balance',
    test: (a) => (parseFloat(a.bal_eo_l) < 30 || parseFloat(a.bal_eo_r) < 30),
    phases: ['mid_stance', 'terminal_stance', 'pre_swing'],
    compensations: ['Increased step width', 'Ankle strategy dominance', 'Reduced propulsion'],
    future_risk: ['Fall risk elevated', 'Ankle sprain recurrence', 'Poor sport performance'],
    severity: { mild: 30, moderate: 20, severe: 10 },
    activeSeverity: 'moderate',
  },
  {
    id: 'oh_squat_forward_lean',
    label: 'Overhead Squat Forward Lean',
    test: (a) => a.oh_squat_forward_lean === true || a.oh_squat_forward_lean === 'true',
    phases: ['loading_response', 'mid_stance'],
    compensations: ['Hip flexor dominance', 'Reduced ankle DF', 'Trunk extensor weakness'],
    future_risk: ['ACL stress', 'Lumbar disc degeneration'],
    severity: {},
    activeSeverity: 'mild',
  },
  {
    id: 'sl_rdl_trunk_rotation',
    label: 'SL RDL Trunk Rotation',
    // Was `a.sl_rdl_trunk_rotation`, fed from `g('ns-sl-rdl-rotation')` — an
    // element id that is not on the form, so the flag was always false and this
    // rule could never fire. The form records SL RDL as a 0-3 score, which is
    // what js/gaitEngine.js thresholds.
    test: (a) => (parseFloat(a.sl_rdl_l) <= 1 || parseFloat(a.sl_rdl_r) <= 1),
    phases: ['terminal_stance', 'pre_swing'],
    compensations: ['Hip hinge deficit', 'Hamstring dominance', 'Rotational instability'],
    future_risk: ['Hamstring strain', 'Lumbar rotation injury'],
    severity: { mild: 2, moderate: 1, severe: 0 },
    activeSeverity: 'mild',
  },

  // ── Parity with js/gaitEngine.js ────────────────────────────────
  // Five rules that engine has had all along. Without them the simulation
  // page could not report a shoulder, a thoracic spine or a painful lumbar
  // flexion, whatever the coach measured.
  {
    id: 'limited_hip_er',
    label: 'Limited Hip External Rotation',
    test: (a) => (parseFloat(a.hip_er_left) < 45 || parseFloat(a.hip_er_right) < 45),
    phases: ['pre_swing', 'initial_swing'],
    compensations: ['Reduced step length', 'Circumduction during swing', 'Pelvic drop'],
    future_risk: ['Femoroacetabular impingement', 'Sacroiliac joint dysfunction', 'Hamstring strain'],
    severity: { mild: 45, moderate: 38, severe: 30 },
    severityOf: (a) => (Math.min(parseFloat(a.hip_er_left) || 45, parseFloat(a.hip_er_right) || 45) < 30
      ? 'severe' : 'moderate'),
    activeSeverity: 'moderate',
  },
  {
    id: 'limited_shoulder_ir',
    label: 'Limited Shoulder Internal Rotation',
    test: (a) => (parseFloat(a.sh_ir_left) < 70 || parseFloat(a.sh_ir_right) < 70),
    // js/gaitEngine.js lists terminal_swing and initial_contact; this engine's
    // first phase IS initial contact through loading response.
    phases: ['terminal_swing', 'loading_response'],
    compensations: ['Trunk rotation to assist deceleration', 'Shortened step length', 'Altered arm swing pattern'],
    future_risk: ['Subacromial impingement', 'Posterior capsule contracture', 'Cervical overload'],
    severity: { mild: 70, moderate: 60, severe: 50 },
    severityOf: (a) => (Math.min(parseFloat(a.sh_ir_left) || 70, parseFloat(a.sh_ir_right) || 70) < 50
      ? 'severe' : 'mild'),
    activeSeverity: 'mild',
  },
  {
    id: 'limited_spine_flexion',
    label: 'Limited / Painful Spinal Flexion',
    test: (a) => a.sp_flex_pain === true,
    phases: ['loading_response'],
    compensations: ['Knee hyperextension to maintain COG', 'Hip flexor dominance', 'Flat lumbar spine'],
    future_risk: ['Lumbar disc pathology', 'Hip flexor tendinopathy', 'Loss of shock absorption'],
    severity: {},
    activeSeverity: 'severe',
  },
  {
    id: 'limited_thoracic_rotation',
    label: 'Limited Thoracic Rotation',
    // Neumann Table 9-11 puts thoracic axial rotation at 30 degrees each side.
    // The pain checkboxes stay as a fallback, but a stiff and painless
    // thoracic spine is the common presentation and only degrees will catch it.
    test: (a) => parseFloat(a.thoracic_rotation_left) < 30
              || parseFloat(a.thoracic_rotation_right) < 30
              || a.sp_rotl_pain === true || a.sp_rotr_pain === true,
    phases: ['mid_stance', 'terminal_stance'],
    compensations: ['Excessive lumbar rotation', 'Shoulder rotation compensation', 'Reduced arm swing'],
    future_risk: ['Lumbar rotation injury', 'Shoulder impingement', 'Raised energy cost of walking'],
    severity: { mild: 30, moderate: 22, severe: 15 },
    severityOf: (a) => {
      const w = Math.min(parseFloat(a.thoracic_rotation_left) || 30, parseFloat(a.thoracic_rotation_right) || 30);
      return w < 15 ? 'severe' : w < 22 ? 'moderate' : 'mild';
    },
    activeSeverity: 'moderate',
  },
  {
    id: 'poor_sl_balance_ec',
    label: 'Poor Single-Leg Balance, Eyes Closed',
    test: (a) => (parseFloat(a.bal_ec_l) < 10 || parseFloat(a.bal_ec_r) < 10),
    phases: ['mid_stance'],
    compensations: ['Significant sway pattern', 'Fall risk elevation', 'Avoidance of uneven surfaces'],
    future_risk: ['Fall risk elevated', 'Recurrent ankle sprain', 'Reduced outdoor activity'],
    severity: { mild: 10, moderate: 7, severe: 5 },
    severityOf: (a) => (Math.min(parseFloat(a.bal_ec_l) || 10, parseFloat(a.bal_ec_r) || 10) < 5
      ? 'severe' : 'moderate'),
    activeSeverity: 'moderate',
  },
];

export function evaluateGaitRules(assessment) {
  if (!assessment) return [];
  return RULES
    .filter(rule => {
      try { return rule.test(assessment); }
      catch { return false; }
    })
    .map(rule => ({
      ...rule,
      // Rules that can grade themselves from the measurement do so; the rest
      // keep the fixed severity they were written with. Consumers
      // (GaitPhaseStrip, PhaseAnalysisOverlay, ProgramGenerator) only ever read
      // activeSeverity, so it stays a string either way.
      activeSeverity: rule.severityOf ? rule.severityOf(assessment) : rule.activeSeverity,
      assessment,
    }));
}

// Exported for the parity test — the two engines are meant to cover the same
// deficits, and the only way that stays true is by comparing the id sets.
export const GAIT_RULE_IDS = RULES.map(r => r.id);
