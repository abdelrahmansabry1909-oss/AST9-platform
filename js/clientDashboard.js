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
  let _charts    = { force: null, cog: null, risk: null };  // Chart.js instances

  function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Subscription pill + grace banner (data from Auth cache) ─────
  // Reads the effective state cached on the profile during Auth.init /
  // Auth.login. No extra round-trip.
  const PILL_TONE = {
    teal:  'background:rgba(20,184,166,.14);color:var(--nc-teal,#14b8a6);border:1px solid rgba(20,184,166,.35)',
    amber: 'background:rgba(245,158,11,.14);color:#f59e0b;border:1px solid rgba(245,158,11,.35)',
    rose:  'background:rgba(244,63,94,.14);color:#f43f5e;border:1px solid rgba(244,63,94,.35)',
    gray:  'background:rgba(148,163,184,.10);color:#94a3b8;border:1px solid rgba(148,163,184,.25)',
  };

  function _getState() {
    if (typeof Auth === 'undefined' || !Auth.getSubscriptionState) return null;
    return Auth.getSubscriptionState();
  }

  function _renderSubscriptionPill() {
    const state = _getState();
    if (!state) return '';
    const pill  = (typeof SubscriptionService !== 'undefined')
      ? SubscriptionService.formatPill(state)
      : { label: 'Subscription', tone: 'gray' };
    const style = PILL_TONE[pill.tone] || PILL_TONE.gray;
    return `
      <div class="cd-subscription-pill" title="Subscription status"
           style="display:inline-flex;align-items:center;gap:6px;
                  padding:6px 12px;border-radius:999px;font-size:11px;
                  font-weight:600;letter-spacing:.04em;text-transform:uppercase;
                  ${style}">
        <span style="width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.7"></span>
        ${_esc(pill.label)}
      </div>`;
  }

  function _renderSubscriptionBanner() {
    const state = _getState();
    if (!state) return '';
    if (state.effective_status !== 'grace') return '';
    const g = state.grace_days_left ?? 0;
    return `
      <div role="alert"
           style="margin-bottom:18px;padding:14px 18px;border-radius:12px;
                  background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.3);
                  display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <span style="font-size:22px;line-height:1">⚠</span>
        <div style="flex:1;min-width:220px">
          <div style="font-size:14px;font-weight:700;color:#f43f5e;margin-bottom:2px">
            Subscription grace period — ${g} day${g === 1 ? '' : 's'} left
          </div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.5">
            Your plan ended on ${_esc(state.end_date || '')}. Reach out to your coach to renew before
            access becomes read-only on ${_esc(state.grace_until || '')}.
          </div>
        </div>
      </div>`;
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
      ${_renderSubscriptionBanner()}

      <!-- HEADER -->
      <div class="cd-header">
        <div class="cd-header-top" style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
          <div>
            <div class="cd-eyebrow">Your Recovery</div>
            <h1 class="cd-title">Welcome back, <span class="accent">${_esc(firstName)}</span>.</h1>
            <p class="cd-subtitle">A read-only view of where you are today and where your coach is taking you.</p>
          </div>
          ${_renderSubscriptionPill()}
        </div>
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

      <!-- Feature 4 — Progression Engine gauges (renders async) -->
      <div id="cd-progression-host" style="margin-bottom:18px"></div>

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

    // Feature 4 — render the 4-score progression panel into its slot.
    if (typeof Progression !== 'undefined') {
      Progression.mountClientPanel(document.getElementById('cd-progression-host'));
    }

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

    const [assessment, gait] = await Promise.all([
      _loadLatestAssessment(clientId),
      _loadLatestGait(clientId),
    ]);
    _profile = _deriveProfile(assessment);

    // Phase C — render the three metric charts in parallel to the 3D mount.
    _renderMetricCharts(assessment, gait, _profile);

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

  async function _loadLatestGait(clientId) {
    if (!clientId || typeof sb === 'undefined') return null;
    try {
      const { data, error } = await sb
        .from('gait_assessments')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) { console.warn('[client-dashboard] gait load:', error.message); return null; }
      return data || null;
    } catch (e) {
      console.warn('[client-dashboard] gait load threw:', e.message);
      return null;
    }
  }

  // ── Phase C — Chart.js panels ────────────────────────────────────
  function _renderMetricCharts(assessment, gait, profile) {
    const CC = window.ClientCharts;
    if (!CC) return;            // ES module bundle not ready

    // Dispose any prior chart instances (re-render path).
    CC.destroyChart(_charts.force); CC.destroyChart(_charts.cog); CC.destroyChart(_charts.risk);
    _charts = { force: null, cog: null, risk: null };

    const forceHost = document.getElementById('cd-metric-force');
    const cogHost   = document.getElementById('cd-metric-cog');
    const riskHost  = document.getElementById('cd-metric-risk');

    if (forceHost) {
      const data = CC.deriveForceSteadiness(gait);
      _charts.force = CC.renderForceSteadiness(forceHost, data);
    }
    if (cogHost) {
      const data = CC.deriveCenterOfGravity(assessment, gait);
      _charts.cog = CC.renderCenterOfGravity(cogHost, data);
    }
    if (riskHost) {
      const compositeScore = typeof assessment?.composite_score === 'number'
        ? assessment.composite_score : null;
      const data = CC.deriveRiskTimeline(profile, compositeScore);
      _charts.risk = CC.renderRiskTimeline(riskHost, data);
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
