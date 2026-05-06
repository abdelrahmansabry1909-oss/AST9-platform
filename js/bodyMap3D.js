const BodyMap3D = (() => {

  // Holographic Colors
  const NEON_BLUE     = 0x00d4ff;
  const NEON_MAGENTA  = 0xff2d95;
  const NEON_CYAN     = 0x00ffcc;
  const HOLO_BLUE     = '#00d4ff';
  const HOLO_MAGENTA  = '#ff2d95';
  const HOLO_CYAN     = '#00ffcc';

  // Pain Color Scale
  const PAIN_COLORS = {
    0:  HOLO_BLUE,
    1:  '#4ade80',
    2:  '#86efac',
    3:  '#facc15',
    4:  '#fde047',
    5:  '#fb923c',
    6:  '#f97316',
    7:  '#ef4444',
    8:  '#dc2626',
    9:  '#7f1d1d',
    10: '#3f0d0d',
  };

  // Joint Field Mapping
  const JOINT_FIELDS = {
    left_hip:        { lr: 'L', keys: ['ns-hip-ir-l','ns-hip-er-l','ns-hip-flex-l','ns-hip-ext-l'], label: 'Left Hip', norm: 'hip_ir', normVal: 35 },
    right_hip:       { lr: 'R', keys: ['ns-hip-ir-r','ns-hip-er-r','ns-hip-flex-r','ns-hip-ext-r'], label: 'Right Hip', norm: 'hip_ir', normVal: 35 },
    left_knee:       { lr: 'L', keys: [], label: 'Left Knee', norm: null, normVal: null },
    right_knee:      { lr: 'R', keys: [], label: 'Right Knee', norm: null, normVal: null },
    left_ankle:      { lr: 'L', keys: ['ns-ankle-df-l'], label: 'Left Ankle', norm: 'ankle_df', normVal: 10 },
    right_ankle:     { lr: 'R', keys: ['ns-ankle-df-r'], label: 'Right Ankle', norm: 'ankle_df', normVal: 10 },
    left_shoulder:   { lr: 'L', keys: ['ns-sh-flex-l','ns-sh-ir-l','ns-sh-er-l'], label: 'Left Shoulder', norm: 'shoulder_ir', normVal: 70 },
    right_shoulder:  { lr: 'R', keys: ['ns-sh-flex-r','ns-sh-ir-r','ns-sh-er-r'], label: 'Right Shoulder', norm: 'shoulder_ir', normVal: 70 },
    lumbar_spine:    { lr: null, keys: ['ns-sp-flex','ns-sp-ext'], label: 'Lumbar Spine', norm: null, normVal: null },
    thoracic_spine:  { lr: null, keys: ['ns-sp-rotl','ns-sp-rotr'], label: 'Thoracic Spine', norm: null, normVal: null },
    left_foot:       { lr: 'L', keys: [], label: 'Left Foot', norm: null, normVal: null },
    right_foot:      { lr: 'R', keys: [], label: 'Right Foot', norm: null, normVal: null },
  };

  let scene, camera, renderer, controls, raycaster, mouse;
  let jointMeshes  = {};
  let jointStates  = {};
  let onClickCb    = null;
  let container    = null;
  let animId       = null;
  let hoveredMesh  = null;
  let gaitAnimId   = null;
  let gaitPhaseIdx = 0;
  let _inited      = false;
  let _clientData  = null;

  function init(containerId, options = {}) {
    container = document.getElementById(containerId);
    if (!container || _inited) return;
    onClickCb = options.onJointClick || null;
    if (!_webglAvailable()) {
      _renderFallbackSVG();
      _inited = true;
      return;
    }
    _initThree();
    _buildFallbackBody();
    _inited = true;
  }

  function _initThree() {
    const w = container.clientWidth || 400;
    const h = container.clientHeight || 520;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);
    camera = new THREE.PerspectiveCamera(42, w / h, 0.01, 100);
    camera.position.set(0, 1.1, 3.2);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    const ambient = new THREE.AmbientLight(0x0a0a2a, 0.4);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(NEON_BLUE, 0.6);
    key.position.set(3, 6, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(NEON_MAGENTA, 0.4);
    rim.position.set(-4, 3, -3);
    scene.add(rim);
    const fill = new THREE.HemisphereLight(0x0a2a3a, 0x050510, 0.5);
    scene.add(fill);
    scene.fog = new THREE.FogExp2(0x050510, 0.08);
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
    renderer.domElement.addEventListener('click', _onClick);
    renderer.domElement.addEventListener('mousemove', _onHover);
    window.addEventListener('resize', _onResize);
    _animate();
  }

  function _buildFallbackBody() {
    const holoMat = (color, emissiveIntensity) => new THREE.MeshPhongMaterial({
      color: color, emissive: color, emissiveIntensity: emissiveIntensity || 0.3, transparent: true, opacity: 0.85
    });
    const bodyParts = {
      head:           { geo: new THREE.SphereGeometry(0.11, 20, 20), pos: [0, 1.82, 0], color: NEON_BLUE },
      neck:           { geo: new THREE.CylinderGeometry(0.04,0.05,0.1,12), pos: [0, 1.67, 0], color: NEON_BLUE },
      torso_upper:    { geo: new THREE.CylinderGeometry(0.16,0.14,0.28,16), pos: [0, 1.44, 0], color: NEON_BLUE },
      torso_lower:    { geo: new THREE.CylinderGeometry(0.13,0.10,0.2,16), pos: [0, 1.14, 0], color: NEON_BLUE },
      pelvis:         { geo: new THREE.SphereGeometry(0.11, 14, 14), pos: [0, 0.98, 0], color: NEON_BLUE },
      left_shoulder:  { geo: new THREE.SphereGeometry(0.06,14,14), pos: [-0.22,1.55, 0], color: NEON_MAGENTA },
      left_upper_arm: { geo: new THREE.CylinderGeometry(0.04,0.035,0.24,10), pos: [-0.27,1.32, 0], color: NEON_BLUE },
      left_elbow:     { geo: new THREE.SphereGeometry(0.038,10,10), pos: [-0.28,1.19, 0], color: NEON_MAGENTA },
      left_forearm:   { geo: new THREE.CylinderGeometry(0.033,0.028,0.20,10), pos: [-0.29,1.03, 0], color: NEON_BLUE },
      right_shoulder: { geo: new THREE.SphereGeometry(0.06,14,14), pos: [0.22, 1.55, 0], color: NEON_MAGENTA },
      right_upper_arm:{ geo: new THREE.CylinderGeometry(0.04,0.035,0.24,10), pos: [0.27, 1.32, 0], color: NEON_BLUE },
      right_elbow:    { geo: new THREE.SphereGeometry(0.038,10,10), pos: [0.28, 1.19, 0], color: NEON_MAGENTA },
      right_forearm:  { geo: new THREE.CylinderGeometry(0.033,0.028,0.20,10), pos: [0.29, 1.03, 0], color: NEON_BLUE },
      left_hip:       { geo: new THREE.SphereGeometry(0.07,14,14), pos: [-0.13,0.92, 0], color: NEON_MAGENTA },
      left_thigh:     { geo: new THREE.CylinderGeometry(0.055,0.048,0.34,12), pos: [-0.13,0.70, 0], color: NEON_BLUE },
      left_knee:      { geo: new THREE.SphereGeometry(0.05,14,14), pos: [-0.13,0.50, 0], color: NEON_MAGENTA },
      left_shin:      { geo: new THREE.CylinderGeometry(0.038,0.030,0.3,12), pos: [-0.13,0.30, 0], color: NEON_BLUE },
      left_ankle:     { geo: new THREE.SphereGeometry(0.04,12,12), pos: [-0.13,0.10, 0], color: NEON_MAGENTA },
      left_foot:      { geo: new THREE.BoxGeometry(0.07,0.04,0.14), pos: [-0.13,0.02, 0.04], color: NEON_CYAN },
      right_hip:      { geo: new THREE.SphereGeometry(0.07,14,14), pos: [0.13, 0.92, 0], color: NEON_MAGENTA },
      right_thigh:    { geo: new THREE.CylinderGeometry(0.055,0.048,0.34,12), pos: [0.13, 0.70, 0], color: NEON_BLUE },
      right_knee:     { geo: new THREE.SphereGeometry(0.05,14,14), pos: [0.13, 0.50, 0], color: NEON_MAGENTA },
      right_shin:     { geo: new THREE.CylinderGeometry(0.038,0.030,0.3,12), pos: [0.13, 0.30, 0], color: NEON_BLUE },
      right_ankle:    { geo: new THREE.SphereGeometry(0.04,12,12), pos: [0.13, 0.10, 0], color: NEON_MAGENTA },
      right_foot:     { geo: new THREE.BoxGeometry(0.07,0.04,0.14), pos: [0.13, 0.02, 0.04], color: NEON_CYAN },
      lumbar_spine:   { geo: new THREE.BoxGeometry(0.07,0.12,0.06), pos: [0, 1.08, -0.02], color: NEON_CYAN },
      thoracic_spine: { geo: new THREE.BoxGeometry(0.07,0.18,0.06), pos: [0, 1.35, -0.02], color: NEON_CYAN },
    };
    Object.entries(bodyParts).forEach(([key, { geo, pos, color }]) => {
      const mat = holoMat(color);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.jointKey = key;
      scene.add(mesh);
      if (JOINT_FIELDS[key]) {
        jointMeshes[key] = mesh;
        jointStates[key] = { pain_scale: 0, label: JOINT_FIELDS[key].label };
      }
    });
    const grid = new THREE.GridHelper(4, 30, NEON_BLUE, NEON_BLUE);
    grid.material.opacity = 0.15;
    grid.material.transparent = true;
    scene.add(grid);
  }

  function applyPainColor(jointKey, painScale) {
    const mesh = jointMeshes[jointKey];
    if (!mesh || !mesh.material) return;
    const clamped = Math.max(0, Math.min(10, Math.round(painScale)));
    const hex = PAIN_COLORS[clamped];
    const color = new THREE.Color(hex);
    mesh.material.color = color;
    mesh.material.emissive = color;
    mesh.material.emissiveIntensity = clamped > 6 ? 0.35 : clamped > 3 ? 0.15 : 0.0;
  }

  function updateFromAssessment(assessment) {
    const a = assessment;
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
      left_hip: toVis(a.hip_ir_l, 35), right_hip: toVis(a.hip_ir_r, 35),
      left_ankle: toVis(a.ankle_df_l, 10), right_ankle: toVis(a.ankle_df_r, 10),
      left_shoulder: toVis(a.sh_ir_l, 70), right_shoulder: toVis(a.sh_ir_r, 70),
      lumbar_spine: spineScore(a.sp_flex_pain || a.sp_ext_pain, a.sp_flex_range),
      thoracic_spine: spineScore(a.sp_rotl_pain || a.sp_rotr_pain, a.sp_rotl_range),
      left_knee: (a.sl_squat_l != null && a.sl_squat_l <= 1) ? 7 : 1,
      right_knee: (a.sl_squat_r != null && a.sl_squat_r <= 1) ? 7 : 1,
      left_foot: (a.pronation_l && a.pronation_l.toLowerCase().includes('over')) ? 5 : 1,
      right_foot: (a.pronation_r && a.pronation_r.toLowerCase().includes('over')) ? 5 : 1,
    };
    Object.entries(mappings).forEach(([key, pain]) => {
      jointStates[key] = Object.assign({}, jointStates[key] || {}, { pain_scale: pain });
      applyPainColor(key, pain);
    });
  }

  function setJoint(jointKey, painScale, meta = {}) {
    if (!JOINT_FIELDS[jointKey]) return;
    jointStates[jointKey] = Object.assign({}, { pain_scale: painScale }, meta);
    applyPainColor(jointKey, painScale);
  }

  function resetAll() {
    Object.keys(jointMeshes).forEach(k => {
      jointStates[k] = { pain_scale: 0 };
      applyPainColor(k, 0);
    });
  }

  function setClientData(clientData) {
    _clientData = clientData;
  }

  function setClientForAll(jointKey, clientData) {
    _clientData = clientData;
    if (jointMeshes[jointKey]) {
      _showSmartInfo(jointKey);
    }
  }

  function clearClientData() {
    _clientData = null;
  }

  function _showSmartInfo(jointKey) {
    const state = jointStates[jointKey] || { pain_scale: 0 };
    const jf = JOINT_FIELDS[jointKey];
    if (!jf) return;

    let infoHtml = '<div class="holo-info-box" id="holo-info-' + jointKey + '">';
    infoHtml += '<div class="holo-info-header">' + jf.label + ' <span class="holo-close" onclick="BodyMap3D.closeInfo(\'' + jointKey + '\')">✕</span></div>';

    if (_clientData && _clientData.assessments && _clientData.assessments.length > 0) {
      const latest = _clientData.assessments[_clientData.assessments.length - 1];
      infoHtml += '<div class="holo-info-rom">ROM: ' + (latest[jointKey + '_rom'] || 'N/A') + '</div>';
      infoHtml += '<div class="holo-info-pain">Pain: ' + state.pain_scale + '/10</div>';
    } else {
      infoHtml += '<div class="holo-info-question">Rate pain (0-10):</div>';
      infoHtml += '<div class="holo-pain-buttons">';
      for (let i = 0; i <= 10; i++) {
        infoHtml += '<button class="holo-pain-btn" onclick="BodyMap3D.setPain(\'' + jointKey + '\',' + i + ')">' + i + '</button>';
      }
      infoHtml += '</div>';
    }
    infoHtml += '</div>';

    let existing = document.getElementById('holo-info-' + jointKey);
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', infoHtml);
  }

  function setPain(jointKey, painScale) {
    setJoint(jointKey, painScale);
    let info = document.getElementById('holo-info-' + jointKey);
    if (info) {
      let painDiv = info.querySelector('.holo-info-pain');
      if (painDiv) painDiv.textContent = 'Pain: ' + painScale + '/10';
    }
  }

  function closeInfo(jointKey) {
    let info = document.getElementById('holo-info-' + jointKey);
    if (info) info.remove();
  }

  function _onClick(e) {
    _setMouse(e);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    if (!hits.length) return;
    const obj = hits[0].object;
    const jk = obj.userData && obj.userData.jointKey;
    if (!jk || !JOINT_FIELDS[jk]) return;
    const state = jointStates[jk] || { pain_scale: 0 };
    if (onClickCb) onClickCb(jk, JOINT_FIELDS[jk], state);
    _showSmartInfo(jk);
  }

  function _onHover(e) {
    _setMouse(e);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    if (hoveredMesh && hoveredMesh.material) {
      const jk = hoveredMesh.userData.jointKey;
      const ps = jointStates[jk] ? jointStates[jk].pain_scale : 0;
      hoveredMesh.material.emissiveIntensity = ps > 6 ? 0.35 : ps > 3 ? 0.15 : 0.0;
    }
    if (hits.length && hits[0].object.userData && hits[0].object.userData.jointKey) {
      hoveredMesh = hits[0].object;
      if (hoveredMesh.material) hoveredMesh.material.emissiveIntensity = 0.6;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      hoveredMesh = null;
      renderer.domElement.style.cursor = 'grab';
    }
  }

  function _setMouse(e) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function _animate() {
    animId = requestAnimationFrame(_animate);
    if (controls && controls.update) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function _onResize() {
    if (!container || !renderer) return;
    const w = container.clientWidth || 400;
    const h = container.clientHeight || 520;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function _webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch(e) { return false; }
  }

  function _renderFallbackSVG() {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-tertiary)">WebGL not available</div>';
    _inited = true;
  }

  function destroy() {
    if (animId) cancelAnimationFrame(animId);
    window.removeEventListener('resize', _onResize);
    if (renderer) renderer.dispose();
    _inited = false;
  }

  return {
    get inited() { return _inited; },
    init, destroy,
    updateFromAssessment, setJoint, resetAll,
    setClientData, setClientForAll, clearClientData,
    setPain, closeInfo,
    PAIN_COLORS, JOINT_FIELDS,
  };

})();

window.BodyMap3D = BodyMap3D;
