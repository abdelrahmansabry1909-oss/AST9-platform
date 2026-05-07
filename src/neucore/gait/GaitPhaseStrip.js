// src/neucore/gait/GaitPhaseStrip.js
import { bus } from '../core/JointBus.js';
import { GAIT_PHASES } from '../simulation/MuscleActivationDB.js';

const PHASE_LABELS = {
  loading_response: 'Loading',
  mid_stance:       'Mid Stance',
  terminal_stance:  'Terminal',
  pre_swing:        'Pre-Swing',
  initial_swing:    'Init Swing',
  mid_swing:        'Mid Swing',
  terminal_swing:   'Term Swing',
};

export class GaitPhaseStrip {
  constructor(containerEl) {
    this.container    = containerEl;
    this._currentPhase = null;
    this._deficitMap   = {};
    this._build();
    this._bindEvents();
  }

  _build() {
    this.container.innerHTML = `
      <div style="display:flex;gap:3px;width:100%">
        ${GAIT_PHASES.map(phase => `
          <div class="gait-phase-cell" data-phase="${phase}" style="
            flex:1;padding:6px 4px;border-radius:5px;text-align:center;cursor:default;
            border:0.5px solid rgba(0,212,255,0.15);background:rgba(0,212,255,0.04);
            transition:all 200ms ease;
          ">
            <div style="font-size:9px;font-weight:500;letter-spacing:.05em;
                       text-transform:uppercase;color:rgba(0,212,255,0.45);line-height:1.3">
              ${PHASE_LABELS[phase]}
            </div>
            <div class="gait-phase-dot" data-phase="${phase}" style="
              width:6px;height:6px;border-radius:50%;background:rgba(0,212,255,0.2);
              margin:3px auto 0;transition:all 200ms ease;
            "></div>
          </div>
        `).join('')}
      </div>
      <div id="phase-progress" style="
        height:2px;background:rgba(0,212,255,0.1);border-radius:1px;margin-top:6px;overflow:hidden;
      ">
        <div id="phase-progress-fill" style="
          height:100%;width:0%;background:linear-gradient(to right,#00D4FF,#00FFF0);
          border-radius:1px;transition:width 150ms ease;
        "></div>
      </div>
    `;
    this._cells = this.container.querySelectorAll('.gait-phase-cell');
    this._dots  = this.container.querySelectorAll('.gait-phase-dot');
    this._progressFill = this.container.querySelector('#phase-progress-fill');
  }

  markDeficits(deficits) {
    this._deficitMap = {};
    deficits.forEach(d => {
      d.phases.forEach(phase => {
        if (!this._deficitMap[phase]) this._deficitMap[phase] = [];
        this._deficitMap[phase].push(d);
      });
    });
    this._applyDeficitColors();
  }

  _applyDeficitColors() {
    this._cells.forEach(cell => {
      const phase    = cell.dataset.phase;
      const deficits = this._deficitMap[phase];
      const dot      = cell.querySelector('.gait-phase-dot');
      if (deficits?.length) {
        const severe = deficits.some(d => d.activeSeverity === 'severe');
        const color  = severe ? '#FF2D78' : '#FF8800';
        dot.style.background = color;
        dot.style.boxShadow  = `0 0 6px ${color}`;
        cell.style.borderColor = `${color}44`;
      }
    });
  }

  setPhase(phaseName) {
    if (phaseName === this._currentPhase) return;
    this._currentPhase = phaseName;

    this._cells.forEach(cell => {
      const isActive = cell.dataset.phase === phaseName;
      cell.style.background = isActive ? 'rgba(0,212,255,0.12)' : 'rgba(0,212,255,0.04)';
      cell.style.borderColor = isActive ? 'rgba(0,212,255,0.5)' : 'rgba(0,212,255,0.15)';
    });

    const idx = GAIT_PHASES.indexOf(phaseName);
    if (idx >= 0 && this._progressFill) {
      this._progressFill.style.width = `${((idx + 1) / GAIT_PHASES.length) * 100}%`;
    }
  }

  _bindEvents() {
    bus.on('gait:phaseChange', ({ phase }) => this.setPhase(phase));
    bus.on('sim:phaseUpdate',  ({ phaseName }) => { if (phaseName) this.setPhase(phaseName); });
  }
}
