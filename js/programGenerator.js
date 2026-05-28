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

  // ── PADDING POOLS ─────────────────────────────────────────
  // Used to top a section up to a coach-requested exercise count when the
  // rule-driven set is shorter than requested.
  const POOL_WARMUP = [
    { name: 'Thoracic Rotation CARs', sets: 2, reps: '6 each side', tempo: 'controlled', notes: 'Open the thoracic spine before loading.' },
    { name: 'Ankle Circles + Calf Pulses', sets: 2, reps: '10 each', tempo: 'controlled', notes: 'Prime the ankle complex for ground contact.' },
    { name: 'Glute Bridge Activation', sets: 2, reps: '12', tempo: '2-1-2', notes: 'Wake the posterior chain — squeeze at the top.' },
    { name: 'Scapular Wall Slides', sets: 2, reps: '10', tempo: '3-1-3', notes: 'Ribs down, slide arms overhead without arching.' },
    { name: 'World’s Greatest Stretch', sets: 1, reps: '5 each side', tempo: 'flow', notes: 'Full-body dynamic opener.' },
    { name: 'Hip Airplane (supported)', sets: 2, reps: '6 each side', tempo: 'controlled', notes: 'Single-leg hip rotation control.' },
    { name: '90/90 Hip Switches', sets: 2, reps: '8', tempo: 'controlled', notes: 'Internal/external hip rotation flow.' },
    { name: 'Band Pull-Apart', sets: 2, reps: '15', tempo: '2-1-2', notes: 'Upper-back activation, ribs down.' },
    { name: 'Dead Bug March', sets: 2, reps: '8 each side', tempo: '3-0-1', notes: 'Core pre-activation, lumbar flat.' },
    { name: 'Walking Knee Hugs', sets: 1, reps: '8 each side', tempo: 'flow', notes: 'Dynamic posterior-chain opener.' },
  ];
  const POOL_MAIN = [
    { name: 'Tempo Goblet Squat', sets: 3, reps: '8', tempo: '3-1-1', notes: 'Control the descent, brace through mid-foot.' },
    { name: 'Half-Kneeling Cable Press', sets: 3, reps: '10 each', tempo: '2-1-2', notes: 'Anti-extension — ribs stacked over pelvis.' },
    { name: 'Split-Stance RDL', sets: 3, reps: '8 each', tempo: '3-1-1', notes: 'Hinge through the hip, flat back throughout.' },
    { name: 'Side Plank with Reach', sets: 3, reps: '8 each', tempo: '2-1-2', notes: 'Lateral chain — no hip sag.' },
    { name: 'Step-Down Eccentric', sets: 3, reps: '10 each', tempo: '4-0-1', notes: 'Knee tracks over toes, control the lower.' },
    { name: 'Bent-Over Row', sets: 3, reps: '10', tempo: '2-1-2', notes: 'Drive elbows back, squeeze the mid-back.' },
    { name: 'Reverse Lunge', sets: 3, reps: '8 each', tempo: '2-1-2', notes: 'Vertical shin, control the step back.' },
    { name: 'Single-Arm Carry', sets: 3, reps: '20m each', tempo: 'steady', notes: 'Anti-lateral-flexion — stay tall.' },
    { name: 'Hip Thrust', sets: 3, reps: '10', tempo: '2-1-2', notes: 'Full hip extension, ribs down at top.' },
    { name: 'Tall-Kneeling Pulldown', sets: 3, reps: '12', tempo: '2-1-2', notes: 'Lat drive without lumbar extension.' },
    { name: 'Lateral Step-Down', sets: 3, reps: '10 each', tempo: '3-1-1', notes: 'Frontal-plane knee control.' },
    { name: 'Push-Up (tempo)', sets: 3, reps: '8', tempo: '3-1-1', notes: 'Rigid plank line, full range.' },
    { name: 'Suitcase Deadlift', sets: 3, reps: '8 each', tempo: '2-1-2', notes: 'Hinge under offset load, square hips.' },
    { name: 'Bird-Dog Row', sets: 3, reps: '10 each', tempo: '2-1-2', notes: 'Anti-rotation while rowing.' },
  ];
  const POOL_COOLDOWN = [
    { name: 'Child’s Pose Breathing', sets: 2, reps: '5 breaths', notes: 'Long exhale, let the back open.' },
    { name: 'Supine Figure-4 Stretch', sets: 2, reps: '45s each', notes: 'Gentle glute/hip release.' },
    { name: 'Standing Forward Fold', sets: 2, reps: '30s', notes: 'Soft knees, decompress the spine.' },
    { name: 'Couch Stretch', sets: 2, reps: '45s each', notes: 'Hip-flexor lengthening, posterior pelvic tilt.' },
    { name: 'Thread-the-Needle', sets: 2, reps: '6 each side', notes: 'Thoracic release, slow and controlled.' },
    { name: 'Seated Box Breathing', sets: 3, reps: '5 breaths', notes: '4s in / 4s hold / 6s out — downregulate.' },
    { name: 'Doorway Pec Stretch', sets: 2, reps: '40s each', notes: 'Open the chest, ribs down.' },
    { name: 'Supine Twist', sets: 2, reps: '40s each', notes: 'Gentle lumbar/thoracic rotation release.' },
  ];

  // Daily-routine task pool — client-tracker shape (morning/evening).
  const POOL_DAILY = [
    { label: 'Zen Swing', section: 'morning', emoji: '🌀', meta: '⏱ 1–2 minutes',
      details: ['Gentle rhythmic movement to loosen the body and reset the nervous system.'] },
    { label: 'Spine Segmentation', section: 'morning', emoji: '🦴', meta: '🔁 5–8 reps',
      details: ['Slowly roll down and up, moving one vertebra at a time.'] },
    { label: 'Rib Cage Breathing', section: 'morning', emoji: '🫁', meta: '🌬 6–10 breaths',
      details: ['Hands on ribs.', 'Inhale → expand sideways.', 'Exhale → ribs soften inward.'] },
    { label: 'Pelvic Tilts', section: 'morning', emoji: '⚖️', meta: '🔁 8–12 reps',
      details: ['Gentle forward/back tilt.', 'Move with control.'] },
    { label: 'Hip CARs', section: 'morning', emoji: '🦵', meta: '🔁 5 each side',
      details: ['Slow controlled hip rotations — full range, no compensation.'] },
    { label: 'Belly Breathing', section: 'evening', emoji: '🌙', meta: '🌬 2–5 minutes',
      details: ['Inhale → belly rises.', 'Exhale → belly falls.', 'Rhythm: 4s in / 6s out.'] },
    { label: 'Spine Segmentation (slow)', section: 'evening', emoji: '🦴', meta: '🔁 5 slow reps',
      details: ['Move slower than morning, focus on releasing tension.'] },
    { label: 'Legs-Up-The-Wall', section: 'evening', emoji: '🧘', meta: '⏱ 3–5 minutes',
      details: ['Lie with legs up a wall, breathe slowly — downregulate.'] },
  ];

  // Trim a list to `n`, or pad it from `pool` (no duplicate names) up to `n`.
  // n <= 0 / non-finite → return the list unchanged.
  function _fitCount(list, n, pool) {
    if (!Number.isFinite(n) || n <= 0) return list.slice();
    const out  = list.slice(0, n);
    const used = new Set(out.map((e) => e.name || e.label));
    let pi = 0, guard = 0;
    while (out.length < n && pool && guard < pool.length * 4) {
      const cand = pool[pi % pool.length]; pi++; guard++;
      const key = cand.name || cand.label;
      if (used.has(key)) continue;
      used.add(key);
      out.push({ ...cand });
    }
    while (out.length < n) {
      out.push({ name: `Additional exercise ${out.length + 1}`, sets: '', reps: '', tempo: '', rest: '', notes: 'Coach to specify.' });
    }
    return out;
  }

  // Deal `k` exercises to workout #w of `n` distinct workouts from `pool`.
  // Each workout gets a different slice (starting at w*k) so the workouts in
  // a split are genuinely different. Pads with generics if the pool is short.
  function _dealSlice(pool, w, n, k) {
    const want = (Number.isFinite(k) && k > 0) ? k : Math.max(1, Math.floor(pool.length / Math.max(n, 1)));
    const out = [], used = new Set();
    let idx = w * want, guard = 0;
    while (out.length < want && pool.length && guard < pool.length * 4) {
      const cand = pool[((idx % pool.length) + pool.length) % pool.length];
      idx++; guard++;
      const key = cand.name || cand.label;
      if (used.has(key)) continue;
      used.add(key);
      out.push({ ...cand });
    }
    while (out.length < want) {
      out.push({ name: `Additional exercise ${out.length + 1}`, sets: '', reps: '', tempo: '', rest: '', notes: 'Coach to specify.' });
    }
    return out;
  }

  // Dedupe an exercise list by name, preserving order.
  function _dedupeByName(list) {
    const seen = new Set(), out = [];
    list.forEach((e) => {
      const k = e.name || e.label;
      if (k && seen.has(k)) return;
      if (k) seen.add(k);
      out.push(e);
    });
    return out;
  }

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
  // options:
  //   phase        — requested phase string
  //   daysPerWeek  — workout days/week (1–7)
  //   counts       — { warmup, main, cooldown, daily } target exercise counts
  function generate(assessment, scores, gaitAnalysis, options = {}) {
    const a = assessment;
    const { phase: requestedPhase } = options;
    const counts = options.counts || {};
    const daysPerWeek = Number.isFinite(options.daysPerWeek) ? options.daysPerWeek : 3;

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

    // ── Build the workout split ─────────────────────────────
    // distinctWorkouts = how many *different* workouts rotate across the week
    //   1            → same workout every day
    //   2            → A / B alternating
    //   3            → A / B / C rotation
    //   = daysPerWeek → every day a different workout
    const distinctWorkouts = Math.max(1, Math.min(daysPerWeek,
      Number.isFinite(options.distinctWorkouts) ? options.distinctWorkouts : 1));

    // Combined pools — rule-driven (most relevant to the client) first, then
    // the generic pool. Each distinct workout is dealt a different slice.
    const warmPool = _dedupeByName([ ...(WARMUPS[effectivePhase]   || WARMUPS['Phase 1']),   ...POOL_WARMUP ]);
    const mainPool = _dedupeByName([ ...mainExercises,                                       ...POOL_MAIN ]);
    const coolPool = _dedupeByName([ ...(COOLDOWNS[effectivePhase] || COOLDOWNS['Phase 1']), ...POOL_COOLDOWN ]);

    const applyDef = (ex) => ({
      ...ex,
      sets:  ex.sets  || defaults.sets,
      reps:  ex.reps  || defaults.reps,
      tempo: ex.tempo || defaults.tempo,
      rest:  ex.rest  || defaults.rest,
    });

    const workouts = [];
    for (let w = 0; w < distinctWorkouts; w++) {
      const id = String.fromCharCode(65 + w);   // 'A','B','C',…
      workouts.push({
        id,
        label:    distinctWorkouts === 1 ? 'Daily Workout' : ('Workout ' + id),
        warmup:   _dealSlice(warmPool, w, distinctWorkouts, counts.warmup).map(applyDef),
        main:     _dealSlice(mainPool, w, distinctWorkouts, counts.main).map(applyDef),
        cooldown: _dealSlice(coolPool, w, distinctWorkouts, counts.cooldown).map(applyDef),
      });
    }

    // Weekly schedule — rotate the distinct workouts across the workout days.
    const schedule = [];
    for (let d = 0; d < daysPerWeek; d++) schedule.push(workouts[d % distinctWorkouts].id);

    const splitLabel = distinctWorkouts === 1 ? 'Same workout repeated'
      : distinctWorkouts === daysPerWeek ? 'Every day a different workout'
      : `${distinctWorkouts}-workout rotation`;

    // Backward-compat: `structure` mirrors the first workout (legacy readers).
    const warmup   = workouts[0].warmup;
    const main     = workouts[0].main;
    const cooldown = workouts[0].cooldown;

    // Daily routine: top 2 mobility from gait priorities + breathing + activation
    const dailyMobility = (gaitAnalysis.exercise_priorities || []).slice(0, 2).map(ex => ({
      name: ex, sets: 1, reps: '30s', notes: 'Daily maintenance — gentle, not to fatigue',
    }));

    const dailyRoutine = {
      breathing:  [DAILY_BASE.breathing],
      mobility:   dailyMobility,
      activation: [DAILY_BASE.activation],
    };

    // Client-facing daily routine in tracker shape (morning/evening tasks),
    // fitted to the requested count. This is what gets published to the client.
    const dailyTasks = _fitCount([], counts.daily || 6, POOL_DAILY)
      .map((t, i) => ({
        id:       i,
        label:    t.label || t.name || `Task ${i + 1}`,
        section:  t.section || (i % 2 === 0 ? 'morning' : 'evening'),
        emoji:    t.emoji || '🌀',
        meta:     t.meta || '',
        details:  Array.isArray(t.details) ? t.details : (t.notes ? [t.notes] : []),
      }));

    // Collect which rule IDs fired
    const rulesApplied = sortedRules
      .filter(r => {
        try { return r.type === 'phase_gate' ? r.condition(a, scores) : r.condition(a); }
        catch(e) { return false; }
      })
      .map(r => r.id);

    return {
      phase:             effectivePhase,
      requested_phase:   requestedPhase || basePhase,
      days_per_week:     daysPerWeek,
      distinct_workouts: distinctWorkouts,
      split_label:       splitLabel,
      counts: {
        warmup:   warmup.length,
        main:     main.length,
        cooldown: cooldown.length,
        daily:    dailyTasks.length,
      },
      defaults,
      workouts,                               // [{ id,label,warmup,main,cooldown }, …]
      schedule,                               // ['A','B','A',…] length = days_per_week
      structure: {                            // legacy compat — mirrors workout A
        warmup,
        main,
        cooldown,
      },
      daily_routine:       dailyRoutine,      // legacy {breathing,mobility,activation} — PDF/DOM
      daily_routine_tasks: dailyTasks,        // tracker-shape tasks — published to client
      rules_applied:       rulesApplied,
      exclusions:          [...ctx.exclusionSet],
      warnings:            ctx.warnings,
      notes:               ctx.notes,
      referral_required:   scores.referral_required,
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

  return { generate, renderProgram, renderDailyRoutine, RULES, PHASE_DEFAULTS };

})();

window.ProgramGenerator = ProgramGenerator;
