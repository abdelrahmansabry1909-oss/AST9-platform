// src/neucore/core/FXLayer.js
import * as THREE from 'three';
import { bus } from './JointBus.js';
import { NEUCORE_PALETTE } from './MaterialFactory.js';

export class FXLayer {
  constructor(bodyCanvas, skeleton) {
    this.body       = bodyCanvas;
    this.skeleton   = skeleton;
    this.scene      = bodyCanvas.scene;
    this._particles = new Map();
    this._romArcs   = new Map();
    this._clock     = new THREE.Clock();
    this._bgCanvas  = null;
    this._bgNodes   = [];

    this._initBackground();
    this._initSpineGlow();
    this._bindEvents();
  }

  _initBackground() {
    const container = this.body.container;
    this._bgCanvas  = document.createElement('canvas');
    this._bgCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    container.style.position = 'relative';
    container.insertBefore(this._bgCanvas, container.firstChild);
    this.body.renderer.domElement.style.position = 'relative';
    this.body.renderer.domElement.style.zIndex   = '1';
    this._bgCtx = this._bgCanvas.getContext('2d');
    this._resizeBg();
    window.addEventListener('resize', () => this._resizeBg());
    this._generateNodes(45);
    this._animateBg();
  }

  _resizeBg() {
    this._bgCanvas.width  = this._bgCanvas.offsetWidth  || 800;
    this._bgCanvas.height = this._bgCanvas.offsetHeight || 600;
  }

