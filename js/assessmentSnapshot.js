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

  window.AssessmentSnapshot = { loadLatest };
})();
