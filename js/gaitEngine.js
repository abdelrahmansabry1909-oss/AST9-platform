// ═══════════════════════════════════════════════════════════════
//  js/gaitEngine.js
//  Gait Phase Analysis Engine
//  Maps assessment deficits → gait phase dysfunction
//  All phase mappings are clinically locked.
// ═══════════════════════════════════════════════════════════════

const GaitEngine = (() => {

  // ── GAIT PHASE METADATA ───────────────────────────────────
  const PHASES = {
    loading_response: { name: 'Loading Response',  pct: '0–10%',   icon: '①' },
    mid_stance:       { name: 'Mid-Stance',         pct: '10–30%',  icon: '②' },
    terminal_stance:  { name: 'Terminal Stance',    pct: '30–50%',  icon: '③' },
    pre_swing:        { name: 'Pre-Swing',           pct: '50–62%',  icon: '④' },
    initial_swing:    { name: 'Initial Swing',       pct: '62–73%',  icon: '⑤' },
    mid_swing:        { name: 'Mid-Swing',           pct: '73–87%',  icon: '⑥' },
    terminal_swing:   { name: 'Terminal Swing',      pct: '87–100%', icon: '⑦' },
    initial_contact:  { name: 'Initial Contact',     pct: '0%',      icon: '⓪' },
  };

  const SEV = { mild: 1, moderate: 2, severe: 3 };

  // ── GAIT RULES (clinically locked) ───────────────────────
  const RULES = [
    {
      id: 'limited_dorsiflexion',
      label: 'Limited Dorsiflexion (<10cm)',
      check: a => (a.ankle_df_l != null && a.ankle_df_l < 10)
                || (a.ankle_df_r != null && a.ankle_df_r < 10),
      severity: a => {
        const w = Math.min(a.ankle_df_l ?? 10, a.ankle_df_r ?? 10);
        return w < 6 ? 'severe' : w < 8 ? 'moderate' : 'mild';
      },
      phases: ['mid_stance', 'terminal_stance', 'initial_swing'],
      causes: ['limited_dorsiflexion'],
      compensations: ['Early heel rise', 'Vaulting gait', 'Shortened step length', 'Hip hiking during swing'],
      exercises: [
        'Ankle Rocker Mobilization (half-kneeling)',
        'Gastroc/Soleus Eccentric Lengthening',
        'Big Toe Extension Mobilization',
        'Tibialis Anterior Activation',
      ],
      exclusions: ['deep_squat', 'heavy_leg_press', 'barbell_squat'],
    },
    {
      id: 'over_pronation',
      label: 'Over-Pronation',
      check: a => a.pronation_l === 'over' || a.pronation_r === 'over'
                || (a.pronation_l && a.pronation_l.toLowerCase().includes('over'))
                || (a.pronation_r && a.pronation_r.toLowerCase().includes('over')),
      severity: () => 'moderate',
      phases: ['loading_response', 'mid_stance'],
      causes: ['over_pronation'],
      compensations: ['Medial knee collapse', 'Tibial internal rotation', 'Knee valgus', 'Glute medius overwork'],
      exercises: [
        'Foot Intrinsic Activation (Short Foot)',
        'Posterior Tibialis Strengthening',
        'Glute Medius Activation — Clamshell',
        'Supination Control Drills',
      ],
      exclusions: [],
    },
    {
      id: 'stuck_supination',
      label: 'Stuck Supination',
      check: a => a.supination_l === 'stuck_supinated' || a.supination_r === 'stuck_supinated'
                || (a.supination_l && a.supination_l.toLowerCase().includes('stuck'))
                || (a.supination_r && a.supination_r.toLowerCase().includes('stuck')),
      severity: () => 'moderate',
      phases: ['loading_response', 'terminal_stance', 'pre_swing'],
      causes: ['stuck_supination'],
      compensations: ['Heel slap', 'Lateral loading', 'Reduced 1st ray push-off', 'Proximal shock transfer'],
      exercises: [
        'Subtalar Joint Mobilization',
        'Peroneal Activation (resistance band eversion)',
        '1st Ray Mobilization (hallux extension weight-bearing)',
      ],
      exclusions: [],
    },
    {
      id: 'limited_hip_ir',
      label: 'Limited Hip Internal Rotation (<35°)',
      check: a => (a.hip_ir_l != null && a.hip_ir_l < 35)
                || (a.hip_ir_r != null && a.hip_ir_r < 35),
      severity: a => {
        const w = Math.min(a.hip_ir_l ?? 35, a.hip_ir_r ?? 35);
        return w < 20 ? 'severe' : w < 28 ? 'moderate' : 'mild';
      },
      phases: ['loading_response', 'mid_stance', 'terminal_stance'],
      causes: ['limited_hip_ir'],
      compensations: ['Foot pronation compensation', 'Knee valgus', 'Reduced hip extension in push-off'],
      exercises: [
        '90/90 Hip IR PAILs/RAILs (2min progressive)',
        'Hip IR Controlled Articular Rotations (CARs)',
        'Hip Extension + IR Combined',
      ],
      exclusions: ['loaded_rotation', 'heavy_deadlift'],
    },
    {
      id: 'hip_ir_asymmetry',
      label: 'Hip IR Asymmetry (>15°)',
      check: a => a.hip_ir_l != null && a.hip_ir_r != null
               && Math.abs(a.hip_ir_l - a.hip_ir_r) > 15,
      severity: () => 'moderate',
      phases: ['loading_response', 'mid_stance', 'terminal_stance'],
      causes: ['hip_ir_asymmetry', 'pelvic_rotation_dysfunction'],
      compensations: ['Lumbar rotation compensation', 'SI joint stress', 'Contralateral overload'],
      exercises: [
        'Prioritize limited-side Hip IR PAILs/RAILs',
        'Avoid bilateral loading until symmetry <15°',
        'SL Balance on limited side',
      ],
      exclusions: ['bilateral_loading'],
    },
    {
      id: 'limited_hip_er',
      label: 'Limited Hip External Rotation (<45°)',
      check: a => (a.hip_er_l != null && a.hip_er_l < 45)
                || (a.hip_er_r != null && a.hip_er_r < 45),
      severity: a => {
        const w = Math.min(a.hip_er_l ?? 45, a.hip_er_r ?? 45);
        return w < 30 ? 'severe' : 'moderate';
      },
      phases: ['pre_swing', 'initial_swing'],
      causes: ['limited_hip_er'],
      compensations: ['Reduced step length', 'Circumduction during swing', 'Pelvic drop'],
      exercises: [
        'Hip ER Mobilization (figure-4 PAILs)',
        'Deep External Rotator Strengthening',
        'Pigeon Stretch with PAILs/RAILs',
      ],
      exclusions: [],
    },
    {
      id: 'limited_hip_extension',
      label: 'Limited Hip Extension (<10°)',
      check: a => (a.hip_ext_l != null && a.hip_ext_l < 10)
                || (a.hip_ext_r != null && a.hip_ext_r < 10),
      severity: a => {
        const w = Math.min(a.hip_ext_l ?? 10, a.hip_ext_r ?? 10);
        return w < 5 ? 'severe' : 'moderate';
      },
      phases: ['terminal_stance', 'pre_swing'],
      causes: ['limited_hip_extension'],
      compensations: ['Anterior pelvic tilt', 'Lumbar extension compensation', 'Reduced propulsion'],
      exercises: [
        'Hip Flexor Lengthening (PRI 90/90 exhale-driven)',
        'Glute Max Activation (prone hip extension)',
        'RNT Hip Extension Pattern',
      ],
      exclusions: [],
    },
    {
      id: 'trendelenburg',
      label: 'Trendelenburg / SL Squat Collapse',
      check: a => (a.sl_squat_l != null && a.sl_squat_l <= 1)
                || (a.sl_squat_r != null && a.sl_squat_r <= 1)
                || (a.load_text && a.load_text.toLowerCase().includes('trendelenburg')),
      severity: a => {
        const w = Math.min(a.sl_squat_l ?? 3, a.sl_squat_r ?? 3);
        return w === 0 ? 'severe' : 'moderate';
      },
      phases: ['mid_stance'],
      causes: ['glute_medius_weakness'],
      compensations: ['Lateral trunk shift toward stance leg', 'Ipsilateral knee valgus', 'Contralateral hip drop'],
      exercises: [
        'Glute Medius Activation — Sidelying Abduction',
        'Clamshell with Resistance Band',
        'SL Stance Glute Med Activation (wall tap)',
      ],
      exclusions: ['loaded_single_leg', 'heavy_lunge', 'step_up_with_load'],
    },
    {
      id: 'sl_rdl_trunk_rotation',
      label: 'SL RDL Trunk Rotation / Core Instability',
      check: a => (a.sl_rdl_l != null && a.sl_rdl_l <= 1)
                || (a.sl_rdl_r != null && a.sl_rdl_r <= 1)
                || (a.load_text && a.load_text.toLowerCase().includes('rotation')),
      severity: () => 'moderate',
      phases: ['mid_stance', 'terminal_stance'],
      causes: ['core_stability_deficit'],
      compensations: ['SI joint shear force', 'Lumbar rotation', 'Lateral trunk lean'],
      exercises: [
        'Pallof Press (anti-rotation, cable or band)',
        'Dead Bug (contralateral, slow eccentric)',
        'Bird Dog (3-point, progressive)',
      ],
      exclusions: [],
    },
    {
      id: 'oh_squat_issues',
      label: 'OH Squat Compensation (heel rise / forward lean)',
      check: a => (a.oh_squat != null && a.oh_squat <= 1)
                || (a.load_text && (a.load_text.toLowerCase().includes('forward') || a.load_text.toLowerCase().includes('heel'))),
      severity: a => (a.oh_squat === 0 ? 'severe' : 'mild'),
      phases: ['loading_response', 'mid_stance'],
      causes: ['ankle_df_limitation', 'thoracic_deficit'],
      compensations: ['Heel rise (ankle dominant)', 'Forward lean (thoracic dominant)', 'Excessive knee flexion'],
      exercises: [
        'Ankle Dorsiflexion Mobilization (half-kneeling)',
        'Thoracic Extension CARs',
        'Heel-Raised Squat → Flat Progression',
      ],
      exclusions: [],
    },
    {
      id: 'limited_spine_flexion',
      label: 'Limited / Painful Spinal Flexion',
      check: a => a.sp_flex_pain || a.sp_flex_range === 'limited',
      severity: a => a.sp_flex_pain ? 'severe' : 'moderate',
      phases: ['loading_response'],
      causes: ['spinal_flexion_restriction'],
      compensations: ['Knee hyperextension to maintain COG', 'Hip flexor dominance', 'Flat lumbar spine'],
      exercises: [
        'Segmental Spinal Flexion — Cat-Camel',
        'PRI 90/90 Hip Lift (restore ZOA)',
        'Posterior Pelvic Tilt Activation',
      ],
      exclusions: [],
    },
    {
      id: 'limited_thoracic_rotation',
      label: 'Limited Thoracic Rotation',
      check: a => a.sp_rotl_pain || a.sp_rotr_pain
               || a.sp_rotl_range === 'limited' || a.sp_rotr_range === 'limited',
      severity: () => 'moderate',
      phases: ['mid_stance', 'terminal_stance'],
      causes: ['thoracic_rotation_restriction'],
      compensations: ['Excessive lumbar rotation', 'Shoulder rotation compensation', 'Reduced arm swing'],
      exercises: [
        'Thoracic Rotation CARs (seated or quadruped)',
        'Rib Mobilization (side-lying rotation)',
        'Sidelying Thoracic Rotation Stretch',
      ],
      exclusions: [],
    },
    {
      id: 'limited_shoulder_ir',
      label: 'Limited Shoulder IR (<70°)',
      check: a => (a.sh_ir_l != null && a.sh_ir_l < 70)
                || (a.sh_ir_r != null && a.sh_ir_r < 70),
      severity: a => {
        const w = Math.min(a.sh_ir_l ?? 70, a.sh_ir_r ?? 70);
        return w < 50 ? 'severe' : 'mild';
      },
      phases: ['terminal_swing', 'initial_contact'],
      causes: ['limited_shoulder_ir'],
      compensations: ['Trunk rotation to assist deceleration', 'Shortened step length', 'Altered arm swing pattern'],
      exercises: [
        'Shoulder IR Mobilization (Sleeper Stretch)',
        'Posterior Capsule Mobilization (cross-body)',
        'Shoulder IR PAILs/RAILs (90/90 position)',
      ],
      exclusions: [],
    },
    {
      id: 'poor_sl_balance_eo',
      label: 'Poor SL Balance Eyes Open (<30s)',
      check: a => (a.bal_eo_l != null && a.bal_eo_l < 30)
                || (a.bal_eo_r != null && a.bal_eo_r < 30),
      severity: a => {
        const w = Math.min(a.bal_eo_l ?? 30, a.bal_eo_r ?? 30);
        return w < 15 ? 'severe' : 'moderate';
      },
      phases: ['mid_stance'],
      causes: ['proprioceptive_deficit'],
      compensations: ['Hip strategy dominance', 'Increased step width for stability', 'Reduced single-leg loading time'],
      exercises: [
        'Single-Leg Balance Progressions (flat → foam)',
        'Proprioceptive Training — Eyes Open Reaching',
        'SL Stance Ball Toss (perturbation training)',
      ],
      exclusions: [],
    },
    {
      id: 'poor_sl_balance_ec',
      label: 'Poor SL Balance Eyes Closed (<10s)',
      check: a => (a.bal_ec_l != null && a.bal_ec_l < 10)
                || (a.bal_ec_r != null && a.bal_ec_r < 10),
      severity: a => {
        const w = Math.min(a.bal_ec_l ?? 10, a.bal_ec_r ?? 10);
        return w < 5 ? 'severe' : 'moderate';
      },
      phases: ['mid_stance'],
      causes: ['vestibular_proprioceptive_deficit'],
      compensations: ['Significant sway pattern', 'Fall risk elevation', 'Avoidance of uneven surfaces'],
      exercises: [
        'Vestibular Drills — Head Turns During SL Stance',
        'Tandem Stance → Tandem Walk',
        'Foam Pad Single-Leg Balance (eyes open → closed)',
      ],
      exclusions: [],
    },
  ];

  // ── MAIN ANALYSIS ─────────────────────────────────────────
  function analyze(assessment) {
    const a = assessment;
    const deficits = [];
    const phaseDeficiencies = {};
    const exercisePriorities = [];
    const exclusionSet = new Set();
    const seenExercises = new Set();

    RULES.forEach(rule => {
      if (!rule.check(a)) return;

      const sev = rule.severity(a);

      deficits.push({
        id:            rule.id,
        label:         rule.label,
        severity:      sev,
        phases:        rule.phases,
        causes:        rule.causes,
        compensations: rule.compensations,
        exercises:     rule.exercises,
      });

      // Aggregate into phase buckets
      rule.phases.forEach(ph => {
        if (!phaseDeficiencies[ph]) {
          phaseDeficiencies[ph] = { severity: 'mild', causes: [], compensations: [] };
        }
        // Escalate severity
        if ((SEV[sev] || 0) > (SEV[phaseDeficiencies[ph].severity] || 0)) {
          phaseDeficiencies[ph].severity = sev;
        }
        rule.causes.forEach(c       => { if (!phaseDeficiencies[ph].causes.includes(c))        phaseDeficiencies[ph].causes.push(c); });
        rule.compensations.forEach(c => { if (!phaseDeficiencies[ph].compensations.includes(c)) phaseDeficiencies[ph].compensations.push(c); });
      });

      // Collect ordered exercises (dedup)
      rule.exercises.forEach(ex => {
        if (!seenExercises.has(ex)) { seenExercises.add(ex); exercisePriorities.push(ex); }
      });

      rule.exclusions.forEach(ex => exclusionSet.add(ex));
    });

    // Symmetry index (higher = more symmetric)
    const sidePairs = [
      [a.hip_ir_l,   a.hip_ir_r,   35],
      [a.hip_er_l,   a.hip_er_r,   45],
      [a.ankle_df_l, a.ankle_df_r, 10],
      [a.bal_eo_l,   a.bal_eo_r,   30],
      [a.sh_ir_l,    a.sh_ir_r,    70],
    ];
    const symScores = sidePairs
      .filter(([L, R]) => L != null && R != null && L >= 0 && R >= 0)
      .map(([L, R, norm]) => Math.max(0, 100 - (Math.abs(L - R) / norm) * 100));
    const symmetryIndex = symScores.length
      ? Math.round(symScores.reduce((a, b) => a + b, 0) / symScores.length)
      : 100;

    return {
      deficits,
      phase_deficiencies:  phaseDeficiencies,
      symmetry_index:      symmetryIndex,
      worst_case_scenario: _worstCase(deficits),
      exercise_priorities: exercisePriorities,
      exercise_exclusions: [...exclusionSet],
      total_deficits:      deficits.length,
      gait_phases:         PHASES,
    };
  }

  function _worstCase(deficits) {
    if (!deficits.length) {
      return 'No significant gait deficits detected. Movement pattern appears within functional limits.';
    }
    const severe   = deficits.filter(d => d.severity === 'severe');
    const moderate = deficits.filter(d => d.severity === 'moderate');
    let text = '';
    if (severe.length) {
      text += `CRITICAL: Severe deficits in ${severe.map(d => d.label).join(', ')}. `;
      text += 'Without intervention these patterns will drive progressive joint loading asymmetry and elevated injury risk. ';
    }
    if (moderate.length) {
      text += `Moderate deficits in ${moderate.map(d => d.label).join(', ')} `;
      text += 'will perpetuate kinetic chain compensations if untreated.';
    }
    return text;
  }

  // ── RENDER GAIT ANALYSIS INTO DOM ────────────────────────
  function renderGaitAnalysis(gait) {
    const panel = document.getElementById('gait-panel');
    if (!panel) return;

    if (!gait.total_deficits) {
      panel.innerHTML = `
        <div class="card">
          <div class="card-header"><span class="card-title">Gait Analysis</span></div>
          <div style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">
            ✓ No significant gait deficits detected
          </div>
        </div>`;
      panel.classList.remove('hidden');
      return;
    }

    // Severity colour map
    const sevColor = { mild: 'var(--teal)', moderate: 'var(--amber)', severe: 'var(--rose)' };
    const sevBg    = { mild: 'rgba(61,245,193,0.08)', moderate: 'rgba(245,200,66,0.08)', severe: 'rgba(245,66,108,0.08)' };
    const sevBdr   = { mild: 'rgba(61,245,193,0.2)',  moderate: 'rgba(245,200,66,0.2)',  severe: 'rgba(245,66,108,0.2)' };

    // Phase timeline
    const activePhases = Object.keys(gait.phase_deficiencies);
    const phaseBar = Object.entries(PHASES).map(([key, ph]) => {
      const def = gait.phase_deficiencies[key];
      const color = def ? sevColor[def.severity] : 'var(--border-default)';
      return `
        <div style="flex:1;text-align:center">
          <div title="${ph.name}: ${def ? def.severity : 'normal'}" style="height:8px;border-radius:2px;background:${color};margin-bottom:4px"></div>
          <div style="font-size:9px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ph.pct}</div>
        </div>`;
    }).join('');

    // Deficits list
    const deficitCards = gait.deficits.map(d => `
      <div style="background:${sevBg[d.severity]};border:1px solid ${sevBdr[d.severity]};border-radius:var(--r-md);padding:14px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:2px 8px;border-radius:20px;background:${sevBg[d.severity]};color:${sevColor[d.severity]};border:1px solid ${sevBdr[d.severity]}">${d.severity}</span>
          <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${d.label}</span>
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px">
          <strong style="color:var(--text-secondary)">Gait phases:</strong> ${d.phases.map(p => PHASES[p]?.name || p).join(' → ')}
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px">
          <strong style="color:var(--text-secondary)">Compensations:</strong> ${d.compensations.join(' · ')}
        </div>
        <div style="font-size:11px;margin-top:8px">
          ${d.exercises.map(ex => `<div style="color:var(--lime);padding:2px 0">▸ ${ex}</div>`).join('')}
        </div>
      </div>`).join('');

    panel.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Gait Analysis</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;color:var(--text-tertiary)">${gait.total_deficits} deficit${gait.total_deficits!==1?'s':''}</span>
            <span style="font-size:12px;font-weight:600;color:var(--teal)">Symmetry ${gait.symmetry_index}%</span>
          </div>
        </div>

        <!-- Gait cycle phase bar -->
        <div style="margin-bottom:16px">
          <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">Gait cycle dysfunction map</div>
          <div style="display:flex;gap:3px">${phaseBar}</div>
          <div style="display:flex;gap:12px;margin-top:8px;font-size:10px">
            <span style="color:var(--teal)">● Mild</span>
            <span style="color:var(--amber)">● Moderate</span>
            <span style="color:var(--rose)">● Severe</span>
            <span style="color:var(--border-default)">● Normal</span>
          </div>
        </div>

        <!-- Worst case -->
        ${gait.worst_case_scenario && gait.total_deficits ? `
        <div style="background:rgba(245,66,108,0.06);border:1px solid rgba(245,66,108,0.2);border-radius:var(--r-sm);padding:12px;margin-bottom:14px;font-size:12px;color:var(--text-secondary);line-height:1.6">
          <strong style="color:var(--rose)">Worst-case:</strong> ${gait.worst_case_scenario}
        </div>` : ''}

        <!-- Deficit cards -->
        ${deficitCards}
      </div>`;

    panel.classList.remove('hidden');
  }

  return { analyze, renderGaitAnalysis, RULES, PHASES };

})();

window.GaitEngine = GaitEngine;
