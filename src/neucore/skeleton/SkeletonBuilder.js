// src/neucore/skeleton/SkeletonBuilder.js
import * as THREE from 'three';
import { SKELETON_GROUPS, ALL_INTERACTIVE_JOINTS } from './BoneDefinitions.js';
import { createBoneMaterial, createJointMaterial, NEUCORE_PALETTE } from '../core/MaterialFactory.js';
import { bus } from '../core/JointBus.js';

export class SkeletonBuilder {
  constructor(scene) {
    this.scene      = scene;
    this.boneMeshes  = new Map();   // boneId → Mesh
    this.jointMeshes = new Map();   // jointKey → Mesh (interactive joints)
    this._shaderMats = [];
    this._root       = new THREE.Group();
    scene.add(this._root);
  }

  build() {
    const boneMat = createBoneMaterial();
    this._shaderMats.push(boneMat);

    Object.entries(SKELETON_GROUPS).forEach(([, bones]) => {
      bones.forEach(bone => {
        const geo = new THREE.BoxGeometry(...bone.size);
        let mat;

        if (bone.interactive) {
          mat = createJointMaterial();
          this._shaderMats.push(mat);
        } else {
          mat = boneMat;
        }

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(...bone.pos);
        mesh.name = bone.id;
        this._root.add(mesh);
        this.boneMeshes.set(bone.id, mesh);

        if (bone.interactive) {
          this.jointMeshes.set(bone.id, mesh);
        }
      });
    });

    this._addJointHotspots();
    this._addConnectionLines();

    return this._root;
  }

  _addJointHotspots() {
    const HOTSPOT_POSITIONS = {
      LeftShoulder:  [-0.18, 1.415, 0],
      RightShoulder: [ 0.18, 1.415, 0],
      LeftElbow:     [-0.20, 1.07,  0],
      RightElbow:    [ 0.20, 1.07,  0],
      LeftWrist:     [-0.21, 0.870, 0],
      RightWrist:    [ 0.21, 0.870, 0],
      LeftHip:       [-0.09, 0.990, 0],
      RightHip:      [ 0.09, 0.990, 0],
      LeftKnee:      [-0.09, 0.660, 0],
      RightKnee:     [ 0.09, 0.660, 0],
      LeftAnkle:     [-0.09, 0.120, 0],
      RightAnkle:    [ 0.09, 0.120, 0],
      LeftBigToe:    [-0.075,0.050, 0.09],
      RightBigToe:   [ 0.075,0.050, 0.09],
      LumbarSpine:   [0,     1.150, 0],
      ThoracicSpine: [0,     1.330, -0.02],
      CervicalSpine: [0,     1.520, 0],
      LeftSI:        [-0.04, 1.060, -0.02],
      RightSI:       [ 0.04, 1.060, -0.02],
      LeftMidfoot:   [-0.09, 0.075, 0.04],
      RightMidfoot:  [ 0.09, 0.075, 0.04],
    };

    Object.entries(HOTSPOT_POSITIONS).forEach(([jointKey, pos]) => {
      const geo = new THREE.SphereGeometry(0.022, 16, 16);
      const mat = createJointMaterial();
      this._shaderMats.push(mat);

      const sphere = new THREE.Mesh(geo, mat);
      sphere.position.set(...pos);
      sphere.name = jointKey;
      sphere.userData.isHotspot = true;
      sphere.userData.jointKey  = jointKey;
      this._root.add(sphere);
      this.jointMeshes.set(jointKey, sphere);
    });
  }

  _addConnectionLines() {
    const CONNECTIONS = [
      ['Skull', 'C1_Atlas'], ['C1_Atlas', 'C7'], ['C7', 'T1'],
      ['T12', 'L1'], ['L5', 'Sacrum'], ['Sacrum', 'Pelvis'],
      ['LeftClavicle',  'LeftHumerus'],  ['LeftHumerus',  'LeftRadius'],  ['LeftRadius',  'LeftCarpals'],
      ['RightClavicle', 'RightHumerus'], ['RightHumerus', 'RightRadius'], ['RightRadius', 'RightCarpals'],
      ['Pelvis', 'LeftFemur'],  ['LeftFemur',  'LeftTibia'],  ['LeftTibia',  'LeftTalus'],  ['LeftTalus',  'LeftMTP1'],
      ['Pelvis', 'RightFemur'], ['RightFemur', 'RightTibia'], ['RightTibia', 'RightTalus'], ['RightTalus', 'RightMTP1'],
    ];

    const lineMat = new THREE.LineBasicMaterial({
      color: NEUCORE_PALETTE.boneBase,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
    });

    CONNECTIONS.forEach(([fromId, toId]) => {
      const from = this.boneMeshes.get(fromId);
      const to   = this.boneMeshes.get(toId);
      if (!from || !to) return;

      const points = [from.position.clone(), to.position.clone()];
      const geo    = new THREE.BufferGeometry().setFromPoints(points);
      const line   = new THREE.Line(geo, lineMat);
      this._root.add(line);
    });
  }

  update(t) {
    this._shaderMats.forEach(mat => {
      if (mat.uniforms?.time) mat.uniforms.time.value = t;
    });
    this._root.position.y = Math.sin(t * 0.4) * 0.012;
    this._root.rotation.y = Math.sin(t * 0.15) * 0.018;
  }

  setJointPain(jointKey, painScale, color) {
    const mesh = this.jointMeshes.get(jointKey);
    if (!mesh) return;
    if (mesh.material.uniforms) {
      mesh.material.uniforms.hotspotColor.value = color;
      mesh.material.uniforms.painScale.value    = painScale;
    }
  }

  highlightJoint(jointKey, intensity = 1.0) {
    const mesh = this.jointMeshes.get(jointKey);
    if (!mesh?.material?.uniforms) return;
    mesh.material.uniforms.hoverIntensity.value = intensity;
  }

  dimAllExcept(activeKey) {
    this.jointMeshes.forEach((mesh, key) => {
      if (!mesh.material.uniforms) return;
      mesh.material.uniforms.hoverIntensity.value = key === activeKey ? 1 : 0;
    });
    this._root.traverse(child => {
      if (child.isMesh && child !== this.jointMeshes.get(activeKey)) {
        if (child.material.transparent !== undefined) {
          child.material.opacity = 0.25;
          child.material.transparent = true;
        }
      }
    });
  }

  resetAllOpacity() {
    this._root.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.opacity = child.material.uniforms?.opacity?.value ?? 0.55;
      }
    });
    this.jointMeshes.forEach(mesh => {
      if (mesh.material.uniforms?.hoverIntensity) {
        mesh.material.uniforms.hoverIntensity.value = 0;
      }
    });
  }

  getJointWorldPos(jointKey) {
    const mesh = this.jointMeshes.get(jointKey);
    if (!mesh) return new THREE.Vector3();
    const pos = new THREE.Vector3();
    mesh.getWorldPosition(pos);
    return pos;
  }
}
