import { GAIT_PHASES } from './MuscleActivationDB.js';

// Physiological gait timing as a fraction of one stride. The final phase wraps
// back to loading response at 1.0. These boundaries are shared by pose
// sampling, phase events, and analysis jumps so the UI and model cannot drift.
export const GAIT_PHASE_STARTS = Object.freeze([
  0.00, // loading response
  0.10, // mid stance
  0.30, // terminal stance
  0.50, // pre swing
  0.60, // initial swing
  0.73, // mid swing
  0.87, // terminal swing
]);

const EPSILON = 1e-12;

export function normalizeCyclePhase(phase) {
  if (!Number.isFinite(phase)) return 0;
  return ((phase % 1) + 1) % 1;
}

export function getGaitPhaseSample(phase) {
  const cyclePhase = normalizeCyclePhase(phase);
  let index = GAIT_PHASE_STARTS.length - 1;

  for (let i = 0; i < GAIT_PHASE_STARTS.length - 1; i += 1) {
    if (cyclePhase < GAIT_PHASE_STARTS[i + 1]) {
      index = i;
      break;
    }
  }

  const start = GAIT_PHASE_STARTS[index];
  const end = index === GAIT_PHASE_STARTS.length - 1
    ? 1
    : GAIT_PHASE_STARTS[index + 1];

  return {
    phase: cyclePhase,
    index,
    name: GAIT_PHASES[index],
    nextName: GAIT_PHASES[(index + 1) % GAIT_PHASES.length],
    start,
    end,
    duration: end - start,
    t: (cyclePhase - start) / (end - start),
  };
}

export function getPhasePosePosition(phaseName, offset = 0.35) {
  const index = GAIT_PHASES.indexOf(phaseName);
  if (index < 0) return 0;
  const start = GAIT_PHASE_STARTS[index];
  const end = index === GAIT_PHASE_STARTS.length - 1
    ? 1
    : GAIT_PHASE_STARTS[index + 1];
  return normalizeCyclePhase(start + (end - start) * offset);
}

function intervalDuration(index) {
  const start = GAIT_PHASE_STARTS[index];
  const end = index === GAIT_PHASE_STARTS.length - 1
    ? 1
    : GAIT_PHASE_STARTS[index + 1];
  return end - start;
}

// Periodic PCHIP tangents keep the clinical control values exact, preserve
// monotonicity between adjacent values, and provide continuous velocity at all
// phase boundaries including terminal swing -> loading response.
function computePeriodicTangents(values) {
  const count = values.length;
  const tangents = new Array(count).fill(0);

  for (let i = 0; i < count; i += 1) {
    const prev = (i - 1 + count) % count;
    const next = (i + 1) % count;
    const hPrev = intervalDuration(prev);
    const hNext = intervalDuration(i);
    const deltaPrev = (values[i] - values[prev]) / hPrev;
    const deltaNext = (values[next] - values[i]) / hNext;

    if (
      Math.abs(deltaPrev) < EPSILON
      || Math.abs(deltaNext) < EPSILON
      || Math.sign(deltaPrev) !== Math.sign(deltaNext)
    ) {
      tangents[i] = 0;
      continue;
    }

    const w1 = (2 * hNext) + hPrev;
    const w2 = hNext + (2 * hPrev);
    tangents[i] = (w1 + w2) / ((w1 / deltaPrev) + (w2 / deltaNext));
  }

  return tangents;
}

export function createPeriodicGaitCurve(valuesByPhase) {
  const values = GAIT_PHASES.map((phaseName) => {
    const value = Number(valuesByPhase?.[phaseName]);
    return Number.isFinite(value) ? value : 0;
  });

  return Object.freeze({
    values: Object.freeze(values),
    tangents: Object.freeze(computePeriodicTangents(values)),
  });
}

export function samplePeriodicGaitCurve(curve, phase) {
  const sample = getGaitPhaseSample(phase);
  const index = sample.index;
  const next = (index + 1) % GAIT_PHASES.length;
  const t = sample.t;
  const t2 = t * t;
  const t3 = t2 * t;
  const h = sample.duration;

  const h00 = (2 * t3) - (3 * t2) + 1;
  const h10 = t3 - (2 * t2) + t;
  const h01 = (-2 * t3) + (3 * t2);
  const h11 = t3 - t2;

  const value = (h00 * curve.values[index])
    + (h10 * h * curve.tangents[index])
    + (h01 * curve.values[next])
    + (h11 * h * curve.tangents[next]);

  // PCHIP should already stay inside this interval. The final clamp protects
  // deficit-modified curves from floating-point or future data anomalies.
  const low = Math.min(curve.values[index], curve.values[next]);
  const high = Math.max(curve.values[index], curve.values[next]);
  return Math.min(high, Math.max(low, value));
}
