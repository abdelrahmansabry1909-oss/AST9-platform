// src/neucore/core/ObjectiveSync.js
// Two-way binding between the Objective assessment form and the 3D body map.
//
//  • Form field changes  → recolor the matching 3D joint by deficit severity.
//  • 3D joint-panel edits → write the value straight back into the form field.
//
// `rom` keys MUST match JOINT_ASSESSMENT_MAP / AssessmentPanel field names so
// the panel and the form share one value in `assessStore`.
import { bus } from './JointBus.js';
import { painToColor } from './MaterialFactory.js';

// kind: 'rom' = numeric ROM, bidirectional. 'time'/'score'/'checkbox' = form→3D.
const BINDINGS = [
  // ── Hip ROM ──
  { field: 'ns-hip-ir-l',   joint: 'LeftHip',      rom: 'hip_ir_left',          norm: 40,  kind: 'rom' },
  { field: 'ns-hip-ir-r',   joint: 'RightHip',     rom: 'hip_ir_right',         norm: 40,  kind: 'rom' },
  { field: 'ns-hip-er-l',   joint: 'LeftHip',      rom: 'hip_er_left',          norm: 45,  kind: 'rom' },
  { field: 'ns-hip-er-r',   joint: 'RightHip',     rom: 'hip_er_right',         norm: 45,  kind: 'rom' },
  { field: 'ns-hip-flex-l', joint: 'LeftHip',      rom: 'hip_flexion_left',     norm: 120, kind: 'rom' },
  { field: 'ns-hip-flex-r', joint: 'RightHip',     rom: 'hip_flexion_right',    norm: 120, kind: 'rom' },
  { field: 'ns-hip-ext-l',  joint: 'LeftHip',      rom: 'hip_extension_left',   norm: 15,  kind: 'rom' },
  { field: 'ns-hip-ext-r',  joint: 'RightHip',     rom: 'hip_extension_right',  norm: 15,  kind: 'rom' },
  { field: 'ns-hip-abd-l',  joint: 'LeftHip',      rom: 'hip_abduction_left',   norm: 45,  kind: 'rom' },
  { field: 'ns-hip-abd-r',  joint: 'RightHip',     rom: 'hip_abduction_right',  norm: 45,  kind: 'rom' },
  // ── Shoulder ROM ──
  { field: 'ns-sh-flex-l',  joint: 'LeftShoulder', rom: 'shoulder_flexion_left',    norm: 170, kind: 'rom' },
  { field: 'ns-sh-flex-r',  joint: 'RightShoulder',rom: 'shoulder_flexion_right',   norm: 170, kind: 'rom' },
  { field: 'ns-sh-ext-l',   joint: 'LeftShoulder', rom: 'shoulder_extension_left',  norm: 55,  kind: 'rom' },
  { field: 'ns-sh-ext-r',   joint: 'RightShoulder',rom: 'shoulder_extension_right', norm: 55,  kind: 'rom' },
  { field: 'ns-sh-ir-l',    joint: 'LeftShoulder', rom: 'shoulder_ir_left',         norm: 80,  kind: 'rom' },
  { field: 'ns-sh-ir-r',    joint: 'RightShoulder',rom: 'shoulder_ir_right',        norm: 80,  kind: 'rom' },
  { field: 'ns-sh-er-l',    joint: 'LeftShoulder', rom: 'shoulder_er_left',         norm: 90,  kind: 'rom' },
  { field: 'ns-sh-er-r',    joint: 'RightShoulder',rom: 'shoulder_er_right',        norm: 90,  kind: 'rom' },
  // ── Ankle dorsiflexion ──
  { field: 'ns-ankle-df-l', joint: 'LeftAnkle',    rom: 'ankle_dorsiflexion_left_cm',  norm: 10, kind: 'rom' },
  { field: 'ns-ankle-df-r', joint: 'RightAnkle',   rom: 'ankle_dorsiflexion_right_cm', norm: 10, kind: 'rom' },
  // ── Balance (form → 3D) ──
  { field: 'ns-bal-eo-l',   joint: 'LeftAnkle',    norm: 30, kind: 'time' },
  { field: 'ns-bal-eo-r',   joint: 'RightAnkle',   norm: 30, kind: 'time' },
  { field: 'ns-bal-ec-l',   joint: 'LeftAnkle',    norm: 10, kind: 'time' },
  { field: 'ns-bal-ec-r',   joint: 'RightAnkle',   norm: 10, kind: 'time' },
  // ── Functional screens (form → 3D) ──
  { field: 'ns-sl-squat-l', joint: 'LeftKnee',     kind: 'score' },
  { field: 'ns-sl-squat-r', joint: 'RightKnee',    kind: 'score' },
  { field: 'ns-sl-rdl-l',   joint: 'LeftHip',      kind: 'score' },
  { field: 'ns-sl-rdl-r',   joint: 'RightHip',     kind: 'score' },
  { field: 'ns-oh-squat',   joint: 'LumbarSpine',  kind: 'score' },
  // ── Spine pain flags (form → 3D) ──
  { field: 'ns-sp-flex-pain', joint: 'LumbarSpine',   kind: 'checkbox' },
  { field: 'ns-sp-ext-pain',  joint: 'LumbarSpine',   kind: 'checkbox' },
  { field: 'ns-sp-lfl-pain',  joint: 'LumbarSpine',   kind: 'checkbox' },
  { field: 'ns-sp-lfr-pain',  joint: 'LumbarSpine',   kind: 'checkbox' },
  { field: 'ns-sp-rotl-pain', joint: 'ThoracicSpine', kind: 'checkbox' },
  { field: 'ns-sp-rotr-pain', joint: 'ThoracicSpine', kind: 'checkbox' },

  // ── Shoulder abduction ──
  // The motion Neumann Fig. 5-51 measured, and the one the scapular
  // activation chart prefers. JOINT_NORMATIVE already carried abduction: 180
  // for both shoulders; only the binding was missing.
  { field: 'ns-sh-abd-l',   joint: 'LeftShoulder', rom: 'shoulder_abduction_left',  norm: 180, kind: 'rom' },
  { field: 'ns-sh-abd-r',   joint: 'RightShoulder',rom: 'shoulder_abduction_right', norm: 180, kind: 'rom' },

  // ── Thoracic spine ──
  // Norms are the Neumann values js/integrationEngine.js already scores
  // against (Table 9-11), so the colour on the body map and the finding in
  // the integration panel cannot disagree about what "restricted" means.
  { field: 'ns-thor-rot-l', joint: 'ThoracicSpine', rom: 'thoracic_rotation_left',  norm: 30, kind: 'rom' },
  { field: 'ns-thor-rot-r', joint: 'ThoracicSpine', rom: 'thoracic_rotation_right', norm: 30, kind: 'rom' },
  { field: 'ns-thor-ext',   joint: 'ThoracicSpine', rom: 'thoracic_extension',      norm: 20, kind: 'rom' },
  { field: 'ns-thor-flex',  joint: 'ThoracicSpine', rom: 'thoracic_flexion',        norm: 30, kind: 'rom' },

  // ── Cervical spine ──
  // 70 is the floor of the range the form itself shows the coach ("70–90°").
  // JOINT_NORMATIVE still says 60; that divergence is unresolved and is left
  // for the owner rather than changed here.
  { field: 'ns-cerv-rot-l', joint: 'CervicalSpine', rom: 'cervical_rotation_left',  norm: 70, kind: 'rom' },
  { field: 'ns-cerv-rot-r', joint: 'CervicalSpine', rom: 'cervical_rotation_right', norm: 70, kind: 'rom' },
  { field: 'ns-cerv-flex',  joint: 'CervicalSpine', kind: 'flag' },
  { field: 'ns-cerv-ext',   joint: 'CervicalSpine', kind: 'flag' },

  // ── Lumbar / sacrum ──
  // Neumann 50° flexion / 15° extension (owner ruling, 2026-08-26), matching
  // js/integrationEngine.js. This replaced three disagreeing sources — see
  // KNOWN_LIMITATIONS L22.
  { field: 'ns-lumb-flex',  joint: 'LumbarSpine', rom: 'lumbar_flexion',   norm: 50, kind: 'rom' },
  { field: 'ns-lumb-ext',   joint: 'LumbarSpine', rom: 'lumbar_extension', norm: 15, kind: 'rom' },
  { field: 'ns-si-pain',    joint: 'LumbarSpine', kind: 'flag' },

  // ── Elbow / wrist ──
  // Elbow extension is bound so the panel and the form stay in step, but its
  // norm is 0 and it therefore drives no colour — see _fieldDeficit.
  { field: 'ns-elbow-flex-l', joint: 'LeftElbow',  rom: 'elbow_flexion_left',    norm: 145, kind: 'rom' },
  { field: 'ns-elbow-flex-r', joint: 'RightElbow', rom: 'elbow_flexion_right',   norm: 145, kind: 'rom' },
  { field: 'ns-elbow-ext-l',  joint: 'LeftElbow',  rom: 'elbow_extension_left',  norm: 0,   kind: 'rom' },
  { field: 'ns-elbow-ext-r',  joint: 'RightElbow', rom: 'elbow_extension_right', norm: 0,   kind: 'rom' },
  { field: 'ns-wrist-flex-l', joint: 'LeftWrist',  rom: 'wrist_flexion_left',    norm: 80,  kind: 'rom' },
  { field: 'ns-wrist-flex-r', joint: 'RightWrist', rom: 'wrist_flexion_right',   norm: 80,  kind: 'rom' },
  { field: 'ns-wrist-ext-l',  joint: 'LeftWrist',  rom: 'wrist_extension_left',  norm: 70,  kind: 'rom' },
  { field: 'ns-wrist-ext-r',  joint: 'RightWrist', rom: 'wrist_extension_right', norm: 70,  kind: 'rom' },
];

