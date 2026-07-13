// src/neucore/gait/GaitAnalysisPage.js
// The final page of the assessment flow.
// Layout:
//   Left:  3D skeleton simulation (MovementSimulator running)
//   Center: Gait phase strip + deficit summary
//   Right: Muscle activation chart (ActivationChart)
//
// Bottom: Worst-case scenario panel (hold button to reveal)

import * as THREE from 'three';
import { GaitEngine }                 from './GaitEngine.js';
import { GaitPhaseStrip }             from './GaitPhaseStrip.js';
import { MovementSimulator }          from '../simulation/MovementSimulator.js';
import { ActivationChart }            from '../simulation/ActivationChart.js';
import { computeClientActivation }    from '../simulation/MuscleActivationDB.js';
import { evaluateGaitRules }          from './GaitRules.js';
import { PhaseAnalysisOverlay, findWorstPhase } from './PhaseAnalysisOverlay.js';
import { GLBSkeleton }                from '../skeleton/GLBSkeleton.js';
import { BodyCanvas }                 from '../core/BodyCanvas.js';
import { FXLayer }                    from '../core/FXLayer.js';
import { bus }                        from '../core/JointBus.js';
import { ScoringEngine }              from '../scoring/ScoringEngine.js';
export class GaitAnalysisPage {
  constructor(containerEl, assessmentData) {
    this.container  = containerEl;
    this.assessment = assessmentData;
    this.deficits   = evaluateGaitRules(assessmentData);
    this.activation = computeClientActivation(this.deficits);
    this._worstCaseActive = false;
    this._disposed   = false;
    this._buildToken = 0;     // bumped on each rebuild; in-flight loads compare against it
    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div class="gait-page">
        <!-- Header -->
        <div class="gait-header">
          <div class="gait-header-flex">
            <div class="gait-header-copy">
              <div class="gait-eyebrow">
                NeuCore — Gait Analysis
              </div>
              <div class="gait-title">
                Movement Simulation
              </div>
            </div>
            <div class="gait-toolbar">
              <button id="btn-sim-start"   class="nc-toolbar-btn gait-btn-start">▶ Start</button>
              <button id="btn-sim-stop"    class="nc-toolbar-btn gait-btn-stop" style="display:none">■ Stop</button>
              <button id="btn-analyze"     class="nc-toolbar-btn gait-btn-analyze">
                ⚡ Analyze Worst Phase
              </button>
              <button id="btn-resume"      class="nc-toolbar-btn gait-btn-resume" style="display:none">
                ▶ Resume Walk
              </button>
              <button id="btn-worst-case"  class="nc-toolbar-btn nc-toolbar-btn--danger gait-btn-worst-case">
                Hold: Worst Case
              </button>
              <button id="btn-export-report" class="nc-toolbar-btn gait-btn-export">↓ Export</button>
            </div>
          </div>
        </div>

        <!-- Left: 3D Simulation -->
        <div class="gait-stage-column">
          <div id="sim-canvas-wrap" class="gait-viewport"></div>

          <!-- Gait phase strip -->
          <div id="gait-strip-wrap" class="gait-phase-panel">
            <div class="nc-label">Gait Cycle</div>
            <div id="gait-strip"></div>
          </div>

          <!-- Deficit summary cards -->
          <div id="deficit-cards" class="gait-deficit-grid">
          </div>
        </div>

        <!-- Right: Activation chart + score -->
        <div class="gait-data-column">
          <!-- Score summary -->
          <div id="score-summary" class="gait-score-panel"></div>

          <!-- Activation chart -->
          <div id="activation-chart-container" class="gait-activation-container"></div>
        </div>

        <!-- Worst case panel (bottom, hidden by default) -->
        <div id="worst-case-panel" class="gait-worst-case-panel" style="display:none">
          <div class="gait-worst-case-title">
            ⚠ Worst-Case Scenario — If Untreated
          </div>
          <div id="worst-case-content" class="gait-worst-case-content"></div>
        </div>
      </div>
    `;

    this._initSimulation();
    this._initChart();
    this._initPhaseStrip();
    this._buildDeficitCards();
    this._buildScoreSummary();
    this._bindControls();
  }

  async _initSimulation() {
    const wrap = this.container.querySelector('#sim-canvas-wrap');
    if (!wrap || this._disposed) return;

    // Clean slate — also covers the Retry path, which re-enters this method.
    try { this.bodyCanvas?.destroy?.(); } catch {}
    try { this.skeleton?.destroy?.(); } catch {}
    this._simReady = false;
    wrap.innerHTML = '';

    this.bodyCanvas = new BodyCanvas(wrap);
    this._analysisMode = false;

    const loader = document.createElement('div');
    loader.className = 'gait-loader';
    loader.textContent = 'Loading anatomy…';
    wrap.appendChild(loader);

    const myBuild = ++this._buildToken;     // guard against rebuilds racing this one
    this.skeleton = new GLBSkeleton(this.bodyCanvas.scene);
    try {
      await this.skeleton.build();
    } catch (err) {
      console.error('[NeuCore] gait skeleton load failed:', err);
      // A newer build (or destroy) superseded this one — stay silent.
      if (this._disposed || myBuild !== this._buildToken) return;
      const reason = (err && err.message ? String(err.message) : 'The 3D model could not be retrieved.').slice(0, 140);
      loader.innerHTML = `
        <div class="gait-loader-error-title">
          3D anatomy failed to load
        </div>
        <div class="gait-loader-error-desc">${reason}</div>
        <button id="gait-skel-retry" class="nc-toolbar-btn gait-loader-retry-btn">↻ Retry</button>`;
      loader.querySelector('#gait-skel-retry')
        ?.addEventListener('click', () => { this._initSimulation(); });
      return;
    }
    // If destroy() ran (or a newer build started) while we were awaiting the
    // GLB, throw away this stale skeleton instead of grafting it onto the live
    // page. This is the actual fix for "double skeleton on rapid Generate clicks".
    if (this._disposed || myBuild !== this._buildToken) {
      try { this.skeleton.destroy?.(); } catch {}
      this.skeleton = null;
      return;
    }
    loader.remove();

    // Gait view is skeletal — hide the body shell and assessment hotspots.
    this.skeleton.setSkinVisible(false);
    this.skeleton.setHotspotsVisible(false);

    this.fx = new FXLayer(this.bodyCanvas, this.skeleton);
    this.bodyCanvas._skeleton = this.skeleton;
    this.bodyCanvas._fxLayer  = this.fx;

    this.simulator  = new MovementSimulator(this.skeleton, this.deficits);
    this.simulator._assessment = this.assessment;
    this.gaitEngine = new GaitEngine(this.bodyCanvas);
    this.gaitEngine.loadAssessment(this.assessment);

    this.phaseOverlay = new PhaseAnalysisOverlay(wrap, this.skeleton, this.bodyCanvas);
    this._simReady = true;
  }

  _initChart() {
    const chartContainer = this.container.querySelector('#activation-chart-container');
    this.activationChart = new ActivationChart(chartContainer, this.activation);
  }

  _initPhaseStrip() {
    const stripEl    = this.container.querySelector('#gait-strip');
    this.phaseStrip  = new GaitPhaseStrip(stripEl);
    this.phaseStrip.markDeficits(this.deficits);
  }

  _buildDeficitCards() {
    const el = this.container.querySelector('#deficit-cards');
    if (!this.deficits.length) {
      el.innerHTML = `<div class="gait-deficit-empty">No active gait deficits detected.</div>`;
      return;
    }
    el.innerHTML = this.deficits.map(d => `
      <div class="gait-deficit-card gait-severity-${d.activeSeverity}">
        <div class="gait-deficit-severity">${d.activeSeverity}</div>
        <div class="gait-deficit-label">${d.label}</div>
        <div class="gait-deficit-phases">
          ${d.phases.slice(0,2).map(p => p.replace(/_/g,' ')).join(' · ')}
        </div>
      </div>
    `).join('');
  }

  _buildScoreSummary() {
    const el = this.container.querySelector('#score-summary');
    try {
      const scorer = new ScoringEngine(this.assessment);
      const scores = scorer.fullScores();
      const phase  = scorer.phaseRecommendation();

      const compositeColorClass = scores.composite_score < 50 ? 'gait-color-danger' : scores.composite_score < 75 ? 'gait-color-warning' : 'gait-color-success';

      el.innerHTML = `
        <div class="nc-label">Movement Score</div>
        <div class="gait-score-grid">
          ${[
            ['ROM',       scores.rom_score,       'rom'],
            ['Control',   scores.control_score,   'control'],
            ['Force',     scores.force_score,     'force'],
            ['Neurology', scores.neurology_score, 'neurology'],
          ].map(([label, val, key]) => `
            <div class="gait-score-item">
              <div class="gait-score-label">${label}</div>
              <div class="gait-score-value gait-score-${key}">${val ?? '—'}</div>
            </div>
          `).join('')}
        </div>
        <div class="gait-score-footer">
          <div class="gait-score-composite-label">Composite</div>
          <div class="gait-score-composite-value ${compositeColorClass}">
            ${scores.composite_score ?? '—'}
          </div>
          <div class="gait-score-recommendation">
            ${phase.phase}
          </div>
          ${phase.referral ? `
            <div class="gait-score-referral">
              ⚠ Manual therapy referral required
            </div>
          ` : ''}
        </div>
      `;
    } catch (err) {
      el.innerHTML = `<div class="gait-score-empty">Score unavailable</div>`;
    }
  }

  _buildWorstCasePanel() {
    const el = this.container.querySelector('#worst-case-content');
    if (!this.deficits.length) {
      el.innerHTML = `<div class="gait-worst-case-empty">No active deficits.</div>`;
      return;
    }
    el.innerHTML = this.deficits.map(d => `
      <div class="gait-worst-case-card">
        <div class="gait-worst-case-card-title">${d.label}</div>
        <div class="gait-worst-case-card-body">
          ${d.future_risk.map(risk => `
            <div class="gait-worst-case-risk">
              <span class="gait-worst-case-risk-bullet">→</span>
              <span class="gait-worst-case-risk-text">${risk}</span>
            </div>
          `).join('')}
        </div>
        <div class="gait-worst-case-card-footer">
          Untreated projection
        </div>
      </div>
    `).join('');
  }

  _bindControls() {
    const startBtn  = this.container.querySelector('#btn-sim-start');
    const stopBtn   = this.container.querySelector('#btn-sim-stop');
    const analyzeBtn= this.container.querySelector('#btn-analyze');
    const resumeBtn = this.container.querySelector('#btn-resume');
    const worstBtn  = this.container.querySelector('#btn-worst-case');
    const wcPanel   = this.container.querySelector('#worst-case-panel');
    const exportBtn = this.container.querySelector('#btn-export-report');

    startBtn.addEventListener('click', () => {
      if (!this._simReady) return;
      if (this._analysisMode) this._exitAnalysis();
      this.simulator.start(1.0);
      this.gaitEngine.start(1.0);
      startBtn.style.display  = 'none';
      stopBtn.style.display   = '';
      analyzeBtn.style.display = '';
      resumeBtn.style.display = 'none';
    });

    stopBtn.addEventListener('click', () => {
      if (this._analysisMode) {
        this._analysisMode = false;
        this.phaseOverlay.hide();
      }
      this.simulator.stop();
      this.gaitEngine.stop();
      this.bodyCanvas.animateCameraTo(
        new THREE.Vector3(0, 0.85, 0),
        new THREE.Vector3(0, 0.9, 3.2),
        800,
      );
      startBtn.style.display  = '';
      stopBtn.style.display   = 'none';
      analyzeBtn.style.display = '';
      resumeBtn.style.display = 'none';
    });

    analyzeBtn.addEventListener('click', () => {
      if (!this._simReady) return;
      this._enterAnalysis();
    });

    resumeBtn.addEventListener('click', () => {
      this._exitAnalysis();
    });

    // Hold 400ms for worst case
    let worstTimer;
    worstBtn.addEventListener('pointerdown', () => {
      worstTimer = setTimeout(() => {
        this._worstCaseActive = true;
        this.simulator.setSpeed(0.4);
        this.gaitEngine.setWorstCase(true);
        wcPanel.style.display = 'block';
        this._buildWorstCasePanel();
        worstBtn.style.borderColor = 'rgba(255,45,120,0.8)';
        worstBtn.style.background  = 'rgba(255,45,120,0.12)';
      }, 400);
    });

    worstBtn.addEventListener('pointerup', () => {
      clearTimeout(worstTimer);
      if (this._worstCaseActive) {
        this._worstCaseActive = false;
        this.simulator.setSpeed(1.0);
        this.gaitEngine.setWorstCase(false);
        wcPanel.style.display = 'none';
        worstBtn.style.borderColor = '';
        worstBtn.style.background  = '';
      }
    });

    exportBtn.addEventListener('click', () => { window.print(); });

    bus.on('gait:phaseChange', ({ phase }) => {
      if (!this._analysisMode) this.activationChart.updatePhase(phase);
    });
  }

  _enterAnalysis() {
    this._analysisMode = true;
    const worstPhase   = findWorstPhase(this.deficits);

    // Freeze the simulator at the worst phase pose
    this.simulator.jumpToPhase(worstPhase);
    this.gaitEngine.stop();

    // Update chart to show the worst phase data
    this.activationChart.updatePhase(worstPhase);
    this.phaseStrip.setPhase(worstPhase);

    // Show overlay cards
    this.phaseOverlay.show(worstPhase, this.deficits, this.activation);

    // Swap toolbar buttons
    const analyzeBtn = this.container.querySelector('#btn-analyze');
    const resumeBtn  = this.container.querySelector('#btn-resume');
    const startBtn   = this.container.querySelector('#btn-sim-start');
    const stopBtn    = this.container.querySelector('#btn-sim-stop');
    if (analyzeBtn) analyzeBtn.style.display = 'none';
    if (resumeBtn)  resumeBtn.style.display  = '';
    if (startBtn)   startBtn.style.display   = 'none';
    if (stopBtn)    stopBtn.style.display    = '';
  }

  _exitAnalysis() {
    this._analysisMode = false;
    this.phaseOverlay.hide();
    this.simulator.unfreeze();

    // Resume walking means simulator is now playing!
    this.simulator.start(1.0);
    this.gaitEngine.start(1.0);

    const analyzeBtn = this.container.querySelector('#btn-analyze');
    const resumeBtn  = this.container.querySelector('#btn-resume');
    const startBtn   = this.container.querySelector('#btn-sim-start');
    const stopBtn    = this.container.querySelector('#btn-sim-stop');
    if (analyzeBtn) analyzeBtn.style.display = '';
    if (resumeBtn)  resumeBtn.style.display  = 'none';
    if (startBtn)   startBtn.style.display   = 'none';
    if (stopBtn)    stopBtn.style.display    = '';

    // Restore camera
    this.bodyCanvas.animateCameraTo(
      new THREE.Vector3(0, 0.85, 0),
      new THREE.Vector3(0, 0.9, 3.2),
      800,
    );
  }

  destroy() {
    this._disposed     = true;
    this._buildToken  += 1;   // invalidate any in-flight skeleton load
    this._analysisMode = false;
    this.phaseOverlay?.hide();
    this.simulator?.stop();
    this.gaitEngine?.stop();
    this.activationChart?.destroy();
    // Cascade: BodyCanvas.destroy stops its rAF, disposes the renderer, and
    // cascades to FXLayer.destroy + GLBSkeleton.destroy. Without that cascade,
    // rapid re-clicks on Generate were leaking entire scenes.
    this.bodyCanvas?.destroy?.();
    this.bodyCanvas = null;
    this.skeleton   = null;
    this.fx         = null;
    this.simulator  = null;
    this.gaitEngine = null;
  }
}
