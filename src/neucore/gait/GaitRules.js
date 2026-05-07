// src/neucore/gait/GaitRules.js
// 25+ deficit → phase → compensation mappings

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
    test: (a) => Math.abs((parseFloat(a.hip_ir_left) || 0) - (parseFloat(a.hip_ir_right) || 0)) > 15,
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
    test: (a) => a.sl_rdl_trunk_rotation === true || a.sl_rdl_trunk_rotation === 'true',
    phases: ['terminal_stance', 'pre_swing'],
    compensations: ['Hip hinge deficit', 'Hamstring dominance', 'Rotational instability'],
    future_risk: ['Hamstring strain', 'Lumbar rotation injury'],
    severity: {},
    activeSeverity: 'mild',
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
      assessment,
    }));
}
