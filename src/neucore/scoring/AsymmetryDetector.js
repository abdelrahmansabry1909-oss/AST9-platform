// src/neucore/scoring/AsymmetryDetector.js
export class AsymmetryDetector {
  constructor(assessment) {
    this.a = assessment ?? {};
  }

  detect() {
    const flags = [];
    const PAIRS = [
      ['hip_ir_left',       'hip_ir_right',       'Hip IR',       15],
      ['hip_er_left',       'hip_er_right',       'Hip ER',       15],
      ['hip_flexion_left',  'hip_flexion_right',  'Hip Flexion',  20],
      ['hip_extension_left','hip_extension_right','Hip Extension', 10],
      ['ankle_dorsiflexion_left_cm','ankle_dorsiflexion_right_cm','Ankle DF', 3],
      ['shoulder_flexion_left','shoulder_flexion_right','Shoulder Flex', 20],
    ];

    PAIRS.forEach(([leftKey, rightKey, label, threshold]) => {
      const l = parseFloat(this.a[leftKey]);
      const r = parseFloat(this.a[rightKey]);
      if (isNaN(l) || isNaN(r)) return;
      const diff = Math.abs(l - r);
      if (diff >= threshold) {
        flags.push({
          label,
          left: l,
          right: r,
          diff,
          side: l < r ? 'left' : 'right',
          severity: diff >= threshold * 2 ? 'severe' : 'moderate',
        });
      }
    });

    return flags;
  }

  penalty() {
    const flags = this.detect();
    return flags.reduce((acc, f) => acc + (f.severity === 'severe' ? 10 : 5), 0);
  }
}
