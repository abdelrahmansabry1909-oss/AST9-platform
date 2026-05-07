// src/neucore/core/BodyCanvas.js
// Three.js scene setup, camera, renderer, OrbitControls, raycasting
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
    this._bindEvents();
    this._animate();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth || 800, this.container.clientHeight || 600);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.domElement.style.position = 'relative';
    this.renderer.domElement.style.zIndex   = '1';
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050D1A);
    this.scene.fog = new THREE.Fog(0x050D1A, 6, 18);
  }

  _initCamera() {
    const w = this.container.clientWidth  || 800;
    const h = this.container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 50);
    this.camera.position.set(0, 0.9, 3.2);
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
    this.scene.add(new THREE.AmbientLight(0x0A1628, 1.5));
    const dirL = new THREE.DirectionalLight(0x00D4FF, 0.4);
    dirL.position.set(3, 4, 3);
    this.scene.add(dirL);
    const dirR = new THREE.DirectionalLight(0xFF2D78, 0.2);
    dirR.position.set(-3, -2, -3);
    this.scene.add(dirR);
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
    requestAnimationFrame(() => this._animate());
    const t = this._clock.getElapsedTime();
    this.controls.update();
    if (this._skeleton) this._skeleton.update(t);
    if (this._fxLayer)  this._fxLayer.update();
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
