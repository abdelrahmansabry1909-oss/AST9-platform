/* ═══════════════════════════════════════════════════════════════
   NeuCore — Assessment Snapshot (Feature 7)

   Single source of truth for "load a client's latest assessment
   bundle" — shared by the client dashboard hero (clientDashboard.js)
   and the coach Recovery parity modal (clients.js). No duplicated
   query/derivation logic between the two surfaces.

   Why this exists (the bug it fixes):
     The old client-dashboard loader queried
       rehab_objective_assessments.client_id
     but that table has NO client_id — it is keyed by assessment_id.
     The 400 was swallowed, so the hero + report always fell back to
     illustrative numbers. The correct path is:
        assessments (has client_id)  →  rehab_objective_assessments
        via assessment_id, merged with body_map_states.joint_data
        (the coach-painted joints — the real "3D body map").

   Public surface (window.AssessmentSnapshot):
     loadLatest(clientId) → {
       assessment, objective, gait, subjective, bodyMap,  // raw rows or null
       profile,       // deriveLoadProfile() output for LoadVisualizer
       hasRealData,   // true if ANY assessment row exists for the client
     }

   RLS note: every read here is already permitted for both the client
   (own rows) and the assigned coach / admin (verified live). This
   module is strictly READ-ONLY; body-map authoring stays coach-side.
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const EMPTY = Object.freeze({
    assessment: null, objective: null, gait: null,
    subjective: null, bodyMap: null, profile: null, hasRealData: false,
  });

  // Latest single row for a table filtered by a column, newest first.
  async function _latest(table, col, val, orderCol = 'created_at') {
    try {
      const { data, error } = await sb
        .from(table)
        .select('*')
        .eq(col, val)
        .order(orderCol, { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) { console.warn(`[snapshot] ${table}:`, error.message); return null; }
      return data || null;
    } catch (e) {
      console.warn(`[snapshot] ${table} threw:`, e.message);
      return null;
    }
  }

  async function loadLatest(clientId) {
    if (!clientId || typeof sb === 'undefined') return { ...EMPTY };

    // 1) Parent assessment — the only assessment table with client_id.
    const assessment = await _latest('assessments', 'client_id', clientId);

    // 2) Objective ROM/scores — keyed by assessment_id (no client_id).
    const objective = assessment?.id
      ? await _latest('rehab_objective_assessments', 'assessment_id', assessment.id)
      : null;

    // 3) Gait, 4) body map, 5) subjective — all carry client_id.
    const [gait, bodyMap, subjective] = await Promise.all([
      _latest('gait_assessments', 'client_id', clientId),
      _latest('body_map_states', 'client_id', clientId, 'updated_at'),
      _latest('subjective_assessments', 'client_id', clientId),
    ]);

    // 6) Derive the per-region load profile for the 3D visualizer.
    //    Feed objective ROM + the coach-painted joint_data together.
    //    When there is no signal to colour the hologram (no objective
    //    row AND no body map), pass null so deriveLoadProfile returns
    //    its illustrative fallback (preserves prior UX for new clients).
    const hasSignal = !!(objective || bodyMap);
    const merged = hasSignal
      ? { ...(objective || {}), joint_data: bodyMap?.joint_data || {} }
      : null;
    const profile = (typeof window.deriveLoadProfile === 'function')
      ? window.deriveLoadProfile(merged)
      : null;

    const hasRealData = !!(assessment || objective || gait || subjective || bodyMap);

    return { assessment, objective, gait, subjective, bodyMap, profile, hasRealData };
  }

  // ── Shared rendering (used by client dashboard + coach Recovery modal) ──
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Render True Driver / Reported Symptoms / Coach's notes into hostEl from a
  // snapshot. opts lets a surface override the empty/notes copy (client vs coach);
  // defaults preserve the original client-dashboard wording.
  function renderReport(hostEl, snap, opts = {}) {
    if (!hostEl) return;
    const objective  = (snap && snap.objective)  || null;
    const gait       = (snap && snap.gait)       || null;
    const subjective = (snap && snap.subjective) || null;

    const emptyIcon  = opts.emptyIcon  || '◈';
    const emptyTitle = opts.emptyTitle || 'Assessment not run yet';
    const emptyDesc  = opts.emptyDesc  ||
      'Your coach will run an assessment after your first session — your True Driver, reported symptoms, and coach\'s notes will appear here.';
    const notesFallback = opts.notesFallback ||
      'Your coach will write a brief here after your next session.';

    if (!(objective || gait || subjective)) {
      hostEl.innerHTML = (typeof Dashboard !== 'undefined' && Dashboard.emptyState)
        ? Dashboard.emptyState(emptyIcon, emptyTitle, emptyDesc)
        : `<div class="empty-state" style="padding:24px 8px">
             <span class="empty-icon">${_esc(emptyIcon)}</span>
             <div class="empty-title">${_esc(emptyTitle)}</div>
             <p class="empty-desc">${_esc(emptyDesc)}</p></div>`;
      return;
    }

    // True Driver: objective phase_recommendation → gait worst case → fallback
    const trueDriver = (objective && objective.phase_recommendation)
      || (gait && gait.worst_case_scenario) || '—';

    // Reported Symptoms: subjective external_pain → objective pain_flags → none
    let reported = '—';
    if (subjective && subjective.external_pain) reported = subjective.external_pain;
    else if (objective && Array.isArray(objective.pain_flags) && objective.pain_flags.length) {
      reported = objective.pain_flags.join(', ');
    } else if (objective) reported = 'None reported';

    const coachNotes = (subjective && (subjective.recap_notes || subjective.free_form_notes))
      || notesFallback;

    hostEl.innerHTML = `
      <div class="cd-assessment-row">
        <div class="cd-assessment-label">True Driver</div>
        <div class="cd-assessment-value">${_esc(trueDriver)}</div>
      </div>
      <div class="cd-assessment-row">
        <div class="cd-assessment-label">Reported Symptoms</div>
        <div class="cd-assessment-value">${_esc(reported)}</div>
      </div>
      <div class="cd-assessment-row">
        <div class="cd-assessment-label">Coach's notes</div>
        <div class="cd-assessment-value cd-assessment-notes">${_esc(coachNotes)}</div>
      </div>`;
  }

  // Mount the 3D hologram for a snapshot into hostEl. Returns a lifecycle
  // handle { setState, destroy } — the CALLER owns disposal (e.g. on modal
  // close) to avoid leaking a WebGL context.
  function mountHologram(hostEl, snap, opts = {}) {
    const noop = { setState() {}, destroy() {} };
    if (!hostEl) return noop;
    const Viz = window.LoadVisualizer;
    const profile = (snap && snap.profile)
      || (typeof window.deriveLoadProfile === 'function' ? window.deriveLoadProfile(null) : null);
    if (!Viz || !profile) {
      hostEl.innerHTML = `<div class="cd-placeholder">
        <span class="cd-placeholder-icon">⚠</span>
        <div class="cd-placeholder-sub">3D engine not ready — reload the page.</div></div>`;
      return noop;
    }
    let viz = new Viz(hostEl, profile);
    viz.setState(opts.state === 'B' ? 'B' : 'A');
    return {
      setState(s) { try { viz && viz.setState && viz.setState(s); } catch (e) {} },
      destroy()   { try { viz && viz.destroy && viz.destroy(); } catch (e) {} viz = null; },
    };
  }

  window.AssessmentSnapshot = { loadLatest, renderReport, mountHologram };
})();
