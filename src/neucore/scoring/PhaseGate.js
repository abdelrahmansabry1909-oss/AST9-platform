// src/neucore/scoring/PhaseGate.js
import { ScoringEngine } from './ScoringEngine.js';

export class PhaseGate {
  constructor(assessment) {
    this.scorer = new ScoringEngine(assessment);
  }

  evaluate() {
    const scores = this.scorer.fullScores();
    const rec    = this.scorer.phaseRecommendation();

    return {
      ...scores,
      ...rec,
      flags: this._flags(scores),
    };
  }

  _flags(scores) {
    const flags = [];
    if (scores.rom_score       != null && scores.rom_score       < 50) flags.push({ type: 'ROM',       msg: 'Significant ROM deficits — prioritize mobility work' });
    if (scores.control_score   != null && scores.control_score   < 50) flags.push({ type: 'Control',   msg: 'Poor neuromuscular control — focus single-leg stability' });
    if (scores.force_score     != null && scores.force_score     < 50) flags.push({ type: 'Force',     msg: 'Hip weakness detected — glute activation priority' });
    if (scores.neurology_score != null && scores.neurology_score < 50) flags.push({ type: 'Neurology', msg: 'Balance deficits — proprioceptive training indicated' });
    return flags;
  }
}
