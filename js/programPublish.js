/* ═══════════════════════════════════════════════════════════════
   NeuCore — Program Review & Publish (coach side)
   After Generate, the coach reviews + edits the program and the daily
   routine, then publishes them to the client.

   Publishes to:
     client_programs  (the full training program)
     client_routines  (the daily-routine tasks, tracker shape)
   — see 20260522_client_program_publish.sql

   Public API (window.ProgramPublish):
     render({ program, clientId, clientName })  — draw the editable panel
     getProgram()                               — current edited program
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let _program = null;     // the live, edited program object
  let _clientId = null;
  let _clientName = '';
  // Phase 6 — current published-program metadata for this client (mode +
  // revision + last-updated), loaded async so the coach sees live state.
  let _meta = { loaded: false, exists: false, mode: 'one_time', revision: 0, updatedAt: null, published: false, programId: null };
  // Coach's selections for the NEXT publish — kept off the program jsonb so
  // the stored plan never carries mode/note (those are dedicated columns).
  let _selectedMode = null;
  let _changeNote   = '';
  // Phase E1b-2 — effective-date scheduling for the NEXT publish:
  //   'now'  → apply immediately (also updates the client_programs pointer)
  //   'next' → version effective now, pointer left as-is (in-progress session
  //            keeps its snapshot; client's next session resolves the new plan)
  //   'date' → scheduled version with a future effective_from (hidden by RLS
  //            from the client until due)
  let _startMode = 'now';
  let _startDate = '';     // 'YYYY-MM-DD' when _startMode === 'date'

  const PANEL_ID = 'program-review-panel';

  function _toast(msg, kind) {
    if (typeof Dashboard !== 'undefined' && Dashboard.toast) Dashboard.toast(msg, kind);
    else console.log('[publish]', kind || 'info', msg);
  }

  // ── Public entry ──────────────────────────────────────────
  function render(opts = {}) {
    _program    = opts.program || null;
    _clientId   = opts.clientId || null;
    _clientName = opts.clientName || '';
    _selectedMode = null;   // resolved from this client's existing program in _loadMeta
    _changeNote   = '';
    _startMode    = 'now';  // Phase E1b-2 — default to immediate apply
    _startDate    = '';
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (!_program || (!_program.structure && !_program.workouts)) { panel.classList.add('hidden'); return; }
    // Ensure daily-routine tasks exist (older programs may lack them).
    if (!Array.isArray(_program.daily_routine_tasks)) _program.daily_routine_tasks = [];
    // Back-fill workouts[] for legacy single-workout programs.
    if (!Array.isArray(_program.workouts) || !_program.workouts.length) {
      const s = _program.structure || { warmup: [], main: [], cooldown: [] };
      _program.workouts = [{ id: 'A', label: 'Daily Workout',
        warmup: s.warmup || [], main: s.main || [], cooldown: s.cooldown || [] }];
      _program.split_label = _program.split_label || 'Same workout repeated';
    }
    if (!Array.isArray(_program.schedule) || !_program.schedule.length) {
      const days = _program.days_per_week || 1;
      const ids  = _program.workouts.map((w) => w.id);
      _program.schedule = Array.from({ length: days }, (_, i) => ids[i % ids.length]);
    }
    panel.classList.remove('hidden');
    _draw();
    _loadMeta(_clientId);          // Phase 6 — resolve current mode/revision
  }

  function getProgram() { return _program; }

  // ── Client side — shared program data resolver ─────────────
  //   Loads + resolves the published program for one client:
  //     • back-fills workouts[] / schedule[] for legacy single-workout programs
  //     • applies Feature 6 substitutions as an in-memory overlay (the
  //       published JSON is never mutated — scoped to this resolve pass)
  //     • batch-resolves Feature 5 library metadata into libMap (one query)
  //   Returns { ok:true, row, p, workouts, schedule, libMap }
  //        or { ok:false, reason:'no-auth'|'no-db'|'load-error'|'empty', message? }
  //   Single source of truth for the day-based ClientProgram (CX1) view —
  //   so the F5/F6 resolution lives in exactly one place.
  async function resolveClientProgram(clientId) {
    if (!clientId) { try { clientId = Auth.getUser()?.id; } catch {} }
    if (!clientId) return { ok: false, reason: 'no-auth' };
    if (typeof sb === 'undefined' || !sb) return { ok: false, reason: 'no-db' };

    // Current pointer (existing model). Also yields the FK-safe program id used
    // for workout_sessions.program_id and the back-compat fallback below.
    let cp = null;
    try {
      const { data, error } = await sb.from('client_programs')
        .select('id, program, published, published_at').eq('client_id', clientId).maybeSingle();
      if (error) throw error;
      cp = data;
    } catch (e) {
      return { ok: false, reason: 'load-error', message: e.message };
    }

    // ── Phase E1b — effective-date version overlay ──────────────
    //   RLS restricts a client to their OWN, published, already-effective rows
    //   (effective_from <= now(), SERVER time), so future scheduled versions are
    //   never returned here. Of the versions the client may see, we take the one
    //   with the greatest effective_from (the latest plan that has started).
    //
    //   Reconciliation with the client_programs pointer (E1b-2): the pointer is
    //   just another candidate, competing on START time. Serve the version when
    //   its effective_from is at least as recent as the pointer's last write
    //   (published_at); otherwise serve the pointer. This:
    //     • keeps E1b-1 back-compat — a baseline version (effective_from =
    //       cp.published_at) ties and serves identical content; a pointer-only
    //       republish (cp.published_at newer than any version's start) wins;
    //     • honours scheduling — a future version, once due, has the greatest
    //       effective_from and is NOT shadowed by an apply-now pointer write
    //       that happened earlier (the bug a published_at compare would cause).
    //   No version row, an out-of-date version, an unpublished/absent pointer,
    //   or a missing table (throw) all fall through to client_programs behavior.
    let row = cp;
    if (cp && cp.published) {
      try {
        const { data: vers } = await sb.from('client_program_versions')
          .select('id, program, effective_from, published_at, source_program_id')
          .eq('client_id', clientId)
          .eq('published', true)
          .order('effective_from', { ascending: false })
          .limit(1);
        const v = vers && vers[0];
        if (v && v.program
            && (!cp.published_at || Date.parse(v.effective_from) >= Date.parse(cp.published_at))) {
          // Keep the client_programs id (FK-safe for workout_sessions.program_id);
          // override only the served program content + published_at.
          row = { id: cp.id, program: v.program, published: true, published_at: v.published_at };
        }
      } catch (e) {
        console.warn('[program] version overlay skipped:', e?.message);  // fall back to pointer
      }
    }

    if (!row || !row.published || !row.program || (!row.program.structure && !row.program.workouts)) {
      return { ok: false, reason: 'empty' };
    }

    const p = row.program;
    // Back-fill workouts[] for legacy single-workout programs.
    let workouts = Array.isArray(p.workouts) && p.workouts.length ? p.workouts : null;
    if (!workouts) {
      const s = p.structure || { warmup: [], main: [], cooldown: [] };
      workouts = [{ id: 'A', label: 'Daily Workout',
        warmup: s.warmup || [], main: s.main || [], cooldown: s.cooldown || [] }];
    }
    const schedule = Array.isArray(p.schedule) && p.schedule.length
      ? p.schedule
      : Array.from({ length: p.days_per_week || 1 }, (_, i) => workouts[i % workouts.length].id);

    // ── Feature 6 — substitution overlay (most-recent per slot) ──
    const subMap = new Map();   // "workoutKey|exerciseIndex" → row
    try {
      const { data: subRows } = await sb.from('exercise_alternative_requests')
        .select('workout_key, exercise_index, substitute_exercise_id, coach_response, exercise_name, responded_at')
        .eq('client_id', clientId)
        .eq('status', 'addressed')
        .not('substitute_exercise_id', 'is', null)
        .order('responded_at', { ascending: false });
      (subRows || []).forEach((r) => {
        const k = r.workout_key + '|' + r.exercise_index;
        if (!subMap.has(k)) subMap.set(k, r);   // keep most-recent (ordered DESC)
      });
    } catch (e) { console.warn('[program] substitution prefetch:', e?.message); }

    if (subMap.size) {
      workouts.forEach((wk) => {
        ['warmup', 'main', 'cooldown'].forEach((k) => {
          (wk[k] || []).forEach((ex, i) => {
            if (!ex) return;
            const sub = subMap.get(wk.id + '|' + i);
            if (!sub) return;
            ex._substitutedFrom    = ex.name || sub.exercise_name || 'Original exercise';
            ex._substituteResponse = sub.coach_response || '';
            ex.exercise_id         = sub.substitute_exercise_id;   // name filled after libMap
          });
        });
      });
    }

    // ── Feature 5 — batch-resolve library metadata (id → exercises row) ──
    const linkedIds = new Set();
    workouts.forEach((wk) => {
      ['warmup', 'main', 'cooldown'].forEach((k) => {
        (wk[k] || []).forEach((ex) => { if (ex && ex.exercise_id) linkedIds.add(ex.exercise_id); });
      });
    });
    let libMap = new Map();
    if (linkedIds.size && typeof ExerciseLibrary !== 'undefined') {
      try {
        const all = await ExerciseLibrary.loadAll();
        all.forEach((e) => { if (linkedIds.has(e.id)) libMap.set(e.id, e); });
      } catch (e) { console.warn('[program] library prefetch:', e?.message); }
    }
    // Overwrite display name on substituted slots with the substitute's real name.
    if (subMap.size && libMap.size) {
      workouts.forEach((wk) => {
        ['warmup', 'main', 'cooldown'].forEach((k) => {
          (wk[k] || []).forEach((ex) => {
            if (ex && ex._substitutedFrom && ex.exercise_id) {
              const meta = libMap.get(ex.exercise_id);
              if (meta && meta.name) ex.name = meta.name;
            }
          });
        });
      });
    }

    return { ok: true, row, p, workouts, schedule, libMap };
  }

  // ── Draw ──────────────────────────────────────────────────
  function _draw() {
    const panel = document.getElementById(PANEL_ID);
    const p = _program;
    panel.innerHTML = `
      <div class="card" style="margin-bottom:var(--sp-4)">
        <div class="card-header">
          <span class="card-title">Review &amp; Publish to Client</span>
          <span class="badge" style="background:rgba(20,184,166,.14);color:var(--nc-teal);border:1px solid rgba(20,184,166,.3)">
            ${esc(p.phase || 'Program')} · ${esc(p.days_per_week || 3)} days/week${p.split_label ? ' · ' + esc(p.split_label) : ''}
          </span>
        </div>
        <div class="form-hint" style="margin-bottom:14px">
          Edit anything below, then publish. The client sees the program in
          <b>My Program</b> and the routine in their <b>Daily Routine</b> tracker.
        </div>

        <div id="pp-mode"></div>
        <div id="pp-program"></div>
        <div id="pp-routine" style="margin-top:18px"></div>
        <div id="pp-schedule" style="margin-top:18px"></div>

        <div style="display:flex;gap:10px;align-items:center;margin-top:20px;flex-wrap:wrap">
          <button class="btn btn-primary" id="pp-publish">📤 Publish to Client</button>
          <button class="btn btn-ghost" id="pp-copy">📋 Load from another client</button>
          <button class="btn btn-ghost" id="pp-preview">👁 Preview client view</button>
          <button class="btn btn-ghost" id="pp-revert">↺ Revert edits</button>
          <span id="pp-status" style="font-size:12px;color:var(--text-tertiary)"></span>
        </div>
      </div>`;

    _drawMode();
    _drawProgram();
    _drawRoutine();
    _drawSchedule();
    _syncPublishUi();

    panel.querySelector('#pp-publish').addEventListener('click', _publish);
    panel.querySelector('#pp-copy').addEventListener('click', _openCopyFrom);
    panel.querySelector('#pp-preview').addEventListener('click', _preview);
    panel.querySelector('#pp-revert').addEventListener('click', () => {
      if (confirm('Revert all edits to the generated program?')) {
        _toast('Re-generate to reset — edits kept for now.', 'info');
      }
    });
  }

  // ── Program structure editor (workout-split aware) ────────
  // Day rail (Phase C): instead of stacking every workout editor in one
  // scroll, an interactive rail focuses one workout at a time ("All days"
  // restores the stacked overview). Switching only toggles visibility —
  // never re-renders — so in-progress edits are preserved.
  let _activeW = 0;

  function _drawProgram() {
    const host = document.getElementById('pp-program');
    const workouts = _program.workouts || [];
    const schedule = _program.schedule || [];
    if (workouts.length < 2) _activeW = 'all';            // single workout → nothing to switch
    if (_activeW !== 'all' && _activeW >= workouts.length) _activeW = 0;
    host.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--nc-teal)">
          Training Program${_program.split_label ? ' — ' + esc(_program.split_label) : ''}
        </div>
        <button class="btn btn-ghost btn-sm" data-pp-addday>+ Add day</button>
      </div>
      ${_dayRail(workouts, schedule)}
      ${workouts.map((wk, wi) => `
        <div data-ppw="${wi}" style="${(_activeW === 'all' || _activeW === wi) ? '' : 'display:none'}">${_workoutEditor(wi, wk, workouts.length)}</div>`).join('')}
    `;
    workouts.forEach((wk, wi) => {
      ['warmup', 'main', 'cooldown'].forEach((key) => _wireSection(wi, key));
      const lbl = host.querySelector(`[data-wlabel="${wi}"]`);
      if (lbl) lbl.addEventListener('input', () => { _program.workouts[wi].label = lbl.value; });
      host.querySelector(`[data-pp-rmday="${wi}"]`)?.addEventListener('click', () => _removeDay(wi));
    });
    host.querySelector('[data-pp-addday]')?.addEventListener('click', _addDay);
    _wireDayRail(host, workouts.length);
  }

  // ── Manual builder — add / remove a training day (workout) ──────
  function _addDay() {
    const ws = _program.workouts;
    const used = new Set(ws.map((w) => w.id));
    let code = 65; while (used.has(String.fromCharCode(code))) code++;   // next free A,B,C…
    const id = String.fromCharCode(code);
    ws.push({ id, label: 'Day ' + (ws.length + 1), warmup: [], main: [], cooldown: [] });
    _program.schedule = _program.schedule || [];
    _program.schedule.push(id);
    _program.days_per_week = _program.schedule.length;
    _activeW = ws.length - 1;            // focus the new day
    _drawProgram();
  }

  function _removeDay(wi) {
    const ws = _program.workouts;
    if (ws.length <= 1) { _toast('A program needs at least one day.', 'info'); return; }
    if (!confirm(`Remove "${ws[wi].label || ('Workout ' + ws[wi].id)}" and its exercises?`)) return;
    const removed = ws.splice(wi, 1)[0];
    _program.schedule = (_program.schedule || []).filter((sid) => sid !== removed.id);
    if (!_program.schedule.length) _program.schedule = ws.map((w) => w.id);
    _program.days_per_week = _program.schedule.length;
    _activeW = 'all';
    _drawProgram();
  }

  // Reorder an exercise within its section.
  function _moveEx(wi, key, i, dir) {
    const arr = _program.workouts[wi][key];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    _drawProgram();
  }

  // Interactive rail — one chip per workout (showing which days use it) + All.
  function _dayRail(workouts, schedule) {
    if (workouts.length < 2) return '';
    const daysFor = (id) => schedule
      .map((sid, i) => (sid === id ? i + 1 : null)).filter(Boolean);
    const chip = (label, val, active) => `
      <button type="button" data-pp-rail="${val}"
        style="font-size:11.5px;font-weight:600;padding:6px 13px;border-radius:20px;cursor:pointer;
               transition:background var(--nc-dur-fast,180ms) var(--nc-ease,ease), color var(--nc-dur-fast,180ms) var(--nc-ease,ease);
               background:${active ? 'rgba(20,184,166,.16)' : 'var(--bg-raised)'};
               border:1px solid ${active ? 'rgba(20,184,166,.4)' : 'var(--border-subtle)'};
               color:${active ? 'var(--nc-teal)' : 'var(--text-secondary)'}">${label}</button>`;
    return `<div data-pp-dayrail style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      ${workouts.map((wk, wi) => {
        const days = daysFor(wk.id);
        const dayLbl = days.length ? ` · Day ${days.join(', ')}` : '';
        return chip(`${esc(wk.label || ('Workout ' + wk.id))}${dayLbl}`, wi, _activeW === wi);
      }).join('')}
      ${chip('All days', 'all', _activeW === 'all')}
    </div>`;
  }

  function _wireDayRail(host, count) {
    host.querySelectorAll('[data-pp-rail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.ppRail;
        _activeW = v === 'all' ? 'all' : parseInt(v, 10);
        // Visibility toggle only — editors keep their unsaved input state.
        host.querySelectorAll('[data-ppw]').forEach((w) => {
          const wi = parseInt(w.dataset.ppw, 10);
          w.style.display = (_activeW === 'all' || _activeW === wi) ? '' : 'none';
        });
        host.querySelectorAll('[data-pp-rail]').forEach((b) => {
          const active = b.dataset.ppRail === String(_activeW);
          b.style.background = active ? 'rgba(20,184,166,.16)' : 'var(--bg-raised)';
          b.style.borderColor = active ? 'rgba(20,184,166,.4)' : 'var(--border-subtle)';
          b.style.color = active ? 'var(--nc-teal)' : 'var(--text-secondary)';
        });
      });
    });
  }

  function _workoutEditor(wi, wk, count) {
    return `
      <div style="margin-bottom:18px;border:1px solid var(--border-subtle);border-radius:10px;
                  padding:12px;background:rgba(255,255,255,.015)">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">
          <span style="width:26px;height:26px;border-radius:7px;background:rgba(20,184,166,.16);
                       border:1px solid rgba(20,184,166,.35);color:var(--nc-teal);font-weight:700;
                       font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${esc(wk.id)}</span>
          <input data-wlabel="${wi}" value="${esc(wk.label || ('Workout ' + wk.id))}"
            class="form-input" style="max-width:240px;font-weight:600"/>
          ${count > 1 ? `<button class="btn btn-ghost btn-sm" data-pp-rmday="${wi}" title="Remove this day"
            style="color:var(--rose);margin-left:auto;white-space:nowrap">🗑 Remove day</button>` : ''}
        </div>
        ${_sectionEditor(wi, 'warmup',   'Warm-Up',                    wk.warmup)}
        ${_sectionEditor(wi, 'main',     'Conditioning / Correctives', wk.main)}
        ${_sectionEditor(wi, 'cooldown', 'Cool-Down',                  wk.cooldown)}
      </div>`;
  }

  function _sectionEditor(wi, key, title, list) {
    return `
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:12px;font-weight:600;color:var(--text-secondary)">${esc(title)}</span>
          <button class="btn btn-ghost btn-sm" data-add="${wi}:${key}">+ Add exercise</button>
        </div>
        <div>
          ${(list || []).map((ex, i) => _exerciseRow(wi, key, ex, i)).join('')}
        </div>
      </div>`;
  }

  function _exerciseRow(wi, key, ex, i) {
    const f = (field, val, ph, w, extra = '') =>
      `<input data-w="${wi}" data-ex="${key}" data-i="${i}" data-f="${field}" value="${esc(val)}"
        placeholder="${esc(ph)}" class="form-input" style="${w}" ${extra}/>`;
    // Feature 5 — show a small library badge when exercise_id is set so
    // the coach can see at a glance which rows are library-backed.
    const linked = !!ex.exercise_id;
    // C1A — demo-video status. The client ▶ Watch/Preview button only appears
    // when a row carries a video_url; generated/free-text rows start without one.
    // "Link demo" lets the coach attach a library demo while keeping their name.
    const _demoUrl = (typeof ExerciseLibrary !== 'undefined' && ExerciseLibrary.sanitizeUrl)
      ? ExerciseLibrary.sanitizeUrl(ex.video_url) : (ex.video_url || null);
    const hasVideo = !!_demoUrl;
    return `
      <div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;flex-wrap:wrap;
                  padding:8px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-raised)"
           data-row="${wi}:${key}:${i}">
        <span style="font-size:11px;color:var(--text-tertiary);width:18px;text-align:center;padding-top:9px">${i + 1}</span>
        <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:6px;position:relative">
          <div style="display:flex;gap:6px;align-items:center">
            ${f('name', ex.name, 'Exercise name', 'font-weight:600;flex:1', 'autocomplete="off"')}
            <button type="button" class="btn btn-ghost btn-sm" data-pick="${wi}:${key}:${i}"
                    title="Pick from Library"
                    style="white-space:nowrap;padding:6px 9px">📚 Library</button>
          </div>
          ${linked ? `<div style="font-size:10px;color:var(--nc-teal,#14b8a6);letter-spacing:.04em">
            ◈ linked · ${esc(ex.exercise_id).slice(0,8)}…
          </div>` : ''}
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10px">
            ${hasVideo
              ? `<span style="color:var(--nc-teal,#14b8a6);font-weight:600">▶ Demo linked</span>
                 <button type="button" class="btn btn-ghost btn-sm" data-linkdemo="${wi}:${key}:${i}"
                         title="Choose a different demo video" style="padding:2px 8px;font-size:10px">Change</button>
                 <button type="button" class="btn btn-ghost btn-sm" data-unlinkdemo="${wi}:${key}:${i}"
                         title="Remove the demo video" style="padding:2px 8px;font-size:10px;color:var(--rose)">Unlink</button>`
              : `<button type="button" class="btn btn-ghost btn-sm" data-linkdemo="${wi}:${key}:${i}"
                         title="Attach a demo video from the library — keeps this exercise name" style="padding:2px 8px;font-size:10px">▶ Link demo</button>
                 <span style="color:var(--text-tertiary)">no demo video</span>`}
          </div>
          ${f('notes', ex.notes, 'Coaching notes', 'font-size:12px')}
          <div data-suggest="${wi}:${key}:${i}" class="hidden"
               style="position:absolute;left:0;right:78px;top:36px;background:var(--bg-raised,#0f172a);
                      border:1px solid var(--border-subtle);border-radius:8px;max-height:220px;
                      overflow:auto;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.45)"></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${f('sets',  ex.sets,  'Sets',  'width:56px')}
          ${f('reps',  ex.reps,  'Reps',  'width:88px')}
          ${f('tempo', ex.tempo, 'Tempo', 'width:70px')}
          ${f('rest',  ex.rest,  'Rest',  'width:56px')}
        </div>
        <div style="display:flex;flex-direction:column;gap:2px">
          <button class="btn btn-ghost btn-sm" data-up="${wi}:${key}:${i}" title="Move up" style="padding:1px 8px;line-height:1.2">▲</button>
          <button class="btn btn-ghost btn-sm" data-down="${wi}:${key}:${i}" title="Move down" style="padding:1px 8px;line-height:1.2">▼</button>
        </div>
        <button class="btn btn-ghost btn-sm" data-rm="${wi}:${key}:${i}" title="Remove"
          style="color:var(--rose);padding:6px 9px">✕</button>
      </div>`;
  }

  function _wireSection(wi, key) {
    const panel = document.getElementById('pp-program');
    // ── field edits ────────────────────────────────────────────
    panel.querySelectorAll(`[data-w="${wi}"][data-ex="${key}"]`).forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = +inp.dataset.i, fld = inp.dataset.f;
        const arr = _program.workouts[wi][key];
        if (!arr[i]) return;
        arr[i][fld] = inp.value;
        // Feature 5 — autosuggest on the name field. Library row click
        // sets exercise_id; manual typing alone keeps the link unless
        // the name is cleared completely.
        if (fld === 'name') {
          if (!inp.value.trim()) arr[i].exercise_id = null;
          _renderSuggest(wi, key, i, inp);
        }
      });
      // Hide suggestions on blur (delay so row clicks register).
      if (inp.dataset.f === 'name') {
        inp.addEventListener('blur', () => {
          setTimeout(() => _hideSuggest(wi, key, i_of(inp)), 180);
        });
      }
    });
    // ── add ───────────────────────────────────────────────────
    panel.querySelector(`[data-add="${wi}:${key}"]`)?.addEventListener('click', () => {
      _program.workouts[wi][key].push({
        exercise_id: null, name: '', sets: '', reps: '', tempo: '', rest: '', notes: '',
      });
      _drawProgram();
    });
    // ── remove ────────────────────────────────────────────────
    panel.querySelectorAll(`[data-rm^="${wi}:${key}:"]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.rm.split(':')[2];
        _program.workouts[wi][key].splice(i, 1);
        _drawProgram();
      });
    });
    // ── reorder (manual builder) ──────────────────────────────
    panel.querySelectorAll(`[data-up^="${wi}:${key}:"]`).forEach((btn) => {
      btn.addEventListener('click', () => _moveEx(wi, key, +btn.dataset.up.split(':')[2], -1));
    });
    panel.querySelectorAll(`[data-down^="${wi}:${key}:"]`).forEach((btn) => {
      btn.addEventListener('click', () => _moveEx(wi, key, +btn.dataset.down.split(':')[2], +1));
    });
    // ── 📚 Library button (Feature 5) ─────────────────────────
    panel.querySelectorAll(`[data-pick^="${wi}:${key}:"]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof ExercisePicker === 'undefined') {
          _toast('Library picker not loaded', 'error'); return;
        }
        const i = +btn.dataset.pick.split(':')[2];
        // Pre-seed the filter from the program's phase if known.
        const defaultFilter = (_program?.phase || '').startsWith('Phase ')
          ? 'phase' + _program.phase.replace('Phase ', '') : 'all';
        ExercisePicker.open({
          title: 'Pick exercise from Library',
          defaultFilter,
          onSelect: ({ exercise_id, exercise_name, exercise }) => {
            const row = _program.workouts[wi][key][i];
            if (!row) return;
            row.exercise_id = exercise_id;
            row.name        = exercise_name;
            row.video_url   = _snapVideo(exercise);   // Phase 13 — snapshot demo link
            _drawProgram();   // redraws → reflects link badge + new name
          },
        }).catch(() => {});  // user closed; nothing to do
      });
    });
    // ── ▶ Link demo (C1A) — attach a library demo video to a row WITHOUT
    //    renaming it. Sets exercise_id + video_url so publish snapshots the demo
    //    and the existing client Train / guided screens show the ▶ button.
    panel.querySelectorAll(`[data-linkdemo^="${wi}:${key}:"]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof ExercisePicker === 'undefined') { _toast('Library picker not loaded', 'error'); return; }
        const i = +btn.dataset.linkdemo.split(':')[2];
        const defaultFilter = (_program?.phase || '').startsWith('Phase ')
          ? 'phase' + _program.phase.replace('Phase ', '') : 'all';
        ExercisePicker.open({
          title: 'Choose a demo video',
          defaultFilter,
          onSelect: ({ exercise_id, exercise }) => {
            const row = _program.workouts[wi][key][i];
            if (!row) return;
            const v = _snapVideo(exercise);
            if (!v) { _toast('That exercise has no demo video — choose another.', 'warning'); return; }
            row.exercise_id = exercise_id;   // demo source (resolvable client-side; publish re-snapshots)
            row.video_url   = v;             // snapshot the demo link now
            _drawProgram();                  // keeps row.name — the prescribed exercise is preserved
          },
        }).catch(() => {});
      });
    });
    // ── Unlink demo — drop the demo video, return the row to free-text. ──
    panel.querySelectorAll(`[data-unlinkdemo^="${wi}:${key}:"]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.unlinkdemo.split(':')[2];
        const row = _program.workouts[wi][key][i];
        if (!row) return;
        row.exercise_id = null;
        row.video_url   = null;
        _drawProgram();
      });
    });
  }

  // Helper: pull row index from a name input
  function i_of(inp) {
    const n = parseInt(inp?.dataset?.i, 10);
    return Number.isFinite(n) ? n : 0;
  }

  // ── Autosuggest (Feature 5) — types into name input, shows matches.
  let _suggestTimer = null;
  function _renderSuggest(wi, key, i, inp) {
    if (typeof ExerciseLibrary === 'undefined') return;
    clearTimeout(_suggestTimer);
    _suggestTimer = setTimeout(async () => {
      const q = inp.value.trim();
      const suggest = document.querySelector(`[data-suggest="${wi}:${key}:${i}"]`);
      if (!suggest) return;
      if (q.length < 2) { suggest.classList.add('hidden'); return; }
      const items = (await ExerciseLibrary.loadAll({ search: q })).slice(0, 6);
      if (!items.length) { suggest.classList.add('hidden'); return; }
      suggest.innerHTML = items.map((ex) => `
        <div data-suggest-pick="${esc(ex.id)}"
             style="padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--border-subtle);font-size:12px">
          <div style="font-weight:600;color:var(--text-primary)">${esc(ex.name)}</div>
          <div style="font-size:11px;color:var(--text-tertiary)">${esc(ex.phase || '')} · ${esc(ex.category || '')}</div>
        </div>`).join('');
      suggest.classList.remove('hidden');
      suggest.querySelectorAll('[data-suggest-pick]').forEach((row) => {
        row.onmousedown = (e) => e.preventDefault();   // keep input focus
        row.onclick = () => {
          const ex = items.find((x) => x.id === row.dataset.suggestPick);
          if (!ex) return;
          const target = _program.workouts[wi][key][i];
          if (!target) return;
          target.exercise_id = ex.id;
          target.name        = ex.name;
          target.video_url   = _snapVideo(ex);   // Phase 13 — snapshot demo link
          suggest.classList.add('hidden');
          _drawProgram();
        };
      });
    }, 180);
  }
  function _hideSuggest(wi, key, i) {
    const suggest = document.querySelector(`[data-suggest="${wi}:${key}:${i}"]`);
    if (suggest) suggest.classList.add('hidden');
  }

  // ── Daily routine editor ──────────────────────────────────
  function _drawRoutine() {
    const host = document.getElementById('pp-routine');
    const tasks = _program.daily_routine_tasks || [];
    host.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--nc-gold)">Daily Routine — sent to the client tracker</span>
        <button class="btn btn-ghost btn-sm" id="pp-add-task">+ Add task</button>
      </div>
      <div data-rows="routine">
        ${tasks.map((t, i) => _taskRow(t, i)).join('')}
      </div>`;
    _wireRoutine();
  }

  function _taskRow(t, i) {
    const f = (field, val, ph, w) =>
      `<input data-task="${i}" data-f="${field}" value="${esc(val)}" placeholder="${esc(ph)}"
        class="form-input" style="${w}"/>`;
    return `
      <div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;flex-wrap:wrap;
                  padding:8px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-raised)">
        ${f('emoji', t.emoji, '🌀', 'width:46px;text-align:center;font-size:16px')}
        <div style="flex:1;min-width:170px;display:flex;flex-direction:column;gap:6px">
          ${f('label', t.label, 'Task name', 'font-weight:600')}
          <input data-task="${i}" data-f="details" value="${esc((t.details || []).join(' · '))}"
            placeholder="Steps — separate with ·" class="form-input" style="font-size:12px"/>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <select data-task="${i}" data-f="section" class="form-input" style="width:100px">
            <option value="morning" ${t.section === 'morning' ? 'selected' : ''}>Morning</option>
            <option value="evening" ${t.section === 'evening' ? 'selected' : ''}>Evening</option>
          </select>
          ${f('meta', t.meta, 'e.g. 🔁 8 reps', 'width:120px;font-size:12px')}
        </div>
        <button class="btn btn-ghost btn-sm" data-rm-task="${i}" title="Remove"
          style="color:var(--rose);padding:6px 9px">✕</button>
      </div>`;
  }

  function _wireRoutine() {
    const host = document.getElementById('pp-routine');
    host.querySelectorAll('[data-task]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = +inp.dataset.task, fld = inp.dataset.f;
        const t = _program.daily_routine_tasks[i];
        if (!t) return;
        if (fld === 'details') t.details = inp.value.split('·').map((s) => s.trim()).filter(Boolean);
        else t[fld] = inp.value;
      });
      if (inp.tagName === 'SELECT') {
        inp.addEventListener('change', () => {
          const i = +inp.dataset.task;
          if (_program.daily_routine_tasks[i]) _program.daily_routine_tasks[i].section = inp.value;
        });
      }
    });
    host.querySelector('#pp-add-task')?.addEventListener('click', () => {
      _program.daily_routine_tasks.push({
        id: _program.daily_routine_tasks.length, label: '', section: 'morning',
        emoji: '🌀', meta: '', details: [],
      });
      _drawRoutine();
    });
    host.querySelectorAll('[data-rm-task]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _program.daily_routine_tasks.splice(+btn.dataset.rmTask, 1);
        _drawRoutine();
      });
    });
  }

  // ── Preview (client view) ─────────────────────────────────
  // Honest read-only render of the IN-MEMORY program in the client's
  // day-based shape. Nothing is published — this just shows what will be.
  function _preview() {
    const p = _program;
    const workouts = p.workouts || [];
    const schedule = (p.schedule && p.schedule.length) ? p.schedule : workouts.map((w) => w.id);
    const byId = (id) => workouts.find((w) => w.id === id) || workouts[0];
    const exLine = (ex) => {
      if (!ex || !(ex.name || '').trim()) return '';
      const meta = [ex.sets && `${esc(ex.sets)} sets`, ex.reps && `${esc(ex.reps)} reps`,
        ex.tempo && `tempo ${esc(ex.tempo)}`, ex.rest && `rest ${esc(ex.rest)}`].filter(Boolean).join(' · ');
      return `<div style="padding:7px 0;border-bottom:1px solid var(--border-subtle)">
        <div style="font-weight:600;font-size:13px;color:var(--text-primary)">${esc(ex.name)}${ex.exercise_id ? ' <span style="color:var(--nc-teal,#14b8a6);font-size:10px">◈ library</span>' : ''}</div>
        ${meta ? `<div style="font-size:11px;color:var(--text-tertiary)">${meta}</div>` : ''}
        ${ex.notes ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${esc(ex.notes)}</div>` : ''}
      </div>`;
    };
    const section = (title, list) => {
      const rows = (list || []).map(exLine).filter(Boolean).join('');
      return rows ? `<div style="margin:10px 0 4px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--nc-teal)">${esc(title)}</div>${rows}` : '';
    };
    const daysHtml = schedule.map((sid, di) => {
      const wk = byId(sid);
      const body = section('Warm-up', wk.warmup) + section('Conditioning', wk.main) + section('Cool-down', wk.cooldown);
      return `<div style="margin-bottom:16px">
        <div style="font-weight:700;font-size:14px;color:var(--text-primary)">Day ${di + 1} — ${esc(wk.label || ('Workout ' + wk.id))}</div>
        ${body || '<div style="font-size:12px;color:var(--text-tertiary);padding:6px 0">No exercises yet.</div>'}
      </div>`;
    }).join('');
    const routine = (p.daily_routine_tasks || []).filter((t) => (t.label || '').trim());
    const routineHtml = routine.length
      ? `<div style="margin-top:6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--nc-gold)">Daily Routine</div>` +
        routine.map((t) => `<div style="padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:13px">${esc(t.emoji || '•')} ${esc(t.label)} <span style="color:var(--text-tertiary);font-size:11px">${esc(t.section || '')}${t.meta ? ' · ' + esc(t.meta) : ''}</span></div>`).join('')
      : '';

    let modal = document.getElementById('pp-preview-modal');
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay hidden" id="pp-preview-modal">
          <div class="modal" style="max-width:560px;max-height:84vh;overflow:auto">
            <div class="modal-header"><h3 id="pp-preview-title">Client preview</h3>
              <button class="btn-icon" onclick="document.getElementById('pp-preview-modal').classList.add('hidden')">✕</button></div>
            <div class="modal-body" id="pp-preview-body"></div>
          </div>
        </div>`);
      modal = document.getElementById('pp-preview-modal');
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    }
    modal.querySelector('#pp-preview-title').textContent = `Client preview — ${_clientName || 'client'}`;
    modal.querySelector('#pp-preview-body').innerHTML =
      `<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">How the program will appear to the client in Train. Nothing is published yet.</div>${daysHtml}${routineHtml}`;
    modal.classList.remove('hidden');
  }

  // ── Phase 6 — Program mode + revision controls ────────────
  function _modeLabel(m) {
    return m === 'ongoing_manual' ? 'Ongoing manual program'
         : m === 'ongoing_auto'  ? 'Automated (coming soon)'
         : 'One-time program';
  }
  function _currentMode() {
    const m = _selectedMode || _meta.mode || 'one_time';
    return (m === 'one_time' || m === 'ongoing_manual' || m === 'ongoing_auto') ? m : 'one_time';
  }
  function _fmtWhen(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return String(iso).slice(0, 16).replace('T', ' '); }
  }

  // Program-type selector + change-note. Re-renders only the #pp-mode block
  // (program/routine editors keep their unsaved state).
  function _drawMode() {
    const host = document.getElementById('pp-mode');
    if (!host) return;
    const mode = _currentMode();
    _selectedMode = mode;
    const chip = (val, label, sub, disabled) => {
      const active = mode === val;
      return `<button type="button" data-pp-mode="${val}" ${disabled ? 'disabled' : ''}
        style="flex:1;min-width:150px;text-align:left;padding:10px 12px;border-radius:10px;cursor:${disabled ? 'not-allowed' : 'pointer'};
               background:${active ? 'rgba(20,184,166,.12)' : 'var(--bg-raised)'};
               border:1px solid ${active ? 'rgba(20,184,166,.45)' : 'var(--border-subtle)'};opacity:${disabled ? '.55' : '1'}">
        <div style="font-weight:700;font-size:13px;color:${active ? 'var(--nc-teal)' : 'var(--text-primary)'}">${esc(label)}</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${esc(sub)}</div>
      </button>`;
    };
    host.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-secondary);margin-bottom:7px">Program type</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${chip('one_time', 'One-time program', 'Fixed published snapshot — warns before replacing.')}
          ${chip('ongoing_manual', 'Ongoing manual program', 'Live plan — saved edits reach the client immediately.')}
          ${chip('ongoing_auto', 'Automated', 'Coach-approved AI updates — coming soon.', true)}
        </div>
        <div id="pp-mode-meta" style="margin-top:9px;font-size:12px;color:var(--text-tertiary)"></div>
        <input id="pp-change-note" class="form-input" placeholder="Change note (optional) — what changed in this update?"
          value="${esc(_changeNote || '')}" style="margin-top:10px;font-size:12px"/>
      </div>`;
    host.querySelectorAll('[data-pp-mode]').forEach((b) => {
      if (b.disabled) return;
      b.addEventListener('click', () => {
        _selectedMode = b.dataset.ppMode;
        _drawMode();
        _syncPublishUi();
      });
    });
    const note = host.querySelector('#pp-change-note');
    if (note) note.addEventListener('input', () => { _changeNote = note.value; });
    _renderModeMeta();
  }

  function _renderModeMeta() {
    const el = document.getElementById('pp-mode-meta');
    if (!el) return;
    if (!_meta.loaded) { el.textContent = ''; return; }
    if (!_meta.exists) { el.innerHTML = '<span>No program published to this client yet.</span>'; return; }
    const live  = _currentMode() === 'ongoing_manual';
    const badge = live
      ? '<span class="badge" style="background:rgba(20,184,166,.14);color:var(--nc-teal);border:1px solid rgba(20,184,166,.3)">● Live program</span>'
      : '<span class="badge" style="background:rgba(245,200,66,.14);color:var(--nc-gold);border:1px solid rgba(245,200,66,.3)">Published snapshot</span>';
    el.innerHTML = `${badge} <span style="margin-left:6px">Current: <b>${esc(_modeLabel(_meta.mode))}</b> · revision ${_meta.revision} · last updated ${esc(_fmtWhen(_meta.updatedAt))}</span>`;
  }

  // Publish button copy follows the selected timing + mode — never ambiguous.
  function _syncPublishUi() {
    const btn = document.getElementById('pp-publish');
    if (!btn || btn.disabled) return;
    if (_startMode === 'date') { btn.innerHTML = '📅 Schedule update'; return; }
    if (_startMode === 'next') { btn.innerHTML = '📤 Publish (from next session)'; return; }
    btn.innerHTML = _currentMode() === 'ongoing_manual' ? '💾 Save live update' : '📤 Publish snapshot';
  }

  // ── Phase E1b-2 — effective-date scheduling control ──────────
  //   Lets the coach choose WHEN an edited program takes effect. Writes to the
  //   live client_program_versions table on publish (see _publish). "Next" and
  //   "On a date" require an already-published program (they leave the
  //   client_programs pointer in place; the serving overlay needs that pointer
  //   to be published — see resolveClientProgram).
  function _drawSchedule() {
    const host = document.getElementById('pp-schedule');
    if (!host) return;
    const canSchedule = !!(_meta.exists && _meta.published);
    if (_startMode !== 'now' && !canSchedule) { _startMode = 'now'; }   // guard
    const chip = (val, label, sub, disabled) => {
      const active = _startMode === val;
      return `<button type="button" data-pp-start="${val}" ${disabled ? 'disabled' : ''}
        style="flex:1;min-width:150px;text-align:left;padding:10px 12px;border-radius:10px;cursor:${disabled ? 'not-allowed' : 'pointer'};
               background:${active ? 'rgba(20,184,166,.12)' : 'var(--bg-raised)'};
               border:1px solid ${active ? 'rgba(20,184,166,.45)' : 'var(--border-subtle)'};opacity:${disabled ? '.5' : '1'}">
        <div style="font-weight:700;font-size:13px;color:${active ? 'var(--nc-teal)' : 'var(--text-primary)'}">${esc(label)}</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${esc(sub)}</div>
      </button>`;
    };
    // Minimum schedulable date = tomorrow (local).
    const tmrw = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    host.innerHTML = `
      <div style="border-top:1px solid var(--border-subtle);padding-top:14px">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-secondary);margin-bottom:7px">When should this take effect?</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${chip('now',  'Apply now',          'Client sees it on their next open.')}
          ${chip('next', 'From next session',  "Won't disturb an in-progress workout.", !canSchedule)}
          ${chip('date', 'On a date',          'Schedule a future start.',              !canSchedule)}
        </div>
        ${!canSchedule ? '<div style="font-size:11px;color:var(--text-tertiary);margin-top:6px">Publish a program first to schedule future changes.</div>' : ''}
        <div id="pp-start-date-wrap" style="${_startMode === 'date' ? '' : 'display:none;'}margin-top:9px">
          <input type="date" id="pp-start-date" class="form-input" min="${tmrw}" value="${esc(_startDate || '')}"
            style="max-width:200px;font-size:13px"/>
          <span style="font-size:11px;color:var(--text-tertiary);margin-left:8px">Client keeps their current plan until this date.</span>
        </div>
        <div id="pp-scheduled-list" style="margin-top:12px"></div>
      </div>`;
    host.querySelectorAll('[data-pp-start]').forEach((b) => {
      if (b.disabled) return;
      b.addEventListener('click', () => {
        _startMode = b.dataset.ppStart;
        _drawSchedule();
        _syncPublishUi();
      });
    });
    const dateInput = host.querySelector('#pp-start-date');
    if (dateInput) dateInput.addEventListener('input', () => { _startDate = dateInput.value; });
    _loadScheduledVersions();
  }

  // List the coach/admin-visible FUTURE scheduled versions for this client.
  // RLS scopes this to the assigned coach / admin; the client never sees it.
  async function _loadScheduledVersions() {
    const el = document.getElementById('pp-scheduled-list');
    if (!el) return;
    if (!_clientId || typeof sb === 'undefined' || !sb) { el.innerHTML = ''; return; }
    let rows = [];
    try {
      const { data, error } = await sb.from('client_program_versions')
        .select('id, effective_from, status, change_note')
        .eq('client_id', _clientId)
        .gt('effective_from', new Date().toISOString())
        .order('effective_from', { ascending: true });
      if (error) throw error;
      rows = data || [];
    } catch (e) { console.warn('[schedule] list load:', e?.message); el.innerHTML = ''; return; }
    if (!rows.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--text-secondary);margin-bottom:6px">Scheduled changes</div>
      ${rows.map((v) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--bg-raised);margin-bottom:7px">
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;font-weight:600;color:var(--text-primary)">Starts ${esc(_fmtWhen(v.effective_from))}</div>
            ${v.change_note ? `<div style="font-size:11px;color:var(--text-tertiary)">${esc(v.change_note)}</div>` : ''}
          </div>
          <button class="btn btn-ghost btn-sm" data-cancel-ver="${esc(v.id)}">Cancel</button>
        </div>`).join('')}`;
    el.querySelectorAll('[data-cancel-ver]').forEach((b) =>
      b.addEventListener('click', () => _cancelScheduledVersion(b.dataset.cancelVer)));
  }

  async function _cancelScheduledVersion(id) {
    if (!id) return;
    if (!confirm('Cancel this scheduled program change? The client keeps their current plan.')) return;
    try {
      const { error } = await sb.from('client_program_versions').delete().eq('id', id);
      if (error) throw error;
      _toast('Scheduled change cancelled.', 'success');
    } catch (e) { _toast('Could not cancel: ' + (e.message || e), 'error'); }
    _loadScheduledVersions();
  }

  // Load this client's current program metadata (mode/revision/updated_at)
  // so the coach sees live state and the right mode is pre-selected.
  async function _loadMeta(clientId) {
    _meta = { loaded: false, exists: false, mode: 'one_time', revision: 0, updatedAt: null, published: false, programId: null };
    if (clientId && typeof sb !== 'undefined' && sb) {
      try {
        const { data } = await sb.from('client_programs')
          .select('id, program_mode, revision, updated_at, published')
          .eq('client_id', clientId).maybeSingle();
        if (data) {
          _meta = { loaded: true, exists: true, mode: data.program_mode || 'one_time',
                    revision: data.revision || 1, updatedAt: data.updated_at, published: !!data.published,
                    programId: data.id || null };
          _selectedMode = _meta.mode;   // adopt the existing mode at load
        } else {
          _meta.loaded = true;
        }
      } catch (e) { console.warn('[publish] meta load:', e?.message); _meta.loaded = true; }
    } else {
      _meta.loaded = true;
    }
    _drawMode();
    _drawSchedule();   // scheduling options depend on whether a program is already published
    _syncPublishUi();
  }

  // ── Phase 6 — Copy a program from another client (draft, never publishes) ──
  //   RLS scopes the list: a coach sees only their assigned clients' programs;
  //   an admin sees all; a client never reaches this editor. The chosen program
  //   is cloned into the CURRENT client's builder for editing before publishing.
  async function _openCopyFrom() {
    if (!_clientId) { _toast('Pick a target client first.', 'error'); return; }
    if (typeof sb === 'undefined' || !sb) { _toast('Not connected to the database.', 'error'); return; }
    let rows = [];
    try {
      const { data, error } = await sb.from('client_programs')
        .select('client_id, program, updated_at, profiles!client_programs_client_id_fkey(full_name,email)')
        .eq('published', true)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      rows = (data || []).filter((r) => r.client_id !== _clientId
        && r.program && (Array.isArray(r.program.workouts) || r.program.structure));
    } catch (e) { _toast('Could not load programs: ' + (e.message || e), 'error'); return; }
    if (!rows.length) { _toast('No other client programs available to copy.', 'info'); return; }

    let modal = document.getElementById('pp-copy-modal');
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay hidden" id="pp-copy-modal">
          <div class="modal" style="max-width:480px;max-height:80vh;overflow:auto">
            <div class="modal-header"><h3>Load program from another client</h3>
              <button class="btn-icon" onclick="document.getElementById('pp-copy-modal').classList.add('hidden')">✕</button></div>
            <div class="modal-body" id="pp-copy-body"></div>
          </div>
        </div>`);
      modal = document.getElementById('pp-copy-modal');
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    }
    const body = modal.querySelector('#pp-copy-body');
    body.innerHTML = `
      <div class="form-hint" style="margin-bottom:12px">Pick a source program. It loads into ${esc(_clientName || 'this client')}'s builder as an editable draft — nothing publishes until you do.</div>
      ${rows.map((r) => {
        const nm = r.profiles?.full_name || r.profiles?.email || 'Client';
        const days = Array.isArray(r.program.workouts) ? r.program.workouts.length : 1;
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--bg-raised);margin-bottom:8px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;color:var(--text-primary)">${esc(nm)}</div>
            <div style="font-size:11px;color:var(--text-tertiary)">${esc(r.program.phase || 'Program')} · ${days} day${days === 1 ? '' : 's'} · updated ${esc(_fmtWhen(r.updated_at))}</div>
          </div>
          <button class="btn btn-teal btn-sm" data-copy-src="${esc(r.client_id)}">Use</button>
        </div>`;
      }).join('')}`;
    body.querySelectorAll('[data-copy-src]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const src = rows.find((r) => r.client_id === btn.dataset.copySrc);
        if (!src) return;
        if (!confirm(`Replace the current builder content with this program?\n\nYou can edit it before publishing to ${_clientName || 'the client'}.`)) return;
        let clone;
        try { clone = JSON.parse(JSON.stringify(src.program)); }
        catch { _toast('Could not copy this program.', 'error'); return; }
        // Defensive: never carry mode/note inside the program jsonb (older
        // rows may have them; they belong in dedicated columns).
        delete clone.program_mode; delete clone.change_note;
        modal.classList.add('hidden');
        render({ program: clone, clientId: _clientId, clientName: _clientName });
        _toast('Program loaded as a draft — edit, then publish.', 'success');
      });
    });
    modal.classList.remove('hidden');
  }

  // ── Phase 13 — video snapshot (publish-time + on-pick) ────
  // We store each exercise's demo `video_url` directly in the published
  // program JSON so client Train and the PDF have a stable link even if the
  // library row later changes or can't be resolved. Picking from the library
  // snapshots immediately (_snapVideo); publishing backfills the rest.
  function _snapVideo(ex) {
    const u = ex && ex.video_url;
    if (!u) return null;
    return (typeof ExerciseLibrary !== 'undefined' && ExerciseLibrary.sanitizeUrl)
      ? ExerciseLibrary.sanitizeUrl(u) : u;
  }
  function _normName(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Walk the program and ensure every exercise row carries its demo link:
  //   • library-linked rows (exercise_id) → snapshot the library video_url
  //   • free-text rows (generated programs) → attach ONLY on a unique,
  //     normalized-exact name match against the library (never fuzzy/ambiguous)
  // Returns { total, linked, matched } for honest reporting.
  async function _snapshotVideos(program) {
    const out = { total: 0, linked: 0, matched: 0 };
    if (typeof ExerciseLibrary === 'undefined') return out;
    let lib = [];
    try { lib = await ExerciseLibrary.loadAll(); } catch { return out; }
    const byId   = new Map(lib.map((e) => [e.id, e]));
    const byName = new Map();
    lib.forEach((e) => {
      const k = _normName(e.name);
      if (!k) return;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(e);
    });
    (program.workouts || []).forEach((wk) => {
      ['warmup', 'main', 'cooldown'].forEach((g) => {
        (wk[g] || []).forEach((ex) => {
          if (!ex || !(ex.name || '').trim()) return;
          out.total++;
          if (ex.exercise_id && byId.has(ex.exercise_id)) {
            const v = _snapVideo(byId.get(ex.exercise_id));
            if (v) { ex.video_url = v; out.linked++; }
            return;
          }
          if (!ex.exercise_id) {
            const matches = byName.get(_normName(ex.name)) || [];
            const v = matches.length === 1 ? _snapVideo(matches[0]) : null;
            if (v) { ex.exercise_id = matches[0].id; ex.video_url = v; out.matched++; }
          }
        });
      });
    });
    return out;
  }

  // ── Publish ───────────────────────────────────────────────
  async function _publish() {
    const btn = document.getElementById('pp-publish');
    const status = document.getElementById('pp-status');
    if (!_clientId) {
      _toast('No client selected — pick a client in the Client Info tab.', 'error');
      return;
    }
    if (typeof sb === 'undefined' || !sb) {
      _toast('Not connected to the database.', 'error');
      return;
    }

    // Phase 6 — resolve mode + change note for this publish (kept off the
    // program jsonb; persisted to dedicated columns by the upsert below).
    const mode = _currentMode();
    const changeNote = ((document.getElementById('pp-change-note')?.value ?? _changeNote) || '').trim() || null;

    // ── Phase E1b-2 — resolve the effective timing for this publish ──
    //   now  → version effective now + update the client_programs pointer
    //   next → version effective now, pointer untouched (in-progress session
    //          keeps its snapshot; the client's next session resolves the new
    //          plan via resolveClientProgram)
    //   date → scheduled version with a future effective_from; pointer untouched
    //          (RLS hides it from the client until due)
    let startMode = _startMode || 'now';
    const canSchedule = !!(_meta.exists && _meta.published);
    if (startMode !== 'now' && !canSchedule) {
      if (startMode === 'date') { _toast('Publish a program first before scheduling a future change.', 'error'); return; }
      startMode = 'now';   // 'next' with no current program is just an immediate publish
    }
    const now = new Date().toISOString();
    let effectiveFrom = now;
    let isScheduled = false;
    const updatePointer = (startMode === 'now');
    if (startMode === 'date') {
      const d = _startDate ? new Date(_startDate + 'T00:00:00') : null;   // client-local start of day
      if (!d || isNaN(d.getTime())) { _toast('Pick a valid start date.', 'error'); return; }
      if (d.getTime() <= Date.now()) { _toast('Choose a future date for a scheduled change.', 'error'); return; }
      effectiveFrom = d.toISOString();
      isScheduled = true;
    }

    // Confirmations: apply-now to a one-time program replaces the live view;
    // a scheduled change is gentler (current plan stays until the date).
    if (updatePointer && mode === 'one_time' && _meta.exists && _meta.published) {
      if (!confirm(`This replaces ${_clientName || 'the client'}'s current published program (revision ${_meta.revision}).\n\nThe new plan becomes what they see now. Completed workout history is preserved. Continue?`)) {
        return;
      }
    } else if (isScheduled) {
      if (!confirm(`Schedule this program to start on ${_fmtWhen(effectiveFrom)}?\n\n${_clientName || 'The client'} keeps their current plan until then. Completed workout history is preserved.`)) {
        return;
      }
    }

    // Re-id the routine tasks 0..N so the client tracker keys stay stable.
    _program.daily_routine_tasks.forEach((t, i) => { t.id = i; });

    // Phase 13 — snapshot demo videos into the program before it is stored
    // (preserves exercise_id + video_url + Link Demo rows inside the version).
    let snap = { total: 0, linked: 0, matched: 0 };
    try { snap = await _snapshotVideos(_program); }
    catch (e) { console.warn('[publish] video snapshot skipped:', e?.message); }
    console.info(`[publish] video snapshot — linked ${snap.linked}, name-matched ${snap.matched} of ${snap.total} exercise(s)`);

    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> ' + (isScheduled ? 'Scheduling…' : 'Publishing…');
    if (status) { status.textContent = ''; status.style.color = 'var(--text-tertiary)'; }

    let coachId = null;
    try { coachId = Auth.getUser()?.id || null; } catch {}

    try {
      // Phase E1b-2 — every publish writes a version row (the timeline of record).
      const verRes = await sb.from('client_program_versions').insert({
        client_id:         _clientId,
        coach_id:          coachId,
        program:           _program,
        effective_from:    effectiveFrom,
        status:            isScheduled ? 'scheduled' : 'active',
        published:         true,
        source_program_id: _meta.programId || null,
        source_revision:   _meta.revision || null,
        change_note:       changeNote,
        created_by:        coachId,
        published_at:      now,
      });
      if (verRes.error) throw verRes.error;

      // Apply-now also updates the live client_programs pointer + routine, and
      // runs the substitution sweep — preserving the prior publish behavior.
      // Scheduled / next-session versions intentionally leave the pointer in
      // place (the serving overlay resolves the version when it is due).
      if (updatePointer) {
        const progRes = await sb.from('client_programs').upsert({
          client_id: _clientId, coach_id: coachId,
          program: _program, published: true, published_at: now, updated_at: now,
          program_mode: mode, change_note: changeNote,   // Phase 6 — trigger versions it
        }, { onConflict: 'client_id' });
        if (progRes.error) throw progRes.error;

        const routRes = await sb.from('client_routines').upsert({
          client_id: _clientId, coach_id: coachId,
          tasks: _program.daily_routine_tasks, published: true, published_at: now, updated_at: now,
        }, { onConflict: 'client_id' });
        if (routRes.error) throw routRes.error;

        // ── Feature 6 — republish sweep (Q2) ──────────────────────────
        // Auto-close all active substitutions for this client when a new
        // program is published. A stale (workout_key, exercise_index)
        // substitution from the prior program could otherwise swap the
        // wrong exercise in the new one. We set status='declined' so the
        // existing tg_aer_notify_client trigger fires once per closed
        // request, with body "Closed — Program Republished" per user spec.
        // Non-fatal — publish has already succeeded.
        try {
          const { data: closedRows, error: sweepErr } = await sb
            .from('exercise_alternative_requests')
            .update({
              status:                 'declined',
              substitute_exercise_id: null,
              coach_response:         'Closed — Program Republished',
              responded_at:           now,
            })
            .eq('client_id', _clientId)
            .eq('status',    'addressed')
            .not('substitute_exercise_id', 'is', null)
            .select('id');
          if (sweepErr) {
            console.warn('[publish] substitution sweep:', sweepErr.message);
          } else if (closedRows && closedRows.length) {
            console.info(`[publish] closed ${closedRows.length} active substitution(s) on republish`);
          }
        } catch (sweepEx) {
          console.warn('[publish] substitution sweep threw:', sweepEx?.message);
        }
      }

      const okMsg = isScheduled
        ? `Scheduled — ${_clientName || 'the client'} starts the new plan ${_fmtWhen(effectiveFrom)}`
        : startMode === 'next'
          ? `Update saved — ${_clientName || 'the client'} sees it from their next session`
          : mode === 'ongoing_manual'
            ? `Live program updated — ${_clientName || 'the client'} sees it now`
            : `Program published to ${_clientName || 'the client'}`;
      if (status) { status.textContent = '✓ ' + okMsg; status.style.color = 'var(--lime, #16a34a)'; }
      _toast(okMsg + ' ✓', 'success');
    } catch (e) {
      console.error('[publish] failed:', e);
      let msg = e.message || e.code || 'unknown error';
      if (e.code === '23505' || /duplicate key|unique/i.test(msg)) {
        msg = 'a change is already scheduled for that time — pick another date';
      }
      if (status) { status.textContent = `Publish failed: ${msg}`; status.style.color = '#FCA5A5'; }
      _toast('Publish failed: ' + msg, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHTML;
    }
    _loadMeta(_clientId);   // refresh the mode/revision badge + scheduled list
  }

  // ── Client side ───────────────────────────────────────────
  //   The legacy stacked "My Program" renderer (renderClientProgram) was
  //   removed in the F-1 cleanup — clients now use the day-based
  //   ClientProgram (CX1), mounted from the Train tab. The shared data
  //   resolver below stays here and is reused by ClientProgram.
  //   (resolveClientProgram is defined above, near getProgram.)

  window.ProgramPublish = { render, getProgram, resolveClientProgram };
})();
