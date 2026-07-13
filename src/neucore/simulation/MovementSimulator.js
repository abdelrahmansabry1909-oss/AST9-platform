// src/neucore/simulation/MovementSimulator.js
// Gait simulation driven directly on the real GLB skeleton's bone tree.
//
// The anatomical skeleton (GLBSkeleton) is itself an FK hierarchy:
//   hip → femur → tibula → talus → foot,  and  ... → humerus
// and every bone's local origin sits at its proximal joint. So a gait pose is
// just a set of relative rotations layered on top of each bone's bind pose.
//
//  - Per-bone FK: hip / knee / ankle / shoulder rotations through the cycle
//  - Root translates left-to-right like a real walk
//  - Vertical bounce + trunk lean + pelvic sway
//  - Slow clinical gait cycle (2.0 s per full cycle)

import * as THREE from 'three';
import { bus } from '../core/JointBus.js';
import { GAIT_PHASES } from './MuscleActivationDB.js';
import {
  createPeriodicGaitCurve,
  getGaitPhaseSample,
  getPhasePosePosition,
  normalizeCyclePhase,
  samplePeriodicGaitCurve,
} from './GaitTiming.js';

const D = Math.PI / 180;   // degrees → radians
const CYCLE_DUR  = 2.0;    // seconds per full gait cycle

// Rotation-sign map — flexion axes on the GLB bone tree (limbs run down −Y).
const SIGN = {
  hipFlex: -1,   // femur  about local X — +deg flexion swings the thigh forward
  hipAbd:   1,   // femur  about local Z
  knee:     1,   // tibula about local X — +deg knee flexion folds the shank back
  ankle:   -1,   // talus  about local X — +deg dorsiflexion lifts the toes
  arm:     -1,   // humerus about local X — counter-swing
  trunk:    1,   // ripcage about local X — +deg forward lean
};

// Normative kinematics (degrees) — Neumann Ch.15
export const NORMATIVE_KINEMATICS = {
  hip_flexion:  { loading_response:25, mid_stance:5,  terminal_stance:-10, pre_swing:-5,  initial_swing:15,  mid_swing:25,  terminal_swing:20  },
  hip_abduction:{ loading_response:-5, mid_stance:3,  terminal_stance:2,   pre_swing:-2,  initial_swing:0,   mid_swing:0,   terminal_swing:0   },
  knee_flexion: { loading_response:20, mid_stance:5,  terminal_stance:0,   pre_swing:35,  initial_swing:60,  mid_swing:65,  terminal_swing:30  },
  ankle_df:     { loading_response:-5, mid_stance:5,  terminal_stance:15,  pre_swing:-10, initial_swing:5,   mid_swing:5,   terminal_swing:5   },
  trunk_lean:   { loading_response:5,  mid_stance:3,  terminal_stance:2,   pre_swing:4,   initial_swing:5,   mid_swing:3,   terminal_swing:4   },
};

export function getRootTrajectory(phase) {
  const p = normalizeCyclePhase(phase);
  return {
    // In-place clinical locomotion: bounded lateral weight shift and two
    // vertical COM peaks per stride. The limb cycle supplies sagittal motion
    // while the body remains centered in the analysis viewport.
    x: Math.sin(p * Math.PI * 2) * 0.012,
    y: (1 - Math.cos(p * Math.PI * 4)) * 0.006,
    z: 0,
  };
}

export function getAxialMotion(phase) {
  const p = normalizeCyclePhase(phase);
  const wave = Math.sin(p * Math.PI * 2);
  return {
    pelvisObliquity: wave * 2.8 * D,
    pelvisRotation: Math.sin((p * Math.PI * 2) + (Math.PI / 8)) * 4.0 * D,
    trunkCounterRotation: -Math.sin((p * Math.PI * 2) + (Math.PI / 8)) * 2.4 * D,
  };
}

export class MovementSimulator {
  constructor(skeleton, deficits, frameSource = null) {
    this.skeleton  = skeleton;
    this.deficits  = deficits ?? [];
    this.frameSource = frameSource;
    this.isPlaying = false;
    this._clock    = new THREE.Clock();
    this._phase    = 0;
    this._speed    = 1.0;
    this._lastPhaseIdx = -1;
    this._rigged   = false;
    this._frozen   = false;
    this._effectiveElapsed = 0;
    this._rafId    = null;
    this._removeFrameCallback = null;

    // Scratch quaternions/axes reused every frame.
    this._qx = new THREE.Quaternion();
    this._qy = new THREE.Quaternion();
    this._qz = new THREE.Quaternion();
    this._xAxis = new THREE.Vector3(1, 0, 0);
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this._zAxis = new THREE.Vector3(0, 0, 1);

    this._clientKinematics = this._computeClientKinematics();
    this._curves = this._compileCurves(this._clientKinematics);
  }

