// src/neucore/panels/AssessmentPanel.js
// New client input mode — shows pain slider + ROM inputs for each joint
import { PopPanel } from './PopPanel.js';
import { bus } from '../core/JointBus.js';
import { JOINT_LABELS, JOINT_NORMATIVE } from '../core/JointRegistry.js';
import { JOINT_ASSESSMENT_MAP } from '../skeleton/BoneDefinitions.js';
import { painToColor } from '../core/MaterialFactory.js';

export class AssessmentPanel extends PopPanel {
  constructor(containerEl, skeletonBuilder, assessmentStore) {
    super(containerEl);
    this.skeleton = skeletonBuilder;
    this.store    = assessmentStore ?? {};  // { jointKey: { pain_scale, fields } }
  }

  _buildContent(jointKey) {
    const label    = JOINT_LABELS[jointKey] ?? jointKey;
    const normative = JOINT_NORMATIVE[jointKey] ?? {};
    const fields    = JOINT_ASSESSMENT_MAP[jointKey] ?? [];
    const existing  = this.store[jointKey] ?? {};
    const pain      = existing.pain_scale ?? 0;

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:10px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;
                   color:rgba(0,212,255,0.5)">Assessment</div>
        <button class="pop-panel__close" style="
          background:none;border:none;cursor:pointer;
          color:rgba(0,212,255,0.5);font-size:16px;line-height:1;padding:0;
        ">✕</button>
      </div>

      <div style="font-size:16px;font-weight:500;color:rgba(200,240,255,0.95);margin-bottom:14px">
        ${label}
      </div>

      <!-- Pain scale -->
      <div style="margin-bottom:14px">
        <div class="nc-label" style="margin-bottom:6px">
          Pain Scale — <span class="pain-value">${pain}</span>/10
        </div>
        <input type="range" class="pain-slider" min="0" max="10" step="0.5"
               value="${pain}" data-joint="${jointKey}" />
      </div>

      <!-- ROM fields -->
      ${fields.length ? `
        <hr class="nc-divider">
        <div class="nc-label" style="margin-bottom:8px">Range of Motion (°)</div>
        ${fields.map(field => {
          const normKey  = field.split('_').slice(0, -1).join('_');
          const norm     = normative[field] ?? normative[normKey] ?? '—';
          const saved    = existing[field] ?? '';
          return `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <label style="flex:1;font-size:11px;color:rgba(0,212,255,0.6)">
                ${field.replace(/_/g,' ')}
                <span style="color:rgba(0,212,255,0.3)">(norm: ${norm}°)</span>
              </label>
              <input type="number" class="rom-input" data-field="${field}"
                     value="${saved}" min="0" max="360" style="
                width:60px;background:rgba(0,212,255,0.06);border:0.5px solid rgba(0,212,255,0.25);
                border-radius:4px;padding:3px 6px;color:rgba(200,240,255,0.9);font-size:12px;
                text-align:right;outline:none;
              "/>
            </div>
          `;
        }).join('')}
      ` : ''}

      <!-- Location pills -->
      <hr class="nc-divider">
      <div class="nc-label" style="margin-bottom:6px">Location</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${['Anterior','Posterior','Medial','Lateral','Superior','Inferior'].map(loc => `
          <button class="nc-pill ${(existing.location ?? []).includes(loc) ? 'active' : ''}"
                  data-loc="${loc}">${loc}</button>
        `).join('')}
      </div>

      <button class="nc-toolbar-btn" data-save="${jointKey}" style="
        width:100%;margin-top:12px;text-align:center;
      ">Save Assessment</button>
    `;
  }

  _bindPanelEvents(el, jointKey) {
    if (!this.store[jointKey]) this.store[jointKey] = {};
    const data = this.store[jointKey];

    // Pain slider
    const slider  = el.querySelector('.pain-slider');
    const painVal = el.querySelector('.pain-value');
    slider?.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      data.pain_scale = v;
      painVal.textContent = v;
      const color = painToColor(v);
      this.skeleton?.setJointPain(jointKey, v, color);
      bus.emit('assess:painChange', { jointKey, value: v, color });
    });

    // ROM inputs
    el.querySelectorAll('.rom-input').forEach(input => {
      input.addEventListener('change', () => {
        data[input.dataset.field] = parseFloat(input.value);
        bus.emit('assess:romChange', { jointKey, field: input.dataset.field, value: data[input.dataset.field] });
      });
    });

    // Location pills
    el.querySelectorAll('.nc-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        pill.classList.toggle('active');
        data.location = [...el.querySelectorAll('.nc-pill.active')].map(p => p.dataset.loc);
      });
    });

    // Save button
    el.querySelector(`[data-save="${jointKey}"]`)?.addEventListener('click', () => {
      bus.emit('assess:save', { jointKey, data: { ...data } });
      bus.emit('joint:deselect', { jointKey });
    });
  }
}
