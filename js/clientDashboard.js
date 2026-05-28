/* ═══════════════════════════════════════════════════════════════
   CLIENT DASHBOARD — role-aware Home for clients

   When `Dashboard.showSection('dashboard')` fires and the active
   user has role === 'client', this module owns the rendering of
   `#section-client-dashboard` instead of the coach `#section-dashboard`.

   Phase A: scaffolded the layout.
   Phase B (this file now): wire the hero to a live 3D LoadVisualizer
                            driven by the client's most recent
                            rehab_objective_assessments row, and make
                            the Point A / Point B toggle work.

   PRESERVE FIRST: nothing here touches existing coach flows.
   ═══════════════════════════════════════════════════════════════ */

const ClientDashboard = (() => {
  'use strict';

  // Module-scoped state. Per ADR-012: own your slice locally.
  let _viz       = null;            // LoadVisualizer instance
  let _profile   = null;            // { currentA, targetB, hasRealData }
  let _state     = 'A';             // current toggle state
  let _renderedFor = null;          // client_id we last rendered for

  function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Public entry point — called by Dashboard.showSection('dashboard')
  //    when Auth.getRole() === 'client'.
  function render() {
    const root = document.getElementById('client-dashboard-root');
    if (!root) return;

    const profile  = (typeof Auth !== 'undefined' && Auth.getProfile) ? Auth.getProfile() : null;
    const firstName = (profile?.full_name || '').split(' ')[0] || 'there';
    const clientId  = profile?.id || null;

    root.innerHTML = `
      <!-- HEADER -->
      <div class="cd-header">
        <div class="cd-eyebrow">Your Recovery</div>
        <h1 class="cd-title">Welcome back, <span class="accent">${_esc(firstName)}</span>.</h1>
        <p class="cd-subtitle">A read-only view of where you are today and where your coach is taking you.</p>
      </div>

      <!-- HERO — Point A vs Point B 3D Load Visualizer -->
      <div class="cd-hero card glass-card">
        <div class="cd-hero-top">
          <div>
            <div class="nc-dashboard-eyebrow">Recovery Dashboard</div>
            <div class="cd-hero-title">Load Distribution</div>
            <div class="cd-hero-meta" id="cd-hero-meta">Loading your most recent assessment…</div>
          </div>
          <div class="cd-toggle" role="tablist" aria-label="Load state">
            <button class="cd-toggle-btn active" data-state="A" type="button">
              ● Current Load <span class="cd-toggle-sub">(Point A)</span>
            </button>
            <button class="cd-toggle-btn"        data-state="B" type="button">
              ◯ Target Load  <span class="cd-toggle-sub">(Point B)</span>
            </button>
          </div>
        </div>
        <div id="cd-hero-canvas" class="cd-hero-canvas"></div>
        <div class="cd-load-overlays" id="cd-load-overlays">
          ${_renderOverlays({ currentA:{}, targetB:{} }, 'A')}
        </div>
      </div>

      <!-- 3-COLUMN METRIC ROW (Phase C fills this with real Chart.js) -->
      <div class="cd-metrics-grid">
        ${_metricCard('Force Steadiness',  'Joint stability during movement', 'cd-metric-force')}
        ${_metricCard('Center of Gravity', 'Sagittal-plane drift while walking', 'cd-metric-cog')}
        ${_metricCard('Risk Timeline',     'What an unaddressed load pattern projects to', 'cd-metric-risk', 'danger')}
      </div>

      <!-- ASSESSMENT REPORT + RIGHT RAIL -->
      <div class="cd-secondary-grid">
        <div class="card glass-card cd-assessment">
          <div class="card-header">
            <span class="card-title">Assessment Report</span>
            <span class="badge badge-phase1">From your coach</span>
          </div>
          <div class="cd-assessment-body">
            <div class="cd-assessment-row">
              <div class="cd-assessment-label">True Driver</div>
              <div class="cd-assessment-value">Loading…</div>
            </div>
            <div class="cd-assessment-row">
              <div class="cd-assessment-label">Reported Symptoms</div>
              <div class="cd-assessment-value">Loading…</div>
            </div>
            <div class="cd-assessment-row">
              <div class="cd-assessment-label">Coach's notes</div>
              <div class="cd-assessment-value cd-assessment-notes">Your coach will write a brief here once your first session is complete.</div>
            </div>
          </div>
        </div>

        <div class="card glass-card cd-peer">
          <div class="card-header">
            <span class="card-title">Peer Success Gallery</span>
          </div>
          <div class="cd-peer-body">
            <div class="empty-state" style="padding:24px 8px">
              <span class="empty-icon">◉</span>
              <div class="empty-title">Coming soon</div>
              <p class="empty-desc">Anonymized stories from clients who moved from Point A to Point B.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Wire the toggle right away so it feels responsive even before
    // the skeleton finishes loading.
    _wireToggle();

    // Mount / refresh the 3D visualizer once. Repeat renders for the
    // same client reuse the existing visualizer; switching client
    // disposes and rebuilds.
    _mountVisualizer(clientId);
  }

  // ── Toggle ───────────────────────────────────────────────────────
  function _wireToggle() {
    document.querySelectorAll('#client-dashboard-root .cd-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => _setState(btn.dataset.state));
    });
  }

  function _setState(state) {
    if (state !== 'A' && state !== 'B') return;
    _state = state;
    document.querySelectorAll('#client-dashboard-root .cd-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.state === state);
    });
    if (_viz) _viz.setState?.(state);
    const wrap = document.getElementById('cd-load-overlays');
    if (wrap && _profile) wrap.innerHTML = _renderOverlays(_profile, state);
  }

  // ── 3D visualizer mount + data load ──────────────────────────────
  async function _mountVisualizer(clientId) {
    const host = document.getElementById('cd-hero-canvas');
    if (!host) return;

    // Same client → reapply state, don't rebuild.
    if (_viz && _renderedFor === clientId) {
      _viz.setState?.(_state);
      return;
    }

    // Different client (or first mount) → dispose any prior and rebuild.
    try { _viz?.destroy?.(); } catch {}
    _viz = null;
    _renderedFor = clientId;

    const assessment = await _loadLatestAssessment(clientId);
    _profile = _deriveProfile(assessment);

    // Refresh overlay numbers with derived data.
    const wrap = document.getElementById('cd-load-overlays');
    if (wrap) wrap.innerHTML = _renderOverlays(_profile, _state);

    // Surface a friendly meta line under the title.
    const meta = document.getElementById('cd-hero-meta');
    if (meta) {
      meta.textContent = _profile.hasRealData
        ? 'Based on your most recent assessment.'
        : 'Showing illustrative values — complete an assessment for personalised data.';
    }

    // window.LoadVisualizer comes from src/main.js (ADR-002 bridge).
    const Viz = window.LoadVisualizer;
    if (!Viz) {
      host.innerHTML = `<div class="cd-placeholder">
        <span class="cd-placeholder-icon">⚠</span>
        <div class="cd-placeholder-sub">3D engine not ready — reload the page.</div>
      </div>`;
      return;
    }

    _viz = new Viz(host, _profile);
    _viz.setState(_state);
  }

  async function _loadLatestAssessment(clientId) {
    if (!clientId || typeof sb === 'undefined') return null;
    try {
      const { data, error } = await sb
        .from('rehab_objective_assessments')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) { console.warn('[client-dashboard] assessment load:', error.message); return null; }
      return data || null;
    } catch (e) {
      console.warn('[client-dashboard] assessment load threw:', e.message);
      return null;
    }
  }

  function _deriveProfile(assessment) {
    // window.deriveLoadProfile comes from src/main.js (ADR-002 bridge).
    if (typeof window.deriveLoadProfile === 'function') {
      return window.deriveLoadProfile(assessment);
    }
    // Defensive fallback if the module bundle hasn't loaded yet.
    return {
      currentA: { 'Lower Back': 70, 'Right Hip': 62, 'Left Hip': 55,
                  'Right Knee': 45, 'Left Knee': 40, 'Cervical': 38 },
      targetB:  { 'Lower Back': 25, 'Right Hip': 28, 'Left Hip': 28,
                  'Right Knee': 22, 'Left Knee': 22, 'Cervical': 18 },
      hasRealData: false,
    };
  }

  // ── Render helpers ───────────────────────────────────────────────
  function _renderOverlays(profile, state) {
    const a = profile.currentA || {};
    const b = profile.targetB  || {};
    const rows = ['Lower Back', 'Right Hip', 'Left Knee', 'Cervical'];   // top 4 by blueprint
    return rows.map(region => {
      const cur = Math.round(a[region] ?? 0);
      const tgt = Math.round(b[region] ?? 0);
      const shown = state === 'A' ? cur : tgt;
      const otherLabel = state === 'A' ? `target ${tgt}%` : `current ${cur}%`;
      return `
        <div class="cd-load-card">
          <div class="cd-load-region">${_esc(region)}</div>
          <div class="cd-load-numbers">
            <span class="${state === 'A' ? 'cd-load-current' : 'cd-load-target'}">${shown}%</span>
          </div>
          <div class="cd-load-delta">${_esc(otherLabel)}</div>
        </div>`;
    }).join('');
  }

  function _metricCard(title, subtitle, id, variant = '') {
    return `
      <div class="card glass-card cd-metric ${variant === 'danger' ? 'cd-metric--danger' : ''}">
        <div class="card-header">
          <span class="card-title">${_esc(title)}</span>
        </div>
        <div class="cd-metric-sub">${_esc(subtitle)}</div>
        <div class="cd-metric-chart" id="${id}">
          <div class="cd-placeholder cd-placeholder--small">
            <span class="cd-placeholder-icon">◎</span>
            <div class="cd-placeholder-sub">Chart in Phase C</div>
          </div>
        </div>
      </div>`;
  }

  return { render };
})();

window.ClientDashboard = ClientDashboard;
