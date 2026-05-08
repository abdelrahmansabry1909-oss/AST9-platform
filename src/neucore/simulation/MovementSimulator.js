// src/neucore/simulation/MovementSimulator.js
// Proper gait simulation:
//  - Hierarchical FK leg rigs (hip → knee → ankle pivot groups)
//  - Root translates left-to-right like a real walk
//  - Vertical bounce + lateral sway
//  - Slow clinical gait cycle (2.0 s per full cycle)

import * as THREE from 'three';
import { bus } from '../core/JointBus.js';
import { GAIT_PHASES } from './MuscleActivationDB.js';

const D = Math.PI / 180;   // degrees → radians
const CYCLE_DUR  = 2.0;    // seconds per full gait cycle
const WALK_RANGE = 1.3;    // ±X meters the skeleton travels
const WALK_SPEED = WALK_RANGE * 2 / (CYCLE_DUR * 5); // crosses the range in ~5 cycles

// Normative kinematics (degrees) — Neumann Ch.15
const NORMATIVE_KINEMATICS = {
  hip_flexion:  { loading_response:25, mid_stance:5,  terminal_stance:-10, pre_swing:-5,  initial_swing:15,  mid_swing:25,  terminal_swing:20  },
  hip_abduction:{ loading_response:-5, mid_stance:3,  terminal_stance:2,   pre_swing:-2,  initial_swing:0,   mid_swing:0,   terminal_swing:0   },
  knee_flexion: { loading_response:20, mid_stance:5,  terminal_stance:0,   pre_swing:35,  initial_swing:60,  mid_swing:65,  terminal_swing:30  },
  ankle_df:     { loading_response:-5, mid_stance:5,  terminal_stance:15,  pre_swing:-10, initial_swing:5,   mid_swing:5,   terminal_swing:5   },
  trunk_lean:   { loading_response:5,  mid_stance:3,  terminal_stance:2,   pre_swing:4,   initial_swing:5,   mid_swing:3,   terminal_swing:4   },
};

export class MovementSimulator {
  constructor(skeletonBuilder, deficits) {
    this.skeleton  = skeletonBuilder;
    this.deficits  = deficits ?? [];
    this.isPlaying = false;
    this._clock    = new THREE.Clock();
    this._phase    = 0;
    this._speed    = 1.0;
    this._lastPhaseIdx = -1;
    this._walkX    = -WALK_RANGE;
    this._rigged   = false;

    this._clientKinematics = this._computeClientKinematics();
  }

  // ── Public API ───────────────────────────────────────────────
  start(speed = 1.0) {
    if (!this._rigged) {
      this._setupLegRigs();
      this._rigged = true;
    }
    this.isPlaying = true;
    this._speed    = speed;
    this._clock.start();
    this._animate();
  }

  stop() {
    this.isPlaying = false;
    this._resetPose();
  }

  setSpeed(speed) { this._speed = speed; }

  // ── Deficit-modified kinematics ───────────────────────────────
  _computeClientKinematics() {
    const k = JSON.parse(JSON.stringify(NORMATIVE_KINEMATICS));

    this.deficits.forEach(deficit => {
      switch (deficit.id) {
        case 'limited_df': {
          const scale = Math.min((parseFloat(deficit.assessment?.ankle_dorsiflexion_left_cm) || 8) / 10, 1);
          Object.keys(k.ankle_df).forEach(p => { if (k.ankle_df[p] > 0) k.ankle_df[p] *= scale; });
          k.knee_flexion.mid_stance = Math.max(-5, k.knee_flexion.mid_stance - 8);
          k.trunk_lean.loading_response += 4;
          k.trunk_lean.mid_stance += 5;
          break;
        }
        case 'over_pronation':
          k.hip_abduction.loading_response -= 4;
          k.hip_abduction.mid_stance -= 3;
          break;
        case 'limited_hip_ir':
          k.hip_abduction.loading_response -= 3;
          k.hip_abduction.mid_stance -= 2;
          break;
        case 'limited_hip_extension': {
          const scale = (parseFloat(deficit.assessment?.hip_extension_left) || 8) / 10;
          k.hip_flexion.terminal_stance = Math.max(-5, k.hip_flexion.terminal_stance * scale);
          k.trunk_lean.terminal_stance += 5;
          break;
        }
        case 'trendelenburg':
          k.trunk_lean.mid_stance    += 8;
          k.trunk_lean.terminal_stance += 6;
          k.hip_abduction.mid_stance -= 5;
          break;
        case 'oh_squat_forward_lean':
          Object.keys(k.trunk_lean).forEach(p => { k.trunk_lean[p] += 6; });
          break;
        case 'poor_balance_eo':
          k.hip_abduction.mid_stance       += 4;
          k.hip_abduction.loading_response += 3;
          break;
      }
    });

    return k;
  }

