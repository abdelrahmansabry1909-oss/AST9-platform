/* ═══════════════════════════════════════════════════════════════
   NeuCore — Workout Session Tracking
   Public surface (window.WorkoutSession):

   Data layer
     start({ clientId, programId, workoutKey, workoutLabel })  → row
     finish(sessionId, { intensityRating, sessionNotes })       → row
     abandon(sessionId)
     logExercise(sessionId, { exerciseIndex, exerciseName,
                              exerciseId?, sets, notes, completed })
     getActiveSession(clientId)                                 → row|null
     history(clientId, { limit })                               → rows[]
     detail(sessionId)                                          → { session, logs }

   UI layer
     mountWorkouts(host, { programId, workouts })   — client side:
        attaches Start/Finish + per-exercise inputs to every
        [data-workout-tracker-host="<id>"] inside `host`.
     mountCoachView(host)                            — coach Workout
        History page: client dropdown → sessions list → detail panel.

   Write-gate (locked Feature-1 contract):
        every write checks Auth.canWrite(). Read-only when subscription
        is expired / pending / none.
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ── Helpers ─────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function _toast(msg, type = 'info') {
    if (typeof Dashboard !== 'undefined' && Dashboard.toast) Dashboard.toast(msg, type);
    else console.log('[workout]', type, msg);
  }

  function _denyWrite() {
    _toast('Read-only — your subscription is inactive. Contact your coach.', 'warning');
  }

  function _coachOfClient(clientId) {
    if (clientId === Auth.getUser()?.id) {
      return Auth.getProfile()?.assigned_coach || null;
    }
    return null; // server-side resolution unnecessary — coaches inserting
                 // on behalf of a client already pass through their own id.
  }

  function _fmtDuration(seconds) {
    const s = Math.max(0, Math.round(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h) return `${h}h ${String(m).padStart(2,'0')}m`;
    return `${m}:${String(r).padStart(2,'0')}`;
  }

  async function checkStaleSessions() {
    if (typeof sb === 'undefined' || !sb) return;
    try {
      const { data, error } = await sb.rpc('expire_my_stale_workout_sessions');
      if (error) {
        console.warn('[WorkoutSession] Auto-expire check failed:', error.message);
      } else if (data && data > 0) {
        console.log(`[WorkoutSession] Stale sessions auto-expired count: ${data}`);
      }
    } catch (e) {
      console.warn('[WorkoutSession] Fail-soft auto-expire check caught exception:', e);
    }
  }

  // ── 1. DATA LAYER ───────────────────────────────────────────────

  async function start({ clientId, programId = null, workoutKey, workoutLabel = '' }) {
    if (!Auth.canWrite()) { _denyWrite(); throw new Error('subscription_inactive'); }
    if (!clientId || !workoutKey) throw new Error('clientId and workoutKey required');

    // If an active session already exists, return it (resume semantics).
    const existing = await getActiveSession(clientId);
    if (existing && existing.workout_key === workoutKey) return existing;
    if (existing) {
      // Different workout still active — auto-abandon to keep the
      // "one active per client" invariant clean.
      await abandon(existing.id);
    }

    const { data, error } = await sb.from('workout_sessions').insert({
      client_id:     clientId,
      coach_id:      _coachOfClient(clientId),
      program_id:    programId,
      workout_key:   workoutKey,
      workout_label: workoutLabel || null,
      started_at:    new Date().toISOString(),
      status:        'active',
    }).select('*').single();

    if (error) throw new Error(error.message || 'Failed to start workout');
    return data;
  }

  async function finish(sessionId, { intensityRating = null, sessionNotes = null } = {}) {
    if (!Auth.canWrite()) { _denyWrite(); throw new Error('subscription_inactive'); }
    if (!sessionId) throw new Error('sessionId required');

    // Compute duration client-side from the row (simple + accurate enough)
    const { data: cur } = await sb.from('workout_sessions')
      .select('started_at').eq('id', sessionId).maybeSingle();
    const startedMs = cur?.started_at ? Date.parse(cur.started_at) : Date.now();
    const duration  = Math.max(0, Math.round((Date.now() - startedMs) / 1000));

    const { data, error } = await sb.from('workout_sessions').update({
      ended_at:        new Date().toISOString(),
      duration_seconds: duration,
      intensity_rating: intensityRating,
      session_notes:   sessionNotes,
      status:          'completed',
    }).eq('id', sessionId).select('*').single();

    if (error) throw new Error(error.message || 'Failed to finish workout');
    return data;
  }

  async function abandon(sessionId) {
    if (!sessionId) return;
    if (!Auth.canWrite()) { _denyWrite(); return; }
    await sb.from('workout_sessions').update({
      status:   'abandoned',
      ended_at: new Date().toISOString(),
    }).eq('id', sessionId);
  }

  async function logExercise(sessionId, {
    exerciseIndex, exerciseName, exerciseId = null,
    sets = [], notes = null, completed = false,
  } = {}) {
    if (!Auth.canWrite()) { _denyWrite(); throw new Error('subscription_inactive'); }
    if (!sessionId)                throw new Error('sessionId required');
    if (exerciseIndex == null)     throw new Error('exerciseIndex required');
    if (!exerciseName)             throw new Error('exerciseName required');

    const payload = {
      session_id:     sessionId,
      exercise_index: exerciseIndex,
      exercise_name:  exerciseName,
      exercise_id:    exerciseId,
      sets:           Array.isArray(sets) ? sets : [],
      notes,
      completed,
      completed_at:   completed ? new Date().toISOString() : null,
    };

    // Upsert on the (session_id, exercise_index) unique key.
    const { data, error } = await sb.from('workout_exercise_logs')
      .upsert(payload, { onConflict: 'session_id,exercise_index' })
      .select('*').single();
    if (error) throw new Error(error.message || 'Failed to log exercise');
    return data;
  }

  async function getActiveSession(clientId) {
    if (!clientId) return null;
    await checkStaleSessions();
    const { data } = await sb.from('workout_sessions')
      .select('*').eq('client_id', clientId).eq('status', 'active')
      .order('started_at', { ascending: false }).limit(1).maybeSingle();
    return data || null;
  }

  async function history(clientId, { limit = 30 } = {}) {
    if (!clientId) return [];
    const { data, error } = await sb.from('workout_sessions')
      .select('*').eq('client_id', clientId)
      .order('started_at', { ascending: false }).limit(limit);
    if (error) { console.warn('[workout] history:', error.message); return []; }
    return data || [];
  }

  async function detail(sessionId) {
    if (!sessionId) return null;
    const [{ data: session }, { data: logs }] = await Promise.all([
      sb.from('workout_sessions').select('*').eq('id', sessionId).maybeSingle(),
      sb.from('workout_exercise_logs').select('*')
        .eq('session_id', sessionId).order('exercise_index'),
    ]);
    return { session: session || null, logs: logs || [] };
  }

  // ── ANALYTICS — coach progress insights (real data only) ────────
  // Aggregates the client's own workout_sessions + workout_exercise_logs
  // into headline metrics + an 8-week trend. No estimates or placeholders:
  // every number is derived from logged rows; absent data reads as "—".
  async function summary(clientId, { limit = 30 } = {}) {
    const sessions = await history(clientId, { limit });
    const insights = await _buildInsights(sessions);
    return { sessions, insights };
  }

  async function _buildInsights(sessions) {
    const ids = sessions.map((s) => s.id);
    let logs = [];
    if (ids.length) {
      const { data, error } = await sb.from('workout_exercise_logs')
        .select('session_id,sets,completed').in('session_id', ids);
      if (error) console.warn('[workout] insights logs:', error.message);
      logs = data || [];
    }
    return _computeInsights(sessions, logs);
  }

  // Monday-00:00 (local) of the week containing `ms`.
  function _weekStart(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  }

  // Last `weeks` Monday-anchored buckets, oldest→newest. `sessions` counts
  // every started workout; `avgIntensity` averages only completed sessions
  // that carry a finish-of-session rating (null when none that week).
  function _weeklyBuckets(sessions, weeks = 8) {
    const WEEK = 7 * 864e5;
    const thisWeek = _weekStart(Date.now());
    const buckets = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const start = thisWeek - i * WEEK;
      buckets.push({ start, sessions: 0, intSum: 0, intN: 0,
        label: new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) });
    }
    const idxByStart = new Map(buckets.map((b, i) => [b.start, i]));
    sessions.forEach((s) => {
      const i = idxByStart.get(_weekStart(Date.parse(s.started_at)));
      if (i == null) return;
      buckets[i].sessions++;
      if (s.status === 'completed' && s.intensity_rating != null) {
        buckets[i].intSum += s.intensity_rating; buckets[i].intN++;
      }
    });
    return buckets.map((b) => ({ label: b.label, sessions: b.sessions,
      avgIntensity: b.intN ? +(b.intSum / b.intN).toFixed(1) : null }));
  }

  function _computeInsights(sessions, logs) {
    const completed = sessions.filter((s) => s.status === 'completed');
    const started   = completed.length + sessions.filter((s) => s.status === 'abandoned').length;
    const now       = Date.now();
    const last30    = sessions.filter((s) => now - Date.parse(s.started_at) <= 30 * 864e5).length;
    const intens    = completed.map((s) => s.intensity_rating).filter((v) => v != null);
    const durs      = completed.map((s) => s.duration_seconds).filter((v) => v != null && v > 0);

    // Real tonnage from logged sets only — a set contributes to volume
    // solely when both reps and weight were entered.
    let sets = 0, reps = 0, volume = 0;
    logs.forEach((l) => (Array.isArray(l.sets) ? l.sets : []).forEach((st) => {
      sets++;
      if (st.reps != null) reps += Number(st.reps) || 0;
      if (st.reps != null && st.weight != null) volume += (Number(st.reps) || 0) * (Number(st.weight) || 0);
    }));

    const weekly = _weeklyBuckets(sessions, 8);
    const lastMs = sessions.length ? Math.max(...sessions.map((s) => Date.parse(s.started_at))) : null;
    const avg    = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
      totalSessions:  sessions.length,
      completed:      completed.length,
      last30,
      completionRate: started ? Math.round((completed.length / started) * 100) : null,
      activeWeeks:    weekly.filter((w) => w.sessions > 0).length,
      avgIntensity:   intens.length ? +avg(intens).toFixed(1) : null,
      avgDurationMin: durs.length ? Math.round(avg(durs) / 60) : null,
      totalSets:      sets,
      totalReps:      reps,
      totalVolume:    volume > 0 ? Math.round(volume) : null,
      lastActiveMs:   lastMs,
      weekly,
    };
  }

  // ── 2. UI — CLIENT TRACKER (inside My Program) ──────────────────

  // Mounts a Start/Finish + per-exercise log UI into every
  //   [data-workout-tracker-host="<workoutKey>"]
  // node inside `host`. Idempotent — safe to call after re-renders.
  // Feature 5: `libMap` (id → exercises row) is passed from
  // programPublish.renderClientProgram so each exercise row can
  // surface its thumbnail / video / instructions without re-fetching.
  async function mountWorkouts(host, { programId = null, workouts = [], libMap = null } = {}) {
    if (!host) return;
    const clientId = Auth.getUser()?.id;
    if (!clientId) return;

    const active = await getActiveSession(clientId);
    const activeLogs = active ? (await detail(active.id)).logs : [];

    // Fallback: if caller didn't pass a libMap, build one ourselves
    // (covers any future caller that mounts the tracker standalone).
    let resolvedLibMap = libMap;
    if (!resolvedLibMap && typeof ExerciseLibrary !== 'undefined') {
      const linked = new Set();
      workouts.forEach((wk) => ['warmup','main','cooldown'].forEach((k) =>
        (wk[k] || []).forEach((ex) => { if (ex?.exercise_id) linked.add(ex.exercise_id); })));
      if (linked.size) {
        try {
          const all = await ExerciseLibrary.loadAll();
          resolvedLibMap = new Map();
          all.forEach((e) => { if (linked.has(e.id)) resolvedLibMap.set(e.id, e); });
        } catch {}
      }
    }
    resolvedLibMap = resolvedLibMap || new Map();

    workouts.forEach((wk) => {
      const slot = host.querySelector(`[data-workout-tracker-host="${CSS.escape(wk.id)}"]`);
      if (!slot) return;
      _renderTrackerSlot(slot, {
        clientId, programId, workout: wk,
        activeSession: (active && active.workout_key === wk.id) ? active : null,
        activeLogs,
        libMap: resolvedLibMap,
      });
    });
  }

  function _renderTrackerSlot(slot, { clientId, programId, workout, activeSession, activeLogs, libMap = new Map() }) {
    const canWrite = Auth.canWrite();
    const sessionLive = !!activeSession;

    if (!sessionLive) {
      slot.innerHTML = `
        <div class="ws-tracker-cta" style="margin-top:14px;padding:14px;border:1px dashed var(--border-subtle);border-radius:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">Ready to train?</div>
            <div style="font-size:11px;color:var(--text-tertiary)">Start the workout to log sets, reps, weight and a finish-of-session rating.</div>
          </div>
          <button class="btn btn-primary btn-sm" data-action="start" ${canWrite ? '' : 'disabled title="Subscription inactive"'}>
            ▶ Start Workout
          </button>
        </div>`;
      slot.querySelector('[data-action="start"]')?.addEventListener('click', async () => {
        try {
          await start({
            clientId,
            programId,
            workoutKey:   workout.id,
            workoutLabel: workout.label || ('Workout ' + workout.id),
          });
          _toast('Workout started — log your sets as you go.', 'success');
          // Re-render this whole workout's tracker slot.
          const host = slot.closest('[data-program-host]') || document;
          const programWorkouts = host._workouts || [workout];
          mountWorkouts(host, { programId, workouts: programWorkouts });
        } catch (e) {
          if (e.message !== 'subscription_inactive') _toast(e.message, 'error');
        }
      });
      return;
    }

    // Active session — render timer + per-exercise log list + Finish.
    const allExercises = []
      .concat(workout.warmup   || [])
      .concat(workout.main     || [])
      .concat(workout.cooldown || []);

    const logByIndex = new Map();
    activeLogs.forEach((l) => logByIndex.set(l.exercise_index, l));

    slot.innerHTML = `
      <div class="ws-tracker-live" style="margin-top:14px;padding:14px;border:1px solid rgba(20,184,166,.35);border-radius:10px;background:rgba(20,184,166,.05)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--nc-teal,#14b8a6)">In Progress</div>
            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(workout.label || ('Workout ' + workout.id))}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="ws-timer" data-started="${esc(activeSession.started_at)}"
                  style="font-family:var(--font-mono,monospace);font-size:18px;font-weight:700;color:var(--nc-teal,#14b8a6)">0:00</span>
            <button class="btn btn-rose btn-sm" data-action="finish">■ Finish Workout</button>
          </div>
        </div>

        <div class="ws-exercise-list" style="display:flex;flex-direction:column;gap:8px">
          ${allExercises.map((ex, i) => _renderExerciseLogRow(ex, i, logByIndex.get(i),
              ex && ex.exercise_id ? libMap.get(ex.exercise_id) : null)).join('')}
        </div>
      </div>`;

    // Live timer.
    const timerEl = slot.querySelector('.ws-timer');
    if (timerEl) {
      const startedMs = Date.parse(activeSession.started_at);
      const tick = () => {
        timerEl.textContent = _fmtDuration((Date.now() - startedMs) / 1000);
      };
      tick();
      // Use one interval per slot; clear on next render via dataset flag.
      if (slot._wsTimer) clearInterval(slot._wsTimer);
      slot._wsTimer = setInterval(tick, 1000);
    }

    // Wire Finish button → modal then API call.
    slot.querySelector('[data-action="finish"]')?.addEventListener('click', () => {
      _openFinishModal(activeSession.id, () => {
        if (slot._wsTimer) clearInterval(slot._wsTimer);
        const host = slot.closest('[data-program-host]') || document;
        const programWorkouts = host._workouts || [workout];
        mountWorkouts(host, { programId, workouts: programWorkouts });
      });
    });

    // Wire per-exercise inputs.
    slot.querySelectorAll('[data-ex-row]').forEach((row) => {
      const idx = parseInt(row.dataset.exRow, 10);
      const ex  = allExercises[idx];
      _wireExerciseRow(row, activeSession.id, ex, idx, {
        programId,
        workoutKey: workout.id,
        meta: ex && ex.exercise_id ? libMap.get(ex.exercise_id) : null,
      });
    });
  }

  function _renderExerciseLogRow(ex, idx, existing, meta) {
    const sets   = existing?.sets || [];
    const notes  = existing?.notes || '';
    const done   = !!existing?.completed;
    const setRows = Math.max(sets.length, 1);

    // Feature 5 — surfacing fragment: thumbnail + ▶ Preview + ℹ Info
    // Only rendered when `meta` (the resolved exercises library row) is
    // present. Legacy / free-text exercises leave this block empty so
    // their row stays exactly as before.
    const thumbUrl = meta && (meta.thumbnail_url
      || (meta.video_url && typeof ExerciseLibrary?.getThumbnailUrl === 'function'
          ? ExerciseLibrary.getThumbnailUrl(meta.video_url) : null));
    const hasVideo = !!(meta && meta.video_url);
    const hasInstructions = !!(meta && typeof ExerciseInstructions !== 'undefined'
      && ExerciseInstructions.build(meta).hasContent);
    const mediaHTML = meta ? `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        ${thumbUrl
          ? `<img src="${esc(thumbUrl)}" alt="" loading="lazy"
                  data-ws-preview style="width:54px;height:36px;object-fit:cover;border-radius:4px;background:#0f172a;cursor:pointer">`
          : ''}
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${hasVideo ? `<button type="button" class="btn btn-ghost btn-xs" data-ws-preview style="padding:2px 7px;font-size:11px">▶ Preview</button>` : ''}
          ${hasInstructions ? `<button type="button" class="btn btn-ghost btn-xs" data-ws-info style="padding:2px 7px;font-size:11px">ℹ Info</button>` : ''}
        </div>
      </div>
      <div data-ws-inline class="hidden"
           style="margin-bottom:6px;border:1px solid var(--border-subtle);border-radius:6px;overflow:hidden"></div>
      <div data-ws-instr  class="hidden" style="margin-bottom:6px"></div>` : '';

    const setInputs = Array.from({ length: setRows }, (_, i) => {
      const s = sets[i] || {};
      return `
        <div class="ws-set-row" style="display:grid;grid-template-columns:32px 1fr 1fr;gap:6px;align-items:center">
          <span style="font-size:11px;color:var(--text-tertiary);font-weight:600;text-align:center">#${i + 1}</span>
          <input type="number" min="0" step="1" placeholder="reps" value="${s.reps != null ? esc(s.reps) : ''}"
                 data-ws-field="reps" data-ws-set="${i}"
                 class="form-input" style="padding:5px 8px;font-size:12px">
          <input type="number" min="0" step="0.5" placeholder="kg"  value="${s.weight != null ? esc(s.weight) : ''}"
                 data-ws-field="weight" data-ws-set="${i}"
                 class="form-input" style="padding:5px 8px;font-size:12px">
        </div>`;
    }).join('');

    // ── Feature 6 — "🔄 Substituted" badge inside the live tracker
    //    row. Same shape as the My Program badge; tooltip carries the
    //    original exercise name + coach response (Q3 — replacement-only
    //    display, original on hover).
    const subBadge = (ex && ex._substitutedFrom) ? `
      <span title="Originally: ${esc(ex._substitutedFrom)}${ex._substituteResponse ? ' — ' + esc(ex._substituteResponse) : ''}"
            style="display:inline-flex;align-items:center;gap:4px;margin-left:6px;
                   padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600;
                   background:rgba(20,184,166,.14);color:var(--nc-teal,#14b8a6);
                   border:1px solid rgba(20,184,166,.35);cursor:help;vertical-align:1px">
        🔄 Substituted
      </span>` : '';

    return `
      <div class="ws-ex-row" data-ex-row="${idx}"
           style="padding:10px;border:1px solid var(--border-subtle);border-radius:8px;background:rgba(255,255,255,.02);${done ? 'opacity:.75' : ''}">
        ${mediaHTML}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">
          <div style="flex:1;min-width:140px">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(ex.name || 'Exercise')}${subBadge}</div>
            ${ex.sets || ex.reps ? `<div style="font-size:11px;color:var(--text-tertiary)">Target: ${esc(ex.sets || '?')} × ${esc(ex.reps || '?')}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button type="button" data-ws-alt-request title="Request alternative"
                    style="background:transparent;border:1px solid var(--border-subtle);
                           color:var(--text-secondary);font-size:11px;padding:3px 8px;
                           border-radius:6px;cursor:pointer">⇄ Alt</button>
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);cursor:pointer">
              <input type="checkbox" data-ws-completed ${done ? 'checked' : ''}>
              Done
            </label>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:6px">
          ${setInputs}
          <button type="button" data-ws-add-set
                  style="align-self:flex-start;font-size:11px;color:var(--nc-teal,#14b8a6);background:transparent;border:0;cursor:pointer;padding:2px 0">
            + Add set
          </button>
        </div>

        <input type="text" data-ws-notes placeholder="Notes (e.g. felt strong, knee twinge…)"
               value="${esc(notes)}" class="form-input"
               style="padding:5px 8px;font-size:12px;width:100%">
      </div>`;
  }

  function _wireExerciseRow(row, sessionId, ex, idx, ctx = {}) {
    let saveTimer = null;
    const persist = () => {
      // Collect set rows.
      const setEls   = row.querySelectorAll('.ws-set-row');
      const sets     = Array.from(setEls).map((srow, i) => {
        const reps   = srow.querySelector('[data-ws-field="reps"]').value;
        const weight = srow.querySelector('[data-ws-field="weight"]').value;
        if (reps === '' && weight === '') return null;
        return {
          n:      i + 1,
          reps:   reps   === '' ? null : Number(reps),
          weight: weight === '' ? null : Number(weight),
        };
      }).filter(Boolean);
      const notes     = row.querySelector('[data-ws-notes]').value;
      const completed = row.querySelector('[data-ws-completed]').checked;

      logExercise(sessionId, {
        exerciseIndex: idx,
        exerciseName:  ex.name || `Exercise ${idx + 1}`,
        exerciseId:    ex.exercise_id || null,    // Feature 5 — thread to log row
        sets, notes, completed,
      }).catch((e) => {
        if (e.message !== 'subscription_inactive') console.warn('[workout] log err:', e.message);
      });
      row.style.opacity = completed ? .75 : 1;
    };

    // Feature 5 — per-row Preview (inline expand OR modal) + Info.
    const meta = ctx.meta;
    row.querySelectorAll('[data-ws-preview]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (!meta || !meta.video_url) return;
        const id  = meta.id;
        const nm  = meta.name;
        const url = meta.video_url;
        // Shift-click OR narrow screens go to the fullscreen modal.
        if (e.shiftKey || window.innerWidth < 640) {
          if (typeof ExerciseUI !== 'undefined') ExerciseUI.openVideoModal(id, nm, url);
          return;
        }
        const inline = row.querySelector('[data-ws-inline]');
        if (!inline) return;
        if (!inline.classList.contains('hidden')) {
          inline.classList.add('hidden'); inline.innerHTML = '';
          return;
        }
        const embed = (typeof ExerciseLibrary?.getEmbedUrl === 'function')
          ? ExerciseLibrary.getEmbedUrl(url) : url;
        inline.innerHTML = `
          <div style="position:relative;width:100%;padding-top:56.25%;background:#000">
            <iframe src="${esc(embed || '')}" allowfullscreen
              style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe>
            <button type="button" data-ws-inline-close
                    style="position:absolute;top:5px;right:6px;background:rgba(0,0,0,.6);color:#fff;
                           border:0;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer">✕</button>
            <button type="button" data-ws-open-modal
                    style="position:absolute;bottom:5px;right:6px;background:rgba(20,184,166,.85);color:#fff;
                           border:0;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer">⛶ Fullscreen</button>
          </div>`;
        inline.classList.remove('hidden');
        inline.querySelector('[data-ws-inline-close]').onclick = () => {
          inline.classList.add('hidden'); inline.innerHTML = '';
        };
        inline.querySelector('[data-ws-open-modal]').onclick = (ev) => {
          ev.stopPropagation();
          if (typeof ExerciseUI !== 'undefined') ExerciseUI.openVideoModal(id, nm, url);
        };
      });
    });
    row.querySelector('[data-ws-info]')?.addEventListener('click', () => {
      if (!meta) return;
      const slot = row.querySelector('[data-ws-instr]');
      if (!slot) return;
      if (!slot.classList.contains('hidden')) {
        slot.classList.add('hidden'); slot.innerHTML = '';
        return;
      }
      if (typeof ExerciseInstructions === 'undefined') return;
      slot.innerHTML = ExerciseInstructions.renderFull(meta);
      slot.classList.remove('hidden');
    });
    const debounce = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 600);
    };

    row.querySelectorAll('input').forEach((i) => i.addEventListener('input',  debounce));
    row.querySelector('[data-ws-completed]')?.addEventListener('change',      persist);

    // ⇄ Alt button → AltExercise.openModal
    row.querySelector('[data-ws-alt-request]')?.addEventListener('click', () => {
      if (typeof AltExercise === 'undefined') {
        _toast('Alt-exercise module not loaded', 'error'); return;
      }
      AltExercise.openModal({
        programId:      ctx.programId || null,
        workoutKey:     ctx.workoutKey || '',
        exerciseIndex:  idx,
        exerciseName:   ex.name || `Exercise ${idx + 1}`,
        exerciseId:     ex.exercise_id || null,
      });
    });

    row.querySelector('[data-ws-add-set]')?.addEventListener('click', () => {
      const list = row.querySelector('.ws-set-row')?.parentElement;
      if (!list) return;
      const i = row.querySelectorAll('.ws-set-row').length;
      const div = document.createElement('div');
      div.className = 'ws-set-row';
      div.style.cssText = 'display:grid;grid-template-columns:32px 1fr 1fr;gap:6px;align-items:center';
      div.innerHTML = `
        <span style="font-size:11px;color:var(--text-tertiary);font-weight:600;text-align:center">#${i + 1}</span>
        <input type="number" min="0" step="1"  placeholder="reps" data-ws-field="reps"   data-ws-set="${i}" class="form-input" style="padding:5px 8px;font-size:12px">
        <input type="number" min="0" step="0.5" placeholder="kg"  data-ws-field="weight" data-ws-set="${i}" class="form-input" style="padding:5px 8px;font-size:12px">`;
      list.insertBefore(div, row.querySelector('[data-ws-add-set]'));
      div.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', debounce));
    });
  }

  // ── Finish modal ────────────────────────────────────────────────
  function _openFinishModal(sessionId, onClosed) {
    let modal = document.getElementById('modal-finish-workout');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-finish-workout';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:440px">
          <div class="modal-header">
            <h3>Finish Workout</h3>
            <button class="btn-icon" data-action="close">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Intensity Rating — <span id="fw-int-val">7</span>/10</label>
              <input type="range" id="fw-intensity" min="1" max="10" step="1" value="7" style="width:100%">
              <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-tertiary);margin-top:2px">
                <span>Easy</span><span>Maximal</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Workout Notes (optional)</label>
              <textarea id="fw-notes" class="form-input" style="min-height:80px"
                placeholder="How did it feel? Any pain, fatigue, breakthroughs?"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="confirm">Finish &amp; Save</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('#fw-intensity').addEventListener('input', (e) => {
        modal.querySelector('#fw-int-val').textContent = e.target.value;
      });
    }
    modal.classList.remove('hidden');
    // Reset values per open.
    modal.querySelector('#fw-intensity').value = 7;
    modal.querySelector('#fw-int-val').textContent = 7;
    modal.querySelector('#fw-notes').value = '';

    const close = () => modal.classList.add('hidden');
    modal.querySelectorAll('[data-action="close"]').forEach((b) => b.onclick = close);
    modal.querySelector('[data-action="confirm"]').onclick = async () => {
      const intensity = parseInt(modal.querySelector('#fw-intensity').value, 10);
      const notes     = modal.querySelector('#fw-notes').value.trim() || null;
      try {
        await finish(sessionId, { intensityRating: intensity, sessionNotes: notes });
        _toast('Workout saved.', 'success');
        close();
        if (typeof onClosed === 'function') onClosed();
      } catch (e) {
        if (e.message !== 'subscription_inactive') _toast(e.message, 'error');
      }
    };
  }

  // ── Insights render (reuses the existing .stat-card design system) ──
  function _agoLabel(ms) {
    if (ms == null) return '—';
    const days = Math.floor((Date.now() - ms) / 864e5);
    if (days <= 0) return 'Today';
    if (days === 1) return '1d ago';
    if (days < 7) return days + 'd ago';
    return Math.floor(days / 7) + 'w ago';
  }

  function _fmtKg(v) {
    return v >= 1000 ? (v / 1000).toFixed(1) + 'k kg' : v + ' kg';
  }

  function _statTile(label, value, sub, colorVar) {
    return `
      <div class="stat-card" style="padding:16px;--stat-color:${colorVar}">
        <div class="stat-card-bg"></div>
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-value" style="font-size:30px">${esc(value)}</div>
        <div class="stat-sub">${esc(sub)}</div>
      </div>`;
  }

  function _insightsHTML(m) {
    const tiles = [
      _statTile('Sessions',        m.totalSessions,                                       `${m.completed} completed · ${m.last30} in 30d`, 'var(--lime)'),
      _statTile('Completion',      m.completionRate == null ? '—' : m.completionRate + '%', 'of started workouts',                          'var(--teal)'),
      _statTile('Active weeks',    m.activeWeeks + '/8',                                  'trained in last 8 wks',                         'var(--teal)'),
      _statTile('Avg intensity',   m.avgIntensity == null ? '—' : m.avgIntensity + '/10', m.avgDurationMin ? `${m.avgDurationMin} min avg session` : 'completed sessions', 'var(--amber)'),
      _statTile('Training volume', m.totalVolume == null ? '—' : _fmtKg(m.totalVolume),  `${m.totalSets} sets · ${m.totalReps} reps`,     'var(--lime)'),
      _statTile('Last active',     _agoLabel(m.lastActiveMs),                            m.lastActiveMs ? new Date(m.lastActiveMs).toLocaleDateString() : 'no sessions', 'var(--rose)'),
    ].join('');
    const hasTrend = m.weekly.some((w) => w.sessions > 0);
    return `
      <div style="margin-bottom:18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:10px">Progress insights</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:12px">${tiles}</div>
        ${hasTrend ? `
          <div class="card" style="margin-top:14px">
            <div class="card-header"><span class="card-title">Weekly training — last 8 weeks</span></div>
            <div class="chart-container" style="height:200px"><canvas id="ws-weekly-chart"></canvas></div>
          </div>` : ''}
      </div>`;
  }

  // ── 3. UI — COACH WORKOUT HISTORY VIEW ──────────────────────────
  async function mountCoachView(host, { preselectClientId = null } = {}) {
    if (!host) return;
    host.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <div class="card-header">
          <span class="card-title">Workout History</span>
          <select id="ws-client-select" class="form-input" style="max-width:280px">
            <option value="">— Select Client —</option>
          </select>
        </div>
        <div id="ws-sessions-host" style="margin-top:8px">
          <div class="empty-state" style="padding:32px">
            <span class="empty-icon">◌</span>
            <div class="empty-title">Pick a client</div>
            <p class="empty-desc">Choose a client to see their workout sessions.</p>
          </div>
        </div>
      </div>
      <div id="ws-detail-host"></div>`;

    const sel = host.querySelector('#ws-client-select');
    // Populate clients dropdown (scoped to the coach).
    let q = sb.from('profiles').select('id, full_name, email').eq('role', 'client').order('full_name');
    if (Auth.isCoach()) q = q.eq('assigned_coach', Auth.getUser()?.id);
    const { data: clients } = await q;
    (clients || []).forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.full_name || c.email;
      sel.appendChild(opt);
    });

    sel.addEventListener('change', () => _renderSessionsList(host, sel.value));
    if (preselectClientId) {
      sel.value = preselectClientId;
      _renderSessionsList(host, preselectClientId);
    }
  }

  async function _renderSessionsList(host, clientId) {
    const list   = host.querySelector('#ws-sessions-host');
    const detail = host.querySelector('#ws-detail-host');
    detail.innerHTML = '';
    if (!clientId) {
      list.innerHTML = `<div class="empty-state" style="padding:24px"><span class="empty-icon">◌</span><div class="empty-title">Pick a client</div></div>`;
      return;
    }
    list.innerHTML = `<div style="text-align:center;padding:24px"><span class="spinner"></span></div>`;
    const { sessions: rows, insights } = await summary(clientId, { limit: 30 });
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state" style="padding:24px"><span class="empty-icon">◌</span><div class="empty-title">No workouts logged yet</div><p class="empty-desc">Sessions show up here as the client starts and finishes workouts.</p></div>`;
      return;
    }

    list.innerHTML = _insightsHTML(insights) + `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:1px">
          <th style="padding:8px 4px">When</th>
          <th style="padding:8px 4px">Workout</th>
          <th style="padding:8px 4px">Status</th>
          <th style="padding:8px 4px">Duration</th>
          <th style="padding:8px 4px">Intensity</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => {
            const when = new Date(r.started_at).toLocaleString();
            const dur  = r.duration_seconds ? _fmtDuration(r.duration_seconds) : '—';
            const intensity = r.intensity_rating != null ? `${r.intensity_rating}/10` : '—';
            const statusBadge = r.status === 'completed'
              ? `<span class="badge badge-active badge-dot">Completed</span>`
              : r.status === 'active'
              ? `<span class="badge badge-pending badge-dot">In progress</span>`
              : r.end_reason === 'auto_finished_2h'
              ? `<span class="badge badge-expired" style="background:rgba(239,68,68,0.08);color:#f87171;border:1px solid rgba(239,68,68,0.2)">Auto-finished after 2h</span>`
              : `<span class="badge badge-expired">Abandoned</span>`;
            return `
              <tr style="border-top:1px solid var(--border-subtle)">
                <td style="padding:10px 4px">${esc(when)}</td>
                <td style="padding:10px 4px">${esc(r.workout_label || ('Workout ' + r.workout_key))}</td>
                <td style="padding:10px 4px">${statusBadge}</td>
                <td style="padding:10px 4px">${dur}</td>
                <td style="padding:10px 4px">${intensity}</td>
                <td style="padding:10px 4px;text-align:right">
                  <button class="btn btn-ghost btn-xs" data-ws-open="${r.id}">View →</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    // Render the 8-week trend once the canvas is in the DOM (graceful skip
    // if Chart.js / the Charts module isn't available).
    if (typeof Charts !== 'undefined' && Charts.renderWorkoutWeekly) {
      Charts.renderWorkoutWeekly(insights.weekly, 'ws-weekly-chart');
    }

    list.querySelectorAll('[data-ws-open]').forEach((b) => {
      b.addEventListener('click', () => _renderDetail(host, b.dataset.wsOpen));
    });
  }

  async function _renderDetail(host, sessionId) {
    const det = host.querySelector('#ws-detail-host');
    det.innerHTML = `<div class="card"><div style="text-align:center;padding:24px"><span class="spinner"></span></div></div>`;
    const { session, logs } = await detail(sessionId);
    if (!session) { det.innerHTML = ''; return; }
    const when = new Date(session.started_at).toLocaleString();
    const dur  = session.duration_seconds ? _fmtDuration(session.duration_seconds) : '—';
    det.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${esc(session.workout_label || ('Workout ' + session.workout_key))}</span>
          <span style="font-size:11px;color:var(--text-tertiary)">${esc(when)} · ${dur} · intensity ${session.intensity_rating ?? '—'}/10</span>
        </div>
        ${session.end_reason === 'auto_finished_2h' ? `
          <div style="margin: 0 16px 12px 16px; padding:10px 12px; border-radius:8px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); font-size:12.5px; color:#f87171;">
            ℹ️ This workout was auto-finished after 2 hours of inactivity.
          </div>
        ` : ''}
        ${session.session_notes ? `<div class="form-hint" style="margin-bottom:12px"><b>Notes:</b> ${esc(session.session_notes)}</div>` : ''}
        ${logs.length ? `
          <div style="display:flex;flex-direction:column;gap:10px">
            ${logs.map((l) => `
              <div style="padding:10px;border:1px solid var(--border-subtle);border-radius:8px;background:rgba(255,255,255,.02)">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                  <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(l.exercise_name)}</div>
                  ${l.completed ? '<span class="badge badge-active">✓ Done</span>' : ''}
                </div>
                ${l.sets?.length ? `
                  <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">
                    ${l.sets.map((s) => `Set ${s.n}: ${s.reps ?? '–'} reps${s.weight != null ? ' @ ' + s.weight + ' kg' : ''}`).join(' · ')}
                  </div>` : ''}
                ${l.notes ? `<div style="font-size:11px;color:var(--text-tertiary);font-style:italic">${esc(l.notes)}</div>` : ''}
              </div>`).join('')}
          </div>`
          : '<div class="form-hint">No exercises logged for this session.</div>'}
      </div>`;
  }

  // ── Public surface ──────────────────────────────────────────────
  window.WorkoutSession = {
    // Data layer
    start, finish, abandon, logExercise,
    getActiveSession, history, detail, summary, checkStaleSessions,
    // UI mount points
    mountWorkouts, mountCoachView,
    // Helpers (exposed for tests / dashboards)
    _fmtDuration,
  };
})();
