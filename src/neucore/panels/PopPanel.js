// src/neucore/panels/PopPanel.js
// Base class: spawns, spring-animates, and destroys holographic pop-out panels
import { bus } from '../core/JointBus.js';
import { JOINT_LABELS } from '../core/JointRegistry.js';

export class PopPanel {
  constructor(containerEl, mountEl = containerEl) {
    this.container   = containerEl;
    this.mountTarget = mountEl || containerEl;
    this._panels     = new Map();  // jointKey → DOM element

    bus.on('joint:select',   ({ jointKey }) => this._open(jointKey));
    bus.on('joint:deselect', ({ jointKey }) => this._close(jointKey));
  }

  _open(jointKey) {
    // Close any previously open panel
    this._panels.forEach((_, k) => this._close(k));

    const el = document.createElement('div');
    el.className = 'pop-panel';
    el.dataset.joint = jointKey;
    el.style.cssText = `
      position: relative;
      margin-top: 12px;
      width: 100%;
      padding: 16px;
      box-sizing: border-box;
      z-index: 10;
      pointer-events: auto;
      transform: translateY(10px) scale(0.95);
      opacity: 0;
      transition: transform 280ms cubic-bezier(.34,1.56,.64,1),
                  opacity 200ms ease;
    `;

    el.innerHTML = this._buildContent(jointKey);
    this.mountTarget.appendChild(el);
    this._panels.set(jointKey, el);

    // Close button
    el.querySelector('.pop-panel__close')?.addEventListener('click', () => {
      bus.emit('joint:deselect', { jointKey });
    });

    this._bindPanelEvents(el, jointKey);

    // Trigger spring animation and bring into view if below fold
    requestAnimationFrame(() => {
      el.style.transform = 'translateY(0) scale(1)';
      el.style.opacity   = '1';
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) { /* non-fatal */ }
    });
  }

  _close(jointKey) {
    const el = this._panels.get(jointKey);
    if (!el) return;
    el.style.transform = 'translateY(10px) scale(0.95)';
    el.style.opacity   = '0';
    setTimeout(() => {
      el.remove();
      this._panels.delete(jointKey);
    }, 280);
  }

  // Override in subclass
  _buildContent(jointKey) {
    const label = JOINT_LABELS[jointKey] ?? jointKey;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:10px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;
                   color:rgba(0,212,255,0.5)">Joint Assessment</div>
        <button class="pop-panel__close" style="
          background:none;border:none;cursor:pointer;
          color:rgba(0,212,255,0.5);font-size:16px;line-height:1;padding:0;
        ">✕</button>
      </div>
      <div style="font-size:16px;font-weight:500;color:rgba(200,240,255,0.95);margin-bottom:4px">
        ${label}
      </div>
    `;
  }

  // Override in subclass to bind sliders, inputs, etc.
  _bindPanelEvents(el, jointKey) {}
}
