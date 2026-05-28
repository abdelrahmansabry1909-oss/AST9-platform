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
      <div class="gait-page" style="
        display:grid;
        grid-template-columns: 1fr 340px;
        grid-template-rows: auto 1fr auto;
        gap:16px;
        height:100%;
        padding:16px;
      ">
        <!-- Header -->
        <div class="gait-header" style="grid-column:1/-1">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;
                         color:rgba(0,212,255,0.5);margin-bottom:4px">
                NeuCore — Gait Analysis
              </div>
              <div style="font-size:20px;font-weight:500;color:rgba(200,240,255,0.95)">
                Movement Simulation
              </div>
            </div>
            <div style="display:flex;gap:8px">
              <button id="btn-sim-start"   class="nc-toolbar-btn">▶ Start</button>
              <button id="btn-sim-stop"    class="nc-toolbar-btn" style="display:none">■ Stop</button>
              <button id="btn-analyze"     class="nc-toolbar-btn" style="border-color:rgba(250,204,21,0.5);color:#FACC15">
                ⚡ Analyze Worst Phase
              </button>
              <button id="btn-resume"      class="nc-toolbar-btn" style="display:none;border-color:rgba(0,255,144,0.5);color:#00FF90">
                ▶ Resume Walk
              </button>
              <button id="btn-worst-case"  class="nc-toolbar-btn nc-toolbar-btn--danger">
                Hold: Worst Case
              </button>
              <button id="btn-export-report" class="nc-toolbar-btn">↓ Export</button>
            </div>
          </div>
        </div>

        <!-- Left: 3D Simulation -->
        <div style="display:flex;flex-direction:column;gap:12px">
          <div id="sim-canvas-wrap" style="
            flex:1;min-height:420px;
            background:rgba(5,13,26,0.6);
            border:0.5px solid rgba(0,212,255,0.15);
            border-radius:12px;
            position:relative;
            overflow:hidden;
          "></div>

          <!-- Gait phase strip -->
          <div id="gait-strip-wrap" style="
            background:rgba(5,13,26,0.85);
            border:0.5px solid rgba(0,212,255,0.15);
            border-radius:10px;
            padding:10px 14px;
          ">
            <div class="nc-label" style="margin-bottom:8px">Gait Cycle</div>
            <div id="gait-strip"></div>
          </div>

          <!-- Deficit summary cards -->
          <div id="deficit-cards" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          </div>
        </div>

        <!-- Right: Activation chart + score -->
        <div style="display:flex;flex-direction:column;gap:12px">
          <!-- Score summary -->
          <div id="score-summary" style="
            background:rgba(5,13,26,0.85);
            border:0.5px solid rgba(0,212,255,0.15);
            border-radius:10px;
            padding:12px 14px;
          "></div>

          <!-- Activation chart -->
          <div id="activation-chart-container" style="flex:1"></div>
        </div>

        <!-- Worst case panel (bottom, hidden by default) -->
        <div id="worst-case-panel" style="
          grid-column:1/-1;
          background:rgba(30,5,15,0.95);
          border:0.5px solid rgba(255,45,120,0.3);
          border-radius:10px;
          padding:16px;
          display:none;
        ">
          <div style="font-size:13px;font-weight:500;color:#FF2D78;margin-bottom:10px">
            ⚠ Worst-Case Scenario — If Untreated
          </div>
          <div id="worst-case-content" style="
            display:grid;grid-template-columns:repeat(3,1fr);gap:12px;
          "></div>
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
    const wrap      = this.container.querySelector('#sim-canvas-wrap');
    this.bodyCanvas = new BodyCanvas(wrap);
    this._analysisMode = false;

    const loader = document.createElement('div');
    loader.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;
      justify-content:center;color:#67E8F9;font-size:11px;letter-spacing:.16em;
      text-transform:uppercase;z-index:30;pointer-events:none;`;
    loader.textContent = 'Loading anatomy…';
    wrap.appendChild(loader);

    const myBuild = ++this._buildToken;     // guard against rebuilds racing this one
    this.skeleton = new GLBSkeleton(this.bodyCanvas.scene);
    try {
      await this.skeleton.build();
    } catch (err) {
      console.error('[NeuCore] gait skeleton load failed:', err);
      loader.textContent = '3D anatomy failed to load';
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
      el.innerHTML = `<div style="grid-column:1/-1;font-size:12px;color:rgba(0,212,255,0.4);
                       padding:8px">No active gait deficits detected.</div>`;
      return;
    }
    el.innerHTML = this.deficits.map(d => `
      <div style="
        background:rgba(5,13,26,0.85);
        border:0.5px solid ${d.activeSeverity === 'severe' ? 'rgba(255,45,120,0.35)' : 'rgba(0,212,255,0.15)'};
        border-radius:8px;padding:10px 12px;
      ">
        <div style="
          font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;
          color:${d.activeSeverity === 'severe' ? '#FF2D78' : d.activeSeverity === 'moderate' ? '#FF8800' : '#FACC15'};
          margin-bottom:4px;
        ">${d.activeSeverity}</div>
        <div style="font-size:12px;font-weight:500;color:rgba(200,240,255,0.9);margin-bottom:4px">
          ${d.label}
        </div>
        <div style="font-size:11px;color:rgba(0,212,255,0.55)">
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

      el.innerHTML = `
        <div class="nc-label" style="margin-bottom:8px">Movement Score</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          ${[
            ['ROM',       scores.rom_score,       '#00D4FF'],
            ['Control',   scores.control_score,   '#00FFF0'],
            ['Force',     scores.force_score,     '#FACC15'],
            ['Neurology', scores.neurology_score, '#FF6B6B'],
          ].map(([label, val, col]) => `
            <div>
              <div style="font-size:10px;color:rgba(0,212,255,0.5);text-transform:uppercase;
                         letter-spacing:.08em;margin-bottom:2px">${label}</div>
              <div style="font-size:22px;font-weight:500;color:${col}">${val ?? '—'}</div>
            </div>
          `).join('')}
        </div>
        <div style="border-top:0.5px solid rgba(0,212,255,0.1);padding-top:8px">
          <div style="font-size:10px;color:rgba(0,212,255,0.5);text-transform:uppercase;
                     letter-spacing:.08em;margin-bottom:2px">Composite</div>
          <div style="font-size:28px;font-weight:500;
            color:${scores.composite_score < 50 ? '#FF2D78' : scores.composite_score < 75 ? '#FF8800' : '#00FFF0'}
          ">${scores.composite_score ?? '—'}</div>
          <div style="font-size:11px;color:rgba(0,212,255,0.55);margin-top:4px">
            ${phase.phase}
          </div>
          ${phase.referral ? `
            <div style="font-size:11px;color:#FF2D78;margin-top:6px;
                       padding:4px 8px;border-radius:4px;background:rgba(255,45,120,0.08);
                       border:0.5px solid rgba(255,45,120,0.25)">
              ⚠ Manual therapy referral required
            </div>
          ` : ''}
        </div>
      `;
    } catch (err) {
      el.innerHTML = `<div style="font-size:11px;color:rgba(0,212,255,0.4)">Score unavailable</div>`;
    }
  }

  _buildWorstCasePanel() {
    const el = this.container.querySelector('#worst-case-content');
    if (!this.deficits.length) {
      el.innerHTML = `<div style="font-size:12px;color:rgba(255,150,150,0.6)">No active deficits.</div>`;
      return;
    }
    el.innerHTML = this.deficits.map(d => `
      <div style="border-left:2px solid rgba(255,45,120,0.4);padding-left:10px">
        <div style="font-size:11px;font-weight:500;color:#FF2D78;margin-bottom:6px">
          ${d.label}
        </div>
        ${d.future_risk.map(risk => `
          <div style="font-size:11px;color:rgba(255,150,150,0.75);
                     padding:2px 0;display:flex;gap:6px;align-items:baseline">
            <span style="color:rgba(255,45,120,0.5)">→</span>
            ${risk}
          </div>
        `).join('')}
        <div style="font-size:10px;color:rgba(255,45,120,0.45);margin-top:6px;
                   text-transform:uppercase;letter-spacing:.06em">
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
      this.simulator.stop();
      this.gaitEngine.stop();
      startBtn.style.display  = '';
      stopBtn.style.display   = 'none';
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
    if (analyzeBtn) analyzeBtn.style.display = 'none';
    if (resumeBtn)  resumeBtn.style.display  = '';
  }

  _exitAnalysis() {
    this._analysisMode = false;
    this.phaseOverlay.hide();
    this.simulator.unfreeze();

    const analyzeBtn = this.container.querySelector('#btn-analyze');
    const resumeBtn  = this.container.querySelector('#btn-resume');
    if (analyzeBtn) analyzeBtn.style.display = '';
    if (resumeBtn)  resumeBtn.style.display  = 'none';

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
