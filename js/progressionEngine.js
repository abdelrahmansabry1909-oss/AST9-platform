/* ═══════════════════════════════════════════════════════════════
   NeuCore — Progression Engine v1
   Reads `public.v_client_progression` (migration 20260602) and
   renders the four scores (Compliance / Recovery / Performance /
   Overall) on both the client dashboard and the coach view.

   The view does the math; this module is purely presentation. To
   reweight, ship v_client_progression v2 — never re-derive here.

   Public surface (window.Progression):
     getScores(clientId)             → row | null
     getRecent(clientId)             → reuses getScores; alias kept
                                       for future extensions
     listAll()                       → rows[]  (coach overview;
                                       RLS scopes to assigned clients)
     mountClientPanel(host)          → 4 gauges + supporting line
     mountCoachOverview(host)        → sortable table of all clients
     mountCoachDetail(host, clientId)→ gauges + signal breakdown
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Tone helpers ────────────────────────────────────────────────
  const TONE_FOR = (score) => {
    if (score >= 80) return { color: '#14b8a6', label: 'Strong'   };
    if (score >= 60) return { color: '#84cc16', label: 'Good'     };
    if (score >= 40) return { color: '#f59e0b', label: 'Variable' };
    if (score >= 20) return { color: '#f97316', label: 'At risk'  };
    return                  { color: '#f43f5e', label: 'Critical' };
  };

  // ── DATA LAYER ──────────────────────────────────────────────────
  async function getScores(clientId) {
    if (!clientId) return null;
    const { data, error } = await sb.from('v_client_progression')
      .select('*').eq('client_id', clientId).maybeSingle();
    if (error) { console.warn('[progression] getScores:', error.message); return null; }
    return data || null;
  }
  const getRecent = getScores;        // alias for parity with NotificationsService

  async function listAll() {
    const { data, error } = await sb.from('v_client_progression').select('*');
    if (error) { console.warn('[progression] listAll:', error.message); return []; }
    return data || [];
  }

  // ── Gauge SVG (no dependency) ───────────────────────────────────
  // Semicircular gauge, 160×100 viewBox. Score 0–100 maps to 180° arc.
  function _gaugeSVG(score, color) {
    const s = Math.max(0, Math.min(100, Number(score) || 0));
    const angle  = Math.PI * (s / 100);              // 0..π
    const cx = 80, cy = 80, r = 64;
    const x = cx - r * Math.cos(angle);
    const y = cy - r * Math.sin(angle);
    const largeArc = 0; // always < 180° because we stop at angle
    return `
      <svg viewBox="0 0 160 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
           style="display:block">
        <path d="M16 80 A 64 64 0 0 1 144 80"
              stroke="rgba(255,255,255,0.08)" stroke-width="10" fill="none" stroke-linecap="round"/>
        <path d="M16 80 A 64 64 0 ${largeArc} 1 ${x.toFixed(2)} ${y.toFixed(2)}"
              stroke="${color}" stroke-width="10" fill="none" stroke-linecap="round"
              style="filter:drop-shadow(0 0 6px ${color}55)"/>
        <text x="80" y="74" text-anchor="middle" font-family="var(--font-display,inherit)"
              font-size="28" font-weight="700" fill="var(--text-primary,#fff)">${Math.round(s)}</text>
        <text x="80" y="92" text-anchor="middle" font-size="9"
              fill="var(--text-tertiary,#94a3b8)" letter-spacing="1">/ 100</text>
      </svg>`;
  }

  function _gaugeCard(label, score, sub) {
    const tone = TONE_FOR(score);
    return `
      <div class="prog-gauge" style="background:rgba(255,255,255,.02);border:1px solid var(--border-subtle);
                                     border-radius:12px;padding:14px 12px;display:flex;flex-direction:column;gap:6px;align-items:center">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary)">
          ${esc(label)}
        </div>
        <div style="width:100%;max-width:160px">${_gaugeSVG(score, tone.color)}</div>
        <div style="font-size:11px;font-weight:600;color:${tone.color};letter-spacing:.04em">${esc(tone.label)}</div>
        ${sub ? `<div style="font-size:10px;color:var(--text-tertiary);text-align:center;line-height:1.4">${esc(sub)}</div>` : ''}
      </div>`;
  }

  function _gaugesGrid(row) {
    const deltaSign = row.delta_7d_routine > 0 ? '+' : '';
    return `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:8px">
        ${_gaugeCard('Overall',     row.overall,     'Composite of the three')}
        ${_gaugeCard('Compliance',  row.compliance,  `${row.workouts_completed_30d} workouts · ${row.routine_days_logged_30d} routine days`)}
        ${_gaugeCard('Recovery',    row.recovery,    `${row.workouts_abandoned_30d} abandoned · ${row.alt_requests_30d} alt requests`)}
        ${_gaugeCard('Performance', row.performance, `${row.exercises_tracked_30d} exercises tracked`)}
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--text-tertiary);text-align:center">
        Routine 7-day vs 30-day: <b style="color:${row.delta_7d_routine >= 0 ? '#14b8a6' : '#f43f5e'}">${deltaSign}${row.delta_7d_routine}%</b>
        · v${esc(row.formula_version || '1.0')}
      </div>`;
  }

  // ── CLIENT PANEL ────────────────────────────────────────────────
  async function mountClientPanel(host) {
    if (!host) return;
    const uid = Auth.getUser?.()?.id;
    if (!uid) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="card" style="margin-bottom:18px">
      <div class="card-header">
        <span class="card-title">Your Progress</span>
        <span style="font-size:11px;color:var(--text-tertiary)">Rolling 30 days</span>
      </div>
      <div style="display:flex;justify-content:center;padding:18px"><span class="spinner"></span></div>
    </div>`;
    const row = await getScores(uid);
    if (!row) { host.innerHTML = ''; return; }
    host.innerHTML = `
      <div class="card" style="margin-bottom:18px">
        <div class="card-header">
          <span class="card-title">Your Progress</span>
          <span style="font-size:11px;color:var(--text-tertiary)">Rolling 30 days · v${esc(row.formula_version || '1.0')}</span>
        </div>
        ${_gaugesGrid(row)}
      </div>`;
  }

  // ── COACH OVERVIEW (sortable table) ─────────────────────────────
  let _sortKey  = 'overall';
  let _sortDir  = 'desc';

  async function mountCoachOverview(host) {
    if (!host) return;
    host.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Client Progression Overview</span>
          <span style="font-size:11px;color:var(--text-tertiary)">Click a row for the signal breakdown.</span>
        </div>
        <div id="prog-table-host"><div style="text-align:center;padding:32px"><span class="spinner"></span></div></div>
      </div>
      <div id="prog-detail-host" style="margin-top:18px"></div>`;

    const rows = await listAll();
    if (!rows.length) {
      host.querySelector('#prog-table-host').innerHTML =
        `<div class="empty-state" style="padding:32px"><span class="empty-icon">◎</span>
         <div class="empty-title">No clients yet</div>
         <p class="empty-desc">Scores appear once a client logs workouts or daily routine entries.</p></div>`;
      return;
    }
    // Fetch display names (one extra round-trip — small).
    const { data: names } = await sb.from('profiles')
      .select('id, full_name, email')
      .in('id', rows.map(r => r.client_id));
    const nameById = new Map((names || []).map(p => [p.id, p.full_name || p.email]));

    rows.forEach(r => { r._name = nameById.get(r.client_id) || '—'; });
    _renderTable(host, rows);
  }

  function _renderTable(host, rows) {
    const sorted = rows.slice().sort((a, b) => {
      const av = a[_sortKey], bv = b[_sortKey];
      const cmp = typeof av === 'string'
        ? String(av).localeCompare(String(bv))
        : (av ?? 0) - (bv ?? 0);
      return _sortDir === 'asc' ? cmp : -cmp;
    });

    const arrow = (k) => _sortKey === k ? (_sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const th = (k, label, align = 'left') =>
      `<th data-sort="${k}" style="cursor:pointer;text-align:${align};padding:8px 6px;font-size:11px;
                                   font-weight:700;letter-spacing:1px;text-transform:uppercase;
                                   color:var(--text-tertiary);user-select:none">
         ${esc(label)}${arrow(k)}
       </th>`;

    const cell = (score) => {
      const t = TONE_FOR(score);
      return `<td style="padding:10px 6px;text-align:center;font-weight:700;color:${t.color}">${Math.round(score)}</td>`;
    };

    const tableHost = host.querySelector('#prog-table-host');
    tableHost.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>
            ${th('_name',       'Client')}
            ${th('overall',     'Overall',     'center')}
            ${th('compliance',  'Compliance',  'center')}
            ${th('recovery',    'Recovery',    'center')}
            ${th('performance', 'Performance', 'center')}
            ${th('workouts_completed_30d', '30d Workouts', 'center')}
            ${th('routine_adherence_pct_30d', 'Routine %', 'center')}
            <th></th>
          </tr></thead>
          <tbody>
            ${sorted.map(r => `
              <tr style="border-top:1px solid var(--border-subtle);cursor:pointer" data-row-client="${esc(r.client_id)}">
                <td style="padding:10px 6px;font-weight:600;color:var(--text-primary)">${esc(r._name)}</td>
                ${cell(r.overall)}
                ${cell(r.compliance)}
                ${cell(r.recovery)}
                ${cell(r.performance)}
                <td style="padding:10px 6px;text-align:center;color:var(--text-secondary)">${r.workouts_completed_30d}</td>
                <td style="padding:10px 6px;text-align:center;color:var(--text-secondary)">${Math.round(r.routine_adherence_pct_30d || 0)}%</td>
                <td style="padding:10px 6px;text-align:right"><button class="btn btn-ghost btn-xs">View →</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    tableHost.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (k === _sortKey) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        else { _sortKey = k; _sortDir = (k === '_name') ? 'asc' : 'desc'; }
        _renderTable(host, rows);
      });
    });
    tableHost.querySelectorAll('[data-row-client]').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.dataset.rowClient;
        const row = rows.find(r => r.client_id === id);
        mountCoachDetail(host.querySelector('#prog-detail-host'), id, row);
      });
    });
  }

  // ── COACH DETAIL (gauges + signal breakdown) ────────────────────
  async function mountCoachDetail(host, clientId, prefetched = null) {
    if (!host) return;
    host.innerHTML = `<div class="card"><div style="text-align:center;padding:32px"><span class="spinner"></span></div></div>`;
    const row = prefetched || await getScores(clientId);
    if (!row) { host.innerHTML = ''; return; }

    const signals = [
      ['Workouts completed (30d)',    row.workouts_completed_30d],
      ['Workouts started (30d)',      row.workouts_started_30d],
      ['Workouts abandoned (30d)',    row.workouts_abandoned_30d],
      ['Workouts completed (7d)',     row.workouts_completed_7d],
      ['Avg intensity rating',        row.avg_intensity_30d],
      ['Overreach sessions (≥9/10)',  row.overreach_sessions_30d],
      ['Exercise completion %',       (row.exercise_completion_pct_30d ?? 0) + '%'],
      ['Routine adherence (30d)',     (row.routine_adherence_pct_30d ?? 0) + '%'],
      ['Routine adherence (7d)',      (row.routine_adherence_pct_7d  ?? 0) + '%'],
      ['Routine days logged',         row.routine_days_logged_30d],
      ['Alt-exercise requests',       row.alt_requests_30d],
      ['Exercises tracked (perf.)',   row.exercises_tracked_30d],
    ];

    host.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Detail — ${esc(row._name || clientId)}</span>
          <span style="font-size:11px;color:var(--text-tertiary)">v${esc(row.formula_version || '1.0')} · generated ${esc(new Date(row.generated_at).toLocaleString())}</span>
        </div>
        ${_gaugesGrid(row)}
        <div style="margin-top:16px;border-top:1px solid var(--border-subtle);padding-top:12px">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">Signal Breakdown</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
            ${signals.map(([k, v]) => `
              <div style="padding:8px 10px;background:rgba(255,255,255,.02);border:1px solid var(--border-subtle);border-radius:8px">
                <div style="font-size:10px;color:var(--text-tertiary);letter-spacing:.5px;text-transform:uppercase">${esc(k)}</div>
                <div style="font-size:16px;font-weight:700;color:var(--text-primary)">${esc(v ?? '—')}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  window.Progression = {
    getScores, getRecent, listAll,
    mountClientPanel, mountCoachOverview, mountCoachDetail,
    _TONE_FOR: TONE_FOR,
  };
})();
