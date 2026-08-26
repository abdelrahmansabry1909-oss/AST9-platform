// ═══════════════════════════════════════════════════════════════
//  js/scoring.js
//  Movement Quality Scoring Engine
//  Framework: Movement = ROM × Control × Force × Neurology
//  All normative values are clinically locked — do not modify.
// ═══════════════════════════════════════════════════════════════

const ScoringEngine = (() => {

  // ── NORMATIVE RANGES (LOCKED) ─────────────────────────────
  const NORMS = {
    hip_ir:             { min: 35 },
    hip_er:             { min: 45 },
    hip_flexion:        { min: 120 },
    hip_extension:      { min: 10 },
    hip_abduction:      { min: 40 },
    hip_adduction:      { min: 15 },
    tibia_ir:           { min: 20 },
    shoulder_flexion:   { min: 160 },
    shoulder_extension: { min: 50 },
    shoulder_ir:        { min: 70 },
    shoulder_er:        { min: 80 },
    ankle_df:           { min: 10 },   // cm
    sl_balance_eo:      { min: 30 },   // seconds
    sl_balance_ec:      { min: 10 },
    sl_reach:           { min: 70 },   // % leg length

    // ── NeuCore additions (Task 8) ─────────────────────────
    elbow_flex:         { min: 145 },  // degrees
    elbow_ext:          { min: 0   },
    wrist_flex:         { min: 80  },
    wrist_ext:          { min: 70  },
    cerv_rotation:      { min: 70  },  // degrees
  };

  // Asymmetry penalty thresholds (degrees / cm)
  // elbow/wrist/cervical use the same 10° band the fallback already applied to
  // any unlisted joint — named here so the value is a decision rather than a
  // default nobody chose. These are tolerance bands, not clinical norms.
  const ASYM = {
    hip: 15, shoulder: 10, tibia: 5, ankle_df: 3,
    elbow: 10, wrist: 10, cerv: 10,
  };

  // ── REGION MAP ────────────────────────────────────────────
  // Which body region each scored norm belongs to. The composite is unchanged —
  // this only lets the report say WHERE a limitation is, instead of blending
  // every joint into one number that reads as "lower body" by weight of count.
  const REGION_OF = {
    shoulder_flexion: 'upper', shoulder_extension: 'upper',
    shoulder_ir:      'upper', shoulder_er:        'upper',
    elbow_flex:       'upper', elbow_ext:          'upper',
    wrist_flex:       'upper', wrist_ext:          'upper',
    cerv_rotation:    'spine',
    hip_ir:      'lower', hip_er:        'lower', hip_flexion: 'lower',
    hip_extension: 'lower', hip_abduction: 'lower',
    tibia_ir:    'lower', ankle_df:      'lower',
  };
  const REGION_LABEL = { upper: 'Upper', spine: 'Spine / Neck', lower: 'Lower' };

  // Load test score → percentage map
  const LOAD_MAP = { 3: 100, 2: 66, 1: 33, 0: 0 };

  // ── FORM READER ───────────────────────────────────────────
  // Reads every objective assessment field from the DOM.
  // Returns a plain object used by all three engines.
  function readForm() {
    const g  = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
    const gi = id => { const v = g(id); return v === '' ? null : parseInt(v, 10) || null; };
    const gf = id => { const v = g(id); return v === '' ? null : parseFloat(v) || null; };

    return {
      // Meta
      name:        g('ns-name'),
      age:         gi('ns-age'),
      phase:       g('ns-phase')  || 'Phase 1',
      goal:        g('ns-goal'),
      injury:      g('ns-injury'),
      subjective:  g('ns-subjective'),

      // Toe touch
      toe_touch_score: gi('ns-toetouch-score'),   // 0-3 or -1 for pain
      toe_touch_text:  g('ns-toetouch'),           // free text obs

      // Ankle / foot
      ankle_df_l:    gf('ns-ankle-df-l') || gf('ns-ankle-mob') || null,
      ankle_df_r:    gf('ns-ankle-df-r'),
      pronation_l:   g('ns-pronation-l')  || g('ns-pronsup')  || '',
      pronation_r:   g('ns-pronation-r'),
      supination_l:  g('ns-supination-l'),
      supination_r:  g('ns-supination-r'),

      // Tibia
      tib_ir_l:   gi('ns-tib-ir-l'),
      tib_ir_r:   gi('ns-tib-ir-r'),

      // Hip
      hip_ir_l:   gi('ns-hip-ir-l'),
      hip_ir_r:   gi('ns-hip-ir-r'),
      hip_er_l:   gi('ns-hip-er-l'),
      hip_er_r:   gi('ns-hip-er-r'),
      hip_flex_l: gi('ns-hip-flex-l'),
      hip_flex_r: gi('ns-hip-flex-r'),
      hip_ext_l:  gi('ns-hip-ext-l'),
      hip_ext_r:  gi('ns-hip-ext-r'),
      hip_abd_l:  gi('ns-hip-abd-l'),
      hip_abd_r:  gi('ns-hip-abd-r'),

      // Spine — checkboxes (ns-sp-flex-pain) + optional range notes
      sp_flex_pain:   _spCb('ns-sp-flex-pain'),
      sp_ext_pain:    _spCb('ns-sp-ext-pain'),
      sp_lfl_pain:    _spCb('ns-sp-lfl-pain'),
      sp_lfr_pain:    _spCb('ns-sp-lfr-pain'),
      sp_rotl_pain:   _spCb('ns-sp-rotl-pain'),
      sp_rotr_pain:   _spCb('ns-sp-rotr-pain'),
      sp_flex_range:  g('ns-sp-notes'),
      sp_ext_range:   g('ns-sp-notes'),
      sp_lfl_range:   '',
      sp_lfr_range:   '',
      sp_rotl_range:  '',
      sp_rotr_range:  '',

      // Shoulder
      sh_flex_l:  gi('ns-sh-flex-l'),
      sh_flex_r:  gi('ns-sh-flex-r'),
      sh_ext_l:   gi('ns-sh-ext-l'),
      sh_ext_r:   gi('ns-sh-ext-r'),
      sh_ir_l:    gi('ns-sh-ir-l'),
      sh_ir_r:    gi('ns-sh-ir-r'),
      sh_er_l:    gi('ns-sh-er-l'),
      sh_er_r:    gi('ns-sh-er-r'),

      // Load tolerance (0-3)
      sl_squat_l: gi('ns-sl-squat-l'),
      sl_squat_r: gi('ns-sl-squat-r'),
      sl_rdl_l:   gi('ns-sl-rdl-l'),
      sl_rdl_r:   gi('ns-sl-rdl-r'),
      oh_squat:   gi('ns-oh-squat'),
      load_text:  g('ns-load'),   // legacy free-text fallback

      // Neurology
      bal_eo_l:  gi('ns-bal-eo-l'),
      bal_eo_r:  gi('ns-bal-eo-r'),
      bal_ec_l:  gi('ns-bal-ec-l'),
      bal_ec_r:  gi('ns-bal-ec-r'),
      reach_l:   gi('ns-reach-l'),
      reach_r:   gi('ns-reach-r'),

      // ── NeuCore additions (Task 8) ─────────────────────────
      elbow_flex_l:  gi('ns-elbow-flex-l'),
      elbow_flex_r:  gi('ns-elbow-flex-r'),
      elbow_ext_l:   gi('ns-elbow-ext-l'),
      elbow_ext_r:   gi('ns-elbow-ext-r'),
      wrist_flex_l:  gi('ns-wrist-flex-l'),
      wrist_flex_r:  gi('ns-wrist-flex-r'),
      wrist_ext_l:   gi('ns-wrist-ext-l'),
      wrist_ext_r:   gi('ns-wrist-ext-r'),
      cerv_flex:     g('ns-cerv-flex'),
      cerv_ext:      g('ns-cerv-ext'),
      cerv_rot_l:    gi('ns-cerv-rot-l'),
      cerv_rot_r:    gi('ns-cerv-rot-r'),
      lumb_flex:     g('ns-lumb-flex'),
      lumb_ext:      g('ns-lumb-ext'),
      si_pain:       g('ns-si-pain'),
    };
  }

  // Read spine pain — supports both checkbox (ns-sp-flex-pain) and text (ns-sp-flex → "P")
  function _spPain(id) {
    // Try checkbox version first (ns-sp-flex → ns-sp-flex-pain)
    const cbId = id + '-pain';
    const cb   = document.getElementById(cbId);
    if (cb) return cb.checked;
    // Fall back to text field — "P" or contains "pain"
    const el = document.getElementById(id);
    if (!el) return false;
    const v = el.value.trim().toLowerCase();
    return v === 'p' || v.includes('pain');
  }

  // Direct checkbox reader
  function _spCb(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }

  // ── SCORING FUNCTIONS ────────────────────────────────────

  // Score a single bilateral measurement against a normative minimum.
  // Returns { score, asymmetryFlag } — null if both sides null.
  function _bilateralScore(left, right, normKey) {
    const norm = NORMS[normKey];
    if (!norm) return { score: null, asymmetryFlag: null };
    if (left  === -1 || right === -1) return { score: 0, asymmetryFlag: null, pain: true };

    // `elbow_ext` has min:0, so the usual (value / norm.min) is a division by
    // zero: 0/0 is NaN — which then silently poisons the ROM average, since NaN
    // survives every arithmetic step without throwing — and any positive value
    // yields Infinity, clamping to a perfect 100 for what may be a deficit.
    //
    // A min of 0 means "reaching neutral is full marks", which is how the form
    // reads it (`ns-elbow-ext` placeholder is "0–10°", i.e. neutral through
    // hyperextension). So >= 0 scores 100. A negative value is a flexion
    // contracture, scaled against the 30° mark Neumann gives as the point where
    // functional reach starts falling away sharply (Ch.6). The current form
    // cannot express a contracture, so this branch is defensive.
    const scoreOne = (v) => {
      if (v == null) return null;
      if (norm.min === 0) return v >= 0 ? 100 : Math.max(0, 100 * (1 - Math.abs(v) / 30));
      return Math.min((v / norm.min) * 100, 100);
    };

    const sL = scoreOne(left);
    const sR = scoreOne(right);

    if (sL === null && sR === null) return { score: null, asymmetryFlag: null };

    // Determine asymmetry threshold for this norm key
    const thresh = normKey.startsWith('hip') ? ASYM.hip
      : normKey.startsWith('shoulder') ? ASYM.shoulder
      : normKey.startsWith('elbow') ? ASYM.elbow
      : normKey.startsWith('wrist') ? ASYM.wrist
      : normKey.startsWith('cerv')  ? ASYM.cerv
      : normKey === 'tibia_ir' ? ASYM.tibia
      : normKey === 'ankle_df' ? ASYM.ankle_df : 10;

    let score  = ((sL ?? sR) + (sR ?? sL)) / 2;
    let asymFlag = null;

    if (sL !== null && sR !== null && Math.abs((left ?? 0) - (right ?? 0)) > thresh) {
      score   *= 0.85; // 15% asymmetry penalty
      asymFlag = `${normKey.replace(/_/g,' ')}: L=${left} R=${right} (>${thresh}° asymmetry — prioritize limited side)`;
    }

    return { score: Math.max(0, score), asymmetryFlag: asymFlag };
  }

  // ── ROM SCORE ─────────────────────────────────────────────
  function _calcROM(a) {
    const scores = [];
    const painFlags = [];
    const asymFlags = [];

    const joints = [
      [a.hip_ir_l,   a.hip_ir_r,   'hip_ir'],
      [a.hip_er_l,   a.hip_er_r,   'hip_er'],
      [a.hip_flex_l, a.hip_flex_r, 'hip_flexion'],
      [a.hip_ext_l,  a.hip_ext_r,  'hip_extension'],
      [a.hip_abd_l,  a.hip_abd_r,  'hip_abduction'],
      [a.tib_ir_l,   a.tib_ir_r,   'tibia_ir'],
      [a.ankle_df_l, a.ankle_df_r, 'ankle_df'],
      [a.sh_flex_l,  a.sh_flex_r,  'shoulder_flexion'],
      [a.sh_ext_l,   a.sh_ext_r,   'shoulder_extension'],
      [a.sh_ir_l,    a.sh_ir_r,    'shoulder_ir'],
      [a.sh_er_l,    a.sh_er_r,    'shoulder_er'],

      // Collected by readForm() and given norms since Task 8, but never scored —
      // the coach measured these, the values were parsed, and then nothing read
      // them. Wiring them in needs no new normative data: every threshold below
      // already exists in NORMS.
      [a.elbow_flex_l, a.elbow_flex_r, 'elbow_flex'],
      [a.elbow_ext_l,  a.elbow_ext_r,  'elbow_ext'],
      [a.wrist_flex_l, a.wrist_flex_r, 'wrist_flex'],
      [a.wrist_ext_l,  a.wrist_ext_r,  'wrist_ext'],
      [a.cerv_rot_l,   a.cerv_rot_r,   'cerv_rotation'],
    ];

    // Per-region tallies alongside the flat list. The flat list still drives the
    // composite exactly as before; regions are reporting only.
    const byRegion = { upper: [], spine: [], lower: [] };

    joints.forEach(([L, R, key]) => {
      const { score, asymmetryFlag, pain } = _bilateralScore(L, R, key);
      if (pain) painFlags.push(`Pain in ${key.replace(/_/g,' ')} — manual therapy referral required`);
      if (score !== null) {
        scores.push(score);
        const region = REGION_OF[key];
        if (region) byRegion[region].push(score);
      }
      if (asymmetryFlag) asymFlags.push(asymmetryFlag);
    });

    // Spine pain flags
    const spineChecks = [
      [a.sp_flex_pain,  'spinal flexion'],
      [a.sp_ext_pain,   'spinal extension'],
      [a.sp_lfl_pain,   'left lateral flexion'],
      [a.sp_lfr_pain,   'right lateral flexion'],
      [a.sp_rotl_pain,  'left rotation'],
      [a.sp_rotr_pain,  'right rotation'],
    ];
    spineChecks.forEach(([pain, label]) => {
      if (pain) painFlags.push(`Spinal pain during ${label}`);
    });

    const rom = scores.length
      ? scores.reduce((s, v) => s + v, 0) / scores.length
      : 100;

    // A region with no measurements stays null, never 0. Reporting an
    // unmeasured region as 0% reads as a total deficit rather than "not
    // assessed", which is the opposite of what the coach should act on.
    const region_scores = {};
    for (const key of Object.keys(byRegion)) {
      const vals = byRegion[key];
      region_scores[key] = vals.length
        ? parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1))
        : null;
    }

    return {
      rom_score:      parseFloat(Math.min(rom, 100).toFixed(1)),
      region_scores,
      pain_flags:     painFlags,
      asymmetry_flags: asymFlags,
    };
  }

  // ── CONTROL SCORE ─────────────────────────────────────────
  function _calcControl(a) {
    // Use structured fields if available, fall back to free text parsing
    const sqL = a.sl_squat_l ?? _parseLoadFromText(a.load_text, 'sl squat') ?? 3;
    const sqR = a.sl_squat_r ?? sqL;
    const rdlL = a.sl_rdl_l ?? _parseLoadFromText(a.load_text, 'sl rdl')  ?? 3;
    const rdlR = a.sl_rdl_r ?? rdlL;
    const ohSq = a.oh_squat  ?? _parseLoadFromText(a.load_text, 'oh squat') ?? 3;

    const slSquat = Math.min(LOAD_MAP[sqL]  ?? 100, LOAD_MAP[sqR]  ?? 100);
    const slRDL   = Math.min(LOAD_MAP[rdlL] ?? 100, LOAD_MAP[rdlR] ?? 100);
    const ohSquat =          LOAD_MAP[ohSq] ?? 100;

    return parseFloat(((slSquat + slRDL + ohSquat) / 3).toFixed(1));
  }

  // Parse load score from legacy free-text (0-3)
  function _parseLoadFromText(text, keyword) {
    if (!text) return null;
    const lines = text.toLowerCase().split('\n');
    for (const line of lines) {
      if (!line.includes(keyword.toLowerCase())) continue;
      if (line.includes('pain') || line.includes('/0')) return 0;
      if (line.includes('severe') || line.includes('/1')) return 1;
      if (line.includes('mild') || line.includes('/2')) return 2;
      if (line.includes('clean') || line.includes('/3')) return 3;
    }
    return null;
  }

  // ── FORCE SCORE ───────────────────────────────────────────
  function _calcForce(a, controlScore) {
    const allScores = [
      a.sl_squat_l, a.sl_squat_r, a.sl_rdl_l, a.sl_rdl_r, a.oh_squat,
    ].filter(s => s != null);

    if (allScores.some(s => s === 0)) return 0;  // any pain → 0

    const allClean = allScores.every(s => s === 3);
    if (allClean || !allScores.length) return controlScore;

    // Any compensation → 70% of control
    return parseFloat((controlScore * 0.7).toFixed(1));
  }

  // ── NEUROLOGY SCORE ───────────────────────────────────────
  function _calcNeurology(a) {
    const n = NORMS;
    const eoL  = a.bal_eo_l != null ? Math.min(a.bal_eo_l  / n.sl_balance_eo.min, 1) * 100 : 100;
    const eoR  = a.bal_eo_r != null ? Math.min(a.bal_eo_r  / n.sl_balance_eo.min, 1) * 100 : 100;
    const ecL  = a.bal_ec_l != null ? Math.min(a.bal_ec_l  / n.sl_balance_ec.min, 1) * 100 : 100;
    const ecR  = a.bal_ec_r != null ? Math.min(a.bal_ec_r  / n.sl_balance_ec.min, 1) * 100 : 100;
    const reL  = a.reach_l  != null ? Math.min(a.reach_l   / n.sl_reach.min,      1) * 100 : 100;
    const reR  = a.reach_r  != null ? Math.min(a.reach_r   / n.sl_reach.min,      1) * 100 : 100;

    const neuro = ((eoL + eoR) / 2 + (ecL + ecR) / 2 + (reL + reR) / 2) / 3;
    return parseFloat(neuro.toFixed(1));
  }

  // ── PHASE GATE ────────────────────────────────────────────
  function _phaseGate(a, rom, control, force, neuro, painFlags) {
    const composite = (rom + control + force + neuro) / 4;

    const anyLoadPain = [a.sl_squat_l, a.sl_squat_r, a.sl_rdl_l, a.sl_rdl_r, a.oh_squat]
      .some(s => s === 0);
    const anyJointPain = painFlags.length > 0;

    if (anyJointPain || anyLoadPain) {
      return { phase: 'Phase 1 — Pain Management', composite, referral: true };
    }
    if (composite < 50) return { phase: 'Phase 1 — Mobility',        composite, referral: false };
    if (composite < 75) return { phase: 'Phase 2 — Control',         composite, referral: false };

    const loadOk = [a.sl_squat_l, a.sl_squat_r, a.sl_rdl_l, a.sl_rdl_r, a.oh_squat]
      .filter(s => s != null).every(s => s >= 2);

    if (composite >= 75 && loadOk) {
      return { phase: 'Phase 3 — Load Integration', composite, referral: false };
    }
    return { phase: 'Phase 2 — Control', composite, referral: false };
  }

  // ── MAIN CALCULATE ────────────────────────────────────────
  function calculate(assessment) {
    const a = assessment;

    const { rom_score, region_scores, pain_flags, asymmetry_flags } = _calcROM(a);
    const control_score   = _calcControl(a);
    const force_score     = _calcForce(a, control_score);
    const neurology_score = _calcNeurology(a);

    const { phase, composite, referral } = _phaseGate(
      a, rom_score, control_score, force_score, neurology_score, pain_flags
    );

    return {
      rom_score,
      region_scores,
      control_score,
      force_score,
      neurology_score,
      composite_score:      parseFloat(composite.toFixed(1)),
      phase_recommendation: phase,
      referral_required:    referral,
      pain_flags,
      asymmetry_flags,
    };
  }

  // ── RENDER SCORES INTO DOM ────────────────────────────────
  // Targets the #score-panel injected by index.html
  function renderScores(scores) {
    const panel = document.getElementById('score-panel');
    if (!panel) return;

    const phaseColor = scores.phase_recommendation.includes('Pain') ? 'var(--rose)'
      : scores.phase_recommendation.includes('1')   ? 'var(--teal)'
      : scores.phase_recommendation.includes('2')   ? 'var(--amber)'
      : 'var(--lime)';

    const bar = (val, color) => `
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1;height:5px;background:var(--border-default);border-radius:3px;overflow:hidden">
          <div style="width:${Math.min(val,100)}%;height:100%;background:${color};border-radius:3px;transition:width 0.6s cubic-bezier(.34,1.56,.64,1)"></div>
        </div>
        <span style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:${color};min-width:36px;text-align:right">${val}%</span>
      </div>`;

    panel.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <div class="card-header">
          <span class="card-title">Movement Quality Scores</span>
          <span class="badge" style="background:${phaseColor}18;color:${phaseColor};border:1px solid ${phaseColor}30;font-size:10px">
            ${scores.phase_recommendation}
          </span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px">
          ${_scoreItem('ROM',       scores.rom_score,       'var(--teal)')}
          ${_scoreItem('Control',   scores.control_score,   'var(--lime)')}
          ${_scoreItem('Force',     scores.force_score,     'var(--amber)')}
          ${_scoreItem('Neurology', scores.neurology_score, 'var(--blue)')}
        </div>

        ${_regionRow(scores.region_scores)}

        <div style="background:var(--bg-raised);border-radius:var(--r-md);padding:14px">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">Composite Score</div>
          ${bar(scores.composite_score, phaseColor)}
          <div style="font-family:var(--font-display);font-size:32px;font-weight:800;color:${phaseColor};margin-top:8px;letter-spacing:-1px">${scores.composite_score}<span style="font-size:16px">%</span></div>
        </div>

        ${scores.referral_required ? `
        <div style="background:rgba(245,66,108,0.08);border:1px solid rgba(245,66,108,0.25);border-radius:var(--r-sm);padding:10px 14px;margin-top:12px;font-size:12px;color:var(--rose)">
          ⚠ Manual therapy referral required before progressive loading
        </div>` : ''}

        ${scores.pain_flags.length ? `
        <div style="margin-top:12px">
          ${scores.pain_flags.map(f => `<div style="font-size:11px;color:var(--rose);padding:3px 0">• ${f}</div>`).join('')}
        </div>` : ''}

        ${scores.asymmetry_flags.length ? `
        <div style="margin-top:8px">
          ${scores.asymmetry_flags.map(f => `<div style="font-size:11px;color:var(--amber);padding:3px 0">△ ${f}</div>`).join('')}
        </div>` : ''}
      </div>`;

    panel.classList.remove('hidden');
  }

  // ROM broken out by body region. Uses the same _scoreItem card as the four
  // component scores above it — same tokens, same type, no new component.
  // An unmeasured region shows the words "Not assessed" rather than a number,
  // so it cannot be misread as a deficit (and carries a label, not just a
  // colour, per the No Colour-Only rule).
  function _regionRow(regions) {
    if (!regions) return '';
    const order = ['upper', 'spine', 'lower'];
    if (order.every((k) => regions[k] == null)) return '';

    const cell = (key) => {
      const val = regions[key];
      const label = REGION_LABEL[key];
      if (val == null) {
        return `
        <div style="background:var(--bg-raised);border-radius:var(--r-sm);padding:12px">
          <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:6px">${label}</div>
          <div style="font-family:var(--font-display);font-size:15px;font-weight:600;color:var(--text-tertiary);letter-spacing:-0.2px">Not assessed</div>
          <div style="height:3px;border-radius:2px;background:var(--border-default);margin-top:8px"></div>
        </div>`;
      }
      const color = val >= 75 ? 'var(--lime)' : val >= 50 ? 'var(--amber)' : 'var(--rose)';
      return _scoreItem(label, val, color);
    };

    return `
      <div style="margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">Range of Motion by Region</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          ${order.map(cell).join('')}
        </div>
      </div>`;
  }

  function _scoreItem(label, val, color) {
    return `
    <div style="background:var(--bg-raised);border-radius:var(--r-sm);padding:12px">
      <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:6px">${label}</div>
      <div style="font-family:var(--font-display);font-size:28px;font-weight:800;color:${color};letter-spacing:-1px">${val}<span style="font-size:13px">%</span></div>
      <div style="height:3px;border-radius:2px;background:var(--border-default);margin-top:8px;overflow:hidden">
        <div style="width:${Math.min(val,100)}%;height:100%;background:${color};border-radius:2px;transition:width 0.5s ease"></div>
      </div>
    </div>`;
  }

  return { readForm, calculate, renderScores, NORMS, ASYM };

})();

window.ScoringEngine = ScoringEngine;
