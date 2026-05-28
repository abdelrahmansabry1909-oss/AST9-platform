// src/neucore/skeleton/GLBSkeleton.js
// Real anatomical human skeleton loaded from a glTF asset (ecorche_humanoid.glb).
// Drop-in replacement for the procedural SkeletonBuilder: exposes the same
// public surface (jointMeshes, boneMeshes, update, highlightJoint, dimAllExcept,
// resetAllOpacity, getJointWorldPos, setJointPain) so BodyCanvas / FXLayer /
// AssessmentPanel keep working unchanged.
//
// Notes on the asset (two sub-objects modelled apart in one file):
//  • A static skeleton — 135 bone meshes parented into an anatomical FK tree
//    (hip → femur → tibula → talus → …). Not skinned; each bone's origin sits
//    at its proximal joint, so rotating a bone flexes the limb below it. This
//    is what we render — full bilateral skeleton, ribcage on both sides.
//  • A "rig" — a 706-bone armature + 1 skinned body-surface mesh. The body
//    shell is detached + disposed on load (we render bare skeleton only); the
//    armature stays in the scene graph but has no visible meshes.
//  • glTF node names have '.' stripped by three's name sanitiser, so lookups
//    here are done by substring + an L/R suffix.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createJointMaterial } from '../core/MaterialFactory.js';

const MODEL_URL     = '/models/ecorche_humanoid.glb';
const TARGET_HEIGHT = 1.62;   // world units — feet at y=0, ~matches old camera framing

