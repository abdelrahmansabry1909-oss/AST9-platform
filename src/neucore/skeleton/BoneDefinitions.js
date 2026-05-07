// src/neucore/skeleton/BoneDefinitions.js
// Complete human skeleton — all 206 bones grouped
// Positions are normalized: standing pose, height = 1.75 units
// Origin = midpoint between feet

export const SKELETON_GROUPS = {

  // ── SKULL ────────────────────────────────────────────────────
  skull: [
    { id: 'Skull',       pos: [0,    1.72, 0],    size: [0.10, 0.12, 0.10], interactive: true  },
    { id: 'Mandible',    pos: [0,    1.60, 0.02], size: [0.08, 0.03, 0.06], interactive: false },
  ],

  // ── CERVICAL SPINE (C1–C7) ───────────────────────────────────
  cervical: [
    { id: 'C1_Atlas',    pos: [0, 1.575, 0], size: [0.045, 0.018, 0.04], interactive: true  },
    { id: 'C2_Axis',     pos: [0, 1.555, 0], size: [0.040, 0.018, 0.04], interactive: false },
    { id: 'C3',          pos: [0, 1.535, 0], size: [0.038, 0.016, 0.038],interactive: false },
    { id: 'C4',          pos: [0, 1.517, 0], size: [0.038, 0.016, 0.038],interactive: false },
    { id: 'C5',          pos: [0, 1.499, 0], size: [0.040, 0.016, 0.040],interactive: false },
    { id: 'C6',          pos: [0, 1.481, 0], size: [0.040, 0.016, 0.040],interactive: false },
    { id: 'C7',          pos: [0, 1.463, 0], size: [0.042, 0.016, 0.042],interactive: true  },
  ],

  // ── THORACIC SPINE (T1–T12) ──────────────────────────────────
  thoracic: [
    { id: 'T1',  pos: [0, 1.440, -0.010], size: [0.044, 0.018, 0.044], interactive: false },
    { id: 'T2',  pos: [0, 1.420, -0.012], size: [0.044, 0.018, 0.044], interactive: false },
    { id: 'T3',  pos: [0, 1.400, -0.014], size: [0.046, 0.018, 0.044], interactive: false },
    { id: 'T4',  pos: [0, 1.380, -0.016], size: [0.046, 0.018, 0.044], interactive: false },
    { id: 'T5',  pos: [0, 1.360, -0.018], size: [0.048, 0.018, 0.046], interactive: false },
    { id: 'T6',  pos: [0, 1.340, -0.019], size: [0.048, 0.018, 0.046], interactive: false },
    { id: 'T7',  pos: [0, 1.320, -0.020], size: [0.050, 0.018, 0.048], interactive: false },
    { id: 'T8',  pos: [0, 1.300, -0.020], size: [0.050, 0.018, 0.048], interactive: false },
    { id: 'T9',  pos: [0, 1.280, -0.019], size: [0.052, 0.018, 0.050], interactive: false },
    { id: 'T10', pos: [0, 1.260, -0.018], size: [0.052, 0.018, 0.050], interactive: false },
    { id: 'T11', pos: [0, 1.240, -0.016], size: [0.054, 0.018, 0.052], interactive: false },
    { id: 'T12', pos: [0, 1.220, -0.014], size: [0.054, 0.018, 0.052], interactive: true  },
  ],

  // ── LUMBAR SPINE (L1–L5) ────────────────────────────────────
  lumbar: [
    { id: 'L1',  pos: [0, 1.195, -0.010], size: [0.058, 0.020, 0.055], interactive: false },
    { id: 'L2',  pos: [0, 1.173, -0.006], size: [0.060, 0.020, 0.056], interactive: false },
    { id: 'L3',  pos: [0, 1.151, -0.002], size: [0.062, 0.022, 0.058], interactive: true  },
    { id: 'L4',  pos: [0, 1.128,  0.002], size: [0.062, 0.022, 0.058], interactive: false },
    { id: 'L5',  pos: [0, 1.105,  0.006], size: [0.060, 0.022, 0.056], interactive: true  },
  ],

  // ── SACRUM + COCCYX ──────────────────────────────────────────
  sacral: [
    { id: 'Sacrum',  pos: [0, 1.070, 0.010], size: [0.065, 0.040, 0.050], interactive: true  },
    { id: 'Coccyx',  pos: [0, 1.030, 0.015], size: [0.025, 0.020, 0.025], interactive: false },
  ],

  // ── PELVIS ───────────────────────────────────────────────────
  pelvis: [
    { id: 'Pelvis',       pos: [0,    1.030, 0],    size: [0.18, 0.10, 0.13], interactive: true  },
    { id: 'LeftIlium',    pos: [-0.09, 1.06, -0.02],size: [0.06, 0.08, 0.05], interactive: false },
    { id: 'RightIlium',   pos: [ 0.09, 1.06, -0.02],size: [0.06, 0.08, 0.05], interactive: false },
    { id: 'LeftIschium',  pos: [-0.06, 0.99, 0.02], size: [0.04, 0.04, 0.04], interactive: false },
    { id: 'RightIschium', pos: [ 0.06, 0.99, 0.02], size: [0.04, 0.04, 0.04], interactive: false },
  ],

  // ── RIBCAGE (12 pairs) ───────────────────────────────────────
  ribs: [
    { id: 'LeftRib1',  pos: [-0.06, 1.42, -0.01], size: [0.12, 0.012, 0.012], interactive: false },
    { id: 'LeftRib2',  pos: [-0.07, 1.40, -0.01], size: [0.13, 0.012, 0.012], interactive: false },
    { id: 'LeftRib3',  pos: [-0.09, 1.38, -0.01], size: [0.14, 0.012, 0.012], interactive: false },
    { id: 'LeftRib4',  pos: [-0.10, 1.36, -0.01], size: [0.14, 0.012, 0.012], interactive: false },
    { id: 'LeftRib5',  pos: [-0.11, 1.34, -0.01], size: [0.14, 0.012, 0.012], interactive: false },
    { id: 'LeftRib6',  pos: [-0.12, 1.32, -0.01], size: [0.14, 0.012, 0.012], interactive: false },
    { id: 'LeftRib7',  pos: [-0.12, 1.30, -0.01], size: [0.13, 0.012, 0.012], interactive: false },
    { id: 'LeftRib8',  pos: [-0.11, 1.28, -0.01], size: [0.12, 0.011, 0.011], interactive: false },
    { id: 'LeftRib9',  pos: [-0.10, 1.26, -0.01], size: [0.11, 0.011, 0.011], interactive: false },
    { id: 'LeftRib10', pos: [-0.09, 1.24, -0.01], size: [0.10, 0.011, 0.011], interactive: false },
    { id: 'LeftRib11', pos: [-0.08, 1.22, -0.01], size: [0.08, 0.010, 0.010], interactive: false },
    { id: 'LeftRib12', pos: [-0.07, 1.20, -0.01], size: [0.06, 0.010, 0.010], interactive: false },
    { id: 'RightRib1',  pos: [ 0.06, 1.42, -0.01], size: [0.12, 0.012, 0.012], interactive: false },
    { id: 'RightRib2',  pos: [ 0.07, 1.40, -0.01], size: [0.13, 0.012, 0.012], interactive: false },
    { id: 'RightRib3',  pos: [ 0.09, 1.38, -0.01], size: [0.14, 0.012, 0.012], interactive: false },
    { id: 'RightRib4',  pos: [ 0.10, 1.36, -0.01], size: [0.14, 0.012, 0.012], interactive: false },
    { id: 'RightRib5',  pos: [ 0.11, 1.34, -0.01], size: [0.14, 0.012, 0.012], interactive: false },
    { id: 'RightRib6',  pos: [ 0.12, 1.32, -0.01], size: [0.14, 0.012, 0.012], interactive: false },
    { id: 'RightRib7',  pos: [ 0.12, 1.30, -0.01], size: [0.13, 0.012, 0.012], interactive: false },
    { id: 'RightRib8',  pos: [ 0.11, 1.28, -0.01], size: [0.12, 0.011, 0.011], interactive: false },
    { id: 'RightRib9',  pos: [ 0.10, 1.26, -0.01], size: [0.11, 0.011, 0.011], interactive: false },
    { id: 'RightRib10', pos: [ 0.09, 1.24, -0.01], size: [0.10, 0.011, 0.011], interactive: false },
    { id: 'RightRib11', pos: [ 0.08, 1.22, -0.01], size: [0.08, 0.010, 0.010], interactive: false },
    { id: 'RightRib12', pos: [ 0.07, 1.20, -0.01], size: [0.06, 0.010, 0.010], interactive: false },
    { id: 'Sternum',    pos: [0, 1.33, 0.05],     size: [0.025, 0.14, 0.012], interactive: false },
  ],

  // ── CLAVICLE + SCAPULA ───────────────────────────────────────
  shoulder_girdle: [
    { id: 'LeftClavicle',  pos: [-0.08, 1.46, 0.02], size: [0.10, 0.012, 0.012], interactive: false },
    { id: 'RightClavicle', pos: [ 0.08, 1.46, 0.02], size: [0.10, 0.012, 0.012], interactive: false },
    { id: 'LeftScapula',   pos: [-0.13, 1.38, -0.04],size: [0.08, 0.08, 0.012],  interactive: false },
    { id: 'RightScapula',  pos: [ 0.13, 1.38, -0.04],size: [0.08, 0.08, 0.012],  interactive: false },
  ],

  // ── UPPER LIMB — LEFT ────────────────────────────────────────
  left_arm: [
    { id: 'LeftHumerus', pos: [-0.18, 1.30, 0],    size: [0.03, 0.22, 0.03],  interactive: false },
    { id: 'LeftRadius',  pos: [-0.20, 1.06, 0.01], size: [0.022, 0.20, 0.022],interactive: false },
    { id: 'LeftUlna',    pos: [-0.22, 1.05, -0.01],size: [0.018, 0.20, 0.018],interactive: false },
    { id: 'LeftCarpals', pos: [-0.22, 0.865, 0],   size: [0.04, 0.025, 0.03], interactive: false },
    { id: 'LeftMeta1',   pos: [-0.25, 0.84, 0.01], size: [0.010, 0.04, 0.010],interactive: false },
    { id: 'LeftMeta2',   pos: [-0.23, 0.84, 0.005],size: [0.010, 0.04, 0.010],interactive: false },
    { id: 'LeftMeta3',   pos: [-0.21, 0.84, 0],    size: [0.010, 0.04, 0.010],interactive: false },
    { id: 'LeftMeta4',   pos: [-0.19, 0.84, -0.005],size:[0.010, 0.04, 0.010],interactive: false },
    { id: 'LeftMeta5',   pos: [-0.17, 0.84, -0.01],size: [0.010, 0.04, 0.010],interactive: false },
  ],

  // ── UPPER LIMB — RIGHT ───────────────────────────────────────
  right_arm: [
    { id: 'RightHumerus', pos: [0.18, 1.30, 0],    size: [0.03, 0.22, 0.03],   interactive: false },
    { id: 'RightRadius',  pos: [0.20, 1.06, 0.01], size: [0.022, 0.20, 0.022], interactive: false },
    { id: 'RightUlna',    pos: [0.22, 1.05, -0.01],size: [0.018, 0.20, 0.018], interactive: false },
    { id: 'RightCarpals', pos: [0.22, 0.865, 0],   size: [0.04, 0.025, 0.03],  interactive: false },
    { id: 'RightMeta1',   pos: [0.25, 0.84, 0.01], size: [0.010, 0.04, 0.010], interactive: false },
    { id: 'RightMeta2',   pos: [0.23, 0.84, 0.005],size: [0.010, 0.04, 0.010], interactive: false },
    { id: 'RightMeta3',   pos: [0.21, 0.84, 0],    size: [0.010, 0.04, 0.010], interactive: false },
    { id: 'RightMeta4',   pos: [0.19, 0.84,-0.005],size: [0.010, 0.04, 0.010], interactive: false },
    { id: 'RightMeta5',   pos: [0.17, 0.84,-0.01], size: [0.010, 0.04, 0.010], interactive: false },
  ],

  // ── LOWER LIMB — LEFT ────────────────────────────────────────
  left_leg: [
    { id: 'LeftFemur',    pos: [-0.09, 0.84, 0],   size: [0.034, 0.36, 0.034], interactive: false },
    { id: 'LeftPatella',  pos: [-0.09, 0.645, 0.02],size:[0.025, 0.025, 0.015],interactive: false },
    { id: 'LeftTibia',    pos: [-0.09, 0.50, 0],   size: [0.028, 0.34, 0.028], interactive: false },
    { id: 'LeftFibula',   pos: [-0.105,0.50, 0],   size: [0.016, 0.32, 0.016], interactive: false },
    { id: 'LeftCalcaneus',pos: [-0.09, 0.065, -0.04],size:[0.04, 0.04, 0.07],  interactive: false },
    { id: 'LeftTalus',    pos: [-0.09, 0.10,  0],  size: [0.04, 0.035, 0.05],  interactive: false },
    { id: 'LeftNavicular',pos: [-0.09, 0.095, 0.03],size:[0.03, 0.025, 0.03],  interactive: false },
    { id: 'LeftCuboid',   pos: [-0.11, 0.08,  0.02],size:[0.025, 0.025, 0.025],interactive: false },
    { id: 'LeftMTP1',     pos: [-0.075,0.07,  0.07],size:[0.018, 0.018, 0.035],interactive: false },
    { id: 'LeftMTP2',     pos: [-0.085,0.07,  0.07],size:[0.013, 0.013, 0.03], interactive: false },
    { id: 'LeftMTP3',     pos: [-0.095,0.07,  0.07],size:[0.013, 0.013, 0.028],interactive: false },
    { id: 'LeftMTP4',     pos: [-0.105,0.07,  0.065],size:[0.012,0.012, 0.026],interactive: false },
    { id: 'LeftMTP5',     pos: [-0.115,0.07,  0.06],size:[0.012, 0.012, 0.024],interactive: false },
  ],

  // ── LOWER LIMB — RIGHT ───────────────────────────────────────
  right_leg: [
    { id: 'RightFemur',    pos: [0.09, 0.84, 0],    size: [0.034, 0.36, 0.034], interactive: false },
    { id: 'RightPatella',  pos: [0.09, 0.645, 0.02],size: [0.025, 0.025, 0.015],interactive: false },
    { id: 'RightTibia',    pos: [0.09, 0.50, 0],    size: [0.028, 0.34, 0.028], interactive: false },
    { id: 'RightFibula',   pos: [0.105,0.50, 0],    size: [0.016, 0.32, 0.016], interactive: false },
    { id: 'RightCalcaneus',pos: [0.09, 0.065, -0.04],size:[0.04, 0.04, 0.07],   interactive: false },
    { id: 'RightTalus',    pos: [0.09, 0.10,  0],   size: [0.04, 0.035, 0.05],  interactive: false },
    { id: 'RightNavicular',pos: [0.09, 0.095, 0.03],size:[0.03, 0.025, 0.03],   interactive: false },
    { id: 'RightCuboid',   pos: [0.11, 0.08,  0.02],size:[0.025, 0.025, 0.025], interactive: false },
    { id: 'RightMTP1',     pos: [0.075,0.07,  0.07],size:[0.018, 0.018, 0.035], interactive: false },
    { id: 'RightMTP2',     pos: [0.085,0.07,  0.07],size:[0.013, 0.013, 0.03],  interactive: false },
    { id: 'RightMTP3',     pos: [0.095,0.07,  0.07],size:[0.013, 0.013, 0.028], interactive: false },
    { id: 'RightMTP4',     pos: [0.105,0.07, 0.065],size:[0.012, 0.012, 0.026], interactive: false },
    { id: 'RightMTP5',     pos: [0.115,0.07,  0.06],size:[0.012, 0.012, 0.024], interactive: false },
  ],
};