  // ── Build FK leg rig (hip → knee → ankle pivot groups) ───────
  _setupLegRigs() {
    const sk   = this.skeleton;
    const root = sk._root;

    // ── Pivot factories ────────────────────────────────────────
    const pivot = (x, y, z) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      return o;
    };

    const reparent = (parentObj, boneIds, parentWorldX, parentWorldY) => {
      boneIds.forEach(id => {
        const m = sk.boneMeshes.get(id) ?? sk.jointMeshes.get(id);
        if (!m) return;
        root.remove(m);
        m.position.x -= parentWorldX;
        m.position.y -= parentWorldY;
        parentObj.add(m);
      });
    };

    const reparentHotspot = (parentObj, jointKey, offsetX = 0, offsetY = 0) => {
      const m = sk.jointMeshes.get(jointKey);
      if (!m) return;
      root.remove(m);
      m.position.set(offsetX, offsetY, 0);
      parentObj.add(m);
    };

    // ── LEFT LEG ──────────────────────────────────────────────
    this._lHip = pivot(-0.09, 0.990, 0);
    root.add(this._lHip);

    this._lKnee = pivot(0, -0.330, 0);   // knee is 0.330 below hip
    this._lHip.add(this._lKnee);

    this._lAnkle = pivot(0, -0.540, 0);  // ankle is 0.540 below knee
    this._lKnee.add(this._lAnkle);

    reparent(this._lHip,   ['LeftFemur', 'LeftPatella'],                      -0.09, 0.990);
    reparent(this._lKnee,  ['LeftTibia', 'LeftFibula'],                       -0.09, 0.660);
    reparent(this._lAnkle, ['LeftCalcaneus','LeftTalus','LeftNavicular',
                            'LeftCuboid','LeftMTP1','LeftMTP2',
                            'LeftMTP3','LeftMTP4','LeftMTP5'],                 -0.09, 0.120);

    reparentHotspot(this._lHip,   'LeftHip');
    reparentHotspot(this._lKnee,  'LeftKnee');
    reparentHotspot(this._lAnkle, 'LeftAnkle');
    reparentHotspot(this._lAnkle, 'LeftMidfoot', 0, -0.045);
    reparentHotspot(this._lAnkle, 'LeftBigToe',  0, -0.07);

    // ── RIGHT LEG ─────────────────────────────────────────────
    this._rHip = pivot(0.09, 0.990, 0);
    root.add(this._rHip);

    this._rKnee = pivot(0, -0.330, 0);
    this._rHip.add(this._rKnee);

    this._rAnkle = pivot(0, -0.540, 0);
    this._rKnee.add(this._rAnkle);

    reparent(this._rHip,   ['RightFemur', 'RightPatella'],                     0.09, 0.990);
    reparent(this._rKnee,  ['RightTibia', 'RightFibula'],                      0.09, 0.660);
    reparent(this._rAnkle, ['RightCalcaneus','RightTalus','RightNavicular',
                            'RightCuboid','RightMTP1','RightMTP2',
                            'RightMTP3','RightMTP4','RightMTP5'],               0.09, 0.120);

