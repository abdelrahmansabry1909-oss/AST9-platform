/* ═══════════════════════════════════════════════════════════════
   CLIENT PROGRAM — day-based workout experience (CX1)

   Replaces the old stacked "My Program" render with a calm, mobile-first
   master → detail → execution flow:

     Overview   — one card per scheduled day (workout title · exercise count
                  · estimated duration · word-status). Low density, scannable.
     Day detail — title, short description, estimated duration, Start Workout,
                  and compact exercise cards grouped Warm Up / Main / Cool Down
                  (name/sets/reps/rest visible; notes / cues / media /
                  alternatives behind "Show details"). Long sessions collapse
                  warm-up + cool-down by default.
     Execution  — guided, ONE exercise at a time (Exercise N of M + progress,
                  media, set logging, Previous / Next, finish step). The whole
                  workout is never shown during execution.

   Reuse-first, presentation-layer only — no backend changes:
     • ProgramPublish.resolveClientProgram()  — program data + F5 libMap + F6 subs
     • WorkoutSession.{start,logExercise,finish,getActiveSession,detail,history}
       — the locked F2 data layer. F2 is NOT modified. mountWorkouts() renders
       the full list, so it is intentionally NOT used here (execution is
       step-by-step); we drive the same data layer directly instead.
     • ExerciseLibrary / ExerciseInstructions / ExerciseUI — F5 media
     • AltExercise.openModal — F6 substitution request
     • ClientUtil + the --nc-* tokens — shared client styling / state helpers

   exercise_index uses the SAME warm-up→main→cool-down flatten order as
   WorkoutSession.mountWorkouts, so logs / resume / coach history stay
   consistent across the app.

   Client-only. Mounted from ClientTrain ("Your training plan").
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const esc = (s) => ClientUtil.esc(s);
  const _toast = (m, t) => { if (typeof Dashboard !== 'undefined' && Dashboard.toast) Dashboard.toast(m, t); };
  const _canWrite = () => (typeof Auth !== 'undefined' && Auth.canWrite) ? Auth.canWrite() : true;

  // ── Status vocabulary (words, never percentages) ──
  const STATUS = {
    completed:   { label: 'Completed',       fg: '#14B8A6', bg: 'rgba(20,184,166,.14)',  bd: 'rgba(20,184,166,.35)', dot: '✓' },
    in_progress: { label: 'In Progress',     fg: '#F59E0B', bg: 'rgba(245,158,11,.14)',  bd: 'rgba(245,158,11,.35)', dot: '●' },
    today:       { label: "Today's Session", fg: '#052e2b', bg: '#14B8A6',               bd: '#14B8A6',              dot: '→' },
    upcoming:    { label: 'Upcoming',        fg: '#94A3B8', bg: 'rgba(148,163,184,.10)', bd: 'rgba(148,163,184,.22)', dot: '·' },
  };
  const GROUP = {
    warmup:   { label: 'Warm Up',      color: 'var(--nc-teal,#14B8A6)' },
    main:     { label: 'Main Session', color: 'var(--nc-gold,#D4AF37)' },
    cooldown: { label: 'Cool Down',    color: '#5A9BD4' },
  };

  let S = null;            // live mount state

  // 2-line/N-line clamp — keeps browse cards compact; full text is shown in
  // the single-exercise execution step (progressive disclosure).
  const _clampStyle = (lines) =>
    `display:-webkit-box;-webkit-line-clamp:${lines};-webkit-box-orient:vertical;overflow:hidden`;

  // Parse a rest string ("60s", "90", "2 min", "1:30") → seconds (0 = none).
  function _restSeconds(rest) {
    if (rest == null) return 0;
    const s = String(rest).trim().toLowerCase();
    if (!s) return 0;
    const clk = s.match(/^(\d+):(\d{1,2})$/);              // m:ss
    if (clk) return (+clk[1]) * 60 + (+clk[2]);
    const mm = s.match(/(\d+)\s*m/);                        // "2 min"
    const sm = s.match(/(\d+)\s*s/);                        // "30s"
    let sec = sm ? +sm[1] : 0;
    if (!mm && !sm) { const n = parseInt(s, 10); if (n > 0) sec = n; }  // bare number = seconds
    return (mm ? (+mm[1]) * 60 : 0) + sec;
  }
  const _fmtClock = (t) => `${Math.floor(t / 60)}:${String(Math.max(0, t) % 60).padStart(2, '0')}`;

  // Stop a running rest countdown only. Used by the rest button itself, which
  // must NOT touch the session elapsed ticker.
  function _clearRest() {
    if (S && S.exec && S.exec._restInt) { clearInterval(S.exec._restInt); S.exec._restInt = null; }
  }

  // Stop every per-step interval (rest + elapsed). Called at the top of each
  // render so nothing leaks across step re-renders.
  function _clearStepTimers() {
    _clearRest();
    if (S && S.exec && S.exec._elapsedInt) { clearInterval(S.exec._elapsedInt); S.exec._elapsedInt = null; }
  }

  // ── Small helpers ───────────────────────────────────────────────
  // Flatten a workout warm-up→main→cool-down (skips null slots). The array
  // position == exercise_index used by WorkoutSession logging.
  function _flatten(wk) {
    const out = [];
    ['warmup', 'main', 'cooldown'].forEach((g) => (wk[g] || []).forEach((ex) => { if (ex) out.push({ ex, group: g }); }));
    return out;
  }
  const _workoutById = (id) => S.workouts.find((w) => w.id === id) || S.workouts[0];
  // Library row by exercise_id, else a minimal meta from the row's own
  // snapshot video_url (Phase 13) so generated / snapshotted plans still
  // surface ▶ Watch. Null when there's neither.
  const _meta = (ex) => {
    if (!ex) return null;
    const lib = (ex.exercise_id && S.libMap) ? S.libMap.get(ex.exercise_id) : null;
    if (lib) return lib;
    const url = (typeof ExerciseLibrary !== 'undefined' && ExerciseLibrary.sanitizeUrl)
      ? ExerciseLibrary.sanitizeUrl(ex.video_url) : (ex.video_url || null);
    return url ? { id: ex.exercise_id || null, name: ex.name, video_url: url } : null;
  };
  const _scrollTop = () => { try { S.host.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} };

  // Estimated duration — historical → program-defined → computed → fallback.
  // Never returns 0 / Unknown / N/A.
  function _estDuration(workoutId, wk) {
    const durs = S.durByKey[workoutId] || [];
    if (durs.length) {
      const m = Math.round((durs.reduce((a, b) => a + b, 0) / durs.length) / 60);
      if (m > 0) return `~${m} min`;
    }
    const pd = parseInt(wk.duration_minutes || wk.est_minutes, 10);
    if (pd > 0) return `~${pd} min`;
    let mins = 0;
    _flatten(wk).forEach(({ ex }) => { mins += (parseInt(ex.sets, 10) || 3) * 1.5; });
    mins = Math.round(mins);
    if (mins > 0) { const low = Math.max(5, Math.floor(mins / 5) * 5); return `${low}–${low + 10} min`; }
    return '20–30 min';
  }

  function _synthDesc(wk) {
    const n = _flatten(wk).length;
    return n ? `A guided ${n}-exercise session. Move through it at your own pace.` : 'Your coach will add exercises here soon.';
  }

  // Client's own pulse status (RLS → self only). Calm null on any miss.
  async function _loadPulse(clientId) {
    if (!clientId || typeof sb === 'undefined') return null;
    try {
      const { data } = await sb.from('v_client_pulse')
        .select('pulse_status').eq('client_id', clientId).maybeSingle();
      return data?.pulse_status || null;
    } catch (_) { return null; }
  }

  // A small recovery-pulse chip for the mission header (reuses the shared
  // client pulse vocabulary; renders nothing when there is no row yet).
  function _pulseChip() {
    if (!S.pulseStatus) return '';
    const p = ClientUtil.pulseLabel(S.pulseStatus);
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;
            font-size:11px;font-weight:700;background:var(--nc-fill-1);border:1px solid var(--nc-border,rgba(255,255,255,.10));color:${p.color}">
            <span style="width:7px;height:7px;border-radius:50%;background:${p.color}"></span>${esc(p.word)}</span>`;
  }

  function _dayStatusKey(i) {
    const raw = S.statusByDay[i];
    if (raw === 'completed') return 'completed';
    if (raw === 'in_progress') return 'in_progress';
    if (i === S.todayDay) return 'today';
    return 'upcoming';
  }
  function _statusBadge(key) {
    const s = STATUS[key];
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;
            font-size:10.5px;font-weight:700;letter-spacing:.03em;background:${s.bg};color:${s.fg};border:1px solid ${s.bd}">
            <span aria-hidden="true">${s.dot}</span>${s.label}</span>`;
  }

  // ── Entry point ─────────────────────────────────────────────────
  async function render(container, opts = {}) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) return;
    host.innerHTML = `<div style="max-width:520px;margin:0 auto">${ClientUtil.skeleton(120)}<div style="height:10px"></div>${ClientUtil.skeleton(74)}<div style="height:10px"></div>${ClientUtil.skeleton(74)}</div>`;

    if (typeof ProgramPublish === 'undefined' || !ProgramPublish.resolveClientProgram) {
      ClientUtil.errorState(host, 'Program module not available', () => render(host, opts));
      return;
    }

    let clientId = null;
    try { clientId = Auth.getUser()?.id; } catch (_) {}

    const res = await ProgramPublish.resolveClientProgram(clientId);
    if (!res.ok) { _renderNonOk(host, res, () => render(host, opts)); return; }

    // Session signals — one round-trip each (active + recent history + pulse).
    let active = null, hist = [], pulseStatus = null;
    try {
      [active, hist, pulseStatus] = await Promise.all([
        WorkoutSession.getActiveSession(clientId),
        WorkoutSession.history(clientId, { limit: 60 }),
        _loadPulse(clientId),
      ]);
    } catch (_) { /* calm — statuses just fall back to upcoming/today */ }

    // CX4 — live completion of the in-progress day (mission header + card).
    // One extra read only when a session is actually open.
    let activeCompleted = 0;
    if (active && active.id) {
      try {
        const d = await WorkoutSession.detail(active.id);
        activeCompleted = (d.logs || []).filter((l) => l.completed).length;
      } catch (_) { /* header just omits the ratio */ }
    }

    // Completed-this-week set + per-workout duration history.
    const weekAgo = Date.now() - 7 * 86400000;
    const completedThisWeek = new Set();
    const durByKey = {};
    (hist || []).forEach((s) => {
      if (s.status !== 'completed') return;
      if (Date.parse(s.started_at) >= weekAgo) completedThisWeek.add(s.workout_key);
      if (s.duration_seconds) (durByKey[s.workout_key] = durByKey[s.workout_key] || []).push(s.duration_seconds);
    });

    const statusByDay = res.schedule.map((id) => {
      if (active && active.workout_key === id) return 'in_progress';
      if (completedThisWeek.has(id)) return 'completed';
      return 'pending';
    });
    // "Today" = the in-progress day, else the first not-done day.
    let todayDay = statusByDay.findIndex((s) => s === 'in_progress');
    if (todayDay < 0) todayDay = statusByDay.findIndex((s) => s === 'pending');
    if (todayDay < 0) todayDay = 0;

    S = {
      host, clientId, programId: res.row.id || null,
      p: res.p, workouts: res.workouts, schedule: res.schedule, libMap: res.libMap,
      active, durByKey, statusByDay, todayDay, pulseStatus, activeCompleted,
      view: 'overview', dayIndex: todayDay, exec: null,
    };

    if (opts.openToday) _openDay(todayDay);
    else _renderOverview();
  }

  function _renderNonOk(host, res, retry) {
    if (res.reason === 'load-error') { ClientUtil.errorState(host, 'Could not load your program', retry); return; }
    if (res.reason === 'no-auth') { host.innerHTML = _calm('Sign in to view your program.'); return; }
    if (res.reason === 'no-db')   { host.innerHTML = _calm('Not connected. Check your connection and try again.'); return; }
    // empty
    host.innerHTML = `<div style="max-width:520px;margin:0 auto"><div style="border:1px solid var(--nc-border,rgba(255,255,255,.08));
      border-radius:var(--nc-r-lg,16px);background:var(--nc-fill-1);padding:26px 18px;text-align:center">
      <div style="font-size:26px;line-height:1" aria-hidden="true">◈</div>
      <div style="font-size:15px;font-weight:700;color:var(--nc-text-primary,#F8FAFC);margin-top:10px">No plan yet</div>
      <p style="font-size:13px;color:var(--nc-text-secondary,#94A3B8);margin-top:6px;line-height:1.5">Your coach hasn't published your training plan yet. It will show up here as soon as it's ready.</p>
    </div></div>`;
  }
  const _calm = (msg) => `<div style="max-width:520px;margin:0 auto"><div style="border:1px solid var(--nc-border,rgba(255,255,255,.08));
    border-radius:var(--nc-r-lg,16px);background:var(--nc-fill-1);padding:22px 18px;text-align:center;
    font-size:13px;color:var(--nc-text-secondary,#94A3B8)">${esc(msg)}</div></div>`;

  // ── Overview — day cards ────────────────────────────────────────
  function _renderOverview() {
    _clearStepTimers();
    S.view = 'overview';
    const cards = S.schedule.map((id, i) => _dayCard(id, i)).join('');
    S.host.innerHTML = `
      <div style="max-width:520px;margin:0 auto">
        <div style="margin:2px 2px 14px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Your plan</div>
          <div style="font-size:19px;font-weight:800;letter-spacing:-.01em;color:var(--nc-text-primary,#F8FAFC);margin-top:2px">${esc(S.p.phase || 'Training Program')}</div>
          <div style="font-size:12.5px;color:var(--nc-text-secondary,#94A3B8);margin-top:2px">${S.schedule.length} day${S.schedule.length === 1 ? '' : 's'} this week${S.p.split_label ? ' · ' + esc(S.p.split_label) : ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">${cards}</div>
        ${(S.p.exclusions && S.p.exclusions.length) ? `
          <div style="margin-top:14px;padding:11px 14px;border-radius:var(--nc-r-lg,16px);background:rgba(244,63,94,.08);
                      border:1px solid rgba(244,63,94,.22);font-size:12px;color:#F5426C">
            <b>Avoid for now:</b> ${esc(S.p.exclusions.join(' · '))}
          </div>` : ''}
      </div>`;
    S.host.querySelectorAll('[data-cp2-day]').forEach((b) =>
      b.addEventListener('click', () => _openDay(parseInt(b.dataset.cp2Day, 10))));
  }

  function _dayCard(id, i) {
    const wk = _workoutById(id);
    const n = _flatten(wk).length;
    const key = _dayStatusKey(i);
    const isToday = key === 'today' || key === 'in_progress';
    // CX4 — an in-progress day shows live progress instead of a flat count.
    const progress = (key === 'in_progress' && n)
      ? `<div style="margin-top:9px;display:flex;align-items:center;gap:9px">
           <span style="flex:1;height:5px;border-radius:99px;background:var(--nc-track);overflow:hidden">
             <span style="display:block;height:100%;width:${Math.round((S.activeCompleted / n) * 100)}%;background:var(--nc-teal,#14B8A6);border-radius:99px;transition:width .35s"></span></span>
           <span style="font-size:11.5px;font-weight:700;color:var(--nc-teal,#14B8A6);white-space:nowrap">${S.activeCompleted}/${n} done</span>
         </div>`
      : '';
    return `
      <button type="button" data-cp2-day="${i}"
        style="width:100%;text-align:left;border:1px solid ${isToday ? 'rgba(20,184,166,.4)' : 'var(--nc-border,rgba(255,255,255,.08))'};
               border-radius:var(--nc-r-lg,16px);background:${isToday ? 'rgba(20,184,166,.06)' : 'var(--nc-fill-1)'};
               padding:14px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent;min-height:64px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Day ${i + 1}</span>
          ${_statusBadge(key)}
        </div>
        <div style="font-size:16px;font-weight:700;color:var(--nc-text-primary,#F8FAFC);margin-top:7px">${esc(wk.label || ('Workout ' + id))}</div>
        <div style="font-size:12.5px;color:var(--nc-text-secondary,#94A3B8);margin-top:3px">${n} exercise${n === 1 ? '' : 's'} <span style="opacity:.5">·</span> ${_estDuration(id, wk)}</div>
        ${progress}
      </button>`;
  }

  // ── Day detail ──────────────────────────────────────────────────
  function _openDay(i) {
    _clearStepTimers();
    S.view = 'day';
    S.dayIndex = i;
    const id = S.schedule[i];
    const wk = _workoutById(id);
    const flat = _flatten(wk);
    const total = flat.length;
    const collapseLong = total > 6;          // long sessions: collapse warm-up + cool-down
    const canWrite = _canWrite();

    // Group the flat items (keeping the global exercise_index).
    const byGroup = { warmup: [], main: [], cooldown: [] };
    flat.forEach((item, idx) => byGroup[item.group].push({ ex: item.ex, idx }));

    const groupsHTML = ['warmup', 'main', 'cooldown']
      .filter((g) => byGroup[g].length)
      .map((g) => {
        const open = !collapseLong || g === 'main';
        const rows = byGroup[g].map(({ ex, idx }) => _exCard(ex, idx)).join('');
        return _groupSection(g, byGroup[g].length, rows, open);
      }).join('');

    S.host.innerHTML = `
      <div style="max-width:520px;margin:0 auto">
        <button type="button" data-cp2-back
          style="display:inline-flex;align-items:center;gap:6px;background:transparent;border:0;cursor:pointer;
                 color:var(--nc-text-secondary,#94A3B8);font-size:13px;font-weight:600;padding:6px 2px;min-height:44px">‹ Plan</button>

        <div style="margin-top:4px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Day ${i + 1}</div>
          <div style="font-size:23px;font-weight:800;letter-spacing:-.01em;line-height:1.15;color:var(--nc-text-primary,#F8FAFC);margin-top:3px">${esc(wk.label || ('Workout ' + id))}</div>
          <div style="font-size:13.5px;line-height:1.5;color:var(--nc-text-secondary,#94A3B8);margin-top:7px;${_clampStyle(3)}">${esc(wk.description || _synthDesc(wk))}</div>
          ${_missionHeader(i, id, wk, total)}
          <button type="button" data-cp2-start ${total ? '' : 'disabled'}
            style="margin-top:16px;width:100%;min-height:60px;border:0;border-radius:var(--nc-r-lg,16px);
                   background:var(--nc-teal,#14B8A6);color:#052e2b;display:flex;align-items:center;justify-content:center;gap:10px;
                   padding:14px 20px;cursor:pointer;font-size:16px;font-weight:700;
                   box-shadow:var(--nc-shadow-teal,0 0 40px rgba(20,184,166,.18));-webkit-tap-highlight-color:transparent;
                   ${total ? '' : 'opacity:.5;cursor:not-allowed'}">
            ${canWrite ? '▶ Start Workout' : '▶ Preview Workout'}
          </button>
        </div>

        <div style="margin-top:18px;display:flex;flex-direction:column;gap:14px">${groupsHTML}</div>
      </div>`;

    // Wire: back + start.
    S.host.querySelector('[data-cp2-back]')?.addEventListener('click', () => { _renderOverview(); _scrollTop(); });
    S.host.querySelector('[data-cp2-start]')?.addEventListener('click', () => { if (total) _startExecution(i); });

    // Wire: group collapse toggles.
    S.host.querySelectorAll('[data-cp2-group-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wrap = btn.closest('[data-cp2-group]');
        const body = wrap?.querySelector('[data-cp2-group-body]');
        const chev = btn.querySelector('[data-cp2-group-chev]');
        if (!body) return;
        const hidden = body.classList.toggle('hidden');
        if (chev) chev.style.transform = hidden ? '' : 'rotate(180deg)';
      });
    });

    // Wire: per-card show-details + media + alt.
    S.host.querySelectorAll('.cp2-card').forEach((card) => {
      const idx = parseInt(card.dataset.cp2Idx, 10);
      const ex = flat[idx]?.ex;
      const m = _meta(ex);
      const toggle = card.querySelector('[data-cp2-toggle]');
      toggle?.addEventListener('click', () => {
        const det = card.querySelector('[data-cp2-details]');
        const chev = card.querySelector('[data-cp2-chev]');
        const lbl = card.querySelector('[data-cp2-toggle-label]');
        if (!det) return;
        const hidden = det.classList.toggle('hidden');
        if (chev) chev.style.transform = hidden ? '' : 'rotate(180deg)';
        if (lbl) lbl.textContent = hidden ? 'Show details' : 'Hide details';
      });
      _wireMedia(card, m);
      _wireAlt(card, ex, idx, id);
    });

    _scrollTop();
  }

  // CX4 — the mission header: a premium stat strip beneath the day title.
  // Completion ring (live for the in-progress day, 100% when done, "ready"
  // otherwise) + exercise count + duration + status + recovery-pulse chip.
  // Answers, at a glance: what today's goal is, where I am, what remains.
  function _missionHeader(i, id, wk, total) {
    const key = _dayStatusKey(i);
    const done = key === 'in_progress' ? S.activeCompleted : key === 'completed' ? total : 0;
    const pct  = total ? (done / total) * 100 : 0;
    const caption = key === 'in_progress' ? `${done} of ${total} done`
      : key === 'completed' ? 'Completed' : 'Ready to start';
    const ring = (key === 'in_progress' || key === 'completed')
      ? ClientUtil.progressRing(pct, 56)
      : `<div style="width:56px;height:56px;border-radius:50%;border:2px dashed var(--nc-border,rgba(255,255,255,.16));
           display:flex;align-items:center;justify-content:center;flex:none;font-size:18px;color:var(--nc-teal,#14B8A6)">▶</div>`;
    return `
      <div style="margin-top:14px;display:flex;align-items:center;gap:16px;border:1px solid var(--nc-border,rgba(255,255,255,.08));
           border-radius:var(--nc-r-lg,16px);background:var(--nc-fill-1);padding:14px 16px">
        ${ring}
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${_statusBadge(key)}${_pulseChip()}
          </div>
          <div style="font-size:12.5px;color:var(--nc-text-secondary,#94A3B8);margin-top:7px">
            <b style="color:var(--nc-text-primary,#F8FAFC)">${total}</b> exercise${total === 1 ? '' : 's'}
            <span style="opacity:.4">·</span> ${_estDuration(id, wk)}
            <span style="opacity:.4">·</span> ${esc(caption)}
          </div>
        </div>
      </div>`;
  }

  function _groupSection(g, count, rowsHTML, open) {
    const gm = GROUP[g];
    return `
      <div data-cp2-group="${g}">
        <button type="button" data-cp2-group-toggle
          style="width:100%;display:flex;align-items:center;justify-content:space-between;background:transparent;border:0;
                 cursor:pointer;padding:4px 2px;margin-bottom:8px;-webkit-tap-highlight-color:transparent">
          <span style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${gm.color}">
            ${gm.label} <span style="color:var(--nc-text-muted,#64748B);font-weight:600">· ${count}</span></span>
          <span data-cp2-group-chev style="font-size:12px;color:var(--nc-text-muted,#64748B);transition:transform .18s;${open ? 'transform:rotate(180deg)' : ''}">▾</span>
        </button>
        <div data-cp2-group-body class="${open ? '' : 'hidden'}" style="display:flex;flex-direction:column;gap:8px">${rowsHTML}</div>
      </div>`;
  }

  // Compact exercise card (browse). Visible: name / sets×reps / rest.
  // Hidden behind "Show details": notes, tempo cue, coach response, media, alt.
  function _exCard(ex, idx) {
    const m = _meta(ex);
    const setsReps = (ex.sets || ex.reps)
      ? `${esc(ex.sets || '')}${ex.sets && ex.reps ? ' × ' : ''}${esc(ex.reps || '')}` : '';
    const sub = ex._substitutedFrom ? _subBadge(ex) : '';
    const hasMedia = !!(m && (m.video_url || (typeof ExerciseInstructions !== 'undefined' && ExerciseInstructions.build(m).hasContent)));
    const hasDetails = !!(ex.notes || ex.tempo || ex._substituteResponse || hasMedia || typeof AltExercise !== 'undefined');
    return `
      <div class="cp2-card" data-cp2-idx="${idx}"
           style="border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:14px;background:var(--nc-fill-1);padding:12px 14px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <span style="width:24px;height:24px;border-radius:50%;background:rgba(20,184,166,.12);border:1px solid rgba(20,184,166,.3);
                       color:var(--nc-teal,#14B8A6);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;
                       flex-shrink:0;margin-top:1px">${idx + 1}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600;color:var(--nc-text-primary,#F8FAFC);line-height:1.35">${esc(ex.name || 'Exercise')}${sub}</div>
            ${ex.rest ? `<div style="font-size:11.5px;color:var(--nc-text-muted,#64748B);margin-top:2px">rest ${esc(ex.rest)}</div>` : ''}
          </div>
          ${setsReps ? `<div style="font-size:13px;font-weight:700;color:var(--nc-teal,#14B8A6);white-space:nowrap;margin-top:1px">${setsReps}</div>` : ''}
        </div>
        ${hasDetails ? `
          <button type="button" data-cp2-toggle
            style="margin-top:8px;background:transparent;border:0;color:var(--nc-text-secondary,#94A3B8);font-size:12px;font-weight:600;
                   cursor:pointer;padding:4px 0;display:inline-flex;align-items:center;gap:6px;min-height:32px">
            <span data-cp2-toggle-label>Show details</span>
            <span data-cp2-chev style="font-size:11px;transition:transform .18s">▾</span>
          </button>
          <div data-cp2-details class="hidden" style="margin-top:6px;border-top:1px solid var(--nc-border,rgba(255,255,255,.08));padding-top:10px">
            ${_detailsInner(ex, m)}
          </div>` : ''}
      </div>`;
  }

  function _detailsInner(ex, m) {
    return `
      ${ex.notes ? `<div style="font-size:12.5px;line-height:1.55;color:var(--nc-text-secondary,#94A3B8);margin-bottom:8px;${_clampStyle(5)}">${esc(ex.notes)}</div>` : ''}
      ${ex.tempo ? `<div style="font-size:11.5px;color:var(--nc-text-muted,#64748B);margin-bottom:8px">Tempo ${esc(ex.tempo)}</div>` : ''}
      ${ex._substituteResponse ? `<div style="font-size:11.5px;color:var(--nc-teal,#14B8A6);margin-bottom:8px">Coach: ${esc(ex._substituteResponse)}</div>` : ''}
      ${_mediaBlock(m)}
      ${_altButton()}`;
  }

  function _subBadge(ex) {
    return `<span title="Originally: ${esc(ex._substitutedFrom)}${ex._substituteResponse ? ' — ' + esc(ex._substituteResponse) : ''}"
      style="display:inline-flex;align-items:center;gap:4px;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600;
             background:rgba(20,184,166,.14);color:var(--nc-teal,#14B8A6);border:1px solid rgba(20,184,166,.35);cursor:help;vertical-align:1px">🔄 Substituted</span>`;
  }

  // ── Shared media + alt (browse cards AND execution steps) ────────
  function _mediaBlock(m) {
    if (!m) return '';
    const hasVideo = !!m.video_url;
    const hasInstr = !!(typeof ExerciseInstructions !== 'undefined' && ExerciseInstructions.build(m).hasContent);
    if (!hasVideo && !hasInstr) return '';
    return `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        ${hasVideo ? `<button type="button" data-cp2-preview class="btn btn-ghost btn-xs" style="padding:5px 11px;font-size:11px;min-height:32px">▶ Watch</button>` : ''}
        ${hasInstr ? `<button type="button" data-cp2-info class="btn btn-ghost btn-xs" style="padding:5px 11px;font-size:11px;min-height:32px">ℹ How to</button>` : ''}
      </div>
      <div data-cp2-video class="hidden" style="margin-bottom:8px;border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:8px;overflow:hidden"></div>
      <div data-cp2-instr class="hidden" style="margin-bottom:8px"></div>`;
  }
  function _altButton() {
    if (typeof AltExercise === 'undefined') return '';
    return `<button type="button" data-cp2-alt class="btn btn-ghost btn-xs" style="padding:5px 11px;font-size:11px;min-height:32px">⇄ Request alternative</button>`;
  }
  function _wireMedia(scope, m) {
    if (!m) return;
    scope.querySelector('[data-cp2-preview]')?.addEventListener('click', () => {
      const slot = scope.querySelector('[data-cp2-video]');
      if (!slot || !m.video_url) return;
      if (!slot.classList.contains('hidden')) { slot.classList.add('hidden'); slot.innerHTML = ''; return; }
      if (window.innerWidth < 640 && typeof ExerciseUI !== 'undefined') { ExerciseUI.openVideoModal(m.id, m.name, m.video_url); return; }
      const embed = (typeof ExerciseLibrary?.getEmbedUrl === 'function') ? ExerciseLibrary.getEmbedUrl(m.video_url) : m.video_url;
      slot.innerHTML = `<div style="position:relative;width:100%;padding-top:56.25%;background:#000">
        <iframe src="${esc(embed || '')}" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div>`;
      slot.classList.remove('hidden');
    });
    scope.querySelector('[data-cp2-info]')?.addEventListener('click', () => {
      const slot = scope.querySelector('[data-cp2-instr]');
      if (!slot || typeof ExerciseInstructions === 'undefined') return;
      if (!slot.classList.contains('hidden')) { slot.classList.add('hidden'); slot.innerHTML = ''; return; }
      slot.innerHTML = ExerciseInstructions.renderFull(m);
      slot.classList.remove('hidden');
    });
  }
  function _wireAlt(scope, ex, idx, workoutKey) {
    scope.querySelector('[data-cp2-alt]')?.addEventListener('click', () => {
      if (typeof AltExercise === 'undefined') { _toast('Alt-exercise module not loaded', 'error'); return; }
      AltExercise.openModal({
        programId: S.programId, workoutKey, exerciseIndex: idx,
        exerciseName: ex.name || `Exercise ${idx + 1}`, exerciseId: ex.exercise_id || null,
      });
    });
  }

  // ── Execution — guided, one exercise at a time ──────────────────
  async function _startExecution(i) {
    const id = S.schedule[i];
    const wk = _workoutById(id);
    const flat = _flatten(wk);
    if (!flat.length) { _toast('No exercises in this workout yet.', 'info'); return; }

    let sessionId = null;
    const logsByIdx = new Map();
    if (_canWrite()) {
      try {
        const sess = await WorkoutSession.start({
          clientId: S.clientId, programId: S.programId,
          workoutKey: id, workoutLabel: wk.label || ('Workout ' + id),
        });
        sessionId = sess?.id || null;
        if (sessionId) {
          const d = await WorkoutSession.detail(sessionId);
          (d.logs || []).forEach((l) => logsByIdx.set(l.exercise_index, l));
        }
      } catch (e) {
        if (e.message !== 'subscription_inactive') _toast(e.message, 'error');
        // fall through → read-only preview
      }
    }

    // Session start anchor for the elapsed timer (CX5). Resuming an existing
    // session keeps its original start; a fresh start uses now.
    const startedAt = (S.active && S.active.id === sessionId && S.active.started_at)
      ? Date.parse(S.active.started_at) : Date.now();
    S.exec = { dayIndex: i, workoutId: id, workout: wk, flat, step: 0, sessionId, readOnly: !sessionId, logsByIdx, startedAt };
    S.view = 'exec';
    _renderStep();
  }

  function _renderStep() {
    _clearStepTimers();
    const e = S.exec;
    if (e.step >= e.flat.length) { _renderFinish(); return; }

    const { ex, group } = e.flat[e.step];
    const m = _meta(ex);
    const total = e.flat.length;
    const log = e.logsByIdx.get(e.step) || {};
    const gm = GROUP[group];
    const last = e.step === total - 1;

    // CX5 — session header: completion ring (exercises marked done / total),
    // Exercise N of M, and a live elapsed timer. The thin bar tracks position
    // within the session; the ring tracks how much is actually finished.
    const doneCount = Array.from(e.logsByIdx.values()).filter((l) => l && l.completed).length;
    const sessionPct = total ? (doneCount / total) * 100 : 0;
    const showTimer = !e.readOnly && e.startedAt;
    S.host.innerHTML = `
      <div style="max-width:520px;margin:0 auto">
        <div style="display:flex;align-items:center;gap:14px">
          <button type="button" data-cp2-exit
            style="display:inline-flex;align-items:center;gap:6px;background:transparent;border:0;cursor:pointer;
                   color:var(--nc-text-secondary,#94A3B8);font-size:13px;font-weight:600;padding:6px 2px;min-height:44px;flex:none">‹ Day</button>
          ${ClientUtil.progressRing(sessionPct, 48, 4)}
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;color:var(--nc-text-primary,#F8FAFC)">Exercise ${e.step + 1} of ${total}</div>
            <div style="font-size:11.5px;color:var(--nc-text-muted,#64748B);margin-top:1px">
              ${doneCount}/${total} complete${showTimer ? ` <span style="opacity:.4">·</span> <span data-cp2-elapsed>0:00</span> elapsed` : ''}
            </div>
          </div>
        </div>
        <div style="height:6px;border-radius:99px;background:var(--nc-track);margin-top:12px;overflow:hidden">
          <div style="height:100%;width:${Math.round(((e.step + 1) / total) * 100)}%;background:var(--nc-teal,#14B8A6);border-radius:99px;transition:width .25s"></div>
        </div>

        <div style="margin-top:18px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${gm.color}">${gm.label}</div>
          <div style="font-size:24px;font-weight:800;letter-spacing:-.01em;line-height:1.15;color:var(--nc-text-primary,#F8FAFC);margin-top:4px">${esc(ex.name || 'Exercise')}</div>
          <div style="font-size:14px;color:var(--nc-text-secondary,#94A3B8);margin-top:7px">
            ${ex.sets ? `<b style="color:var(--nc-teal,#14B8A6)">${esc(ex.sets)}</b> sets` : ''}${ex.reps ? `${ex.sets ? ' · ' : ''}<b style="color:var(--nc-teal,#14B8A6)">${esc(ex.reps)}</b> reps` : ''}${ex.rest ? `${(ex.sets || ex.reps) ? ' · ' : ''}rest ${esc(ex.rest)}` : ''}
          </div>
          ${ex.tempo ? `<div style="font-size:12px;color:var(--nc-text-muted,#64748B);margin-top:3px">Tempo ${esc(ex.tempo)}</div>` : ''}
        </div>

        <div style="margin-top:14px">${_mediaBlock(m)}</div>

        ${ex.notes ? `<div style="margin-top:10px;font-size:13px;line-height:1.55;color:var(--nc-text-secondary,#94A3B8);
            background:var(--nc-fill-1);border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:12px;padding:12px 14px">${esc(ex.notes)}</div>` : ''}

        ${e.readOnly ? _readOnlyNote() : _setLogger(log)}

        ${e.readOnly ? '' : _restControl(ex)}

        <div style="margin-top:12px">${_altButton()}</div>

        <div style="display:flex;gap:10px;margin-top:22px">
          <button type="button" data-cp2-prev ${e.step === 0 ? 'disabled' : ''}
            style="flex:1;min-height:54px;border-radius:var(--nc-r-lg,16px);border:1px solid var(--nc-border,rgba(255,255,255,.12));
                   background:transparent;color:var(--nc-text-primary,#F8FAFC);font-size:14px;font-weight:600;cursor:pointer;
                   ${e.step === 0 ? 'opacity:.4;cursor:not-allowed' : ''}">‹ Previous</button>
          <button type="button" data-cp2-next
            style="flex:2;min-height:54px;border-radius:var(--nc-r-lg,16px);border:0;background:var(--nc-teal,#14B8A6);color:#052e2b;
                   font-size:15px;font-weight:700;cursor:pointer;box-shadow:var(--nc-shadow-teal,0 0 30px rgba(20,184,166,.16))">
            ${last ? (e.readOnly ? 'Done ✓' : 'Finish ▸') : 'Next ›'}</button>
        </div>

        ${(!e.readOnly && e.sessionId) ? `
        <div style="text-align:center;margin-top:14px">
          <button type="button" data-cp2-cancel
            style="background:transparent;border:0;cursor:pointer;min-height:40px;padding:8px 14px;
                   color:var(--nc-rose,#F5426C);font-size:12.5px;font-weight:600;opacity:.85;-webkit-tap-highlight-color:transparent">
            Cancel workout</button>
        </div>` : ''}
      </div>`;

    _wireMedia(S.host, m);
    _wireAlt(S.host, ex, e.step, e.workoutId);
    if (!e.readOnly) { _wireSetLogger(); _wireRest(); }
    _wireElapsed();

    S.host.querySelector('[data-cp2-exit]')?.addEventListener('click', () => { _persistStep(); _openDay(e.dayIndex); });
    // Cancel = explicit abandon (status transition via the F2 data layer; logged
    // sets stay in history, the session just ends as 'abandoned'). Exit (‹ Day)
    // remains the pause path — the session stays active for coming back.
    S.host.querySelector('[data-cp2-cancel]')?.addEventListener('click', async () => {
      if (!confirm('Cancel this workout? Anything you logged is kept — the session is just marked as not finished.')) return;
      _persistStep();
      try {
        await WorkoutSession.abandon(e.sessionId);
        _toast('Workout cancelled — see you next session.', 'info');
      } catch (err) {
        if (err?.message !== 'subscription_inactive') _toast(err?.message || 'Could not cancel the workout', 'error');
        return;   // honest failure: stay in the session
      }
      S.exec = null;
      _openDay(e.dayIndex);
    });
    S.host.querySelector('[data-cp2-prev]')?.addEventListener('click', () => {
      if (e.step === 0) return;
      _persistStep(); e.step--; _renderStep(); _scrollTop();
    });
    S.host.querySelector('[data-cp2-next]')?.addEventListener('click', () => {
      _persistStep(); e.step++; _renderStep(); _scrollTop();
    });
    _scrollTop();
  }

  // Live session-elapsed ticker (CX5). Re-bound each step; cleared by
  // _clearRest at the top of every re-render so it never leaks.
  function _wireElapsed() {
    const el = S.host.querySelector('[data-cp2-elapsed]');
    if (!el || !S.exec || !S.exec.startedAt) return;
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - S.exec.startedAt) / 1000));
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      el.textContent = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    };
    tick();
    S.exec._elapsedInt = setInterval(tick, 1000);
  }

  function _readOnlyNote() {
    return `<div style="margin-top:16px;border:1px dashed var(--nc-border,rgba(255,255,255,.12));border-radius:14px;padding:14px;
            font-size:12.5px;color:var(--nc-text-secondary,#94A3B8)">Your plan is read-only right now — renew with your coach to log sets again. You can still browse and watch every exercise.</div>`;
  }

  // ── Rest timer (lightweight · optional/manual · non-blocking) ────
  // Seeded from the exercise's prescribed rest; tapping starts a countdown,
  // tapping again skips it. Navigation (Prev/Next/exit) clears it.
  function _restControl(ex) {
    const secs = _restSeconds(ex.rest);
    if (!secs) return '';
    return `
      <div style="margin-top:12px;display:flex;align-items:center;gap:10px;border:1px solid var(--nc-border,rgba(255,255,255,.08));
           border-radius:var(--nc-r-lg,16px);background:var(--nc-fill-1);padding:10px 14px">
        <span style="font-size:18px" aria-hidden="true">⏱</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:600;color:var(--nc-text-primary,#F8FAFC)">Rest timer</div>
          <div data-cp2-rest-display style="font-size:12px;color:var(--nc-text-secondary,#94A3B8)" aria-live="polite">${_fmtClock(secs)} suggested</div>
        </div>
        <button type="button" data-cp2-rest-btn data-secs="${secs}"
          style="flex:0 0 auto;min-height:40px;padding:8px 16px;border-radius:var(--nc-r-full,999px);border:1px solid rgba(20,184,166,.4);
                 background:rgba(20,184,166,.12);color:var(--nc-teal,#14B8A6);font-size:13px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent">Start rest</button>
      </div>`;
  }
  function _wireRest() {
    const btn  = S.host.querySelector('[data-cp2-rest-btn]');
    const disp = S.host.querySelector('[data-cp2-rest-display]');
    if (!btn || !disp) return;
    const total = parseInt(btn.dataset.secs, 10) || 0;
    btn.addEventListener('click', () => {
      if (S.exec && S.exec._restInt) {            // running → skip/stop
        _clearRest();
        disp.textContent = `${_fmtClock(total)} suggested`;
        btn.textContent = 'Start rest';
        return;
      }
      let left = total;                            // idle → start countdown
      disp.textContent = `${_fmtClock(left)} left`;
      btn.textContent = 'Skip';
      _clearRest();
      S.exec._restInt = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          _clearRest();
          disp.textContent = 'Rest done — go!';
          btn.textContent = 'Start rest';
          _toast('Rest over — next set.', 'info');
          return;
        }
        disp.textContent = `${_fmtClock(left)} left`;
      }, 1000);
    });
  }

  function _setLogger(log) {
    const sets = (log.sets && log.sets.length) ? log.sets : [{}];
    const rows = sets.map((s, i) => _setRow(s, i)).join('');
    return `
      <div style="margin-top:16px;border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:14px;padding:14px;background:rgba(20,184,166,.04)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--nc-text-secondary,#94A3B8)">Log your sets</span>
          <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--nc-text-secondary,#94A3B8);cursor:pointer">
            <input type="checkbox" data-cp2-done ${log.completed ? 'checked' : ''} style="width:18px;height:18px">Done</label>
        </div>
        <div data-cp2-sets style="display:flex;flex-direction:column;gap:7px">${rows}</div>
        <button type="button" data-cp2-add-set
          style="margin-top:9px;background:transparent;border:0;color:var(--nc-teal,#14B8A6);font-size:12.5px;font-weight:600;cursor:pointer;padding:4px 0;min-height:32px">+ Add set</button>
        <input type="text" data-cp2-notes placeholder="Notes (optional)" class="form-input"
               value="${esc(log.notes || '')}" style="margin-top:10px;width:100%;padding:10px;font-size:13px">
      </div>`;
  }
  function _setRow(s, i) {
    const done = !!s.done;
    return `
      <div data-cp2-set-row style="display:grid;grid-template-columns:26px 1fr 1fr 34px;gap:8px;align-items:center;${done ? 'opacity:.6' : ''}">
        <span style="font-size:12px;color:var(--nc-text-muted,#64748B);font-weight:700;text-align:center">#${i + 1}</span>
        <input type="number" inputmode="numeric" min="0" step="1" placeholder="reps" data-cp2-reps
               value="${s.reps != null ? esc(s.reps) : ''}" class="form-input" style="padding:10px;font-size:13px">
        <input type="number" inputmode="decimal" min="0" step="0.5" placeholder="kg" data-cp2-weight
               value="${s.weight != null ? esc(s.weight) : ''}" class="form-input" style="padding:10px;font-size:13px">
        <label style="display:flex;align-items:center;justify-content:center;cursor:pointer" title="Mark set done">
          <input type="checkbox" data-cp2-setdone ${done ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--nc-teal,#14B8A6)"></label>
      </div>`;
  }
  function _wireSetLogger() {
    // Per-set check-off: dim the row, and when every set is checked, auto-mark
    // the exercise Done. Stored in the JSONB sets array — no schema change.
    const sync = () => {
      const rows = Array.from(S.host.querySelectorAll('[data-cp2-set-row]'));
      let allDone = rows.length > 0;
      rows.forEach((r) => {
        const c = r.querySelector('[data-cp2-setdone]');
        r.style.opacity = c && c.checked ? '.6' : '';
        if (!c || !c.checked) allDone = false;
      });
      const exDone = S.host.querySelector('[data-cp2-done]');
      if (allDone && exDone && !exDone.checked) exDone.checked = true;
    };
    S.host.querySelectorAll('[data-cp2-setdone]').forEach((c) => c.addEventListener('change', sync));
    S.host.querySelector('[data-cp2-add-set]')?.addEventListener('click', () => {
      const list = S.host.querySelector('[data-cp2-sets]');
      if (!list) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = _setRow({}, list.querySelectorAll('[data-cp2-set-row]').length);
      const rowEl = tmp.firstElementChild;
      if (rowEl) { list.appendChild(rowEl); rowEl.querySelector('[data-cp2-setdone]')?.addEventListener('change', sync); }
    });
  }

  // Persist the current step's sets/notes/completed via the F2 data layer.
  // Caches into logsByIdx so navigating back shows what was entered.
  function _persistStep() {
    const e = S.exec;
    if (!e || e.readOnly || !e.sessionId || e.step >= e.flat.length || !_canWrite()) return;
    const { ex } = e.flat[e.step];
    const sets = Array.from(S.host.querySelectorAll('[data-cp2-set-row]')).map((r, i) => {
      const reps = r.querySelector('[data-cp2-reps]').value;
      const weight = r.querySelector('[data-cp2-weight]').value;
      const done = !!r.querySelector('[data-cp2-setdone]')?.checked;
      if (reps === '' && weight === '' && !done) return null;
      return { n: i + 1, reps: reps === '' ? null : Number(reps), weight: weight === '' ? null : Number(weight), done };
    }).filter(Boolean);
    const notes = S.host.querySelector('[data-cp2-notes]')?.value || null;
    const completed = !!S.host.querySelector('[data-cp2-done]')?.checked;
    if (!sets.length && !notes && !completed) return;   // nothing to save

    e.logsByIdx.set(e.step, { sets, notes, completed, exercise_index: e.step });
    WorkoutSession.logExercise(e.sessionId, {
      exerciseIndex: e.step, exerciseName: ex.name || `Exercise ${e.step + 1}`,
      exerciseId: ex.exercise_id || null, sets, notes, completed,
    }).catch((err) => { if (err.message !== 'subscription_inactive') console.warn('[clientProgram] log:', err.message); });
  }

  function _renderFinish() {
    _clearStepTimers();
    const e = S.exec;
    if (e.readOnly || !e.sessionId) {
      S.host.innerHTML = `
        <div style="max-width:520px;margin:0 auto;text-align:center;padding-top:14px">
          <div style="font-size:38px" aria-hidden="true">✓</div>
          <div style="font-size:21px;font-weight:800;color:var(--nc-text-primary,#F8FAFC);margin-top:8px">That's the session</div>
          <div style="font-size:13.5px;color:var(--nc-text-secondary,#94A3B8);margin-top:6px">You browsed every exercise. Renew with your coach to log your sets.</div>
          <button type="button" data-cp2-done-back style="margin-top:20px;width:100%;min-height:54px;border-radius:var(--nc-r-lg,16px);border:0;
                  background:var(--nc-teal,#14B8A6);color:#052e2b;font-size:15px;font-weight:700;cursor:pointer">Back to plan</button>
        </div>`;
      S.host.querySelector('[data-cp2-done-back]')?.addEventListener('click', () => render(S.host));
      _scrollTop();
      return;
    }

    S.host.innerHTML = `
      <div style="max-width:520px;margin:0 auto;text-align:center;padding-top:8px">
        <div style="width:52px;height:52px;margin:0 auto;border-radius:50%;background:rgba(20,184,166,.12);
             border:1px solid rgba(20,184,166,.4);display:flex;align-items:center;justify-content:center;
             font-size:24px;color:var(--nc-teal,#14B8A6)" aria-hidden="true">✓</div>
        <div style="font-size:22px;font-weight:800;color:var(--nc-text-primary,#F8FAFC);margin-top:12px">Final step</div>
        <div style="font-size:13.5px;color:var(--nc-text-secondary,#94A3B8);margin-top:6px">Note how this session felt — it helps tune your recovery.</div>
        <div style="text-align:left;margin-top:20px;border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:16px;padding:16px;background:var(--nc-fill-1)">
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--nc-text-secondary,#94A3B8)">
            Intensity — <span data-cp2-int-val>7</span>/10</label>
          <input type="range" data-cp2-intensity min="1" max="10" step="1" value="7" style="width:100%;margin-top:8px">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--nc-text-muted,#64748B)"><span>Easy</span><span>Maximal</span></div>
          <textarea data-cp2-fnotes class="form-input" placeholder="How did it feel? Any pain, fatigue, wins?"
                    style="margin-top:12px;width:100%;min-height:74px;font-size:13px"></textarea>
        </div>
        <div style="display:flex;gap:10px;margin-top:18px">
          <button type="button" data-cp2-back-steps style="flex:1;min-height:54px;border-radius:var(--nc-r-lg,16px);
                  border:1px solid var(--nc-border,rgba(255,255,255,.12));background:transparent;color:var(--nc-text-primary,#F8FAFC);
                  font-size:14px;font-weight:600;cursor:pointer">‹ Back</button>
          <button type="button" data-cp2-finish style="flex:2;min-height:54px;border-radius:var(--nc-r-lg,16px);border:0;
                  background:var(--nc-teal,#14B8A6);color:#052e2b;font-size:15px;font-weight:700;cursor:pointer;
                  box-shadow:var(--nc-shadow-teal,0 0 30px rgba(20,184,166,.16))">Finish &amp; Save</button>
        </div>
      </div>`;

    const range = S.host.querySelector('[data-cp2-intensity]');
    const val = S.host.querySelector('[data-cp2-int-val]');
    range?.addEventListener('input', () => { if (val) val.textContent = range.value; });
    S.host.querySelector('[data-cp2-back-steps]')?.addEventListener('click', () => { e.step = e.flat.length - 1; _renderStep(); _scrollTop(); });
    S.host.querySelector('[data-cp2-finish]')?.addEventListener('click', async () => {
      const btn = S.host.querySelector('[data-cp2-finish]');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      try {
        const elapsedSec = e.startedAt ? Math.floor((Date.now() - e.startedAt) / 1000) : 0;
        await WorkoutSession.finish(e.sessionId, {
          intensityRating: parseInt(range?.value || '7', 10),
          sessionNotes: (S.host.querySelector('[data-cp2-fnotes]')?.value || '').trim() || null,
        });
        _toast('Workout saved.', 'success');
        _renderComplete({ label: e.workout.label || 'Session', total: e.flat.length, elapsedSec });
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Finish & Save'; }
        if (err.message !== 'subscription_inactive') _toast(err.message, 'error');
      }
    });
    _scrollTop();
  }

  // CX5 — the completion moment. Calm confidence, not confetti: a clean
  // "Session complete", a one-line emotional connection to Recovery Pulse
  // (reads the cached pulse status; never changes Pulse logic), and a quiet
  // summary. The single Back action refreshes the plan with new statuses.
  function _recoveryConnection() {
    switch (S.pulseStatus) {
      case 'on_track':   return 'You’ve reinforced your momentum today.';
      case 'slipping':   return 'A strong step back into your rhythm.';
      case 'at_risk':
      case 'regressing': return 'Every session rebuilds momentum — this one counts.';
      default:           return 'A strong start. Momentum builds from here.';
    }
  }

  function _renderComplete(summary) {
    _clearStepTimers();
    S.exec = null;
    const mins = Math.round((summary.elapsedSec || 0) / 60);
    const timeLine = mins >= 1 ? `${mins} min` : 'a few minutes';
    S.host.innerHTML = `
      <div style="max-width:520px;margin:0 auto;text-align:center;padding-top:18px">
        <div style="width:72px;height:72px;margin:0 auto;border-radius:50%;background:rgba(20,184,166,.12);
             border:1px solid rgba(20,184,166,.45);display:flex;align-items:center;justify-content:center;
             box-shadow:0 0 44px rgba(20,184,166,.22);font-size:32px;color:var(--nc-teal,#14B8A6)" aria-hidden="true">✓</div>
        <div style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--nc-text-muted,#64748B);margin-top:20px">Session complete</div>
        <div style="font-size:25px;font-weight:800;letter-spacing:-.01em;color:var(--nc-text-primary,#F8FAFC);margin-top:4px">${esc(summary.label)}</div>
        <div style="font-size:14.5px;line-height:1.5;color:var(--nc-teal,#14B8A6);font-weight:600;margin-top:10px">${esc(_recoveryConnection())}</div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:22px">
          <div style="border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:14px;padding:12px 18px;background:var(--nc-fill-1)">
            <div style="font-size:20px;font-weight:800;color:var(--nc-text-primary,#F8FAFC)">${summary.total}</div>
            <div style="font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--nc-text-muted,#64748B);margin-top:2px">Exercises</div>
          </div>
          <div style="border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:14px;padding:12px 18px;background:var(--nc-fill-1)">
            <div style="font-size:20px;font-weight:800;color:var(--nc-text-primary,#F8FAFC)">${esc(timeLine)}</div>
            <div style="font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--nc-text-muted,#64748B);margin-top:2px">Duration</div>
          </div>
        </div>
        <button type="button" data-cp2-complete-back style="margin-top:26px;width:100%;min-height:54px;border-radius:var(--nc-r-lg,16px);
                border:0;background:var(--nc-teal,#14B8A6);color:#052e2b;font-size:15px;font-weight:700;cursor:pointer;
                box-shadow:var(--nc-shadow-teal,0 0 30px rgba(20,184,166,.16))">Back to plan</button>
      </div>`;
    S.host.querySelector('[data-cp2-complete-back]')?.addEventListener('click', () => render(S.host));
    _scrollTop();
  }

  window.ClientProgram = { render };
})();
