// ═══════════════════════════════════════════════════════════════
//  js/programGenerator.js
//  Rule-Based Rehabilitation Program Generator
//  Generates structured Rehab Program + Daily Routine
//  from assessment data, scores, and gait analysis.
// ═══════════════════════════════════════════════════════════════

const ProgramGenerator = (() => {

  // ── PHASE DEFAULTS ────────────────────────────────────────
  const PHASE_DEFAULTS = {
    'Phase 1': { sets: '2–3', reps: '30–60s holds', tempo: '4-2-4', rest: '60s',  load: 'none' },
    'Phase 2': { sets: '3–4', reps: '8–12',         tempo: '3-1-3', rest: '90s',  load: 'bodyweight' },
    'Phase 3': { sets: '3–5', reps: '3–8',          tempo: '1-0-X', rest: '120s', load: 'external' },
  };

  // ── STANDARD WARM-UPS BY PHASE ────────────────────────────
  const WARMUPS = {
    'Phase 1': [
      { name: 'Diaphragmatic Breathing — PRI 90/90', sets: 3, reps: '5 breaths', tempo: 'slow', notes: 'Full exhale, feel rib cage lower, pelvis posteriorly tilt' },
      { name: 'Hip Joint Decompression CARs', sets: 1, reps: '5 each side', tempo: 'controlled', notes: 'Slow, full rotation — no compensation' },
      { name: 'Cat-Camel Spinal Segmentation', sets: 2, reps: '10', tempo: '3-1-3', notes: 'Articulate each vertebral level individually' },
      { name: 'Dead Bug Core Activation', sets: 2, reps: '8 each side', tempo: 'slow', notes: 'Lumbar neutral, exhale on extension' },
    ],
    'Phase 2': [
      { name: 'Breathing Reset — 90/90 Hip Lift', sets: 2, reps: '5 breaths', tempo: 'slow', notes: 'Restore ZOA, posterior pelvic tilt on exhale' },
      { name: 'Full Body CARs Sequence', sets: 1, reps: '5 each joint', tempo: 'controlled', notes: 'Neck → shoulder → thoracic → hip → ankle' },
      { name: 'PAILs/RAILs Activation (limited joint)', sets: 2, reps: '2 min progressive', tempo: 'progressive', notes: 'Start passive, build to 80% effort over 2 min' },
      { name: 'Core Pre-Activation — Bird Dog', sets: 2, reps: '10 each side', tempo: '3-1-3', notes: 'Anti-rotation, reach long on extension' },
    ],
    'Phase 3': [
      { name: 'Dynamic Breathing + Bracing', sets: 2, reps: '8', tempo: 'rhythmic', notes: '360° breathing, brace on exhale — 80% effort' },
      { name: 'Dynamic Mobility — Hip/Ankle Circuit', sets: 1, reps: '10 each', tempo: 'controlled-fast', notes: 'Leg swings, ankle circles, hip CARs' },
      { name: 'CNS Neural Activation — Jump or Med Ball Slam', sets: 3, reps: '5', tempo: 'explosive', notes: 'Max intent, full recovery between reps' },
      { name: 'Primary Movement Pattern Rehearsal', sets: 2, reps: '5', tempo: '2-1-2', notes: 'Unloaded version of main lift — groove pattern' },
    ],
  };

  // ── STANDARD COOLDOWNS BY PHASE ───────────────────────────
  const COOLDOWNS = {
    'Phase 1': [
      { name: 'Static Breathing Reset', sets: 3, reps: '5 breaths', notes: '5s inhale / 7s exhale — parasympathetic shift' },
      { name: 'Passive Mobility Hold (session joints)', sets: 2, reps: '60s each', notes: 'Target joints worked today, no PAILs' },
    ],
    'Phase 2': [
      { name: 'Breathing + NS Downregulation', sets: 3, reps: '5 breaths', notes: '2:1 exhale ratio, progressive relaxation' },
      { name: 'Myofascial Release + Passive Stretch', sets: 2, reps: '45s each', notes: 'Session muscles only — no aggressive loading' },
    ],
    'Phase 3': [
      { name: 'Post-Load Breathing Reset', sets: 3, reps: '5 breaths', notes: 'Diaphragmatic, lower heart rate intentionally' },
      { name: 'Active Recovery Mobility Flow', sets: 2, reps: '30s each position', notes: 'Gentle movement through worked ranges' },
    ],
  };

  // ── PROGRAM RULES (20 rules, priority ordered) ────────────
  const RULES = [
    // ── PRIORITY 1: Pain override ───────────────────────────
    {
      id: 'rule_pain_lock',
      priority: 1,
      type: 'phase_gate',
      condition: (a, scores) => scores.pain_flags.length > 0 || scores.referral_required,
      apply: (ctx) => {
        ctx.forcedPhase = 'Phase 1';
        ctx.warnings.push('⚠ Pain detected — locked to Phase 1 Pain Management. Manual therapy referral required before progressive loading.');
      },
    },
    {
      id: 'rule_composite_lock',
      priority: 1,
      type: 'phase_gate',
      condition: (a, scores) => scores.composite_score < 50,
      apply: (ctx) => {
        ctx.forcedPhase = 'Phase 1';
        ctx.warnings.push('Composite score <50 — Phase 1 only. No external loading permitted.');
      },
    },

    // ── PRIORITY 2: Joint-specific inclusion ────────────────
    {
      id: 'rule_limited_df',
      priority: 2,
      type: 'inclusion',
      condition: a => (a.ankle_df_l != null && a.ankle_df_l < 10) || (a.ankle_df_r != null && a.ankle_df_r < 10),
      exercises: [
        { name: 'Ankle Rocker Mobilization', sets: 3, reps: '10 each', tempo: 'controlled', notes: 'Half-kneeling, drive knee over 5th toe, keep heel down' },
        { name: 'Gastroc/Soleus Eccentric Lengthening', sets: 3, reps: '15 slow', tempo: '4-0-1', notes: 'Heel drop off step, full range — bilateral then single' },
      ],
      exclusions: ['deep_squat', 'barbell_squat', 'heavy_leg_press'],
    },
    {
      id: 'rule_over_pronation',
      priority: 2,
      type: 'inclusion',
      condition: a => (a.pronation_l && a.pronation_l.toLowerCase().includes('over'))
                   || (a.pronation_r && a.pronation_r.toLowerCase().includes('over')),
      exercises: [
        { name: 'Foot Intrinsic Activation (Short Foot)', sets: 3, reps: '10 × 3s holds', tempo: 'slow', notes: 'Seated, shorten foot without toe curl' },
        { name: 'Posterior Tibialis Strengthening', sets: 3, reps: '15', tempo: '3-1-3', notes: 'Resistance band, inversion + plantar flexion' },
        { name: 'Glute Medius Clamshell', sets: 3, reps: '15 each', tempo: '3-1-3', notes: 'Side-lying, heels together, no hip flexion shift' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_stuck_supination',
      priority: 2,
      type: 'inclusion',
      condition: a => (a.supination_l && a.supination_l.toLowerCase().includes('stuck'))
                   || (a.supination_r && a.supination_r.toLowerCase().includes('stuck')),
      exercises: [
        { name: 'Subtalar Mobilization', sets: 3, reps: '10 each direction', tempo: 'controlled', notes: 'Seated — guided eversion/inversion mobilization' },
        { name: 'Peroneal Activation', sets: 3, reps: '15', tempo: '3-1-3', notes: 'Resistance band eversion, foot in neutral' },
        { name: '1st Ray Mobilization', sets: 2, reps: '30s', tempo: 'passive', notes: 'Weight-bearing hallux extension — load gradually' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_limited_hip_ir',
      priority: 2,
      type: 'inclusion',
      condition: a => (a.hip_ir_l != null && a.hip_ir_l < 35) || (a.hip_ir_r != null && a.hip_ir_r < 35),
      exercises: [
        { name: '90/90 Hip IR PAILs/RAILs', sets: 2, reps: '2 min progressive', tempo: 'progressive', notes: 'Front leg in IR, start passive → build to 80% contraction' },
        { name: 'Hip IR Controlled Articular Rotation (CARs)', sets: 2, reps: '5 each side', tempo: 'controlled', notes: 'Supine — isolate rotation, no pelvic movement' },
      ],
      exclusions: ['loaded_rotation', 'heavy_deadlift'],
    },
    {
      id: 'rule_hip_ir_asymmetry',
      priority: 2,
      type: 'modification',
      condition: a => a.hip_ir_l != null && a.hip_ir_r != null && Math.abs(a.hip_ir_l - a.hip_ir_r) > 15,
      apply: (ctx) => {
        ctx.notes.push('Hip IR asymmetry >15°: prioritize limited side in all hip mobility work. Avoid bilateral loading until <15° difference achieved.');
      },
    },
    {
      id: 'rule_limited_hip_extension',
      priority: 2,
      type: 'inclusion',
      condition: a => (a.hip_ext_l != null && a.hip_ext_l < 10) || (a.hip_ext_r != null && a.hip_ext_r < 10),
      exercises: [
        { name: 'Hip Flexor Lengthening — PRI 90/90', sets: 3, reps: '90s each side', tempo: 'slow', notes: 'Exhale-driven, posterior pelvic tilt, no lumbar extension' },
        { name: 'Glute Max Activation — Prone Hip Extension', sets: 3, reps: '15', tempo: '3-1-3', notes: 'Prone, knee bent 90°, isolate glute — no lumbar hike' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_trendelenburg',
      priority: 2,
      type: 'inclusion',
      condition: a => (a.sl_squat_l != null && a.sl_squat_l <= 1) || (a.sl_squat_r != null && a.sl_squat_r <= 1)
                   || (a.load_text && a.load_text.toLowerCase().includes('trendelenburg')),
      exercises: [
        { name: 'Sidelying Glute Medius Activation', sets: 3, reps: '15 each', tempo: '3-1-3', notes: 'Hip neutral — no external rotation compensation' },
        { name: 'Clamshell with Resistance Band', sets: 3, reps: '15 each', tempo: '3-1-3', notes: 'Heels together, top knee drives up 45° only' },
        { name: 'SL Stance Wall-Touch Glute Med', sets: 3, reps: '12 each', tempo: '2-1-2', notes: 'Balance on stance leg, tap opposite foot to wall' },
      ],
      exclusions: ['loaded_single_leg', 'heavy_lunge', 'step_up_with_load'],
    },
    {
      id: 'rule_sl_rdl_core',
      priority: 3,
      type: 'inclusion',
      condition: a => (a.sl_rdl_l != null && a.sl_rdl_l <= 1) || (a.sl_rdl_r != null && a.sl_rdl_r <= 1)
                   || (a.load_text && a.load_text.toLowerCase().includes('rotation')),
      exercises: [
        { name: 'Pallof Press — Anti-Rotation', sets: 3, reps: '12 each', tempo: '3-1-3', notes: 'Cable or band perpendicular to anchor — no trunk rotation' },
        { name: 'Dead Bug — Contralateral', sets: 3, reps: '10 each', tempo: '4-0-1', notes: 'Slow arm/leg lowering, lumbar stays neutral throughout' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_oh_squat_forward',
      priority: 3,
      type: 'inclusion',
      condition: a => (a.oh_squat != null && a.oh_squat <= 1)
                   || (a.load_text && a.load_text.toLowerCase().includes('forward')),
      exercises: [
        { name: 'Ankle DF Mobilization — Half-Kneeling Wall', sets: 3, reps: '10 each', tempo: 'controlled', notes: 'Knee tracks over 5th toe, heel stays down' },
        { name: 'Thoracic Extension CARs', sets: 2, reps: '5 each side', tempo: 'controlled', notes: 'Hands behind head — rotate around thoracic spine only' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_oh_squat_heel_rise',
      priority: 3,
      type: 'inclusion',
      condition: a => a.load_text && a.load_text.toLowerCase().includes('heel'),
      exercises: [
        { name: 'Heel-Raised Squat → Flat Progression', sets: 3, reps: '10', tempo: '3-1-3', notes: 'Start with 1" heel raise, reduce over sessions' },
        { name: 'Ankle Rocker Mobilization — Loaded', sets: 3, reps: '15', tempo: 'controlled', notes: 'Half-kneeling with resistance — drive through full range' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_spine_flexion',
      priority: 3,
      type: 'inclusion',
      condition: a => a.sp_flex_pain || a.sp_flex_range === 'limited',
      exercises: [
        { name: 'Segmental Spinal Flexion — Cat-Camel', sets: 2, reps: '10', tempo: '3-2-3', notes: 'Focus on each vertebral segment — avoid global flex pattern' },
        { name: 'PRI 90/90 Hip Lift', sets: 2, reps: '5 breaths', tempo: 'slow', notes: 'Exhale-driven, restore zone of apposition (ZOA)' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_thoracic_rotation',
      priority: 3,
      type: 'inclusion',
      condition: a => a.sp_rotl_pain || a.sp_rotr_pain || a.sp_rotl_range === 'limited' || a.sp_rotr_range === 'limited',
      exercises: [
        { name: 'Thoracic Rotation CARs', sets: 3, reps: '5 each side', tempo: 'controlled', notes: 'Seated or quadruped — isolate thoracic, lock lumbar' },
        { name: 'Sidelying Rib Rotation', sets: 2, reps: '10 each', tempo: '3-1-3', notes: 'Arm sweeps open, follow with eyes — no hip roll' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_shoulder_ir',
      priority: 3,
      type: 'inclusion',
      condition: a => (a.sh_ir_l != null && a.sh_ir_l < 70) || (a.sh_ir_r != null && a.sh_ir_r < 70),
      exercises: [
        { name: 'Shoulder IR PAILs/RAILs — 90/90', sets: 2, reps: '2 min progressive', tempo: 'progressive', notes: 'Arm at 90° abduction, 90° IR — no pain during' },
        { name: 'Posterior Capsule Mobilization (Cross-Body)', sets: 3, reps: '45s each', tempo: 'slow', notes: 'Stabilize scapula, gentle cross-body stretch' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_shoulder_er',
      priority: 3,
      type: 'inclusion',
      condition: a => (a.sh_er_l != null && a.sh_er_l < 80) || (a.sh_er_r != null && a.sh_er_r < 80),
      exercises: [
        { name: 'Shoulder ER PAILs/RAILs — 90/90', sets: 2, reps: '2 min progressive', tempo: 'progressive', notes: 'Arm at 90° abduction, resist into ER progressively' },
        { name: 'Rotator Cuff ER Strengthening', sets: 3, reps: '15', tempo: '3-1-3', notes: 'Elbow at side, resistance band — no trunk rotation' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_balance_eo',
      priority: 4,
      type: 'inclusion',
      condition: a => (a.bal_eo_l != null && a.bal_eo_l < 30) || (a.bal_eo_r != null && a.bal_eo_r < 30),
      exercises: [
        { name: 'Single-Leg Balance Progression', sets: 3, reps: '30s each', tempo: 'hold', notes: 'Eyes open → foam pad → eyes closed. Limited side first.' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_balance_ec',
      priority: 4,
      type: 'inclusion',
      condition: a => (a.bal_ec_l != null && a.bal_ec_l < 10) || (a.bal_ec_r != null && a.bal_ec_r < 10),
      exercises: [
        { name: 'Vestibular Drills — Head Turns in SL Stance', sets: 3, reps: '10 each', tempo: 'slow', notes: 'Turn head slowly L/R during SL stance — no dizziness' },
        { name: 'Tandem Walk — Eyes Open → Closed', sets: 3, reps: '10m', tempo: 'slow', notes: 'Progress to eyes closed when EO is consistent' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_hip_limited_er',
      priority: 4,
      type: 'inclusion',
      condition: a => (a.hip_er_l != null && a.hip_er_l < 45) || (a.hip_er_r != null && a.hip_er_r < 45),
      exercises: [
        { name: 'Hip ER Mobilization — Figure-4 PAILs', sets: 2, reps: '2 min each', tempo: 'progressive', notes: 'Figure-4 seated position, progressive ER loading' },
      ],
      exclusions: [],
    },
    {
      id: 'rule_hip_limited_abduction',
      priority: 4,
      type: 'inclusion',
      condition: a => (a.hip_abd_l != null && a.hip_abd_l < 40) || (a.hip_abd_r != null && a.hip_abd_r < 40),
      exercises: [
        { name: 'Hip Abduction PAILs — Side-Lying', sets: 2, reps: '2 min', tempo: 'progressive', notes: 'Side-lying, stack hips, resist into abduction' },
      ],
      exclusions: [],
    },
  ];

  // ── DAILY ROUTINE TEMPLATE ────────────────────────────────
  const DAILY_BASE = {
    breathing: { name: 'Morning Breathing Reset', sets: 1, reps: '5 breaths', notes: '90/90 position, on waking before getting up' },
    activation: { name: 'Core Activation — Dead Bug', sets: 2, reps: '8 each', notes: 'Lumbar neutral — slow and controlled' },
  };

  // ── GENERATE ──────────────────────────────────────────────
  function generate(assessment, scores, gaitAnalysis, options = {}) {
    const a = assessment;
    const { phase: requestedPhase } = options;

    // Determine effective phase
    const basePhase = requestedPhase?.includes('Phase 1') ? 'Phase 1'
      : requestedPhase?.includes('Phase 2') ? 'Phase 2'
      : requestedPhase?.includes('Phase 3') ? 'Phase 3'
      : scores.phase_recommendation.includes('Phase 1') ? 'Phase 1'
      : scores.phase_recommendation.includes('Phase 2') ? 'Phase 2' : 'Phase 3';

    const ctx = {
      assessment: a,
      scores,
      gait: gaitAnalysis,
      phase: basePhase,
      forcedPhase: null,
      warnings: [],
      notes: [],
      inclusionExercises: [],
      exclusionSet: new Set(),
    };

    // ── Apply all rules in priority order ───────────────────
    const sortedRules = [...RULES].sort((a, b) => a.priority - b.priority);

    sortedRules.forEach(rule => {
      try {
        const passes = rule.type === 'phase_gate'
          ? rule.condition(a, scores)
          : rule.condition(a);

        if (!passes) return;

        if (rule.type === 'phase_gate' && rule.apply) {
          rule.apply(ctx);
        }

        if (rule.type === 'inclusion' && rule.exercises) {
          ctx.inclusionExercises.push(...rule.exercises);
        }

        if (rule.type === 'modification' && rule.apply) {
          rule.apply(ctx);
        }

        if (rule.exclusions) {
          rule.exclusions.forEach(e => ctx.exclusionSet.add(e));
        }

      } catch(e) {
        console.warn(`Rule ${rule.id} error:`, e.message);
      }
    });

    const effectivePhase = ctx.forcedPhase || ctx.phase;
    const defaults = PHASE_DEFAULTS[effectivePhase] || PHASE_DEFAULTS['Phase 1'];

    // Dedup inclusion exercises (preserving order = priority order)
    const seen = new Set();
    const mainExercises = ctx.inclusionExercises
      .filter(ex => {
        if (seen.has(ex.name)) return false;
        seen.add(ex.name);
        // Filter out exclusions
        return ![...ctx.exclusionSet].some(excl =>
          ex.name.toLowerCase().replace(/\s/g, '_').includes(excl)
        );
      })
      .map(ex => ({
        ...ex,
        sets:  ex.sets  || parseInt(defaults.sets),
        reps:  ex.reps  || defaults.reps,
        tempo: ex.tempo || defaults.tempo,
        rest:  ex.rest  || defaults.rest,
      }));

    // Warm-up and cooldown for effective phase
    const warmup   = WARMUPS[effectivePhase]   || WARMUPS['Phase 1'];
    const cooldown = COOLDOWNS[effectivePhase] || COOLDOWNS['Phase 1'];

    // Daily routine: top 2 mobility from gait priorities + breathing + activation
    const dailyMobility = (gaitAnalysis.exercise_priorities || []).slice(0, 2).map(ex => ({
      name: ex, sets: 1, reps: '30s', notes: 'Daily maintenance — gentle, not to fatigue',
    }));

    const dailyRoutine = {
      breathing:  [DAILY_BASE.breathing],
      mobility:   dailyMobility,
      activation: [DAILY_BASE.activation],
    };

    // Collect which rule IDs fired
    const rulesApplied = sortedRules
      .filter(r => {
        try { return r.type === 'phase_gate' ? r.condition(a, scores) : r.condition(a); }
        catch(e) { return false; }
      })
      .map(r => r.id);

    return {
      phase:           effectivePhase,
      requested_phase: requestedPhase || basePhase,
      defaults,
      structure: {
        warmup,
        main:     mainExercises,
        cooldown,
      },
      daily_routine:     dailyRoutine,
      rules_applied:     rulesApplied,
      exclusions:        [...ctx.exclusionSet],
      warnings:          ctx.warnings,
      notes:             ctx.notes,
      referral_required: scores.referral_required,
    };
  }

  // ── RENDER STRUCTURED PROGRAM INTO DOM ───────────────────
  function renderProgram(program) {
    const panel = document.getElementById('program-panel');
    if (!panel) return;

    const phaseColor = program.phase === 'Phase 1' ? 'var(--teal)'
      : program.phase === 'Phase 2' ? 'var(--amber)' : 'var(--lime)';

    const exerciseRow = (ex, idx) => `
      <div style="display:grid;grid-template-columns:auto 1fr auto auto auto;gap:10px 16px;align-items:start;padding:12px 0;border-bottom:1px solid var(--border-subtle)">
        <div style="width:22px;height:22px;border-radius:50%;background:${phaseColor}18;border:1px solid ${phaseColor}30;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${phaseColor};flex-shrink:0;margin-top:1px">${idx + 1}</div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${ex.name}</div>
          ${ex.notes ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;line-height:1.4">${ex.notes}</div>` : ''}
          ${ex.video_url ? `<a href="${ex.video_url}" target="_blank" rel="noopener" style="font-size:11px;color:var(--lime);text-decoration:none;display:inline-flex;align-items:center;gap:3px;margin-top:3px">▶ Watch</a>` : ''}
        </div>
        <div style="text-align:center;min-width:40px">
          <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">Sets</div>
          <div style="font-size:13px;font-weight:600;color:${phaseColor}">${ex.sets}</div>
        </div>
        <div style="text-align:center;min-width:60px">
          <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">Reps</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${ex.reps}</div>
        </div>
        <div style="text-align:center;min-width:50px">
          <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">Tempo</div>
          <div style="font-size:12px;font-family:var(--font-mono);color:var(--text-secondary)">${ex.tempo || '–'}</div>
        </div>
      </div>`;

    const section = (title, exercises, color) => `
      <div style="margin-bottom:4px">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${color};padding:8px 0 4px;border-bottom:1px solid ${color}22">${title}</div>
        ${exercises.length ? exercises.map((ex, i) => exerciseRow(ex, i)).join('') : `<div style="font-size:12px;color:var(--text-tertiary);padding:12px 0">No exercises added</div>`}
      </div>`;

    panel.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Rehabilitation Program</span>
          <span class="badge" style="background:${phaseColor}18;color:${phaseColor};border:1px solid ${phaseColor}30">${program.phase}</span>
        </div>

        ${program.warnings.length ? program.warnings.map(w => `
          <div style="background:rgba(245,66,108,0.07);border:1px solid rgba(245,66,108,0.2);border-radius:var(--r-sm);padding:10px 14px;margin-bottom:12px;font-size:12px;color:var(--rose)">${w}</div>
        `).join('') : ''}

        ${program.notes.length ? program.notes.map(n => `
          <div style="background:rgba(245,200,66,0.07);border:1px solid rgba(245,200,66,0.2);border-radius:var(--r-sm);padding:10px 14px;margin-bottom:12px;font-size:12px;color:var(--amber)">${n}</div>
        `).join('') : ''}

        <!-- Sets/Reps defaults badge row -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          ${Object.entries(program.defaults).map(([k, v]) => `
            <span style="font-size:10px;padding:3px 10px;border-radius:20px;background:var(--bg-raised);border:1px solid var(--border-subtle);color:var(--text-secondary)">
              <strong style="color:var(--text-tertiary)">${k}:</strong> ${v}
            </span>`).join('')}
        </div>

        ${section('Warm Up', program.structure.warmup, 'var(--teal)')}
        <div style="height:12px"></div>
        ${section('Main — Correctives & Conditioning', program.structure.main, phaseColor)}
        <div style="height:12px"></div>
        ${section('Cool Down', program.structure.cooldown, 'var(--blue)')}

        ${program.exclusions.length ? `
        <div style="margin-top:14px;padding:10px 12px;background:var(--bg-raised);border-radius:var(--r-sm);font-size:11px;color:var(--rose)">
          <strong>Exclusions for this client:</strong> ${program.exclusions.join(' · ')}
        </div>` : ''}
      </div>`;

    panel.classList.remove('hidden');
  }

  // ── RENDER DAILY ROUTINE INTO DOM ─────────────────────────
  function renderDailyRoutine(program) {
    const panel = document.getElementById('daily-routine-panel');
    if (!panel) return;

    const dr = program.daily_routine;

    const row = (ex) => `
      <div style="display:flex;align-items:start;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-subtle)">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--lime);flex-shrink:0;margin-top:5px"></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${ex.name}</div>
          ${ex.notes ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${ex.notes}</div>` : ''}
        </div>
        <div style="font-size:12px;font-weight:600;color:var(--lime);white-space:nowrap">${ex.sets}× ${ex.reps}</div>
      </div>`;

    const allExercises = [
      ...dr.breathing,
      ...dr.mobility,
      ...dr.activation,
    ];

    panel.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Daily Routine</span>
          <span style="font-size:11px;color:var(--text-tertiary)">Do every day · ~15 min</span>
        </div>
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--lime);margin-bottom:4px">Breathing</div>
        ${dr.breathing.map(row).join('')}
        ${dr.mobility.length ? `
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--teal);margin-top:12px;margin-bottom:4px">Mobility</div>
        ${dr.mobility.map(row).join('')}` : ''}
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--amber);margin-top:12px;margin-bottom:4px">Activation</div>
        ${dr.activation.map(row).join('')}
      </div>`;

    panel.classList.remove('hidden');
  }

  // ── LIBRARY ENRICHMENT ───────────────────────────────────
  // After generate(), optionally call this to add video_url and
  // thumbnail_url from the Exercise Library to each exercise.
  // Non-blocking — call after renderProgram() for a seamless update.
  async function enrichWithLibrary(program) {
    if (typeof ExerciseLibrary === 'undefined') return program;

    const sections = ['warmup', 'main', 'cooldown', 'homework'];
    const allExercises = sections.flatMap(k => program[k] || []);

    await Promise.all(allExercises.map(async (ex) => {
      try {
        const found = await ExerciseLibrary.lookup(ex.name);
        if (found) {
          if (found.video_url)     ex.video_url     = found.video_url;
          if (found.thumbnail_url) ex.thumbnail_url = found.thumbnail_url;
          if (found.cues && !ex.notes) ex.notes = found.cues;
        }
      } catch(e) { /* non-fatal — library may be empty */ }
    }));

    return program;
  }

  return { generate, renderProgram, renderDailyRoutine, enrichWithLibrary, RULES, PHASE_DEFAULTS };

})();

window.ProgramGenerator = ProgramGenerator;
