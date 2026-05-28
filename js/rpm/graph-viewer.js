/* ═══════════════════════════════════════════════════════════════
   NeuCore RPM — Graph Viewer (Client UI)
   Phase 3C · Cite: docs/rehab-book/o-sullivan-graded-exposure-ladder.md
   Renders the published Reactive Graph for the logged-in client.
   - Vertical bottom-up ladder (phase 1 at bottom, phase N at top)
   - Locked phases: greyscale + 🔒
   - Active phase: glowing border, exercise checklist, milestone submit
   - Completed phases: gold tint
   - Submit-for-review → INSERT phase_submissions (Phase 4 will surface it)

   Public API (window.RPMGraphViewer):
     init()  — render for the logged-in client
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const state = {
    clientId: null,
    graphId:  null,
    graph:    null,
    phases:   [],
    submitting: false,
    pendingCelebration: null, // { stage_name } if a phase just unlocked
    pendingRejection:   null, // most recent rejected/modified submission for this graph
  };

  const LS_KEY = (graphId) => `nc-rpm-seen-active::${graphId}`;

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  function _toast(msg, kind = 'info') {
    if (typeof Dashboard !== 'undefined' && Dashboard.toast) Dashboard.toast(msg, kind);
    else console.log(`[viewer] ${kind}: ${msg}`);
  }

  // ───────────────────────────────────────────────────────────
  // Phase 4 — celebration detection + coach feedback surfacing
  // ───────────────────────────────────────────────────────────
  function _detectAndQueueCelebration() {
    if (!state.graphId) return;
    const active = state.phases.find(p => p.status === 'active');
    if (!active) return;
    let lastSeenId = null;
    try { lastSeenId = localStorage.getItem(LS_KEY(state.graphId)); } catch {}
    if (lastSeenId && lastSeenId !== active.id) {
      // Active phase changed since last visit → celebrate
      state.pendingCelebration = { stage_name: active.stage_name, phase_index: active.phase_index };
    }
    try { localStorage.setItem(LS_KEY(state.graphId), active.id); } catch {}
  }

  function _maybeFireCelebration() {
    if (!state.pendingCelebration) return;
    const { stage_name, phase_index } = state.pendingCelebration;
    state.pendingCelebration = null;
    // Reuse existing global Dashboard.showCelebration (confetti + overlay)
    if (typeof Dashboard !== 'undefined' && Dashboard.showCelebration) {
      Dashboard.showCelebration(`Phase ${phase_index} — ${stage_name}`);
    } else {
      _toast(`Phase ${phase_index} unlocked! 🎉`, 'success');
    }
  }

  // Pull the most recent rejected/modified submission so the client sees coach feedback
  async function _loadLatestCoachFeedback() {
    if (!state.graphId) return;
    try {
      const { data } = await sb.from('phase_submissions')
        .select('id, phase_id, status, coach_note, coach_decision_at')
        .eq('graph_id', state.graphId)
        .in('status', ['rejected', 'modified'])
        .order('coach_decision_at', { ascending: false })
        .limit(1);
      state.pendingRejection = (data && data[0]) ? data[0] : null;
    } catch (e) {
      console.warn('[viewer] coach feedback fetch failed:', e);
      state.pendingRejection = null;
    }
  }

  // ───────────────────────────────────────────────────────────
  // Init
  // ───────────────────────────────────────────────────────────
  async function init() {
    const root = $('#my-graph-root');
    if (!root) return;

    const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    if (!user) {
      root.innerHTML = `<div class="nc-rpm-empty"><span class="nc-rpm-empty-icon">↟</span><p>Please sign in to see your reactive graph.</p></div>`;
      return;
    }

    state.clientId = user.id;
    root.innerHTML = `<div class="nc-rpm-empty"><span class="nc-rpm-empty-icon">↟</span><p>Loading your reactive graph…</p></div>`;

    try {
      const full = await RPMGraph.getActiveForClient(state.clientId);
      if (!full || !full.graph) {
        root.innerHTML = `
          <div class="nc-rpm-empty">
            <span class="nc-rpm-empty-icon">↟</span>
            <p>Your coach hasn't published a reactive graph yet. Once they do, you'll see your graded exposure ladder here.</p>
          </div>`;
        return;
      }
      state.graph  = full.graph;
      state.graphId = full.graph.id;
      state.phases = full.phases;

      // Phase 4: celebration detection — if active phase changed since last visit, fire confetti
      _detectAndQueueCelebration();
      // Phase 4: surface most recent coach feedback on a submission
      await _loadLatestCoachFeedback();

      _render();
      _maybeFireCelebration();
    } catch (e) {
      console.error('[viewer] load failed:', e);
      root.innerHTML = `<div class="nc-rpm-empty"><span class="nc-rpm-empty-icon">⚠</span><p style="color:#FCA5A5">Could not load your graph. Please refresh.</p></div>`;
    }
  }

  // ───────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────
  function _render() {
    const root = $('#my-graph-root');
    if (!root) return;
    const g = state.graph;

    root.innerHTML = `
      <div class="nc-rpm-viewer">
        <div class="nc-rpm-viewer-head">
          <div class="nc-rpm-viewer-eyebrow">Your reactive graph</div>
          <h1 class="nc-rpm-viewer-title">From where you are → where you want to be.</h1>
          <p class="nc-rpm-viewer-sub">Phases unlock upward as you earn the right by passing each tripwire. Take it step by step.</p>
          ${g.composite_score != null ? `
            <div class="nc-rpm-scores" style="justify-content:center;margin-top:14px">
              <div class="nc-rpm-score composite">
                <span class="nc-rpm-score-val">${Number(g.composite_score).toFixed(0)}</span>
                <span class="nc-rpm-score-lbl">Movement Score</span>
              </div>
            </div>` : ''}
        </div>

        ${_bodyMap()}

        ${_diagonalGraph()}
      </div>
    `;

    _bindEvents();
  }

  // Diagonal ascending node-graph (A bottom-left → B top-right)
  function _diagonalGraph() {
    const g = state.graph;
    const phases = state.phases.slice().sort((a, b) => a.phase_index - b.phase_index);
    const N = phases.length;
    const ax = 15, ay = 85, bx = 85, by = 15;
    const nodes = phases.map((p, i) => {
      const t = (i + 1) / (N + 1);
      return { p, x: ax + t * (bx - ax), y: ay + t * (by - ay) };
    });

    return `
      <div class="nc-dgraph" id="nc-vgraph" style="margin-top:8px">
        <svg class="nc-dgraph-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="nc-vgraph-grad" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stop-color="#F5426C"/>
              <stop offset="0.5" stop-color="#14B8A6"/>
              <stop offset="1" stop-color="#D4AF37"/>
            </linearGradient>
          </defs>
          <line class="nc-dgraph-axis-bg" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>
          <line class="nc-dgraph-axis" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"
                style="stroke:url(#nc-vgraph-grad)"/>
        </svg>
        <div class="nc-dgraph-endpoint nc-dgraph-endpoint--a" style="left:${ax}%;top:${ay}%">
          <span class="nc-dgraph-endpoint-dot">A</span>
          <div class="nc-dgraph-endpoint-label"><small>You are here</small><span>${escHtml(g.point_a_summary || 'Current state')}</span></div>
        </div>
        <div class="nc-dgraph-endpoint nc-dgraph-endpoint--b" style="left:${bx}%;top:${by}%">
          <span class="nc-dgraph-endpoint-dot">B</span>
          <div class="nc-dgraph-endpoint-label"><small>Dream outcome</small><span>${escHtml(g.point_b_dream || 'Destination')}</span></div>
        </div>
        ${nodes.map(n => `
          <button class="nc-dgraph-node ${n.p.status || 'locked'}" data-node-id="${n.p.id}"
                  style="left:${n.x}%;top:${n.y}%">
            <span class="nc-dgraph-node-dot">${n.p.status === 'locked' ? '🔒' : (n.p.status === 'completed' ? '✓' : n.p.phase_index)}</span>
            <span class="nc-dgraph-node-label">${escHtml(n.p.stage_name || 'Phase')}</span>
          </button>
        `).join('')}
      </div>
      <p style="text-align:center;font-size:12.5px;color:var(--text-tertiary);margin-top:10px">
        Tap any phase node to see details${state.phases.some(p => p.status === 'active') ? ' — your active phase is glowing' : ''}.
      </p>
    `;
  }

  // 5B — SVG body map; active phase's regions glow teal, future phases' regions gold
  function _bodyMap() {
    const active = state.phases.find(p => p.status === 'active');
    const activeRegions = new Set(active?.target_regions || []);
    const futureRegions = new Set();
    state.phases.filter(p => p.status === 'locked')
      .forEach(p => (p.target_regions || []).forEach(r => futureRegions.add(r)));

    const cls = (key) =>
      activeRegions.has(key) ? 'nc-rpm-body-region active' :
      futureRegions.has(key) ? 'nc-rpm-body-region future' :
      'nc-rpm-body-region';

    // Stylised front-view figure. Each region carries data-region.
    const svg = `
      <svg class="nc-rpm-body-svg" viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg" aria-label="Body map">
        <!-- head (not a region) -->
        <circle cx="100" cy="34" r="20" fill="rgba(120,140,160,0.18)" stroke="rgba(255,255,255,0.10)"/>
        <!-- spine segments -->
        <rect class="${cls('CervicalSpine')}" data-region="CervicalSpine" x="92" y="54" width="16" height="16" rx="4"/>
        <rect class="${cls('ThoracicSpine')}" data-region="ThoracicSpine" x="84" y="72" width="32" height="56" rx="8"/>
        <rect class="${cls('LumbarSpine')}"   data-region="LumbarSpine"   x="86" y="130" width="28" height="34" rx="7"/>
        <ellipse class="${cls('Pelvis')}"     data-region="Pelvis"        cx="100" cy="180" rx="30" ry="16"/>
        <!-- shoulders -->
        <circle class="${cls('LeftShoulder')}"  data-region="LeftShoulder"  cx="64"  cy="80"  r="13"/>
        <circle class="${cls('RightShoulder')}" data-region="RightShoulder" cx="136" cy="80"  r="13"/>
        <!-- elbows -->
        <circle class="${cls('LeftElbow')}"  data-region="LeftElbow"  cx="50"  cy="138" r="11"/>
        <circle class="${cls('RightElbow')}" data-region="RightElbow" cx="150" cy="138" r="11"/>
        <!-- wrists -->
        <circle class="${cls('LeftWrist')}"  data-region="LeftWrist"  cx="42"  cy="190" r="10"/>
        <circle class="${cls('RightWrist')}" data-region="RightWrist" cx="158" cy="190" r="10"/>
        <!-- hips -->
        <circle class="${cls('LeftHip')}"  data-region="LeftHip"  cx="82"  cy="186" r="12"/>
        <circle class="${cls('RightHip')}" data-region="RightHip" cx="118" cy="186" r="12"/>
        <!-- knees -->
        <circle class="${cls('LeftKnee')}"  data-region="LeftKnee"  cx="80"  cy="268" r="12"/>
        <circle class="${cls('RightKnee')}" data-region="RightKnee" cx="120" cy="268" r="12"/>
        <!-- ankles -->
        <circle class="${cls('LeftAnkle')}"  data-region="LeftAnkle"  cx="78"  cy="346" r="10"/>
        <circle class="${cls('RightAnkle')}" data-region="RightAnkle" cx="122" cy="346" r="10"/>
      </svg>`;

    return `
      <div class="nc-rpm-bodymap">
        <div class="nc-rpm-bodymap-title">
          ${active ? `Now working on <b>${escHtml(active.stage_name)}</b>` : 'Movement focus map'}
        </div>
        ${svg}
        <div class="nc-rpm-bodymap-legend">
          <span><i class="active"></i> This phase</span>
          <span><i class="future"></i> Coming up</span>
          <span><i class="idle"></i> Not targeted</span>
        </div>
      </div>`;
  }

  function _phaseCard(p) {
    const status = p.status || 'locked';
    const exercises = (p.exercises || []).slice().sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    const isActive = status === 'active';
    const isLocked = status === 'locked';
    const isDone   = status === 'completed';

    const statusLabel =
      isLocked ? '🔒 Locked' :
      isActive ? '✦ Active' :
      isDone   ? '✓ Completed' : '';

    // Coach feedback banner (rejection/modification) for the active phase only
    const feedback = (isActive && state.pendingRejection && state.pendingRejection.phase_id === p.id)
      ? state.pendingRejection : null;
    const feedbackHtml = feedback ? `
      <div class="nc-app-note ${feedback.status === 'rejected' ? '' : 'nc-app-coach-note'}" style="margin-top:8px">
        <small>Coach ${feedback.status === 'rejected' ? 'rejected your last submission' : 'modified the criteria'}</small>
        ${escHtml(feedback.coach_note || '')}
      </div>` : '';

    return `
      <div class="nc-rpm-vphase ${status}" data-phase-id="${p.id}">
        <div class="nc-rpm-vphase-num">${isLocked ? '🔒' : (isDone ? '✓' : p.phase_index)}</div>
        <div class="nc-rpm-vphase-body">
          <div class="nc-rpm-vphase-stage">
            ${escHtml(p.stage_name)}
            <span class="nc-rpm-vphase-status">${statusLabel}</span>
          </div>
          ${p.milestone_label ? `<div class="nc-rpm-vphase-milestone"><b>Milestone:</b> ${escHtml(p.milestone_label)}</div>` : ''}
          ${p.emotional_win   ? `<div class="nc-rpm-vphase-milestone"><b>Why it matters:</b> ${escHtml(p.emotional_win)}</div>` : ''}
          <div class="nc-rpm-vphase-meta">
            ${p.tripwire_test  ? `<span>Tripwire · ${escHtml(p.tripwire_test)}</span>` : ''}
            ${p.load_tolerance ? `<span>Load · ${escHtml(p.load_tolerance)}</span>` : ''}
            ${p.cue_mode       ? `<span>Cue · ${escHtml(p.cue_mode.replace('_', '-'))}</span>` : ''}
          </div>

          ${(p.target_regions && p.target_regions.length) ? `
            <div class="nc-rpm-vphase-regions">
              ${p.target_regions.map(r => `<span class="nc-rpm-vphase-region">${escHtml(_regionLabel(r))}</span>`).join('')}
            </div>` : ''}

          ${feedbackHtml}

          ${isActive && exercises.length ? `
            <div class="nc-rpm-vphase-exercises">
              ${exercises.map(_exerciseRow).join('')}
            </div>` : ''}

          ${isActive ? `
            <div class="nc-rpm-vphase-submit">
              <button class="nc-rpm-submit-btn" data-act="submit-milestone" data-phase-id="${p.id}" ${state.submitting ? 'disabled' : ''}>
                ${state.submitting ? 'Submitting…' : 'I think I\'ve completed this phase →'}
              </button>
            </div>
            <div class="nc-chat" style="margin-top:6px">
              <div class="nc-chat-head"><span class="nc-chat-label">Chat with your coach</span></div>
              <div class="nc-chat-body" data-chat-body="${p.id}"></div>
            </div>` : ''}
        </div>
      </div>
    `;
  }

  function _regionLabel(key) {
    const r = (RPMGraph.BODY_REGIONS || []).find(x => x.key === key);
    return r ? r.label : key;
  }

  function _exerciseRow(ex) {
    const name = ex.exercises?.name || 'Exercise';
    const presc = _fmtPresc(ex.prescription);
    return `
      <div class="nc-rpm-vex ${ex.client_completed ? 'done' : ''}" data-pe-id="${ex.id}">
        <button class="nc-rpm-vex-check" data-act="toggle-ex" data-pe-id="${ex.id}" aria-label="Toggle complete">${ex.client_completed ? '✓' : ''}</button>
        <div class="nc-rpm-vex-name">${escHtml(name)}</div>
        ${presc ? `<div class="nc-rpm-vex-presc">${escHtml(presc)}</div>` : '<span></span>'}
      </div>
    `;
  }

  function _fmtPresc(p) {
    if (!p || typeof p !== 'object') return '';
    const bits = [];
    if (p.sets) bits.push(`${p.sets} sets`);
    if (p.reps) bits.push(p.reps);
    if (p.tempo) bits.push(p.tempo);
    return bits.join(' · ');
  }

  // ───────────────────────────────────────────────────────────
  // Events — node clicks → popup → expand into phase detail
  // ───────────────────────────────────────────────────────────
  let _vPopupEl = null;

  function _bindEvents() {
    $$('#nc-vgraph .nc-dgraph-node').forEach(node => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = state.phases.find(x => x.id === node.dataset.nodeId);
        if (p) _showNodePopup(p, node);
      });
    });
    $('#nc-vgraph')?.addEventListener('click', (e) => {
      if (!e.target.closest('.nc-dgraph-node') && !e.target.closest('.nc-dgraph-popup')) _closeNodePopup();
    });
  }

  function _closeNodePopup() {
    if (_vPopupEl) { _vPopupEl.remove(); _vPopupEl = null; }
    $$('#nc-vgraph .nc-dgraph-node.selected').forEach(n => n.classList.remove('selected'));
  }

  function _showNodePopup(phase, nodeEl) {
    _closeNodePopup();
    nodeEl.classList.add('selected');
    const status = phase.status || 'locked';
    const exCount = (phase.exercises || []).length;
    const statusLabel = status === 'locked' ? '🔒 Locked' : status === 'active' ? '✦ Active now' : '✓ Completed';

    const pop = document.createElement('div');
    pop.className = 'nc-dgraph-popup';
    pop.innerHTML = `
      <div class="nc-dgraph-popup-head">
        <span class="nc-dgraph-popup-phase">Phase ${phase.phase_index} · ${statusLabel}</span>
        <button class="nc-dgraph-popup-close" data-act="close" aria-label="Close">✕</button>
      </div>
      <div class="nc-dgraph-popup-title">${escHtml(phase.stage_name || 'Phase')}</div>
      ${phase.milestone_label ? `<div class="nc-dgraph-popup-row"><b>Milestone:</b> ${escHtml(phase.milestone_label)}</div>` : ''}
      ${phase.tripwire_test   ? `<div class="nc-dgraph-popup-row"><b>Tripwire:</b> ${escHtml(phase.tripwire_test)}</div>` : ''}
      ${status === 'locked'
        ? `<div class="nc-dgraph-popup-row" style="color:var(--text-tertiary);font-style:italic">Earn this by passing the previous phase's tripwire.</div>`
        : `<div class="nc-dgraph-popup-meta">${exCount ? `<span>${exCount} exercise${exCount===1?'':'s'}</span>` : ''}</div>`}
      ${status !== 'locked'
        ? `<button class="nc-dgraph-popup-expand" data-act="expand">⤢ Open phase</button>`
        : ''}
    `;
    pop.style.left = nodeEl.style.left;
    pop.style.top  = `calc(${nodeEl.style.top} + 30px)`;
    $('#nc-vgraph')?.appendChild(pop);
    _vPopupEl = pop;

    pop.querySelector('[data-act="close"]').addEventListener('click', _closeNodePopup);
    pop.querySelector('[data-act="expand"]')?.addEventListener('click', () => {
      _closeNodePopup();
      _openPhaseDetail(phase);
    });
  }

  function _openPhaseDetail(phase) {
    _closePhaseDetail();
    const ov = document.createElement('div');
    ov.className = 'nc-dgraph-editor-overlay';
    ov.id = 'nc-vphase-detail';
    ov.innerHTML = `
      <div class="nc-dgraph-editor">
        <div class="nc-dgraph-editor-head">
          <h3>Phase ${phase.phase_index} — ${escHtml(phase.stage_name || 'Phase')}</h3>
          <button class="nc-dgraph-editor-close" data-act="close" aria-label="Close">✕</button>
        </div>
        <div class="nc-dgraph-editor-body">
          ${_phaseCard(phase)}
        </div>
      </div>`;
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    _bindPhaseDetail(ov, phase);
    ov.querySelector('[data-act="close"]').addEventListener('click', _closePhaseDetail);
    ov.addEventListener('click', (e) => { if (e.target === ov) _closePhaseDetail(); });
    document.addEventListener('keydown', _vEscHandler);
  }

  function _vEscHandler(e) { if (e.key === 'Escape') _closePhaseDetail(); }

  function _closePhaseDetail() {
    const ov = $('#nc-vphase-detail');
    if (ov) ov.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', _vEscHandler);
  }

  // Bind exercise checkboxes, milestone submit, chat inside the phase detail overlay
  function _bindPhaseDetail(root, phase) {
    root.querySelectorAll('[data-act="toggle-ex"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const peId = btn.dataset.peId;
        let target = null;
        for (const ph of state.phases) {
          target = (ph.exercises || []).find(e => e.id === peId);
          if (target) break;
        }
        if (!target) return;
        const newDone = !target.client_completed;
        try {
          await RPMGraph.markExerciseDone(peId, newDone);
          target.client_completed = newDone;
          target.client_completed_at = newDone ? new Date().toISOString() : null;
          const row = btn.closest('.nc-rpm-vex');
          if (row) { row.classList.toggle('done', newDone); btn.textContent = newDone ? '✓' : ''; }
        } catch (e) {
          console.error('[viewer] toggle failed:', e);
          _toast('Could not update — try again.', 'error');
        }
      });
    });

    root.querySelectorAll('[data-chat-body]').forEach(body => {
      const phaseId = body.dataset.chatBody;
      if (typeof RPMChat !== 'undefined' && state.graphId) {
        RPMChat.mount(body, { graphId: state.graphId, phaseId });
      }
    });

    root.querySelectorAll('[data-act="submit-milestone"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const phaseId = btn.dataset.phaseId;
        const note = prompt('Optional note for your coach (what changed, how you feel, evidence you passed the tripwire test):') || '';
        btn.disabled = true; btn.textContent = 'Submitting…';
        try {
          await RPMGraph.submitMilestone(state.graphId, phaseId, note);
          _toast('Submitted to your coach for review ✓', 'success');
          btn.textContent = 'Submitted · awaiting coach';
        } catch (e) {
          console.error('[viewer] submit failed:', e);
          _toast('Submit failed — try again.', 'error');
          btn.disabled = false;
          btn.textContent = 'I think I\'ve completed this phase →';
        }
      });
    });
  }

  window.RPMGraphViewer = {
    init,
    _state: () => ({ ...state }),
  };
})();
