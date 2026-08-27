// src/neucore/core/JointRegistry.js
// Normative data and bone name map for all interactive joints

export const JOINT_NORMATIVE = {
  LeftHip:      { flexion: 120, extension: 20, ir: 45, er: 45, abduction: 45 },
  RightHip:     { flexion: 120, extension: 20, ir: 45, er: 45, abduction: 45 },
  LeftKnee:     { flexion: 135, extension: 0 },
  RightKnee:    { flexion: 135, extension: 0 },
  LeftAnkle:    { dorsiflexion: 20, plantarflexion: 50 },
  RightAnkle:   { dorsiflexion: 20, plantarflexion: 50 },
  LeftShoulder: { flexion: 180, extension: 60, ir: 70, er: 90, abduction: 180 },
  RightShoulder:{ flexion: 180, extension: 60, ir: 70, er: 90, abduction: 180 },
  LeftElbow:    { flexion: 145, extension: 0 },
  RightElbow:   { flexion: 145, extension: 0 },
  LeftWrist:    { flexion: 80, extension: 70 },
  RightWrist:   { flexion: 80, extension: 70 },
  // Flexion/extension are Neumann's 50°/15° (owner ruling, 2026-08-26), which
  // js/integrationEngine.js already scores against. They previously read 60/25
  // here while the form hinted 40–60/20–35 — three disagreeing sources for one
  // number. See KNOWN_LIMITATIONS L22.
  LumbarSpine:  { flexion: 50, extension: 15, rotation: 30, latFlex: 25 },
  ThoracicSpine:{ rotation: 35, latFlex: 25 },
  CervicalSpine:{ flexion: 45, extension: 45, rotation: 60, latFlex: 45 },
  Pelvis:       { anteriorTilt: 10, posteriorTilt: 10 },
  Sacrum:       { nutation: 5 },
  LeftSI:       {},
  RightSI:      {},
  LeftMidfoot:  {},
  RightMidfoot: {},
  LeftBigToe:   { extension: 70 },
  RightBigToe:  { extension: 70 },
};

// Maps hotspot joint keys to bone mesh IDs for raycasting
export const JOINT_TO_BONE_MAP = {
  LeftShoulder:  'LeftHumerus',
  RightShoulder: 'RightHumerus',
  LeftElbow:     'LeftRadius',
  RightElbow:    'RightRadius',
  LeftWrist:     'LeftCarpals',
  RightWrist:    'RightCarpals',
  LeftHip:       'LeftFemur',
  RightHip:      'RightFemur',
  LeftKnee:      'LeftTibia',
  RightKnee:     'RightTibia',
  LeftAnkle:     'LeftTalus',
  RightAnkle:    'RightTalus',
};

export const JOINT_LABELS = {
  LeftShoulder:  'Left Shoulder',
  RightShoulder: 'Right Shoulder',
  LeftElbow:     'Left Elbow',
  RightElbow:    'Right Elbow',
  LeftWrist:     'Left Wrist',
  RightWrist:    'Right Wrist',
  LeftHip:       'Left Hip',
  RightHip:      'Right Hip',
  LeftKnee:      'Left Knee',
  RightKnee:     'Right Knee',
  LeftAnkle:     'Left Ankle',
  RightAnkle:    'Right Ankle',
  LumbarSpine:   'Lumbar Spine',
  ThoracicSpine: 'Thoracic Spine',
  CervicalSpine: 'Cervical Spine',
  Pelvis:        'Pelvis',
  Sacrum:        'Sacrum',
  Skull:         'Skull',
  C1_Atlas:      'C1 Atlas',
  C7:            'C7',
  T12:           'T12',
  L3:            'L3',
  L5:            'L5',
  LeftSI:        'Left SI Joint',
  RightSI:       'Right SI Joint',
  LeftMidfoot:   'Left Midfoot',
  RightMidfoot:  'Right Midfoot',
  LeftBigToe:    'Left Big Toe',
  RightBigToe:   'Right Big Toe',
};
