// src/neucore/client/clientCharts.js
// Phase C — the three metric panels under the Hero on the Client Dashboard.
//
//   Force Steadiness  — line chart, normative band + client trace across
//                       the 7 gait phases. Higher = more stable.
//   Center of Gravity — line chart, sagittal-plane CoG drift across the
//                       gait cycle. Closer to 0 = better.
//   Risk Timeline     — area chart projecting accumulated risk over 24
//                       months if the current load pattern is left
//                       unaddressed. Sobering by design.
//
// All derivation functions are pure and bounded. When real data isn't
// available the renderer degrades to a normative-only display with copy
// that tells the client what to do to populate it.

import Chart from 'chart.js/auto';

// ── Palette (kept in lock-step with css/styles.css NeuCore tokens) ──
const TEAL    = '#3DF5C1';
const CYAN    = '#67E8F9';
const AMBER   = '#FACC15';
const ORANGE  = '#FF8800';
const MAGENTA = '#FF2D78';
const MUTED   = 'rgba(0,212,255,0.45)';
const GRID    = 'rgba(0,212,255,0.06)';

const GAIT_LABELS = [
  'Loading', 'Mid Stance', 'Terminal', 'Pre-Swing',
  'Init Swing', 'Mid Swing', 'Term Swing',
];

// ── Shared Chart.js options ─────────────────────────────────────────
function _baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600 },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          color: 'rgba(200,240,255,0.7)',
          font: { size: 10, family: 'Inter, system-ui, sans-serif' },
          boxWidth: 10, boxHeight: 10, padding: 8,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(5,13,26,0.95)',
        borderColor: 'rgba(0,212,255,0.25)',
        borderWidth: 1,
        titleColor: CYAN, bodyColor: 'rgba(200,240,255,0.9)',
        padding: 8, displayColors: false,
      },
    },
    scales: {
      x: {
        ticks: { color: 'rgba(0,212,255,0.55)', font: { size: 9 } },
        grid:  { color: GRID, drawTicks: false },
      },
      y: {
        beginAtZero: true,
        ticks: { color: 'rgba(0,212,255,0.55)', font: { size: 9 } },
        grid:  { color: GRID, drawTicks: false },
      },
    },
  };
}

// ────────────────────────────────────────────────────────────────────
//  FORCE STEADINESS
// ────────────────────────────────────────────────────────────────────
const FORCE_NORM = [82, 88, 90, 78, 72, 78, 84];   // healthy normative profile

export function deriveForceSteadiness(gait) {
  if (!gait || typeof gait !== 'object') {
    return { phases: GAIT_LABELS, normative: FORCE_NORM, client: null, hasRealData: false };
  }
  // Use symmetry_index (0-100) as a global scalar that reduces every
  // phase by the asymmetry deficit. Phase-level resolution would need
  // a richer schema — out of scope for Phase C.
  const sym = typeof gait.symmetry_index === 'number'
    ? Math.max(0, Math.min(100, gait.symmetry_index))
    : null;
  if (sym === null) {
    return { phases: GAIT_LABELS, normative: FORCE_NORM, client: null, hasRealData: false };
  }
  const drop = Math.max(0, 100 - sym) * 0.6;         // how far below normative
  const client = FORCE_NORM.map(v => Math.max(20, Math.round(v - drop)));
  return { phases: GAIT_LABELS, normative: FORCE_NORM, client, hasRealData: true };
}

export function renderForceSteadiness(host, data) {
  const canvas = _ensureCanvas(host);
  const ds = [{
    label: 'Normative',
    data: data.normative,
    borderColor: MUTED, backgroundColor: 'transparent',
    borderDash: [4, 4], borderWidth: 1.5,
    tension: 0.4, pointRadius: 0,
  }];
  if (data.client) {
    ds.push({
      label: 'Your trace',
      data: data.client,
      borderColor: CYAN,
      backgroundColor: 'rgba(103,232,249,0.12)',
      borderWidth: 2, tension: 0.4, fill: true,
      pointRadius: 2, pointBackgroundColor: CYAN,
    });
  }
  const opts = _baseOptions();
  opts.scales.y.suggestedMin = 0;
  opts.scales.y.suggestedMax = 100;
  return new Chart(canvas, {
    type: 'line',
    data: { labels: data.phases, datasets: ds },
    options: opts,
  });
}

// ────────────────────────────────────────────────────────────────────
//  CENTER OF GRAVITY — sagittal drift across the gait cycle (cm)
// ────────────────────────────────────────────────────────────────────
const COG_NORM = [0.5, 0.2, -0.4, -0.8, -0.3, 0.2, 0.6];   // sinusoidal-ish

