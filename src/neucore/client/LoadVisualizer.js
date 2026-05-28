// src/neucore/client/LoadVisualizer.js
// Client Dashboard hero — a single GLBSkeleton-driven 3D figure whose
// coloring toggles between Point A (current overload state, warm reds)
// and Point B (target balanced state, cool teals). Per-region load is
// surfaced through the skeleton's joint hotspots so the viewer can
// see exactly which areas are loaded.
//
// Public surface:
//   const viz = new LoadVisualizer(hostEl, profile);
//   viz.setState('A' | 'B');
//   viz.destroy();
//
// `profile` is the object returned by deriveLoadProfile() in
// loadMetrics.js.

import * as THREE from 'three';
import { BodyCanvas }   from '../core/BodyCanvas.js';
import { GLBSkeleton }  from '../skeleton/GLBSkeleton.js';
import { loadToColor, REGION_TO_JOINT } from './loadMetrics.js';

// Material tints for the overall bone shader: warm reds for the
// overworked state, cool teals for the balanced state. Subtle — the
// per-region hotspot colors do the heavy lifting.
const TINT_A = {
  base: new THREE.Color(0xC78A8A),   // warm bone
  deep: new THREE.Color(0x281418),
  rim:  new THREE.Color(0xFF2D78),   // magenta rim
};
const TINT_B = {
  base: new THREE.Color(0x8AC7B0),   // cool bone
  deep: new THREE.Color(0x0E2A22),
  rim:  new THREE.Color(0x3DF5C1),   // teal rim
};

export class LoadVisualizer {
  constructor(hostEl, profile) {
    this.host    = hostEl;
    this.profile = profile;
    this.state   = 'A';
    this._disposed = false;
    this._buildToken = 0;
    this._build();
  }

  // ── Public API ───────────────────────────────────────────────────
  setState(state) {
    if (state !== 'A' && state !== 'B') return;
    this.state = state;
    this._applyColors();
  }

  destroy() {
    this._disposed = true;
    this._buildToken += 1;
    try { this.skeleton?.destroy?.(); } catch {}
    try { this.bodyCanvas?.destroy?.(); } catch {}
    this.skeleton   = null;
    this.bodyCanvas = null;
  }

  // ── Build ────────────────────────────────────────────────────────
  async _build() {
    if (!this.host || this._disposed) return;
    this.host.innerHTML = '';

    this.bodyCanvas = new BodyCanvas(this.host);

    const loader = document.createElement('div');
    loader.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;
      justify-content:center;flex-direction:column;gap:12px;color:#67E8F9;font-size:11px;
      letter-spacing:.16em;text-transform:uppercase;z-index:30;text-align:center;
      pointer-events:none;`;
    loader.textContent = 'Loading anatomy…';
    this.host.appendChild(loader);

    const myBuild = ++this._buildToken;
    this.skeleton = new GLBSkeleton(this.bodyCanvas.scene);
    try {
      await this.skeleton.build();
    } catch (err) {
      console.error('[LoadVisualizer] skeleton load failed:', err);
      if (this._disposed || myBuild !== this._buildToken) return;
      loader.style.pointerEvents = 'auto';
      loader.innerHTML = `
        <div style="color:#FF6B6B;font-size:12px;letter-spacing:.04em;text-transform:none">
          3D anatomy failed to load
        </div>
        <button id="load-viz-retry" class="nc-toolbar-btn"
          style="cursor:pointer;text-transform:none">↻ Retry</button>`;
      loader.querySelector('#load-viz-retry')
        ?.addEventListener('click', () => this._build());
      return;
    }
    if (this._disposed || myBuild !== this._buildToken) {
      try { this.skeleton.destroy?.(); } catch {}
      return;
    }
    loader.remove();

    // Hotspots are the per-region load indicators here. Bones stay
    // visible; the skin shell stays hidden so the load coloring reads
    // clearly without the muscle layer competing for attention.
    this.skeleton.setSkinVisible?.(false);
    this.skeleton.setHotspotsVisible?.(true);

    this._applyColors();
  }

  // ── Coloring ─────────────────────────────────────────────────────
  _applyColors() {
    if (!this.skeleton || !this.skeleton.ready) return;
    const isA  = this.state === 'A';
    const tint = isA ? TINT_A : TINT_B;
    const map  = isA ? this.profile.currentA : this.profile.targetB;

    // Recolor the shared bone material.
    const mat = this.skeleton._boneMat;
    if (mat && mat.uniforms) {
      mat.uniforms.baseColor.value.copy(tint.base);
      mat.uniforms.deepColor.value.copy(tint.deep);
      mat.uniforms.rimColor.value.copy(tint.rim);
    }

    // Per-region hotspot coloring. setJointPain takes a 0-10 pain
    // scale and a color; the higher the value, the brighter the
    // hotspot reads.
    Object.entries(map).forEach(([region, pct]) => {
      const jointKey = REGION_TO_JOINT[region];
      if (!jointKey) return;
      const color = loadToColor(pct);
      const painScale = pct / 10;   // 0-100 % → 0-10 pain
      this.skeleton.setJointPain?.(jointKey, painScale, color);
    });
  }
}
