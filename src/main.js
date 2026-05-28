// src/main.js
// NeuCore ES module entry point.
// Takes over #bodymap-dashboard-container with the full holographic skeleton,
// wires assessment form inputs to joint colors, and powers the Generate flow.

import * as THREE from 'three';
import { BodyCanvas }       from './neucore/core/BodyCanvas.js';
import { GLBSkeleton }      from './neucore/skeleton/GLBSkeleton.js';
import { ObjectiveSync }    from './neucore/core/ObjectiveSync.js';
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
let objectiveSync = null; // two-way bind: Objective form ↔ 3D body map

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  objectiveSync = new ObjectiveSync(assessStore);
  _initMainSkeleton();
  _initObjectiveSidebar();
  _initGenerateButton();
  _wireJointInfoBar();
});

// ── Loading overlay for the async glTF skeleton ──────────────────
function _skeletonLoader(text) {
  const el = document.createElement('div');
  el.className = 'nc-skeleton-loader';
  el.style.cssText = `
    position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    flex-direction:column;gap:14px;z-index:40;pointer-events:none;
    color:#67E8F9;font-size:12px;letter-spacing:.14em;text-transform:uppercase;
    font-family:'Space Grotesk',system-ui,sans-serif;`;
  el.innerHTML = `
    <div style="width:34px;height:34px;border:2px solid rgba(103,232,249,.18);
      border-top-color:#67E8F9;border-radius:50%;animation:nc-spin 0.9s linear infinite;"></div>
    <div>${text || 'Loading anatomy'}</div>`;
  if (!document.getElementById('nc-spin-kf')) {
    const kf = document.createElement('style');
    kf.id = 'nc-spin-kf';
    kf.textContent = '@keyframes nc-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(kf);
  }
  return el;
}

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
  wrap.style.position = 'relative';

  mainCanvas = new BodyCanvas(wrap);

  // Sync joint:select → update right-side info bar (skeleton-independent)
  bus.on('joint:select', ({ jointKey }) => _updateInfoBar(jointKey));
  bus.on('joint:deselect', () => _clearInfoBar());
  bus.on('joint:hover',    ({ jointKey }) => _showHoverLabel(jointKey));
  bus.on('joint:hoverout', () => _clearHoverLabel());

  // Load the real anatomical skeleton (glTF) asynchronously.
  const loader = _skeletonLoader('Loading anatomy');
  wrap.appendChild(loader);

  mainSkeleton = new GLBSkeleton(mainCanvas.scene);
  mainSkeleton.build()
    .then(() => {
      loader.remove();
      mainFX = new FXLayer(mainCanvas, mainSkeleton);
      mainCanvas._skeleton = mainSkeleton;
      mainCanvas._fxLayer  = mainFX;
      // Assessment pop-out panels live inside the 3D container
      assessPanel = new AssessmentPanel(wrap, mainSkeleton, assessStore);
    })
    .catch((err) => {
      console.error('[NeuCore] skeleton load failed:', err);
      loader.innerHTML = '<div style="color:#FF6B6B;font-size:12px;">3D anatomy failed to load</div>';
    });

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
    sideWrap.style.position = 'relative';
    sideCanvas = new BodyCanvas(sideWrap);

    const loader = _skeletonLoader('Loading anatomy');
    sideWrap.appendChild(loader);

    const sideSkel = new GLBSkeleton(sideCanvas.scene);
    sideSkel.build()
      .then(() => {
        loader.remove();
        const sideFX = new FXLayer(sideCanvas, sideSkel);
        sideCanvas._skeleton = sideSkel;
        sideCanvas._fxLayer  = sideFX;
        new AssessmentPanel(sideWrap, sideSkel, assessStore);
        // Two-way bind the Objective form to this body map.
        if (objectiveSync) objectiveSync.setSkeleton(sideSkel);
      })
      .catch((err) => {
        console.error('[NeuCore] objective skeleton load failed:', err);
        loader.innerHTML = '<div style="color:#FF6B6B;font-size:12px;">3D anatomy failed to load</div>';
      });

    // Keep the main dashboard skeleton in sync with assessment changes
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

// ── 4. Right-side joint info bar in dashboard ─────────────────────
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
      _setPainDisplay(painValEl, v, color);
      if (!assessStore[mainCanvas._activeKey]) assessStore[mainCanvas._activeKey] = {};
      assessStore[mainCanvas._activeKey].pain_scale = v;
    });
  }
}

function _setPainDisplay(el, value, color) {
  if (!el) return;
  el.textContent = value;
  el.style.color = color ?? '#00D4FF';
  el.style.textShadow = color ? `0 0 8px ${color}88` : '';
}

function _updateInfoBar(jointKey) {
  const nameEl     = document.getElementById('bodymap-joint-name-dashboard');
  const controlsEl = document.getElementById('bodymap-joint-controls-dashboard');
  const painSlider = document.getElementById('joint-pain-slider-dashboard');
  const painValEl  = document.getElementById('joint-pain-val-dashboard');

  if (nameEl) {
    nameEl.textContent = JOINT_LABELS[jointKey] ?? jointKey;
    nameEl.style.color = '#00D4FF';
  }
  if (controlsEl) controlsEl.classList.remove('hidden');

  const existing = assessStore[jointKey]?.pain_scale ?? 0;
  const color    = painToColor(existing);
  if (painSlider) painSlider.value = existing;
  _setPainDisplay(painValEl, existing, existing > 0 ? color : null);
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
