// ═══════════════════════════════════════════════════════════════
//  js/bodyMap3D.js
//  Interactive 3D Body Map — Three.js + Fallback Canvas
//  Bidirectional sync with assessment form.
//  Lazy-initialised: only runs when #bodymap-container is visible.
// ═══════════════════════════════════════════════════════════════

const BodyMap3D = (() => {

  // ── PAIN COLOUR SCALE (1–10, clinically defined) ──────────
  const PAIN_COLORS = {
    0:  '#3df5c1',   // teal  — healthy / unassessed
    1:  '#4ade80',   // green
    2:  '#86efac',
    3:  '#facc15',   // yellow — mild
    4:  '#fde047',
    5:  '#fb923c',   // orange — moderate
    6:  '#f97316',
    7:  '#ef4444',   // red — severe
    8:  '#dc2626',
    9:  '#7f1d1d',   // dark red — critical
    10: '#3f0d0d',
  };

  // ── JOINT → FORM FIELD MAPPING ────────────────────────────
  // Maps each 3D joint key to the assessment form inputs it should
  // populate / read from when clicked.
  const JOINT_FIELDS = {
    left_hip:        { lr: 'L', keys: ['ns-hip-ir-l','ns-hip-er-l','ns-hip-flex-l','ns-hip-ext-l'], label: 'Left Hip',         norm: 'hip_ir', normVal: 35 },
    right_hip:       { lr: 'R', keys: ['ns-hip-ir-r','ns-hip-er-r','ns-hip-flex-r','ns-hip-ext-r'], label: 'Right Hip',        norm: 'hip_ir', normVal: 35 },
    left_knee:       { lr: 'L', keys: [],                                                            label: 'Left Knee',        norm: null,      normVal: null },
    right_knee:      { lr: 'R', keys: [],                                                            label: 'Right Knee',       norm: null,      normVal: null },
    left_ankle:      { lr: 'L', keys: ['ns-ankle-df-l'],                                            label: 'Left Ankle',       norm: 'ankle_df',normVal: 10 },
    right_ankle:     { lr: 'R', keys: ['ns-ankle-df-r'],                                            label: 'Right Ankle',      norm: 'ankle_df',normVal: 10 },
    left_shoulder:   { lr: 'L', keys: ['ns-sh-flex-l','ns-sh-ir-l','ns-sh-er-l'],                  label: 'Left Shoulder',    norm: 'shoulder_ir', normVal: 70 },
    right_shoulder:  { lr: 'R', keys: ['ns-sh-flex-r','ns-sh-ir-r','ns-sh-er-r'],                  label: 'Right Shoulder',   norm: 'shoulder_ir', normVal: 70 },
    lumbar_spine:    { lr: null,keys: ['ns-sp-flex','ns-sp-ext'],                                   label: 'Lumbar Spine',     norm: null,      normVal: null },
    thoracic_spine:  { lr: null,keys: ['ns-sp-rotl','ns-sp-rotr'],                                 label: 'Thoracic Spine',   norm: null,      normVal: null },
    left_foot:       { lr: 'L', keys: [],                                                            label: 'Left Foot',        norm: null,      normVal: null },
    right_foot:      { lr: 'R', keys: [],                                                            label: 'Right Foot',       norm: null,      normVal: null },
  };

  // ── STATE ─────────────────────────────────────────────────
  let scene, camera, renderer, controls, raycaster, mouse;
  let jointMeshes  = {};   // jointKey → THREE.Mesh
  let jointStates  = {};   // jointKey → { pain_scale, label }
  let onClickCb    = null;
  let container    = null;
  let animId       = null;
  let hoveredMesh  = null;
  let gaitAnimId   = null;
  let gaitPhaseIdx = 0;
  let _inited      = false;

  const GAIT_SEQ = ['loading_response','mid_stance','terminal_stance',
                    'pre_swing','initial_swing','mid_swing','terminal_swing'];

  // ── PUBLIC INIT ───────────────────────────────────────────
  function init(containerId, options = {}) {
    container = document.getElementById(containerId);
    if (!container || _inited) return;

    onClickCb = options.onJointClick || null;

    // Check WebGL support
    if (!_webglAvailable()) {
      _renderFallbackSVG();
      _inited = true;
      return;
    }

    _initThree();
    _buildFallbackBody();   // immediate geometry — no external GLB needed
    _inited = true;

    // Load GLB if provided (optional)
    if (options.modelUrl) _loadGLTF(options.modelUrl);
  }

  // ── THREE.JS INIT ─────────────────────────────────────────
  function _initThree() {
    const w = container.clientWidth  || 400;
    const h = container.clientHeight || 520;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d12);

    camera = new THREE.PerspectiveCamera(42, w / h, 0.01, 100);
    camera.position.set(0, 1.1, 3.2);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x3df5c1, 0.25);
    rim.position.set(-4, 3, -3);
    scene.add(rim);

    const fill = new THREE.HemisphereLight(0x222840, 0x080b12, 0.6);
    scene.add(fill);

    // Controls
    const _OrbitCtrl = THREE.OrbitControls || window.OrbitControls;
    if (_OrbitCtrl) {
      controls = new _OrbitCtrl(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor  = 0.06;
      controls.minDistance    = 1;
      controls.maxDistance    = 7;
      controls.target.set(0, 1.0, 0);
    }

    raycaster = new THREE.Raycaster();
    mouse     = new THREE.Vector2();

    renderer.domElement.addEventListener('click',     _onClick);
    renderer.domElement.addEventListener('mousemove', _onHover);
    window.addEventListener('resize', _onResize);

    _animate();
  }

  // ── FALLBACK BODY (pure Three.js geometry — no external file) ──
  function _buildFallbackBody() {
    const baseMat = () => new THREE.MeshLambertMaterial({
      color: 0x1e2535, transparent: true, opacity: 0.88
    });

    const bodyParts = {
      head:           { geo: new THREE.SphereGeometry(0.11, 20, 20),           pos: [0,    1.82, 0] },
      neck:           { geo: new THREE.CylinderGeometry(0.04,0.05,0.1,12),     pos: [0,    1.67, 0] },
      torso_upper:    { geo: new THREE.CylinderGeometry(0.16,0.14,0.28,16),    pos: [0,    1.44, 0] },
      torso_lower:    { geo: new THREE.CylinderGeometry(0.13,0.10,0.2,16),     pos: [0,    1.14, 0] },
      pelvis:         { geo: new THREE.SphereGeometry(0.11, 14, 14),           pos: [0,    0.98, 0] },

      // Left arm chain
      left_shoulder:  { geo: new THREE.SphereGeometry(0.06,14,14),             pos: [-0.22,1.55, 0] },
      left_upper_arm: { geo: new THREE.CylinderGeometry(0.04,0.035,0.24,10),   pos: [-0.27,1.32, 0] },
      left_elbow:     { geo: new THREE.SphereGeometry(0.038,10,10),            pos: [-0.28,1.19, 0] },
      left_forearm:   { geo: new THREE.CylinderGeometry(0.033,0.028,0.20,10),  pos: [-0.29,1.03, 0] },

      // Right arm chain
      right_shoulder: { geo: new THREE.SphereGeometry(0.06,14,14),             pos: [0.22, 1.55, 0] },
      right_upper_arm:{ geo: new THREE.CylinderGeometry(0.04,0.035,0.24,10),   pos: [0.27, 1.32, 0] },
      right_elbow:    { geo: new THREE.SphereGeometry(0.038,10,10),            pos: [0.28, 1.19, 0] },
      right_forearm:  { geo: new THREE.CylinderGeometry(0.033,0.028,0.20,10),  pos: [0.29, 1.03, 0] },

      // Left leg chain
      left_hip:       { geo: new THREE.SphereGeometry(0.07,14,14),             pos: [-0.13,0.92, 0] },
      left_thigh:     { geo: new THREE.CylinderGeometry(0.055,0.048,0.34,12),  pos: [-0.13,0.70, 0] },
      left_knee:      { geo: new THREE.SphereGeometry(0.05,14,14),             pos: [-0.13,0.50, 0] },
      left_shin:      { geo: new THREE.CylinderGeometry(0.038,0.030,0.3,12),   pos: [-0.13,0.30, 0] },
      left_ankle:     { geo: new THREE.SphereGeometry(0.04,12,12),             pos: [-0.13,0.10, 0] },
      left_foot:      { geo: new THREE.BoxGeometry(0.07,0.04,0.14),            pos: [-0.13,0.02, 0.04] },

      // Right leg chain
      right_hip:      { geo: new THREE.SphereGeometry(0.07,14,14),             pos: [0.13, 0.92, 0] },
      right_thigh:    { geo: new THREE.CylinderGeometry(0.055,0.048,0.34,12),  pos: [0.13, 0.70, 0] },
      right_knee:     { geo: new THREE.SphereGeometry(0.05,14,14),             pos: [0.13, 0.50, 0] },
      right_shin:     { geo: new THREE.CylinderGeometry(0.038,0.030,0.3,12),   pos: [0.13, 0.30, 0] },
      right_ankle:    { geo: new THREE.SphereGeometry(0.04,12,12),             pos: [0.13, 0.10, 0] },
      right_foot:     { geo: new THREE.BoxGeometry(0.07,0.04,0.14),            pos: [0.13, 0.02, 0.04] },

      // Spine
      lumbar_spine:   { geo: new THREE.BoxGeometry(0.07,0.12,0.06),            pos: [0,    1.08, -0.02] },
      thoracic_spine: { geo: new THREE.BoxGeometry(0.07,0.18,0.06),            pos: [0,    1.35, -0.02] },
    };

    Object.entries(bodyParts).forEach(([key, { geo, pos }]) => {
      const mat  = baseMat();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...pos);
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      mesh.userData.jointKey  = key;
      mesh.userData.baseColor = 0x1e2535;
      scene.add(mesh);

      if (JOINT_FIELDS[key]) {
        jointMeshes[key] = mesh;
        jointStates[key] = { pain_scale: 0, label: JOINT_FIELDS[key].label };
      }
    });

    // Grid floor
    const grid = new THREE.GridHelper(4, 20, 0x1a2030, 0x1a2030);
    scene.add(grid);
  }

  // ── OPTIONAL GLB LOADER ───────────────────────────────────
  function _loadGLTF(url) {
    if (!THREE.GLTFLoader) return;
    const loader = new THREE.GLTFLoader();

    if (THREE.DRACOLoader) {
      const draco = new THREE.DRACOLoader();
      draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
      loader.setDRACOLoader(draco);
    }

    loader.load(url,
      gltf => {
        // Clear fallback body
        Object.values(jointMeshes).forEach(m => scene.remove(m));
        jointMeshes = {};

        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          child.castShadow = child.receiveShadow = true;

          Object.keys(JOINT_FIELDS).forEach(jk => {
            const aliases = [
              jk, jk.replace('_', '.'), jk.replace('left_','L_'), jk.replace('right_','R_'),
              jk.toUpperCase(), jk.replace(/_/g,''),
            ];
            if (aliases.some(a => child.name.toLowerCase().includes(a.toLowerCase()))) {
              jointMeshes[jk] = child;
              child.userData.jointKey = jk;
            }
          });
        });

        scene.add(gltf.scene);
        // Re-apply saved states
        Object.entries(jointStates).forEach(([k, s]) => applyPainColor(k, s.pain_scale));
      },
      null,
      err => console.warn('GLB load failed — using geometric body:', err)
    );
  }

  // ── PAIN COLOUR APPLICATION ───────────────────────────────
  function applyPainColor(jointKey, painScale) {
    const mesh = jointMeshes[jointKey];
    if (!mesh) return;
    const clamped = Math.max(0, Math.min(10, Math.round(painScale)));
    const hex     = PAIN_COLORS[clamped];
    const color   = new THREE.Color(hex);
    if (mesh.material) {
      mesh.material.color          = color;
      mesh.material.emissive       = color;
      mesh.material.emissiveIntensity = clamped > 6 ? 0.35 : clamped > 3 ? 0.15 : 0.0;
    }
  }

  // ── UPDATE FROM ASSESSMENT (Form → 3D) ───────────────────
  function updateFromAssessment(assessment) {
    const a = assessment;

    // Score-to-visual conversion (0=normal, 10=pain)
    const toVis = (val, norm) => {
      if (val == null || val < 0) return val === -1 ? 10 : 0;
      const ratio = val / norm;
      if (ratio >= 1) return 1;
      if (ratio >= 0.8) return 3;
      if (ratio >= 0.6) return 5;
      if (ratio >= 0.4) return 7;
      return 9;
    };

    const spineScore = (pain, rangeTxt) => {
      if (pain) return 7;
      if (rangeTxt && rangeTxt.toLowerCase().includes('limit')) return 4;
      return 1;
    };

    const mappings = {
      left_hip:       toVis(a.hip_ir_l,   35),
      right_hip:      toVis(a.hip_ir_r,   35),
      left_ankle:     toVis(a.ankle_df_l, 10),
      right_ankle:    toVis(a.ankle_df_r, 10),
      left_shoulder:  toVis(a.sh_ir_l,    70),
      right_shoulder: toVis(a.sh_ir_r,    70),
      lumbar_spine:   spineScore(a.sp_flex_pain  || a.sp_ext_pain,  a.sp_flex_range),
      thoracic_spine: spineScore(a.sp_rotl_pain  || a.sp_rotr_pain, a.sp_rotl_range),
      left_knee:      (a.sl_squat_l != null && a.sl_squat_l <= 1) ? 7 : 1,
      right_knee:     (a.sl_squat_r != null && a.sl_squat_r <= 1) ? 7 : 1,
      left_foot:      (a.pronation_l && a.pronation_l.toLowerCase().includes('over')) ? 5 : 1,
      right_foot:     (a.pronation_r && a.pronation_r.toLowerCase().includes('over')) ? 5 : 1,
    };

    Object.entries(mappings).forEach(([key, pain]) => {
      jointStates[key] = { ...(jointStates[key] || {}), pain_scale: pain };
      applyPainColor(key, pain);
    });
  }

  // ── SET JOINT DIRECTLY ───────────────────────────────────
  function setJoint(jointKey, painScale, meta = {}) {
    if (!JOINT_FIELDS[jointKey]) return;
    jointStates[jointKey] = { pain_scale: painScale, ...meta };
    applyPainColor(jointKey, painScale);
  }

  // ── RESET ALL ─────────────────────────────────────────────
  function resetAll() {
    Object.keys(jointMeshes).forEach(k => {
      jointStates[k] = { pain_scale: 0 };
      applyPainColor(k, 0);
    });
  }

  // ── MOUSE HANDLERS ────────────────────────────────────────
  function _onClick(e) {
    _setMouse(e);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    if (!hits.length) return;
    const obj = hits[0].object;
    const jk  = obj.userData?.jointKey;
    if (!jk || !JOINT_FIELDS[jk]) return;

    const state = jointStates[jk] || { pain_scale: 0 };
    if (onClickCb) {
      onClickCb(jk, JOINT_FIELDS[jk], state);
    } else {
      _openJointModal(jk, JOINT_FIELDS[jk], state);
    }
  }

  function _onHover(e) {
    _setMouse(e);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(scene.children, true);

    if (hoveredMesh) {
      const jk = hoveredMesh.userData.jointKey;
      const ps = jointStates[jk]?.pain_scale || 0;
      if (hoveredMesh.material) {
        hoveredMesh.material.emissiveIntensity = ps > 6 ? 0.35 : ps > 3 ? 0.15 : 0.0;
      }
      hoveredMesh = null;
    }

    if (hits.length && hits[0].object.userData.jointKey) {
      hoveredMesh = hits[0].object;
      if (hoveredMesh.material) hoveredMesh.material.emissiveIntensity = 0.6;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      renderer.domElement.style.cursor = 'grab';
    }
  }

  function _setMouse(e) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    mouse.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
  }

  // ── BUILT-IN JOINT CLICK MODAL (no external dependency) ──
  function _openJointModal(jk, fieldMeta, state) {
    // Remove old modal if exists
    document.getElementById('joint-modal')?.remove();

    const colors = Object.entries(PAIN_COLORS).map(([score, hex]) => `
      <button onclick="BodyMap3D.setJoint('${jk}',${score});document.getElementById('joint-modal-slider').value=${score};document.getElementById('joint-modal-val').textContent=${score}"
        style="width:24px;height:24px;border-radius:50%;background:${hex};border:${parseInt(score)===Math.round(state.pain_scale)?'3px solid white':'2px solid transparent'};cursor:pointer"></button>
    `).join('');

    const modal = document.createElement('div');
    modal.id = 'joint-modal';
    modal.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9990;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:16px;padding:24px;min-width:300px;box-shadow:0 24px 80px rgba(0,0,0,0.7)`;

    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-family:var(--font-display);font-size:17px;font-weight:700">${fieldMeta.label}</div>
        <button onclick="document.getElementById('joint-modal').remove()" style="background:none;border:none;color:var(--text-secondary);font-size:18px;cursor:pointer">✕</button>
      </div>
      <div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">Pain Scale</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px">${colors}</div>
      <input id="joint-modal-slider" type="range" min="0" max="10" value="${Math.round(state.pain_scale)}"
        style="width:100%;accent-color:var(--lime);margin-bottom:8px"
        oninput="document.getElementById('joint-modal-val').textContent=this.value;BodyMap3D.setJoint('${jk}',parseInt(this.value))"/>
      <div style="text-align:center;font-family:var(--font-display);font-size:28px;font-weight:800;color:var(--lime)">
        <span id="joint-modal-val">${Math.round(state.pain_scale)}</span><span style="font-size:14px">/10</span>
      </div>
      ${fieldMeta.normVal ? `<div style="font-size:11px;color:var(--text-tertiary);text-align:center;margin-top:4px">Normative: ≥${fieldMeta.normVal}${fieldMeta.norm?.includes('df')?'cm':'°'}</div>` : ''}
      <button onclick="document.getElementById('joint-modal').remove()" class="btn btn-primary w-full" style="margin-top:14px">Apply</button>`;

    document.body.appendChild(modal);
    // Close on backdrop click
    document.addEventListener('click', function handler(e) {
      if (!modal.contains(e.target)) { modal.remove(); document.removeEventListener('click', handler); }
    }, { once: false });
  }

  // ── GAIT ANIMATION ────────────────────────────────────────
  function startGaitAnimation(phaseDeficiencies) {
    if (gaitAnimId) return;
    gaitPhaseIdx = 0;
    _gaitTick(phaseDeficiencies);
  }

  function _gaitTick(defs) {
    const phase = GAIT_SEQ[gaitPhaseIdx % GAIT_SEQ.length];
    const def   = defs[phase];

    if (def) {
      // Pulse affected joints red briefly
      const affectedKeys = Object.keys(jointMeshes).filter(jk => {
        const causes = def.causes || [];
        return causes.some(c =>
          (c.includes('hip')      && jk.includes('hip'))      ||
          (c.includes('ankle')    && jk.includes('ankle'))    ||
          (c.includes('spine')    && jk.includes('spine'))    ||
          (c.includes('shoulder') && jk.includes('shoulder')) ||
          (c.includes('knee')     && jk.includes('knee'))     ||
          (c.includes('foot')     && jk.includes('foot'))
        );
      });

      affectedKeys.forEach(jk => {
        const mesh = jointMeshes[jk];
        if (!mesh?.material) return;
        const origColor = new THREE.Color(PAIN_COLORS[jointStates[jk]?.pain_scale || 0]);
        mesh.material.color    = new THREE.Color(0xef4444);
        mesh.material.emissive = new THREE.Color(0xef4444);
        mesh.material.emissiveIntensity = 0.7;
        setTimeout(() => {
          if (mesh.material) {
            mesh.material.color    = origColor;
            mesh.material.emissive = origColor;
            mesh.material.emissiveIntensity = 0.1;
          }
        }, 350);
      });
    }

    gaitPhaseIdx++;
    gaitAnimId = setTimeout(() => _gaitTick(defs), 700);
  }

  function stopGaitAnimation() {
    if (gaitAnimId) { clearTimeout(gaitAnimId); gaitAnimId = null; }
  }

  // ── RENDER LOOP ───────────────────────────────────────────
  function _animate() {
    animId = requestAnimationFrame(_animate);
    if (controls?.update) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  // ── RESIZE ────────────────────────────────────────────────
  function _onResize() {
    if (!container || !renderer) return;
    const w = container.clientWidth  || 400;
    const h = container.clientHeight || 520;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  // ── WEBGL CHECK ───────────────────────────────────────────
  function _webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch(e) { return false; }
  }

  // ── 2D SVG FALLBACK (no WebGL) ────────────────────────────
  function _renderFallbackSVG() {
    container.innerHTML = `
    <div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:12px;letter-spacing:1px">2D body diagram (WebGL unavailable)</div>
      <svg viewBox="0 0 200 420" style="max-width:200px;height:auto" xmlns="http://www.w3.org/2000/svg">
        ${_svgBody()}
      </svg>
      <div id="bodymap-legend" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        ${Object.entries(PAIN_COLORS).filter(([k])=>[0,3,5,7,9].includes(+k)).map(([k,hex])=>`
          <span style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text-secondary)">
            <span style="width:10px;height:10px;border-radius:50%;background:${hex};display:inline-block"></span>
            ${k===0?'Healthy':k<=3?'Mild':k<=5?'Moderate':k<=7?'Severe':'Critical'}
          </span>`).join('')}
      </div>
    </div>`;

    _inited = true;
  }

  function _svgBody() {
    // Simple anatomical outline
    return `
    <style>
      .jt{cursor:pointer;transition:opacity .2s}
      .jt:hover{opacity:0.7;filter:brightness(1.3)}
    </style>
    <!-- Body outline -->
    <ellipse cx="100" cy="30"  rx="18" ry="20" fill="#1e2535" stroke="#2e3a50" stroke-width="1"/>
    <rect x="78" cy="58" y="52" width="44" height="55" rx="8" fill="#1e2535" stroke="#2e3a50" stroke-width="1"/>
    <rect x="82" y="108" width="36" height="38" rx="6" fill="#1e2535" stroke="#2e3a50" stroke-width="1"/>
    <!-- Left arm -->
    <rect x="57" y="56" width="18" height="52" rx="8" fill="#1e2535" stroke="#2e3a50" stroke-width="1"/>
    <!-- Right arm -->
    <rect x="125" y="56" width="18" height="52" rx="8" fill="#1e2535" stroke="#2e3a50" stroke-width="1"/>
    <!-- Left leg -->
    <rect x="78" y="148" width="18" height="70" rx="8" fill="#1e2535" stroke="#2e3a50" stroke-width="1"/>
    <rect x="78" y="220" width="18" height="60" rx="8" fill="#1e2535" stroke="#2e3a50" stroke-width="1"/>
    <!-- Right leg -->
    <rect x="104" y="148" width="18" height="70" rx="8" fill="#1e2535" stroke="#2e3a50" stroke-width="1"/>
    <rect x="104" y="220" width="18" height="60" rx="8" fill="#1e2535" stroke="#2e3a50" stroke-width="1"/>
    <!-- Joint circles (interactive) -->
    <circle class="jt" id="svg-left-shoulder"  cx="68"  cy="62"  r="10" fill="${PAIN_COLORS[0]}" onclick="BodyMap3D._svgJointClick('left_shoulder')"/>
    <circle class="jt" id="svg-right-shoulder" cx="132" cy="62"  r="10" fill="${PAIN_COLORS[0]}" onclick="BodyMap3D._svgJointClick('right_shoulder')"/>
    <circle class="jt" id="svg-lumbar-spine"   cx="100" cy="118" r="9"  fill="${PAIN_COLORS[0]}" onclick="BodyMap3D._svgJointClick('lumbar_spine')"/>
    <circle class="jt" id="svg-left-hip"       cx="87"  cy="150" r="10" fill="${PAIN_COLORS[0]}" onclick="BodyMap3D._svgJointClick('left_hip')"/>
    <circle class="jt" id="svg-right-hip"      cx="113" cy="150" r="10" fill="${PAIN_COLORS[0]}" onclick="BodyMap3D._svgJointClick('right_hip')"/>
    <circle class="jt" id="svg-left-knee"      cx="87"  cy="218" r="9"  fill="${PAIN_COLORS[0]}" onclick="BodyMap3D._svgJointClick('left_knee')"/>
    <circle class="jt" id="svg-right-knee"     cx="113" cy="218" r="9"  fill="${PAIN_COLORS[0]}" onclick="BodyMap3D._svgJointClick('right_knee')"/>
    <circle class="jt" id="svg-left-ankle"     cx="87"  cy="278" r="8"  fill="${PAIN_COLORS[0]}" onclick="BodyMap3D._svgJointClick('left_ankle')"/>
    <circle class="jt" id="svg-right-ankle"    cx="113" cy="278" r="8"  fill="${PAIN_COLORS[0]}" onclick="BodyMap3D._svgJointClick('right_ankle')"/>`;
  }

  function _svgJointClick(jk) {
    const fm = JOINT_FIELDS[jk];
    const st = jointStates[jk] || { pain_scale: 0 };
    _openJointModal(jk, fm, st);
  }

  // ── SNAPSHOT ──────────────────────────────────────────────
  function getSnapshot() {
    if (!renderer) return null;
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  // ── DESTROY ───────────────────────────────────────────────
  function destroy() {
    if (animId)     cancelAnimationFrame(animId);
    if (gaitAnimId) clearTimeout(gaitAnimId);
    window.removeEventListener('resize', _onResize);
    if (renderer)   renderer.dispose();
    _inited = false;
  }

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    get inited() { return _inited; },
    init, destroy,
    updateFromAssessment, setJoint, resetAll,
    startGaitAnimation, stopGaitAnimation,
    getSnapshot,
    PAIN_COLORS, JOINT_FIELDS,
    _svgJointClick,  // exposed for SVG onclick
  };

})();

window.BodyMap3D = BodyMap3D;
