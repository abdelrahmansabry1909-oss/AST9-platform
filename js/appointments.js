/* ═══════════════════════════════════════════════════════════════
   NeuCore — Appointments V1 (internal scheduling)

   Coach/admin schedule assessment sessions & calls with clients, with
   manual meeting links (no Calendly/Google/Meet API — V1 is link-only).
   Clients see their upcoming session on the Coach tab and join via the
   stored link. The client is notified automatically through the existing
   public.notify() pipeline (a DB trigger does this server-side).

   Public surface (window.Appointments):

   Data
     listForCoach()                 → rows[] (coach: own; admin: all; RLS-scoped)
     listForClient()                → rows[] (the signed-in client's own)
     create(fields)                 → row
     update(id, fields)             → row
     cancel(id, reason)             → row
     complete(id)                   → row
     getMyCalendly() / setMyCalendly(url)

   UI
     mountCoachView(host)           → coach/admin Appointments tab
     renderClientUpcoming(host)     → client's next-session card (Coach tab)
     submit()                       → modal save handler (create/update)

   Security: meeting URLs run through ExerciseLibrary.sanitizeUrl (http(s)
   only; javascript:/data: rejected) before storage AND before opening; the
   DB enforces the same with a CHECK constraint. RLS does all access control.
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ── Helpers ─────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TYPES = [
    { value: 'assessment',     label: 'Assessment' },
    { value: 'check_in',       label: 'Check-in' },
    { value: 'follow_up',      label: 'Follow-up' },
    { value: 'program_review', label: 'Program review' },
    { value: 'other',          label: 'Other' },
  ];
  const _TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));
  const typeLabel = (v) => _TYPE_LABEL[v] || 'Session';

  // Reuse the exercise-library URL sanitizer (http(s) only; rejects
  // javascript:/data:). Fall back to a local guard if it isn't loaded.
  function sanitizeUrl(u) {
    if (window.ExerciseLibrary && ExerciseLibrary.sanitizeUrl) return ExerciseLibrary.sanitizeUrl(u);
    if (!u) return null;
    try { const url = new URL(String(u).trim()); return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null; }
    catch { return null; }
  }

  function _fmtWhen(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined,
        { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return iso; }
  }

  // ISO → value for <input type="datetime-local"> (local wall-clock).
  function _toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  const _uid = () => (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser()?.id : null;

  // ═══════════════════════════════════════════════════════════════
  //  DATA LAYER
  // ═══════════════════════════════════════════════════════════════
  const _CLIENT_EMBED = 'client:profiles!appointments_client_id_fkey(id, full_name, email)';
  const _COACH_EMBED  = 'coach:profiles!appointments_coach_id_fkey(id, full_name, email)';

  async function listForCoach() {
    const { data, error } = await sb.from('appointments')
      .select(`*, ${_CLIENT_EMBED}, ${_COACH_EMBED}`)
      .order('starts_at', { ascending: true });
    if (error) { console.warn('[appt] listForCoach:', error.message); return []; }
    return data || [];
  }

  async function listForClient() {
    const { data, error } = await sb.from('appointments')
      .select('*')
      .order('starts_at', { ascending: true });
    if (error) { console.warn('[appt] listForClient:', error.message); return []; }
    return data || [];
  }

  // Resolve the coach who owns this appointment. Coach books for themselves;
  // admin books on behalf of the client's assigned coach (a client has one
  // coach, so the (coach,client) pair is always a valid assignment).
  async function _resolveCoachId(clientId) {
    if (typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin()) {
      const { data } = await sb.from('profiles').select('assigned_coach').eq('id', clientId).maybeSingle();
      const c = data?.assigned_coach || null;
      if (!c) throw new Error('This client has no assigned coach yet. Assign a coach first.');
      return c;
    }
    return _uid();
  }

  async function create(f) {
    if (!f.client_id) throw new Error('Select a client.');
    if (!f.starts_at) throw new Error('Pick a date and time.');
    const coachId = await _resolveCoachId(f.client_id);
    const { data, error } = await sb.from('appointments').insert({
      coach_id:    coachId,
      client_id:   f.client_id,
      type:        f.type || 'check_in',
      title:       f.title?.trim() || null,
      starts_at:   f.starts_at,
      ends_at:     f.ends_at || null,
      meeting_url: sanitizeUrl(f.meeting_url),
      notes:       f.notes?.trim() || null,
      created_by:  _uid(),
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Edit the mutable fields only (never coach_id/client_id — an appointment
  // stays between the same client and their coach).
  async function update(id, f) {
    const patch = {};
    if ('type'      in f) patch.type      = f.type;
    if ('title'     in f) patch.title     = f.title?.trim() || null;
    if ('starts_at' in f) patch.starts_at = f.starts_at;
    if ('ends_at'   in f) patch.ends_at   = f.ends_at || null;
    if ('meeting_url' in f) patch.meeting_url = sanitizeUrl(f.meeting_url);
    if ('notes'     in f) patch.notes     = f.notes?.trim() || null;
    const { data, error } = await sb.from('appointments').update(patch).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function cancel(id, reason) {
    const { data, error } = await sb.from('appointments')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(),
                cancellation_reason: reason?.trim() || null })
      .eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function complete(id) {
    const { data, error } = await sb.from('appointments')
      .update({ status: 'completed' }).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Coach's own Calendly link (stored on their profile; coach/admin-facing).
  async function getMyCalendly() {
    const uid = _uid(); if (!uid) return null;
    const { data } = await sb.from('profiles').select('calendly_url').eq('id', uid).maybeSingle();
    return data?.calendly_url || null;
  }
  async function setMyCalendly(url) {
    const uid = _uid(); if (!uid) throw new Error('Not signed in.');
    const clean = url && url.trim() ? sanitizeUrl(url) : null;
    if (url && url.trim() && !clean) throw new Error('Enter a valid https link.');
    const { error } = await sb.from('profiles').update({ calendly_url: clean }).eq('id', uid);
    if (error) throw new Error(error.message);
    return clean;
  }

  // ═══════════════════════════════════════════════════════════════
  //  COACH / ADMIN UI
  // ═══════════════════════════════════════════════════════════════
  let _byId = {};          // id → row, for inline action handlers
  let _coachHost = null;

  const _statusPill = (s) => {
    const map = {
      scheduled: 'background:rgba(20,184,166,.14);color:var(--nc-teal,#14b8a6);border:1px solid rgba(20,184,166,.35)',
      completed: 'background:rgba(148,163,184,.12);color:#94a3b8;border:1px solid rgba(148,163,184,.30)',
      cancelled: 'background:rgba(244,63,94,.12);color:#f43f5e;border:1px solid rgba(244,63,94,.30)',
    };
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;
      font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;${map[s] || map.completed}">${esc(s)}</span>`;
  };

  function _card(a) {
    const clientName = a.client?.full_name || a.client?.email || 'Client';
    const isAdmin    = (typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin());
    const coachLine  = (isAdmin && a.coach) ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:1px">Coach: ${esc(a.coach.full_name || a.coach.email)}</div>` : '';
    const url        = sanitizeUrl(a.meeting_url);
    const live       = a.status === 'scheduled';
    const startBtn   = (url && live)
      ? `<button class="btn btn-primary btn-sm" onclick="Appointments.startCall('${a.id}')">▶ Start Call</button>` : '';
    const editBtn    = live ? `<button class="btn btn-ghost btn-sm" onclick="Appointments.edit('${a.id}')">Edit</button>` : '';
    const doneBtn    = live ? `<button class="btn btn-ghost btn-sm" onclick="Appointments.markComplete('${a.id}')">Mark done</button>` : '';
    const cancelBtn  = live ? `<button class="btn btn-ghost btn-sm" style="color:#f43f5e" onclick="Appointments.cancelPrompt('${a.id}')">Cancel</button>` : '';
    const notes      = a.notes ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:8px;line-height:1.5">${esc(a.notes)}</div>` : '';
    const reason     = (a.status === 'cancelled' && a.cancellation_reason)
      ? `<div style="font-size:12px;color:#f43f5e;margin-top:6px">Reason: ${esc(a.cancellation_reason)}</div>` : '';
    return `
      <div class="card" style="padding:16px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:14px;font-weight:700;color:var(--text-primary)">${esc(typeLabel(a.type))}</span>
              ${_statusPill(a.status)}
            </div>
            <div style="font-size:13px;color:var(--text-secondary);margin-top:3px">${esc(clientName)}</div>
            ${coachLine}
            <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">🗓 ${esc(_fmtWhen(a.starts_at))}</div>
            ${a.title ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${esc(a.title)}</div>` : ''}
            ${notes}${reason}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            ${startBtn}${editBtn}${doneBtn}${cancelBtn}
          </div>
        </div>
      </div>`;
  }

  function _calendlyCard(url) {
    const safe = sanitizeUrl(url);
    return `
      <div class="card" style="padding:16px;margin-bottom:16px">
        <div class="card-header" style="margin-bottom:10px">
          <span class="card-title">Your Calendly link</span>
        </div>
        <p style="font-size:12px;color:var(--text-tertiary);margin:0 0 10px;line-height:1.5">
          Store your booking link so it's handy when scheduling. NeuCore does not sync with Calendly — this just keeps the link in one place.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input id="ap-calendly" class="form-input" style="flex:1;min-width:220px" placeholder="https://calendly.com/your-name" value="${esc(safe || '')}"/>
          <button class="btn btn-primary btn-sm" onclick="Appointments.saveCalendly()">Save</button>
          ${safe ? `<button class="btn btn-ghost btn-sm" onclick="Appointments.copyCalendly()">Copy</button>
                    <button class="btn btn-ghost btn-sm" onclick="Appointments.openCalendly()">Open ↗</button>` : ''}
        </div>
      </div>`;
  }

  async function mountCoachView(host) {
    _coachHost = host || document.getElementById('appointments-root');
    if (!_coachHost) return;
    if (typeof Auth === 'undefined' || !Auth.isAdminOrCoach || !Auth.isAdminOrCoach()) {
      _coachHost.innerHTML = '';
      return;
    }
    _coachHost.innerHTML = `<div class="empty-state"><span class="empty-icon">🗓</span><div class="empty-title">Loading appointments…</div></div>`;

    const isCoach = Auth.isCoach && Auth.isCoach();
    const [rows, calendly] = await Promise.all([
      listForCoach(),
      isCoach ? getMyCalendly() : Promise.resolve(null),
    ]);

    _byId = {};
    rows.forEach((r) => { _byId[r.id] = r; });
    const now = Date.now();
    const upcoming = rows.filter((r) => r.status === 'scheduled' && new Date(r.starts_at).getTime() >= now);
    const past     = rows.filter((r) => !(r.status === 'scheduled' && new Date(r.starts_at).getTime() >= now))
                         .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));

    const empty = (msg) => `<div class="empty-state" style="padding:28px"><span class="empty-icon">🗓</span>
      <div class="empty-title">${esc(msg)}</div></div>`;

    _coachHost.innerHTML = `
      ${isCoach ? _calendlyCard(calendly) : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="font-size:15px;font-weight:700;color:var(--text-primary);margin:0">Upcoming</h2>
        <button class="btn btn-primary" onclick="Appointments.add()">+ New Appointment</button>
      </div>
      <div id="ap-upcoming">${upcoming.length ? upcoming.map(_card).join('') : empty('No upcoming appointments. Schedule one to get started.')}</div>
      <h2 style="font-size:15px;font-weight:700;color:var(--text-primary);margin:22px 0 12px">Past &amp; cancelled</h2>
      <div id="ap-past">${past.length ? past.map(_card).join('') : empty('Nothing here yet.')}</div>`;
  }

  function _refreshCoach() {
    if (_coachHost && document.getElementById('section-appointments')?.classList.contains('active')) {
      mountCoachView(_coachHost);
    }
  }

  // ── Modal (create / edit) ───────────────────────────────────────
  async function _populateClientSelect(selectedId) {
    const sel = document.getElementById('ap-client');
    if (!sel) return;
    // RLS scopes this for coaches (assigned clients only); admins see all.
    const { data } = await sb.from('profiles')
      .select('id, full_name, email').eq('role', 'client').order('full_name');
    sel.innerHTML = '<option value="">— Select client —</option>';
    (data || []).forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.full_name || c.email;
      if (c.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  async function add()  { await _openModal(null); }
  async function edit(id) { await _openModal(_byId[id] || null); }

  async function _openModal(a) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
    document.getElementById('ap-modal-title').textContent = a ? 'Edit Appointment' : 'New Appointment';
    set('ap-id', a?.id || '');
    set('ap-type', a?.type || 'check_in');
    set('ap-title', a?.title || '');
    set('ap-start', _toLocalInput(a?.starts_at));
    set('ap-end', _toLocalInput(a?.ends_at));
    set('ap-url', a?.meeting_url || '');
    set('ap-notes', a?.notes || '');
    // Client is fixed once created — disable the picker in edit mode.
    const clientSel = document.getElementById('ap-client');
    await _populateClientSelect(a?.client_id || '');
    if (clientSel) clientSel.disabled = !!a;
    if (typeof Dashboard !== 'undefined') Dashboard.openModal('modal-appointment');
  }

  async function submit() {
    const val = (id) => document.getElementById(id)?.value || '';
    const id = val('ap-id');
    const startLocal = val('ap-start');
    if (!startLocal) { Dashboard.toast('Pick a date and time.', 'error'); return; }
    const fields = {
      client_id:   val('ap-client'),
      type:        val('ap-type'),
      title:       val('ap-title'),
      starts_at:   new Date(startLocal).toISOString(),
      ends_at:     val('ap-end') ? new Date(val('ap-end')).toISOString() : null,
      meeting_url: val('ap-url'),
      notes:       val('ap-notes'),
    };
    const rawUrl = val('ap-url').trim();
    if (rawUrl && !sanitizeUrl(rawUrl)) { Dashboard.toast('Meeting link must be a valid http(s) URL.', 'error'); return; }
    const btn = document.getElementById('ap-save-btn');
    if (btn) btn.disabled = true;
    try {
      if (id) {
        await update(id, fields);
        // Honest copy: the client is only notified when the time or link
        // changes (the DB trigger skips notes-only edits), so don't claim it here.
        Dashboard.toast('Appointment updated.', 'success');
      } else {
        if (!fields.client_id) { Dashboard.toast('Select a client.', 'error'); return; }
        await create(fields);
        Dashboard.toast('Appointment scheduled. Client notified.', 'success');
      }
      Dashboard.closeModal('modal-appointment');
      _refreshCoach();
    } catch (e) {
      Dashboard.toast(e.message || 'Could not save appointment.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function startCall(id) {
    const a = _byId[id]; if (!a) return;
    const url = sanitizeUrl(a.meeting_url);
    if (!url) { Dashboard.toast('No meeting link on this appointment.', 'warning'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function markComplete(id) {
    try { await complete(id); Dashboard.toast('Marked as completed.', 'success'); _refreshCoach(); }
    catch (e) { Dashboard.toast(e.message, 'error'); }
  }

  async function cancelPrompt(id) {
    const reason = window.prompt('Cancel this appointment? Add an optional note for the client:', '');
    if (reason === null) return;   // user dismissed
    try { await cancel(id, reason); Dashboard.toast('Appointment cancelled. Client notified.', 'success'); _refreshCoach(); }
    catch (e) { Dashboard.toast(e.message, 'error'); }
  }

  // ── Calendly actions ────────────────────────────────────────────
  async function saveCalendly() {
    const v = document.getElementById('ap-calendly')?.value || '';
    try { await setMyCalendly(v); Dashboard.toast('Calendly link saved.', 'success'); _refreshCoach(); }
    catch (e) { Dashboard.toast(e.message, 'error'); }
  }
  function copyCalendly() {
    const v = sanitizeUrl(document.getElementById('ap-calendly')?.value || '');
    if (!v) { Dashboard.toast('Save a valid link first.', 'warning'); return; }
    navigator.clipboard?.writeText(v).then(() => Dashboard.toast('Copied.', 'success'),
      () => Dashboard.toast('Copy failed.', 'error'));
  }
  function openCalendly() {
    const v = sanitizeUrl(document.getElementById('ap-calendly')?.value || '');
    if (!v) { Dashboard.toast('Save a valid link first.', 'warning'); return; }
    window.open(v, '_blank', 'noopener,noreferrer');
  }

  // ═══════════════════════════════════════════════════════════════
  //  CLIENT UI — next upcoming session (rendered on the Coach tab)
  // ═══════════════════════════════════════════════════════════════
  async function renderClientUpcoming(host) {
    const el = typeof host === 'string' ? document.querySelector(host) : host;
    if (!el) return;
    let rows = [];
    try { rows = await listForClient(); } catch (_) { /* calm */ }
    const now = Date.now();
    const next = (rows || [])
      .filter((r) => r.status === 'scheduled' && new Date(r.starts_at).getTime() >= now)
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];

    if (!next) {
      el.innerHTML = `
        <div style="border:1px dashed var(--nc-border,rgba(255,255,255,.10));border-radius:var(--nc-r-xl,20px);
             background:var(--nc-fill-1);padding:18px;text-align:center">
          <div style="font-size:22px;line-height:1" aria-hidden="true">🗓</div>
          <div style="font-size:14px;font-weight:600;color:var(--nc-text-primary,#F8FAFC);margin-top:8px">No sessions scheduled</div>
          <div style="font-size:13px;line-height:1.5;color:var(--nc-text-secondary,#94A3B8);margin-top:4px">When your coach books an assessment or check-in, it will appear here.</div>
        </div>`;
      return;
    }

    const profile   = (typeof Auth !== 'undefined' && Auth.getProfile) ? Auth.getProfile() : null;
    const coachName = (profile?.coach_name || '').trim() || 'Your recovery coach';
    const url       = sanitizeUrl(next.meeting_url);
    const joinBtn   = url
      ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"
            style="margin-top:14px;display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;
                   min-height:50px;border-radius:var(--nc-r-lg,16px);background:var(--nc-teal,#14B8A6);color:#052e2b;
                   font-size:15px;font-weight:700;box-shadow:var(--nc-shadow-teal,0 0 40px rgba(20,184,166,.18));-webkit-tap-highlight-color:transparent">
           <span aria-hidden="true">▶</span><span>Join Call</span></a>`
      : `<div style="margin-top:12px;font-size:12px;color:var(--nc-text-secondary,#94A3B8);text-align:center">Your coach will share a meeting link before the session.</div>`;

    el.innerHTML = `
      <div style="border-radius:var(--nc-r-xl,20px);background:var(--nc-bg-card,rgba(15,23,42,.7));
           border:1px solid var(--nc-border,rgba(255,255,255,.08));box-shadow:var(--nc-shadow-card,0 8px 32px rgba(0,0,0,.4));padding:18px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--nc-teal,#14B8A6)">${esc(typeLabel(next.type))}</span>
        </div>
        <div style="font-size:17px;font-weight:800;color:var(--nc-text-primary,#F8FAFC);margin-top:6px">${esc(_fmtWhen(next.starts_at))}</div>
        <div style="font-size:13px;color:var(--nc-text-secondary,#94A3B8);margin-top:3px">with ${esc(coachName)}</div>
        ${next.title ? `<div style="font-size:13px;color:var(--nc-text-secondary,#94A3B8);margin-top:6px">${esc(next.title)}</div>` : ''}
        ${joinBtn}
      </div>`;
  }

  // ── Public surface ──────────────────────────────────────────────
  window.Appointments = {
    TYPES, typeLabel, sanitizeUrl,
    listForCoach, listForClient, create, update, cancel, complete,
    getMyCalendly, setMyCalendly,
    mountCoachView, renderClientUpcoming, submit,
    add, edit, startCall, markComplete, cancelPrompt,
    saveCalendly, copyCalendly, openCalendly,
  };
})();
