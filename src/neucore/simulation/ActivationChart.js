// src/neucore/simulation/ActivationChart.js
import { Chart, registerables } from 'chart.js';
import { bus } from '../core/JointBus.js';
import { GAIT_PHASES, computeClientActivation } from './MuscleActivationDB.js';

Chart.register(...registerables);

const CHART_MUSCLES = [
  { key: 'gluteus_maximus',    label: 'Glut Max',  color: '#FF6B6B' },
  { key: 'gluteus_medius',     label: 'Glut Med',  color: '#FF2D78' },
  { key: 'iliopsoas',          label: 'Iliopsoas', color: '#9B59B6' },
  { key: 'vastus_lateralis',   label: 'Vast Lat',  color: '#3498DB' },
  { key: 'vastus_medialis',    label: 'Vast Med',  color: '#2ECC71' },
  { key: 'hamstrings',         label: 'Hams',      color: '#E67E22' },
  { key: 'gastrocnemius',      label: 'Gastroc',   color: '#1ABC9C' },
  { key: 'soleus',             label: 'Soleus',    color: '#00D4FF' },
  { key: 'tibialis_anterior',  label: 'Tib Ant',   color: '#FACC15' },
  { key: 'tibialis_posterior', label: 'Tib Post',  color: '#F97316' },
  { key: 'tensor_fascia_latae',label: 'TFL',       color: '#EC4899' },
  { key: 'erector_spinae',     label: 'ES',        color: '#8B5CF6' },
];

export class ActivationChart {
  constructor(containerEl, clientActivation) {
    this.container     = containerEl;
    this.activation    = clientActivation;
    this.chart         = null;
    this._currentPhase = 'mid_stance';

    this._buildDOM();
    this._initChart();
    this._bindEvents();
  }

  _buildDOM() {
    const isBright = document.body.classList.contains('nc-bright');
    const wrapBg = isBright ? '#FFFFFF' : 'rgba(5,13,26,0.92)';
    const wrapBorder = isBright ? '1px solid rgba(24, 28, 50, 0.08)' : '0.5px solid rgba(0,212,255,0.2)';
    const wrapShadow = isBright ? 'var(--nc-shadow-card)' : 'none';
    const labelColor = isBright ? '#181C32' : 'inherit';
    const subColor = isBright ? '#7E8299' : 'rgba(0,212,255,0.6)';
    const indicatorBorder = isBright ? '1px solid rgba(4, 120, 87, 0.2)' : '0.5px solid rgba(0,212,255,0.4)';
    const indicatorColor = isBright ? '#047857' : '#00D4FF';
    const indicatorBg = isBright ? 'rgba(4, 120, 87, 0.06)' : 'rgba(0,212,255,0.08)';
    const normLegendText = isBright ? '#4B5565' : 'rgba(0,212,255,0.6)';
    const normLegendBar = isBright ? 'rgba(4, 120, 87, 0.15)' : '#00D4FF44';
    const clientLegendText = isBright ? '#4B5565' : 'rgba(255,45,120,0.7)';

    this.container.innerHTML = `
      <div class="activation-chart-wrap" style="
        background:${wrapBg};border:${wrapBorder};box-shadow:${wrapShadow};
        border-radius:12px;padding:16px;backdrop-filter:blur(16px);
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <div class="nc-label" style="color:${labelColor}">Muscle Activation</div>
            <div style="font-size:12px;color:${subColor}">Source: Neumann 3rd Ed.</div>
          </div>
          <div id="phase-indicator" style="
            font-size:11px;font-weight:500;padding:4px 12px;border-radius:99px;
            border:${indicatorBorder};color:${indicatorColor};background:${indicatorBg};
          ">—</div>
        </div>
        <canvas id="activation-canvas" height="280"></canvas>
        <div style="display:flex;gap:16px;margin-top:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:${normLegendText}">
            <div style="width:16px;height:4px;background:${normLegendBar};border-radius:2px"></div>Normative
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:${clientLegendText}">
            <div style="width:16px;height:4px;background:#FF2D78;border-radius:2px"></div>Client
          </div>
        </div>
        <div id="activation-deficit-notes" style="margin-top:12px"></div>
      </div>
    `;
    this._canvas  = this.container.querySelector('#activation-canvas');
    this._phaseEl = this.container.querySelector('#phase-indicator');
    this._notesEl = this.container.querySelector('#activation-deficit-notes');
  }

