/* ═══════════════════════════════════════════════════════════════
   NeuCore RPM — Approvals & Decision Loop
   Phase 4 §4A · Cite: o-sullivan-graded-exposure-ladder.md §1.2 (Tripwires)

   Coach inbox of phase_submissions.
   - Approve → unlocks next phase + completes current + celebration on client side
   - Modify  → coach edits milestone/tripwire criteria → captured to ai_feedback_log
   - Reject  → coach explains why → client sees feedback in viewer

   Public API (window.RPMApproval):
     init()                     — render approvals queue (coach view)
     pendingCount(coachId)      — Number — used by the sidebar badge poller
     approve(submissionId)
     reject(submissionId, note)
     modify(submissionId, patch, note)
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  const state = {
    coachId: null,
    rows:    [],        // joined submission + phase + graph + client rows
    filter:  'pending', // 'pending' | 'approved' | 'rejected' | 'modified' | 'all'
    busy:    new Set(), // submission ids currently being decided
  };

  function _coachId() {
    try { return Auth.getUser()?.id ?? null; } catch { return null; }
  }
  function _toast(msg, kind = 'info') {
    if (typeof Dashboard !== 'undefined' && Dashboard.toast) Dashboard.toast(msg, kind);
    else console.log(`[approval] ${kind}: ${msg}`);
  }

  // ───────────────────────────────────────────────────────────
  // Data
  // ───────────────────────────────────────────────────────────
  async function _loadAll() {
    const coachId = _coachId();
    state.coachId = coachId;

    // Pull submissions where the parent graph belongs to this coach (RLS enforces)
    const { data: subs, error } = await sb.from('phase_submissions')
      .select(`
        id, graph_id, phase_id, client_id, client_note, status, coach_decision_at, coach_note, created_at,
        rpm_phases ( id, phase_index, stage_name, milestone_label, tripwire_test, status ),
        rpm_graphs ( id, coach_id, point_b_dream )
      `)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    // Filter (defence in depth): only this coach's graphs
    let filtered = (subs || []).filter(s => s.rpm_graphs?.coach_id === coachId);

    // Resolve client names (separate query — RLS may block joining profiles in one call)
    const clientIds = Array.from(new Set(filtered.map(s => s.client_id).filter(Boolean)));
    let clientMap = {};
    if (clientIds.length) {
      const { data: clients } = await sb.from('profiles').select('id, full_name, email').in('id', clientIds);
      (clients || []).forEach(c => { clientMap[c.id] = c; });
    }
    filtered = filtered.map(s => ({ ...s, _client: clientMap[s.client_id] || null }));

    state.rows = filtered;
  }

  async function pendingCount(coachId) {
    if (typeof sb === 'undefined' || !sb) return 0;
    coachId = coachId || _coachId();
    if (!coachId) return 0;
    const { data, error } = await sb.from('phase_submissions')
      .select('id, rpm_graphs(coach_id)')
      .eq('status', 'pending')
      .limit(500);
    if (error) { console.warn('[approval] pendingCount error:', error); return 0; }
    return (data || []).filter(r => r.rpm_graphs?.coach_id === coachId).length;
  }

  // ───────────────────────────────────────────────────────────
  // Decision actions
  // ───────────────────────────────────────────────────────────
  async function approve(submissionId) {
    if (state.busy.has(submissionId)) return;
    state.busy.add(submissionId);
    _renderList();

    try {
      const sub = state.rows.find(r => r.id === submissionId);
      if (!sub) throw new Error('Submission not found');

      const graphId = sub.graph_id;
      const submittedPhaseId = sub.phase_id;
      const submittedPhaseIdx = sub.rpm_phases?.phase_index;
      if (!submittedPhaseIdx) throw new Error('Phase index missing');

      // 1. Mark submission approved
      let { error } = await sb.from('phase_submissions')
        .update({
          status: 'approved',
          coach_decision_at: new Date().toISOString(),
        })
        .eq('id', submissionId);
      if (error) throw error;

      // 2. Mark current phase completed
      ({ error } = await sb.from('rpm_phases')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', submittedPhaseId));
      if (error) throw error;

      // 3. Find next phase by index — set active
      const { data: nextPhases, error: ne } = await sb.from('rpm_phases')
        .select('id, phase_index')
        .eq('graph_id', graphId)
        .eq('phase_index', submittedPhaseIdx + 1)
        .limit(1);
      if (ne) throw ne;

      let nextPhase = null;
      if (nextPhases?.length) {
        nextPhase = nextPhases[0];
        const { error: ue } = await sb.from('rpm_phases')
          .update({ status: 'active', unlocked_at: new Date().toISOString() })
          .eq('id', nextPhase.id);
        if (ue) throw ue;
      } else {
        // No next phase → mark whole graph completed
        await sb.from('rpm_graphs').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', graphId);
      }

      _toast(nextPhase
        ? `Approved ✓ Phase ${submittedPhaseIdx + 1} unlocked for client.`
        : `Approved ✓ Graph completed — client reached Point B 🎉`,
        'success');

      await _loadAll();
      _render();
    } catch (e) {
      console.error('[approval] approve failed:', e);
      _toast('Could not approve — check console.', 'error');
    } finally {
      state.busy.delete(submissionId);
      _renderList();
    }
  }

  async function reject(submissionId) {
    const note = prompt('Why is this rejected? (Required — the client sees this in their viewer.)');
    if (!note || !note.trim()) return;
    if (state.busy.has(submissionId)) return;
    state.busy.add(submissionId);
    _renderList();

    try {
      const { error } = await sb.from('phase_submissions')
        .update({
          status: 'rejected',
          coach_decision_at: new Date().toISOString(),
          coach_note: note.trim(),
        })
        .eq('id', submissionId);
      if (error) throw error;
      _toast('Submission rejected — client will see your note.', 'info');
      await _loadAll();
      _render();
    } catch (e) {
      console.error('[approval] reject failed:', e);
      _toast('Could not reject — check console.', 'error');
    } finally {
      state.busy.delete(submissionId);
      _renderList();
    }
  }

  async function modify(submissionId) {
    const sub = state.rows.find(r => r.id === submissionId);
    if (!sub) return;

    const oldMilestone = sub.rpm_phases?.milestone_label || '';
    const oldTripwire  = sub.rpm_phases?.tripwire_test || '';

    const newMilestone = prompt('Updated MILESTONE label (what they need to actually achieve):', oldMilestone);
    if (newMilestone == null) return; // cancel
    const newTripwire = prompt('Updated TRIPWIRE TEST (the measurable check):', oldTripwire);
    if (newTripwire == null) return;
    const note = prompt('Note to the client explaining the modification (required):');
    if (!note || !note.trim()) return;

    if (state.busy.has(submissionId)) return;
    state.busy.add(submissionId);
    _renderList();

    try {
      // 1. Update the phase criteria
      const { error: pe } = await sb.from('rpm_phases')
        .update({
          milestone_label: newMilestone.trim(),
          tripwire_test:   newTripwire.trim(),
        })
        .eq('id', sub.phase_id);
      if (pe) throw pe;

      // 2. Mark submission modified
      const { error: se } = await sb.from('phase_submissions')
        .update({
          status: 'modified',
          coach_decision_at: new Date().toISOString(),
          coach_note: note.trim(),
        })
        .eq('id', submissionId);
      if (se) throw se;

      // 3. Capture ML feedback (was this AI-generated criteria?)
      try {
        if (typeof RPMFeedback !== 'undefined') {
          await RPMFeedback.log({
            kind:            'milestone_modify',
            original:        `Milestone: ${oldMilestone}\nTripwire: ${oldTripwire}`,
            modified:        `Milestone: ${newMilestone}\nTripwire: ${newTripwire}`,
            reason_category: 'patient_feedback',
            reason_text:     note.trim(),
            graphId:         sub.graph_id,
            context:         { submission_id: submissionId, phase_id: sub.phase_id },
          });
        }
      } catch (logErr) {
        console.warn('[approval] feedback log failed (non-fatal):', logErr);
      }

      _toast('Modified ✓ Client sees the updated criteria + your note.', 'info');
      await _loadAll();
      _render();
    } catch (e) {
      console.error('[approval] modify failed:', e);
      _toast('Could not modify — check console.', 'error');
    } finally {
      state.busy.delete(submissionId);
      _renderList();
    }
  }

  // ───────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────
  async function init() {
    const root = $('#rpm-approvals-root');
    if (!root) return;
    root.innerHTML = `<div class="nc-app-empty"><span class="nc-app-empty-icon">⌛</span><p>Loading approvals…</p></div>`;
    try {
      await _loadAll();
      _render();
    } catch (e) {
      console.error('[approval] init failed:', e);
      root.innerHTML = `<div class="nc-app-empty"><span class="nc-app-empty-icon">⚠</span><p style="color:#FCA5A5">Could not load approvals.</p></div>`;
    }
  }

  function _render() {
    const root = $('#rpm-approvals-root');
    if (!root) return;

    const counts = {
      pending:  state.rows.filter(r => r.status === 'pending').length,
      approved: state.rows.filter(r => r.status === 'approved').length,
      modified: state.rows.filter(r => r.status === 'modified').length,
      rejected: state.rows.filter(r => r.status === 'rejected').length,
      all:      state.rows.length,
    };

    root.innerHTML = `
      <div class="nc-app-head">
        <div class="nc-app-summary">
          <div class="nc-app-stat pending">
            <div><div class="nc-app-stat-val">${counts.pending}</div><div class="nc-app-stat-lbl">Pending</div></div>
          </div>
          <div class="nc-app-stat approved">
            <div><div class="nc-app-stat-val">${counts.approved}</div><div class="nc-app-stat-lbl">Approved</div></div>
          </div>
          <div class="nc-app-stat rejected">
            <div><div class="nc-app-stat-val">${counts.rejected}</div><div class="nc-app-stat-lbl">Rejected</div></div>
          </div>
        </div>
        <div class="nc-app-filters" id="rpm-app-filters">
          ${['pending','approved','modified','rejected','all'].map(f => `
            <button class="nc-app-filter ${state.filter === f ? 'active' : ''}" data-filter="${f}">
              ${f[0].toUpperCase() + f.slice(1)}
              <span class="nc-app-filter-count">${counts[f]}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div id="rpm-app-list-host"></div>
    `;

    $$('#rpm-app-filters .nc-app-filter').forEach(b => {
      b.addEventListener('click', () => {
        state.filter = b.dataset.filter;
        _render();
      });
    });

    _renderList();
  }

  function _renderList() {
    const host = $('#rpm-app-list-host');
    if (!host) return;
    const filtered = state.filter === 'all'
      ? state.rows
      : state.rows.filter(r => r.status === state.filter);

    if (!filtered.length) {
      const labels = {
        pending:  'No pending submissions. When a client says they\'ve passed a phase, it shows up here.',
        approved: 'No approved submissions yet.',
        modified: 'No modified submissions yet.',
        rejected: 'No rejected submissions yet.',
        all:      'No submissions yet — clients will start submitting once you publish their first graph.',
      };
      host.innerHTML = `<div class="nc-app-empty"><span class="nc-app-empty-icon">${state.filter === 'pending' ? '✨' : '◌'}</span><p>${labels[state.filter]}</p></div>`;
      return;
    }

    host.innerHTML = `<div class="nc-app-list">${filtered.map(_renderCard).join('')}</div>`;
    _bindCardEvents();
  }

  function _renderCard(s) {
    const client = s._client || {};
    const initials = (client.full_name || client.email || '?').trim().slice(0, 2).toUpperCase();
    const phase = s.rpm_phases || {};
    const isPending = s.status === 'pending';
    const busy = state.busy.has(s.id);

    return `
      <div class="nc-app-card status-${s.status}" data-sub-id="${s.id}">
        <div class="nc-app-avatar">${escHtml(initials)}</div>
        <div class="nc-app-meta">
          <div class="nc-app-row">
            <span class="nc-app-name">${escHtml(client.full_name || client.email || 'Unknown client')}</span>
            <span class="nc-app-phase">Phase ${phase.phase_index ?? '?'} · ${escHtml(phase.stage_name || '')}</span>
            <span class="nc-app-time">${_formatTime(s.created_at)}</span>
          </div>
          ${phase.tripwire_test ? `<div class="nc-app-tripwire">Tripwire: ${escHtml(phase.tripwire_test)}</div>` : ''}
          ${s.client_note ? `
            <div class="nc-app-note"><small>Client said</small>${escHtml(s.client_note)}</div>` : ''}
          ${s.coach_note ? `
            <div class="nc-app-note nc-app-coach-note"><small>You said</small>${escHtml(s.coach_note)}</div>` : ''}
        </div>
        <div class="nc-app-actions">
          ${isPending ? `
            <button class="nc-app-btn approve" data-act="approve" ${busy ? 'disabled' : ''}>${busy ? '…' : '✓ Approve'}</button>
            <button class="nc-app-btn modify"  data-act="modify"  ${busy ? 'disabled' : ''}>✎ Modify</button>
            <button class="nc-app-btn reject"  data-act="reject"  ${busy ? 'disabled' : ''}>✕ Reject</button>
          ` : `
            <span class="nc-app-status-badge ${s.status}">${s.status}</span>
            ${s.coach_decision_at ? `<small style="text-align:center;color:var(--text-tertiary);font-size:11px">${_formatTime(s.coach_decision_at)}</small>` : ''}
          `}
        </div>
      </div>
    `;
  }

  function _formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60)        return 'just now';
    if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  }

  function _bindCardEvents() {
    $$('.nc-app-card').forEach(card => {
      const id = card.dataset.subId;
      card.querySelector('[data-act="approve"]')?.addEventListener('click', () => approve(id));
      card.querySelector('[data-act="reject"]')?.addEventListener('click',  () => reject(id));
      card.querySelector('[data-act="modify"]')?.addEventListener('click',  () => modify(id));
    });
  }

  window.RPMApproval = {
    init,
    pendingCount,
    approve,
    reject,
    modify,
    _state: () => ({ ...state }),
  };
})();
