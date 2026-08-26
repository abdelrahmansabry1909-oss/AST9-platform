// src/neucore/simulation/ShoulderActivationDB.js
//
// Scapular upward-rotator activation through the arc of shoulder elevation.
//
// MuscleActivationDB is keyed to the seven gait phases, which is why the
// simulation page has nothing to say about a shoulder: upper-body muscles have
// no gait-phase profile. This is the upper-body axis — arm abduction angle
// rather than percent of gait cycle.
//
// PROVENANCE. The values below were read off the plotted curves in Neumann
// Fig. 5-51 ("EMG activation pattern of the upper trapezius and lower trapezius
// and the lower fibers of the serratus anterior during shoulder abduction in
// the scapular plane", data from Bagg & Forrest, Am J Phys Med 65:111-124,
// 1986). They are graph readings, not tabulated figures — treat them as
// accurate to about ±5 %MVIC, and do not present them as exact.
//
// Deltoid and supraspinatus are deliberately ABSENT. The text states they are
// activated at the onset of elevation and peak near 90 degrees, and that they
// contribute about equal shares of the abduction torque — but no curve is
// plotted for them, so there is nothing to read. A shoulder chart without a
// deltoid looks incomplete; a shoulder chart with an invented deltoid curve is
// worse. Their described behaviour is surfaced as text instead.

export const ELEVATION_ANGLES = [30, 60, 90, 120, 150, 165];

export const SCAPULAR_MUSCLES = [
  {
    key: 'upper_trapezius',
    label: 'Upper Trapezius',
    // Rises sharply at initiation, plateaus through the middle arc, climbs
    // again at end range. It elevates the clavicle early, then balances the
    // inferior pull of the lower trapezius late.
    curve: [26, 38, 45, 52, 80, 95],
    role: 'Elevates the clavicle early, then balances the lower trapezius late',
  },
  {
    key: 'serratus_anterior',
    label: 'Serratus Anterior',
    // Near-linear rise across the whole arc. The most effective upward rotator
    // — it has the largest moment arm for the motion.
    curve: [16, 30, 47, 58, 82, 95],
    role: 'The most effective upward rotator — largest moment arm',
  },
  {
    key: 'lower_trapezius',
    label: 'Lower Trapezius',
    // Almost silent until roughly 90 degrees, then climbs steeply. This is the
    // muscle that carries the last third of the arc.
    curve: [2, 5, 9, 22, 55, 95],
    role: 'Nearly silent below 90°, then carries the last third of the arc',
  },
];

// Stated in the text, not plotted — kept out of the chart on purpose.
export const DESCRIBED_ONLY = [
  {
    label: 'Middle deltoid & supraspinatus',
    note: 'Both activate at the onset of elevation and peak near 90°, contributing '
        + 'roughly equal shares of the glenohumeral abduction torque, with a moment '
        + 'arm that stays near 25 mm through most of the arc.',
  },
  {
    label: 'Middle trapezius',
    note: 'Its line of force passes through the scapula\'s axis of rotation, so it '
        + 'adds almost no upward-rotation torque. It retracts, balancing the '
        + 'protraction pull of the serratus anterior.',
  },
];

const NORMATIVE_ELEVATION = 180;

// What the assessment can say about why an arc is short. Each carries the page
// it came from; none of them invent a number.
const IMPLICATIONS = [
  {
    id: 'serratus_suspect',
    applies: (reach, thoracicExt) => reach != null && reach <= 90
      && !(thoracicExt != null && thoracicExt < 20),
    title: 'Elevation stops at or below 90° with a mobile thorax',
    detail: 'Neumann reports that people with marked serratus anterior weakness cannot '
          + 'elevate the arm above 90°, and that this persists even with an intact '
          + 'trapezius and intact glenohumeral abductors. With the thoracic spine not '
          + 'implicated, scapular upward rotation is the thing to test — look for winging '
          + 'against resistance.',
    source: 'Neumann Ch. 5, serratus anterior paralysis',
  },
  {
    id: 'thoracic_cap',
    applies: (reach, thoracicExt) => reach != null && reach < NORMATIVE_ELEVATION
      && thoracicExt != null && thoracicExt < 20,
    title: 'The thorax is capping the arc',
    detail: 'The scapula rotates upward on the ribcage, so it cannot travel over a thorax '
          + 'that will not extend. With thoracic extension short of 20°, the last third of '
          + 'the arc — the part the lower trapezius carries — is the range being lost.',
    source: 'Neumann Ch. 9 Table 9-11 · Ch. 5 scapulothoracic upward rotation',
  },
  {
    id: 'late_arc_lost',
    applies: (reach) => reach != null && reach < 150 && reach > 90,
    title: 'The lower trapezius is barely being asked to work',
    detail: 'Lower trapezius EMG is under 25% of maximum below 120° and only climbs steeply '
          + 'after that. An arc that stops short of 150° never loads it, so strengthening it '
          + 'through the range the client already owns will not reach it.',
    source: 'Neumann Fig. 5-51',
  },
];

// Worst side, so the chart reports the shoulder that limits the client.
function _reach(assessment) {
  const a = assessment || {};
  const pick = (l, r) => {
    const nl = l == null || l === '' ? null : Number(l);
    const nr = r == null || r === '' ? null : Number(r);
    if (Number.isNaN(nl) && Number.isNaN(nr)) return null;
    if (nl == null || Number.isNaN(nl)) return Number.isNaN(nr) ? null : nr;
    if (nr == null || Number.isNaN(nr)) return nl;
    return Math.min(nl, nr);
  };
  // Abduction is what Fig. 5-51 measured. Flexion is the fallback, flagged so
  // the chart can say which one it is rather than quietly mixing them.
  const abduction = pick(a.sh_abd_l, a.sh_abd_r);
  if (abduction != null) return { degrees: abduction, motion: 'abduction' };
  const flexion = pick(a.sh_flex_l, a.sh_flex_r);
  if (flexion != null) return { degrees: flexion, motion: 'flexion' };
  return null;
}

function _num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * Returns the normative curves plus where this client's arc stops.
 * `null` reach means shoulder elevation was never measured — the caller should
 * say so rather than draw a chart with no client on it.
 */
export function computeShoulderActivation(assessment) {
  const reach = _reach(assessment);
  const thoracicExt = _num((assessment || {}).thor_ext);

  const implications = reach
    ? IMPLICATIONS.filter(i => i.applies(reach.degrees, thoracicExt))
        .map(({ id, title, detail, source }) => ({ id, title, detail, source }))
    : [];

  // The share of the arc the client actually owns, for the shaded cutoff.
  const reachedFraction = reach
    ? Math.max(0, Math.min(1, reach.degrees / NORMATIVE_ELEVATION))
    : null;

  return {
    angles: ELEVATION_ANGLES,
    muscles: SCAPULAR_MUSCLES,
    described: DESCRIBED_ONLY,
    reach,
    reachedFraction,
    thoracic_extension: thoracicExt,
    implications,
    normative_elevation: NORMATIVE_ELEVATION,
  };
}