  _initChart() {
    const isBright = document.body.classList.contains('nc-bright');
    const labels     = CHART_MUSCLES.map(m => m.label);
    const normData   = CHART_MUSCLES.map(m => this.activation[m.key]?.mid_stance?.normative ?? 0);
    const actualData = CHART_MUSCLES.map(m => this.activation[m.key]?.mid_stance?.actual   ?? 0);

    const normBg = isBright ? 'rgba(4, 120, 87, 0.08)' : 'rgba(0,212,255,0.15)';
    const normBorder = isBright ? 'rgba(4, 120, 87, 0.35)' : 'rgba(0,212,255,0.5)';
    const gridColor = isBright ? 'rgba(24, 28, 50, 0.06)' : 'rgba(0,212,255,0.06)';
    const tickColor = isBright ? '#4B5565' : 'rgba(0,212,255,0.55)';
    const titleColor = isBright ? '#4B5565' : 'rgba(0,212,255,0.5)';

    this.chart = new Chart(this._canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label:'Normative %MVIC', data:normData,   backgroundColor:normBg, borderColor:normBorder, borderWidth:1, borderRadius:3 },
          { label:'Client %MVIC',    data:actualData, backgroundColor:CHART_MUSCLES.map(m => m.color+'CC'), borderColor:CHART_MUSCLES.map(m => m.color), borderWidth:1, borderRadius:3 },
        ],
      },
      options: {
        responsive: true,
        animation:  { duration: 800, easing: 'easeInOutCubic' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isBright ? '#FFFFFF' : 'rgba(5,13,26,0.95)',
            borderColor: isBright ? 'rgba(24, 28, 50, 0.08)' : 'rgba(0,212,255,0.3)',
            borderWidth: 1,
            titleColor: isBright ? '#047857' : '#00D4FF',
            bodyColor: isBright ? '#4B5565' : 'rgba(200,240,255,0.8)',
            callbacks: {
              afterBody: (items) => {
                const muscle = CHART_MUSCLES[items[0].dataIndex];
                const data   = this.activation[muscle.key]?.[this._currentPhase];
                if (!data?.modifiers?.length) return '';
                return '\nDeficits:\n' + data.modifiers.map(m => `• ${m.reason}`).join('\n');
              },
            },
          },
        },
        scales: {
          x: { grid:{ color:gridColor }, ticks:{ color:tickColor, font:{ size:10 } } },
          y: {
            min:0, max:100,
            grid:{ color:gridColor },
            ticks:{ color:tickColor, font:{ size:10 }, callback:v => v+'%' },
            title:{ display:true, text:'%MVIC', color:titleColor, font:{ size:11 } },
          },
        },
      },
    });
  }

  updatePhase(phaseName) {
    if (!this.chart || phaseName === this._currentPhase) return;
    this._currentPhase = phaseName;

    this.chart.data.datasets[0].data = CHART_MUSCLES.map(m => this.activation[m.key]?.[phaseName]?.normative ?? 0);
    this.chart.data.datasets[1].data = CHART_MUSCLES.map(m => this.activation[m.key]?.[phaseName]?.actual   ?? 0);
    this.chart.update();

    this._phaseEl.textContent = phaseName.replace(/_/g,' ').toUpperCase();
    this._updateDeficitNotes(phaseName);
  }

  _updateDeficitNotes(phase) {
    const affected = CHART_MUSCLES.map(m => {
      const data  = this.activation[m.key]?.[phase];
      if (!data) return null;
      const delta = data.actual - data.normative;
      if (Math.abs(delta) < 8) return null;
      return { label: m.label, delta, reason: data.modifiers?.[0]?.reason ?? '' };
    }).filter(Boolean).sort((a, b) => a.delta - b.delta).slice(0, 3);

    if (!affected.length) { this._notesEl.innerHTML = ''; return; }

    const isBright = document.body.classList.contains('nc-bright');
    const labelColor = isBright ? '#181C32' : 'inherit';
    const noteColor = isBright ? '#4B5565' : 'rgba(200,240,255,0.7)';
    const noteBorder = isBright ? '0.5px solid rgba(24, 28, 50, 0.06)' : '0.5px solid rgba(0,212,255,0.08)';

    this._notesEl.innerHTML = `
      <div class="nc-label" style="margin-bottom:6px;color:${labelColor}">Notable this phase</div>
      ${affected.map(m => {
        const deltaColor = m.delta < 0 ? '#FF2D78' : (isBright ? '#18A058' : '#00FF88');
        return `
          <div style="font-size:11px;color:${noteColor};padding:4px 0;
                     border-bottom:${noteBorder};display:flex;gap:8px">
            <span style="min-width:60px;font-weight:500;color:${deltaColor}">
              ${m.label} ${m.delta > 0 ? '+' : ''}${m.delta}%
            </span>
            <span>${m.reason}</span>
          </div>
        `;
      }).join('')}
    `;
  }

  _bindEvents() {
    bus.on('gait:phaseChange', ({ phase }) => this.updatePhase(phase));
  }

  destroy() { this.chart?.destroy(); }
}
