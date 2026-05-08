// src/neucore/program/ProgramGenerator.js
// Builds a structured rehab program from assessment + gait deficits.
// Uses RuleEngine to gate phases and filter unsafe exercises.

import { RuleEngine } from './RuleEngine.js';
import { ScoringEngine } from '../scoring/ScoringEngine.js';
import { evaluateGaitRules } from '../gait/GaitRules.js';

const PHASE_DEFAULTS = {
  'Phase 1': { sets: '2–3', reps: '30–60s holds', tempo: '4-2-4', rest: '60s',  load: 'none' },
  'Phase 2': { sets: '3–4', reps: '8–12',         tempo: '3-1-3', rest: '90s',  load: 'bodyweight' },
  'Phase 3': { sets: '3–5', reps: '3–8',          tempo: '1-0-X', rest: '120s', load: 'external' },
};

const WARMUPS = {
  'Phase 1': [
    { name: 'Diaphragmatic Breathing — PRI 90/90', sets: 3, reps: '5 breaths', notes: 'Full exhale, feel rib cage lower, pelvis posteriorly tilt' },
    { name: 'Hip Joint Decompression CARs',        sets: 1, reps: '5 each side', notes: 'Slow, full rotation — no compensation' },
    { name: 'Cat-Camel Spinal Segmentation',       sets: 2, reps: '10', notes: 'Articulate each vertebral level individually' },
    { name: 'Dead Bug Core Activation',            sets: 2, reps: '8 each side', notes: 'Lumbar neutral, exhale on extension' },
  ],
  'Phase 2': [
    { name: 'Breathing Reset — 90/90 Hip Lift',   sets: 2, reps: '5 breaths', notes: 'Restore ZOA, posterior pelvic tilt on exhale' },
    { name: 'Full Body CARs Sequence',             sets: 1, reps: '5 each joint', notes: 'Neck → shoulder → thoracic → hip → ankle' },
    { name: 'PAILs/RAILs Activation (limited)',   sets: 2, reps: '2 min', notes: 'Target deficit joint, build to 80% effort' },
    { name: 'Core Pre-Activation — Bird Dog',      sets: 2, reps: '10 each side', notes: 'Anti-rotation, reach long on extension' },
  ],
  'Phase 3': [
    { name: 'Dynamic Breathing + Bracing',         sets: 2, reps: '8', notes: '360° breathing, brace on exhale — 80% effort' },
    { name: 'Dynamic Mobility — Hip/Ankle Circuit',sets: 1, reps: '10 each', notes: 'Leg swings, ankle circles, hip CARs' },
    { name: 'CNS Neural Activation',               sets: 3, reps: '5', notes: 'Jump or med ball slam — max intent, full recovery' },
    { name: 'Primary Movement Pattern Rehearsal',  sets: 2, reps: '5', notes: 'Unloaded version of main lift — groove pattern' },
  ],
};

const COOLDOWNS = {
  'Phase 1': [
    { name: 'Static Breathing Reset',             sets: 3, reps: '5 breaths', notes: '5s inhale / 7s exhale — parasympathetic shift' },
    { name: 'Passive Mobility Hold',               sets: 2, reps: '60s each',  notes: 'Target joints worked today, no PAILs' },
  ],
  'Phase 2': [
    { name: 'Breathing + NS Downregulation',       sets: 3, reps: '5 breaths', notes: '2:1 exhale ratio, progressive relaxation' },
    { name: 'Myofascial Release + Passive Stretch',sets: 2, reps: '45s each',  notes: 'Session muscles only' },
  ],
  'Phase 3': [
    { name: 'Post-Load Breathing Reset',           sets: 3, reps: '5 breaths', notes: 'Diaphragmatic, lower heart rate intentionally' },
    { name: 'Active Recovery Mobility Flow',       sets: 2, reps: '30s each',  notes: 'Gentle movement through worked ranges' },
  ],
};

