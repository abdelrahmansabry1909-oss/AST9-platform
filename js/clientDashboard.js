/* ═══════════════════════════════════════════════════════════════
   CLIENT DASHBOARD — role-aware Home for clients

   When `Dashboard.showSection('dashboard')` fires and the active
   user has role === 'client', this module owns the rendering of
   `#section-client-dashboard` instead of the coach `#section-dashboard`.

   Phase A scope (this file):
     - Static shell + read-only mocked content.
     - Hero region is a placeholder for the Phase-B 3D Load Visualizer.
     - The three metric panels are placeholders for Phase-C charts.
     - The right column ("Peer Success Gallery") shows nothing yet —
       Phase-D will pull from admin-approved case_shares.

   PRESERVE FIRST: nothing here touches existing coach flows. The
   coach `#section-dashboard` (DashboardStats) is unchanged.
   ═══════════════════════════════════════════════════════════════ */

const ClientDashboard = (() => {
  'use strict';

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

    root.innerHTML = `
      <!-- HEADER -->
      <div class="cd-header">
        <div class="cd-eyebrow">Your Recovery</div>
        <h1 class="cd-title">Welcome back, <span class="accent">${_esc(firstName)}</span>.</h1>
        <p class="cd-subtitle">A read-only view of where you are today and where your coach is taking you.</p>
      </div>

      <!-- HERO — Point A vs Point B 3D Load Visualizer (Phase B fills this) -->
      <div class="cd-hero card glass-card">
        <div class="cd-hero-top">
          <div>
            <div class="nc-dashboard-eyebrow">Recovery Dashboard</div>
            <div class="cd-hero-title">Load Distribution</div>
          </div>
          <div class="cd-toggle" role="tablist" aria-label="Load state">
            <button class="cd-toggle-btn active" data-state="A" disabled>
              ● Current Load <span class="cd-toggle-sub">(Point A)</span>
            </button>
            <button class="cd-toggle-btn" data-state="B" disabled>
              ◯ Target Load <span class="cd-toggle-sub">(Point B)</span>
            </button>
          </div>
        </div>
        <div id="cd-hero-canvas" class="cd-hero-canvas">
          <div class="cd-placeholder">
            <span class="cd-placeholder-icon">⬡</span>
            <div class="cd-placeholder-title">3D Load Visualizer</div>
            <div class="cd-placeholder-sub">Activating in Phase B — anatomical skeleton with red→teal load coloring.</div>
          </div>
        </div>
        <div class="cd-load-overlays">
          ${_loadOverlay('Lower Back',  70, 25)}
          ${_loadOverlay('Right Hip',   62, 30)}
          ${_loadOverlay('Left Knee',   45, 22)}
          ${_loadOverlay('Cervical',    38, 18)}
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
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function _loadOverlay(region, current, target) {
    const delta = current - target;
    return `
      <div class="cd-load-card">
        <div class="cd-load-region">${_esc(region)}</div>
        <div class="cd-load-numbers">
          <span class="cd-load-current">${current}%</span>
          <span class="cd-load-arrow">→</span>
          <span class="cd-load-target">${target}%</span>
        </div>
        <div class="cd-load-delta">${delta > 0 ? `−${delta}% load` : `${delta}% load`}</div>
      </div>`;
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
