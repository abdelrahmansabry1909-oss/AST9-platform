// src/neucore/simulation/ShoulderActivationChart.js
//
// Plots scapular upward-rotator demand against arm abduction angle, and marks
// where the client's measured arc stops.
//
// Not a reuse of ActivationChart: that one is a bar chart showing a single gait
// phase at a time, driven by a bus event. This is a line chart across the whole
// arc at once, because the SHAPE is the finding — the upper trapezius plateaus
// mid-arc, the lower trapezius is silent until 90°, the serratus climbs
// throughout. Bending a one-phase bar chart into that would be the wrong
// abstraction; the shared part is only the card chrome.
//
// There is deliberately no "client" series. Neumann gives graded normative
// curves but no graded client-side modifiers for these muscles — only paralysis
// cases — so drawing a client EMG line would mean inventing data. What the
// assessment CAN say is where the arc ends, which is drawn as a cutoff.

import { Chart, registerables } from 'chart.js';
import { computeShoulderActivation } from './ShoulderActivationDB.js';

Chart.register(...registerables);

// Reads tokens off body, not documentElement: _showApp() puts `nc-bright` on
// <body> for every authenticated user.
//
// No literal-colour fallback on purpose. Every token used here is defined in
// css/styles.css, so a fallback would be a dead branch carrying an off-palette
// colour into a design system that forbids literal hex. If one ever goes
// missing, Chart.js gets an empty string and the series does not draw — a
// visible failure, which is the one worth having.
function token(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

export class ShoulderActivationChart {
  constructor(containerEl, assessment) {
    this.container = containerEl;
    this.model     = computeShoulderActivation(assessment);
    this.chart     = null;
    this._observer = null;
    this._onResize = null;
    this._visible  = false;
    this._build();

    // The chart is built on reveal, never here. These panels start folded
    // (js/panelFold.js), and Chart.js defers its first paint to an animation
    // frame — which lands after the fold, painting into a hidden canvas and
    // leaving it blank for good.
    //
    // Two triggers, because neither is sufficient alone. PanelFold dispatches a
    // window resize when a panel opens: deterministic, and the only signal that
    // actually arrives on unfold. The observer watches the canvas WRAPPER — not
    // the canvas, whose inline width Chart.js pins so its own box never changes
    // and the observer never fires — and covers width changes while the panel
    // is already open. _ensureChart is idempotent, so both firing is harmless.
    this._onResize = () => this._ensureChart();
    window.addEventListener('resize', this._onResize);

    const wrapper = this.container.querySelector('#shoulder-activation-canvas')?.parentElement;
    if (wrapper && typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(() => this._ensureChart());
      this._observer.observe(wrapper);
    }
  }

  // Rebuilds on every hidden -> visible transition rather than trying to time
  // construction. Chart.js defers its first paint to an animation frame, and if
  // the panel folds shut in between, that paint lands in a hidden canvas and
  // the chart is dead: measured, it keeps plausible dimensions, never gets
  // retina-scaled, and resize(), render() and update() all leave it blank.
  // Guessing the right moment was tried three ways — a synchronous build, a
  // requestAnimationFrame, and the window resize the fold dispatches — and each
  // one still raced the fold. A fresh three-series line chart is cheap; being
  // certain it is drawn is worth more than saving one.
  _ensureChart() {
    const canvas = this.container.querySelector('#shoulder-activation-canvas');
    if (!canvas) return;

    const box = canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) { this._visible = false; return; }

    if (this._visible && this.chart) { this.chart.resize(); return; }
    this.chart?.destroy();
    this._initChart();
    this._visible = true;
  }

  _build() {
    const m = this.model;
    if (!m.reach) {
      this.container.innerHTML = this._notAssessed();
      return;
    }

    this.container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Scapular Upward Rotators</span>
          <span style="font-size:12px;color:var(--text-tertiary)">
            Arc reaches ${m.reach.degrees}° of ${m.normative_elevation}° (${m.reach.motion})
          </span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px">
          Muscle demand through the arc of elevation. The scapula rotates upward on the
          ribcage, so these three are what carry an arm overhead — and they do it in a
          strict order.
        </div>
        <div style="position:relative;height:280px;margin-bottom:12px">
          <canvas id="shoulder-activation-canvas"></canvas>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
          ${m.muscles.map(mu => `
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary)">
              <div style="width:16px;height:3px;border-radius:2px;background:${this._colour(mu.key)}"></div>${mu.label}
            </div>`).join('')}
          <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-tertiary)">
            <div style="width:16px;height:10px;border-radius:2px;background:var(--bg-raised);border:1px solid var(--border-default)"></div>Beyond this client's arc
          </div>
        </div>
        ${this._implications()}
        ${this._roles()}
        <div style="font-size:10px;color:var(--text-tertiary);margin-top:12px">
          Curves read from Neumann Fig. 5-51 (data from Bagg &amp; Forrest 1986) — graph
          readings, accurate to about ±5 %MVIC.
        </div>
      </div>`;
  }

  // Existing severity tokens, so this chart reads like the panels beside it.
  _colour(key) {
    return {
      upper_trapezius:   'var(--amber)',
      serratus_anterior: 'var(--teal)',
      lower_trapezius:   'var(--rose)',
    }[key] || 'var(--text-tertiary)';
  }

  _notAssessed() {
    return `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Scapular Upward Rotators</span>
          <span style="font-size:12px;color:var(--text-tertiary)">Not assessed</span>
        </div>
        <div style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">
          Record shoulder abduction (or flexion) to see where this client's arc stops
          against the demand curve.
        </div>
      </div>`;
  }

  _implications() {
    if (!this.model.implications.length) return '';
    return `
      <div style="margin-bottom:12px">
        ${this.model.implications.map(i => `
          <div style="background:var(--bg-raised);border:1px solid var(--border-subtle);border-left:3px solid var(--amber);border-radius:var(--r-md);padding:12px;margin-bottom:8px">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:6px">${i.title}</div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:6px">${i.detail}</div>
            <div style="font-size:10px;color:var(--text-tertiary)">${i.source}</div>
          </div>`).join('')}
      </div>`;
  }

  // The two things the source describes but does not plot. Stated as text so
  // the chart is not silently taken for the whole picture.
  _roles() {
    return `
      <div style="border-top:1px solid var(--border-subtle);padding-top:12px">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">Described, not plotted</div>
        ${this.model.described.map(d => `
          <div style="font-size:11px;color:var(--text-secondary);line-height:1.6;padding:3px 0">
            <strong style="color:var(--text-primary)">${d.label}:</strong> ${d.note}
          </div>`).join('')}
      </div>`;
  }

  _initChart() {
    const canvas = this.container.querySelector('#shoulder-activation-canvas');
    if (!canvas) return;

    const m         = this.model;
    const grid      = token('--border-subtle');
    const tick      = token('--text-tertiary');
    const surface   = token('--bg-raised');
    const cssColour = (v) => token(v.replace('var(', '').replace(')', ''));

    // The client's arc ends somewhere on the x-axis; everything past it is
    // range they do not currently own. Drawn as a band rather than a hard line
    // so it reads as "unreachable", not as a measurement.
    const cutoffBand = {
      id: 'reachCutoff',
      beforeDatasetsDraw: (chart) => {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || m.reach == null) return;

        // The x axis is categorical, so getPixelForValue takes an INDEX, not a
        // degree — passing 120 puts the line off the right edge and the band
        // silently never draws. Interpolate the client's angle into index
        // space, then across the plotted width.
        const a    = m.angles;
        const last = a.length - 1;
        const deg  = Math.max(a[0], Math.min(m.reach.degrees, a[last]));
        let idx = last;
        for (let i = 0; i < last; i++) {
          if (deg >= a[i] && deg <= a[i + 1]) { idx = i + (deg - a[i]) / (a[i + 1] - a[i]); break; }
        }
        const left  = scales.x.getPixelForValue(0);
        const right = scales.x.getPixelForValue(last);
        const x = left + (right - left) * (idx / last);
        if (!Number.isFinite(x) || x >= chartArea.right) return;
        ctx.save();
        ctx.fillStyle = surface;
        ctx.fillRect(x, chartArea.top, chartArea.right - x, chartArea.bottom - chartArea.top);
        ctx.strokeStyle = tick;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
      },
    };

    this.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: m.angles,
        datasets: m.muscles.map(mu => ({
          label: mu.label,
          data: mu.curve,
          borderColor: cssColour(this._colour(mu.key)),
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 5,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0].label}° of abduction`,
              afterBody: (items) => {
                const mu = m.muscles[items[0].datasetIndex];
                return mu ? `\n${mu.role}` : '';
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: grid },
            ticks: { color: tick, font: { size: 10 }, callback: (_, i) => `${m.angles[i]}°` },
            title: { display: true, text: 'Arm abduction angle', color: tick, font: { size: 11 } },
          },
          y: {
            min: 0, max: 100,
            grid: { color: grid },
            ticks: { color: tick, font: { size: 10 }, callback: (v) => `${v}%` },
            title: { display: true, text: 'EMG (% of maximum)', color: tick, font: { size: 11 } },
          },
        },
      },
      plugins: [cutoffBand],
    });
  }

  destroy() {
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this._onResize = null;
    this._observer?.disconnect();
    this._observer = null;
    this.chart?.destroy();
    this.chart = null;
  }
}
