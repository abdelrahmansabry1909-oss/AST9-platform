// src/neucore/core/MaterialFactory.js
import * as THREE from 'three';

export const NEUCORE_PALETTE = {
  boneBase:     new THREE.Color(0x00D4FF),
  boneRim:      new THREE.Color(0x7FFFFC),
  jointDefault: new THREE.Color(0x00AAFF),
  jointActive:  new THREE.Color(0xFF2D78),
  jointHover:   new THREE.Color(0x00FFF0),
  background:   new THREE.Color(0x050D1A),
  particleMag:  new THREE.Color(0xFF2D78),
  particleCyan: new THREE.Color(0x00D4FF),
  romArc:       new THREE.Color(0x00FFF0),
};

const VERT = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec2 vUv;
  void main() {
    vNormal   = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position,1.0)).xyz;
    vUv       = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }
`;

const BONE_FRAG = `
  uniform float time;
  uniform vec3  baseColor;
  uniform vec3  rimColor;
  uniform float rimPower;
  uniform float opacity;
  uniform float emissiveStrength;
  uniform vec3  emissiveColor;
  varying vec3  vNormal;
  varying vec3  vPosition;
  varying vec2  vUv;
  void main() {
    vec3 viewDir = normalize(-vPosition);
    float rim    = pow(1.0 - max(dot(viewDir, vNormal), 0.0), rimPower);
    float scan   = sin(vUv.y * 80.0 + time * 2.0) * 0.04 + 0.96;
    float pulse  = sin(vPosition.y * 3.0 - time * 1.5) * 0.08 + 0.92;
    vec3 col     = mix(baseColor, rimColor, rim * 0.7) * scan * pulse;
    col         += emissiveColor * emissiveStrength;
    gl_FragColor = vec4(col, opacity + rim * 0.3);
  }
`;

const JOINT_FRAG = `
  uniform float time;
  uniform vec3  hotspotColor;
  uniform float painScale;
  uniform float hoverIntensity;
  varying vec3  vNormal;
  varying vec3  vPosition;
  void main() {
    vec3 viewDir  = normalize(-vPosition);
    float rim     = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 1.5);
    float pulse   = sin(time * 6.0 + painScale) * 0.5 + 0.5;
    float base    = mix(0.4, 1.0, painScale / 10.0);
    float hover   = hoverIntensity * 0.5;
    vec3  col     = hotspotColor * (rim * base + pulse * 0.3 + hover);
    gl_FragColor  = vec4(col, 0.55 + rim * 0.4 + hover);
  }
`;

export function createBoneMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time:             { value: 0 },
      baseColor:        { value: NEUCORE_PALETTE.boneBase.clone() },
      rimColor:         { value: NEUCORE_PALETTE.boneRim.clone() },
      // Cleaner look: more opaque bones (less haze), restrained emissive
      rimPower:         { value: 2.8 },
      opacity:          { value: 0.62 },
      emissiveStrength: { value: 0.20 },
      emissiveColor:    { value: NEUCORE_PALETTE.boneBase.clone() },
    },
    vertexShader:   VERT,
    fragmentShader: BONE_FRAG,
    transparent:    true,
    side:           THREE.DoubleSide,
    depthWrite:     false,
  });
}

export function createJointMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time:           { value: 0 },
      hotspotColor:   { value: NEUCORE_PALETTE.jointDefault.clone() },
      painScale:      { value: 0 },
      hoverIntensity: { value: 0 },
    },
    vertexShader:   VERT,
    fragmentShader: JOINT_FRAG,
    transparent:    true,
    side:           THREE.DoubleSide,
    depthWrite:     false,
  });
}

// Pain scale 0–10 → THREE.Color interpolation
export function painToColor(scale) {
  const stops = [
    [0,   0x00AAFF],
    [0.2, 0x00FF88],
    [0.4, 0xFFDD00],
    [0.6, 0xFF6600],
    [0.8, 0xFF2D78],
    [1.0, 0x8B0033],
  ];
  const t = Math.min(Math.max(scale / 10, 0), 1);
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i+1][0]) {
      const lt = (t - stops[i][0]) / (stops[i+1][0] - stops[i][0]);
      return new THREE.Color(stops[i][1]).lerp(new THREE.Color(stops[i+1][1]), lt);
    }
  }
  return new THREE.Color(stops[stops.length-1][1]);
}
