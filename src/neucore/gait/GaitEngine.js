// src/neucore/gait/GaitEngine.js
// Walk-cycle chain-reaction controller.
// Runs alongside MovementSimulator: handles joint highlight cascades,
// worst-case visual mode, and deficit-driven color reactions on the skeleton.

import { bus } from '../core/JointBus.js';

// Joint highlights per gait phase — which joints are under load
const PHASE_ACTIVE_JOINTS = {
  loading_response: ['LeftAnkle', 'LeftKnee', 'LeftHip'],
  mid_stance:       ['LeftHip', 'LeftKnee', 'LumbarSpine'],
  terminal_stance:  ['LeftHip', 'LumbarSpine', 'LeftAnkle'],
  pre_swing:        ['LeftHip', 'LeftKnee'],
  initial_swing:    ['LeftHip', 'LeftKnee'],
  mid_swing:        ['LeftKnee', 'LeftAnkle'],
  terminal_swing:   ['LeftHip', 'LeftKnee', 'LeftAnkle'],
};

export class GaitEngine {
  constructor(bodyCanvas) {
    this.body        = bodyCanvas;
    this.assessment  = null;
    this.isPlaying   = false;
    this._worstCase  = false;

    bus.on('gait:phaseChange', ({ phase }) => this._onPhaseChange(phase));
  }

  loadAssessment(assessment) {
    this.assessment = assessment;
  }

  start() {
    this.isPlaying  = true;
  }

  stop() {
    this.isPlaying = false;
    this._clearHighlights();
  }

  setWorstCase(active) {
    this._worstCase = active;
    if (active) this._applyWorstCaseHighlights();
    else        this._clearHighlights();
  }

  _onPhaseChange(phaseName) {
    if (!this.isPlaying && !this._worstCase) return;
    const skel     = this.body._skeleton;
    if (!skel) return;

    const active   = PHASE_ACTIVE_JOINTS[phaseName] ?? [];
    const intensity = this._worstCase ? 1.5 : 0.6;

    skel.resetAllOpacity?.();
    active.forEach(key => skel.highlightJoint?.(key, intensity));
  }

  _applyWorstCaseHighlights() {
    if (!this.body?._skeleton) return;
    const skel = this.body._skeleton;
    // All stance phase joints at full intensity
    ['LeftHip', 'LeftKnee', 'LeftAnkle', 'LumbarSpine'].forEach(key => {
      skel.highlightJoint?.(key, 2.0);
    });
  }

  _clearHighlights() {
    if (!this.body?._skeleton) return;
    this.body._skeleton.resetAllOpacity?.();
  }
}
