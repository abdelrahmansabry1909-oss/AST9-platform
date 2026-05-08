// src/main.js
// NeuCore ES module entry point.
// Takes over #bodymap-dashboard-container with the full holographic skeleton,
// wires assessment form inputs to joint colors, and powers the Generate flow.

import * as THREE from 'three';
import { BodyCanvas }       from './neucore/core/BodyCanvas.js';
import { SkeletonBuilder }  from './neucore/skeleton/SkeletonBuilder.js';
import { AssessSync }       from './neucore/core/AssessSync.js';
import { FXLayer }          from './neucore/core/FXLayer.js';
import { AssessmentPanel }  from './neucore/panels/AssessmentPanel.js';
import { GaitAnalysisPage } from './neucore/gait/GaitAnalysisPage.js';
import { bus }              from './neucore/core/JointBus.js';
import { JOINT_LABELS }     from './neucore/core/JointRegistry.js';
import { painToColor }      from './neucore/core/MaterialFactory.js';

// Expose THREE globally so legacy IIFE scripts share one instance
window.THREE = THREE;

// ── State ────────────────────────────────────────────────────────
let mainCanvas    = null;
let mainSkeleton  = null;
let mainFX        = null;
let assessPanel   = null;
let assessStore   = {};   // jointKey → { pain_scale, rom fields, location[] }
let gaitPage      = null;

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  _initMainSkeleton();
  _initObjectiveSidebar();
  _initGenerateButton();
  _wireFormInputs();
  _wireJointInfoBar();
});

// ── 1. Main 3D skeleton in the dashboard ─────────────────────────
function _initMainSkeleton() {
  const wrap = document.getElementById('bodymap-dashboard-container');
  if (!wrap) return;

  // Clear the old "Click to load" placeholder and remove old onclick
  wrap.innerHTML = '';
  wrap.onclick   = null;
  wrap.removeAttribute('onclick');
  wrap.style.background = '#050D1A';
  wrap.style.cursor = 'default';

  mainCanvas   = new BodyCanvas(wrap);
  mainSkeleton = new SkeletonBuilder(mainCanvas.scene);
  mainSkeleton.build();
  mainFX = new FXLayer(mainCanvas, mainSkeleton);
  mainCanvas._skeleton = mainSkeleton;
  mainCanvas._fxLayer  = mainFX;

  // Assessment pop-out panels live inside the 3D container (position:absolute)
  assessPanel = new AssessmentPanel(wrap, mainSkeleton, assessStore);

  // Sync joint:select → update right-side info bar
  bus.on('joint:select', ({ jointKey }) => _updateInfoBar(jointKey));
  bus.on('joint:deselect', () => _clearInfoBar());
  bus.on('joint:hover',    ({ jointKey }) => _showHoverLabel(jointKey));
  bus.on('joint:hoverout', () => _clearHoverLabel());

  // Global hooks for toolbar buttons
  window._ncReset = () => {
    mainSkeleton?.resetAllOpacity();
    Object.keys(assessStore).forEach(k => {
      mainSkeleton?.setJointPain(k, 0, null);
    });
    assessStore = {};
    mainCanvas?.controls && (mainCanvas.controls.autoRotate = true);
    _clearInfoBar();
  };

  let _gaitSim = null;
  window._ncToggleGait = async (btn) => {
    if (_gaitSim?.isPlaying) {
      _gaitSim.stop();
      btn.textContent = '▶ Simulate';
    } else {
      const { MovementSimulator } = await import('./neucore/simulation/MovementSimulator.js');
      _gaitSim = new MovementSimulator(mainSkeleton, []);
      _gaitSim.start(1.0);
      btn.textContent = '■ Stop';
    }
  };
}

