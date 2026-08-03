/* ═══════════════════════════════════════════════════════════════
   NeuCore RPM — Graph Data Layer
   Phase 3D · Cite: docs/rehab-book/o-sullivan-graded-exposure-ladder.md
   Pure CRUD over rpm_graphs / rpm_phases / rpm_phase_exercises.
   No DOM. UI modules (graph-builder.js, graph-viewer.js) consume this.

   Public API (window.RPMGraph):
     listForCoach(coachId)               → graph rows
     listForClient(clientId)             → published graphs only
     getActiveForClient(clientId)        → most recent published graph + phases
     create({ clientId, coachId, ... }) → new draft graph
     update(graphId, patch)              → partial update on rpm_graphs
     load(graphId)                       → graph + ordered phases + exercises
     savePhase(graphId, phase)           → upsert single phase
     savePhases(graphId, phases[])       → bulk upsert
     deletePhase(phaseId)
     setPhaseExercises(phaseId, exs[])   → replace exercise set for a phase
     publish(graphId)                    → flips status to 'published', sets first phase active
     archive(graphId)                    → status='archived'
     submitMilestone(graphId, phaseId, note?)  → INSERT into phase_submissions
     markExerciseDone(phaseExerciseId, done?)  → toggle client_completed
     pullSubjectiveSummary(clientId)     → returns latest subjective row
     pullObjectiveSummary(clientId)      → returns latest objective row + composite_score
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── Default stage seed (used as deterministic fallback when AI is unavailable) ──
  // Cite: o-sullivan-graded-exposure-ladder.md §1.1 Stage 1..5
  const DEFAULT_STAGES = [
    { stage_name: 'Bed-Based Entry',     load_tolerance: 'Submaximal',  cue_mode: 'top_down', tripwire_test: 'Midfoot bridge hold (30s)' },
    { stage_name: 'Standing Loading',    load_tolerance: 'Gravity',     cue_mode: 'top_down', tripwire_test: 'Single-leg balance (30s eyes open)' },
    { stage_name: 'Bridging the Gap',    load_tolerance: 'Gravity',     cue_mode: 'mixed',    tripwire_test: 'Hop and stick (3 reps, no pain)' },
    { stage_name: 'High-Load / Bottom-Up', load_tolerance: 'Impact',    cue_mode: 'bottom_up', tripwire_test: 'Continuous hopping (10s, no breakdown)' },
    { stage_name: 'Resilience',          load_tolerance: 'External',    cue_mode: 'bottom_up', tripwire_test: 'Sport-specific drill at full intent' },
  ];

  function _sb() {
    if (typeof sb === 'undefined' || !sb) throw new Error('Supabase client not loaded');
    return sb;
  }

  // ───────────────────────────────────────────────────────────
  // Read — listings
  // ───────────────────────────────────────────────────────────
  async function listForCoach(coachId) {
    const { data, error } = await _sb()
      .from('rpm_graphs')
      .select('id, client_id, point_a_summary, point_b_dream, phase_count, status, ai_generated, composite_score, published_at, created_at, updated_at')
      .eq('coach_id', coachId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function listForClient(clientId) {
    const { data, error } = await _sb()
      .from('rpm_graphs')
      .select('id, point_a_summary, point_b_dream, phase_count, status, published_at, updated_at')
      .eq('client_id', clientId)
      .eq('status', 'published')
      .order('published_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function getActiveForClient(clientId) {
    const list = await listForClient(clientId);
    if (!list.length) return null;
    return load(list[0].id);
  }

  // ───────────────────────────────────────────────────────────
  // Read — full graph (graph + ordered phases + exercises)
  // ───────────────────────────────────────────────────────────
  async function load(graphId) {
    const sbc = _sb();
    const [{ data: graph, error: ge }, { data: phases, error: pe }, { data: phEx, error: ee }] = await Promise.all([
      sbc.from('rpm_graphs').select('*').eq('id', graphId).single(),
      sbc.from('rpm_phases').select('*').eq('graph_id', graphId).order('phase_index', { ascending: true }),
      sbc.from('rpm_phase_exercises')
        .select('id, phase_id, exercise_id, prescription, display_order, ai_generated, client_completed, client_completed_at, exercises(id, name, category, phase, video_url, thumbnail_url, cues, target_joints)')
        .order('display_order', { ascending: true }),
    ]);
    if (ge) throw ge;
    if (pe) throw pe;
    if (ee) throw ee;

    // Group exercises by phase
    const byPhase = new Map();
    (phEx || []).forEach(ex => {
      if (!byPhase.has(ex.phase_id)) byPhase.set(ex.phase_id, []);
      byPhase.get(ex.phase_id).push(ex);
    });
    const phasesWithEx = (phases || []).map(p => ({
      ...p,
      exercises: byPhase.get(p.id) || [],
    }));

    return { graph, phases: phasesWithEx };
  }

  // ───────────────────────────────────────────────────────────
  // Write — graph
  // ───────────────────────────────────────────────────────────
  async function create({ clientId, coachId, point_a_summary, point_b_dream, phase_count, subjective_id, objective_id, composite_score }) {
    const insert = await _sb()
      .from('rpm_graphs')
      .insert({
        client_id:        clientId,
        coach_id:         coachId,
        point_a_summary:  point_a_summary || null,
        point_b_dream:    point_b_dream || null,
        phase_count:      phase_count || 5,
        subjective_id:    subjective_id || null,
        objective_id:     objective_id || null,
        composite_score:  composite_score ?? null,
        status:           'draft',
      })
      .select()
      .single();
    if (insert.error) throw insert.error;
    return insert.data;
  }

  async function update(graphId, patch) {
    const allowed = ['point_a_summary','point_b_dream','inversion_question','phase_count','status','ai_generated','composite_score','subjective_id','objective_id'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    clean.updated_at = new Date().toISOString();
    const { data, error } = await _sb()
      .from('rpm_graphs')
      .update(clean)
      .eq('id', graphId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ───────────────────────────────────────────────────────────
  // Write — phases
  // ───────────────────────────────────────────────────────────
  async function savePhase(graphId, phase) {
    const row = {
      graph_id:        graphId,
      phase_index:     phase.phase_index,
      stage_name:      phase.stage_name,
      milestone_label: phase.milestone_label || null,
      duration_weeks:  (phase.duration_weeks != null && Number(phase.duration_weeks) > 0) ? Number(phase.duration_weeks) : null,
      emotional_win:   phase.emotional_win || null,
      tripwire_test:   phase.tripwire_test || null,
      load_tolerance:  phase.load_tolerance || null,
      cue_mode:        phase.cue_mode || 'top_down',
      target_regions:  Array.isArray(phase.target_regions) ? phase.target_regions : [],
      ai_generated:    !!phase.ai_generated,
    };
    if (phase.id) {
      const { data, error } = await _sb()
        .from('rpm_phases')
        .update(row)
        .eq('id', phase.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await _sb()
        .from('rpm_phases')
        .upsert(row, { onConflict: 'graph_id,phase_index' })
        .select()
        .single();
    if (error) throw error;
    return data;
  }

  async function savePhases(graphId, phases) {
    // Delete any existing phases for this graph then bulk insert in order.
    const sbc = _sb();
    const del = await sbc.from('rpm_phases').delete().eq('graph_id', graphId);
    if (del.error) throw del.error;
    const rows = phases.map((p, i) => ({
      graph_id:        graphId,
      phase_index:     p.phase_index ?? (i + 1),
      stage_name:      p.stage_name,
      milestone_label: p.milestone_label || null,
      duration_weeks:  (p.duration_weeks != null && Number(p.duration_weeks) > 0) ? Number(p.duration_weeks) : null,
      emotional_win:   p.emotional_win || null,
      tripwire_test:   p.tripwire_test || null,
      load_tolerance:  p.load_tolerance || null,
      cue_mode:        p.cue_mode || 'top_down',
      target_regions:  Array.isArray(p.target_regions) ? p.target_regions : [],
      ai_generated:    !!p.ai_generated,
      status:          i === 0 ? 'locked' : 'locked',
    }));
    if (!rows.length) return [];
    const { data, error } = await sbc.from('rpm_phases').insert(rows).select();
    if (error) throw error;
    return data || [];
  }

  async function deletePhase(phaseId) {
    const { error } = await _sb().from('rpm_phases').delete().eq('id', phaseId);
    if (error) throw error;
    return true;
  }

  // ───────────────────────────────────────────────────────────
  // Write — phase exercises
  // ───────────────────────────────────────────────────────────
  async function setPhaseExercises(phaseId, exs) {
    // Replace strategy: delete then insert (small N per phase, simpler than diff)
    const sbc = _sb();
    const del = await sbc.from('rpm_phase_exercises').delete().eq('phase_id', phaseId);
    if (del.error) throw del.error;
    if (!exs.length) return [];
    const rows = exs.map((ex, i) => ({
      phase_id:      phaseId,
      exercise_id:   ex.exercise_id,
      prescription:  ex.prescription || {},
      display_order: ex.display_order ?? i,
      ai_generated:  !!ex.ai_generated,
    }));
    const { data, error } = await sbc.from('rpm_phase_exercises').insert(rows).select();
    if (error) throw error;
    return data || [];
  }

  async function markExerciseDone(phaseExerciseId, done = true) {
    const patch = {
      client_completed:    done,
      client_completed_at: done ? new Date().toISOString() : null,
    };
    const { data, error } = await _sb()
      .from('rpm_phase_exercises')
      .update(patch)
      .eq('id', phaseExerciseId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ───────────────────────────────────────────────────────────
  // Publish + lifecycle
  // ───────────────────────────────────────────────────────────
  async function publish(graphId) {
    const sbc = _sb();
    // Flip graph status, mark first phase active
    const upd = await sbc
      .from('rpm_graphs')
      .update({ status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', graphId);
    if (upd.error) throw upd.error;

    // Get the first phase and set it active
    const { data: phases, error: pe } = await sbc
      .from('rpm_phases')
      .select('id, phase_index')
      .eq('graph_id', graphId)
      .order('phase_index', { ascending: true })
      .limit(1);
    if (pe) throw pe;
    if (phases?.length) {
      const { error } = await sbc
        .from('rpm_phases')
        .update({ status: 'active', unlocked_at: new Date().toISOString() })
        .eq('id', phases[0].id);
      if (error) throw error;
    }
    return true;
  }

  async function archive(graphId) {
    const { error } = await _sb()
      .from('rpm_graphs')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', graphId);
    if (error) throw error;
    return true;
  }

  // ───────────────────────────────────────────────────────────
  // Submissions (Phase 4 will consume these — wired here for completeness)
  // ───────────────────────────────────────────────────────────
  async function submitMilestone(graphId, phaseId, note) {
    const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    const { data, error } = await _sb()
      .from('phase_submissions')
      .insert({
        graph_id:    graphId,
        phase_id:    phaseId,
        client_id:   user?.id ?? null,
        client_note: note || null,
        status:      'pending',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ───────────────────────────────────────────────────────────
  // Context pulls — feed AI prompt context
  // ───────────────────────────────────────────────────────────
  async function pullSubjectiveSummary(clientId) {
    const { data, error } = await _sb()
      .from('subjective_assessments')
      .select('id, mode, status, dream_outcome, life_impact, external_pain, mechanism_of_injury, aggravating_factors, easing_factors, confidence_score, importance_score, fast_start_opportunity, red_flag_screen, yellow_flags, recap_notes, free_form_notes, updated_at')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function pullObjectiveSummary(clientId) {
    const { data, error } = await _sb()
      .from('rehab_objective_assessments')
      .select('id, rom_score, control_score, force_score, neurology_score, composite_score, phase_recommendation, pain_flags, asymmetry_flags, gait_flags, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  // ───────────────────────────────────────────────────────────
  // Phase 5D — progressive per-phase chat
  // ───────────────────────────────────────────────────────────
  async function listMessages(graphId, phaseId) {
    let q = _sb().from('rpm_phase_messages')
      .select('id, graph_id, phase_id, author_id, author_role, body, created_at')
      .eq('graph_id', graphId)
      .order('created_at', { ascending: true });
    if (phaseId) q = q.eq('phase_id', phaseId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function postMessage(graphId, phaseId, body) {
    const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    let role = 'client';
    try { role = Auth.getRole?.() || 'client'; } catch {}
    const { data, error } = await _sb()
      .from('rpm_phase_messages')
      .insert({
        graph_id:    graphId,
        phase_id:    phaseId || null,
        author_id:   user?.id ?? null,
        author_role: ['coach','client','admin'].includes(role) ? role : 'client',
        body:        String(body || '').trim(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ───────────────────────────────────────────────────────────
  // Phase 5B — body region vocabulary (drives phase-aware coloring)
  // ───────────────────────────────────────────────────────────
  const BODY_REGIONS = [
    { key: 'CervicalSpine',  label: 'Cervical Spine' },
    { key: 'ThoracicSpine',  label: 'Thoracic Spine' },
    { key: 'LumbarSpine',    label: 'Lumbar Spine' },
    { key: 'Pelvis',         label: 'Pelvis' },
    { key: 'LeftShoulder',   label: 'L Shoulder' },
    { key: 'RightShoulder',  label: 'R Shoulder' },
    { key: 'LeftElbow',      label: 'L Elbow' },
    { key: 'RightElbow',     label: 'R Elbow' },
    { key: 'LeftWrist',      label: 'L Wrist' },
    { key: 'RightWrist',     label: 'R Wrist' },
    { key: 'LeftHip',        label: 'L Hip' },
    { key: 'RightHip',       label: 'R Hip' },
    { key: 'LeftKnee',       label: 'L Knee' },
    { key: 'RightKnee',      label: 'R Knee' },
    { key: 'LeftAnkle',      label: 'L Ankle' },
    { key: 'RightAnkle',     label: 'R Ankle' },
  ];

  // ───────────────────────────────────────────────────────────
  // Default stages (deterministic fallback for when AI is unavailable)
  // ───────────────────────────────────────────────────────────
  function defaultStages(n = 5) {
    // Pick n stages, evenly distributing the 5 default stages across n slots
    if (n === 5) return DEFAULT_STAGES.map((s, i) => ({ ...s, phase_index: i + 1 }));
    if (n < 5) {
      // Drop middle stages first
      const indexes = n === 3 ? [0, 2, 4] : [0, 1, 3, 4];
      return indexes.map((idx, i) => ({ ...DEFAULT_STAGES[idx], phase_index: i + 1 }));
    }
    // n > 5 — duplicate "Bridging the Gap" or "High-Load" with a sub-label
    const out = DEFAULT_STAGES.slice();
    const extras = n - 5;
    for (let i = 0; i < extras; i++) {
      const base = DEFAULT_STAGES[2]; // Bridging
      out.splice(3 + i, 0, { ...base, stage_name: `${base.stage_name} ${i + 2}` });
    }
    return out.slice(0, n).map((s, i) => ({ ...s, phase_index: i + 1 }));
  }

  // ───────────────────────────────────────────────────────────
  // Expose
  // ───────────────────────────────────────────────────────────
  window.RPMGraph = {
    // Read
    listForCoach, listForClient, getActiveForClient, load,
    pullSubjectiveSummary, pullObjectiveSummary,
    // Write — graph
    create, update,
    // Write — phases
    savePhase, savePhases, deletePhase,
    // Write — exercises
    setPhaseExercises, markExerciseDone,
    // Lifecycle
    publish, archive, submitMilestone,
    // Phase 5D — chat
    listMessages, postMessage,
    // Helpers
    defaultStages,
    DEFAULT_STAGES,
    BODY_REGIONS,
  };
})();
