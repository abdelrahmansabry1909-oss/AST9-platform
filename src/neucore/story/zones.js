// src/neucore/story/zones.js
// E2 — anatomy-zone navigation config (ASSESSMENT_STORYTELLING_ARCHITECTURE.md §1).
// Navigation metadata ONLY: never a data schema, never written anywhere.
//
//  · order   = ground-up kinetic chain (load enters at the foot and propagates up;
//              the camera climbs the body, then pulls back for the whole picture)
//  · joints  = GLBSkeleton jointMeshes hotspot keys (the ObjectiveSync vocabulary).
//              Empty = camera-only zone: those fields have no 3D bindings today
//              and we do not invent fake ones.
//  · fields  = existing form input ids (ScoringEngine.readForm contract) — used
//              in E2 only to scroll the zone's card into view, in E3 for cards.
//  · cam     = { dist, phi, theta } spherical offset from the zone's look target
//              (phi = polar from +Y, theta = azimuth from +Z). 'anchor' overrides
//              how the look target is derived when joints alone can't express it.
export const ZONES = [
  {
    key: 'foundation', label: 'Feet & Ankles', ordinal: 1,
    story: 'Where load enters the body. Establish the base.',
    joints: ['LeftAnkle', 'RightAnkle'],
    cam: { dist: 1.6, phi: 1.30, theta: 0.35 },
    fields: ['ns-ankle-df-l', 'ns-ankle-df-r', 'ns-pronation-l', 'ns-pronation-r', 'ns-supination-l', 'ns-supination-r'],
  },
  {
    key: 'knees', label: 'Knees & Tibia', ordinal: 2,
    story: 'The transfer link — rotation control between foot and hip.',
    joints: ['LeftKnee', 'RightKnee'],
    cam: { dist: 1.5, phi: 1.40, theta: -0.30 },
    fields: ['ns-tib-ir-l', 'ns-tib-ir-r'],
  },
  {
    key: 'hips', label: 'Hips & Pelvis', ordinal: 3,
    story: 'The engine of movement. Range tells the story.',
    joints: ['LeftHip', 'RightHip'],
    cam: { dist: 1.5, phi: 1.45, theta: 0.45 },
    fields: ['ns-hip-ir-l', 'ns-hip-ir-r', 'ns-hip-er-l', 'ns-hip-er-r', 'ns-hip-flex-l', 'ns-hip-flex-r',
             'ns-hip-ext-l', 'ns-hip-ext-r', 'ns-hip-abd-l', 'ns-hip-abd-r', 'ns-si-pain'],
  },
  {
    key: 'spine', label: 'Spine', ordinal: 4,
    story: 'Segmental control under flexion, extension and rotation.',
    joints: ['LumbarSpine', 'ThoracicSpine'],
    cam: { dist: 1.7, phi: 1.35, theta: 2.40 },   // rear-quarter — the spine's reading angle
    fields: ['ns-toetouch-score', 'ns-lumb-flex', 'ns-lumb-ext', 'ns-sp-flex-pain', 'ns-sp-ext-pain',
             'ns-sp-lfl-pain', 'ns-sp-lfr-pain', 'ns-sp-rotl-pain', 'ns-sp-rotr-pain', 'ns-sp-notes'],
  },
  {
    key: 'shoulders', label: 'Shoulders', ordinal: 5,
    story: 'Reach and rotation — the upper chain in range.',
    joints: ['LeftShoulder', 'RightShoulder'],
    cam: { dist: 1.5, phi: 1.15, theta: -0.40 },
    fields: ['ns-sh-flex-l', 'ns-sh-flex-r', 'ns-sh-ext-l', 'ns-sh-ext-r',
             'ns-sh-ir-l', 'ns-sh-ir-r', 'ns-sh-er-l', 'ns-sh-er-r'],
  },
  {
    key: 'neck-arms', label: 'Neck & Arms', ordinal: 6,
    story: 'Cervical control and distal range.',
    joints: [],
    anchor: 'aboveShoulders',           // shoulders centroid + 0.18 up (no neck hotspot exists)
    cam: { dist: 1.8, phi: 1.25, theta: 0 },
    fields: ['ns-cerv-flex', 'ns-cerv-ext', 'ns-cerv-rot-l', 'ns-cerv-rot-r',
             'ns-elbow-flex-l', 'ns-elbow-flex-r', 'ns-elbow-ext-l', 'ns-elbow-ext-r',
             'ns-wrist-flex-l', 'ns-wrist-flex-r', 'ns-wrist-ext-l', 'ns-wrist-ext-r'],
  },
  {
    key: 'integration', label: 'Whole-Body', ordinal: 7,
    story: 'The whole body under load — function over parts.',
    joints: [],
    anchor: 'overview',                 // the captured default pose — the pull-back payoff
    cam: null,
    fields: ['ns-sl-squat-l', 'ns-sl-squat-r', 'ns-sl-squat-notes', 'ns-sl-rdl-l', 'ns-sl-rdl-r', 'ns-sl-rdl-notes',
             'ns-oh-squat', 'ns-oh-squat-notes', 'ns-bal-eo-l', 'ns-bal-eo-r', 'ns-bal-ec-l', 'ns-bal-ec-r',
             'ns-reach-l', 'ns-reach-r'],
  },
];