// Values that mean "positive / painful" on the free-text and select fields.
// Matched as whole values, never as substrings, so "NP" is not caught by "P".
const POSITIVE_FLAGS = new Set(['p', 'pain', 'painful', 'yes', 'y', 'positive', '+']);

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class ObjectiveSync {
  constructor(store) {
    this.store    = store || {};
    this.skeleton = null;
    this._deficit = {};         // fieldId → 0..1
    this._byJoint = {};         // jointKey → bindings[]
    this._byRom   = {};         // 'joint|rom' → binding

    BINDINGS.forEach((b) => {
      (this._byJoint[b.joint] ||= []).push(b);
      if (b.kind === 'rom') this._byRom[b.joint + '|' + b.rom] = b;
    });

    this._bindForm();
    this._bindBus();
  }

  // Called once the Objective-tab skeleton has finished loading.
  setSkeleton(skel) {
    this.skeleton = skel;
    this.syncAll();
  }

  // ── form → 3D ────────────────────────────────────────────────────
  _bindForm() {
    BINDINGS.forEach((b) => {
      const el = document.getElementById(b.field);
      if (!el) return;
      const handler = () => this._onFieldChange(b, el);
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
  }

  _fieldDeficit(b, el) {
    if (!el) return 0;
    if (b.kind === 'checkbox') return el.checked ? 0.85 : 0;
    const raw = el.value;
    if (raw === '' || raw == null) return 0;
    // Not every finding is a number. Cervical flexion/extension are free text
    // ("P" / "NP") and SI provocation is a yes/no select, so they report
    // presence rather than degrees — same weight as the pain checkboxes.
    if (b.kind === 'flag') return POSITIVE_FLAGS.has(String(raw).trim().toLowerCase()) ? 0.85 : 0;
    const v = parseFloat(raw);
    if (isNaN(v)) return 0;
    if (b.kind === 'score') return clamp01((3 - v) / 3);   // 3 = clean, 0 = pain
    // A norm of 0 — elbow extension, where 0° IS the normal — has no
    // "less is worse" scale. The real deficit is a contracture below zero,
    // which this formula cannot express and for which the app has no severity
    // scale; dividing by the norm would also be a divide-by-zero. Keep the
    // field bidirectional so the panel and form stay in step, and drive no
    // colour rather than invent a severity. Knee extension (norm 0) has always
    // been left unbound for the same reason.
    if (!b.norm) return 0;
    return clamp01((b.norm - v) / b.norm);                 // rom / time: low = deficit
  }

  _onFieldChange(b, el) {
    this._deficit[b.field] = this._fieldDeficit(b, el);
    if (b.kind === 'rom') {
      const v = parseFloat(el.value);
      (this.store[b.joint] ||= {})[b.rom] = isNaN(v) ? undefined : v;
    }
    this._recolor(b.joint);
  }

  _recolor(joint) {
    if (!this.skeleton) return;
    let worst = 0;
    (this._byJoint[joint] || []).forEach((b) => {
      worst = Math.max(worst, this._deficit[b.field] || 0);
    });
    const pain = worst * 10;
    this.skeleton.setJointPain(joint, pain, painToColor(pain));
  }

  // ── 3D → form ────────────────────────────────────────────────────
  _bindBus() {
    // A ROM value edited inside the joint pop-out panel on the 3D body.
    bus.on('assess:romChange', ({ jointKey, field, value }) => {
      const b = this._byRom[jointKey + '|' + field];
      if (!b) return;
      const el = document.getElementById(b.field);
      if (el) el.value = (value == null || isNaN(value)) ? '' : value;
      (this.store[jointKey] ||= {})[field] = value;
      this._deficit[b.field] = this._fieldDeficit(b, el);
      this._recolor(jointKey);
    });
  }

  // Read every bound form field, recolor every joint. Run when the skeleton
  // is ready or a saved assessment is loaded.
  syncAll() {
    BINDINGS.forEach((b) => {
      const el = document.getElementById(b.field);
      this._deficit[b.field] = this._fieldDeficit(b, el);
      if (b.kind === 'rom' && el) {
        const v = parseFloat(el.value);
        if (!isNaN(v)) (this.store[b.joint] ||= {})[b.rom] = v;
      }
    });
    Object.keys(this._byJoint).forEach((joint) => this._recolor(joint));
  }
}
