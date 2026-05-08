// src/neucore/program/RuleEngine.js
// IF/THEN rule processor — evaluates assessment + scores → safety decisions

// Exercises flagged unsafe per deficit
const DEFICIT_TO_CONTRA = {
  limited_df:            ['deep_squat', 'barbell_squat', 'plyometric_jumping', 'heavy_leg_press'],
  over_pronation:        ['plyometric_jumping', 'heavy_lunge'],
  stuck_supination:      ['plyometric_jumping'],
  limited_hip_ir:        ['deep_squat', 'barbell_squat', 'loaded_rotation'],
  hip_ir_asymmetry:      ['bilateral_loading', 'heavy_deadlift'],
  limited_hip_extension: ['barbell_squat', 'heavy_deadlift', 'heavy_lunge'],
  trendelenburg:         ['loaded_single_leg', 'heavy_lunge', 'step_up_with_load', 'plyometric_jumping'],
  sl_rdl_trunk_rotation: ['heavy_deadlift', 'loaded_rotation'],
  oh_squat_forward_lean: ['deep_squat', 'barbell_squat'],
  poor_balance_eo:       ['step_up_with_load', 'loaded_single_leg'],
};

// Phase gate rules — lock client to a max phase based on score thresholds
const PHASE_GATES = [
  {
    id:       'gate_pain',
    check:    s => (s.pain_flags?.length > 0) || s.referral_required,
    maxPhase: 'Phase 1',
    reason:   'Pain detected or referral required — Phase 1 only until cleared.',
    severity: 'critical',
  },
  {
    id:       'gate_composite_low',
    check:    s => s.composite_score != null && s.composite_score < 40,
    maxPhase: 'Phase 1',
    reason:   'Composite score < 40 — foundational mobility required first.',
    severity: 'high',
  },
  {
    id:       'gate_rom_critical',
    check:    s => s.rom_score != null && s.rom_score < 30,
    maxPhase: 'Phase 1',
    reason:   'ROM score < 30 — significant restrictions, decompression work required.',
    severity: 'high',
  },
  {
    id:       'gate_control_low',
    check:    s => s.control_score != null && s.control_score < 40,
    maxPhase: 'Phase 2',
    reason:   'Neuromuscular control insufficient — stability work before external load.',
    severity: 'moderate',
  },
  {
    id:       'gate_force_low',
    check:    s => s.force_score != null && s.force_score < 40,
    maxPhase: 'Phase 2',
    reason:   'Force production low — bodyweight progressions before resistance.',
    severity: 'moderate',
  },
];

export class RuleEngine {
  constructor(assessment, scores, gaitDeficits = []) {
    this.assessment   = assessment;
    this.scores       = scores;
    this.gaitDeficits = gaitDeficits;
  }

  // Returns { maxPhase, warnings }
  getMaxSafePhase() {
    const phaseOrder = { 'Phase 1': 1, 'Phase 2': 2, 'Phase 3': 3 };
    let maxPhase = 'Phase 3';
    const warnings = [];

    for (const gate of PHASE_GATES) {
      if (gate.check(this.scores)) {
        if (phaseOrder[gate.maxPhase] < phaseOrder[maxPhase]) maxPhase = gate.maxPhase;
        warnings.push({ rule: gate.id, reason: gate.reason, severity: gate.severity, maxPhase: gate.maxPhase });
      }
    }
    return { maxPhase, warnings };
  }

  // Returns array of contraindicated exercise pattern strings
  getContraindicated() {
    const contras = new Set();
    this.gaitDeficits.forEach(d => {
      (DEFICIT_TO_CONTRA[d.id] || []).forEach(c => contras.add(c));
    });
    return [...contras];
  }

  // Returns true if an exercise pattern keyword is safe for this client
  isSafe(exercisePatternKey) {
    return !this.getContraindicated().includes(exercisePatternKey);
  }

  // Full safety summary
  evaluate() {
    const { maxPhase, warnings } = this.getMaxSafePhase();
    const contraindicated        = this.getContraindicated();
    return {
      maxPhase,
      phaseWarnings:    warnings,
      contraindicated,
      overallRisk:      contraindicated.length === 0 ? 'low'
                        : contraindicated.length <= 3 ? 'moderate' : 'high',
    };
  }
}
