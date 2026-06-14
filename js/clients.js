// ═══════════════════════════════════════════════════════════════
//  js/clients.js
//  Handles: client list, add client, add coach, coaches list,
//           phase upgrade prep, exercise library.
// ═══════════════════════════════════════════════════════════════

const Clients = (() => {

  // ── Clients ─────────────────────────────────────────────────

  async function loadAll() {
    renderNeedsAttention();   // F8·S3 — coach triage panel above the table (self-guards)
    const tbody = document.getElementById('clients-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px"><span class="spinner spinner-lg"></span></td></tr>`;

    let q = sb.from('profiles').select('*').eq('role', 'client').order('created_at', { ascending: false });
    if (Auth.isCoach()) q = q.eq('assigned_coach', Auth.getUser()?.id);

    const { data, error } = await q;
    if (error || !data?.length) {
      tbody.innerHTML = `<tr><td colspan="6">${_emptyRow('No clients yet. Add your first client.')}</td></tr>`;
      return;
    }

    // Fetch active subscriptions map
    const { data: subs } = await sb.from('subscriptions').select('client_id,plan,end_date,status').eq('status','active');
    const subMap = {};
    (subs || []).forEach(s => { subMap[s.client_id] = s; });

    // Fetch coach name map
    const { data: coaches } = await sb.from('profiles').select('id,full_name,email').in('role',['coach','admin']);
    const coachMap = {};
    (coaches || []).forEach(c => { coachMap[c.id] = c.full_name || c.email; });

    const isAdmin = (typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin());
    tbody.innerHTML = data.map(c => {
      const sub = subMap[c.id];
      const subBadge = sub
        ? `<span class="badge badge-active badge-dot">${sub.plan}mo</span>`
        : `<span class="badge badge-expired">No sub</span>`;
      const phaseCls = _phaseBadge(c.current_phase);
      const coachName = c.assigned_coach ? (coachMap[c.assigned_coach] || '–') : '–';
      return `
      <tr>
        <td>
          <div class="client-row-name">
            <div class="avatar">${(c.full_name||c.email||'?')[0].toUpperCase()}</div>
            <div class="client-row-info">
              <div class="name">${c.full_name || '–'}</div>
              <div class="sub">${c.goal || 'No goal set'}</div>
            </div>
          </div>
        </td>
        <td><span class="mono" style="font-size:12px">${c.email}</span></td>
        <td><span class="badge ${phaseCls}">${c.current_phase || 'Phase 1'}</span></td>
        <td>${subBadge}</td>
        <td style="font-size:12px;color:var(--text-tertiary)">${coachName}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-xs" onclick="Dashboard.showSection('new-session'); setTimeout(()=>{document.getElementById('ns-name').value='${_esc(c.full_name||'')}';document.getElementById('ns-phase').value='${c.current_phase||'Phase 1'}'},100)">+ Session</button>
            <button class="btn btn-ghost btn-xs" onclick="window._wsPreselectClient='${c.id}'; Dashboard.showSection('workout-history')">◐ Workouts</button>
            <button class="btn btn-ghost btn-xs" onclick="Clients.openRecovery('${c.id}','${_esc(c.full_name||c.email)}')">◉ Recovery</button>
            <button class="btn btn-teal btn-xs"
              ${c.current_phase === 'Phase 3' ? 'disabled title="Already at top phase"' : `onclick="Clients.prepPhaseUpgrade('${c.id}','${_esc(c.full_name||c.email)}')"`}>⬆ Phase</button>
            ${isAdmin ? `
            <button class="btn btn-ghost btn-xs" onclick="Clients.openEditClient('${c.id}')" title="Edit profile">✎ Edit</button>
            <button class="btn btn-rose btn-xs" onclick="Clients.removeClient('${c.id}','${_esc(c.full_name||c.email)}')" title="Delete account">🗑</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  async function submitAddClient() {
    const fields = {
      name:   _gv('ac-name'),
      email:  _gv('ac-email'),
      pass:   _gv('ac-password'),
      age:    _gv('ac-age'),
      phase:  _gv('ac-phase'),
      phone:  _gv('ac-phone'),
      coach:  _gv('ac-coach'),
      goal:   _gv('ac-goal'),
    };

    if (!fields.name || !fields.email || !fields.pass) {
      Dashboard.toast('Name, email, and password are required', 'error'); return;
    }
    if (fields.pass.length < 8) {
      Dashboard.toast('Password must be at least 8 characters', 'error'); return;
    }
    // Tier-1 fix C — coach assignment is required so downstream alt-request,
    // grace notifications, and workout coach_id stamping all work correctly.
    if (!fields.coach) {
      Dashboard.toast('Please assign a coach before creating the client', 'error');
      const sel = document.getElementById('ac-coach');
      sel?.focus();
      sel?.classList.add('form-input-error');
      setTimeout(() => sel?.classList.remove('form-input-error'), 2500);
      return;
    }

    const btn = document.getElementById('ac-submit-btn');
    _setBtnLoading(btn, 'Creating...');
    _clearSlotLimit();                         // drop any prior slot-limit banner

    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          email: fields.email, password: fields.pass,
          full_name: fields.name, role: 'client',
          age: fields.age, current_phase: fields.phase,
          phone: fields.phone, assigned_coach: fields.coach || null,
          goal: fields.goal
        })
      });
      const result = await res.json();
      if (!res.ok) {
        // Phase 3 — server-side slot limit: show a specific, actionable
        // message (with a Billing link) instead of a generic failure toast.
        if (res.status === 403 && result.code === 'SLOT_LIMIT_REACHED') {
          _showSlotLimit(result);
          return;
        }
        throw new Error(result.error || 'Failed to create client');
      }

      Dashboard.toast(`Client "${fields.name}" created!`, 'success');
      Dashboard.closeModal('modal-add-client');
      ['ac-name','ac-email','ac-password','ac-age','ac-phone','ac-goal'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value = '';
      });
      loadAll();
      Dashboard.refreshClientSelects();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    } finally {
      _resetBtn(btn, 'Create Account');
    }
  }

  // Phase 3 — premium, specific message when create-user returns the
  // server-side slot-limit error. Renders a banner in the add-client modal
  // with used/max/package + a button to open Billing.
  function _showSlotLimit(result) {
    const used = result.used_slots, max = result.max_slots;
    const pkg  = result.package_name
      ? (typeof Packages !== 'undefined' ? Packages.label(result.package_name) : result.package_name)
      : null;
    const modal = document.getElementById('modal-add-client');
    const body  = modal ? (modal.querySelector('.modal-body') || modal) : null;
    if (body) {
      let banner = body.querySelector('[data-slot-limit]');
      if (!banner) {
        banner = document.createElement('div');
        banner.setAttribute('data-slot-limit', '1');
        body.prepend(banner);
      }
      banner.style.cssText = 'margin:0 0 14px;padding:13px 15px;border-radius:11px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.38);font-size:12.5px;color:#b9770b;line-height:1.55';
      const slots = (used != null && max != null)
        ? `You've used <b>${used} of ${max}</b> client slots`
        : `You've used all client slots`;
      banner.innerHTML =
        `<b>Client slot limit reached.</b> ${slots}${pkg ? ` on the <b>${_esc(pkg)}</b> plan` : ''}. `
        + `Upgrade your Billing plan to add more clients.`
        + `<div style="margin-top:10px"><button class="btn btn-teal btn-xs" type="button" `
        + `onclick="Dashboard.closeModal('modal-add-client'); Dashboard.showSection('billing')">Open Billing →</button></div>`;
    }
    Dashboard.toast('Client slot limit reached — upgrade to add more clients.', 'error');
  }

  function _clearSlotLimit() {
    const b = document.querySelector('#modal-add-client [data-slot-limit]');
    if (b) b.remove();
  }

  // Reliability Sweep / Priority D — async-ified so we can fetch the
  // client's current_phase first, stamp it onto the modal, disable
  // options at-or-below current, and refuse silent downgrades.
  async function prepPhaseUpgrade(clientId, clientName) {
    const sel = document.getElementById('pu-client');
    if (sel) sel.value = clientId;

    // Fetch current phase. Defensive: open modal anyway if fetch fails
    // (we still validate again in submitPhaseUpgrade).
    let current = null;
    try {
      const { data } = await sb.from('profiles')
        .select('current_phase').eq('id', clientId).maybeSingle();
      current = data?.current_phase || null;
    } catch (e) {
      console.warn('[phase-upgrade] current-phase fetch failed:', e.message);
    }

    _applyPhaseUpgradeGuards(current);
    Dashboard.openModal('modal-phase-upgrade');
  }

  // Phase ordering helper — converts "Phase N" to a number for comparison.
  function _phaseOrd(p) {
    if (!p) return 0;
    const m = String(p).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // Stamp current phase on the modal, disable options at-or-below it,
  // and either show the upgrade form or a "top-phase" banner.
  // Per Q-D1: Phase 3 client = banner + disabled options.
  function _applyPhaseUpgradeGuards(currentPhase) {
    const modal = document.getElementById('modal-phase-upgrade');
    if (!modal) return;

    // Stash current phase on the modal element for submit-time re-validation.
    modal.dataset.currentPhase = currentPhase || 'Phase 1';
    const curOrd = _phaseOrd(currentPhase);

    // Find the current-phase pill (lazily injected next to the modal title) — create it if missing.
    let pill = modal.querySelector('[data-pu-current]');
    if (!pill) {
      const hdr = modal.querySelector('.modal-header h3');
      if (hdr) {
        pill = document.createElement('span');
        pill.setAttribute('data-pu-current', '1');
        pill.style.cssText = 'margin-left:10px;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:rgba(20,184,166,.14);color:var(--nc-teal,#14b8a6);border:1px solid rgba(20,184,166,.35);vertical-align:2px';
        hdr.appendChild(pill);
      }
    }
    if (pill) pill.textContent = currentPhase ? 'Currently on ' + currentPhase : '';

    // Disable options at-or-below current phase on the select.
    const sel = modal.querySelector('#pu-phase');
    if (sel) {
      let firstEnabled = null;
      Array.from(sel.options).forEach((opt) => {
        const ord = _phaseOrd(opt.value);
        const disabled = ord <= curOrd;
        opt.disabled = disabled;
        if (!disabled && firstEnabled === null) firstEnabled = opt.value;
      });
      if (firstEnabled) sel.value = firstEnabled;
    }

    // Banner + submit-button disable for Phase 3 (top phase).
    const banner    = _ensureTopPhaseBanner(modal);
    const submitBtn = modal.querySelector('[onclick="Dashboard.submitPhaseUpgrade()"]');
    if (curOrd >= 3) {
      if (banner) banner.style.display = '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.title = 'Already at top phase'; }
    } else {
      if (banner) banner.style.display = 'none';
      if (submitBtn) { submitBtn.disabled = false; submitBtn.title = ''; }
    }
  }

  function _ensureTopPhaseBanner(modal) {
    let banner = modal.querySelector('[data-pu-top-banner]');
    if (banner) return banner;
    const body = modal.querySelector('.modal-body');
    if (!body) return null;
    banner = document.createElement('div');
    banner.setAttribute('data-pu-top-banner', '1');
    banner.style.cssText = 'display:none;margin:0 0 14px;padding:12px 14px;border-radius:10px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.35);font-size:12px;color:#f59e0b;line-height:1.5';
    banner.innerHTML = '<b>Already at top phase.</b> This client is on Phase 3 — nothing to upgrade.';
    body.prepend(banner);
    return banner;
  }

  // ── Coaches ─────────────────────────────────────────────────

  async function loadCoaches() {
    const tbody = document.getElementById('coaches-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px"><span class="spinner"></span></td></tr>`;

    const { data } = await sb.from('profiles').select('*').eq('role','coach').order('created_at');
    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="5">${_emptyRow('No coaches yet.')}</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(c => `
      <tr>
        <td>
          <div class="client-row-name">
            <div class="avatar" style="background:conic-gradient(from 180deg,var(--lime),var(--amber))">${(c.full_name||c.email||'?')[0].toUpperCase()}</div>
            <div class="client-row-info">
              <div class="name">${c.full_name || '–'}</div>
            </div>
          </div>
        </td>
        <td><span class="mono" style="font-size:12px">${c.email}</span></td>
        <td style="color:var(--text-tertiary)">–</td>
        <td style="font-size:12px;color:var(--text-tertiary)">${new Date(c.created_at).toLocaleDateString()}</td>
        <td>
          <button class="btn btn-rose btn-xs" onclick="Clients.removeCoach('${c.id}','${_esc(c.full_name||c.email)}')">Remove</button>
        </td>
      </tr>`).join('');
  }

  async function submitAddCoach() {
    const name  = _gv('co-name');
    const email = _gv('co-email');
    const pass  = _gv('co-password');

    if (!name || !email || !pass) { Dashboard.toast('All fields required', 'error'); return; }
    if (pass.length < 8) { Dashboard.toast('Password must be at least 8 characters', 'error'); return; }

    const btn = document.getElementById('co-submit-btn');
    _setBtnLoading(btn, 'Creating...');

    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ email, password: pass, full_name: name, role: 'coach' })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to create coach');

      Dashboard.toast(`Coach "${name}" created!`, 'success');
      Dashboard.closeModal('modal-add-coach');
      ['co-name','co-email','co-password'].forEach(id => { const e = document.getElementById(id); if(e) e.value = ''; });
      loadCoaches();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    } finally {
      _resetBtn(btn, 'Create Coach Account');
    }
  }

  async function removeCoach(id, name) {
    if (!confirm(`Remove coach "${name}"? This cannot be undone.`)) return;
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ user_id: id })
      });
      if (res.ok) { Dashboard.toast('Coach removed', 'info'); loadCoaches(); }
      else Dashboard.toast('Failed to remove coach', 'error');
    } catch(e) { Dashboard.toast(e.message, 'error'); }
  }

  // ── B4 — Edit / Delete client (admin-only; RLS + delete-user enforce server-side) ──
  let _editClientId = null;

  async function openEditClient(clientId) {
    if (!(typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin())) {
      Dashboard.toast('Only admins can edit client profiles', 'error'); return;
    }
    const [{ data: c, error }, { data: coaches }] = await Promise.all([
      sb.from('profiles').select('*').eq('id', clientId).single(),
      sb.from('profiles').select('id,full_name,email').in('role', ['coach','admin']).order('full_name'),
    ]);
    if (error || !c) { Dashboard.toast('Could not load this profile', 'error'); return; }
    _editClientId = clientId;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
    set('ec-name', c.full_name); set('ec-email', c.email); set('ec-age', c.age);
    set('ec-phone', c.phone); set('ec-goal', c.goal); set('ec-injury', c.injury_history);
    const sel = document.getElementById('ec-coach');
    if (sel) {
      sel.innerHTML = `<option value="">— Unassigned —</option>` + (coaches || [])
        .map((co) => `<option value="${co.id}" ${co.id === c.assigned_coach ? 'selected' : ''}>${_esc(co.full_name || co.email)}</option>`).join('');
    }
    document.getElementById('modal-edit-client')?.classList.remove('hidden');
  }

  async function submitEditClient() {
    if (!_editClientId) return;
    const gv = (id) => document.getElementById(id)?.value?.trim() ?? '';
    const patch = {
      full_name:      gv('ec-name') || null,
      age:            gv('ec-age') ? parseInt(gv('ec-age'), 10) : null,
      phone:          gv('ec-phone') || null,
      goal:           gv('ec-goal') || null,
      injury_history: gv('ec-injury') || null,
      assigned_coach: gv('ec-coach') || null,
    };
    if (!patch.full_name) { Dashboard.toast('Name is required', 'error'); return; }
    const btn = document.getElementById('ec-submit-btn');
    _setBtnLoading(btn, 'Saving...');
    try {
      // .select() makes RLS outcomes honest: 0 rows back = no permission, never a silent no-op.
      const { data, error } = await sb.from('profiles').update(patch).eq('id', _editClientId).select('id');
      if (error) throw new Error(error.message);
      if (!data || !data.length) throw new Error('No permission to edit this profile');
      Dashboard.toast('Client updated', 'success');
      Dashboard.closeModal('modal-edit-client');
      _editClientId = null;
      loadAll();
    } catch (e) { Dashboard.toast(e.message || 'Update failed', 'error'); }
    finally { _resetBtn(btn, 'Save Changes'); }
  }

  // Deletes the auth account (cascades the profile). delete-user is admin-gated
  // server-side and refuses self/last-admin; we surface its verdict honestly.
  async function removeClient(clientId, name) {
    if (!(typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin())) {
      Dashboard.toast('Only admins can delete client accounts', 'error'); return;
    }
    if (!confirm(`Delete ${name}'s account?\n\nThis permanently removes their sign-in, profile, and access. Their training history stays in the database but will no longer be reachable from the app.\n\nThis cannot be undone.`)) return;
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ user_id: clientId }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Failed to delete the account');
      Dashboard.toast(`${name}'s account deleted`, 'info');
      loadAll();
    } catch (e) { Dashboard.toast(e.message, 'error'); }
  }

  // ── Exercise Library ─────────────────────────────────────────

  async function loadExercises() {
    const el = document.getElementById('exercise-list');
    if (!el) return;
    const { data } = await sb.from('exercises').select('*').order('name');
    if (!data?.length) {
      el.innerHTML = `<div class="empty-state"><span class="empty-icon">▶</span><div class="empty-title">No exercises yet</div><p class="empty-desc">Add exercises to build your library.</p></div>`;
      return;
    }
    el.innerHTML = `<div class="exercise-grid">${data.map(ex => `
      <div class="exercise-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
          <div style="font-weight:600;font-size:13px;color:var(--text-primary);line-height:1.3">${ex.name}</div>
          <button class="btn-icon" onclick="Clients.deleteExercise('${ex.id}')" style="width:24px;height:24px;font-size:11px;flex-shrink:0">✕</button>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <span class="badge ${_catBadge(ex.category)}">${ex.category}</span>
          <span class="badge ${_phaseBadge(ex.phase)}">${ex.phase}</span>
        </div>
        ${ex.description ? `<p style="font-size:12px;color:var(--text-tertiary);line-height:1.5;margin-bottom:8px">${ex.description}</p>` : ''}
        ${ex.video_url ? `<a href="${ex.video_url}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--lime);text-decoration:none;font-weight:500">▶ Watch demo</a>` : ''}
      </div>`).join('')}</div>`;
  }

  async function submitAddExercise() {
    const name     = _gv('ex-name');
    const category = _gv('ex-category');
    const phase    = _gv('ex-phase');
    const video    = _gv('ex-video');
    const desc     = _gv('ex-desc');
    // Reliability Sweep / H5 — parse new tags + target_joints inputs.
    const tags         = _parseCSV(_gv('ex-tags'));
    const targetJoints = _parseCSV(_gv('ex-target-joints'));
    if (!name) { Dashboard.toast('Exercise name required', 'error'); return; }

    const insert = {
      name, category, phase,
      video_url: video || null,
      description: desc || null,
      created_by: Auth.getUser()?.id,
    };
    // Only attach array columns when non-empty so we don't overwrite
    // schema defaults ('{}'::text[]) with empty arrays on save.
    if (tags.length)         insert.tags          = tags;
    if (targetJoints.length) insert.target_joints = targetJoints;

    const { error } = await sb.from('exercises').insert(insert);
    if (error) { Dashboard.toast(error.message, 'error'); return; }
    Dashboard.toast('Exercise added!', 'success');
    Dashboard.closeModal('modal-add-exercise');
    ['ex-name','ex-video','ex-desc','ex-tags','ex-target-joints'].forEach((id) => {
      const e = document.getElementById(id); if (e) e.value = '';
    });
    loadExercises();
  }

  // CSV → trimmed, de-duplicated, lower-cased array. Empty → [].
  function _parseCSV(s) {
    if (!s) return [];
    return Array.from(new Set(
      String(s).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    ));
  }

  async function deleteExercise(id) {
    if (!confirm('Delete this exercise?')) return;
    await sb.from('exercises').delete().eq('id', id);
    Dashboard.toast('Exercise deleted', 'info');
    loadExercises();
  }

  // ── Helpers ──────────────────────────────────────────────────

  function _gv(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }
  function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
  function _emptyRow(msg) {
    return `<div style="text-align:center;padding:40px;color:var(--text-tertiary)">${msg}</div>`;
  }
  function _phaseBadge(p) {
    return p === 'Phase 1' ? 'badge-phase1' : p === 'Phase 2' ? 'badge-phase2' : 'badge-phase3';
  }
  function _catBadge(c) {
    return c === 'Rehab' ? 'badge-phase1' : c === 'Mobility' ? 'badge-phase2' : 'badge-phase3';
  }
  function _setBtnLoading(btn, label) {
    if (!btn) return;
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = `<span class="spinner spinner-sm"></span> ${label}`;
    btn.disabled = true;
  }
  function _resetBtn(btn, fallback) {
    if (!btn) return;
    btn.innerHTML = btn.dataset.orig || fallback;
    btn.disabled = false;
  }

  // ── F7 — Coach Recovery Snapshot (parity view of a client's hologram) ──
  // Reuses the shared window.AssessmentSnapshot loader + renderer; coach RLS
  // already permits reading an assigned client's assessment + body-map rows.
  let _crViz   = null;
  let _crState = 'A';

  async function openRecovery(clientId, name) {
    const titleEl  = document.getElementById('cr-title');
    const canvasEl = document.getElementById('cr-canvas');
    const reportEl = document.getElementById('cr-report');
    if (titleEl)  titleEl.textContent = name ? `Recovery Snapshot — ${name}` : 'Recovery Snapshot';
    if (canvasEl) canvasEl.innerHTML = '';
    if (reportEl) reportEl.innerHTML = '<div class="cd-assessment-row"><div class="cd-assessment-value" style="opacity:.6"><span class="spinner spinner-sm" style="margin-right:6px;vertical-align:-2px"></span>Loading…</div></div>';

    Dashboard.openModal('modal-client-recovery');

    // Dispose any prior hologram, reset toggle, wire controls (idempotent).
    try { if (_crViz) _crViz.destroy(); } catch (e) {}
    _crViz = null;
    _crState = 'A';
    _crSyncToggle();
    _crWire();

    const AS = window.AssessmentSnapshot;
    if (!AS) { if (reportEl) reportEl.innerHTML = '<p class="empty-desc" style="padding:16px">Snapshot module not loaded.</p>'; return; }

    let snap = null;
    try { snap = await AS.loadLatest(clientId); }
    catch (e) { console.warn('[recovery] load failed:', e && e.message); }

    AS.renderReport(reportEl, snap, {
      emptyTitle:    'No assessment yet',
      emptyDesc:     'This client has no assessment on record yet.',
      notesFallback: 'No coach notes recorded for this assessment.',
    });
    _crViz = AS.mountHologram(canvasEl, snap, { state: _crState });
  }

  function closeRecovery() {
    try { if (_crViz) _crViz.destroy(); } catch (e) {}
    _crViz = null;
    Dashboard.closeModal('modal-client-recovery');
  }

  function _crSetState(s) {
    _crState = (s === 'B') ? 'B' : 'A';
    _crSyncToggle();
    if (_crViz) _crViz.setState(_crState);
  }

  function _crSyncToggle() {
    document.querySelectorAll('#modal-client-recovery [data-cr-state]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.crState === _crState);
    });
  }

  // Static modal markup → wire the A/B toggle + backdrop-close once.
  function _crWire() {
    document.querySelectorAll('#modal-client-recovery [data-cr-state]').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => _crSetState(btn.dataset.crState));
    });
    const overlay = document.getElementById('modal-client-recovery');
    if (overlay && !overlay.dataset.wiredClose) {
      overlay.dataset.wiredClose = '1';
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeRecovery(); });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Feature 8 · S3 — "Needs Attention" coach triage panel
  //  Reads the read-only v_client_pulse view (RLS scopes it: coach →
  //  assigned, admin → all, client → never reaches this section).
  //  Ranks by severity, shows only rows that warrant action, in
  //  friendly (non-clinical) wording. Clinical detail stays inside
  //  the F7 recovery modal (View Recovery). No new tables, no cron,
  //  no edge changes — reuses openRecovery + Community.sendMessage +
  //  the verified reactivate_subscription() RPC.
  // ═══════════════════════════════════════════════════════════════
  const ATTN_LABEL = {
    regressing: { label: 'Recovery dipping', cls: 'badge-expired' },
    at_risk:    { label: 'Needs attention',  cls: 'badge-pending' },
    slipping:   { label: 'Losing momentum',  cls: 'badge-phase2' },
  };

  function _attnReason(r) {
    if (r.pulse_status === 'regressing') return 'Recovery trending down — worth a check-in.';
    if (r.pulse_status === 'at_risk') {
      if (r.days_since_activity != null && r.days_since_activity >= 14) return `No activity in ${r.days_since_activity} days.`;
      if (r.adherence_7d != null && r.adherence_7d < 40)               return `Low adherence this week (${Math.round(r.adherence_7d)}%).`;
      return 'Low engagement this week.';
    }
    if (r.pulse_status === 'slipping')   return 'Adherence easing off this week.';
    if (r.effective_status === 'expired') return 'Plan expired — access may pause.';
    if (r.effective_status === 'grace')   return `Plan ends in ${r.grace_days_left ?? 0} day${r.grace_days_left === 1 ? '' : 's'}.`;
    return 'Worth a quick check-in.';
  }

  function _attnHead(r) {
    if (r.severity >= 2 && ATTN_LABEL[r.pulse_status]) return ATTN_LABEL[r.pulse_status];
    if (r.effective_status === 'expired') return { label: 'Subscription expired', cls: 'badge-expired' };
    if (r.effective_status === 'grace')   return { label: 'Subscription ending',  cls: 'badge-pending' };
    return { label: 'Check in', cls: 'badge-pending' };
  }

  function _attnRow(r, name) {
    const head    = _attnHead(r);
    const recency = (r.days_since_activity != null) ? `Last active ${r.days_since_activity}d ago` : 'No recent activity';
    const lapsed  = (r.effective_status === 'grace' || r.effective_status === 'expired');
    // Show a subscription chip alongside an engagement headline (avoid doubling
    // up when the headline already IS the subscription).
    const subChip = (r.severity >= 2 && lapsed)
      ? `<span class="badge ${r.effective_status === 'expired' ? 'badge-expired' : 'badge-pending'}">${r.effective_status === 'expired' ? 'Expired' : 'Grace'}</span>` : '';
    const nm = _esc(name);
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--border,rgba(255,255,255,.08));border-radius:12px;background:var(--surface-2,rgba(255,255,255,.02))">
        <div class="avatar" style="flex:0 0 auto">${(name || '?')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:600;font-size:13px;color:var(--text-primary)">${nm}</span>
            <span class="badge ${head.cls}">${head.label}</span>${subChip}
          </div>
          <div style="font-size:12px;color:var(--text-secondary,#94A3B8);margin-top:2px">${_esc(_attnReason(r))}</div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px">${_esc(recency)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;flex:0 0 auto">
          <button class="btn btn-ghost btn-xs" onclick="Clients.openRecovery('${r.client_id}','${nm}')">◉ Recovery</button>
          <button class="btn btn-ghost btn-xs" onclick="Clients.nudgeClient('${r.client_id}','${nm}')">✉ Nudge</button>
          <button class="btn btn-ghost btn-xs" onclick="window._wsPreselectClient='${r.client_id}'; Dashboard.showSection('workout-history')" title="Review their recent workouts">◐ Program</button>
          ${lapsed ? `<button class="btn btn-teal btn-xs" onclick="Clients.reactivateClient('${r.client_id}','${nm}')">↻ Reactivate</button>` : ''}
        </div>
      </div>`;
  }

  // ── S5 — priority ranking + triage summary ──────────────────────
  // Composite priority from existing Pulse signals only (no new scoring
  // engine): severity dominates, churn and long inactivity break ties so the
  // coach sees "who needs me most" at the top. Higher = more urgent.
  function _attnPriority(r) {
    let p = (r.severity || 0) * 100;
    if (r.churn_risk) p += 40;
    if (r.effective_status === 'expired') p += 30;
    else if (r.effective_status === 'grace') p += 15;
    p += Math.min(20, r.days_since_activity || 0);
    return p;
  }

  // One-glance triage strip: how many clients fall in each risk facet.
  // Facets overlap by design (a client can be at-risk AND churning).
  function _attnSummary(rows) {
    const facets = [
      { key: 'regressing', label: 'Regressing', color: '#F5426C', n: rows.filter((r) => r.pulse_status === 'regressing').length },
      { key: 'at_risk',    label: 'At risk',    color: '#F59E0B', n: rows.filter((r) => r.pulse_status === 'at_risk').length },
      { key: 'churn',      label: 'Churn risk', color: '#D4AF37', n: rows.filter((r) => r.churn_risk).length },
      { key: 'lapsed',     label: 'Lapsed plan',color: '#94A3B8', n: rows.filter((r) => r.effective_status === 'grace' || r.effective_status === 'expired').length },
    ].filter((f) => f.n > 0);
    if (!facets.length) return '';
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${
      facets.map((f) => `<span style="display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;
        background:rgba(255,255,255,.03);border:1px solid var(--border,rgba(255,255,255,.08));font-size:11.5px;font-weight:600;color:var(--text-secondary,#94A3B8)">
        <span style="width:8px;height:8px;border-radius:50%;background:${f.color}"></span>${f.label}
        <b style="color:var(--text-primary)">${f.n}</b></span>`).join('')
    }</div>`;
  }

  function _attnEmpty() {
    return `<div class="card" style="padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px">
      <span style="font-size:15px;color:var(--lime,#14B8A6)">✓</span>
      <span style="font-size:13px;color:var(--text-secondary,#94A3B8)">All clients look on track — nothing needs attention right now.</span></div>`;
  }

  // Renders the pulse triage panel. Default (no args) targets the Clients
  // page panel and keeps its original look. The dashboard reuses the same
  // ranking via an optional host + options — single source of the S5 logic,
  // no duplicated pulse query or priority formula.
  //   hostArg  optional DOM element to render into
  //   opts     { limit, compact, onCount(n) }
  async function renderNeedsAttention(hostArg, opts) {
    const el = (hostArg && hostArg.nodeType) ? hostArg : document.getElementById('clients-needs-attention');
    if (!el) return;
    opts = opts || {};
    const onCount = typeof opts.onCount === 'function' ? opts.onCount : null;
    const limit   = opts.limit || null;
    const compact = !!opts.compact;
    // Defense-in-depth: panel is coach/admin only (section is role-coach-admin).
    if (typeof Auth !== 'undefined' && Auth.isAdminOrCoach && !Auth.isAdminOrCoach()) {
      el.innerHTML = ''; if (onCount) onCount(0); return;
    }

    let rows = [];
    try {
      const { data, error } = await sb.from('v_client_pulse')
        .select('client_id,pulse_status,severity,momentum,days_since_activity,adherence_7d,recovery,effective_status,grace_days_left,churn_risk')
        .or('severity.gte.2,churn_risk.is.true,effective_status.in.(grace,expired)')
        .order('severity', { ascending: false });
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      console.warn('[needs-attention] pulse read:', e?.message);
      el.innerHTML = compact ? _attnEmpty() : '';   // calm: panel absent on the table page
      if (onCount) onCount(0);
      return;
    }

    if (!rows.length) { el.innerHTML = _attnEmpty(); if (onCount) onCount(0); return; }
    if (onCount) onCount(rows.length);

    // S5 — rank by composite priority so the most urgent client is first.
    rows.sort((a, b) => _attnPriority(b) - _attnPriority(a));

    // Resolve display names (RLS-scoped read: coach=assigned, admin=all).
    const nameMap = {};
    try {
      const { data: profs } = await sb.from('profiles').select('id,full_name,email').in('id', rows.map((r) => r.client_id));
      (profs || []).forEach((p) => { nameMap[p.id] = p.full_name || p.email || '—'; });
    } catch (_) { /* names optional — fall back to em dash */ }

    const topName = nameMap[rows[0].client_id] || 'A client';
    const shown   = limit ? rows.slice(0, limit) : rows;
    const moreN   = rows.length - shown.length;
    const moreLink = moreN > 0
      ? `<button class="nc-section-link" style="margin-top:10px" onclick="Dashboard.showSection('clients')">+${moreN} more — open command center ↗</button>`
      : '';

    const inner = `
      ${compact ? '' : `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:4px">
          <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-tertiary)">Needs Attention</span>
          <span class="badge badge-pending">${rows.length} client${rows.length === 1 ? '' : 's'}</span>
        </div>`}
        <div style="font-size:13px;color:var(--text-secondary,#94A3B8);margin-bottom:12px">Start with <b style="color:var(--text-primary)">${_esc(topName)}</b> — highest priority today.</div>
        ${_attnSummary(rows)}
        <div style="display:flex;flex-direction:column;gap:8px">
          ${shown.map((r) => _attnRow(r, nameMap[r.client_id] || '—')).join('')}
        </div>
        ${moreLink}`;

    el.innerHTML = compact ? inner : `<div class="card" style="padding:16px;margin-bottom:14px">${inner}</div>`;
  }

  // Send Nudge — reuses the existing assigned coach/client message path
  // (Community.sendMessage → coach_messages). Pre-fills a supportive default.
  async function nudgeClient(clientId, name) {
    const first = (name || '').split(' ')[0] || 'there';
    const draft = `Hi ${first}, just checking in — how are you feeling? Let's keep your recovery moving.`;
    const msg = window.prompt(`Send a quick message to ${name}:`, draft);
    if (msg == null) return;             // cancelled
    const text = msg.trim();
    if (!text) return;
    try {
      if (!(window.Community && Community.sendMessage)) throw new Error('Messaging unavailable');
      await Community.sendMessage(clientId, text);
      Dashboard.toast(`Message sent to ${name}`, 'success');
    } catch (e) { Dashboard.toast(e.message || 'Could not send message', 'error'); }
  }

  // Reactivate — verified reactivate_subscription() RPC (it self-enforces
  // admin-or-assigned-coach permission; the button only shows for lapsed subs).
  async function reactivateClient(clientId, name) {
    const input = window.prompt(`Reactivate ${name}'s subscription — how many months?`, '3');
    if (input == null) return;
    const months = parseInt(input, 10);
    if (!Number.isFinite(months) || months < 1 || months > 24) {
      Dashboard.toast('Enter a whole number of months (1–24)', 'error'); return;
    }
    try {
      const { error } = await sb.rpc('reactivate_subscription', { p_client_id: clientId, p_months: months });
      if (error) throw error;
      Dashboard.toast(`${name} reactivated for ${months} month${months === 1 ? '' : 's'}`, 'success');
      loadAll();   // refreshes the table + the Needs Attention panel
    } catch (e) { Dashboard.toast(e.message || 'Reactivation failed', 'error'); }
  }

  return {
    loadAll, submitAddClient, prepPhaseUpgrade,
    loadCoaches, submitAddCoach, removeCoach,
    loadExercises, submitAddExercise, deleteExercise,
    openRecovery, closeRecovery,
    nudgeClient, reactivateClient,
    openEditClient, submitEditClient, removeClient,
    renderNeedsAttention,
  };

})();

window.Clients = Clients;
