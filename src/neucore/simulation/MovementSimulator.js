// src/neucore/simulation/MovementSimulator.js
import * as THREE from 'three';
import { bus } from '../core/JointBus.js';
import { GAIT_PHASES } from './MuscleActivationDB.js';

const NORMATIVE_KINEMATICS = {
  hip_flexion:  { loading_response:25,mid_stance:5,terminal_stance:-10,pre_swing:-5,initial_swing:15,mid_swing:25,terminal_swing:20 },
  hip_abduction:{ loading_response:-5,mid_stance:3,terminal_stance:2,pre_swing:-2,initial_swing:0,mid_swing:0,terminal_swing:0 },
  knee_flexion: { loading_response:20,mid_stance:5,terminal_stance:0,pre_swing:35,initial_swing:60,mid_swing:65,terminal_swing:30 },
  ankle_df:     { loading_response:-5,mid_stance:5,terminal_stance:15,pre_swing:-10,initial_swing:5,mid_swing:5,terminal_swing:5 },
  trunk_lean:   { loading_response:5,mid_stance:3,terminal_stance:2,pre_swing:4,initial_swing:5,mid_swing:3,terminal_swing:4 },
};

export class MovementSimulator {
  constructor(skeletonBuilder, deficits) {
    this.skeleton  = skeletonBuilder;
    this.deficits  = deficits ?? [];
    this.isPlaying = false;
    this._clock    = new THREE.Clock();
    this._phase    = 0;
    this._speed    = 1.0;
    this._clientKinematics = this._computeClientKinematics();
  }

  _computeClientKinematics() {
    const k = JSON.parse(JSON.stringify(NORMATIVE_KINEMATICS));

    this.deficits.forEach(deficit => {
      switch (deficit.id) {
        case 'limited_df': {
          const dfScale = Math.min((parseFloat(deficit.assessment?.ankle_dorsiflexion_left_cm) || 8) / 10, 1);
          Object.keys(k.ankle_df).forEach(p => { if (k.ankle_df[p] > 0) k.ankle_df[p] *= dfScale; });
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
          const extScale = (parseFloat(deficit.assessment?.hip_extension_left) || 8) / 10;
          k.hip_flexion.terminal_stance = Math.max(-5, k.hip_flexion.terminal_stance * extScale);
          k.trunk_lean.terminal_stance += 5;
          break;
        }
        case 'trendelenburg':
          k.trunk_lean.mid_stance += 8;
          k.trunk_lean.terminal_stance += 6;
          k.hip_abduction.mid_stance -= 5;
          break;
        case 'oh_squat_forward_lean':
          Object.keys(k.trunk_lean).forEach(p => { k.trunk_lean[p] += 6; });
          break;
        case 'poor_balance_eo':
          k.hip_abduction.mid_stance += 4;
          k.hip_abduction.loading_response += 3;
          break;
      }
    });

    return k;
  }

  start(speed = 1.0) {
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

  _animate() {
    if (!this.isPlaying) return;
    const t = this._clock.getElapsedTime() * this._speed;
    this._phase = (t % 1.1) / 1.1;
    this._applyKinematics(this._phase);

    const phaseIdx = Math.min(Math.floor(this._phase * 7), 6);
    bus.emit('sim:phaseUpdate', { phase: this._phase, phaseName: GAIT_PHASES[phaseIdx] });
    bus.emit('gait:phaseChange', { phase: GAIT_PHASES[phaseIdx] });

    requestAnimationFrame(() => this._animate());
  }

  _applyKinematics(phase) {
    const sk = this.skeleton;
    const k  = this._clientKinematics;
    const phaseIdx  = Math.floor(phase * 7);
    const phaseFrac = (phase * 7) - phaseIdx;
    const cur  = GAIT_PHASES[Math.min(phaseIdx, 6)];
    const next = GAIT_PHASES[Math.min(phaseIdx + 1, 6)];
    const D = Math.PI / 180;

    const lerp = (key, c, n, t) => {
      const a = (k[key]?.[c] ?? 0) * D;
      const b = (k[key]?.[n] ?? 0) * D;
      return a + (b - a) * t;
    };

    const lHip = sk.boneMeshes.get('LeftFemur');
    if (lHip) {
      lHip.rotation.x = lerp('hip_flexion', cur, next, phaseFrac);
      lHip.rotation.z = lerp('hip_abduction', cur, next, phaseFrac);
    }

    const rHip = sk.boneMeshes.get('RightFemur');
    if (rHip) {
      const rph = (phase + 0.5) % 1.0;
      const ri  = Math.floor(rph * 7), rf = (rph * 7) - ri;
      const rc  = GAIT_PHASES[Math.min(ri, 6)], rn = GAIT_PHASES[Math.min(ri + 1, 6)];
      rHip.rotation.x = lerp('hip_flexion', rc, rn, rf);
    }

    const lKnee = sk.boneMeshes.get('LeftTibia');
    if (lKnee) lKnee.rotation.x = lerp('knee_flexion', cur, next, phaseFrac);

    const rKnee = sk.boneMeshes.get('RightTibia');
    if (rKnee) {
      const rph = (phase + 0.5) % 1.0;
      const ri  = Math.floor(rph * 7), rf = (rph * 7) - ri;
      const rc  = GAIT_PHASES[Math.min(ri, 6)], rn = GAIT_PHASES[Math.min(ri + 1, 6)];
      rKnee.rotation.x = lerp('knee_flexion', rc, rn, rf);
    }

    const pelvis = sk.boneMeshes.get('Pelvis');
    if (pelvis) {
      pelvis.rotation.x = lerp('trunk_lean', cur, next, phaseFrac) * 0.5;
      const hasTrend = this.deficits.some(d => d.id === 'trendelenburg');
      if (hasTrend && (cur === 'mid_stance' || cur === 'terminal_stance')) {
        pelvis.rotation.z = Math.sin(phase * Math.PI * 2) * 0.08;
      }
    }

    const lArm = sk.boneMeshes.get('LeftHumerus');
    const rArm = sk.boneMeshes.get('RightHumerus');
    if (lArm) lArm.rotation.x =  Math.sin(phase * Math.PI * 2) * 0.25;
    if (rArm) rArm.rotation.x = -Math.sin(phase * Math.PI * 2) * 0.25;
  }

  _resetPose() {
    ['LeftFemur','RightFemur','LeftTibia','RightTibia','Pelvis','LeftHumerus','RightHumerus'].forEach(id => {
      const mesh = this.skeleton.boneMeshes.get(id);
      if (mesh) mesh.rotation.set(0, 0, 0);
    });
  }
}