// ── 2. Objective-tab sidebar skeleton ────────────────────────────
function _initObjectiveSidebar() {
  const objBtn = document.querySelector('[data-tab="tab-objective"]');
  const objTab = document.getElementById('tab-objective');
  if (!objBtn || !objTab) return;

  let sideCanvas = null;

  const initSide = () => {
    const sideWrap = document.getElementById('neucore-body-canvas');
    if (!sideWrap || sideCanvas) return;
    sideCanvas = new BodyCanvas(sideWrap);
    const sideSkel = new SkeletonBuilder(sideCanvas.scene);
    sideSkel.build();
    const sideFX = new FXLayer(sideCanvas, sideSkel);
    sideCanvas._skeleton = sideSkel;
    sideCanvas._fxLayer  = sideFX;
    new AssessmentPanel(sideWrap, sideSkel, assessStore);

    // Also keep main skeleton in sync
    bus.on('assess:painChange', ({ jointKey, value, color }) => {
      mainSkeleton?.setJointPain(jointKey, value, color);
    });
  };

  objBtn.addEventListener('click', initSide);
  if (objTab.classList.contains('active')) initSide();
}

// ── 3. Generate button → GaitAnalysisPage ────────────────────────
function _initGenerateButton() {
  const btn = document.getElementById('generate-btn');
  if (!btn) return;

  // Capture phase: fires before the existing onclick="Dashboard.generateProgram()"
  btn.addEventListener('click', () => {
    const assessment  = _collectAssessment();
    const gaitWrap    = document.getElementById('neucore-gait-container');
    if (!gaitWrap) return;

    gaitWrap.classList.remove('hidden');
    setTimeout(() => gaitWrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

    gaitPage?.destroy();
    gaitPage = new GaitAnalysisPage(gaitWrap, assessment);
  }, { capture: true });
}

// ── 4. Wire form ns-* inputs → main skeleton joint pain ──────────
function _wireFormInputs() {
  const FIELD_MAP = {
    'ns-ankle-df-l': { joint: 'LeftAnkle',    norm: 10,  invert: true },
    'ns-ankle-df-r': { joint: 'RightAnkle',   norm: 10,  invert: true },
    'ns-hip-ir-l':   { joint: 'LeftHip',      norm: 35,  invert: true },
    'ns-hip-ir-r':   { joint: 'RightHip',     norm: 35,  invert: true },
    'ns-hip-er-l':   { joint: 'LeftHip',      norm: 45,  invert: true },
    'ns-hip-er-r':   { joint: 'RightHip',     norm: 45,  invert: true },
    'ns-hip-ext-l':  { joint: 'LeftHip',      norm: 10,  invert: true },
    'ns-hip-ext-r':  { joint: 'RightHip',     norm: 10,  invert: true },
    'ns-hip-flex-l': { joint: 'LeftHip',      norm: 120, invert: false },
    'ns-hip-flex-r': { joint: 'RightHip',     norm: 120, invert: false },
    'ns-sh-ir-l':    { joint: 'LeftShoulder', norm: 70,  invert: true },
    'ns-sh-ir-r':    { joint: 'RightShoulder',norm: 70,  invert: true },
    'ns-sh-er-l':    { joint: 'LeftShoulder', norm: 80,  invert: false },
    'ns-sh-er-r':    { joint: 'RightShoulder',norm: 80,  invert: false },
    'ns-sh-flex-l':  { joint: 'LeftShoulder', norm: 160, invert: false },
    'ns-sh-flex-r':  { joint: 'RightShoulder',norm: 160, invert: false },
    'ns-bal-eo-l':   { joint: 'LeftAnkle',    norm: 30,  invert: true },
    'ns-bal-eo-r':   { joint: 'RightAnkle',   norm: 30,  invert: true },
  };

  const applyField = (fieldId, { joint, norm, invert }) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const handler = () => {
      if (!mainSkeleton) return;
      const v = parseFloat(el.value);
      if (isNaN(v)) return;
      const ratio  = invert ? Math.max(0, norm - v) / norm : Math.max(0, v / norm);
      const pain   = Math.min(10, Math.round(ratio * 10));
      const color  = painToColor(pain);
      mainSkeleton.setJointPain(joint, pain, color);
      if (!assessStore[joint]) assessStore[joint] = {};
      assessStore[joint].pain_scale = pain;
      bus.emit('assess:fieldChange', { fieldId, jointKey: joint, value: v });
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  };

  Object.entries(FIELD_MAP).forEach(([id, cfg]) => applyField(id, cfg));

  // Select-based tests: sl_squat, sl_rdl, oh_squat → knee/hip/lumbar
  const SELECT_MAP = {
    'ns-sl-squat-l': { joint: 'LeftKnee',     painMap: { 0:10, 1:7, 2:4, 3:1 } },
    'ns-sl-squat-r': { joint: 'RightKnee',    painMap: { 0:10, 1:7, 2:4, 3:1 } },
    'ns-sl-rdl-l':   { joint: 'LeftHip',      painMap: { 0:10, 1:7, 2:4, 3:1 } },
    'ns-sl-rdl-r':   { joint: 'RightHip',     painMap: { 0:10, 1:7, 2:4, 3:1 } },
    'ns-oh-squat':   { joint: 'LumbarSpine',  painMap: { 0:10, 1:7, 2:4, 3:1 } },
  };

  Object.entries(SELECT_MAP).forEach(([id, { joint, painMap }]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      if (!mainSkeleton) return;
      const v     = parseInt(el.value);
      const pain  = painMap[v] ?? 0;
      const color = painToColor(pain);
      mainSkeleton.setJointPain(joint, pain, color);
    });
  });

  // Checkbox spine pain flags
  const CHECKBOX_MAP = {
    'ns-sp-flex-pain':  'LumbarSpine',
    'ns-sp-ext-pain':   'LumbarSpine',
    'ns-sp-lfl-pain':   'LumbarSpine',
    'ns-sp-lfr-pain':   'LumbarSpine',
    'ns-sp-rotl-pain':  'ThoracicSpine',
    'ns-sp-rotr-pain':  'ThoracicSpine',
  };

  Object.entries(CHECKBOX_MAP).forEach(([id, joint]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      if (!mainSkeleton) return;
      const pain  = el.checked ? 8 : 0;
      const color = painToColor(pain);
      mainSkeleton.setJointPain(joint, pain, color);
    });
  });
}

