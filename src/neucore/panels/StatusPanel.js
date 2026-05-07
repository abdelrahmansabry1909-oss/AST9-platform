// src/neucore/panels/StatusPanel.js
// Assessed client data mode — shows sparkline + ROM gauge for each joint
import { PopPanel } from './PopPanel.js';
import { JOINT_LABELS, JOINT_NORMATIVE } from '../core/JointRegistry.js';
import { JOINT_ASSESSMENT_MAP } from '../skeleton/BoneDefinitions.js';

export class StatusPanel extends PopPanel {
  constructor(containerEl, assessmentData) {
    super(containerEl);
    this.assessmentData = assessmentData ?? {};
  }

  _buildContent(jointKey) {
    const label    = JOINT_LABELS[jointKey] ?? jointKey;
    const fields   = JOINT_ASSESSMENT_MAP[jointKey] ?? [];
    const normative = JOINT_NORMATIVE[jointKey] ?? {};
    const jData    = this.assessmentData[jointKey] ?? {};
    const pain     = jData.pain_scale ?? 0;

    const painColor = pain >= 7 ? '#FF0080' : pain >= 4 ? '#FF8800' : pain >= 1 ? '#FACC15' : '#00FF88';

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:10px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;
                   color:rgba(0,212,255,0.5)">Joint Status</div>
        <button class="pop-panel__close" style="
          background:none;border:none;cursor:pointer;
          color:rgba(0,212,255,0.5);font-size:16px;line-height:1;padding:0;
        ">✕</button>
      </div>

      <div style="font-size:16px;font-weight:500;color:rgba(200,240,255,0.95);margin-bottom:8px">
        ${label}
      </div>

      ${pain > 0 ? `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <div style="width:8px;height:8px;border-radius:50%;background:${painColor};
                     box-shadow:0 0 8px ${painColor}"></div>
          <span style="font-size:12px;color:${painColor};font-weight:500">
            Pain: ${pain}/10
          </span>
        </div>
      ` : ''}

      <!-- ROM Gauges -->
      ${fields.length ? `
        <div class="nc-label" style="margin-bottom:8px">Range of Motion</div>
        ${fields.map(field => {
          const val     = jData[field];
          const normKey = field.split('_').slice(0, -1).join('_');
          const norm    = normative[field] ?? normative[normKey] ?? 100;
          const pct     = val != null ? Math.min((val / norm) * 100, 100) : null;
          const barColor = pct == null ? '#4A5568' : pct >= 80 ? '#00FFF0' : pct >= 50 ? '#FACC15' : '#FF2D78';

          return `
            <div style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;
                         margin-bottom:3px">
                <span style="font-size:11px;color:rgba(0,212,255,0.6)">
                  ${field.replace(/_/g,' ')}
                </span>
                <span style="font-size:12px;font-weight:500;
                            color:${val != null ? barColor : 'rgba(0,212,255,0.3)'}">
                  ${val != null ? val + '°' : '—'}
                </span>
              </div>
              <div class="rom-gauge__bar">
                <div class="rom-gauge__fill"
                     style="width:${pct ?? 0}%;background:${barColor}"></div>
              </div>
            </div>
          `;
        }).join('')}
      ` : '<div style="font-size:12px;color:rgba(0,212,255,0.35)">No assessment data recorded.</div>'}

      <!-- Sparkline (7-day trend placeholder) -->
      ${jData.history?.length ? `
        <hr class="nc-divider">
        <div class="nc-label" style="margin-bottom:6px">7-Day Trend</div>
        <svg class="sparkline-svg" width="100%" height="32" viewBox="0 0 200 32">
          ${this._sparkline(jData.history, 200, 32)}
        </svg>
      ` : ''}
    `;
  }

  _sparkline(values, w, h) {
    if (!values?.length) return '';
    const min = Math.min(...values);
    const max = Math.max(...values) || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / (max - min)) * (h - 4) - 2;
      return `${x},${y}`;
    }).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="#00D4FF" stroke-width="1.5"
              stroke-linecap="round" opacity="0.8"/>`;
  }
}
