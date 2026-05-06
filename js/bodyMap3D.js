// ═══════════════════════════════════════════════════════════════
//  js/bodyMap3D.js
//  Interactive 3D Body Map — Three.js + Fallback Canvas
//  Holographic Sci-Fi Interface with Smart Joint Info Boxes
//  Lazy-initialised: only runs when #bodymap-container is visible.
// ═══════════════════════════════════════════════════════════════

const BodyMap3D = (() => {

  // ── HOLOGRAPHIC COLORS (Neon Blue + Magenta) ──────────────
  const NEON_BLUE     = 0x00d4ff;
  const NEON_MAGENTA  = 0xff2d95;
  const NEON_CYAN     = 0x00ffcc;
  const NEON_PINK     = 0xff00ff;
  const HOLO_BLUE     = '#00d4ff';
  const HOLO_MAGENTA  = '#ff2d95';
  const HOLO_CYAN     = '#00ffcc';
  const HOLO_PINK     = '#ff00ff';

  // ── PAIN COLOUR SCALE (1–10, clinically defined) ──────────
  const PAIN_COLORS = {
    0:  HOLO_BLUE,     // healthy / unassessed — neon blue
    1:  '#4ade80',     // green
    2:  '#86efac',
    3:  '#facc15',     // yellow — mild
    4:  '#fde047',
    5:  '#fb923c',     // orange — moderate
    6:  '#f97316',
    7:  '#ef4444',     // red — severe
    8:  '#dc2626',
    9:  '#7f1d1d',     // dark red — critical
    10: '#3f0d0d',
  };

  // ── JOINT → FORM FIELD MAPPING ────────────────────────────
  // Maps each 3D joint key to the assessment form inputs it should
  // populate / read from when clicked.
  const JOINT_FIELDS = {
    left_hip:        { lr: 'L', keys: ['ns-hip-ir-l','ns-hip-er-l','ns-hip-flex-l','ns-hip-ext-l'], label: 'Left Hip',         norm: 'hip_ir', normVal: 35, questions: ['Pain level (0-10)?', 'Flexion range?', 'IR range?', 'ER range?'] },
    right_hip:       { lr: 'R', keys: ['ns-hip-ir-r','ns-hip-er-r','ns-hip-flex-r','ns-hip-ext-r'], label: 'Right Hip',        norm: 'hip_ir', normVal: 35, questions: ['Pain level (0-10)?', 'Flexion range?', 'IR range?', 'ER range?'] },
    left_knee:       { lr: 'L', keys: [],                                                            label: 'Left Knee',        norm: null,      normVal: null, questions: ['Pain during flexion?', 'Swelling present?', 'Stability issues?'] },
    right_knee:      { lr: 'R', keys: [],                                                            label: 'Right Knee',       norm: null,      normVal: null, questions: ['Pain during flexion?', 'Swelling present?', 'Stability issues?'] },
    left_ankle:      { lr: 'L', keys: ['ns-ankle-df-l'],                                            label: 'Left Ankle',       norm: 'ankle_df',normVal: 10, questions: ['Dorsiflexion (cm)?', 'Pain on movement?', 'Previous sprain?'] },
    right_ankle:     { lr: 'R', keys: ['ns-ankle-df-r'],                                            label: 'Right Ankle',      norm: 'ankle_df',normVal: 10, questions: ['Dorsiflexion (cm)?', 'Pain on movement?', 'Previous sprain?'] },
    left_shoulder:   { lr: 'L', keys: ['ns-sh-flex-l','ns-sh-ir-l','ns-sh-er-l'],                  label: 'Left Shoulder',    norm: 'shoulder_ir', normVal: 70, questions: ['Flexion range?', 'Pain level?', 'Previous dislocation?'] },
    right_shoulder:  { lr: 'R', keys: ['ns-sh-flex-r','ns-sh-ir-r','ns-sh-er-r'],                  label: 'Right Shoulder',   norm: 'shoulder_ir', normVal: 70, questions: ['Flexion range?', 'Pain level?', 'Previous dislocation?'] },
    lumbar_spine:    { lr: null,keys: ['ns-sp-flex','ns-sp-ext'],                                   label: 'Lumbar Spine',     norm: null,      normVal: null, questions: ['Pain during flexion?', 'Numbness/tingling?', 'Range limitation?'] },
    thoracic_spine:  { lr: null,keys: ['ns-sp-rotl','ns-sp-rotr'],                                 label: 'Thoracic Spine',   norm: null,      normVal: null, questions: ['Rotation pain?', 'Stiffness level?', 'Previous injury?'] },
    left_foot:       { lr: 'L', keys: [],                                                            label: 'Left Foot',        norm: null,      normVal: null, questions: ['Arch type?', 'Pain location?', 'Gait issues?'] },
    right_foot:      { lr: 'R', keys: [],                                                            label: 'Right Foot',       norm: null,      normVal: null, questions: ['Arch type?', 'Pain location?', 'Gait issues?'] },
  };

  // ── STATE ─────────────────────────────────────────────────
  let scene, camera, renderer, controls, raycaster, mouse;
  let jointMeshes  = {};   // jointKey → THREE.Mesh
  let jointStates  = {};   // jointKey → { pain_scale, label, clientData }
  let onClickCb    = null;
  let container    = null;
  let animId       = null;
  let hoveredMesh  = null;
  let gaitAnimId   = null;
  let gaitPhaseIdx = 0;
  let _inited      = false;
  let particleSys  = [];   // holographic particles
  let glowEffects  = {};   // joint glow meshes
  let currentClient = null; // tracks if client exists (for info box mode)
  let infoBoxVisible = false;

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

  // ── THREE.JS INIT (Holographic Sci-Fi) ──────────────────
  function _initThree() {
    const w = container.clientWidth  || 400;
    const h = container.clientHeight || 520;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510); // Deep dark blue-black

    camera = new THREE.PerspectiveCamera(42, w / h, 0.01, 100);
    camera.position.set(0, 1.1, 3.2);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Holographic Lighting
    const ambient = new THREE.AmbientLight(0x0a0a2a, 0.4);
    scene.add(ambient);

    // Neon blue key light
    const key = new THREE.DirectionalLight(NEON_BLUE, 0.6);
    key.position.set(3, 6, 4);
    scene.add(key);

    // Magenta rim light
    const rim = new THREE.DirectionalLight(NEON_MAGENTA, 0.4);
    rim.position.set(-4, 3, -3);
    scene.add(rim);

    // Cyan fill light
    const fill = new THREE.HemisphereLight(0x0a2a3a, 0x050510, 0.5);
    scene.add(fill);

    // Add subtle fog for depth
    scene.fog = new THREE.FogExp2(0x050510, 0.08);

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

    // Create background bokeh particles
    _createBokehParticles();

    _animate();
  }

  // ── FALLBACK BODY (Holographic Neon Style) ────────────────
  function _buildFallbackBody() {
    // Holographic material factory
    const holoMat = (color, emissiveIntensity = 0.3) => new THREE.MeshPhongMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: emissiveIntensity,
      transparent: true,
      opacity: 0.85,
      wireframe: false,
    });

    const bodyParts = {
      head:           { geo: new THREE.SphereGeometry(0.11, 20, 20),           pos: [0,    1.82, 0],  color: NEON_BLUE },
      neck:           { geo: new THREE.CylinderGeometry(0.04,0.05,0.1,12),     pos: [0,    1.67, 0],  color: NEON_BLUE },
      torso_upper:    { geo: new THREE.CylinderGeometry(0.16,0.14,0.28,16),    pos: [0,    1.44, 0],  color: NEON_BLUE },
      torso_lower:    { geo: new THREE.CylinderGeometry(0.13,0.10,0.2,16),     pos: [0,    1.14, 0],  color: NEON_BLUE },
      pelvis:         { geo: new THREE.SphereGeometry(0.11, 14, 14),           pos: [0,    0.98, 0],  color: NEON_BLUE },

      // Left arm chain
      left_shoulder:  { geo: new THREE.SphereGeometry(0.06,14,14),             pos: [-0.22,1.55, 0],  color: NEON_MAGENTA, isJoint: true },
      left_upper_arm: { geo: new THREE.CylinderGeometry(0.04,0.035,0.24,10),   pos: [-0.27,1.32, 0],  color: NEON_BLUE },
      left_elbow:     { geo: new THREE.SphereGeometry(0.038,10,10),            pos: [-0.28,1.19, 0],  color: NEON_MAGENTA, isJoint: true },
      left_forearm:   { geo: new THREE.CylinderGeometry(0.033,0.028,0.20,10),  pos: [-0.29,1.03, 0],  color: NEON_BLUE },

      // Right arm chain
      right_shoulder: { geo: new THREE.SphereGeometry(0.06,14,14),             pos: [0.22, 1.55, 0],  color: NEON_MAGENTA, isJoint: true },
      right_upper_arm:{ geo: new THREE.CylinderGeometry(0.04,0.035,0.24,10),   pos: [0.27, 1.32, 0],  color: NEON_BLUE },
      right_elbow:    { geo: new THREE.SphereGeometry(0.038,10,10),            pos: [0.28, 1.19, 0],  color: NEON_MAGENTA, isJoint: true },
      right_forearm:  { geo: new THREE.CylinderGeometry(0.033,0.028,0.20,10),  pos: [0.29, 1.03, 0],  color: NEON_BLUE },

      // Left leg chain
      left_hip:       { geo: new THREE.SphereGeometry(0.07,14,14),             pos: [-0.13,0.92, 0],  color: NEON_MAGENTA, isJoint: true },
      left_thigh:     { geo: new THREE.CylinderGeometry(0.055,0.048,0.34,12),  pos: [-0.13,0.70, 0],  color: NEON_BLUE },
      left_knee:      { geo: new THREE.SphereGeometry(0.05,14,14),             pos: [-0.13,0.50, 0],  color: NEON_MAGENTA, isJoint: true },
      left_shin:      { geo: new THREE.CylinderGeometry(0.038,0.030,0.3,12),   pos: [-0.13,0.30, 0],  color: NEON_BLUE },
      left_ankle:     { geo: new THREE.SphereGeometry(0.04,12,12),             pos: [-0.13,0.10, 0],  color: NEON_MAGENTA, isJoint: true },
      left_foot:      { geo: new THREE.BoxGeometry(0.07,0.04,0.14),            pos: [-0.13,0.02, 0.04], color: NEON_CYAN },

      // Right leg chain
      right_hip:      { geo: new THREE.SphereGeometry(0.07,14,14),             pos: [0.13, 0.92, 0],  color: NEON_MAGENTA, isJoint: true },
      right_thigh:    { geo: new THREE.CylinderGeometry(0.055,0.048,0.34,12),  pos: [0.13, 0.70, 0],  color: NEON_BLUE },
      right_knee:     { geo: new THREE.SphereGeometry(0.05,14,14),             pos: [0.13, 0.50, 0],  color: NEON_MAGENTA, isJoint: true },
      right_shin:     { geo: new THREE.CylinderGeometry(0.038,0.030,0.3,12),   pos: [0.13, 0.30, 0],  color: NEON_BLUE },
      right_ankle:    { geo: new THREE.SphereGeometry(0.04,12,12),             pos: [0.13, 0.10, 0],  color: NEON_MAGENTA, isJoint: true },
      right_foot:     { geo: new THREE.BoxGeometry(0.07,0.04,0.14),            pos: [0.13, 0.02, 0.04], color: NEON_CYAN },

      // Spine
      lumbar_spine:   { geo: new THREE.BoxGeometry(0.07,0.12,0.06),            pos: [0,    1.08, -0.02], color: NEON_CYAN, isJoint: true },
      thoracic_spine: { geo: new THREE.BoxGeometry(0.07,0.18,0.06),            pos: [0,    1.35, -0.02], color: NEON_CYAN, isJoint: true },
    };

    Object.entries(bodyParts).forEach(([key, { geo, pos, color, isJoint }]) => {
      const mat  = holoMat(color, isJoint ? 0.6 : 0.3);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...pos);
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      mesh.userData.jointKey  = key;
      mesh.userData.baseColor = color;
      mesh.userData.isJoint   = isJoint || false;
      scene.add(mesh);

      if (JOINT_FIELDS[key]) {
        jointMeshes[key] = mesh;
        jointStates[key] = { pain_scale: 0, label: JOINT_FIELDS[key].label, clientData: null };
        // Add glow effect to joints
        if (isJoint) _addJointGlow(mesh, color);
      }
    });

    // Holographic grid floor
    const grid = new THREE.GridHelper(4, 30, NEON_BLUE, NEON_BLUE);
    grid.material.opacity = 0.15;
    grid.material.transparent = true;
    scene.add(grid);
  }

  // ── CREATE BOKEH PARTICLES (Background) ──────────────────
  function _createBokehParticles() {
    const particleCount = 120;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors    = new Float32Array(particleCount * 3);
    const sizes     = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 8;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 8;

      // Random neon colors
      const c = [NEON_BLUE, NEON_MAGENTA, NEON_CYAN, 0x00ffaa][Math.floor(Math.random() * 4)];
      const color = new THREE.Color(c);
      colors[i * 3]     = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      sizes[i] = Math.random() * 0.08 + 0.02;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);
    particleSys.push(particles);
  }

  // ── ADD JOINT GLOW EFFECT ──────────────────────────────────
  function _addJointGlow(mesh, color) {
    const glowGeo = new THREE.SphereGeometry(mesh.geometry.parameters.radius * 2.5 || 0.15, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    mesh.add(glowMesh);
    glowEffects[mesh.userData.jointKey] = glowMesh;
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

          // Apply holographic material
          if (child.material) {
            child.material = new THREE.MeshPhongMaterial({
              color: NEON_BLUE,
              emissive: NEON_BLUE,
              emissiveIntensity: 0.3,
              transparent: true,
              opacity: 0.85,
            });
          }

          Object.keys(JOINT_FIELDS).forEach(jk => {
            const aliases = [
              jk, jk.replace('_', '.'), jk.replace('left_','L_'), jk.replace('right_','R_'),
              jk.toUpperCase(), jk.replace(/_/g,''),
            ];
            if (aliases.some(a => child.name.toLowerCase().includes(a.toLowerCase()))) {
              jointMeshes[jk] = child;
              child.userData.jointKey = jk;
              child.userData.isJoint = true;
              _addJointGlow(child, NEON_MAGENTA);
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
    if (!hits.length) { _hideInfoBox(); return; }
    const obj = hits[0].object;
    const jk  = obj.userData?.jointKey;
    if (!jk || !JOINT_FIELDS[jk]) { _hideInfoBox(); return; }

    const state = jointStates[jk] || { pain_scale: 0 };
    if (onClickCb) {
      onClickCb(jk, JOINT_FIELDS[jk], state);
    } else {
      _showInfoBox(jk, JOINT_FIELDS[jk], state, obj);
    }
  }

  function _onHover(e) {
    _setMouse(e);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(scene.children, true);

    // Reset previous hovered mesh
    if (hoveredMesh) {
      const jk = hoveredMesh.userData.jointKey;
      const ps = jointStates[jk]?.pain_scale || 0;
      if (hoveredMesh.material) {
        hoveredMesh.material.emissiveIntensity = ps > 6 ? 0.35 : ps > 3 ? 0.15 : jk && JOINT_FIELDS[jk] ? 0.6 : 0.0;
      }
    }

    if (hits.length && hits[0].object.userData.jointKey) {
      const obj = hits[0].object;
      hoveredMesh = obj;
      const jk = obj.userData.jointKey;
      if (jk && JOINT_FIELDS[jk]) {
        if (obj.material) obj.material.emissiveIntensity = 0.9;
        renderer.domElement.style.cursor = 'pointer';
        // Show quick preview tooltip
        _showHoverPreview(jk, JOINT_FIELDS[jk], jointStates[jk]);
      }
    } else {
      hoveredMesh = null;
      renderer.domElement.style.cursor = 'grab';
      _hideHoverPreview();
    }
  }

  function _setMouse(e) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    mouse.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
  }

  // ── HOLOGRAPHIC INFO BOX SYSTEM ─────────────────────────
  function _showInfoBox(jk, fieldMeta, state, mesh) {
    _hideInfoBox(); // Remove existing

    const isNewClient = !state.clientData || state.clientData.isNew;
    const box = document.createElement('div');
    box.id = 'joint-info-box';
    box.className = 'holo-info-box';

    // Position near the 3D joint
    const pos = mesh.getWorldPosition(new THREE.Vector3());
    const projected = pos.clone().project(camera);
    const x = (projected.x * 0.5 + 0.5) * container.clientWidth;
    const y = (-projected.y * 0.5 + 0.5) * container.clientHeight;

    box.style.cssText = `
      position:absolute; left:${Math.min(x + 20, container.clientWidth - 320)}px; top:${Math.max(y - 50, 10)}px;
      z-index:999; width:300px; background:rgba(5,5,16,0.92); border:1px solid ${HOLO_MAGENTA}; border-radius:12px;
      padding:16px; box-shadow:0 0 30px rgba(255,45,149,0.3), 0 0 60px rgba(0,212,255,0.15);
      animation: holoFadeIn 0.3s cubic-bezier(0.16,1,0.3,1); backdrop-filter:blur(10px);
      font-family: var(--font-body, sans-serif); color: var(--text-primary, #f0f2f7);
    `;

    // Header with joint name and close button
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,45,149,0.3)';
    header.innerHTML = `
      <div style="font-family:var(--font-display, sans-serif);font-size:14px;font-weight:700;color:${HOLO_MAGENTA}">
        ${fieldMeta.label}
        <span style="font-size:10px;color:${HOLO_CYAN};margin-left:6px">${fieldMeta.lr || ''}</span>
      </div>
      <button onclick="document.getElementById('joint-info-box')?.remove()" style="background:none;border:none;color:${HOLO_CYAN};font-size:16px;cursor:pointer;padding:0 4px">✕</button>
    `;
    box.appendChild(header);

    if (isNewClient) {
      // New client → show assessment questions
      const questions = fieldMeta.questions || ['Assess pain level?', 'Note range of motion?'];
      const qList = document.createElement('div');
      qList.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px';
      questions.forEach((q, i) => {
        const qItem = document.createElement('div');
        qItem.style.cssText = 'padding:8px 10px;background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.2);border-radius:8px;font-size:12px;cursor:pointer;transition:all 0.2s';
        qItem.innerHTML = `<span style="color:${HOLO_CYAN};margin-right:6px">Q${i+1}:</span>${q}`;
        qItem.onmouseenter = () => { qItem.style.background = 'rgba(0,212,255,0.15)'; qItem.style.borderColor = HOLO_CYAN; };
        qItem.onmouseleave = () => { qItem.style.background = 'rgba(0,212,255,0.08)'; qItem.style.borderColor = 'rgba(0,212,255,0.2)'; };
        qList.appendChild(qItem);
      });
      box.appendChild(qList);

      // Quick pain scale input for new clients
      const painSection = document.createElement('div');
      painSection.style.cssText = 'margin-top:8px';
      painSection.innerHTML = `
        <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${HOLO_CYAN};margin-bottom:6px">Pain Scale (0-10)</div>
        <input type="range" min="0" max="10" value="0" style="width:100%;accent-color:${HOLO_MAGENTA}" oninput="
          this.nextElementSibling.textContent=this.value;
          if(window.BodyMap3D) BodyMap3D.setJoint('${jk}', parseInt(this.value));
        "/>
        <div style="text-align:center;color:${HOLO_MAGENTA};font-weight:700;font-size:14px;margin-top:4px">0</div>
      `;
      box.appendChild(painSection);
    } else {
      // Existing client → show assessment data
      const data = state.clientData;
      const dataList = document.createElement('div');
      dataList.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px';

      // Show ROM data if available
      if (data.rom) {
        Object.entries(data.rom).forEach(([movement, value]) => {
          const item = document.createElement('div');
          item.style.cssText = 'padding:8px 10px;background:rgba(0,255,204,0.08);border:1px solid rgba(0,255,204,0.2);border-radius:8px;font-size:12px';
          const norm = fieldMeta.normVal || '–';
          item.innerHTML = `<span style="color:${HOLO_CYAN}">${movement}:</span> <strong style="color:${HOLO_BLUE}">${value}°</strong> <span style="color:var(--text-tertiary)">/ ${norm}° norm</span>`;
          dataList.appendChild(item);
        });
      }

      // Show pain level
      const painItem = document.createElement('div');
      painItem.style.cssText = 'padding:8px 10px;background:rgba(255,45,149,0.08);border:1px solid rgba(255,45,149,0.2);border-radius:8px;font-size:12px';
      painItem.innerHTML = `<span style="color:${HOLO_MAGENTA}">Pain Level:</span> <strong style="color:${HOLO_MAGENTA}">${state.pain_scale}/10</strong>`;
      dataList.appendChild(painItem);

      box.appendChild(dataList);
    }

    // Apply button
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary btn-sm w-full';
    applyBtn.style.marginTop = '12px';
    applyBtn.textContent = isNewClient ? 'Save Assessment' : 'Update Data';
    applyBtn.onclick = () => {
      _hideInfoBox();
      if (onClickCb) onClickCb(jk, fieldMeta, state);
    };
    box.appendChild(applyBtn);

    container.style.position = 'relative';
    container.appendChild(box);
    infoBoxVisible = true;
  }

  function _hideInfoBox() {
    document.getElementById('joint-info-box')?.remove();
    infoBoxVisible = false;
  }

  function _showHoverPreview(jk, fieldMeta, state) {
    _hideHoverPreview();
    if (infoBoxVisible) return; // Don't show preview if info box is open

    const preview = document.createElement('div');
    preview.id = 'joint-hover-preview';
    preview.style.cssText = `
      position:absolute; left:50%; top:10px; transform:translateX(-50%);
      background:rgba(5,5,16,0.9); border:1px solid ${HOLO_BLUE}; border-radius:8px;
      padding:8px 14px; z-index:998; font-size:11px; color:${HOLO_CYAN};
      pointer-events:none; white-space:nowrap;
      box-shadow:0 0 20px rgba(0,212,255,0.2);
      animation: holoFadeIn 0.2s ease-out;
    `;
    const painColor = PAIN_COLORS[state?.pain_scale || 0] || HOLO_BLUE;
    preview.innerHTML = `<strong style="color:${HOLO_MAGENTA}">${fieldMeta.label}</strong> — Pain: <span style="color:${painColor};font-weight:700">${state?.pain_scale || 0}/10</span>`;
    container.appendChild(preview);
  }

  function _hideHoverPreview() {
    document.getElementById('joint-hover-preview')?.remove();
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
    // Holographic API extensions
    setClientData(jointKey, data) {
      if (jointStates[jointKey]) {
        jointStates[jointKey].clientData = data;
      }
    },
    setClientForAll(clientData) {
      currentClient = clientData;
      Object.keys(jointStates).forEach(k => {
        jointStates[k].clientData = clientData;
      });
    },
    clearClientData() {
      currentClient = null;
      Object.keys(jointStates).forEach(k => {
        jointStates[k].clientData = null;
      });
    },
    hideInfoBox: _hideInfoBox,
  };

})();

window.BodyMap3D = BodyMap3D;
