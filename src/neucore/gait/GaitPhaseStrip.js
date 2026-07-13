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
      <div class="gait-phase-row">
        ${GAIT_PHASES.map(phase => `
          <div class="gait-phase-cell" data-phase="${phase}">
            <div class="gait-phase-label">
              ${PHASE_LABELS[phase]}
            </div>
            <div class="gait-phase-dot" data-phase="${phase}"></div>
          </div>
        `).join('')}
      </div>
      <div class="gait-progress-track">
        <div class="gait-progress-fill" style="width:0%"></div>
      </div>
    `;
    this._cells = this.container.querySelectorAll('.gait-phase-cell');
    this._dots  = this.container.querySelectorAll('.gait-phase-dot');
    this._progressFill = this.container.querySelector('.gait-progress-fill');
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
        const severityClass = severe ? 'gait-severity-severe' : 'gait-severity-moderate';
        cell.classList.add(severityClass);
        if (dot) dot.classList.add(severityClass);
      }
    });
  }

  setPhase(phaseName) {
    if (phaseName === this._currentPhase) return;
    this._currentPhase = phaseName;

    this._cells.forEach(cell => {
      const isActive = cell.dataset.phase === phaseName;
      if (isActive) {
        cell.classList.add('is-active');
      } else {
        cell.classList.remove('is-active');
      }
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