    reparentHotspot(this._rHip,   'RightHip');
    reparentHotspot(this._rKnee,  'RightKnee');
    reparentHotspot(this._rAnkle, 'RightAnkle');
    reparentHotspot(this._rAnkle, 'RightMidfoot', 0, -0.045);
    reparentHotspot(this._rAnkle, 'RightBigToe',  0, -0.07);

    // ── LEFT ARM ──────────────────────────────────────────────
    this._lShoulder = pivot(-0.18, 1.415, 0);
    root.add(this._lShoulder);
    reparent(this._lShoulder,
      ['LeftHumerus','LeftRadius','LeftUlna','LeftCarpals',
       'LeftMeta1','LeftMeta2','LeftMeta3','LeftMeta4','LeftMeta5'],            -0.18, 1.415);
    reparentHotspot(this._lShoulder, 'LeftShoulder');
    reparentHotspot(this._lShoulder, 'LeftElbow', 0, -0.345);
    reparentHotspot(this._lShoulder, 'LeftWrist', 0, -0.545);

    // ── RIGHT ARM ─────────────────────────────────────────────
    this._rShoulder = pivot(0.18, 1.415, 0);
    root.add(this._rShoulder);
    reparent(this._rShoulder,
      ['RightHumerus','RightRadius','RightUlna','RightCarpals',
       'RightMeta1','RightMeta2','RightMeta3','RightMeta4','RightMeta5'],       0.18, 1.415);
    reparentHotspot(this._rShoulder, 'RightShoulder');
    reparentHotspot(this._rShoulder, 'RightElbow', 0, -0.345);
    reparentHotspot(this._rShoulder, 'RightWrist', 0, -0.545);
  }

  // ── Animation loop ────────────────────────────────────────────
  _animate() {
    if (!this.isPlaying) return;

    const elapsed = this._clock.getElapsedTime() * this._speed;
    this._phase   = (elapsed % CYCLE_DUR) / CYCLE_DUR;   // 0–1 per cycle

    this._applyKinematics(this._phase, elapsed);
    this._applyRootMotion(this._phase, elapsed);

    // Only emit phase-change event when the phase INDEX actually changes
    const phaseIdx = Math.min(Math.floor(this._phase * 7), 6);
    if (phaseIdx !== this._lastPhaseIdx) {
      this._lastPhaseIdx = phaseIdx;
      bus.emit('gait:phaseChange', { phase: GAIT_PHASES[phaseIdx] });
    }
    bus.emit('sim:phaseUpdate', { phase: this._phase, phaseName: GAIT_PHASES[phaseIdx] });

    requestAnimationFrame(() => this._animate());
  }

  // ── Root motion: translation + bounce + sway ─────────────────
  _applyRootMotion(phase, elapsed) {
    const root = this.skeleton._root;

    // Horizontal walk: continuous shuttle -WALK_RANGE → +WALK_RANGE → repeat
    const totalDist = WALK_RANGE * 2;
    const walkProgress = (elapsed * WALK_SPEED) % (totalDist * 2);
    const rootX = walkProgress < totalDist
      ? -WALK_RANGE + walkProgress
      :  WALK_RANGE - (walkProgress - totalDist);
    root.position.x = rootX;

    // Vertical bounce: 2 bounces per gait cycle (one per step)
    root.position.y = Math.sin(phase * Math.PI * 4) * 0.018;

    // Face direction of travel
    root.rotation.y = walkProgress < totalDist ? -0.08 : 0.08;
  }

  // ── FK kinematics ─────────────────────────────────────────────
  _applyKinematics(phase, elapsed) {
    const k = this._clientKinematics;

    // Phase index + fractional interpolation between phases
    const phaseIdx  = Math.min(Math.floor(phase * 7), 6);
    const phaseFrac = (phase * 7) - phaseIdx;
    const cur       = GAIT_PHASES[phaseIdx];
    const next      = GAIT_PHASES[Math.min(phaseIdx + 1, 6)];

    // Contralateral phase (right leg 50% offset)
    const rPhase    = (phase + 0.5) % 1.0;
    const rIdx      = Math.min(Math.floor(rPhase * 7), 6);
    const rFrac     = (rPhase * 7) - rIdx;
    const rCur      = GAIT_PHASES[rIdx];
    const rNext     = GAIT_PHASES[Math.min(rIdx + 1, 6)];

    // Smooth linear interpolation between phases
    const lerp = (key, c, n, t) => {
      const a = (k[key]?.[c] ?? 0) * D;
      const b = (k[key]?.[n] ?? 0) * D;
      return a + (b - a) * t;
    };

    // ── Left leg ──────────────────────────────────────────────
    if (this._lHip) {
      this._lHip.rotation.x = lerp('hip_flexion',   cur, next, phaseFrac);
      this._lHip.rotation.z = lerp('hip_abduction', cur, next, phaseFrac);
    }
    if (this._lKnee) {
      // Knee flexion is a BACKWARD fold relative to the thigh pivot → negative
      this._lKnee.rotation.x = -lerp('knee_flexion', cur, next, phaseFrac);
    }
    if (this._lAnkle) {
      // Positive ankle_df = dorsiflexion = toes rise → negative X in our coordinate
      this._lAnkle.rotation.x = -lerp('ankle_df', cur, next, phaseFrac);
    }

    // ── Right leg (contralateral) ──────────────────────────────
    if (this._rHip) {
      this._rHip.rotation.x =  lerp('hip_flexion',   rCur, rNext, rFrac);
      this._rHip.rotation.z = -lerp('hip_abduction', rCur, rNext, rFrac); // mirror
    }
    if (this._rKnee) {
      this._rKnee.rotation.x = -lerp('knee_flexion', rCur, rNext, rFrac);
    }
    if (this._rAnkle) {
      this._rAnkle.rotation.x = -lerp('ankle_df', rCur, rNext, rFrac);
    }

    // ── Trunk / pelvis ────────────────────────────────────────
    const pelvis = this.skeleton.boneMeshes.get('Pelvis');
    if (pelvis) {
      pelvis.rotation.x = lerp('trunk_lean', cur, next, phaseFrac) * 0.5;
      // Lateral pelvic sway: shifts toward stance leg each step
      pelvis.rotation.z = Math.sin(phase * Math.PI * 2) * 0.06;
      const hasTrend = this.deficits.some(d => d.id === 'trendelenburg');
      if (hasTrend && (cur === 'mid_stance' || cur === 'terminal_stance')) {
        pelvis.rotation.z += Math.sin(phase * Math.PI * 2) * 0.08;
      }
    }

    // ── Arms: counter-swing to contralateral leg ──────────────
    // Left arm swings with right leg phase (counter-rotation)
    if (this._lShoulder) {
      this._lShoulder.rotation.x = lerp('hip_flexion', rCur, rNext, rFrac) * 0.28;
    }
    if (this._rShoulder) {
      this._rShoulder.rotation.x = lerp('hip_flexion', cur, next, phaseFrac) * 0.28;
    }
  }

  // ── Reset to T-pose ────────────────────────────────────────────
  _resetPose() {
    const root = this.skeleton._root;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);

    [this._lHip, this._lKnee, this._lAnkle,
     this._rHip, this._rKnee, this._rAnkle,
     this._lShoulder, this._rShoulder].forEach(obj => {
      if (obj) obj.rotation.set(0, 0, 0);
    });

    const pelvis = this.skeleton.boneMeshes.get('Pelvis');
    if (pelvis) pelvis.rotation.set(0, 0, 0);
  }
}
