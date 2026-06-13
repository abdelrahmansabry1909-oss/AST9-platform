/* ═══════════════════════════════════════════════════════════════
   NeuCore RPM — Graph Builder (Coach UI)
   Phase 3B · Cite: docs/rehab-book/o-sullivan-graded-exposure-ladder.md
   Coach picks client → defines Point A/B → AI (or fallback) generates phases →
   coach refines stage names / milestones / tripwires / cue mode / load tolerance
   → assigns exercises per phase → publishes to client.

   Public API (window.RPMGraphBuilder):
     init()          — render + wire (called when section-graph-builder loads)
     selectClient(id) — programmatic client switch
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const SUPABASE_FN_URL = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : 'https://byquokhcbagofshsclfy.supabase.co')
    + '/functions/v1/rpm-ai-suggest';

  const state = {
    clientId:  null,
    coachId:   null,
    graph:     null,                  // current draft / loaded graph row
    phases:    [],                    // ordered, ascending phase_index
    subjective: null,
    objective:  null,
    aiSource:   null,                 // 'anthropic' | 'fallback' | null
    aiBusy:     false,
    aiSnapshot: new Map(),            // phaseId → { stage_name, milestone_label, ... } at AI-generation time
    feedbackAsked: new Set(),         // phaseIds we've already asked feedback for this session
    // Local draft buffer so the UI works even if INSERT hasn't happened yet
    draft:     { point_a_summary: '', point_b_dream: '', phase_count: 5 },
    lastError: null,                  // string — surfaces in the controls panel if anything fails
    saveTimer:  null,
    loadingExercisesFor: null,
  };

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  function _coachId() {
    try { return Auth.getUser()?.id ?? null; } catch { return null; }
  }

  // Compact snapshot of the editable AI-generated fields (for diff on later edit)
  function _phaseSnapshot(p) {
    return {
      stage_name:      p.stage_name      || '',
      milestone_label: p.milestone_label || '',
      emotional_win:   p.emotional_win   || '',
      tripwire_test:   p.tripwire_test   || '',
      load_tolerance:  p.load_tolerance  || '',
      cue_mode:        p.cue_mode        || '',
    };
  }
  function _phaseDiff(snap, cur) {
    const fields = ['stage_name','milestone_label','emotional_win','tripwire_test','load_tolerance','cue_mode'];
    const changed = {};
    for (const f of fields) {
      if ((snap?.[f] || '') !== (cur?.[f] || '')) changed[f] = { old: snap?.[f] || '', new: cur?.[f] || '' };
    }
    return changed;
  }
  function _phaseAsText(p) {
    return [
      `Stage: ${p.stage_name || ''}`,
      `Milestone: ${p.milestone_label || ''}`,
      `Win: ${p.emotional_win || ''}`,
      `Tripwire: ${p.tripwire_test || ''}`,
      `Load: ${p.load_tolerance || ''} · Cue: ${p.cue_mode || ''}`,
    ].join('\n');
  }

  // ───────────────────────────────────────────────────────────
  // Build the Entry Point (Point A) summary from real schema columns.
  // The user-facing spec calls these `objective.assessment_summary` +
  // `subjective.current_limitations`, but those columns don't exist —
  // we derive equivalent text from what's actually stored.
  // ───────────────────────────────────────────────────────────
  function _buildEntryPointSummary(subj, obj) {
    const lines = [];
    if (obj) {
      const scores = [];
      if (obj.composite_score != null) scores.push(`Composite ${Math.round(obj.composite_score)}`);
      if (obj.rom_score       != null) scores.push(`ROM ${Math.round(obj.rom_score)}`);
      if (obj.control_score   != null) scores.push(`Control ${Math.round(obj.control_score)}`);
      if (obj.force_score     != null) scores.push(`Force ${Math.round(obj.force_score)}`);
      if (obj.neurology_score != null) scores.push(`Neuro ${Math.round(obj.neurology_score)}`);
      if (scores.length) lines.push(`Movement scores: ${scores.join(' · ')}.`);
      if (obj.phase_recommendation) lines.push(`Recommended starting phase: ${obj.phase_recommendation}.`);
      const flags = [];
      if (Array.isArray(obj.pain_flags)      && obj.pain_flags.length)      flags.push(`pain at ${obj.pain_flags.join(', ')}`);
      if (Array.isArray(obj.asymmetry_flags) && obj.asymmetry_flags.length) flags.push(`asymmetry at ${obj.asymmetry_flags.join(', ')}`);
      if (Array.isArray(obj.gait_flags)      && obj.gait_flags.length)      flags.push(`gait flags ${obj.gait_flags.join(', ')}`);
      if (flags.length) lines.push(`Flags: ${flags.join('; ')}.`);
    }
    if (subj) {
      if (subj.external_pain) lines.push(`Pain: ${subj.external_pain}.`);
      if (subj.life_impact)   lines.push(`Currently limited: ${subj.life_impact}.`);
      if (Array.isArray(subj.aggravating_factors) && subj.aggravating_factors.length) {
        lines.push(`Aggravated by: ${subj.aggravating_factors.join(', ')}.`);
      }
    }
    return lines.join('\n');
  }

  // ───────────────────────────────────────────────────────────
  // Data helpers
  // ───────────────────────────────────────────────────────────
  async function _loadClients() {
    // Coaches: clients assigned to them. Admin: all clients.
    let q = sb.from('profiles').select('id, full_name, email').eq('role', 'client');
    try {
      if (typeof Auth !== 'undefined' && Auth.isCoach() && !Auth.isAdmin()) {
        q = q.eq('assigned_coach', _coachId());
      }
    } catch {}
    const { data, error } = await q.order('full_name', { ascending: true });
    if (error) { console.error('[RPMGraphBuilder] load clients failed:', error); return []; }
    return data || [];
  }

  // Load existing draft (if any) — does NOT create. Always pulls subj/obj for context
  // even if no graph exists yet, so Point A/B can be pre-filled in the UI.
  async function _loadDraft(clientId) {
    const coachId = _coachId();
    if (!coachId) throw new Error('Not signed in — please log in as a coach.');
    state.coachId = coachId;

    // 1. Pull subj/obj first so the UI has seed values even when no graph exists
    let subj = null, obj = null;
    try {
      [subj, obj] = await Promise.all([
        RPMGraph.pullSubjectiveSummary(clientId).catch(() => null),
        RPMGraph.pullObjectiveSummary(clientId).catch(() => null),
      ]);
    } catch (e) {
      console.warn('[builder] subj/obj pull failed (non-fatal):', e);
    }
    state.subjective = subj;
    state.objective  = obj;

    // Pre-fill local draft from latest assessments:
    //   End Goal Node (Point B) ← subjective.dream_outcome
    //   Entry Point Node (Point A) ← objective summary + subjective limitations
    state.draft = {
      point_b_dream:   subj?.dream_outcome || '',
      point_a_summary: _buildEntryPointSummary(subj, obj) || '',
      phase_count:     5,
    };

    // 2. Look for existing draft graph
    const { data: drafts, error } = await sb.from('rpm_graphs')
      .select('*')
      .eq('coach_id', coachId)
      .eq('client_id', clientId)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) {
      // Don't throw — show inline. Most likely cause: RLS or missing role.
      throw new Error(`Could not list draft graphs (${error.code || error.message || 'unknown'}). The graph row will be created when you start editing.`);
    }

    if (drafts && drafts.length) {
      state.graph = drafts[0];
      // Load phases + exercises
      const full = await RPMGraph.load(state.graph.id);
      state.phases = full.phases;
      state.aiSnapshot.clear();
      state.feedbackAsked.clear();
      state.phases.forEach(p => {
        if (p.ai_generated) state.aiSnapshot.set(p.id, _phaseSnapshot(p));
      });
      // Mirror loaded values into draft buffer
      state.draft.point_a_summary = state.graph.point_a_summary || state.draft.point_a_summary;
      state.draft.point_b_dream   = state.graph.point_b_dream   || state.draft.point_b_dream;
      state.draft.phase_count     = state.graph.phase_count     || 5;
    } else {
      state.graph  = null;
      state.phases = [];
    }
  }

  // Lazily create a draft graph row. Called the first time the coach saves a field
  // OR clicks "Generate phases" — so we never insert until there's intent.
  async function _ensureGraph() {
    if (state.graph) return state.graph;
    const coachId = _coachId();
    if (!coachId) throw new Error('Not signed in.');
    if (!state.clientId) throw new Error('No client selected.');

    state.graph = await RPMGraph.create({
      clientId:        state.clientId,
      coachId,
      point_b_dream:   state.draft.point_b_dream || '',
      point_a_summary: state.draft.point_a_summary || '',
      subjective_id:   state.subjective?.id || null,
      objective_id:    state.objective?.id  || null,
      composite_score: state.objective?.composite_score ?? null,
      phase_count:     state.draft.phase_count || 5,
    });
    state.lastError = null;
    return state.graph;
  }

  function _scheduleGraphSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(_flushGraphSave, 500);
  }

  async function _flushGraphSave() {
    try {
      // Lazy-create on first edit
      const g = await _ensureGraph();
      await RPMGraph.update(g.id, {
        point_a_summary: state.draft.point_a_summary,
        point_b_dream:   state.draft.point_b_dream,
        phase_count:     state.draft.phase_count,
      });
      // Reflect into local graph object
      g.point_a_summary = state.draft.point_a_summary;
      g.point_b_dream   = state.draft.point_b_dream;
      g.phase_count     = state.draft.phase_count;
      state.lastError = null;
    } catch (e) {
      console.error('[builder] graph save failed:', e);
      state.lastError = `Save failed: ${e.message || e.code || 'unknown error'}`;
      _renderControls();
    }
  }

  // ───────────────────────────────────────────────────────────
  // AI generation
  // ───────────────────────────────────────────────────────────
  async function _generatePhasesViaAI() {
    if (state.aiBusy) return;
    if (!state.clientId) { _toast('Pick a client first.', 'error'); return; }
    state.aiBusy = true;
    state.lastError = null;
    _renderControls();

    try {
      // Lazy-create the graph row if it doesn't exist yet
      await _flushGraphSave();
      const g = await _ensureGraph();

      const session = (await sb.auth.getSession())?.data?.session;
      if (!session?.access_token) throw new Error('You are not signed in. Refresh the page and log in to generate phases.');
      const anonKey = window.SUPABASE_ANON || '';
      if (!anonKey) throw new Error('Supabase anon key not loaded — js/supabaseClient.js may not have run.');

      const res = await fetch(SUPABASE_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey':        anonKey,
        },
        body: JSON.stringify({
          kind:        'phases',
          phase_count: state.draft.phase_count || g.phase_count || 5,
          point_a:     state.draft.point_a_summary || g.point_a_summary || '',
          point_b:     state.draft.point_b_dream   || g.point_b_dream   || '',
          subjective:  state.subjective,
          objective:   state.objective,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        let msg = `AI request failed (HTTP ${res.status})`;
        if (res.status === 401) msg = 'AI request unauthorized (401). Your session may have expired — try refreshing.';
        else if (res.status === 404) msg = 'AI suggester not deployed (404). Ask an admin to deploy the rpm-ai-suggest edge function.';
        else if (res.status === 500) msg = 'AI suggester crashed (500). Check edge function logs.';
        else if (txt) msg += `: ${txt.slice(0, 200)}`;
        throw new Error(msg);
      }
      const data = await res.json();
      state.aiSource = data.source || 'fallback';

      // Save into rpm_phases (replaces existing)
      const phases = (data.phases || []).map((p, i) => ({ ...p, phase_index: i + 1, ai_generated: state.aiSource === 'anthropic' }));
      const saved = await RPMGraph.savePhases(state.graph.id, phases);
      // Reload (gets ids + exercises arrays)
      const full = await RPMGraph.load(state.graph.id);
      state.phases = full.phases;
      // Snapshot AI-generated values so we can detect coach overrides for ML feedback
      state.aiSnapshot.clear();
      state.feedbackAsked.clear();
      state.phases.forEach(p => {
        if (p.ai_generated) state.aiSnapshot.set(p.id, _phaseSnapshot(p));
      });
      // Mark graph ai_generated
      await RPMGraph.update(state.graph.id, { ai_generated: state.aiSource === 'anthropic' });
    } catch (e) {
      console.error('[builder] AI generate failed:', e);
      const reason = (e && e.message) ? e.message : String(e);
      state.lastError = `Could not generate phases via AI — ${reason}. Loaded NeuCore's default 5-stage ladder instead so you can keep working.`;
      _toast('AI request failed — using clinical default phases instead.', 'error');
      // Deterministic local fallback so the coach is never stuck
      try {
        const g = state.graph || await _ensureGraph();
        const fallback = RPMGraph.defaultStages(g.phase_count || 5);
        await RPMGraph.savePhases(g.id, fallback.map((p, i) => ({ ...p, phase_index: i + 1, ai_generated: false })));
        const full = await RPMGraph.load(g.id);
        state.phases = full.phases;
        state.aiSource = 'fallback';
      } catch (e2) {
        console.error('[builder] fallback save failed:', e2);
        state.lastError += ` (Also failed to save default phases: ${e2.message || e2})`;
      }
    } finally {
      state.aiBusy = false;
      _render();
    }
  }

  async function _generateExercisesForPhase(phase) {
    if (state.loadingExercisesFor === phase.id) return;
    state.loadingExercisesFor = phase.id;
    _refreshEditorCard();

    try {
      const session = (await sb.auth.getSession())?.data?.session;
      // Gather likely target joints from objective pain_flags / asymmetry_flags
      const joints = [];
      ['pain_flags','asymmetry_flags','gait_flags'].forEach(k => {
        const arr = state.objective?.[k];
        if (Array.isArray(arr)) joints.push(...arr);
      });

      const res = await fetch(SUPABASE_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
          'apikey':        window.SUPABASE_ANON || '',
        },
        body: JSON.stringify({
          kind:          'exercises',
          phase_load:    phase.load_tolerance,
          target_joints: joints,
          count:         4,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Exercise pick failed (HTTP ${res.status}${txt ? ': ' + txt.slice(0, 160) : ''})`);
      }
      const data = await res.json();
      const exs = (data.exercises || []).map((ex, i) => ({
        exercise_id:   ex.exercise_id,
        prescription:  ex.prescription || {},
        display_order: i,
        ai_generated:  true,
      }));
      await RPMGraph.setPhaseExercises(phase.id, exs);
      const full = await RPMGraph.load(state.graph.id);
      state.phases = full.phases;
      _toast('Exercises suggested for this phase ✓', 'success');
    } catch (e) {
      console.error('[builder] exercise pick failed:', e);
      _toast('Could not pick exercises — try adding manually.', 'error');
    } finally {
      state.loadingExercisesFor = null;
      await _afterPhaseDataChange();
    }
  }

  // ───────────────────────────────────────────────────────────
  // Phase edits
  // ───────────────────────────────────────────────────────────
  function _scheduleSavePhase(phase) {
    clearTimeout(phase._saveTimer);
    phase._saveTimer = setTimeout(async () => {
      try { await RPMGraph.savePhase(state.graph.id, phase); }
      catch (e) { console.error('[builder] phase save failed:', e); }
    }, 500);
  }

  // Fire ML feedback modal once per AI-generated phase per session, when coach diverges
  async function _maybeAskFeedback(phase) {
    if (!phase || !phase.ai_generated) return;
    if (state.feedbackAsked.has(phase.id)) return;
    const snap = state.aiSnapshot.get(phase.id);
    if (!snap) return;
    const diff = _phaseDiff(snap, phase);
    if (!Object.keys(diff).length) return;

    state.feedbackAsked.add(phase.id);

    if (typeof RPMFeedback === 'undefined') return;
    try {
      await RPMFeedback.ask({
        kind:     'phase_edit',
        original: _phaseAsText(snap),
        modified: _phaseAsText(phase),
        graphId:  state.graph?.id,
        context: {
          phase_id:     phase.id,
          phase_index:  phase.phase_index,
          changed_fields: Object.keys(diff),
        },
      });
    } catch (e) { console.warn('[builder] feedback ask failed:', e); }
  }

  async function _removePhase(phase) {
    if (!confirm(`Remove phase "${phase.stage_name}"?`)) return;
    try {
      await RPMGraph.deletePhase(phase.id);
      const full = await RPMGraph.load(state.graph.id);
      state.phases = full.phases;
      _renderLadder();
      _toast('Phase removed', 'info');
    } catch (e) { console.error(e); _toast('Could not remove phase', 'error'); }
  }

  // Open a small inline modal to collect name + duration before adding a phase.
  // Validation: name non-empty; duration (optional) must be > 0 weeks if provided.
  function _addBlankPhase() {
    if (!state.clientId) { _toast('Pick a client first.', 'error'); return; }
    _openAddPhaseModal();
  }

  function _closeAddPhaseModal() {
    const ov = document.getElementById('nc-addphase-overlay');
    if (ov) ov.remove();
    document.removeEventListener('keydown', _addPhaseEscHandler);
  }
  function _addPhaseEscHandler(e) { if (e.key === 'Escape') _closeAddPhaseModal(); }

  function _openAddPhaseModal() {
    _closeAddPhaseModal();
    const next = (state.phases.length || 0) + 1;
    const ov = document.createElement('div');
    ov.id = 'nc-addphase-overlay';
    ov.className = 'nc-dgraph-editor-overlay';
    ov.innerHTML = `
      <div class="nc-dgraph-editor" style="max-width:440px">
        <div class="nc-dgraph-editor-head">
          <h3>Add Phase ${next}</h3>
          <button class="nc-dgraph-editor-close" data-act="close" aria-label="Close">✕</button>
        </div>
        <div class="nc-dgraph-editor-body" style="padding:18px 22px">
          <div class="nc-rpm-phase-field" style="margin-bottom:14px">
            <label>Stage name <span style="color:#F5426C">*</span></label>
            <input id="nc-addphase-name" type="text" value="Phase ${next}" placeholder="e.g. Bridging the Gap"/>
            <div class="nc-rpm-helper" id="nc-addphase-name-err" style="color:#FCA5A5;display:none">Stage name is required.</div>
          </div>
          <div class="nc-rpm-phase-field" style="margin-bottom:14px">
            <label>Estimated duration (weeks) — optional</label>
            <input id="nc-addphase-weeks" type="number" min="0" step="1" placeholder="e.g. 2"/>
            <div class="nc-rpm-helper" id="nc-addphase-weeks-err" style="color:#FCA5A5;display:none">Duration must be greater than zero.</div>
            <div class="nc-rpm-helper">Stored as a prefix on the milestone (rpm_phases has no duration column yet).</div>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
            <button class="nc-w-add" data-act="cancel">Cancel</button>
            <button class="nc-rpm-ai-btn" data-act="save" style="padding:9px 18px">Add phase</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    document.addEventListener('keydown', _addPhaseEscHandler);

    ov.addEventListener('click', (e) => { if (e.target === ov) _closeAddPhaseModal(); });
    ov.querySelector('[data-act="close"]').addEventListener('click', _closeAddPhaseModal);
    ov.querySelector('[data-act="cancel"]').addEventListener('click', _closeAddPhaseModal);

    const nameEl  = ov.querySelector('#nc-addphase-name');
    const weeksEl = ov.querySelector('#nc-addphase-weeks');
    const nameErr = ov.querySelector('#nc-addphase-name-err');
    const wkErr   = ov.querySelector('#nc-addphase-weeks-err');
    setTimeout(() => nameEl?.focus(), 50);

    const submit = async () => {
      const name = (nameEl.value || '').trim();
      const wkRaw = (weeksEl.value || '').trim();
      const wk = wkRaw === '' ? null : Number(wkRaw);

      // Validate
      let ok = true;
      if (!name) { nameErr.style.display = ''; ok = false; } else { nameErr.style.display = 'none'; }
      if (wkRaw !== '' && (!Number.isFinite(wk) || wk <= 0)) { wkErr.style.display = ''; ok = false; } else { wkErr.style.display = 'none'; }
      if (!ok) return;

      const milestone = (wk && wk > 0) ? `(${wk} ${wk === 1 ? 'week' : 'weeks'}) ` : '';
      const blank = {
        stage_name:      name,
        milestone_label: milestone,
        tripwire_test:   '',
        load_tolerance:  'Gravity',
        cue_mode:        'top_down',
        phase_index:     next,
        ai_generated:    false,
      };
      try {
        const g = await _ensureGraph();
        await RPMGraph.savePhase(g.id, blank);
        const full = await RPMGraph.load(g.id);
        state.phases = full.phases;
        _closeAddPhaseModal();
        _render();
        _toast(`Phase "${name}" added ✓`, 'success');
      } catch (e) {
        console.error('[builder] add phase failed:', e);
        state.lastError = `Could not add phase: ${e.message || 'unknown error'}`;
        _closeAddPhaseModal();
        _renderControls();
      }
    };
    ov.querySelector('[data-act="save"]').addEventListener('click', submit);
    // Enter to submit (when focus is in either input)
    [nameEl, weeksEl].forEach(el => el?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
  }

  async function _publish() {
    if (!state.clientId) { _toast('Pick a client first.', 'error'); return; }
    if (!state.phases.length) { _toast('Add at least one phase before publishing.', 'error'); return; }
    const pb = state.draft.point_b_dream || state.graph?.point_b_dream || '';
    if (!pb.trim()) { _toast('Define Point B (dream outcome) first.', 'error'); return; }
    if (!confirm('Publish this graph to the client? They will see it on their dashboard immediately.')) return;
    const btn = document.getElementById('rpm-publish');
    const origHTML = btn ? btn.innerHTML : null;
    if (btn) {
      btn.disabled  = true;
      btn.innerHTML = '<span class="neu-spinner" style="border-top-color:#04141A;margin-right:6px;vertical-align:-2px"></span>Publishing…';
    }
    try {
      // Ensure latest draft values are persisted before publishing
      await _flushGraphSave();
      const g = await _ensureGraph();
      await RPMGraph.publish(g.id);
      _toast('Graph published ✓ Client now sees Phase 1 unlocked.', 'success');
      // Reload state to reflect status
      await _loadDraft(state.clientId);
      _render();
    } catch (e) {
      console.error('[builder] publish failed:', e);
      state.lastError = `Publish failed: ${e.message || 'unknown error'}`;
      // Restore the button if _renderControls hasn't already rebuilt it
      if (btn && document.body.contains(btn)) {
        btn.disabled = false;
        btn.innerHTML = origHTML;
      }
      _renderControls();
    }
  }

  function _toast(msg, kind = 'info') {
    if (typeof Dashboard !== 'undefined' && Dashboard.toast) Dashboard.toast(msg, kind);
    else console.log(`[builder] ${kind}: ${msg}`);
  }

  // ───────────────────────────────────────────────────────────
  // Render — root
  // ───────────────────────────────────────────────────────────
  let _clients = [];
  let _clientName = '';             // name of the New Session client
  let _allExercises = [];           // 5C — for the manual exercise picker
  const _chatOpen = new Set();      // 5D — phaseIds whose chat panel is expanded

  async function _loadAllExercises() {
    try {
      const { data, error } = await sb.from('exercises')
        .select('id, name, phase, target_joints')
        .order('name', { ascending: true })
        .limit(500);
      if (error) { console.warn('[builder] exercise list failed:', error); return []; }
      return data || [];
    } catch (e) { console.warn('[builder] exercise list error:', e); return []; }
  }

  // Reads the client chosen in the New Session "Client Info" tab.
  function _newSessionClient() {
    const sel = document.getElementById('ns-client-select');
    const id  = sel?.value || null;
    let name  = '';
    if (sel && sel.selectedIndex > 0) name = sel.options[sel.selectedIndex].textContent.trim();
    if (!name) name = document.getElementById('ns-name')?.value?.trim() || '';
    return { id, name };
  }

  async function init() {
    const root = $('#graph-builder-root');
    if (!root) return;
    root.innerHTML = `<div class="nc-rpm-empty"><span class="nc-rpm-empty-icon">⫶</span><p>Loading…</p></div>`;

    // Exercises (for the manual picker) load once
    if (!_allExercises.length) {
      try { _allExercises = await _loadAllExercises(); } catch {}
    }

    const ns = _newSessionClient();
    if (!ns.id) {
      // No existing client chosen in Client Info — the graph needs a real client row
      state.clientId = null;
      root.innerHTML = `
        <div class="nc-rpm-empty">
          <span class="nc-rpm-empty-icon">◉</span>
          <p>Pick an <b>existing client</b> in the <b>Client Info</b> tab first. The Reactive Graph builds that client's rehab program from their assessments.</p>
        </div>`;
      return;
    }

    // Same client already loaded — just re-render
    if (state.clientId === ns.id && state.graph !== undefined) {
      _clientName = ns.name;
      _render();
      return;
    }

    // Load this client's draft graph + assessments
    state.clientId = ns.id;
    _clientName = ns.name;
    state.graph = null;
    state.phases = [];
    state.aiSource = null;
    state.lastError = null;
    state.draft = { point_a_summary: '', point_b_dream: '', phase_count: 5 };
    try {
      await _loadDraft(ns.id);
    } catch (err) {
      console.error('[builder] load failed:', err);
      state.lastError = err.message || String(err);
    }
    _render();
  }

  function _render() {
    const root = $('#graph-builder-root');
    if (!root) return;

    // Empty-state gate: graph needs at least one assessment to build from.
    // If neither subjective nor objective exists, block editing and prompt.
    const hasSubj = !!state.subjective;
    const hasObj  = !!state.objective;
    if (state.clientId && !state.graph && !hasSubj && !hasObj) {
      root.innerHTML = `
        <div class="nc-rpm-empty">
          <span class="nc-rpm-empty-icon">⚠</span>
          <p><b>Please complete Subjective and Objective Assessment first.</b></p>
          <p style="margin-top:8px;color:var(--text-secondary);font-size:13px;line-height:1.6;max-width:420px">
            The graph auto-fills its End Goal from the subjective <i>dream outcome</i> and its
            Entry Point from the objective scores + subjective limitations.
            Complete those two assessments for <b>${escHtml(_clientName || 'this client')}</b> in the
            <b>Subjective</b> and <b>Objective</b> tabs above, then come back.
          </p>
        </div>`;
      return;
    }

    root.innerHTML = `
      <div class="nc-rpm-builder">
        <aside class="nc-rpm-controls" id="rpm-controls"></aside>
        <main class="nc-rpm-ladder-wrap">
          <div class="nc-rpm-ladder-head">
            <h3 id="rpm-ladder-title">Reactive Graph</h3>
            <span id="rpm-ladder-status"></span>
          </div>
          <div id="rpm-ladder-host"></div>
        </main>
      </div>
    `;
    _renderControls();
    _renderLadder();
  }

  function _renderControls() {
    const host = $('#rpm-controls');
    if (!host) return;
    const g = state.graph;

    // The Point A/B/etc controls render as soon as a client is picked,
    // backed by the draft buffer. The graph row is created lazily on first save.
    const showEditControls = !!state.clientId;
    const pc = state.draft.phase_count || 5;

    host.innerHTML = `
      <div class="nc-rpm-section">
        <h4>① Client</h4>
        <div class="nc-rpm-client-chip">
          <span class="nc-rpm-client-avatar">${escHtml((_clientName || '?').slice(0,2).toUpperCase())}</span>
          <div>
            <div class="nc-rpm-client-name">${escHtml(_clientName || 'Selected client')}</div>
            <div class="nc-rpm-helper" style="margin:0">From the Client Info tab</div>
          </div>
        </div>
        <div class="nc-rpm-helper">Their latest subjective + objective assessments seed the AI prompt. Change the client in the Client Info tab.</div>
      </div>

      ${(!state.subjective || !state.objective) ? `
        <div class="nc-rpm-section" style="border-color:rgba(212,175,55,0.45);background:rgba(212,175,55,0.06)">
          <h4 style="color:#D4AF37">◐ Partial assessment data</h4>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.55">
            ${!state.subjective ? 'No <b>subjective</b> assessment on file — End Goal won&rsquo;t pre-fill from a dream outcome.<br/>' : ''}
            ${!state.objective  ? 'No <b>objective</b> assessment on file — Entry Point won&rsquo;t include movement scores or flags.' : ''}
          </div>
          <div class="nc-rpm-helper">Complete the missing assessment for the richest AI prompt and pre-fills.</div>
        </div>
      ` : ''}

      ${state.lastError ? `
        <div class="nc-rpm-section" style="border-color:rgba(245,66,108,0.45);background:rgba(245,66,108,0.06)">
          <h4 style="color:#E11D6B">⚠ Heads up</h4>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.55">${escHtml(state.lastError)}</div>
          <div class="nc-rpm-helper">You can keep editing — the row will be created when you click Save / Generate / Publish.</div>
        </div>
      ` : ''}

      ${showEditControls ? `
      <div class="nc-rpm-section">
        <h4>② Point B — Dream Outcome</h4>
        <textarea id="rpm-point-b" placeholder="What's the destination? e.g. Garden for two hours per day pain-free.">${escHtml(state.draft.point_b_dream || '')}</textarea>
        <div class="nc-rpm-helper">Inversion principle: every phase below is a milestone needed to reach this.</div>
      </div>

      <div class="nc-rpm-section">
        <h4>③ Point A — Current State</h4>
        <textarea id="rpm-point-a" placeholder="Current symptoms, motor adaptations, restrictions.">${escHtml(state.draft.point_a_summary || '')}</textarea>
      </div>

      <div class="nc-rpm-section">
        <h4>◆ Movement Scores</h4>
        ${_scorePanel()}
        <div class="nc-rpm-helper">From the client's latest objective assessment — fed into the AI prompt.</div>
      </div>

      <div class="nc-rpm-section">
        <h4>④ Phase Count</h4>
        <div class="nc-rpm-stepper">
          <button class="nc-rpm-stepper-btn" id="rpm-pc-down" ${pc <= 3 ? 'disabled' : ''}>−</button>
          <span class="nc-rpm-stepper-val">${pc}</span>
          <button class="nc-rpm-stepper-btn" id="rpm-pc-up" ${pc >= 7 ? 'disabled' : ''}>+</button>
        </div>
        <div class="nc-rpm-helper">3–7 phases. Default 5 (matches NeuCore's stages).</div>
      </div>

      <div class="nc-rpm-section">
        <h4>⑤ AI Generate Phases</h4>
        <button class="nc-rpm-ai-btn" id="rpm-ai-phases" ${state.aiBusy ? 'disabled' : ''}>
          ${state.aiBusy
            ? '<span class="spinner spinner-sm" aria-hidden="true" style="border-top-color:#fff;border-color:rgba(255,255,255,0.25);border-top:2px solid #fff;margin-right:6px;vertical-align:-2px"></span>Generating…'
            : '<span class="nc-rpm-ai-spark">✦</span> ' + (state.phases.length ? 'Re-generate phases' : 'Generate phases')}
        </button>
        ${state.aiBusy ? '<div class="nc-rpm-helper" style="color:var(--nc-cyan)">Contacting Anthropic Sonnet… typical response ~6–10s.</div>' : ''}
        ${state.aiSource ? `
          <div class="nc-rpm-ai-source ${state.aiSource}">
            ${state.aiSource === 'anthropic' ? 'Anthropic Sonnet · NeuCore-trained system prompt' : 'Clinical fallback · NeuCore default 5 stages'}
          </div>` : ''}
        <div class="nc-rpm-helper">Replaces all phases. Edit / reorder / remove freely after.</div>
      </div>

      <div class="nc-rpm-section">
        <button class="nc-rpm-publish" id="rpm-publish" ${!state.phases.length || g?.status === 'published' ? 'disabled' : ''}>
          ${g?.status === 'published' ? '✓ Published — Live for client' : '↟ Publish to client'}
        </button>
        ${!state.phases.length ? `<div class="nc-rpm-helper">Add phases first (click ⑤ Generate phases above).</div>` : ''}
      </div>
      ` : ''}
    `;

    if (showEditControls) {
      // Point B/A — write to draft buffer; lazy-create on first save
      $('#rpm-point-b')?.addEventListener('input', (e) => {
        state.draft.point_b_dream = e.target.value;
        _scheduleGraphSave();
      });
      $('#rpm-point-a')?.addEventListener('input', (e) => {
        state.draft.point_a_summary = e.target.value;
        _scheduleGraphSave();
      });

      // Phase count stepper
      $('#rpm-pc-up')?.addEventListener('click', () => {
        state.draft.phase_count = Math.min(7, (state.draft.phase_count || 5) + 1);
        _scheduleGraphSave();
        _renderControls();
      });
      $('#rpm-pc-down')?.addEventListener('click', () => {
        state.draft.phase_count = Math.max(3, (state.draft.phase_count || 5) - 1);
        _scheduleGraphSave();
        _renderControls();
      });

      // AI generate
      $('#rpm-ai-phases')?.addEventListener('click', _generatePhasesViaAI);

      // Publish
      $('#rpm-publish')?.addEventListener('click', _publish);
    }

    // Update ladder header
    const title = $('#rpm-ladder-title');
    if (title) title.textContent = state.clientId
      ? (g?.status === 'published' ? 'Published Graph' : `Draft Graph — ${state.phases.length || 0} phase${state.phases.length === 1 ? '' : 's'}`)
      : 'Select a client to begin';
    const status = $('#rpm-ladder-status');
    if (status) status.innerHTML = g?.status === 'published'
      ? `<span class="nc-rpm-ai-source anthropic">Live · ${new Date(g.published_at).toLocaleDateString()}</span>`
      : '';
  }

  // ── Diagonal node-graph rendering ──────────────────────────
  let _popupEl = null;
  let _editorPhaseId = null;

  function _renderLadder() {
    const host = $('#rpm-ladder-host');
    if (!host) return;

    if (!state.clientId) {
      host.innerHTML = `<div class="nc-rpm-empty"><span class="nc-rpm-empty-icon">⫶</span><p>Pick an existing client in the Client Info tab to begin.</p></div>`;
      return;
    }
    _renderDiagonalGraph(host);
  }

  function _renderDiagonalGraph(host) {
    const g  = state.graph;
    const pb = (g?.point_b_dream)   || state.draft.point_b_dream   || '';
    const pa = (g?.point_a_summary) || state.draft.point_a_summary || '';
    const phases = state.phases.slice().sort((a, b) => a.phase_index - b.phase_index);
    const N = phases.length;

    // Diagonal endpoints (percent coords). A bottom-left, B top-right.
    const ax = 15, ay = 85, bx = 85, by = 15;
    const nodes = phases.map((p, i) => {
      const t = (i + 1) / (N + 1);
      return { p, x: ax + t * (bx - ax), y: ay + t * (by - ay) };
    });

    host.innerHTML = `
      <div class="nc-dgraph" id="nc-dgraph">
        <svg class="nc-dgraph-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="nc-dgraph-grad" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0"   stop-color="#F5426C"/>
              <stop offset="0.5" stop-color="#14B8A6"/>
              <stop offset="1"   stop-color="#D4AF37"/>
            </linearGradient>
          </defs>
          <line class="nc-dgraph-axis-bg" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>
          <line class="nc-dgraph-axis"    x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>
        </svg>

        <div class="nc-dgraph-endpoint nc-dgraph-endpoint--a" style="left:${ax}%;top:${ay}%">
          <span class="nc-dgraph-endpoint-dot">A</span>
          <div class="nc-dgraph-endpoint-label">
            <small>Point A · now</small>
            <span>${escHtml(pa || 'Set Point A in controls')}</span>
          </div>
        </div>
        <div class="nc-dgraph-endpoint nc-dgraph-endpoint--b" style="left:${bx}%;top:${by}%">
          <span class="nc-dgraph-endpoint-dot">B</span>
          <div class="nc-dgraph-endpoint-label">
            <small>Point B · dream outcome</small>
            <span>${escHtml(pb || 'Set Point B in controls')}</span>
          </div>
        </div>

        ${nodes.map(n => `
          <button class="nc-dgraph-node ${n.p.status || ''}" data-node-id="${n.p.id}"
                  style="left:${n.x}%;top:${n.y}%">
            <span class="nc-dgraph-node-dot">${n.p.phase_index}</span>
            <span class="nc-dgraph-node-label">${escHtml(n.p.stage_name || 'Phase')}</span>
          </button>
        `).join('')}

        ${!N ? `
          <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;max-width:340px">
            <p style="color:var(--text-secondary);font-size:13px;line-height:1.6">
              No phases yet. Use <b>⑤ Generate phases</b> in the controls panel, or <b>+ Add phase</b>.
            </p>
          </div>` : ''}

        <button class="nc-w-add nc-dgraph-addphase" id="rpm-add-blank">+ Add phase</button>
      </div>
    `;

    $('#rpm-add-blank')?.addEventListener('click', _addBlankPhase);
    $$('.nc-dgraph-node').forEach(node => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = state.phases.find(x => x.id === node.dataset.nodeId);
        if (p) _showNodePopup(p, node);
      });
    });
    $('#nc-dgraph')?.addEventListener('click', (e) => {
      if (!e.target.closest('.nc-dgraph-node') && !e.target.closest('.nc-dgraph-popup')) _closeNodePopup();
    });
  }

  function _closeNodePopup() {
    if (_popupEl) { _popupEl.remove(); _popupEl = null; }
    $$('.nc-dgraph-node.selected').forEach(n => n.classList.remove('selected'));
  }

  function _showNodePopup(phase, nodeEl) {
    _closeNodePopup();
    nodeEl.classList.add('selected');
    const exCount = (phase.exercises || []).length;
    const statusBadge = phase.status && phase.status !== 'locked'
      ? `<span style="color:var(--nc-cyan)">${phase.status}</span>` : '';

    const pop = document.createElement('div');
    pop.className = 'nc-dgraph-popup';
    pop.innerHTML = `
      <div class="nc-dgraph-popup-head">
        <span class="nc-dgraph-popup-phase">Phase ${phase.phase_index} ${statusBadge}</span>
        <button class="nc-dgraph-popup-close" data-act="close" aria-label="Close">✕</button>
      </div>
      <div class="nc-dgraph-popup-title">${escHtml(phase.stage_name || 'Unnamed phase')}</div>
      ${phase.milestone_label ? `<div class="nc-dgraph-popup-row"><b>Milestone:</b> ${escHtml(phase.milestone_label)}</div>` : ''}
      ${phase.tripwire_test   ? `<div class="nc-dgraph-popup-row"><b>Tripwire:</b> ${escHtml(phase.tripwire_test)}</div>` : ''}
      <div class="nc-dgraph-popup-meta">
        ${phase.load_tolerance ? `<span>${escHtml(phase.load_tolerance)}</span>` : ''}
        ${phase.cue_mode ? `<span>${escHtml(phase.cue_mode.replace('_','-'))}</span>` : ''}
        <span>${exCount} exercise${exCount === 1 ? '' : 's'}</span>
      </div>
      <button class="nc-dgraph-popup-expand" data-act="expand">⤢ Expand &amp; edit phase</button>
    `;
    // Anchor below the node
    pop.style.left = nodeEl.style.left;
    pop.style.top  = `calc(${nodeEl.style.top} + 30px)`;
    $('#nc-dgraph')?.appendChild(pop);
    _popupEl = pop;

    pop.querySelector('[data-act="close"]').addEventListener('click', _closeNodePopup);
    pop.querySelector('[data-act="expand"]').addEventListener('click', () => {
      _closeNodePopup();
      _openPhaseEditor(phase);
    });
  }

  function _openPhaseEditor(phase) {
    _closePhaseEditor();
    _editorPhaseId = phase.id;
    const ov = document.createElement('div');
    ov.className = 'nc-dgraph-editor-overlay';
    ov.id = 'nc-phase-editor';
    ov.innerHTML = `
      <div class="nc-dgraph-editor">
        <div class="nc-dgraph-editor-head">
          <h3>Phase ${phase.phase_index} — ${escHtml(phase.stage_name || 'Phase')}</h3>
          <button class="nc-dgraph-editor-close" data-act="close" aria-label="Close">✕</button>
        </div>
        <div class="nc-dgraph-editor-body" id="nc-phase-editor-body">
          ${_phaseCard(phase)}
        </div>
      </div>`;
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';

    const card = ov.querySelector('.nc-rpm-phase');
    if (card) _bindPhaseCard(card, phase);
    ov.querySelector('[data-act="close"]').addEventListener('click', _closePhaseEditor);
    ov.addEventListener('click', (e) => { if (e.target === ov) _closePhaseEditor(); });
    document.addEventListener('keydown', _editorEscHandler);
  }

  function _editorEscHandler(e) {
    if (e.key === 'Escape') _closePhaseEditor();
  }

  function _closePhaseEditor() {
    const ov = $('#nc-phase-editor');
    if (ov) ov.remove();
    document.body.style.overflow = '';
    _editorPhaseId = null;
    document.removeEventListener('keydown', _editorEscHandler);
  }

  // Re-render the open Expand editor's card from current state
  function _refreshEditorCard() {
    if (!_editorPhaseId) return;
    const ph = state.phases.find(p => p.id === _editorPhaseId);
    const body = $('#nc-phase-editor-body');
    if (ph && body) {
      body.innerHTML = _phaseCard(ph);
      const card = body.querySelector('.nc-rpm-phase');
      if (card) _bindPhaseCard(card, ph);
    } else if (!ph) {
      _closePhaseEditor();
    }
  }

  // Reload phases from DB, re-render the graph, and refresh the editor if open
  async function _afterPhaseDataChange() {
    if (!state.graph) return;
    try {
      const full = await RPMGraph.load(state.graph.id);
      state.phases = full.phases;
    } catch (e) { console.error('[builder] reload failed:', e); }
    _renderLadder();
    _refreshEditorCard();
  }

  function _phaseCard(p) {
    const exercises = (p.exercises || []).slice().sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    const isLoading = state.loadingExercisesFor === p.id;
    return `
      <div class="nc-rpm-phase" data-phase-id="${p.id}" data-phase-idx="${p.phase_index}">
        <div class="nc-rpm-phase-num">${p.phase_index}</div>
        <div class="nc-rpm-phase-body">
          <div class="nc-rpm-phase-row">
            <div class="nc-rpm-phase-field">
              <label>Stage name</label>
              <input data-fld="stage_name" value="${escHtml(p.stage_name || '')}"/>
            </div>
            <div class="nc-rpm-phase-field">
              <label>Milestone (D.O.M.S.)</label>
              <input data-fld="milestone_label" value="${escHtml(p.milestone_label || '')}" placeholder="e.g. Walk up stairs pain-free"/>
            </div>
          </div>
          <div class="nc-rpm-phase-row">
            <div class="nc-rpm-phase-field">
              <label>Emotional win</label>
              <input data-fld="emotional_win" value="${escHtml(p.emotional_win || '')}" placeholder="e.g. Lift husband off chair"/>
            </div>
            <div class="nc-rpm-phase-field">
              <label>Tripwire test</label>
              <input data-fld="tripwire_test" value="${escHtml(p.tripwire_test || '')}" placeholder="e.g. Midfoot bridge 30s"/>
            </div>
          </div>
          <div class="nc-rpm-phase-row">
            <div class="nc-rpm-phase-field">
              <label>Load tolerance</label>
              <select data-fld="load_tolerance">
                ${['Submaximal','Gravity','Impact','External'].map(v => `<option value="${v}" ${p.load_tolerance===v?'selected':''}>${v}</option>`).join('')}
              </select>
            </div>
            <div class="nc-rpm-phase-field">
              <label>Cue mode</label>
              <select data-fld="cue_mode">
                <option value="top_down"  ${p.cue_mode==='top_down'?'selected':''}>Top-down (conscious)</option>
                <option value="mixed"     ${p.cue_mode==='mixed'?'selected':''}>Mixed</option>
                <option value="bottom_up" ${p.cue_mode==='bottom_up'?'selected':''}>Bottom-up (reflexive)</option>
              </select>
            </div>
          </div>

          <!-- 5B — body regions this phase addresses -->
          <div class="nc-rpm-regions">
            <div class="nc-rpm-regions-label">Body regions addressed</div>
            <div class="nc-rpm-region-grid" data-regions-for="${p.id}">
              ${RPMGraph.BODY_REGIONS.map(r => `
                <button class="nc-rpm-region-chip ${(p.target_regions || []).includes(r.key) ? 'active' : ''}"
                        data-region="${r.key}" type="button">${escHtml(r.label)}</button>
              `).join('')}
            </div>
          </div>

          <div class="nc-rpm-exercises">
            <div class="nc-rpm-exercises-head">
              <span class="nc-rpm-exercises-label">Exercises (${exercises.length})</span>
              <button class="nc-w-add" data-act="ai-exercises" ${isLoading ? 'disabled' : ''}>
                ${isLoading ? '… picking' : '✦ AI pick'}
              </button>
            </div>
            ${exercises.length ? `
              <div class="nc-rpm-exercises-list">
                ${exercises.map((e, i) => `
                  <div class="nc-rpm-ex-item" data-pe-id="${e.id}">
                    <div class="nc-rpm-ex-name">${escHtml(e.exercises?.name || 'Exercise')}</div>
                    <div class="nc-rpm-ex-tags">${escHtml(_fmtPresc(e.prescription))}</div>
                    <button class="nc-rpm-ex-rm" data-act="rm-ex" data-pe-id="${e.id}" title="Remove">×</button>
                  </div>`).join('')}
              </div>` : `<div class="nc-rpm-ex-empty">No exercises yet — AI pick, or add manually below.</div>`}
            <!-- 5C — manual exercise picker -->
            ${_allExercises.length ? `
              <div class="nc-rpm-ex-picker">
                <select data-ex-select="${p.id}">
                  <option value="">+ Add an exercise manually…</option>
                  ${_allExercises.map(ex => `<option value="${ex.id}">${escHtml(ex.name)}${ex.phase ? ' · ' + escHtml(ex.phase) : ''}</option>`).join('')}
                </select>
                <button class="nc-rpm-ex-picker-add" data-act="manual-add-ex" data-phase-id="${p.id}">Add</button>
              </div>` : ''}
          </div>

          <!-- 5D — progressive per-phase chat -->
          <div class="nc-chat" data-chat-for="${p.id}">
            <div class="nc-chat-head">
              <span class="nc-chat-label">Phase notes &amp; chat</span>
              <button class="nc-chat-toggle" data-act="chat-toggle" data-phase-id="${p.id}">${_chatOpen.has(p.id) ? 'Hide' : 'Show'}</button>
            </div>
            <div class="nc-chat-body" data-chat-body="${p.id}" style="${_chatOpen.has(p.id) ? '' : 'display:none'}"></div>
          </div>
        </div>
        <div class="nc-rpm-phase-actions">
          <button class="nc-rpm-phase-act danger" data-act="rm-phase" title="Remove phase">✕</button>
        </div>
      </div>`;
  }

  function _fmtPresc(p) {
    if (!p || typeof p !== 'object') return '';
    const bits = [];
    if (p.sets) bits.push(`${p.sets} sets`);
    if (p.reps) bits.push(p.reps);
    if (p.tempo) bits.push(p.tempo);
    return bits.join(' · ');
  }

  // 5A — composite + 4-domain score panel from the client's objective assessment
  function _scorePanel() {
    const o = state.objective;
    if (!o) return `<div class="nc-rpm-score-empty">No objective assessment on file yet.</div>`;
    const fmt = (v) => (v == null ? '—' : Number(v).toFixed(0));
    const cells = [
      { lbl: 'Composite', val: o.composite_score, cls: 'composite' },
      { lbl: 'ROM',       val: o.rom_score },
      { lbl: 'Control',   val: o.control_score },
      { lbl: 'Force',     val: o.force_score },
      { lbl: 'Neuro',     val: o.neurology_score },
    ];
    return `<div class="nc-rpm-scores">
      ${cells.map(c => `
        <div class="nc-rpm-score ${c.cls || ''}">
          <span class="nc-rpm-score-val">${fmt(c.val)}</span>
          <span class="nc-rpm-score-lbl">${c.lbl}</span>
        </div>`).join('')}
    </div>`;
  }

  // Bind a single phase card (used inside the Expand editor overlay)
  function _bindPhaseCard(card, phase) {
    const phaseId = phase.id;

    // Field edits — debounced save + ML feedback hook on first override per AI phase
    card.querySelectorAll('[data-fld]').forEach(el => {
      el.addEventListener('input', () => {
        const fld = el.dataset.fld;
        phase[fld] = el.value;
        _scheduleSavePhase(phase);
      });
      el.addEventListener('blur', () => _maybeAskFeedback(phase));
    });

    // Remove phase — closes the editor afterwards
    card.querySelector('[data-act="rm-phase"]')?.addEventListener('click', async () => {
      await _removePhase(phase);
      _closePhaseEditor();
    });

    // AI exercises for this phase
    card.querySelector('[data-act="ai-exercises"]')?.addEventListener('click', () => _generateExercisesForPhase(phase));

    // Remove individual exercise
    card.querySelectorAll('[data-act="rm-ex"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const peId = btn.dataset.peId;
        try {
          await sb.from('rpm_phase_exercises').delete().eq('id', peId);
          await _afterPhaseDataChange();
        } catch (e) { console.error(e); }
      });
    });

    // 5B — region chip toggles
    card.querySelectorAll('.nc-rpm-region-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const region = chip.dataset.region;
        const set = new Set(phase.target_regions || []);
        if (set.has(region)) set.delete(region); else set.add(region);
        phase.target_regions = Array.from(set);
        chip.classList.toggle('active');
        _scheduleSavePhase(phase);
      });
    });

    // 5C — manual exercise add
    card.querySelector('[data-act="manual-add-ex"]')?.addEventListener('click', async () => {
      const sel = card.querySelector(`[data-ex-select="${phaseId}"]`);
      const exId = sel?.value;
      if (!exId) { _toast('Pick an exercise from the list first.', 'error'); return; }
      try {
        const existing = (phase.exercises || []).map(e => ({
          exercise_id: e.exercise_id, prescription: e.prescription, display_order: e.display_order, ai_generated: e.ai_generated,
        }));
        existing.push({ exercise_id: exId, prescription: {}, display_order: existing.length, ai_generated: false });
        await RPMGraph.setPhaseExercises(phaseId, existing);
        await _afterPhaseDataChange();
        _toast('Exercise added ✓', 'success');
      } catch (e) { console.error('[builder] manual add failed:', e); _toast('Could not add exercise', 'error'); }
    });

    // 5D — chat toggle
    card.querySelector('[data-act="chat-toggle"]')?.addEventListener('click', () => {
      const body = card.querySelector(`[data-chat-body="${phaseId}"]`);
      const btn  = card.querySelector('[data-act="chat-toggle"]');
      if (!body) return;
      const open = _chatOpen.has(phaseId);
      if (open) {
        _chatOpen.delete(phaseId);
        body.style.display = 'none';
        if (btn) btn.textContent = 'Show';
      } else {
        _chatOpen.add(phaseId);
        body.style.display = '';
        if (btn) btn.textContent = 'Hide';
        if (typeof RPMChat !== 'undefined' && state.graph) {
          RPMChat.mount(body, { graphId: state.graph.id, phaseId });
        }
      }
    });

    // Auto-mount chat if it was already open
    if (_chatOpen.has(phaseId)) {
      const body = card.querySelector(`[data-chat-body="${phaseId}"]`);
      if (body && typeof RPMChat !== 'undefined' && state.graph) {
        body.style.display = '';
        RPMChat.mount(body, { graphId: state.graph.id, phaseId });
      }
    }
  }

  // Public
  window.RPMGraphBuilder = {
    init,
    selectClient: (id) => {
      state.clientId = id;
      _render();
      $('#rpm-client-pick')?.dispatchEvent(new Event('change'));
    },
    _state: () => ({ ...state }),
  };
})();