// Deficit → exercise prescriptions
const DEFICIT_EXERCISES = {
  limited_df: [
    { name: 'Ankle Rocker Mobilization',           sets: 3, reps: '10 each', tempo: 'controlled', notes: 'Half-kneeling, drive knee over 5th toe, keep heel down' },
    { name: 'Gastroc/Soleus Eccentric Lengthening',sets: 3, reps: '15 slow',  tempo: '4-0-1',     notes: 'Heel drop off step, bilateral → single leg progression' },
  ],
  over_pronation: [
    { name: 'Foot Intrinsic Activation (Short Foot)',    sets: 3, reps: '10 × 3s', tempo: 'slow',    notes: 'Seated, shorten foot without toe curl' },
    { name: 'Posterior Tibialis Strengthening',          sets: 3, reps: '15',      tempo: '3-1-3',   notes: 'Band inversion + plantar flexion' },
    { name: 'Glute Medius Clamshell',                    sets: 3, reps: '15 each', tempo: '3-1-3',   notes: 'Heels together, no hip flexion shift' },
  ],
  stuck_supination: [
    { name: 'Subtalar Mobilization',    sets: 3, reps: '10 each',  tempo: 'controlled', notes: 'Guided eversion/inversion — seated' },
    { name: 'Peroneal Activation',      sets: 3, reps: '15',       tempo: '3-1-3',      notes: 'Band eversion, foot in neutral' },
  ],
  limited_hip_ir: [
    { name: '90/90 Hip IR PAILs/RAILs', sets: 2, reps: '2 min',      tempo: 'progressive', notes: 'Front leg in IR, passive → 80% contraction' },
    { name: 'Hip IR CARs',              sets: 2, reps: '5 each side', tempo: 'controlled',  notes: 'Supine — isolate rotation, no pelvic movement' },
  ],
  limited_hip_extension: [
    { name: 'Hip Flexor Lengthening — PRI 90/90',    sets: 3, reps: '90s each', tempo: 'slow',    notes: 'Exhale-driven, posterior pelvic tilt, no lumbar extension' },
    { name: 'Glute Max Activation — Prone Hip Ext',  sets: 3, reps: '15',       tempo: '3-1-3',   notes: 'Prone, knee bent 90°, isolate glute — no lumbar hike' },
  ],
  trendelenburg: [
    { name: 'Sidelying Glute Medius Activation', sets: 3, reps: '15 each', tempo: '3-1-3', notes: 'Hip neutral — no external rotation compensation' },
    { name: 'Clamshell with Resistance Band',    sets: 3, reps: '15 each', tempo: '3-1-3', notes: 'Top knee drives up 45° only' },
    { name: 'SL Stance Wall-Touch Glute Med',    sets: 3, reps: '12 each', tempo: '2-1-2', notes: 'Balance on stance leg, tap opposite foot to wall' },
  ],
  sl_rdl_trunk_rotation: [
    { name: 'Pallof Press — Anti-Rotation', sets: 3, reps: '12 each', tempo: '3-1-3', notes: 'Cable or band perpendicular to anchor — no trunk rotation' },
    { name: 'Dead Bug — Contralateral',     sets: 3, reps: '10 each', tempo: '4-0-1', notes: 'Slow arm/leg lowering, lumbar stays neutral' },
  ],
  oh_squat_forward_lean: [
    { name: 'Ankle DF Mobilization — Half-Kneeling', sets: 3, reps: '10 each', tempo: 'controlled', notes: 'Knee tracks over 5th toe, heel down' },
    { name: 'Thoracic Extension CARs',                sets: 2, reps: '5 each',  tempo: 'controlled', notes: 'Hands behind head — rotate around thoracic only' },
  ],
  poor_balance_eo: [
    { name: 'SL Balance Progression — Eyes Open',  sets: 3, reps: '30s each', tempo: 'controlled', notes: 'Firm surface → foam pad progression' },
    { name: 'Tibialis Anterior Activation',         sets: 3, reps: '15',       tempo: '3-1-3',     notes: 'Ankle dorsiflexion, eccentric emphasis' },
  ],
};

export class ProgramGenerator {
  constructor(assessment) {
    this.assessment = assessment;
    this._scorer    = new ScoringEngine(assessment);
    this._scores    = this._scorer.fullScores();
    this._deficits  = evaluateGaitRules(assessment);
    this._rules     = new RuleEngine(assessment, this._scores, this._deficits);
  }

  generate() {
    const { maxPhase, phaseWarnings, contraindicated } = this._rules.evaluate();
    const defaults  = PHASE_DEFAULTS[maxPhase];
    const exercises = this._buildMainExercises(contraindicated);
    const notes     = this._buildNotes();
    const phase     = this._scorer.phaseRecommendation();

    return {
      phase:     maxPhase,
      referral:  phase.referral,
      scores:    this._scores,
      warnings:  phaseWarnings.map(w => w.reason),
      notes,
      defaults,
      structure: {
        warmup:       WARMUPS[maxPhase],
        main:         exercises,
        cooldown:     COOLDOWNS[maxPhase],
      },
      deficits:       this._deficits.map(d => d.label),
      contraindicated,
      generatedAt:    new Date().toISOString(),
    };
  }

  _buildMainExercises(contraindicated) {
    const exercises = [];
    const seen      = new Set();

    this._deficits.forEach(d => {
      const list = DEFICIT_EXERCISES[d.id];
      if (!list) return;
      list.forEach(ex => {
        if (seen.has(ex.name)) return;
        // Filter if any contraindicated pattern appears in the name
        const nameKey = ex.name.toLowerCase().replace(/[\s-]/g, '_');
        const blocked = contraindicated.some(c => nameKey.includes(c));
        if (!blocked) {
          seen.add(ex.name);
          exercises.push({ ...ex, deficitSource: d.label });
        }
      });
    });

    return exercises;
  }

  _buildNotes() {
    const notes = [];
    const a     = this.assessment;

    const hipIrL = parseFloat(a.hip_ir_left  ?? a.hip_ir_l);
    const hipIrR = parseFloat(a.hip_ir_right ?? a.hip_ir_r);
    if (!isNaN(hipIrL) && !isNaN(hipIrR) && Math.abs(hipIrL - hipIrR) > 15) {
      notes.push('Hip IR asymmetry >15°: prioritize the limited side in all hip mobility work.');
    }

    if (this._deficits.some(d => d.activeSeverity === 'severe')) {
      notes.push('One or more severe deficits present — reassess in 4 weeks before advancing phase.');
    }

    if (this._scores.composite_score != null && this._scores.composite_score < 50) {
      notes.push('Low composite score: prioritize pain-free range restoration before loading.');
    }

    return notes;
  }
}