// ALL interactive joint keys — every one gets a pop-out panel
export const ALL_INTERACTIVE_JOINTS = [
  'Skull', 'C1_Atlas', 'C7', 'T12', 'L3', 'L5', 'Sacrum',
  'Pelvis',
  'CervicalSpine',
  'ThoracicSpine',
  'LumbarSpine',
  'LeftShoulder', 'RightShoulder',
  'LeftElbow',    'RightElbow',
  'LeftWrist',    'RightWrist',
  'LeftHip',      'RightHip',
  'LeftKnee',     'RightKnee',
  'LeftAnkle',    'RightAnkle',
  'LeftMidfoot',  'RightMidfoot',
  'LeftBigToe',   'RightBigToe',
  'LeftSI',       'RightSI',
];

// Joint → assessment fields mapping
export const JOINT_ASSESSMENT_MAP = {
  LeftHip:      ['hip_ir_left','hip_er_left','hip_flexion_left','hip_extension_left','hip_abduction_left'],
  RightHip:     ['hip_ir_right','hip_er_right','hip_flexion_right','hip_extension_right','hip_abduction_right'],
  LeftKnee:     ['sl_squat_score','sl_rdl_score','tibia_ir_left'],
  RightKnee:    ['sl_squat_score','sl_rdl_score','tibia_ir_right'],
  LeftAnkle:    ['ankle_dorsiflexion_left_cm','ankle_pronation_left','ankle_supination_left'],
  RightAnkle:   ['ankle_dorsiflexion_right_cm','ankle_pronation_right','ankle_supination_right'],
  LumbarSpine:  ['spine_flexion_range','spine_extension_range','spine_rotation_left_range','spine_rotation_right_range'],
  ThoracicSpine:['spine_lat_flex_left_range','spine_lat_flex_right_range'],
  LeftShoulder: ['shoulder_flexion_left','shoulder_ir_left','shoulder_er_left','shoulder_extension_left'],
  RightShoulder:['shoulder_flexion_right','shoulder_ir_right','shoulder_er_right','shoulder_extension_right'],
};