  // ── Public API ───────────────────────────────────────────────
  start(speed = 1.0) {
    if (!this._rigged) { this._setupRig(); this._rigged = true; }
    this._speed = speed;
    if (this.skeleton) this.skeleton._idleFloat = false;

    if (this.isPlaying) {
      if (this._frozen) {
        this._frozen = false;
        if (!this._removeFrameCallback) this._clock.start();
      }
      return;
    }

    this._effectiveElapsed = 0;
    this._phase = 0;
    this.isPlaying = true;
    this._frozen   = false;
    this._lastPhaseIdx = -1;

    this._startLoop();
  }

  stop() {
    this.isPlaying = false;
    this._frozen   = false;
    this._clock.stop();
    if (this._removeFrameCallback) {
      this._removeFrameCallback();
      this._removeFrameCallback = null;
    }
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._resetPose();
    if (this.skeleton) this.skeleton._idleFloat = true;
  }

  setSpeed(speed) { this._speed = speed; }

  freeze() { this._frozen = true; }

  unfreeze() {
    if (this._frozen) {
      this._frozen = false;
      this._lastPhaseIdx = -1;
      if (!this._removeFrameCallback) this._clock.start();
    }
  }

  jumpToPhase(phaseName) {
    const phaseIdx = GAIT_PHASES.indexOf(phaseName);
    if (phaseIdx < 0) return;

    this._phase = getPhasePosePosition(phaseName);
    this._effectiveElapsed = this._phase * CYCLE_DUR;
    this._frozen = true;

    if (!this.isPlaying) {
      if (!this._rigged) { this._setupRig(); this._rigged = true; }
      if (this.skeleton) this.skeleton._idleFloat = false;
      this.isPlaying = true;
      this._startLoop();
    }
    this._applyKinematics(this._phase);
    this._applyRootMotion(this._phase);
  }

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

  _compileCurves(kinematics) {
    return Object.fromEntries(
      Object.entries(kinematics).map(([key, values]) => [key, createPeriodicGaitCurve(values)]),
    );
  }

  // ── Capture bind pose of the gait bones ──────────────────────
  _setupRig() {
    this._bones = (this.skeleton.getGaitBones && this.skeleton.getGaitBones()) || null;
    if (!this._bones) return;
    const remember = (b) => { if (b) b.userData._bindQuat = b.quaternion.clone(); };
    const { pelvis, trunk, L, R } = this._bones;
    remember(pelvis); remember(trunk);
    [L, R].forEach(side => { if (side) Object.values(side).forEach(remember); });
  }

  // Apply a flexion (local X) + optional abduction (local Z) on top of a
  // bone's bind orientation.
  _flex(bone, ax, az) {
    if (!bone || !bone.userData._bindQuat) return;
    this._qx.setFromAxisAngle(this._xAxis, ax);
    bone.quaternion.copy(bone.userData._bindQuat).multiply(this._qx);
    if (az) {
      this._qz.setFromAxisAngle(this._zAxis, az);
      bone.quaternion.multiply(this._qz);
    }
  }

  _applyBindRotation(bone, ax = 0, ay = 0, az = 0) {
    if (!bone || !bone.userData._bindQuat) return;
    bone.quaternion.copy(bone.userData._bindQuat);
    if (ax) {
      this._qx.setFromAxisAngle(this._xAxis, ax);
      bone.quaternion.multiply(this._qx);
    }
    if (ay) {
      this._qy.setFromAxisAngle(this._yAxis, ay);
      bone.quaternion.multiply(this._qy);
    }
    if (az) {
      this._qz.setFromAxisAngle(this._zAxis, az);
      bone.quaternion.multiply(this._qz);
    }
  }

  // ── Animation loop ────────────────────────────────────────────
  _startLoop() {
    if (this._removeFrameCallback) {
      this._removeFrameCallback();
      this._removeFrameCallback = null;
    }
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (this.frameSource?.addFrameCallback) {
      this._removeFrameCallback = this.frameSource.addFrameCallback((dt) => this.update(dt));
      return;
    }

    this._clock.start();
    this._animate();
  }

