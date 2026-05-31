// ═══════════════════════════════════════════════════════════════
//  js/clients.js
//  Handles: client list, add client, add coach, coaches list,
//           phase upgrade prep, exercise library.
// ═══════════════════════════════════════════════════════════════

const Clients = (() => {

  // ── Clients ─────────────────────────────────────────────────

  async function loadAll() {
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
            <button class="btn btn-teal btn-xs"
              ${c.current_phase === 'Phase 3' ? 'disabled title="Already at top phase"' : `onclick="Clients.prepPhaseUpgrade('${c.id}','${_esc(c.full_name||c.email)}')"`}>⬆ Phase</button>
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
      if (!res.ok) throw new Error(result.error || 'Failed to create client');

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

  return {
    loadAll, submitAddClient, prepPhaseUpgrade,
    loadCoaches, submitAddCoach, removeCoach,
    loadExercises, submitAddExercise, deleteExercise,
  };

})();

window.Clients = Clients;
