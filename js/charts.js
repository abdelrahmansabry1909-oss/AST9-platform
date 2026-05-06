// ═══════════════════════════════════════════════════════════════
//  js/charts.js
//  Workstream C: Progress Visualization
//  Chart.js wrappers for AST9 score history, radar, gait timeline,
//  and dashboard sparklines. Uses existing CSS variables.
// ═══════════════════════════════════════════════════════════════

const Charts = (() => {

  // Chart.js instances — kept for destroy-on-re-render
  const _instances = {};

  // ── Colour tokens pulled from CSS vars ──────────────────────
  const C = {
    lime:  '#c8f04a',
    teal:  '#3df5c1',
    amber: '#f5c842',
    rose:  '#f5426c',
    blue:  '#4290f5',
    gridLine: 'rgba(255,255,255,0.04)',
    tick:     'rgba(255,255,255,0.3)',
    tooltip:  '#161b24',
  };

  // ── Shared Chart.js defaults ─────────────────────────────────
  function _baseDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color            = C.tick;
    Chart.defaults.font.family      = "'Satoshi', 'DM Sans', sans-serif";
    Chart.defaults.font.size        = 11;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = C.tooltip;
    Chart.defaults.plugins.tooltip.borderColor      = 'rgba(255,255,255,0.08)';
    Chart.defaults.plugins.tooltip.borderWidth      = 1;
    Chart.defaults.plugins.tooltip.padding          = 10;
    Chart.defaults.plugins.tooltip.cornerRadius     = 8;
    Chart.defaults.plugins.tooltip.titleColor       = '#f0f2f7';
    Chart.defaults.plugins.tooltip.bodyColor        = 'rgba(255,255,255,0.6)';
  }

  function _destroy(key) {
    if (_instances[key]) { _instances[key].destroy(); delete _instances[key]; }
  }

  function _ensureChartJs(callback) {
    if (typeof Chart !== 'undefined') { _baseDefaults(); callback(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    script.onload = () => { _baseDefaults(); callback(); };
    document.head.appendChild(script);
  }

  // ═══════════════════════════════════════════════════════════
  //  SCORE HISTORY — Line chart (5 dimensions over time)
  // ═══════════════════════════════════════════════════════════

  async function renderScoreHistory(clientId, canvasId = 'chart-score-history') {
    _ensureChartJs(async () => {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      const { data } = await sb
        .from('progress_snapshots')
        .select('session_date,rom_score,control_score,force_score,neurology_score,composite_score')
        .eq('client_id', clientId)
        .order('session_date', { ascending: true })
        .limit(20);

      if (!data?.length) {
        canvas.closest('.chart-container')?.classList.add('chart-empty');
        return;
      }

      const labels = data.map(r => new Date(r.session_date).toLocaleDateString('en-GB', { day:'numeric', month:'short' }));

      _destroy(canvasId);
      _instances[canvasId] = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            _lineDataset('Composite', data.map(r => r.composite_score), C.lime, true),
            _lineDataset('ROM',       data.map(r => r.rom_score),       C.teal),
            _lineDataset('Control',   data.map(r => r.control_score),   C.amber),
            _lineDataset('Force',     data.map(r => r.force_score),     C.rose),
            _lineDataset('Neurology', data.map(r => r.neurology_score), C.blue),
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true, position: 'bottom',
              labels: { usePointStyle: true, pointStyleWidth: 8, padding: 16, color: C.tick },
            },
            tooltip: {
              callbacks: {
                label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%`,
              },
            },
          },
          scales: {
            x: { grid: { color: C.gridLine }, ticks: { maxRotation: 0 } },
            y: { min: 0, max: 100, grid: { color: C.gridLine },
              ticks: { callback: v => v + '%' } },
          },
        },
      });
    });
  }

  function _lineDataset(label, data, color, thick = false) {
    return {
      label, data,
      borderColor:   color,
      backgroundColor: color + '18',
      borderWidth:   thick ? 2.5 : 1.5,
      pointRadius:   thick ? 4 : 2.5,
      pointHoverRadius: 6,
      tension:       0.4,
      fill:          thick,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  RADAR — Current vs Previous assessment
  // ═══════════════════════════════════════════════════════════

  async function renderRadar(clientId, canvasId = 'chart-radar') {
    _ensureChartJs(async () => {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      const { data } = await sb
        .from('progress_snapshots')
        .select('rom_score,control_score,force_score,neurology_score,session_date')
        .eq('client_id', clientId)
        .order('session_date', { ascending: false })
        .limit(2);

      if (!data?.length) return;

      const current  = data[0];
      const previous = data[1];
      const labels   = ['ROM', 'Control', 'Force', 'Neurology'];

      _destroy(canvasId);
      _instances[canvasId] = new Chart(canvas, {
        type: 'radar',
        data: {
          labels,
          datasets: [
            {
              label: 'Current',
              data:  [current.rom_score, current.control_score, current.force_score, current.neurology_score],
              borderColor:     C.lime,
              backgroundColor: C.lime + '22',
              pointBackgroundColor: C.lime,
              borderWidth: 2,
            },
            ...(previous ? [{
              label: 'Previous',
              data:  [previous.rom_score, previous.control_score, previous.force_score, previous.neurology_score],
              borderColor:     C.teal + '80',
              backgroundColor: C.teal + '0a',
              pointBackgroundColor: C.teal,
              borderWidth: 1.5,
              borderDash: [4, 3],
            }] : []),
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: !!previous, position: 'bottom', labels: { color: C.tick, padding: 12 } } },
          scales: {
            r: {
              min: 0, max: 100,
              grid: { color: C.gridLine },
              ticks: { display: false },
              pointLabels: { color: C.tick, font: { size: 11, weight: '600' } },
            },
          },
        },
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  GAIT PHASE TIMELINE — Horizontal bar chart
  // ═══════════════════════════════════════════════════════════

  async function renderGaitTimeline(clientId, canvasId = 'chart-gait-timeline') {
    _ensureChartJs(async () => {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      const { data } = await sb
        .from('gait_assessments')
        .select('phase_deficiencies,created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (!data?.length) return;

      const gaitPhases = ['loading_response','mid_stance','terminal_stance','pre_swing','initial_swing','mid_swing','terminal_swing'];
      const phaseLabels = ['Load Resp','Mid Stance','Term Stance','Pre-Swing','Init Swing','Mid Swing','Term Swing'];

      const sessions = data.reverse();
      const sessionLabels = sessions.map(s => new Date(s.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' }));

      // Build dataset: one bar per gait phase, showing deficiency count per session
      const datasets = gaitPhases.map((phase, i) => ({
        label: phaseLabels[i],
        data:  sessions.map(s => {
          const defs = s.phase_deficiencies?.[phase] || [];
          return Array.isArray(defs) ? defs.length : 0;
        }),
        backgroundColor: `hsl(${i * 50}, 70%, 55%)`,
        borderRadius: 4,
      }));

      _destroy(canvasId);
      _instances[canvasId] = new Chart(canvas, {
        type: 'bar',
        data: { labels: sessionLabels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'bottom', labels: { color: C.tick, padding: 10, boxWidth: 10 } },
            tooltip: { mode: 'index', intersect: false },
          },
          scales: {
            x: { stacked: true, grid: { color: C.gridLine } },
            y: { stacked: true, grid: { color: C.gridLine }, ticks: { stepSize: 1, callback: v => v + ' def' } },
          },
        },
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  SPARKLINE — Mini trend for dashboard client cards
  // ═══════════════════════════════════════════════════════════

  async function renderSparkline(clientId, canvasId, dimension = 'composite_score') {
    _ensureChartJs(async () => {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      const { data } = await sb
        .from('progress_snapshots')
        .select(`session_date,${dimension}`)
        .eq('client_id', clientId)
        .order('session_date', { ascending: true })
        .limit(8);

      if (!data?.length) return;

      const values = data.map(r => r[dimension] || 0);
      const trend  = values.length > 1 && values[values.length - 1] >= values[0];

      _destroy(canvasId);
      _instances[canvasId] = new Chart(canvas, {
        type: 'line',
        data: {
          labels: values.map(() => ''),
          datasets: [{
            data: values,
            borderColor:     trend ? C.lime : C.rose,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.4,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false },
            y: { display: false, min: 0, max: 100 },
          },
          animation: false,
        },
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  PROGRESS SNAPSHOT — save snapshot after each session
  // ═══════════════════════════════════════════════════════════

  async function saveSnapshot(clientId, assessmentId, scores, phase) {
    if (!clientId) return;
    try {
      await sb.from('progress_snapshots').insert({
        client_id:       clientId,
        assessment_id:   assessmentId || null,
        session_date:    new Date().toISOString().split('T')[0],
        rom_score:       scores.rom_score       || null,
        control_score:   scores.control_score   || null,
        force_score:     scores.force_score     || null,
        neurology_score: scores.neurology_score || null,
        composite_score: scores.composite_score || null,
        phase:           phase || null,
      });
    } catch(e) {
      console.warn('Charts.saveSnapshot (non-fatal):', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CLIENT PROGRESS PAGE — full render
  // ═══════════════════════════════════════════════════════════

  async function renderClientProgressPage(clientId) {
    const el = document.getElementById('section-progress');
    if (!el) return;

    el.innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1 class="page-title">Progress <span class="accent">Charts</span></h1>
          <p class="page-subtitle" id="progress-client-name">Loading…</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost" onclick="ProgressReport.generatePDF('${clientId}')">🖨 Export PDF</button>
        </div>
      </div>
      <div class="grid-2" style="gap:var(--sp-5);margin-bottom:var(--sp-5)">
        <div class="card">
          <div class="card-header"><span class="card-title">Score History</span></div>
          <div class="chart-container" style="height:280px"><canvas id="chart-score-history"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Current vs Previous</span></div>
          <div class="chart-container" style="height:280px"><canvas id="chart-radar"></canvas></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-header"><span class="card-title">Gait Phase Deficits — Session History</span></div>
        <div class="chart-container" style="height:220px"><canvas id="chart-gait-timeline"></canvas></div>
      </div>`;

    // Resolve client name
    if (Auth.isAdminOrCoach()) {
      const { data: profile } = await sb.from('profiles').select('full_name,email').eq('id', clientId).single();
      const nameEl = document.getElementById('progress-client-name');
      if (nameEl && profile) nameEl.textContent = profile.full_name || profile.email;
    }

    // Render all charts
    await Promise.all([
      renderScoreHistory(clientId),
      renderRadar(clientId),
      renderGaitTimeline(clientId),
    ]);
  }

  return {
    renderScoreHistory, renderRadar, renderGaitTimeline, renderSparkline,
    saveSnapshot, renderClientProgressPage,
  };

})();

window.Charts = Charts;