  _animate() {
    this._rafId = null;
    if (!this.isPlaying) return;

    this.update(this._clock.getDelta());
    this._rafId = requestAnimationFrame(() => this._animate());
  }

  update(rawDt) {
    if (!this.isPlaying) return;
    const dt = Math.min(Math.max(rawDt, 0), 0.05) * this._speed;
    if (!this._frozen) {
      this._effectiveElapsed += dt;
      this._phase = normalizeCyclePhase(this._effectiveElapsed / CYCLE_DUR);
    }

    this._applyKinematics(this._phase);
    this._applyRootMotion(this._phase);

    const phaseSample = getGaitPhaseSample(this._phase);
    const phaseIdx = phaseSample.index;
    if (phaseIdx !== this._lastPhaseIdx) {
      this._lastPhaseIdx = phaseIdx;
      bus.emit('gait:phaseChange', { phase: phaseSample.name });
    }
    bus.emit('sim:phaseUpdate', { phase: this._phase, phaseName: phaseSample.name });
  }

  // ── Root motion: translation + bounce + sway ─────────────────
  _applyRootMotion(phase) {
    const root = this.skeleton._root;
    if (!root) return;

    const trajectory = getRootTrajectory(phase);
    root.position.set(trajectory.x, trajectory.y, trajectory.z);
    root.rotation.y = 0;
  }

  // ── FK kinematics ─────────────────────────────────────────────
  _applyKinematics(phase) {
    if (!this._bones) return;
    const rPhase = normalizeCyclePhase(phase + 0.5);
    const leftPhaseName = getGaitPhaseSample(phase).name;
    const sample = (key, limbPhase) => samplePeriodicGaitCurve(this._curves[key], limbPhase) * D;

    const { pelvis, trunk, L, R } = this._bones;

    // ── Left leg ──────────────────────────────────────────────
    this._flex(L.thigh,
      SIGN.hipFlex * sample('hip_flexion', phase),
      SIGN.hipAbd * sample('hip_abduction', phase));
    this._flex(L.shank, SIGN.knee * sample('knee_flexion', phase));
    this._flex(L.foot, SIGN.ankle * sample('ankle_df', phase));

    // ── Right leg (contralateral) ─────────────────────────────
    this._flex(R.thigh,
      SIGN.hipFlex * sample('hip_flexion', rPhase),
      -SIGN.hipAbd * sample('hip_abduction', rPhase));
    this._flex(R.shank, SIGN.knee * sample('knee_flexion', rPhase));
    this._flex(R.foot, SIGN.ankle * sample('ankle_df', rPhase));

    // ── Arms: counter-swing to contralateral leg ──────────────
    this._flex(L.arm, SIGN.arm * sample('hip_flexion', rPhase) * 0.32);
    this._flex(R.arm, SIGN.arm * sample('hip_flexion', phase) * 0.32);

    // ── Trunk lean + pelvic sway ──────────────────────────────
    const axial = getAxialMotion(phase);
    if (trunk && trunk.userData._bindQuat) {
      this._applyBindRotation(
        trunk,
        SIGN.trunk * sample('trunk_lean', phase) * 0.5,
        axial.trunkCounterRotation,
        0,
      );
    }
    if (pelvis && pelvis.userData._bindQuat) {
      let obliquity = axial.pelvisObliquity;
      const hasTrend = this.deficits.some(d => d.id === 'trendelenburg');
      if (hasTrend && (leftPhaseName === 'mid_stance' || leftPhaseName === 'terminal_stance')) {
        obliquity += Math.sin(phase * Math.PI * 2) * 4.0 * D;
      }
      this._applyBindRotation(pelvis, 0, axial.pelvisRotation, obliquity);
    }
  }

  // ── Reset to bind pose ────────────────────────────────────────
  _resetPose() {
    const root = this.skeleton._root;
    if (root) { root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); }
    if (!this._bones) return;
    const restore = (b) => { if (b && b.userData._bindQuat) b.quaternion.copy(b.userData._bindQuat); };
    const { pelvis, trunk, L, R } = this._bones;
    restore(pelvis); restore(trunk);
    [L, R].forEach(side => { if (side) Object.values(side).forEach(restore); });
  }
}
