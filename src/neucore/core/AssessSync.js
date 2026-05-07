// src/neucore/core/AssessSync.js
// Bidirectional sync: form inputs ↔ 3D body joint colors
import { bus } from './JointBus.js';
import { painToColor } from './MaterialFactory.js';

export class AssessSync {
  constructor(skeletonBuilder, formEl) {
    this.skeleton = skeletonBuilder;
    this.form     = formEl;
    this._bindFormInputs();
    this._bindBusEvents();
  }

  _bindFormInputs() {
    if (!this.form) return;
    // Listen to any input with data-joint and data-type="pain"
    this.form.querySelectorAll('[data-joint][data-type="pain"]').forEach(el => {
      el.addEventListener('input', () => {
        const joint = el.dataset.joint;
        const val   = parseFloat(el.value) || 0;
        const color = painToColor(val);
        this.skeleton.setJointPain(joint, val, color);
      });
    });

    // Field → joint map from assessment form ns-* IDs
    const FIELD_JOINT_MAP = {
      'ns-hip-ir-l':   'LeftHip',
      'ns-hip-ir-r':   'RightHip',
      'ns-ankle-df-l': 'LeftAnkle',
      'ns-ankle-df-r': 'RightAnkle',
      'ns-sh-ir-l':    'LeftShoulder',
      'ns-sh-ir-r':    'RightShoulder',
      'ns-sl-squat-l': 'LeftKnee',
      'ns-sl-squat-r': 'RightKnee',
      'ns-bal-eo-l':   'LeftAnkle',
      'ns-bal-eo-r':   'RightAnkle',
    };

    Object.entries(FIELD_JOINT_MAP).forEach(([fieldId, jointKey]) => {
      const el = this.form.querySelector(`#${fieldId}`) ?? document.getElementById(fieldId);
      if (!el) return;
      el.addEventListener('input', () => {
        const val    = parseFloat(el.value) || 0;
        const max    = parseFloat(el.max) || 100;
        const deficit = Math.max(0, 1 - val / max);  // 0 = normal, 1 = severe
        const color  = painToColor(deficit * 10);
        this.skeleton.setJointPain(jointKey, deficit * 10, color);
        bus.emit('assess:fieldChange', { fieldId, jointKey, value: val });
      });
    });
  }

  _bindBusEvents() {
    bus.on('assess:painChange', ({ jointKey, value, color }) => {
      this.skeleton.setJointPain(jointKey, value, color);
    });

    bus.on('assess:save', ({ jointKey, data }) => {
      if (data.pain_scale > 0) {
        const color = painToColor(data.pain_scale);
        this.skeleton.setJointPain(jointKey, data.pain_scale, color);
      }
    });
  }

  // Bulk-load from saved assessment data
  loadAssessmentData(assessmentData) {
    if (!assessmentData) return;
    Object.entries(assessmentData).forEach(([jointKey, data]) => {
      if (data.pain_scale > 0) {
        const color = painToColor(data.pain_scale);
        this.skeleton.setJointPain(jointKey, data.pain_scale, color);
      }
    });
  }
}
