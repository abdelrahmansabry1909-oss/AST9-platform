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
      duration_weeks:  p.duration_weeks  ?? null,
    };
  }
  function _phaseDiff(snap, cur) {
    const fields = ['stage_name','milestone_label','emotional_win','tripwire_test','load_tolerance','cue_mode','duration_weeks'];
    const changed = {};
    for (const f of fields) {
      if ((snap?.[f] ?? '') !== (cur?.[f] ?? '')) changed[f] = { old: snap?.[f] ?? '', new: cur?.[f] ?? '' };
    }
    return changed;
  }
  function _phaseAsText(p) {
    return [
      `Stage: ${p.stage_name || ''}`,
      `Milestone: ${p.milestone_label || ''}`,
      `Duration: ${p.duration_weeks != null ? p.duration_weeks + ' weeks' : 'unscheduled'}`,
      `Win: ${p.emotional_win || ''}`,
      `Tripwire: ${p.tripwire_test || ''}`,
      `Load: ${p.load_tolerance || ''} · Cue: ${p.cue_mode || ''}`,
    ].join('\n');
  }

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

  async function _loadClients() {
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

  async function _loadDraft(clientId) {
    const coachId = _coachId();
    if (!coachId) throw new Error('Not signed in — please log in as a coach.');
    state.coachId = coachId;

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

    state.draft = {
      point_b_dream:   subj?.dream_outcome || '',
      point_a_summary: _buildEntryPointSummary(subj, obj) || '',
      phase_count:     5,
    };

    const { data: drafts, error } = await sb.from('rpm_graphs')
      .select('*')
      .eq('coach_id', coachId)
      .eq('client_id', clientId)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) {
      throw new Error(`Could not list draft graphs (${error.code || error.message || 'unknown'}). The graph row will be created when you start editing.`);
    }

    if (drafts && drafts.length) {
      state.graph = drafts[0];
      const full = await RPMGraph.load(state.graph.id);
      state.phases = full.phases;
      state.aiSnapshot.clear();
      state.feedbackAsked.clear();
      state.phases.forEach(p => {
        if (p.ai_generated) state.aiSnapshot.set(p.id, _phaseSnapshot(p));
      });
      state.draft.point_a_summary = state.graph.point_a_summary || state.draft.point_a_summary;
      state.draft.point_b_dream   = state.graph.point_b_dream   || state.draft.point_b_dream;
      state.draft.phase_count     = state.graph.phase_count     || 5;
    } else {
      state.graph  = null;
      state.phases = [];
    }
  }

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
      const g = await _ensureGraph();
      await RPMGraph.update(g.id, {
        point_a_summary: state.draft.point_a_summary,
        point_b_dream:   state.draft.point_b_dream,
        phase_count:     state.draft.phase_count,
      });
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

  async function _generatePhasesViaAI() {
    if (state.aiBusy) return;
    if (!state.clientId) { _toast('Pick a client first.', 'error'); return; }
    state.aiBusy = true;
    state.lastError = null;
    _renderControls();

    try {
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

      const phases = (data.phases || []).map((p, i) => ({ ...p, phase_index: i + 1, ai_generated: state.aiSource === 'anthropic' }));
      const saved = await RPMGraph.savePhases(state.graph.id, phases);
      const full = await RPMGraph.load(state.graph.id);
      state.phases = full.phases;
      state.aiSnapshot.clear();
      state.feedbackAsked.clear();
      state.phases.forEach(p => {
        if (p.ai_generated) state.aiSnapshot.set(p.id, _phaseSnapshot(p));
      });
      await RPMGraph.update(state.graph.id, { ai_generated: state.aiSource === 'anthropic' });
    } catch (e) {
      console.error('[builder] AI generate failed:', e);
      const reason = (e && e.message) ? e.message : String(e);
      state.lastError = `Could not generate phases via AI — ${reason}. Loaded NeuCore's default 5-stage ladder instead so you can keep working.`;
      _toast('AI request failed — using clinical default phases instead.', 'error');
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

  function _scheduleSavePhase(phase) {
    clearTimeout(phase._saveTimer);
    phase._saveTimer = setTimeout(async () => {
      try { await RPMGraph.savePhase(state.graph.id, phase); }
      catch (e) { console.error('[builder] phase save failed:', e); }
    }, 500);
  }

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
            <label>Stage name <span style="color:var(--rose-400, #FB7185)">*</span></label>
            <input id="nc-addphase-name" type="text" value="Phase ${next}" placeholder="e.g. Bridging the Gap"/>
            <div class="nc-rpm-helper" id="nc-addphase-name-err" style="color:var(--rose-400, #FB7185);display:none">Stage name is required.</div>
          </div>
          <div class="nc-rpm-phase-field" style="margin-bottom:14px">
            <label>Estimated duration (weeks) — optional</label>
            <input id="nc-addphase-weeks" type="number" min="1" max="260" step="1" placeholder="e.g. 2 (leave blank for unscheduled)"/>
            <div class="nc-rpm-helper" id="nc-addphase-weeks-err" style="color:var(--rose-400, #FB7185);display:none">Duration must be an integer between 1 and 260.</div>
            <div class="nc-rpm-helper">Determines run length along the time axis. Unscheduled phases fall back to equal spacing.</div>
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

      let ok = true;
      if (!name) { nameErr.style.display = ''; ok = false; } else { nameErr.style.display = 'none'; }
      if (wkRaw !== '' && (!Number.isInteger(wk) || wk < 1 || wk > 260)) { wkErr.style.display = ''; ok = false; } else { wkErr.style.display = 'none'; }
      if (!ok) return;

      const milestone = (wk && wk > 0) ? `(${wk} ${wk === 1 ? 'week' : 'weeks'}) ` : '';
      const blank = {
        stage_name:      name,
        milestone_label: milestone,
        duration_weeks:  (wk && wk > 0) ? wk : null,
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
      await _flushGraphSave();
      const g = await _ensureGraph();
      await RPMGraph.publish(g.id);
      _toast('Graph published ✓ Client now sees Phase 1 unlocked.', 'success');
      await _loadDraft(state.clientId);
      _render();
    } catch (e) {
      console.error('[builder] publish failed:', e);
      state.lastError = `Publish failed: ${e.message || 'unknown error'}`;
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
  let _clientName = '';
  let _allExercises = [];
  const _chatOpen = new Set();

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

    if (!_allExercises.length) {
      try { _allExercises = await _loadAllExercises(); } catch {}
    }

    const ns = _newSessionClient();
    if (!ns.id) {
      state.clientId = null;
      root.innerHTML = `
        <div class="nc-rpm-empty">
          <span class="nc-rpm-empty-icon">◉</span>
          <p>Pick an <b>existing client</b> in the <b>Client Info</b> tab first. The Reactive Graph builds that client's rehab program from their assessments.</p>
        </div>`;
      return;
    }

    if (state.clientId === ns.id && state.graph !== undefined) {
      _clientName = ns.name;
      _render();
      return;
    }

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

    const showEditControls = !!state.clientId;
    const pc = state.draft.phase_count || 5;

    // Defect 5 Fix: Rail headers use TEXT LABELS only (numbers belong strictly to wizard steps in tab bar)
    host.innerHTML = `
      <div class="nc-rpm-section">
        <h4>CLIENT</h4>
        <div class="nc-rpm-client-chip">
          <span class="nc-rpm-client-avatar">${escHtml((_clientName || '?').slice(0,2).toUpperCase())}</span>
          <div>
            <div class="nc-rpm-client-name">${escHtml(_clientName || 'Selected client')}</div>
            <div class="nc-rpm-helper" style="margin:0">From Client Info tab</div>
          </div>
        </div>
        <div class="nc-rpm-helper">Subjective + objective assessments seed the AI prompt and Point A/B pre-fills.</div>
      </div>

      ${(!state.subjective || !state.objective) ? `
        <div class="nc-rpm-section nc-rpm-section-note">
          <h4 style="color:var(--amber-400, #FBBF24)">◐ PARTIAL ASSESSMENT DATA</h4>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.55">
            ${!state.subjective ? 'No <b>subjective</b> assessment on file — End Goal won&rsquo;t pre-fill from a dream outcome.<br/>' : ''}
            ${!state.objective  ? 'No <b>objective</b> assessment on file — Entry Point won&rsquo;t include movement scores or flags.' : ''}
          </div>
          <div class="nc-rpm-helper">Complete missing assessments in tabs above for the richest seed data.</div>
        </div>
      ` : ''}

      ${state.lastError ? `
        <div class="nc-rpm-section nc-rpm-section-error">
          <h4 style="color:var(--rose-400, #FB7185)">⚠ HEADS UP</h4>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.55">${escHtml(state.lastError)}</div>
          <div class="nc-rpm-helper">You can keep editing — graph saves automatically when you modify or generate.</div>
        </div>
      ` : ''}

      ${showEditControls ? `
      <div class="nc-rpm-section">
        <h4>POINT B — DREAM OUTCOME</h4>
        <textarea id="rpm-point-b" placeholder="What's the destination? e.g. Garden for two hours per day pain-free.">${escHtml(state.draft.point_b_dream || '')}</textarea>
        <div class="nc-rpm-helper">Inversion principle: every phase is a milestone required to achieve Point B.</div>
      </div>

      <div class="nc-rpm-section">
        <h4>POINT A — CURRENT STATE</h4>
        <textarea id="rpm-point-a" placeholder="Current symptoms, motor adaptations, restrictions.">${escHtml(state.draft.point_a_summary || '')}</textarea>
      </div>

      <div class="nc-rpm-section">
        <h4>MOVEMENT SCORES</h4>
        ${_scorePanel()}
        <div class="nc-rpm-helper">Latest objective assessment scores fed into the program generator.</div>
      </div>

      <div class="nc-rpm-section">
        <h4>PHASE COUNT</h4>
        <div class="nc-rpm-stepper">
          <button class="nc-rpm-stepper-btn" id="rpm-pc-down" ${pc <= 3 ? 'disabled' : ''}>−</button>
          <span class="nc-rpm-stepper-val">${pc}</span>
          <button class="nc-rpm-stepper-btn" id="rpm-pc-up" ${pc >= 7 ? 'disabled' : ''}>+</button>
        </div>
        <div class="nc-rpm-helper">3–7 phases. Default 5 matching NeuCore stages.</div>
      </div>

      <div class="nc-rpm-section">
        <h4>CONFIG &amp; GENERATION</h4>
        <button class="nc-rpm-ai-btn" id="rpm-ai-phases" ${state.aiBusy ? 'disabled' : ''}>
          ${state.aiBusy
            ? '<span class="spinner spinner-sm" aria-hidden="true" style="border-top-color:#fff;border-color:rgba(255,255,255,0.25);border-top:2px solid #fff;margin-right:6px;vertical-align:-2px"></span>Generating…'
            : '<span class="nc-rpm-ai-spark">✦</span> ' + (state.phases.length ? 'Re-generate phases' : 'Generate phases')}
        </button>
        ${state.aiBusy ? '<div class="nc-rpm-helper" style="color:var(--emerald-500, #10B981)">Contacting AI engine… typical response ~6–10s.</div>' : ''}
        ${state.aiSource ? `
          <div class="nc-rpm-ai-source ${state.aiSource}">
            ${state.aiSource === 'anthropic' ? 'Anthropic Sonnet · NeuCore system prompt' : 'Clinical fallback · NeuCore default 5 stages'}
          </div>` : ''}
        <div class="nc-rpm-helper">Replaces all phases. Edit / reorder / remove freely after.</div>
      </div>

      <div class="nc-rpm-section">
        <h4>PUBLISH PROGRAM</h4>
        <button class="nc-rpm-publish" id="rpm-publish" ${!state.phases.length || g?.status === 'published' ? 'disabled' : ''}>
          ${g?.status === 'published' ? '✓ Published — Live for client' : '↟ Publish to client'}
        </button>
        ${!state.phases.length ? `<div class="nc-rpm-helper">Add phases first (+ Add phase or Generate).</div>` : ''}
      </div>
      ` : ''}
    `;

    if (showEditControls) {
      $('#rpm-point-b')?.addEventListener('input', (e) => {
        state.draft.point_b_dream = e.target.value;
        _scheduleGraphSave();
      });
      $('#rpm-point-a')?.addEventListener('input', (e) => {
        state.draft.point_a_summary = e.target.value;
        _scheduleGraphSave();
      });

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

      $('#rpm-ai-phases')?.addEventListener('click', _generatePhasesViaAI);
      $('#rpm-publish')?.addEventListener('click', _publish);
    }

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

  function _getPhaseDuration(p) {
    if (p.duration_weeks != null && Number(p.duration_weeks) > 0) {
      return Math.min(260, Math.max(1, parseInt(p.duration_weeks, 10)));
    }
    if (p.milestone_label) {
      const m = String(p.milestone_label).match(/\((\d+)\s*weeks?\)/i);
      if (m && m[1]) return parseInt(m[1], 10);
    }
    return null; // NULL means UNSCHEDULED
  }

  function _renderDiagonalGraph(host) {
    const g  = state.graph;
    const pb = (g?.point_b_dream)   || state.draft.point_b_dream   || '';
    const pa = (g?.point_a_summary) || state.draft.point_a_summary || '';
    const phases = state.phases.slice().sort((a, b) => (a.phase_index ?? 0) - (b.phase_index ?? 0));
    const N = phases.length;

    // Defect 4 Fix: Actionable Empty State (Primary "+ Add phase", Secondary "✦ Generate from assessment")
    if (!N) {
      host.innerHTML = `
        <div class="nc-dgraph nc-dgraph-empty" id="nc-dgraph">
          <div class="nc-dgraph-empty-content">
            <div class="nc-dgraph-empty-badge">REACTIVE GRAPH</div>
            <h3 class="nc-dgraph-empty-title">No Rehab Phases Created Yet</h3>
            <p class="nc-dgraph-empty-sub">Build your graded exposure ladder from Point A to Point B by hand, or generate a 5-stage starting plan from assessment findings.</p>
            <div class="nc-dgraph-empty-actions">
              <button class="nc-rpm-ai-btn nc-dgraph-btn-primary" id="rpm-empty-add" style="padding:10px 20px">+ Add phase</button>
              <button class="nc-w-add nc-dgraph-btn-secondary" id="rpm-empty-gen" ${state.aiBusy ? 'disabled' : ''} style="padding:10px 20px">
                ${state.aiBusy ? 'Generating…' : '✦ Generate from assessment'}
              </button>
            </div>
          </div>
        </div>
      `;
      $('#rpm-empty-add')?.addEventListener('click', _addBlankPhase);
      $('#rpm-empty-gen')?.addEventListener('click', _generatePhasesViaAI);
      return;
    }

    // Defect 2 Fix: Cumulative Duration Spacing
    const DEFAULT_LAYOUT_WEEKS = 2; // fallback spacing step for unscheduled phases
    const durList = phases.map(p => _getPhaseDuration(p));
    const phaseWeights = durList.map(d => (d != null && d > 0) ? d : DEFAULT_LAYOUT_WEEKS);
    const totalWeeks = phaseWeights.reduce((a, b) => a + b, 0) || 1;

    let accum = 0;
    const nodes = phases.map((p, i) => {
      const w = phaseWeights[i];
      const dur = durList[i]; // null if unscheduled
      const midWk = accum + (w / 2);
      accum += w;
      const t = midWk / totalWeeks;
      return { p, dur, w, midWk, t };
    });

    // 8+ phases: Enable horizontal scrolling canvas
    const isScrollable = N >= 8;
    const minWidthPx = isScrollable ? Math.max(1000, N * 150) : null;
    const containerStyle = minWidthPx ? `min-width:${minWidthPx}px;` : '';

    // Diagonal endpoints (percentage coords). A bottom-left, B top-right
    const ax = 12, ay = 82, bx = 88, by = 18;

    nodes.forEach(n => {
      n.x = ax + n.t * (bx - ax);
      n.y = ay + n.t * (by - ay);
    });

    // Week Milestone Ticks along cumulative axis
    const weekTicks = [{ wk: 0, t: 0, label: 'Wk 0' }];
    let curW = 0;
    nodes.forEach(n => {
      curW += n.w;
      weekTicks.push({ wk: curW, t: curW / totalWeeks, label: `Wk ${curW}` });
    });

    host.innerHTML = `
      <div class="nc-dgraph-scroll-wrap" style="${isScrollable ? 'overflow-x:auto;-webkit-overflow-scrolling:touch;' : ''}">
        <div class="nc-dgraph ${isScrollable ? 'nc-dgraph--scrollable' : ''}" id="nc-dgraph" style="${containerStyle}">
          <!-- Solid Emerald Axis Line (DESIGN.md) -->
          <svg class="nc-dgraph-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line class="nc-dgraph-axis-bg" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>
            <line class="nc-dgraph-axis"    x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>
            ${weekTicks.map(tick => {
              const tx = ax + tick.t * (bx - ax);
              const ty = ay + tick.t * (by - ay);
              return `<circle cx="${tx}" cy="${ty}" r="0.75" fill="var(--emerald-500, #10B981)"/>`;
            }).join('')}
          </svg>

          <!-- Week Milestone Markers along the Axis -->
          ${weekTicks.map(tick => {
            const tx = ax + tick.t * (bx - ax);
            const ty = ay + tick.t * (by - ay);
            return `
              <div class="nc-dgraph-tick" style="left:${tx}%;top:${ty}%">
                <span class="nc-dgraph-tick-label">${tick.label}</span>
              </div>
            `;
          }).join('')}

          <!-- Endpoint Point A -->
          <div class="nc-dgraph-endpoint nc-dgraph-endpoint--a" style="left:${ax}%;top:${ay}%">
            <span class="nc-dgraph-endpoint-dot">A</span>
            <div class="nc-dgraph-endpoint-label">
              <small>Point A · Initial State</small>
              <span>${escHtml(pa || 'Set Point A in left panel')}</span>
            </div>
          </div>

          <!-- Endpoint Point B -->
          <div class="nc-dgraph-endpoint nc-dgraph-endpoint--b" style="left:${bx}%;top:${by}%">
            <span class="nc-dgraph-endpoint-dot">B</span>
            <div class="nc-dgraph-endpoint-label">
              <small>Point B · Outcome</small>
              <span>${escHtml(pb || 'Set Point B in left panel')}</span>
            </div>
          </div>

          <!-- Defect 3 Fix: Content directly on Node (Index, Name, and Duration) -->
          ${nodes.map(n => {
            const isUnscheduled = n.dur == null;
            const durLabel = isUnscheduled ? 'Unscheduled' : `${n.dur} ${n.dur === 1 ? 'week' : 'weeks'}`;
            return `
              <div class="nc-dgraph-node-card ${isUnscheduled ? 'unscheduled' : ''} ${n.p.status || ''}"
                   data-node-id="${n.p.id}" style="left:${n.x}%;top:${n.y}%" role="button" tabindex="0"
                   aria-label="Phase ${n.p.phase_index}: ${escHtml(n.p.stage_name || 'Phase')} (${durLabel})">
                <div class="nc-dgraph-node-header">
                  <span class="nc-dgraph-node-idx">${n.p.phase_index}</span>
                  <span class="nc-dgraph-node-dur ${isUnscheduled ? 'is-unscheduled' : ''}">${durLabel}</span>
                </div>
                <div class="nc-dgraph-node-title">${escHtml(n.p.stage_name || 'Phase')}</div>
                ${n.p.tripwire_test ? `<div class="nc-dgraph-node-sub">${escHtml(n.p.tripwire_test)}</div>` : ''}
              </div>
            `;
          }).join('')}

          <button class="nc-w-add nc-dgraph-addphase" id="rpm-add-blank">+ Add phase</button>
        </div>
      </div>
    `;

    $('#rpm-add-blank')?.addEventListener('click', _addBlankPhase);
    $$('.nc-dgraph-node-card').forEach(node => {
      const handler = (e) => {
        e.stopPropagation();
        const p = state.phases.find(x => x.id === node.dataset.nodeId);
        if (p) _showNodePopup(p, node);
      };
      node.addEventListener('click', handler);
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handler(e); });
    });
    $('#nc-dgraph')?.addEventListener('click', (e) => {
      if (!e.target.closest('.nc-dgraph-node-card') && !e.target.closest('.nc-dgraph-popup')) _closeNodePopup();
    });
  }

  function _closeNodePopup() {
    if (_popupEl) { _popupEl.remove(); _popupEl = null; }
    $$('.nc-dgraph-node-card.selected').forEach(n => n.classList.remove('selected'));
  }

  function _showNodePopup(phase, nodeEl) {
    _closeNodePopup();
    nodeEl.classList.add('selected');
    const exCount = (phase.exercises || []).length;
    const statusBadge = phase.status && phase.status !== 'locked'
      ? `<span style="color:var(--emerald-500, #10B981)">${phase.status}</span>` : '';
    const durVal = _getPhaseDuration(phase);
    const durStr = durVal != null ? `${durVal} ${durVal === 1 ? 'week' : 'weeks'}` : 'Unscheduled';

    const pop = document.createElement('div');
    pop.className = 'nc-dgraph-popup';
    pop.innerHTML = `
      <div class="nc-dgraph-popup-head">
        <span class="nc-dgraph-popup-phase">Phase ${phase.phase_index} ${statusBadge}</span>
        <button class="nc-dgraph-popup-close" data-act="close" aria-label="Close">✕</button>
      </div>
      <div class="nc-dgraph-popup-title">${escHtml(phase.stage_name || 'Unnamed phase')}</div>
      <div class="nc-dgraph-popup-row"><b>Duration:</b> ${durStr}</div>
      ${phase.milestone_label ? `<div class="nc-dgraph-popup-row"><b>Milestone:</b> ${escHtml(phase.milestone_label)}</div>` : ''}
      ${phase.tripwire_test   ? `<div class="nc-dgraph-popup-row"><b>Tripwire:</b> ${escHtml(phase.tripwire_test)}</div>` : ''}
      <div class="nc-dgraph-popup-meta">
        ${phase.load_tolerance ? `<span>${escHtml(phase.load_tolerance)}</span>` : ''}
        ${phase.cue_mode ? `<span>${escHtml(phase.cue_mode.replace('_','-'))}</span>` : ''}
        <span>${exCount} exercise${exCount === 1 ? '' : 's'}</span>
      </div>
      <button class="nc-dgraph-popup-expand" data-act="expand">⤢ Expand &amp; edit phase</button>
    `;
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
              <label>Duration (weeks)</label>
              <input data-fld="duration_weeks" type="number" min="1" max="260" value="${p.duration_weeks ?? ''}" placeholder="e.g. 4 (blank = unscheduled)"/>
            </div>
          </div>
          <div class="nc-rpm-phase-row">
            <div class="nc-rpm-phase-field" style="grid-column:span 2">
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

          <!-- Body regions -->
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
            ${_allExercises.length ? `
              <div class="nc-rpm-ex-picker">
                <select data-ex-select="${p.id}">
                  <option value="">+ Add an exercise manually…</option>
                  ${_allExercises.map(ex => `<option value="${ex.id}">${escHtml(ex.name)}${ex.phase ? ' · ' + escHtml(ex.phase) : ''}</option>`).join('')}
                </select>
                <button class="nc-rpm-ex-picker-add" data-act="manual-add-ex" data-phase-id="${p.id}">Add</button>
              </div>` : ''}
          </div>

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

  function _bindPhaseCard(card, phase) {
    const phaseId = phase.id;

    card.querySelectorAll('[data-fld]').forEach(el => {
      el.addEventListener('input', () => {
        const fld = el.dataset.fld;
        let val = el.value;
        if (fld === 'duration_weeks') {
          val = val.trim() === '' ? null : Number(val);
        }
        phase[fld] = val;
        _scheduleSavePhase(phase);
      });
      el.addEventListener('blur', () => _maybeAskFeedback(phase));
    });

    card.querySelector('[data-act="rm-phase"]')?.addEventListener('click', async () => {
      await _removePhase(phase);
      _closePhaseEditor();
    });

    card.querySelector('[data-act="ai-exercises"]')?.addEventListener('click', () => _generateExercisesForPhase(phase));

    card.querySelectorAll('[data-act="rm-ex"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const peId = btn.dataset.peId;
        try {
          await sb.from('rpm_phase_exercises').delete().eq('id', peId);
          await _afterPhaseDataChange();
        } catch (e) { console.error(e); }
      });
    });

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

    if (_chatOpen.has(phaseId)) {
      const body = card.querySelector(`[data-chat-body="${phaseId}"]`);
      if (body && typeof RPMChat !== 'undefined' && state.graph) {
        body.style.display = '';
        RPMChat.mount(body, { graphId: state.graph.id, phaseId });
      }
    }
  }

  // Public API
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