// ── Premium "polished bone" shader ──────────────────────────────────
const BONE_VERT = `
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying float vWorldY;
  void main() {
    vNormal  = normalize(normalMatrix * normal);
    vec4 mv  = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vWorldY  = (modelMatrix * vec4(position, 1.0)).y;
    gl_Position = projectionMatrix * mv;
  }
`;
const BONE_FRAG = `
  uniform float time;
  uniform vec3  baseColor;
  uniform vec3  deepColor;
  uniform vec3  rimColor;
  uniform float dim;
  varying vec3  vNormal;
  varying vec3  vViewPos;
  varying float vWorldY;
  void main() {
    vec3  N    = normalize(vNormal);
    vec3  V    = normalize(-vViewPos);
    float ndv  = max(dot(N, V), 0.0);
    float fres = pow(1.0 - ndv, 2.4);
    float up   = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3  col  = mix(deepColor, baseColor, mix(ndv, up, 0.35));
    col       += rimColor  * fres * 0.70;
    col       += baseColor * pow(ndv, 3.0) * 0.08;
    col       += rimColor  * sin(vWorldY * 38.0 - time * 1.1) * 0.014;
    col       *= dim;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class GLBSkeleton {
  constructor(scene) {
    this.scene        = scene;
    this.boneMeshes   = new Map();   // node name → Mesh  (+ 'Pelvis' alias)
    this.jointMeshes  = new Map();   // jointKey  → hotspot Mesh
    this._shaderMats  = [];
    this._boneMat     = null;
    this._skinMat     = null;
    this._skinMeshes  = [];
    // Écorché cut: keep the skin only where world-X >= 0 (screen-right half).
    this._clipPlane   = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    this._root        = new THREE.Group();
    this._gltfRoot    = null;
    this._idleFloat   = true;   // gentle bob — disabled while gait sim drives _root
    this.ready        = false;
    scene.add(this._root);
  }

  // Skinning-aware, NeuCore-styled body-surface material with a cyan fresnel
  // rim. MeshStandardMaterial auto-handles SkinnedMesh skinning + clipping.
  _createSkinMaterial() {
    // Classic écorché: the body silhouette stays whole, but the skin's alpha
    // varies by world-X so the screen-right half is solid muscle and the
    // screen-left half is translucent — bones show through underneath.
    const mat = new THREE.MeshStandardMaterial({
      color:             new THREE.Color(0x9A4F49),
      roughness:         0.62,
      metalness:         0.0,
      emissive:          new THREE.Color(0x4A1A17),
      emissiveIntensity: 1.05,
      side:              THREE.FrontSide,
      transparent:       true,
      opacity:           1.0,
      depthWrite:        true,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = { value: new THREE.Color(0x67E8F9) };
      shader.uniforms.uRimPow   = { value: 2.8 };
      shader.uniforms.uRimMul   = { value: 0.55 };
      // Vertex: pass through the world-X of every (post-skinning) fragment.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying float vWorldX;')
        .replace('#include <project_vertex>',
          '#include <project_vertex>\nvWorldX = (modelMatrix * vec4(transformed, 1.0)).x;');
      // Fragment: NeuCore rim glow + per-side alpha (écorché reveal).
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPow;\nuniform float uRimMul;\nvarying float vWorldX;')
        .replace('#include <map_fragment>',
          '#include <map_fragment>\n' +
          'diffuseColor.a *= mix(0.12, 1.0, smoothstep(-0.006, 0.006, vWorldX));')
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n' +
          '{\n' +
          '  vec3 _vn = normalize(vNormal);\n' +
          '  vec3 _vv = normalize(vViewPosition);\n' +
          '  float _rim = pow(1.0 - max(dot(_vn, _vv), 0.0), uRimPow);\n' +
          '  totalEmissiveRadiance += uRimColor * _rim * uRimMul;\n' +
          '}');
    };
    return mat;
  }

  // Async — resolves with `this` once the model is loaded & wired.
  // Transient network failures are retried (the GLB is 3.3 MB; a dropped
  // connection on a cold load otherwise becomes a permanent failure).
  build() {
    return this._loadWithRetry(2);
  }

  _loadWithRetry(retriesLeft) {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        MODEL_URL,
        (gltf) => {
          // A parse/wiring failure is deterministic — do NOT retry it.
          try { this._onLoaded(gltf); resolve(this); }
          catch (e) { reject(e); }
        },
        undefined,
        (err) => {
          if (retriesLeft > 0) {
            console.warn(`[NeuCore] skeleton fetch failed — retrying (${retriesLeft} left)`, err);
            setTimeout(() => {
              this._loadWithRetry(retriesLeft - 1).then(resolve, reject);
            }, 600);
          } else {
            reject(err);
          }
        },
      );
    });
  }

  _onLoaded(gltf) {
    const model = gltf.scene;
    this._gltfRoot = model;

    this._boneMat = new THREE.ShaderMaterial({
      uniforms: {
        time:      { value: 0 },
        baseColor: { value: new THREE.Color(0x8AA9AD) },
        deepColor: { value: new THREE.Color(0x0C2128) },
        rimColor:  { value: new THREE.Color(0x67E8F9) },
        dim:       { value: 1.0 },
      },
      vertexShader:   BONE_VERT,
      fragmentShader: BONE_FRAG,
      side: THREE.DoubleSide,
    });
    this._shaderMats.push(this._boneMat);

    // Skeleton-only: swap bones to the bone shader, drop the skin shell entirely
    // so the full bilateral skeleton (incl. ribcage on both sides) is visible.
    const skinToRemove = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = false;
      const matName = (o.material && o.material.name) || '';
      const isSkin  = !!o.isSkinnedMesh || /body/i.test(o.name) || /skin/i.test(matName);
      if (isSkin) {
        skinToRemove.push(o);
        return;
      }
      const old         = o.material;
      o.material        = this._boneMat;
      o.renderOrder     = 1;
      o.userData.isBone = true;
      this.boneMeshes.set(o.name, o);
      if (old && old !== o.material && old.dispose) {
        if (old.map) old.map.dispose();
        old.dispose();
      }
    });
    // Detach + dispose the skin shell. Its armature (706 invisible Object3D
    // bones) stays in the scene graph but renders nothing, so there's no cost.
    skinToRemove.forEach((m) => {
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (m.material.map) m.material.map.dispose();
        if (m.material.dispose) m.material.dispose();
      }
    });

    this._root.add(model);
    this._normalize(model);
    this._relaxArmsDown();
    this._mirrorAxialBones();
    // _narrowSkeletonX() removed — that 0.78 X-squish only existed to keep
    // the bones inside the skin envelope; without the shell we want the
    // skeleton's real anatomical proportions (rib width, pelvis, skull).
    // _alignRig() is skipped — it only existed to overlay the body shell on
    // the bones, and there's no shell anymore.
    this._buildHotspots();
    this.ready = true;
  }

  // The GLB's axial skeleton (hip, ribcage, sacrum, coccyx, every vertebra)
  // is modeled as right-side-only geometry — the source Blender file's
  // Mirror modifier was never applied, so the asset ships with the left
  // half missing. Each of these meshes has its pivot on the sagittal
  // midline (localPos.x = 0), so we complete the skeleton by cloning every
  // single-sided axial mesh and reflecting the clone with scale.x = -1.
  // Limbs already exist as proper L/R mesh pairs and are skipped.
  //
  // CRITICAL: the axial bones form a nested parent→child chain
  // (hip → ribcage → spine → … → skull). THREE.Object3D.clone() is
  // recursive by DEFAULT, so clone() on a chain bone deep-copies its whole
  // descendant subtree. Mirroring every axial bone that way duplicated the
  // skull ~31×, the C1 ~30×, etc. — the "double skeleton" bug. We must use
  // clone(false) so each mirror is exactly ONE childless mesh.
  _mirrorAxialBones() {
    const toMirror = [];
    this._gltfRoot.traverse((o) => {
      if (!o.isMesh || !o.userData.isBone) return;
      if (o.userData.isMirror) return;                          // never mirror a mirror
      if (/[LR]$/.test(o.name)) return;                         // limbs already paired
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      if (bb.max.x < 0.001 || bb.min.x > -0.001) toMirror.push(o);
    });
    toMirror.forEach((src) => {
      const clone = src.clone(false);                           // false = no descendants
      clone.name              = src.name + '_mirror';
      clone.userData = { isBone: true, isMirror: true };        // fresh userData, not isBone-inherited
      clone.material          = this._boneMat;
      clone.renderOrder       = 1;
      clone.scale.x = -clone.scale.x;                           // reflect across midline
      src.parent.add(clone);
      this.boneMeshes.set(clone.name, clone);
    });
  }

  // Swing the arms down into a natural relaxed stance.
  //
  // IMPORTANT: pose ONLY the humerus. The radius, ulna, carpals and hand are
  // children of the humerus, so they follow rigidly and keep their correct
  // anatomical elbow/wrist relationship. Earlier this method also ran
  // _pointBone() on the radius and ulna directly — but those bones' geometry
  // long-axis is skewed (+X/+Z heavy), so aligning that skewed axis to a
  // target twisted the elbow and splayed the forearm. Posing the humerus
  // alone keeps the forearm intact.
  //
  // The right-side chain has a scale=(-1,-1,-1) mirror on scapulaR, so we pose
  // the LEFT humerus and copy its local quaternion to the right — the mirror
  // yields the symmetric pose for free.
  _relaxArmsDown() {
    const downDir = new THREE.Vector3(0.14, -0.99, 0).normalize();
    const left  = this.boneMeshes.get('GEO-skeletionarm_humerusL');
    const right = this.boneMeshes.get('GEO-skeletionarm_humerusR');
    if (left) this._pointBone(left, downDir);
    if (left && right) {
      right.quaternion.copy(left.quaternion);
      right.updateMatrixWorld(true);
    }
  }

  // Rotate a bone so its long axis points along `targetWorldDir`, preserving
  // the bone's existing twist. The long axis is derived from the geometry
  // (origin sits at the proximal joint, so the bbox centre lies down the bone).
  // Use only on bones in a non-mirrored chain; for mirrored bones, copy a
  // sibling's local quaternion instead (see _relaxArmsDown).
  _pointBone(bone, targetWorldDir) {
    if (!bone.geometry) return;
    if (!bone.geometry.boundingBox) bone.geometry.computeBoundingBox();
    const localAxis = bone.geometry.boundingBox.getCenter(new THREE.Vector3());
    if (localAxis.length() < 0.02) return;        // origin-centred bone — skip
    localAxis.normalize();

    this._root.updateMatrixWorld(true);
    const curWorldQ = bone.getWorldQuaternion(new THREE.Quaternion());
    const curDir    = localAxis.applyQuaternion(curWorldQ).normalize();
    const delta     = new THREE.Quaternion().setFromUnitVectors(curDir, targetWorldDir);
    const newWorldQ = delta.multiply(curWorldQ);
    const parentWQ  = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentWQ.invert().multiply(newWorldQ));
    bone.updateMatrixWorld(true);
  }

  // World-space AABB of the posed (skinned) body-surface mesh.
  _skinWorldBox(skin) {
    const box = new THREE.Box3();
    const v   = new THREE.Vector3();
    const pos = skin.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 2500));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      skin.boneTransform(i, v);
      v.applyMatrix4(skin.matrixWorld);
      box.expandByPoint(v);
    }
    return box;
  }

  // The skeleton (static mesh tree) and the rig (armature + skinned skin) are
  // modelled in separate spots in the file. Scale + shift the rig so the posed
  // body shell overlays the skeleton.
  _alignRig() {
    const skin = this._skinMeshes[0];
    if (!skin) return;
    const rig = this._gltfRoot.getObjectByName('rig')
             || (skin.parent && skin.parent.parent) || skin.parent;
    if (!rig) return;

    this._root.updateMatrixWorld(true);
    const skelBox = this._boneBox(this._gltfRoot);
    const skelSize = skelBox.getSize(new THREE.Vector3());

    // 1 — match height.
    let kBox = this._skinWorldBox(skin);
    const f  = skelSize.y / (kBox.getSize(new THREE.Vector3()).y || 1);
    rig.scale.multiplyScalar(f);
    this._root.updateMatrixWorld(true);

    // 2 — match centre (x/z) and floor (y). World shift → rig-local.
    kBox = this._skinWorldBox(skin);
    const sC = skelBox.getCenter(new THREE.Vector3());
    const kC = kBox.getCenter(new THREE.Vector3());
    const ms = (this._gltfRoot.scale.x) || 1;
    rig.position.x += (sC.x - kC.x) / ms;
    rig.position.y += (skelBox.min.y - kBox.min.y) / ms;
    rig.position.z += (sC.z - kC.z) / ms;
    this._root.updateMatrixWorld(true);
  }

  // World-space AABB of a non-skinned mesh's own geometry.
  _wbox(obj) {
    if (obj.isMesh && obj.geometry) {
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      return obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld);
    }
    return new THREE.Box3().setFromObject(obj);
  }

  // Combined AABB of the bone meshes only (the skin mesh has an
  // unrepresentative bind-pose box and must be excluded).
  _boneBox(model) {
    const box = new THREE.Box3();
    let any = false;
    model.traverse((o) => {
      if (o.userData && o.userData.isBone) { box.union(this._wbox(o)); any = true; }
    });
    if (!any) box.setFromObject(model);
    return box;
  }

  // Scale + center so the skeleton stands on y=0 with a known height.
  _normalize(model) {
    model.updateMatrixWorld(true);
    const box1 = this._boneBox(model);
    const size = box1.getSize(new THREE.Vector3());
    const s    = TARGET_HEIGHT / (size.y || 1);
    model.scale.setScalar(s);
    model.updateMatrixWorld(true);

    const box2 = this._boneBox(model);
    const c    = box2.getCenter(new THREE.Vector3());
    model.position.x -= c.x;
    model.position.z -= c.z;
    model.position.y -= box2.min.y;
    model.updateMatrixWorld(true);
  }

  // Derive interactive joint hotspots from the real bone positions.
  _buildHotspots() {
    this._root.updateMatrixWorld(true);
    const bones = [];
    this._gltfRoot.traverse((o) => { if (o.userData && o.userData.isBone) bones.push(o); });

    const V = () => new THREE.Vector3();
    // Find a bone mesh by name substring (+ optional 'L'/'R' suffix).
    const find = (substr, side) => bones.find((o) => {
      const nm = o.name;
      if (!nm.includes(substr)) return false;
      if (side === 'L') return nm.endsWith('L');
      if (side === 'R') return nm.endsWith('R');
      return true;
    }) || null;

    const ctr = (o) => o ? this._wbox(o).getCenter(V()) : null;
    const top = (o) => { if (!o) return null; const b = this._wbox(o); const m = b.getCenter(V()); return new THREE.Vector3(m.x, b.max.y, m.z); };
    const bot = (o) => { if (!o) return null; const b = this._wbox(o); const m = b.getCenter(V()); return new THREE.Vector3(m.x, b.min.y, m.z); };
    const mid = (a, b) => (a && b) ? a.clone().lerp(b, 0.5) : (a || b || null);
    const avg = (substr) => {
      const acc = V(); let n = 0;
      bones.forEach((o) => { if (o.name.includes(substr)) { acc.add(this._wbox(o).getCenter(V())); n++; } });
      return n ? acc.multiplyScalar(1 / n) : null;
    };

    const P = {};
    [['L', 'Left'], ['R', 'Right']].forEach(([s, side]) => {
      P[side + 'Shoulder'] = top(find('humerus', s));
      P[side + 'Elbow']    = mid(bot(find('humerus', s)), top(find('radius', s)));
      P[side + 'Wrist']    = bot(find('radius', s)) || ctr(find('hand_center', s));
      P[side + 'Hip']      = top(find('femur', s));
      P[side + 'Knee']     = mid(bot(find('femur', s)), top(find('tibula', s)));
      P[side + 'Ankle']    = ctr(find('talus', s));
      P[side + 'BigToe']   = ctr(find('distal1', s));
      P[side + 'Midfoot']  = ctr(find('foot_center', s));
    });
    P.LumbarSpine   = avg('spine_lumbar');
    P.ThoracicSpine = avg('spine_thoracic');
    P.CervicalSpine = avg('spine_cervical');

    const sacral = ctr(find('sacral'));
    if (sacral) {
      P.LeftSI  = sacral.clone().add(new THREE.Vector3( 0.035, 0.015, -0.01));
      P.RightSI = sacral.clone().add(new THREE.Vector3(-0.035, 0.015, -0.01));
    }

    const r = 0.026;
    Object.entries(P).forEach(([key, pos]) => {
      if (!pos) return;
      const mat = createJointMaterial();
      mat.depthTest = false;   // hotspots always visible over opaque bones/skin
      this._shaderMats.push(mat);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 20), mat);
      sphere.position.copy(pos);
      sphere.name               = key;
      sphere.renderOrder        = 6;
      sphere.userData.jointKey  = key;
      sphere.userData.isHotspot = true;
      this._root.add(sphere);
      this.jointMeshes.set(key, sphere);
    });

    // MovementSimulator compatibility alias.
    const hip = find('hip') || find('sacral');
    if (hip) this.boneMeshes.set('Pelvis', hip);
  }

  // ── Public surface (mirrors SkeletonBuilder) ──────────────────────
  update(t) {
    if (!this.ready) return;
    this._shaderMats.forEach((m) => { if (m.uniforms && m.uniforms.time) m.uniforms.time.value = t; });
    // Gentle vertical float only — no Y-rotation, so the écorché cut stays
    // exactly on the body's sagittal midline. Disabled while the gait
    // simulator owns _root.
    if (this._idleFloat) this._root.position.y = Math.sin(t * 0.4) * 0.010;
  }

  // Toggle the body-surface shell on/off (skeleton stays whole; on the gait
  // page the shell is hidden so the full skeleton is visible to walk).
  setSkinVisible(on) {
    this._skinMeshes.forEach((m) => { m.visible = !!on; });
  }

  // Toggle the interactive joint hotspots (hidden on the gait page).
  setHotspotsVisible(on) {
    this.jointMeshes.forEach((m) => { m.visible = !!on; });
  }

  // Gait FK handles — the skeleton mesh tree is itself a hierarchy whose
  // bone origins sit at the proximal joints, so rotating a bone flexes the
  // limb below it around the correct joint.
  getGaitBones() {
    const get = (n) => {
      let o = null;
      this._gltfRoot.traverse((x) => { if (x.name === n) o = x; });
      return o;
    };
    return {
      pelvis: get('GEO-skeletionhip'),
      trunk:  get('GEO-skeletionripcage'),
      L: {
        thigh: get('GEO-skeletionleg_femurL'),
        shank: get('GEO-skeletionleg_tibulaL'),
        foot:  get('GEO-skeletionfoot_talusL'),
        arm:   get('GEO-skeletionarm_humerusL'),
      },
      R: {
        thigh: get('GEO-skeletionleg_femurR'),
        shank: get('GEO-skeletionleg_tibulaR'),
        foot:  get('GEO-skeletionfoot_talusR'),
        arm:   get('GEO-skeletionarm_humerusR'),
      },
    };
  }

  setJointPain(jointKey, painScale, color) {
    const mesh = this.jointMeshes.get(jointKey);
    if (!mesh || !mesh.material.uniforms) return;
    if (color) mesh.material.uniforms.hotspotColor.value = color;
    mesh.material.uniforms.painScale.value = painScale;
  }

  highlightJoint(jointKey, intensity = 1.0) {
    const mesh = this.jointMeshes.get(jointKey);
    if (mesh && mesh.material.uniforms) mesh.material.uniforms.hoverIntensity.value = intensity;
  }

  dimAllExcept(activeKey) {
    if (this._boneMat) this._boneMat.uniforms.dim.value = 0.30;
    this.jointMeshes.forEach((mesh, key) => {
      if (mesh.material.uniforms) mesh.material.uniforms.hoverIntensity.value = key === activeKey ? 1 : 0;
    });
  }

  resetAllOpacity() {
    if (this._boneMat) this._boneMat.uniforms.dim.value = 1.0;
    this.jointMeshes.forEach((mesh) => {
      if (mesh.material.uniforms && mesh.material.uniforms.hoverIntensity) {
        mesh.material.uniforms.hoverIntensity.value = 0;
      }
    });
  }

  getJointWorldPos(jointKey) {
    const mesh = this.jointMeshes.get(jointKey);
    if (!mesh) return new THREE.Vector3();
    return mesh.getWorldPosition(new THREE.Vector3());
  }

  // Remove every mesh + dispose every geometry/material this skeleton added to
  // the scene. Safe to call multiple times. Required so a re-built GaitPage or
  // ObjectiveSidebar doesn't leak the old skeleton's GPU resources.
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    try {
      if (this._root) {
        this._root.traverse((o) => {
          if (o.isMesh) {
            try { o.geometry?.dispose(); } catch {}
            const m = o.material;
            if (m) {
              if (Array.isArray(m)) m.forEach(x => { try { x.dispose?.(); } catch {} });
              else { try { m.dispose?.(); } catch {} }
            }
          }
        });
        if (this._root.parent) this._root.parent.remove(this._root);
      }
    } catch {}
    this._shaderMats.length = 0;
    this.boneMeshes.clear();
    this.jointMeshes.clear();
    this.ready = false;
  }
}
