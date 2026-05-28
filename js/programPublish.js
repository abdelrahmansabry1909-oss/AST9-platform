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
    const f = (field, val, ph, w) =>
      `<input data-w="${wi}" data-ex="${key}" data-i="${i}" data-f="${field}" value="${esc(val)}"
        placeholder="${esc(ph)}" class="form-input" style="${w}"/>`;
    return `
      <div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;flex-wrap:wrap;
                  padding:8px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-raised)">
        <span style="font-size:11px;color:var(--text-tertiary);width:18px;text-align:center;padding-top:9px">${i + 1}</span>
        <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:6px">
          ${f('name', ex.name, 'Exercise name', 'font-weight:600')}
          ${f('notes', ex.notes, 'Coaching notes', 'font-size:12px')}
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
    // field edits
    panel.querySelectorAll(`[data-w="${wi}"][data-ex="${key}"]`).forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = +inp.dataset.i, fld = inp.dataset.f;
        const arr = _program.workouts[wi][key];
        if (arr[i]) arr[i][fld] = inp.value;
      });
    });
    // add
    panel.querySelector(`[data-add="${wi}:${key}"]`)?.addEventListener('click', () => {
      _program.workouts[wi][key].push({ name: '', sets: '', reps: '', tempo: '', rest: '', notes: '' });
      _drawProgram();
    });
    // remove
    panel.querySelectorAll(`[data-rm^="${wi}:${key}:"]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.rm.split(':')[2];
        _program.workouts[wi][key].splice(i, 1);
        _drawProgram();
      });
    });
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
    if (!clientId) { host.innerHTML = `<div class="card"><p style="font-size:13px;color:var(--text-tertiary)">Sign in to view your program.</p></div>`; return; }
    if (typeof sb === 'undefined' || !sb) { host.innerHTML = `<div class="card"><p style="font-size:13px;color:var(--text-tertiary)">Not connected to the database.</p></div>`; return; }

    let row = null;
    try {
      const { data, error } = await sb.from('client_programs')
        .select('program, published, published_at').eq('client_id', clientId).maybeSingle();
      if (error) throw error;
      row = data;
    } catch (e) {
      host.innerHTML = `<div class="card"><p style="color:#FCA5A5;font-size:13px">Could not load your program: ${esc(e.message)}</p></div>`;
      return;
    }
    if (!row || !row.published || !row.program || (!row.program.structure && !row.program.workouts)) {
      host.innerHTML = `<div class="card"><div class="empty-state">
        <span class="empty-icon">◈</span>
        <div class="empty-title">No program published yet</div>
        <p class="empty-desc">Your coach hasn't published a training program for you yet. Check back soon.</p>
      </div></div>`;
      return;
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

    const roSection = (title, list, color) => {
      if (!list || !list.length) return '';
      return `
        <div style="margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${color};padding:8px 0 4px;border-bottom:1px solid ${color}33">${esc(title)}</div>
          ${list.map((ex, i) => `
            <div style="display:grid;grid-template-columns:auto 1fr auto;gap:10px 14px;align-items:start;padding:10px 0;border-bottom:1px solid var(--border-subtle)">
              <div style="width:22px;height:22px;border-radius:50%;background:${color}1f;border:1px solid ${color}44;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${color};flex-shrink:0">${i + 1}</div>
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(ex.name || 'Exercise')}</div>
                ${ex.notes ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;line-height:1.4">${esc(ex.notes)}</div>` : ''}
              </div>
              <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;text-align:right">
                ${ex.sets ? `<b style="color:${color}">${esc(ex.sets)}</b> sets` : ''}
                ${ex.reps ? ` · ${esc(ex.reps)}` : ''}
                ${ex.tempo ? `<br/><span style="font-size:11px;color:var(--text-tertiary)">tempo ${esc(ex.tempo)}${ex.rest ? ' · rest ' + esc(ex.rest) : ''}</span>` : ''}
              </div>
            </div>`).join('')}
        </div>`;
    };

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

    // Each distinct workout, read-only
    const workoutHTML = workouts.map((wk) => `
      <div style="margin-bottom:20px;border:1px solid var(--border-subtle);border-radius:12px;padding:14px 16px;background:rgba(255,255,255,.015)">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
          <span style="width:26px;height:26px;border-radius:7px;background:rgba(20,184,166,.16);
                       border:1px solid rgba(20,184,166,.35);color:var(--nc-teal);font-weight:700;
                       font-size:13px;display:flex;align-items:center;justify-content:center">${esc(wk.id)}</span>
          <span style="font-size:15px;font-weight:600;color:var(--text-primary)">${esc(wk.label || ('Workout ' + wk.id))}</span>
        </div>
        ${roSection('Warm-Up', wk.warmup, 'var(--nc-teal)')}
        ${roSection('Conditioning / Correctives', wk.main, 'var(--nc-gold, #D4AF37)')}
        ${roSection('Cool-Down', wk.cooldown, '#5A9BD4')}
      </div>`).join('');

    host.innerHTML = `
      <div class="card">
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
  }

  window.ProgramPublish = { render, getProgram, renderClientProgram };
})();
