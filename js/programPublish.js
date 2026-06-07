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
  //   Single source of truth reused by renderClientProgram (legacy stacked
  //   view) AND the day-based ClientProgram (CX1) — so the F5/F6 resolution
  //   is never duplicated.
  async function resolveClientProgram(clientId) {
    if (!clientId) { try { clientId = Auth.getUser()?.id; } catch {} }
    if (!clientId) return { ok: false, reason: 'no-auth' };
    if (typeof sb === 'undefined' || !sb) return { ok: false, reason: 'no-db' };

    let row = null;
    try {
      const { data, error } = await sb.from('client_programs')
        .select('id, program, published, published_at').eq('client_id', clientId).maybeSingle();
      if (error) throw error;
      row = data;
    } catch (e) {
      return { ok: false, reason: 'load-error', message: e.message };
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

        <div id="pp-program"></div>
        <div id="pp-routine" style="margin-top:18px"></div>

        <div style="display:flex;gap:10px;align-items:center;margin-top:20px;flex-wrap:wrap">
          <button class="btn btn-primary" id="pp-publish">📤 Publish to Client</button>
          <button class="btn btn-ghost" id="pp-revert">↺ Revert edits</button>
          <span id="pp-status" style="font-size:12px;color:var(--text-tertiary)"></span>
        </div>
      </div>`;

    _drawProgram();
    _drawRoutine();

    panel.querySelector('#pp-publish').addEventListener('click', _publish);
    panel.querySelector('#pp-revert').addEventListener('click', () => {
      if (confirm('Revert all edits to the generated program?')) {
        _toast('Re-generate to reset — edits kept for now.', 'info');
      }
    });
  }

  // ── Program structure editor (workout-split aware) ────────
  function _drawProgram() {
    const host = document.getElementById('pp-program');
    const workouts = _program.workouts || [];
    const schedule = _program.schedule || [];
    host.innerHTML = `
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--nc-teal);margin-bottom:6px">
        Training Program${_program.split_label ? ' — ' + esc(_program.split_label) : ''}
      </div>
      ${_scheduleStrip(schedule)}
      ${workouts.map((wk, wi) => _workoutEditor(wi, wk)).join('')}
    `;
    workouts.forEach((wk, wi) => {
      ['warmup', 'main', 'cooldown'].forEach((key) => _wireSection(wi, key));
      const lbl = host.querySelector(`[data-wlabel="${wi}"]`);
      if (lbl) lbl.addEventListener('input', () => { _program.workouts[wi].label = lbl.value; });
    });
  }

  // Weekly schedule chips — Day 1 → A, Day 2 → B, …
  function _scheduleStrip(schedule) {
    if (!schedule.length) return '';
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      ${schedule.map((id, i) => `
        <span style="font-size:11px;padding:4px 11px;border-radius:20px;background:var(--bg-raised);
                     border:1px solid var(--border-subtle);color:var(--text-secondary)">
          Day ${i + 1} · <b style="color:var(--nc-teal)">Workout ${esc(id)}</b>
        </span>`).join('')}
    </div>`;
  }

  function _workoutEditor(wi, wk) {
    return `
      <div style="margin-bottom:18px;border:1px solid var(--border-subtle);border-radius:10px;
                  padding:12px;background:rgba(255,255,255,.015)">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">
          <span style="width:26px;height:26px;border-radius:7px;background:rgba(20,184,166,.16);
                       border:1px solid rgba(20,184,166,.35);color:var(--nc-teal);font-weight:700;
                       font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${esc(wk.id)}</span>
          <input data-wlabel="${wi}" value="${esc(wk.label || ('Workout ' + wk.id))}"
            class="form-input" style="max-width:240px;font-weight:600"/>
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
          onSelect: ({ exercise_id, exercise_name }) => {
            const row = _program.workouts[wi][key][i];
            if (!row) return;
            row.exercise_id = exercise_id;
            row.name        = exercise_name;
            _drawProgram();   // redraws → reflects link badge + new name
          },
        }).catch(() => {});  // user closed; nothing to do
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
    // Re-id the routine tasks 0..N so the client tracker keys stay stable.
    _program.daily_routine_tasks.forEach((t, i) => { t.id = i; });

    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Publishing…';
    if (status) { status.textContent = ''; status.style.color = 'var(--text-tertiary)'; }

    let coachId = null;
    try { coachId = Auth.getUser()?.id || null; } catch {}
    const now = new Date().toISOString();

    try {
      const progRes = await sb.from('client_programs').upsert({
        client_id: _clientId, coach_id: coachId,
        program: _program, published: true, published_at: now, updated_at: now,
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

      if (status) { status.textContent = `✓ Published to ${_clientName || 'client'} — they can see it now.`; status.style.color = 'var(--lime, #16a34a)'; }
      _toast('Program & daily routine published to the client ✓', 'success');
    } catch (e) {
      console.error('[publish] failed:', e);
      const msg = e.message || e.code || 'unknown error';
      if (status) { status.textContent = `Publish failed: ${msg}`; status.style.color = '#FCA5A5'; }
      _toast('Publish failed: ' + msg, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHTML;
    }
  }

  // ── Client side — read-only "My Program" view ─────────────
  async function renderClientProgram(container) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) return;
    host.innerHTML = `<div class="card"><p style="color:var(--text-tertiary);font-size:13px">
      <span class="spinner spinner-sm" style="margin-right:6px;vertical-align:-2px"></span>Loading your program…</p></div>`;

    let clientId = null;
    try { clientId = Auth.getUser()?.id; } catch {}

    // Resolve via the shared resolver (legacy back-fill + F6 subs + F5 libMap).
    const res = await resolveClientProgram(clientId);
    if (!res.ok) {
      if (res.reason === 'empty') {
        host.innerHTML = `<div class="card"><div class="empty-state">
        <span class="empty-icon">◈</span>
        <div class="empty-title">No program published yet</div>
        <p class="empty-desc">Your coach hasn't published a training program for you yet. Check back soon.</p>
      </div></div>`;
      } else if (res.reason === 'load-error') {
        host.innerHTML = `<div class="card"><p style="color:#FCA5A5;font-size:13px">Could not load your program: ${esc(res.message || '')}</p></div>`;
      } else if (res.reason === 'no-db') {
        host.innerHTML = `<div class="card"><p style="font-size:13px;color:var(--text-tertiary)">Not connected to the database.</p></div>`;
      } else {
        host.innerHTML = `<div class="card"><p style="font-size:13px;color:var(--text-tertiary)">Sign in to view your program.</p></div>`;
      }
      return;
    }
    const { row, p, workouts, schedule, libMap } = res;
    const _exMeta = (ex) => (ex && ex.exercise_id) ? (libMap.get(ex.exercise_id) || null) : null;

    const roSection = (title, list, color) => {
      if (!list || !list.length) return '';
      return `
        <div style="margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${color};padding:8px 0 4px;border-bottom:1px solid ${color}33">${esc(title)}</div>
          ${list.map((ex, i) => _roExerciseRow(ex, i, color, _exMeta(ex))).join('')}
        </div>`;
    };

    // Feature 5 — exercise row with optional thumbnail/preview/instructions.
    // Legacy rows (no exercise_id, no metadata) render as before — same
    // grid + same fields — so existing programs are unaffected.
    function _roExerciseRow(ex, i, color, meta) {
      const thumb = _thumbHTML(meta);
      const hasInstructions = meta && typeof ExerciseInstructions !== 'undefined'
        && ExerciseInstructions.build(meta).hasContent;
      const previewBtn = meta && meta.video_url
        ? `<button type="button" class="btn btn-ghost btn-xs" data-cp-preview="${esc(meta.id)}" data-cp-name="${esc(meta.name)}"
                  data-cp-url="${esc(meta.video_url)}"
                  style="padding:3px 8px;font-size:11px">▶ Preview</button>`
        : '';
      const instrBtn = hasInstructions
        ? `<button type="button" class="btn btn-ghost btn-xs" data-cp-info="${esc(meta.id)}-${esc(String(i))}"
                  style="padding:3px 8px;font-size:11px">ℹ Instructions</button>`
        : '';
      // ── Feature 6 — "🔄 Substituted" tooltip badge ──
      //   Per Q3: client sees only the substitute exercise name; the
      //   ORIGINAL name + coach response live in the tooltip on the badge.
      const subBadge = (ex && ex._substitutedFrom) ? `
        <span class="cp-sub-badge"
              title="Originally: ${esc(ex._substitutedFrom)}${ex._substituteResponse ? ' — ' + esc(ex._substituteResponse) : ''}"
              style="display:inline-flex;align-items:center;gap:4px;margin-left:6px;
                     padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600;
                     background:rgba(20,184,166,.14);color:var(--nc-teal,#14b8a6);
                     border:1px solid rgba(20,184,166,.35);cursor:help;vertical-align:1px">
          🔄 Substituted
        </span>` : '';

      return `
        <div class="cp-row" style="display:grid;grid-template-columns:auto auto 1fr auto;gap:10px 14px;align-items:start;padding:10px 0;border-bottom:1px solid var(--border-subtle)">
          <div style="width:22px;height:22px;border-radius:50%;background:${color}1f;border:1px solid ${color}44;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${color};flex-shrink:0;margin-top:1px">${i + 1}</div>
          ${thumb}
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(ex.name || 'Exercise')}${subBadge}</div>
            ${ex.notes ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;line-height:1.4">${esc(ex.notes)}</div>` : ''}
            ${(previewBtn || instrBtn) ? `<div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">${previewBtn}${instrBtn}</div>` : ''}
            <div data-cp-inline="${esc((meta && meta.id) || '')}-${esc(String(i))}" class="hidden"
                 style="margin-top:8px;border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden"></div>
            <div data-cp-instr="${esc((meta && meta.id) || '')}-${esc(String(i))}" class="hidden" style="margin-top:8px"></div>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;text-align:right">
            ${ex.sets ? `<b style="color:${color}">${esc(ex.sets)}</b> sets` : ''}
            ${ex.reps ? ` · ${esc(ex.reps)}` : ''}
            ${ex.tempo ? `<br/><span style="font-size:11px;color:var(--text-tertiary)">tempo ${esc(ex.tempo)}${ex.rest ? ' · rest ' + esc(ex.rest) : ''}</span>` : ''}
          </div>
        </div>`;
    }

    function _thumbHTML(meta) {
      if (!meta) return `<div style="width:60px"></div>`;  // keep grid aligned
      const url = meta.thumbnail_url
        || (meta.video_url && typeof ExerciseLibrary?.getThumbnailUrl === 'function'
            ? ExerciseLibrary.getThumbnailUrl(meta.video_url) : null);
      if (url) {
        return `<img src="${esc(url)}" alt="" loading="lazy"
                 style="width:60px;height:42px;object-fit:cover;border-radius:5px;background:#0f172a;cursor:pointer"
                 data-cp-preview="${esc(meta.id)}" data-cp-name="${esc(meta.name)}"
                 data-cp-url="${esc(meta.video_url || '')}">`;
      }
      return `<div style="width:60px;height:42px;border-radius:5px;background:rgba(255,255,255,.04);
                          display:flex;align-items:center;justify-content:center;color:#475569;font-size:14px">▶</div>`;
    }

    const pubDate = row.published_at ? new Date(row.published_at).toLocaleDateString() : '';

    // Weekly schedule chips
    const scheduleHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
        ${schedule.map((id, i) => `
          <span style="font-size:11px;padding:5px 12px;border-radius:20px;background:var(--bg-raised);
                       border:1px solid var(--border-subtle);color:var(--text-secondary)">
            Day ${i + 1} · <b style="color:var(--nc-teal)">Workout ${esc(id)}</b>
          </span>`).join('')}
      </div>`;

    // Each distinct workout, read-only — plus a tracker slot that
    // WorkoutSession.mountWorkouts() takes over after render.
    const workoutHTML = workouts.map((wk) => `
      <div class="ws-workout-card" data-workout-key="${esc(wk.id)}"
           style="margin-bottom:20px;border:1px solid var(--border-subtle);border-radius:12px;padding:14px 16px;background:rgba(255,255,255,.015)">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
          <span style="width:26px;height:26px;border-radius:7px;background:rgba(20,184,166,.16);
                       border:1px solid rgba(20,184,166,.35);color:var(--nc-teal);font-weight:700;
                       font-size:13px;display:flex;align-items:center;justify-content:center">${esc(wk.id)}</span>
          <span style="font-size:15px;font-weight:600;color:var(--text-primary)">${esc(wk.label || ('Workout ' + wk.id))}</span>
        </div>
        ${roSection('Warm-Up', wk.warmup, 'var(--nc-teal)')}
        ${roSection('Conditioning / Correctives', wk.main, 'var(--nc-gold, #D4AF37)')}
        ${roSection('Cool-Down', wk.cooldown, '#5A9BD4')}
        <!-- WorkoutSession tracker (Start/Finish + per-exercise log) -->
        <div data-workout-tracker-host="${esc(wk.id)}"></div>
      </div>`).join('');

    host.innerHTML = `
      <div class="card" data-program-host>
        <div class="card-header">
          <span class="card-title">Your Training Program</span>
          <span class="badge" style="background:rgba(20,184,166,.14);color:var(--nc-teal);border:1px solid rgba(20,184,166,.3)">
            ${esc(p.phase || 'Program')} · ${esc(p.days_per_week || 3)} days/week${p.split_label ? ' · ' + esc(p.split_label) : ''}
          </span>
        </div>
        ${pubDate ? `<div class="form-hint" style="margin-bottom:12px">Published by your coach on ${esc(pubDate)}.</div>` : ''}
        ${scheduleHTML}
        ${workoutHTML}
        ${(p.exclusions && p.exclusions.length) ? `
          <div style="margin-top:8px;padding:10px 12px;background:var(--bg-raised);border-radius:8px;font-size:11px;color:var(--rose)">
            <b>Avoid for now:</b> ${esc(p.exclusions.join(' · '))}
          </div>` : ''}
        <div class="form-hint" style="margin-top:14px">
          Your daily routine is in the <b>𓆸 Daily Routine</b> tab — check off tasks each day.
        </div>
      </div>`;

    // ── Feature 5 — wire preview + instructions buttons ────────
    host.querySelectorAll('[data-cp-preview]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const id  = el.dataset.cpPreview;
        const nm  = el.dataset.cpName;
        const url = el.dataset.cpUrl;
        if (!url) return;
        // Default: inline expand IN the row; Shift-click or ▶ button on
        // narrow screens falls back to the existing modal player.
        if (e.shiftKey || window.innerWidth < 640) {
          if (typeof ExerciseUI !== 'undefined') ExerciseUI.openVideoModal(id, nm, url);
          return;
        }
        // Find the inline slot belonging to this row (data-cp-inline=<id>-<index>)
        const row = el.closest('.cp-row');
        const inline = row?.querySelector('[data-cp-inline]');
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
            <button type="button" data-cp-inline-close
                    style="position:absolute;top:6px;right:8px;background:rgba(0,0,0,.6);
                           color:#fff;border:0;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">✕</button>
            <button type="button" data-cp-open-modal data-id="${esc(id)}" data-name="${esc(nm)}" data-url="${esc(url)}"
                    style="position:absolute;bottom:6px;right:8px;background:rgba(20,184,166,.85);
                           color:#fff;border:0;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">⛶ Fullscreen</button>
          </div>`;
        inline.classList.remove('hidden');
        inline.querySelector('[data-cp-inline-close]').onclick = () => {
          inline.classList.add('hidden'); inline.innerHTML = '';
        };
        inline.querySelector('[data-cp-open-modal]').onclick = (ev) => {
          ev.stopPropagation();
          if (typeof ExerciseUI !== 'undefined') ExerciseUI.openVideoModal(id, nm, url);
        };
      });
    });
    host.querySelectorAll('[data-cp-info]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.cpInfo;
        const slot = host.querySelector(`[data-cp-instr="${CSS.escape(key)}"]`);
        if (!slot) return;
        if (!slot.classList.contains('hidden')) {
          slot.classList.add('hidden'); slot.innerHTML = '';
          return;
        }
        const id = key.split('-')[0];
        const meta = libMap.get(id);
        if (!meta || typeof ExerciseInstructions === 'undefined') return;
        slot.innerHTML = ExerciseInstructions.renderFull(meta);
        slot.classList.remove('hidden');
      });
    });

    // Mount the WorkoutSession tracker into every workout's slot.
    const programHost = host.querySelector('[data-program-host]');
    if (programHost) {
      programHost._workouts = workouts;     // stash for re-renders
      programHost._libMap   = libMap;       // Feature 5 — share with tracker
    }
    if (typeof WorkoutSession !== 'undefined' && programHost) {
      WorkoutSession.mountWorkouts(programHost, {
        programId: row.id || null,
        workouts,
        libMap,                              // Feature 5 — no re-fetch
      }).catch((e) => console.warn('[programPublish] tracker mount:', e?.message));
    }
  }

  window.ProgramPublish = { render, getProgram, renderClientProgram, resolveClientProgram };
})();
