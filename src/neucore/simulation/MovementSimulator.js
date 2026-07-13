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
const NORMATIVE_KINEMATICS = {
  hip_flexion:  { loading_response:25, mid_stance:5,  terminal_stance:-10, pre_swing:-5,  initial_swing:15,  mid_swing:25,  terminal_swing:20  },
  hip_abduction:{ loading_response:-5, mid_stance:3,  terminal_stance:2,   pre_swing:-2,  initial_swing:0,   mid_swing:0,   terminal_swing:0   },
  knee_flexion: { loading_response:20, mid_stance:5,  terminal_stance:0,   pre_swing:35,  initial_swing:60,  mid_swing:65,  terminal_swing:30  },
  ankle_df:     { loading_response:-5, mid_stance:5,  terminal_stance:15,  pre_swing:-10, initial_swing:5,   mid_swing:5,   terminal_swing:5   },
  trunk_lean:   { loading_response:5,  mid_stance:3,  terminal_stance:2,   pre_swing:4,   initial_swing:5,   mid_swing:3,   terminal_swing:4   },
};

export class MovementSimulator {
  constructor(skeleton, deficits) {
    this.skeleton  = skeleton;
    this.deficits  = deficits ?? [];
    this.isPlaying = false;
    this._clock    = new THREE.Clock();
    this._phase    = 0;
    this._speed    = 1.0;
    this._lastPhaseIdx = -1;
    this._rigged   = false;
    this._frozen   = false;
    this._effectiveElapsed = 0;
    this._rafId    = null;

    // Scratch quaternions/axes reused every frame.
    this._qx = new THREE.Quaternion();
    this._qz = new THREE.Quaternion();
    this._xAxis = new THREE.Vector3(1, 0, 0);
    this._zAxis = new THREE.Vector3(0, 0, 1);

    this._clientKinematics = this._computeClientKinematics();
  }

  // ── Public API ───────────────────────────────────────────────
  start(speed = 1.0) {
    if (!this._rigged) { this._setupRig(); this._rigged = true; }
    this._speed = speed;
    if (this.skeleton) this.skeleton._idleFloat = false;

    if (this.isPlaying) {
      if (this._frozen) {
        this._frozen = false;
        this._clock.start();
      }
      return;
    }

    this._effectiveElapsed = 0;
    this._phase = 0;
    this.isPlaying = true;
    this._frozen   = false;

    this._startLoop();
  }

