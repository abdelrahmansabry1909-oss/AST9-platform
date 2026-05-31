/* ═══════════════════════════════════════════════════════════════
   NeuCore — Alternative Exercise Request
   Client opens a "Request Alternative" modal on a single exercise
   inside a workout; coach reviews + responds in their inbox section.

   The DB trigger on exercise_alternative_requests publishes into
   the generic notifications inbox (Notifications service) so the
   coach is alerted even if they're not on this page.

   ── Feature 6 ────────────────────────────────────────────────────
   Coach response modal now lets the coach pick a SUBSTITUTE library
   exercise via the reusable ExercisePicker (F5). When set, the
   client's My Program view + Workout Tracker swap the original for
   the substitute (override layer — published JSON is never mutated).
   The DB trigger emits a substitute-aware notification body, and
   v_client_progression v1.1 excludes successfully-substituted
   requests from the Recovery penalty.
   Persistence column: exercise_alternative_requests.substitute_exercise_id

   Public surface (window.AltExercise):
     openModal({ programId, workoutKey, exerciseIndex,
                 exerciseName, exerciseId? })   — client side
     mountInbox(host, { preselectClientId? })   — coach side
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function _toast(msg, type = 'info') {
    if (typeof Dashboard !== 'undefined' && Dashboard.toast) Dashboard.toast(msg, type);
    else console.log('[alt]', type, msg);
  }

  // ── 1. CLIENT — modal ──────────────────────────────────────────
  function openModal(ctx = {}) {
    if (!Auth.canWrite?.()) {
      _toast('Read-only — your subscription is inactive.', 'warning');
      return;
    }
    const profile = Auth.getProfile?.();
    if (!profile) { _toast('Not signed in', 'error'); return; }
    const coachId = profile.assigned_coach;
    if (!coachId) {
      _toast('No coach assigned yet — contact your admin.', 'warning');
      return;
    }

    let modal = document.getElementById('modal-alt-request');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-alt-request';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:480px">
          <div class="modal-header">
            <h3>Request Alternative Exercise</h3>
            <button class="btn-icon" data-action="close">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Exercise</label>
              <input id="ar-ex" class="form-input" readonly>
            </div>
            <div class="form-group">
              <label class="form-label">Reason (your coach will see this)</label>
              <textarea id="ar-reason" class="form-input" style="min-height:110px"
                placeholder="e.g. Knee pain on the step-down · No access to dumbbells today · This makes my back tweak…"></textarea>
            </div>
            <div class="form-hint">Your coach will reply in your inbox.</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="submit">Send Request</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
    modal.classList.remove('hidden');
    modal.querySelector('#ar-ex').value      = ctx.exerciseName || '';
    modal.querySelector('#ar-reason').value  = '';

    const close = () => modal.classList.add('hidden');
    modal.querySelectorAll('[data-action="close"]').forEach((b) => b.onclick = close);
    modal.querySelector('[data-action="submit"]').onclick = async () => {
      const reason = modal.querySelector('#ar-reason').value.trim();
      if (!reason) { _toast('Please add a short reason', 'error'); return; }
      try {
        const { error } = await sb.from('exercise_alternative_requests').insert({
          client_id:      profile.id,
          coach_id:       coachId,
          program_id:     ctx.programId || null,
          workout_key:    ctx.workoutKey || '',
          exercise_index: ctx.exerciseIndex ?? 0,
          exercise_name:  ctx.exerciseName  || 'Exercise',
          exercise_id:    ctx.exerciseId    || null,
          reason,
        });
        if (error) throw error;
        _toast('Request sent — your coach will respond shortly.', 'success');
        close();
      } catch (e) {
        _toast(e.message || 'Could not send request', 'error');
      }
    };
  }

  // ── 2. COACH — inbox panel ─────────────────────────────────────
  async function mountInbox(host, { preselectClientId = null } = {}) {
    if (!host) return;
    host.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <div class="card-header">
          <span class="card-title">Alternative Exercise Requests</span>
          <select id="ae-filter" class="form-input" style="max-width:200px">
            <option value="pending">Pending</option>
            <option value="addressed">Addressed</option>
            <option value="declined">Declined</option>
            <option value="all">All</option>
          </select>
        </div>
        <div id="ae-list" style="display:flex;flex-direction:column;gap:8px"></div>
      </div>`;

    const sel  = host.querySelector('#ae-filter');
    const list = host.querySelector('#ae-list');

    const refresh = async () => {
      const filter = sel.value;
      let q = sb.from('exercise_alternative_requests')
        .select('*, client:profiles!exercise_alternative_requests_client_id_fkey(full_name, email)')
        .order('created_at', { ascending: false }).limit(50);
      if (filter !== 'all') q = q.eq('status', filter);
      // RLS already scopes to coach_id = auth.uid() OR assigned_coach.
      if (preselectClientId) q = q.eq('client_id', preselectClientId);

      const { data, error } = await q;
      if (error) {
        list.innerHTML = `<div class="empty-state" style="padding:24px"><span class="empty-icon">⚠</span><div class="empty-title">Could not load</div><p class="empty-desc">${esc(error.message)}</p></div>`;
        return;
      }
      if (!data?.length) {
        list.innerHTML = `<div class="empty-state" style="padding:24px"><span class="empty-icon">◌</span><div class="empty-title">No ${esc(filter === 'all' ? '' : filter)} requests</div><p class="empty-desc">When a client asks for an alternative, it shows up here.</p></div>`;
        return;
      }

      // ── Feature 6 — batch-fetch substitute metadata for any addressed
      //    requests that carry a substitute_exercise_id, so the pill
      //    on each card shows the substitute name. One round-trip.
      const subIds = Array.from(new Set(data
        .map((r) => r.substitute_exercise_id)
        .filter(Boolean)));
      const subMeta = new Map();
      if (subIds.length) {
        const { data: subs } = await sb.from('exercises')
          .select('id, name').in('id', subIds);
        (subs || []).forEach((e) => subMeta.set(e.id, e));
      }
      data.forEach((r) => { r._substitute = subMeta.get(r.substitute_exercise_id) || null; });

      list.innerHTML = data.map(_renderRow).join('');
      list.querySelectorAll('[data-req-row]').forEach((el) => {
        const id  = el.dataset.reqRow;
        const row = data.find((r) => r.id === id);
        el.querySelector('[data-act="respond"]').onclick = () => _openResponseModal(row, refresh);
      });
    };

    sel.onchange = refresh;
    refresh();
  }

  function _renderRow(row) {
    const who = row.client?.full_name || row.client?.email || 'Client';
    const statusBadge = row.status === 'pending'
      ? `<span class="badge badge-pending badge-dot">Pending</span>`
      : row.status === 'addressed'
      ? `<span class="badge badge-active badge-dot">Addressed</span>`
      : `<span class="badge badge-expired">Declined</span>`;
    // ── Feature 6 — substitute pill on addressed cards when set ──
    const subName = row._substitute?.name;
    const substitutePill = (row.status === 'addressed' && subName)
      ? `<div style="margin-top:6px;display:inline-flex;align-items:center;gap:6px;
                     padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;
                     background:rgba(20,184,166,.14);color:var(--nc-teal,#14b8a6);
                     border:1px solid rgba(20,184,166,.35)"
              title="Substitute assigned">
           🔄 ${esc(subName)}
         </div>`
      : '';
    return `
      <div data-req-row="${esc(row.id)}" style="padding:12px;border:1px solid var(--border-subtle);border-radius:10px;background:rgba(255,255,255,.02)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(who)} · ${esc(row.exercise_name)}</div>
            <div style="font-size:11px;color:var(--text-tertiary)">${esc(new Date(row.created_at).toLocaleString())} · workout ${esc(row.workout_key)}</div>
            ${substitutePill}
          </div>
          ${statusBadge}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:8px">
          <b style="color:var(--text-primary)">Reason:</b> ${esc(row.reason)}
        </div>
        ${row.coach_response ? `<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;padding:8px 10px;background:var(--bg-raised);border-radius:6px"><b style="color:var(--nc-teal,#14b8a6)">Your response:</b> ${esc(row.coach_response)}</div>` : ''}
        <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px">
          <button class="btn btn-primary btn-xs" data-act="respond">${row.status === 'pending' ? 'Respond' : 'Edit response'}</button>
        </div>
      </div>`;
  }

  function _openResponseModal(row, onDone) {
    let modal = document.getElementById('modal-alt-response');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-alt-response';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:540px">
          <div class="modal-header">
            <h3>Respond to Alt-Exercise Request</h3>
            <button class="btn-icon" data-action="close">✕</button>
          </div>
          <div class="modal-body">
            <div id="ar-ctx" style="margin-bottom:12px;padding:10px;background:var(--bg-raised);border-radius:8px;font-size:12px;color:var(--text-secondary)"></div>
            <div class="form-group">
              <label class="form-label">Response to client <span style="color:var(--text-tertiary);font-weight:400">(optional when a substitute is picked)</span></label>
              <textarea id="arr-msg" class="form-input" style="min-height:110px" placeholder="Explain the substitute / next steps / what to skip…"></textarea>
            </div>
            <!-- Feature 6 — substitute picker block -->
            <div class="form-group" style="margin-top:14px">
              <label class="form-label">Substitute exercise <span style="color:var(--text-tertiary);font-weight:400">(optional)</span></label>
              <div id="arr-sub-preview" style="margin-bottom:8px"></div>
              <button class="btn btn-ghost btn-sm" data-action="pick-sub" type="button">🔄 Pick substitute exercise</button>
              <div class="form-hint" style="margin-top:6px">
                When set, the client's program will swap this exercise for the substitute on their next render.
                The Workout Tracker will use the substitute's video, instructions, and log against its id.
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" data-action="close">Cancel</button>
            <button class="btn btn-rose btn-sm" data-action="decline">Decline</button>
            <button class="btn btn-primary" data-action="address">Mark Addressed</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
    modal.classList.remove('hidden');
    modal.querySelector('#ar-ctx').innerHTML =
      `<b>${esc(row.exercise_name)}</b> · workout ${esc(row.workout_key)}<br>
       <span style="color:var(--text-tertiary)">${esc(row.reason)}</span>`;
    modal.querySelector('#arr-msg').value = row.coach_response || '';

    const close = () => modal.classList.add('hidden');
    modal.querySelectorAll('[data-action="close"]').forEach((b) => b.onclick = close);

    // ── Feature 6 — substitute state lives in modal closure ──
    // Seed from row (handles "Edit response" reopen with an existing substitute).
    let pickedSubId   = row.substitute_exercise_id || null;
    let pickedSubMeta = row._substitute || null;   // {id, name} from inbox query

    const previewHost = modal.querySelector('#arr-sub-preview');
    const pickBtn     = modal.querySelector('[data-action="pick-sub"]');

    function _renderSubPreview() {
      if (!pickedSubId) {
        previewHost.innerHTML = '';
        pickBtn.textContent = '🔄 Pick substitute exercise';
        return;
      }
      const nm = pickedSubMeta?.name || '(loading…)';
      const thumb = pickedSubMeta?.thumbnail_url
        || (pickedSubMeta?.video_url && typeof ExerciseLibrary?.getThumbnailUrl === 'function'
            ? ExerciseLibrary.getThumbnailUrl(pickedSubMeta.video_url) : null);
      const tagsHTML = Array.isArray(pickedSubMeta?.tags) && pickedSubMeta.tags.length
        ? `<div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">
             ${pickedSubMeta.tags.slice(0,4).map(esc).join(' · ')}
           </div>` : '';
      previewHost.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:10px;
                    border:1px solid rgba(20,184,166,.35);border-radius:8px;
                    background:rgba(20,184,166,.06)">
          ${thumb
            ? `<img src="${esc(thumb)}" alt="" loading="lazy"
                    style="width:56px;height:38px;object-fit:cover;border-radius:4px;background:#0f172a">`
            : `<div style="width:56px;height:38px;border-radius:4px;background:rgba(255,255,255,.04);
                           display:flex;align-items:center;justify-content:center;color:#475569">▶</div>`}
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(nm)}</div>
            ${tagsHTML}
          </div>
          <button class="btn btn-ghost btn-xs" type="button" data-action="clear-sub"
                  style="font-size:11px;color:var(--text-secondary)">✕ Clear</button>
        </div>`;
      pickBtn.textContent = '🔄 Change substitute';
      previewHost.querySelector('[data-action="clear-sub"]').onclick = () => {
        pickedSubId = null;
        pickedSubMeta = null;
        _renderSubPreview();
      };
    }

    // If we reopened a row that has a substitute_exercise_id but no meta
    // (e.g. row was opened from a non-inbox surface), fetch it once.
    if (pickedSubId && !pickedSubMeta && typeof sb !== 'undefined') {
      sb.from('exercises').select('id, name, thumbnail_url, video_url, tags')
        .eq('id', pickedSubId).maybeSingle()
        .then(({ data }) => { if (data) { pickedSubMeta = data; _renderSubPreview(); } });
    }
    _renderSubPreview();

    // Wire Pick → ExercisePicker
    pickBtn.onclick = () => {
      if (typeof ExercisePicker === 'undefined') {
        _toast('Exercise Picker unavailable — reload the page.', 'error');
        return;
      }
      ExercisePicker.open({
        defaultFilter: 'all',
        title:         'Pick substitute exercise',
        onSelect: ({ exercise_id, exercise_name, exercise }) => {
          pickedSubId   = exercise_id;
          pickedSubMeta = exercise || { id: exercise_id, name: exercise_name };
          _renderSubPreview();
        },
      }).catch(() => { /* user closed without picking — no-op */ });
    };

    const submit = async (status) => {
      const response = modal.querySelector('#arr-msg').value.trim() || null;
      // Per Q1 + DB contract: a `declined` request must not carry a substitute.
      // Enforced at the UI to keep the (status, substitute) state coherent.
      const subToWrite = (status === 'addressed') ? (pickedSubId || null) : null;
      try {
        const { error } = await sb.from('exercise_alternative_requests')
          .update({
            status,
            coach_response:         response,
            substitute_exercise_id: subToWrite,
            responded_at:           new Date().toISOString(),
          })
          .eq('id', row.id);
        if (error) throw error;
        _toast(subToWrite
          ? 'Saved — substitute assigned & client notified.'
          : 'Saved — client notified.', 'success');
        close();
        if (typeof onDone === 'function') onDone();
      } catch (e) {
        _toast(e.message || 'Save failed', 'error');
      }
    };
    modal.querySelector('[data-action="address"]').onclick = () => submit('addressed');
    modal.querySelector('[data-action="decline"]').onclick = () => submit('declined');
  }

  window.AltExercise = { openModal, mountInbox };
})();
