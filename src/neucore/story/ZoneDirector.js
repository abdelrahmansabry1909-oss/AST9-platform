// src/neucore/story/ZoneDirector.js
// E2 — anatomy-zone navigation for the Objective tab (ASSESSMENT_STORYTELLING_ARCHITECTURE.md §2–§3, §10).
//
// Navigation + camera choreography ONLY. No field moves, no data writes, no new
// GLBSkeleton API: zone focus composes dimAllExcept(firstJoint) + highlightJoint(rest),
// and pain colors survive because they live in separate shader uniforms.
//
// Self-guarding: constructed only after the skeleton loads and only if the rail
// root exists in the markup — absent either, the Objective tab behaves exactly
// as before (the tab row remains the permanent fallback).
import * as THREE from 'three';
import { ZONES } from './zones.js';
import { bus } from '../core/JointBus.js';

const TWEEN_MS = 600;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class ZoneDirector {
  constructor({ canvas, skeleton, rail }) {
    this.canvas   = canvas;     // BodyCanvas (camera, controls, renderer)
    this.skeleton = skeleton;   // GLBSkeleton (hotspots, world positions)
    this.rail     = rail;
    this.activeKey = null;
    this.hoverKey  = null;
    this._tweenId  = null;
    this._reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The pose the coach starts from — also the 'integration' / deselect pose.
    this._overview = {
      target: canvas.controls.target.clone(),
      pos:    canvas.camera.position.clone(),
    };
    this._autoRotateDefault = canvas.controls.autoRotate;
    // holdAutoRotate: BodyCanvas's hover/deselect paths re-enable autoRotate on
    // their own; this flag asks them not to while a zone (or reduced motion)
    // owns the camera.
    canvas.holdAutoRotate = this._reduced;
    if (this._reduced) canvas.controls.autoRotate = false;

    // Clicking a 3D hotspot: BodyCanvas zooms itself — we only align the rail.
    bus.on('joint:select', ({ jointKey }) => this.alignToJoint(jointKey));
    // Clicking empty space: BodyCanvas resets all opacity *after* this event —
    // re-apply the zone focus once its handler has run.
    bus.on('joint:deselect', () => {
      if (this.activeKey) setTimeout(() => this._refreshHighlights(), 0);
    });

    // Preallocated spherical scratch — zone framing never allocates per call (§8).
    this._sph = new THREE.Spherical();

    // The hologram is decorative reinforcement; every datum lives in the form (§9).
    this.canvas.container.setAttribute('aria-hidden', 'true');

    // The coach's hand always wins: any direct canvas interaction cancels the tween.
    const dom = canvas.renderer.domElement;
    ['pointerdown', 'wheel', 'touchstart'].forEach((ev) =>
      dom.addEventListener(ev, () => this._cancelTween(), { passive: true }));

    this._renderRail();
    this._bindKeyboard();
  }

  // ── rail ──────────────────────────────────────────────────────────
  _renderRail() {
    this.rail.setAttribute('role', 'tablist');
    this.rail.setAttribute('aria-label', 'Anatomy zones');
    this.rail.setAttribute('aria-orientation', 'vertical');
    this.rail.innerHTML = '';
    ZONES.forEach((z) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'zone-chip';
      chip.id = `zone-tab-${z.key}`;
      chip.dataset.zone = z.key;
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', 'false');
      chip.tabIndex = z.ordinal === 1 ? 0 : -1;
      // Label only — no ordinal badge. Completion reads as a teal-lit chip;
      // the journey dots and stage headers carry the explicit count.
      chip.innerHTML = `<span class="zone-chip-label">${z.label}</span>`;
      chip.addEventListener('click', () => this.toggle(z.key));
      chip.addEventListener('mouseenter', () => { this.hoverKey = z.key; this._refreshHighlights(); });
      chip.addEventListener('mouseleave', () => { this.hoverKey = null;  this._refreshHighlights(); });
      this.rail.appendChild(chip);
    });
  }

  _bindKeyboard() {
    this.rail.addEventListener('keydown', (e) => {
      const chips = [...this.rail.querySelectorAll('.zone-chip')];
      const idx = chips.indexOf(document.activeElement);
      if (idx === -1) return;
      let next = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = Math.min(idx + 1, chips.length - 1);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = Math.max(idx - 1, 0);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = chips.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(chips[idx].dataset.zone); return; }
      else if (e.key === 'Escape') { this._deselect(); return; }
      if (next === null) return;
      e.preventDefault();
      chips.forEach((c, i) => { c.tabIndex = i === next ? 0 : -1; });
      chips[next].focus();
    });
  }

  // ── selection ─────────────────────────────────────────────────────
  toggle(key) { key === this.activeKey ? this._deselect() : this.activate(key); }

  activate(key) {
    const zone = ZONES.find((z) => z.key === key);
    if (!zone) return;
    this.activeKey = key;
    this._syncRail();
    this._refreshHighlights();
    this.canvas.holdAutoRotate = true;
    this.canvas.controls.autoRotate = false;
    bus.emit('zone:change', { key });   // E3 stage expands synchronously here
    this._flyTo(zone);
    this._scrollZoneFields(zone);
  }

  _deselect() {
    this.activeKey = null;
    this._syncRail();
    this._refreshHighlights();
    this.canvas.holdAutoRotate = this._reduced;
    if (!this._reduced) this.canvas.controls.autoRotate = this._autoRotateDefault;
    bus.emit('zone:change', { key: null });
    this._tweenCamera(this._overview.target, this._overview.pos);
  }

  // Called by main.js when a 3D hotspot is clicked — aligns the rail to where
  // the coach is already looking, without moving the camera under their click.
  alignToJoint(jointKey) {
    const zone = ZONES.find((z) => z.joints.includes(jointKey));
    if (!zone || zone.key === this.activeKey) return;
    this.activeKey = zone.key;
    this.canvas.holdAutoRotate = true;   // the zone owns the camera until deselect
    this._syncRail();
    this._refreshHighlights();
    bus.emit('zone:change', { key: zone.key });
  }

  // E3 — completion feedback on the rail: a finished zone's chip lights teal.
  setZoneDone(key, done) {
    const chip = this.rail.querySelector(`.zone-chip[data-zone="${key}"]`);
    if (!chip) return;
    chip.classList.toggle('done', done);
    const zone = ZONES.find((z) => z.key === key);
    if (!zone) return;
    // The teal tint is decorative; spell completion out for assistive tech.
    if (done) chip.setAttribute('aria-label', `${zone.label} — complete`);
    else chip.removeAttribute('aria-label');
  }

  _syncRail() {
    this.rail.querySelectorAll('.zone-chip').forEach((chip) => {
      const on = chip.dataset.zone === this.activeKey;
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-selected', String(on));
    });
  }

  // ── highlights (idempotent recompute — never stomps pain colors) ──
  _refreshHighlights() {
    const active = ZONES.find((z) => z.key === this.activeKey);
    if (active && active.joints.length) {
      this.skeleton.dimAllExcept(active.joints[0]);                    // single-key by contract
      active.joints.slice(1).forEach((j) => this.skeleton.highlightJoint(j, 1));
    } else {
      this.skeleton.resetAllOpacity();
    }
    const hover = ZONES.find((z) => z.key === this.hoverKey);
    if (hover && hover.key !== this.activeKey) {
      hover.joints.forEach((j) => {
        if (!active || !active.joints.includes(j)) this.skeleton.highlightJoint(j, 0.45);
      });
    }
  }

  // ── camera ────────────────────────────────────────────────────────
  _zoneTarget(zone) {
    if (zone.anchor === 'overview') return this._overview.target.clone();
    if (zone.anchor === 'aboveShoulders') {
      const t = this._centroid(['LeftShoulder', 'RightShoulder']);
      return t ? t.add(new THREE.Vector3(0, 0.18, 0)) : this._overview.target.clone();
    }
    return this._centroid(zone.joints) || this._overview.target.clone();
  }

  _centroid(joints) {
    const pts = joints.map((j) => this.skeleton.getJointWorldPos(j)).filter((p) => p.lengthSq() > 1e-6);
    if (!pts.length) return null;
    const c = new THREE.Vector3();
    pts.forEach((p) => c.add(p));
    return c.divideScalar(pts.length);
  }

  _flyTo(zone) {
    const target = this._zoneTarget(zone);
    let pos;
    if (zone.cam) {
      this._sph.set(zone.cam.dist, zone.cam.phi, zone.cam.theta);
      pos = target.clone().add(new THREE.Vector3().setFromSpherical(this._sph));
    } else {
      pos = this._overview.pos.clone();
      target.copy(this._overview.target);
    }
    this._tweenCamera(target, pos);
  }

  _tweenCamera(toTarget, toPos) {
    this._cancelTween();
    const { controls, camera } = this.canvas;
    if (this._reduced) {                      // §5 — instant cut, single frame
      controls.target.copy(toTarget);
      camera.position.copy(toPos);
      controls.update();
      return;
    }
    const fromTarget = controls.target.clone();
    const fromPos    = camera.position.clone();
    const start = performance.now();
    const step = (now) => {
      const t = easeInOutCubic(Math.min((now - start) / TWEEN_MS, 1));
      controls.target.lerpVectors(fromTarget, toTarget, t);
      camera.position.lerpVectors(fromPos, toPos, t);
      this._tweenId = t < 1 ? requestAnimationFrame(step) : null;
    };
    // Tween-lifetime rAF: updates values only — BodyCanvas's existing loop renders.
    this._tweenId = requestAnimationFrame(step);
  }

  _cancelTween() {
    if (this._tweenId !== null) { cancelAnimationFrame(this._tweenId); this._tweenId = null; }
  }

  // ── field support (E2-safe: scroll only, never steal focus) ───────
  _scrollZoneFields(zone) {
    const first = zone.fields.map((id) => document.getElementById(id)).find(Boolean);
    const card = first && first.closest('.card');
    if (card) card.scrollIntoView({ behavior: this._reduced ? 'auto' : 'smooth', block: 'nearest' });
  }
}