  stop() {
    this.isPlaying = false;
    this._frozen   = false;
    this._clock.stop();
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
      this._clock.start();
    }
  }

  jumpToPhase(phaseName) {
    const phaseIdx = GAIT_PHASES.indexOf(phaseName);
    if (phaseIdx < 0) return;

    const phaseCount = GAIT_PHASES.length;
    this._effectiveElapsed = (phaseIdx / phaseCount + 0.035) * CYCLE_DUR;
    this._phase = (this._effectiveElapsed % CYCLE_DUR) / CYCLE_DUR;
    this._frozen = true;

    if (!this.isPlaying) {
      if (!this._rigged) { this._setupRig(); this._rigged = true; }
      if (this.skeleton) this.skeleton._idleFloat = false;
      this.isPlaying = true;
      this._startLoop();
    }
    this._applyKinematics(this._phase);
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

  // ── Animation loop ────────────────────────────────────────────
  _startLoop() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._clock.start();
    this._animate();
  }

  _animate() {
    this._rafId = null;
    if (!this.isPlaying) return;

    const rawDt = this._clock.getDelta();
    const clampedDt = Math.min(rawDt, 0.05);
    const dt = clampedDt * this._speed;
    if (!this._frozen) {
      this._effectiveElapsed += dt;
      this._phase = (this._effectiveElapsed % CYCLE_DUR) / CYCLE_DUR;
    }

    this._applyKinematics(this._phase);
    if (!this._frozen) this._applyRootMotion(this._phase);

    const phaseCount = GAIT_PHASES.length;
    const phaseIdx = Math.min(Math.floor(this._phase * phaseCount), phaseCount - 1);
    if (phaseIdx !== this._lastPhaseIdx) {
      this._lastPhaseIdx = phaseIdx;
      bus.emit('gait:phaseChange', { phase: GAIT_PHASES[phaseIdx] });
    }
    bus.emit('sim:phaseUpdate', { phase: this._phase, phaseName: GAIT_PHASES[phaseIdx] });

    this._rafId = requestAnimationFrame(() => this._animate());
  }

  // ── Root motion: translation + bounce + sway ─────────────────
  _applyRootMotion(phase) {
    const root = this.skeleton._root;
    if (!root) return;

    root.position.x = Math.sin(phase * Math.PI * 2) * 0.018;
    root.position.y = Math.sin(phase * Math.PI * 4) * 0.018;
    root.position.z = 0;
    root.rotation.y = 0;
  }

  // ── FK kinematics ─────────────────────────────────────────────
  _applyKinematics(phase) {
    if (!this._bones) return;
    const k = this._clientKinematics;

    const phaseCount = GAIT_PHASES.length;
    const phaseIdx  = Math.min(Math.floor(phase * phaseCount), phaseCount - 1);
    const phaseFrac = (phase * phaseCount) - phaseIdx;
    const cur       = GAIT_PHASES[phaseIdx];
    const next      = GAIT_PHASES[(phaseIdx + 1) % phaseCount];

    // Contralateral phase (right leg 50% offset)
    const rPhase    = (phase + 0.5) % 1.0;
    const rIdx      = Math.min(Math.floor(rPhase * phaseCount), phaseCount - 1);
    const rFrac     = (rPhase * phaseCount) - rIdx;
    const rCur      = GAIT_PHASES[rIdx];
    const rNext     = GAIT_PHASES[(rIdx + 1) % phaseCount];

    const lerp = (key, c, n, t) => {
      const a = (k[key]?.[c] ?? 0) * D;
      const b = (k[key]?.[n] ?? 0) * D;
      return a + (b - a) * t;
    };

    const { pelvis, trunk, L, R } = this._bones;

    // ── Left leg ──────────────────────────────────────────────
    this._flex(L.thigh,
      SIGN.hipFlex * lerp('hip_flexion',   cur, next, phaseFrac),
      SIGN.hipAbd  * lerp('hip_abduction', cur, next, phaseFrac));
    this._flex(L.shank, SIGN.knee  * lerp('knee_flexion', cur, next, phaseFrac));
    this._flex(L.foot,  SIGN.ankle * lerp('ankle_df',     cur, next, phaseFrac));

    // ── Right leg (contralateral) ─────────────────────────────
    this._flex(R.thigh,
      SIGN.hipFlex * lerp('hip_flexion',   rCur, rNext, rFrac),
      -SIGN.hipAbd * lerp('hip_abduction', rCur, rNext, rFrac));
    this._flex(R.shank, SIGN.knee  * lerp('knee_flexion', rCur, rNext, rFrac));
    this._flex(R.foot,  SIGN.ankle * lerp('ankle_df',     rCur, rNext, rFrac));

    // ── Arms: counter-swing to contralateral leg ──────────────
    this._flex(L.arm, SIGN.arm * lerp('hip_flexion', rCur, rNext, rFrac) * 0.32);
    this._flex(R.arm, SIGN.arm * lerp('hip_flexion', cur,  next,  phaseFrac) * 0.32);

    // ── Trunk lean + pelvic sway ──────────────────────────────
    if (trunk && trunk.userData._bindQuat) {
      this._flex(trunk, SIGN.trunk * lerp('trunk_lean', cur, next, phaseFrac) * 0.5);
    }
    if (pelvis && pelvis.userData._bindQuat) {
      let swayZ = Math.sin(phase * Math.PI * 2) * 0.05;
      const hasTrend = this.deficits.some(d => d.id === 'trendelenburg');
      if (hasTrend && (cur === 'mid_stance' || cur === 'terminal_stance')) {
        swayZ += Math.sin(phase * Math.PI * 2) * 0.07;
      }
      this._qz.setFromAxisAngle(this._zAxis, swayZ);
      pelvis.quaternion.copy(pelvis.userData._bindQuat).multiply(this._qz);
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
