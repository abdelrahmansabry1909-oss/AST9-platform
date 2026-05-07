// src/neucore/panels/PopPanel.js
// Base class: spawns, spring-animates, and destroys holographic pop-out panels
import { bus } from '../core/JointBus.js';
import { JOINT_LABELS } from '../core/JointRegistry.js';

export class PopPanel {
  constructor(containerEl) {
    this.container = containerEl;
    this._panels   = new Map();  // jointKey → DOM element

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
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.3);
      opacity: 0;
      z-index: 100;
      min-width: 240px;
      max-width: 320px;
      padding: 16px;
      pointer-events: auto;
      transition: transform 280ms cubic-bezier(.34,1.56,.64,1),
                  opacity 200ms ease;
    `;

    el.innerHTML = this._buildContent(jointKey);
    this.container.appendChild(el);
    this._panels.set(jointKey, el);

    // Close button
    el.querySelector('.pop-panel__close')?.addEventListener('click', () => {
      bus.emit('joint:deselect', { jointKey });
    });

    this._bindPanelEvents(el, jointKey);

    // Trigger spring animation
    requestAnimationFrame(() => {
      el.style.transform = 'translate(-50%, -50%) scale(1)';
      el.style.opacity   = '1';
    });
  }

  _close(jointKey) {
    const el = this._panels.get(jointKey);
    if (!el) return;
    el.style.transform = 'translate(-50%, -50%) scale(0.3)';
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