  _generateNodes(n) {
    const w = this._bgCanvas.width, h = this._bgCanvas.height;
    this._bgNodes = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3,
      r: Math.random() * 3 + 2,
      color: Math.random() > .6 ? '#FF2D7844' : '#00D4FF44',
      bokeh: Math.random() > .75,
      bokehR: Math.random() * 40 + 15,
    }));
  }

  _animateBg() {
    if (this._disposed) return;
    this._bgRafId = requestAnimationFrame(() => this._animateBg());
    const ctx = this._bgCtx;
    const w   = this._bgCanvas.width, h = this._bgCanvas.height;
    const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/1.2);
    grad.addColorStop(0,   '#0A1628');
    grad.addColorStop(0.5, '#060E1A');
    grad.addColorStop(1,   '#030810');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    this._bgNodes.forEach(n => {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < 0 || n.y > h) n.vy *= -1;
    });

    this._bgNodes.filter(n => n.bokeh).forEach(n => {
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.bokehR);
      g.addColorStop(0, n.color.replace('44', '55'));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.bokehR, 0, Math.PI * 2);
      ctx.fill();
    });

    const pts = this._bgNodes.filter(n => !n.bokeh);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < 160) {
          ctx.strokeStyle = `rgba(0,100,140,${(1 - d/160) * .22})`;
          ctx.lineWidth = .5;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }
    pts.forEach(n => {
      ctx.fillStyle = '#00D4FF55';
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  _initSpineGlow() {
    const pts = [0, .3, .6, .9, 1.2, 1.5, 1.7].map(y => new THREE.Vector3(0, y, 0));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: 0xFF2D78, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending,
    });
    this._spineGlow = new THREE.Line(geo, mat);
    this.scene.add(this._spineGlow);
  }

  createRomArc(jointKey, worldPos, radius = 0.14) {
    if (this._romArcs.has(jointKey)) this.removeRomArc(jointKey);
    const pts = Array.from({ length: 65 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    });
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: NEUCORE_PALETTE.romArc, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    const arc = new THREE.Line(geo, mat);
    arc.position.copy(worldPos);
    arc.userData.rotSpeed = 0.3;
    this.scene.add(arc);
    this._romArcs.set(jointKey, arc);
    this._tweenOpacity(mat, 0, .65, 120);
  }

  removeRomArc(jointKey) {
    const arc = this._romArcs.get(jointKey);
    if (!arc) return;
    this._tweenOpacity(arc.material, arc.material.opacity, 0, 150, () => {
      this.scene.remove(arc);
      arc.geometry.dispose();
    });
    this._romArcs.delete(jointKey);
  }

  burstParticles(jointKey) {
    const ps = this._particles.get(jointKey);
    if (!ps) return;
    ps.material.opacity = 1.0;
    setTimeout(() => { ps.material.opacity = 0.55; }, 350);
  }

  spawnParticles(jointKey, pos) {
    if (this._particles.has(jointKey)) return;
    const count  = 70;
    const posArr = new Float32Array(count * 3);
    const colArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const r  = .04 + Math.random() * .10;
      posArr[i*3]   = pos.x + r * Math.sin(ph) * Math.cos(th);
      posArr[i*3+1] = pos.y + r * Math.sin(ph) * Math.sin(th);
      posArr[i*3+2] = pos.z + r * Math.cos(ph);
      const t = Math.random();
      colArr[i*3] = t; colArr[i*3+1] = .08; colArr[i*3+2] = 1 - t;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));
    const mat = new THREE.PointsMaterial({
      size: .013, vertexColors: true, transparent: true, opacity: .55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ps = new THREE.Points(geo, mat);
    ps.userData = { base: pos.clone(), t: Math.random() * 10 };
    this.scene.add(ps);
    this._particles.set(jointKey, ps);
  }

  update() {
    const t = this._clock.getElapsedTime();
    this._romArcs.forEach(arc => { arc.rotation.y += arc.userData.rotSpeed * .016; });
    this._particles.forEach(ps => {
      const pos  = ps.geometry.attributes.position;
      const base = ps.userData.base;
      const off  = ps.userData.t;
      for (let i = 0; i < pos.count; i++) {
        const th = (i / pos.count) * Math.PI * 2 + t * .4 + off;
        const ph = Math.sin(t * .3 + i * .1) * Math.PI;
        const r  = .05 + Math.sin(t * 2 + i) * .018;
        pos.setXYZ(i,
          base.x + r * Math.sin(ph) * Math.cos(th),
          base.y + r * Math.cos(ph),
          base.z + r * Math.sin(ph) * Math.sin(th),
        );
      }
      pos.needsUpdate = true;
    });
    if (this._spineGlow) {
      this._spineGlow.material.opacity = .12 + Math.sin(t * 1.5) * .12;
    }
  }

  removeParticles(jointKey) {
    const ps = this._particles.get(jointKey);
    if (!ps) return;
    this._particles.delete(jointKey);
    this._tweenOpacity(ps.material, ps.material.opacity, 0, 200, () => {
      this.scene.remove(ps);
      ps.geometry.dispose();
      ps.material.dispose();
    });
  }

  _bindEvents() {
    bus.on('joint:hover', ({ jointKey }) => {
      const pos = this.skeleton?.getJointWorldPos(jointKey);
      if (pos) {
        this.createRomArc(jointKey, pos);
        this.spawnParticles(jointKey, pos);
        this.burstParticles(jointKey);
      }
    });
    bus.on('joint:hoverout', ({ jointKey }) => {
      this.removeRomArc(jointKey);
      this.removeParticles(jointKey);
    });
  }

  _tweenOpacity(mat, from, to, dur, cb) {
    const s = performance.now();
    const tick = (now) => {
      const t = Math.min((now - s) / dur, 1);
      mat.opacity = from + (to - from) * t;
      if (t < 1) requestAnimationFrame(tick); else cb?.();
    };
    requestAnimationFrame(tick);
  }

  destroy() {
    this._disposed = true;
    if (this._bgRafId) cancelAnimationFrame(this._bgRafId);
    if (this._bgCanvas && this._bgCanvas.parentNode) {
      this._bgCanvas.parentNode.removeChild(this._bgCanvas);
    }
    if (this._spineGlow) {
      try { this.scene.remove(this._spineGlow); this._spineGlow.geometry.dispose(); this._spineGlow.material.dispose(); } catch {}
      this._spineGlow = null;
    }
    this._romArcs.forEach((arc) => {
      try { this.scene.remove(arc); arc.geometry.dispose(); arc.material.dispose(); } catch {}
    });
    this._romArcs.clear();
    this._particles.forEach((ps) => {
      try { this.scene.remove(ps); ps.geometry.dispose(); ps.material.dispose(); } catch {}
    });
    this._particles.clear();
  }
}
