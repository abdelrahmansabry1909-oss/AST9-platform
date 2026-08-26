// src/neucore/scoring/ScoringEngine.js
export class ScoringEngine {
  constructor(assessment) {
    this.a = assessment ?? {};
  }

  fullScores() {
    // Compute the four component scores once, then derive the composite from
    // those values. _composite() used to call fullScores(), which called
    // _composite() again — infinite recursion (RangeError, surfaced as
    // "Score unavailable"). Passing the components in breaks the cycle.
    const rom_score       = this._romScore();
    const control_score   = this._controlScore();
    const force_score     = this._forceScore();
    const neurology_score = this._neurologyScore();
    return {
      rom_score,
      control_score,
      force_score,
      neurology_score,
      composite_score: this._composite(rom_score, control_score, force_score, neurology_score),
    };
  }

  _romScore() {
    const a = this.a;
    const vals = [
      this._pct(a.hip_ir_left,        45),
      this._pct(a.hip_ir_right,       45),
      this._pct(a.ankle_dorsiflexion_left_cm,  10),
      this._pct(a.ankle_dorsiflexion_right_cm, 10),
      this._pct(a.shoulder_flexion_left,  180),
      this._pct(a.shoulder_flexion_right, 180),
      this._pct(a.hip_flexion_left,    120),
      this._pct(a.hip_flexion_right,   120),
    ].filter(v => v != null);
    return this._avg(vals);
  }

  // Load-tolerance selects in app.html offer 3/2/1/0 — 3 is the best a coach
  // can record. Dividing by 5 made a flawless result score 60 instead of 100,
  // and no input could ever reach the top of the scale. js/scoring.js maps the
  // same field with LOAD_MAP { 3:100, 2:66, 1:33, 0:0 }, so the two engines
  // disagreed on identical data.
  static LOAD_MAX = 3;

  _controlScore() {
    const a = this.a;
    const max = ScoringEngine.LOAD_MAX;
    const vals = [
      this._scale(a.sl_squat_l, max),
      this._scale(a.sl_squat_r, max),
      this._scale(a.sl_rdl_l,   max),
      this._scale(a.sl_rdl_r,   max),
      this._scale(a.oh_squat,   max),
    ].filter(v => v != null);
    return this._avg(vals);
  }

  _forceScore() {
    const a = this.a;
    const vals = [
      this._pct(a.hip_abduction_left,  45),
      this._pct(a.hip_abduction_right, 45),
      this._pct(a.hip_extension_left,  20),
      this._pct(a.hip_extension_right, 20),
    ].filter(v => v != null);
    return this._avg(vals);
  }

  _neurologyScore() {
    const a = this.a;
    const vals = [
      this._balScore(a.bal_eo_l),
      this._balScore(a.bal_eo_r),
    ].filter(v => v != null);
    const painPenalty = (a.sp_flex_pain ? 10 : 0);
    return Math.max(0, this._avg(vals) - painPenalty);
  }

  // Arithmetic mean of the four component scores (null values excluded).
  // Callers that already have the components (fullScores) pass them in;
  // phaseRecommendation() calls with no args and the defaults recompute them.
  // Either way this never calls fullScores(), so there is no recursion.
  _composite(
    rom       = this._romScore(),
    control   = this._controlScore(),
    force     = this._forceScore(),
    neurology = this._neurologyScore(),
  ) {
    const scores = [rom, control, force, neurology].filter(v => v != null);
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  phaseRecommendation() {
    const c = this._composite();
    if (c == null) return { phase: 'Insufficient data', referral: false };
    if (c >= 80)   return { phase: 'Phase 3 — Performance', referral: false };
    if (c >= 60)   return { phase: 'Phase 2 — Strength & Control', referral: false };
    if (c >= 40)   return { phase: 'Phase 1 — Foundation', referral: false };
    return { phase: 'Phase 1 — Foundation', referral: true };
  }

  _pct(val, norm) {
    if (val == null || val === '') return null;
    return Math.min(100, Math.round((parseFloat(val) / norm) * 100));
  }

  // Clamped like _pct. Without it a value above `max` yields over 100 and drags
  // the component average above the scale it is measured on.
  _scale(val, max) {
    if (val == null || val === '') return null;
    return Math.min(100, Math.round((parseFloat(val) / max) * 100));
  }

  _balScore(val) {
    if (val == null || val === '') return null;
    const v = parseFloat(val);
    if (v >= 30) return 100;
    if (v >= 20) return 75;
    if (v >= 10) return 50;
    return 25;
  }

  _avg(arr) {
    if (!arr.length) return null;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }
}
