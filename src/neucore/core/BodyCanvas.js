// src/neucore/core/BodyCanvas.js
// Three.js scene setup, camera, renderer, OrbitControls, raycasting
// Phase C: Adds bloom post-processing, premium lighting, ground glow.
import * as THREE from 'three';
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer }   from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass }       from 'three/examples/jsm/postprocessing/OutputPass.js';
import { bus } from './JointBus.js';

export class BodyCanvas {
  constructor(container) {
    this.container = container;
    this._skeleton  = null;
    this._fxLayer   = null;
    this._hoveredKey = null;
    this._activeKey  = null;
    this._raycaster  = new THREE.Raycaster();
    this._mouse      = new THREE.Vector2();
    this._clock      = new THREE.Clock();

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initControls();
    this._initLights();
    this._initGroundGlow();
    this._initPostProcessing();
    this._bindEvents();
    this._animate();
  }

  _initRenderer() {
    // Defensive: if a previous BodyCanvas left a canvas behind (e.g. the user
    // clicked Generate again while a prior instance was still mid-load), strip
    // every existing canvas so we don't end up with two overlapping renders.
    if (this.container) {
      Array.from(this.container.querySelectorAll('canvas')).forEach(c => c.remove());
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth || 800, this.container.clientHeight || 600);
    this.renderer.localClippingEnabled = true;   // écorché skin half-clip
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.style.position = 'relative';
    this.renderer.domElement.style.zIndex   = '1';
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040A14);
    // Exponential fog gives a softer, more cinematic depth falloff than linear
    this.scene.fog = new THREE.FogExp2(0x07111A, 0.085);
  }

  _initCamera() {
    const w = this.container.clientWidth  || 800;
    const h = this.container.clientHeight || 600;
    // Tighter FOV reads as more cinematic / less "demo"
    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.01, 50);
    this.camera.position.set(0.4, 1.0, 3.4);
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan    = false;
    this.controls.enableZoom   = true;
    this.controls.minDistance  = 1.0;
    this.controls.maxDistance  = 8.0;
    this.controls.minPolarAngle = Math.PI * 0.1;
    this.controls.maxPolarAngle = Math.PI * 0.9;
    this.controls.autoRotate    = true;
    this.controls.autoRotateSpeed = 0.4;
    this.controls.target.set(0, 0.85, 0);
    this.controls.update();
  }

  _initLights() {
    // Cool ambient base
    this.scene.add(new THREE.AmbientLight(0x0E1A28, 1.8));

    // Key — teal/cyan from front-top-left
    const key = new THREE.DirectionalLight(0x67E8F9, 0.85);
    key.position.set(-2.5, 4, 3);
    this.scene.add(key);

    // Rim — cooler cyan from behind, picks out silhouette
    const rim = new THREE.DirectionalLight(0x14B8A6, 0.55);
    rim.position.set(2, 2.5, -3.5);
    this.scene.add(rim);

    // Warm bounce — gold under-light for premium contrast
    const bounce = new THREE.DirectionalLight(0xD4AF37, 0.18);
    bounce.position.set(0, -2, 2);
    this.scene.add(bounce);

    // Subtle hemisphere — sky/ground tint
    const hemi = new THREE.HemisphereLight(0x67E8F9, 0x040A14, 0.35);
    this.scene.add(hemi);
  }

  _initGroundGlow() {
    // Soft circular emissive disc beneath the figure — anchors the scene + adds depth
    const geo = new THREE.CircleGeometry(2.2, 64);
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float d = length(c) * 2.0;
          float ring  = smoothstep(1.0, 0.0, d);
          float pulse = 0.85 + 0.15 * sin(time * 0.8);
          vec3 teal   = vec3(0.078, 0.722, 0.651);
          vec3 cyan   = vec3(0.404, 0.910, 0.976);
          vec3 col    = mix(teal, cyan, ring) * ring * pulse;
          gl_FragColor = vec4(col, ring * 0.55);
        }
      `,
    });
    this._groundGlow = new THREE.Mesh(geo, mat);
    this._groundGlow.rotation.x = -Math.PI / 2;
    this._groundGlow.position.y = -0.02;
    this.scene.add(this._groundGlow);
  }

  _initPostProcessing() {
    const w = this.container.clientWidth  || 800;
    const h = this.container.clientHeight || 600;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // UnrealBloom: (resolution, strength, radius, threshold)
    // Restrained settings — a crisp rim glow, not a hazy bright wash.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.32,   // strength — subtle glow only
      0.28,   // radius   — tight, not blurry
      0.62    // threshold — only the very brightest pixels bloom
    );
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());
  }

  _bindEvents() {
    this.renderer.domElement.addEventListener('pointermove', (e) => this._onMove(e));
    this.renderer.domElement.addEventListener('click',       (e) => this._onClick(e));
    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
    if (this.bloom)    this.bloom.setSize(w, h);
  }

  _getJointMeshes() {
    return this._skeleton ? [...this._skeleton.jointMeshes.values()] : [];
  }

  _raycast(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this.camera);
    return this._raycaster.intersectObjects(this._getJointMeshes(), false);
  }

  _onMove(e) {
    if (!this._skeleton) return;
    const hits = this._raycast(e);
    const key  = hits.length ? (hits[0].object.userData.jointKey ?? hits[0].object.name) : null;

    if (key !== this._hoveredKey) {
      if (this._hoveredKey) bus.emit('joint:hoverout', { jointKey: this._hoveredKey });
      this._hoveredKey = key;
      if (key) {
        this._skeleton.highlightJoint(key, 0.6);
        bus.emit('joint:hover', { jointKey: key });
        this.renderer.domElement.style.cursor = 'pointer';
        this.controls.autoRotate = false;
      } else {
        this.renderer.domElement.style.cursor = '';
        if (!this._activeKey) this.controls.autoRotate = true;
      }
    }
  }

  _onClick(e) {
    if (!this._skeleton) return;
    const hits = this._raycast(e);
    if (!hits.length) {
      // Deselect
      if (this._activeKey) {
        bus.emit('joint:deselect', { jointKey: this._activeKey });
        this._skeleton.resetAllOpacity();
        this._activeKey = null;
        this.controls.autoRotate = true;
      }
      return;
    }
    const key = hits[0].object.userData.jointKey ?? hits[0].object.name;
    if (key === this._activeKey) return;

    this._activeKey = key;
    this._skeleton.dimAllExcept(key);
    this.controls.autoRotate = false;

    // Zoom camera toward joint
    const worldPos = this._skeleton.getJointWorldPos(key);
    this._zoomToJoint(worldPos);

    bus.emit('joint:select', { jointKey: key, worldPos });
  }

  animateCameraTo(targetVec, camPosVec, duration = 1200) {
    const from       = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const ease       = t => t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    const t0         = performance.now();
    const tick = (now) => {
      const raw = Math.min((now - t0) / duration, 1);
      const t   = ease(raw);
      this.camera.position.lerpVectors(from, camPosVec, t);
      this.controls.target.lerpVectors(fromTarget, targetVec, t);
      this.controls.update();
      if (raw < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _zoomToJoint(worldPos) {
    const target = worldPos.clone();
    const camTo  = target.clone().add(new THREE.Vector3(0.3, 0.2, 0.8));
    const start  = { t: 0 };
    const from   = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
    const to     = { x: camTo.x, y: camTo.y, z: camTo.z };
    const fromTarget = this.controls.target.clone();

    const ease = (t) => t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    const dur  = 800;
    const t0   = performance.now();

    const tick = (now) => {
      const raw = Math.min((now - t0) / dur, 1);
      const t   = ease(raw);
      this.camera.position.set(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
        from.z + (to.z - from.z) * t,
      );
      this.controls.target.lerpVectors(fromTarget, target, t);
      this.controls.update();
      if (raw < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _animate() {
    if (this._disposed) return;            // stop the rAF loop once destroyed
    this._rafId = requestAnimationFrame(() => this._animate());
    const t = this._clock.getElapsedTime();
    this.controls.update();
    if (this._skeleton)  this._skeleton.update(t);
    if (this._fxLayer)   this._fxLayer.update();
    if (this._groundGlow) this._groundGlow.material.uniforms.time.value = t;
    if (this.composer)   this.composer.render();
    else                 this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this._disposed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._fxLayer && typeof this._fxLayer.destroy === 'function') {
      try { this._fxLayer.destroy(); } catch {}
    }
    if (this._skeleton && typeof this._skeleton.destroy === 'function') {
      try { this._skeleton.destroy(); } catch {}
    }
    try { this.controls?.dispose(); } catch {}
    try { this.composer?.dispose?.(); } catch {}
    try { this.renderer?.dispose(); } catch {}
    try { this.renderer?.forceContextLoss?.(); } catch {}
    if (this.renderer?.domElement && this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