// ── 5. Right-side joint info bar in dashboard ─────────────────────
function _wireJointInfoBar() {
  // The existing #bodymap-joint-name-dashboard and controls still exist in HTML.
  // We update them from bus events so the right side stays useful.
  const painSlider = document.getElementById('joint-pain-slider-dashboard');
  const painValEl  = document.getElementById('joint-pain-val-dashboard');

  if (painSlider) {
    painSlider.addEventListener('input', () => {
      if (!mainSkeleton || !mainCanvas?._activeKey) return;
      const v     = parseFloat(painSlider.value);
      const color = painToColor(v);
      mainSkeleton.setJointPain(mainCanvas._activeKey, v, color);
      if (painValEl) painValEl.textContent = v;
      if (!assessStore[mainCanvas._activeKey]) assessStore[mainCanvas._activeKey] = {};
      assessStore[mainCanvas._activeKey].pain_scale = v;
    });
  }
}

function _updateInfoBar(jointKey) {
  const nameEl     = document.getElementById('bodymap-joint-name-dashboard');
  const controlsEl = document.getElementById('bodymap-joint-controls-dashboard');
  const painSlider = document.getElementById('joint-pain-slider-dashboard');
  const painValEl  = document.getElementById('joint-pain-val-dashboard');

  if (nameEl) nameEl.textContent = JOINT_LABELS[jointKey] ?? jointKey;
  if (controlsEl) controlsEl.classList.remove('hidden');

  const existing = assessStore[jointKey]?.pain_scale ?? 0;
  if (painSlider) painSlider.value = existing;
  if (painValEl)  painValEl.textContent = existing;
}

