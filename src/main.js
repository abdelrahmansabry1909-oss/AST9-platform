// src/main.js
// NeuCore ES module entry point.
// Wires: BodyCanvas + SkeletonBuilder + AssessSync (Step 22)
//        Generate button → GaitAnalysisPage            (Step 23)

import { BodyCanvas }       from './neucore/core/BodyCanvas.js';
import { SkeletonBuilder }  from './neucore/skeleton/SkeletonBuilder.js';
import { AssessSync }       from './neucore/core/AssessSync.js';
import { FXLayer }          from './neucore/core/FXLayer.js';
import { GaitAnalysisPage } from './neucore/gait/GaitAnalysisPage.js';

let bodyCanvas = null;
let skeleton   = null;
let assessSync = null;
let gaitPage   = null;

// ── Step 22: Init 3D skeleton in the objective-tab sidebar ──────
function initBodyCanvas() {
  const wrap = document.getElementById('neucore-body-canvas');
  if (!wrap) return;

  bodyCanvas = new BodyCanvas(wrap);
  skeleton   = new SkeletonBuilder(bodyCanvas.scene);
  skeleton.build();

  const fx = new FXLayer(bodyCanvas, skeleton);
  bodyCanvas._skeleton = skeleton;
  bodyCanvas._fxLayer  = fx;

  // Wire form → skeleton via AssessSync
  const form = document.getElementById('tab-objective');
  assessSync = new AssessSync(skeleton, form);
}

// ── Step 23: Wire Generate button → GaitAnalysisPage ───────────
function initGenerateButton() {
  const btn = document.getElementById('generate-btn');
  if (!btn) return;

  btn.addEventListener('click', (e) => {
    // Don't prevent default — let the existing Dashboard.generateProgram() run too
    const assessment = _collectAssessment();
    const gaitWrap   = document.getElementById('neucore-gait-container');
    if (!gaitWrap) return;

    // Show the container
    gaitWrap.classList.remove('hidden');
    gaitWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Destroy previous page if any
    gaitPage?.destroy();
    gaitPage = new GaitAnalysisPage(gaitWrap, assessment);
  }, { capture: true }); // capture so we fire before the onclick handler
}

// ── Collect assessment values from form ns-* IDs ────────────────
function _collectAssessment() {
  const get = id => {
    const el = document.getElementById(id);
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    const v = el.value;
    if (v === '' || v == null) return undefined;
    const n = parseFloat(v);
    return isNaN(n) ? v : n;
  };

  return {
    // Ankle / DF
    ankle_dorsiflexion_left_cm:  get('ns-ankle-df-l'),
    ankle_dorsiflexion_right_cm: get('ns-ankle-df-r'),
    ankle_pronation_left:        get('ns-pronation-l') === 'over' ? 15 : 5,
    ankle_pronation_right:       get('ns-pronation-r') === 'over' ? 15 : 5,
    ankle_supination_left:       get('ns-supination-l') === 'stuck' ? 15 : 5,
    ankle_supination_right:      get('ns-supination-r') === 'stuck' ? 15 : 5,

    // Hip
    hip_ir_left:       get('ns-hip-ir-l'),
    hip_ir_right:      get('ns-hip-ir-r'),
    hip_er_left:       get('ns-hip-er-l'),
    hip_er_right:      get('ns-hip-er-r'),
    hip_extension_left:  get('ns-hip-ext-l'),
    hip_extension_right: get('ns-hip-ext-r'),
    hip_flexion_left:  get('ns-hip-flex-l'),
    hip_flexion_right: get('ns-hip-flex-r'),

    // Single-leg tests
    sl_squat_l:        get('ns-sl-squat-l') != null ? parseInt(get('ns-sl-squat-l')) : undefined,
    sl_squat_r:        get('ns-sl-squat-r') != null ? parseInt(get('ns-sl-squat-r')) : undefined,
    sl_rdl_l:          get('ns-sl-rdl-l')   != null ? parseInt(get('ns-sl-rdl-l'))   : undefined,
    sl_rdl_r:          get('ns-sl-rdl-r')   != null ? parseInt(get('ns-sl-rdl-r'))   : undefined,

    // Balance
    bal_eo_l: get('ns-bal-eo-l'),
    bal_eo_r: get('ns-bal-eo-r'),
    bal_ec_l: get('ns-bal-ec-l'),
    bal_ec_r: get('ns-bal-ec-r'),

    // Overhead squat
    oh_squat_forward_lean: get('ns-oh-squat-forward-lean') ?? get('ns-oh-squat') != null ? (parseInt(get('ns-oh-squat')) <= 1) : false,

    // SL RDL trunk rotation
    sl_rdl_trunk_rotation: get('ns-sl-rdl-rotation') === 'true' || get('ns-sl-rdl-rotation') === true,

    // Shoulder
    sh_ir_left:  get('ns-sh-ir-l'),
    sh_ir_right: get('ns-sh-ir-r'),

    // Spine pain flags
    sp_flex_pain: !!(document.getElementById('ns-sp-flex-pain')?.checked),
    sp_ext_pain:  !!(document.getElementById('ns-sp-ext-pain')?.checked),
    sp_rotl_pain: !!(document.getElementById('ns-sp-rotl-pain')?.checked),
    sp_rotr_pain: !!(document.getElementById('ns-sp-rotr-pain')?.checked),

    // Joint data map for skeleton pain overlay
    joint_data: {},
  };
}

// ── Bootstrap on DOMContentLoaded ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Objective tab might not be visible yet — init body canvas lazily
  // when the Objective tab is activated
  const objTabBtn = document.querySelector('[data-tab="tab-objective"]');
  if (objTabBtn) {
    objTabBtn.addEventListener('click', () => {
      if (!bodyCanvas) initBodyCanvas();
    });
  }
  // Also init immediately if the tab is already active
  if (document.getElementById('tab-objective')?.classList.contains('active')) {
    initBodyCanvas();
  }

  initGenerateButton();
});