export function deriveCenterOfGravity(assessment, gait) {
  // Forward-lean / oh_squat_forward_lean flag amplifies the swing.
  const leanFlag = !!(assessment?.oh_squat_forward_lean);
  // Hip extension deficit (uses left side as proxy) shifts the CoG
  // posteriorly during terminal stance.
  const ext = typeof assessment?.hip_extension_left === 'number'
    ? Math.max(0, 15 - assessment.hip_extension_left)
    : 0;
  const hasRealData = leanFlag || ext > 0 || !!gait;
  if (!hasRealData) {
    return { phases: GAIT_LABELS, normative: COG_NORM, client: null, hasRealData: false };
  }
  const amplify = 1 + (leanFlag ? 0.8 : 0) + Math.min(ext / 10, 0.6);
  const shiftPosterior = ext > 0 ? -0.5 : 0;
  const client = COG_NORM.map(v => +(v * amplify + shiftPosterior).toFixed(2));
  return { phases: GAIT_LABELS, normative: COG_NORM, client, hasRealData: true };
}

export function renderCenterOfGravity(host, data) {
  const canvas = _ensureCanvas(host);
  const ds = [{
    label: 'Normative drift',
    data: data.normative,
    borderColor: MUTED, backgroundColor: 'transparent',
    borderDash: [4, 4], borderWidth: 1.5,
    tension: 0.5, pointRadius: 0,
  }];
  if (data.client) {
    ds.push({
      label: 'Your drift',
      data: data.client,
      borderColor: TEAL,
      backgroundColor: 'rgba(61,245,193,0.12)',
      borderWidth: 2, tension: 0.5, fill: true,
      pointRadius: 2, pointBackgroundColor: TEAL,
    });
  }
  const opts = _baseOptions();
  opts.scales.y.beginAtZero = false;
  opts.scales.y.suggestedMin = -2;
  opts.scales.y.suggestedMax = 2;
  return new Chart(canvas, {
    type: 'line',
    data: { labels: data.phases, datasets: ds },
    options: opts,
  });
}

// ────────────────────────────────────────────────────────────────────
//  RISK TIMELINE — projected accumulated risk over 24 months
// ────────────────────────────────────────────────────────────────────
const MONTHS = [0, 3, 6, 9, 12, 18, 24];

export function deriveRiskTimeline(loadProfile, composite) {
  // Average current load (0-100); higher = greater untreated trajectory.
  const a = loadProfile?.currentA || {};
  const regions = Object.values(a);
  const avg = regions.length ? regions.reduce((s, v) => s + v, 0) / regions.length : 45;
  const start = Math.max(15, Math.round(avg));
  // Untreated grows roughly linearly with monthly compounding deficit.
  const untreated = MONTHS.map(m => Math.min(100, Math.round(start + m * (avg / 22))));
  // Treated trajectory plateaus at the target load and slowly recovers.
  const composite0 = typeof composite === 'number' ? composite : 60;
  const treatedStart = start;
  const treated = MONTHS.map((m, i) => {
    if (i === 0) return treatedStart;
    const decay = Math.exp(-m / 9);
    const target = 22;
    return Math.round(target + (treatedStart - target) * decay);
  });
  return {
    months: MONTHS.map(m => m === 0 ? 'Today' : `${m}m`),
    untreated, treated,
    hasRealData: !!loadProfile?.hasRealData,
  };
}

export function renderRiskTimeline(host, data) {
  const canvas = _ensureCanvas(host);
  const ds = [
    {
      label: 'Untreated risk',
      data: data.untreated,
      borderColor: MAGENTA,
      backgroundColor: 'rgba(255,45,120,0.18)',
      borderWidth: 2, tension: 0.35, fill: true,
      pointRadius: 2, pointBackgroundColor: MAGENTA,
    },
    {
      label: 'On the plan',
      data: data.treated,
      borderColor: TEAL,
      backgroundColor: 'transparent',
      borderWidth: 2, tension: 0.4, fill: false,
      pointRadius: 2, pointBackgroundColor: TEAL,
    },
  ];
  const opts = _baseOptions();
  opts.scales.y.suggestedMin = 0;
  opts.scales.y.suggestedMax = 100;
  opts.scales.y.ticks.callback = (v) => v + '%';
  return new Chart(canvas, {
    type: 'line',
    data: { labels: data.months, datasets: ds },
    options: opts,
  });
}

// ── Helpers ────────────────────────────────────────────────────────
function _ensureCanvas(host) {
  if (!host) return null;
  host.innerHTML = '';
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  return canvas;
}

export function destroyChart(chart) {
  try { chart?.destroy?.(); } catch {}
}