function _clearInfoBar() {
  const nameEl     = document.getElementById('bodymap-joint-name-dashboard');
  const controlsEl = document.getElementById('bodymap-joint-controls-dashboard');
  if (nameEl) nameEl.textContent = 'Click a joint';
  if (controlsEl) controlsEl.classList.add('hidden');
}

let _hoverLabelEl = null;
function _showHoverLabel(jointKey) {
  if (!_hoverLabelEl) {
    _hoverLabelEl = document.createElement('div');
    _hoverLabelEl.style.cssText = `
      position:absolute;bottom:12px;left:50%;transform:translateX(-50%);
      background:rgba(0,212,255,0.12);border:0.5px solid rgba(0,212,255,0.35);
      color:#00D4FF;font-size:11px;font-weight:500;letter-spacing:.06em;
      padding:5px 14px;border-radius:99px;pointer-events:none;z-index:50;
      backdrop-filter:blur(8px);white-space:nowrap;
    `;
    document.getElementById('bodymap-dashboard-container')?.appendChild(_hoverLabelEl);
  }
  _hoverLabelEl.textContent = JOINT_LABELS[jointKey] ?? jointKey;
  _hoverLabelEl.style.opacity = '1';
}

function _clearHoverLabel() {
  if (_hoverLabelEl) _hoverLabelEl.style.opacity = '0';
}

// ── 6. Collect full assessment from form ─────────────────────────
function _collectAssessment() {
  const g = id => {
    const el = document.getElementById(id);
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    const v = el.value;
    if (!v) return undefined;
    const n = parseFloat(v);
    return isNaN(n) ? v : n;
  };

  return {
    ankle_dorsiflexion_left_cm:  g('ns-ankle-df-l'),
    ankle_dorsiflexion_right_cm: g('ns-ankle-df-r'),
    ankle_pronation_left:        g('ns-pronation-l') === 'over' ? 15 : 5,
    ankle_pronation_right:       g('ns-pronation-r') === 'over' ? 15 : 5,
    ankle_supination_left:       g('ns-supination-l') === 'stuck' ? 15 : 5,
    ankle_supination_right:      g('ns-supination-r') === 'stuck' ? 15 : 5,
    hip_ir_left:       g('ns-hip-ir-l'),
    hip_ir_right:      g('ns-hip-ir-r'),
    hip_extension_left:  g('ns-hip-ext-l'),
    hip_extension_right: g('ns-hip-ext-r'),
    hip_flexion_left:  g('ns-hip-flex-l'),
    hip_flexion_right: g('ns-hip-flex-r'),
    sl_squat_l: g('ns-sl-squat-l') != null ? parseInt(g('ns-sl-squat-l')) : undefined,
    sl_squat_r: g('ns-sl-squat-r') != null ? parseInt(g('ns-sl-squat-r')) : undefined,
    bal_eo_l:   g('ns-bal-eo-l'),
    bal_eo_r:   g('ns-bal-eo-r'),
    bal_ec_l:   g('ns-bal-ec-l'),
    bal_ec_r:   g('ns-bal-ec-r'),
    oh_squat_forward_lean: (g('ns-oh-squat') != null ? parseInt(g('ns-oh-squat')) <= 1 : false),
    sl_rdl_trunk_rotation: !!(g('ns-sl-rdl-rotation')),
    sh_ir_left:  g('ns-sh-ir-l'),
    sh_ir_right: g('ns-sh-ir-r'),
    sp_flex_pain: !!(document.getElementById('ns-sp-flex-pain')?.checked),
    sp_ext_pain:  !!(document.getElementById('ns-sp-ext-pain')?.checked),
    sp_rotl_pain: !!(document.getElementById('ns-sp-rotl-pain')?.checked),
    sp_rotr_pain: !!(document.getElementById('ns-sp-rotr-pain')?.checked),
    joint_data: { ...assessStore },
  };
}
