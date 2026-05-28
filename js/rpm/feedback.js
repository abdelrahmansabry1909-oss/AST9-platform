/* ═══════════════════════════════════════════════════════════════
   NeuCore RPM — ML Feedback Capture
   Phase 4 §4C · Cite: workflow Phase 4 (ML training corpus)
   "Why did you change this?" modal — fires when a coach overrides an
   AI-generated suggestion. Persists to public.ai_feedback_log.

   Public API (window.RPMFeedback):
     ask({ kind, original, modified, context })  → opens modal, resolves on submit/skip
     log({ kind, original, modified, reason_category, reason_text, context })
        → fire-and-forget direct write (used when no modal needed)
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let _wired = false;
  let _resolveCurrent = null;
  let _ctx = null;     // current { kind, original, modified, graphId, context }

  function _wire() {
    if (_wired) return;
    _wired = true;

    const modal = $('#rpm-feedback-modal');
    if (!modal) return;

    // Chip selection (single-select)
    $$('#rpm-fb-chips .nc-fb-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('#rpm-fb-chips .nc-fb-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Skip — close modal, log without reason
    $('#rpm-fb-skip').addEventListener('click', () => _close('skip'));

    // Submit
    $('#rpm-fb-submit').addEventListener('click', _submit);

    // Backdrop click closes (acts like skip)
    modal.addEventListener('click', (e) => { if (e.target === modal) _close('skip'); });

    // Escape closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) _close('skip');
    });
  }

  function _close(outcome) {
    const modal = $('#rpm-feedback-modal');
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
    if (_resolveCurrent) { _resolveCurrent({ outcome }); _resolveCurrent = null; }
    _ctx = null;
    // Reset state
    $$('#rpm-fb-chips .nc-fb-chip').forEach(c => c.classList.remove('active'));
    const ta = $('#rpm-fb-text'); if (ta) ta.value = '';
  }

  async function _submit() {
    const reasonChip = $('#rpm-fb-chips .nc-fb-chip.active');
    const reasonCategory = reasonChip ? reasonChip.dataset.reason : 'other';
    const reasonText = ($('#rpm-fb-text')?.value || '').trim();

    if (!_ctx) { _close('error'); return; }

    try {
      await log({
        kind:            _ctx.kind,
        original:        _ctx.original,
        modified:        _ctx.modified,
        reason_category: reasonCategory,
        reason_text:     reasonText || null,
        graphId:         _ctx.graphId || null,
        context:         _ctx.context || {},
      });
      if (typeof Dashboard !== 'undefined') Dashboard.toast?.('Feedback saved · thanks for training the AI ✨', 'success');
    } catch (e) {
      console.error('[RPMFeedback] save failed:', e);
      if (typeof Dashboard !== 'undefined') Dashboard.toast?.('Could not save feedback', 'error');
    }
    _close('submitted');
  }

  // ───────────────────────────────────────────────────────────
  // Public — open the modal & wait for outcome
  // ───────────────────────────────────────────────────────────
  function ask({ kind, original, modified, graphId, context }) {
    return new Promise((resolve) => {
      _wire();
      const modal = $('#rpm-feedback-modal');
      if (!modal) { resolve({ outcome: 'no_modal' }); return; }

      _ctx = { kind, original, modified, graphId, context };
      _resolveCurrent = resolve;

      $('#rpm-fb-original').textContent  = (original ?? '').toString().trim() || '—';
      $('#rpm-fb-modified').textContent  = (modified ?? '').toString().trim() || '—';
      $('#rpm-fb-original').classList.toggle('empty', !original);
      $('#rpm-fb-modified').classList.toggle('empty', !modified);

      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
      // Focus the textarea after a tick
      setTimeout(() => $('#rpm-fb-text')?.focus(), 50);
    });
  }

  // ───────────────────────────────────────────────────────────
  // Public — direct log (no modal)
  // ───────────────────────────────────────────────────────────
  async function log({ kind, original, modified, reason_category, reason_text, graphId, context }) {
    if (typeof sb === 'undefined' || !sb) throw new Error('Supabase client not loaded');
    const coachId = (typeof Auth !== 'undefined') ? Auth.getUser()?.id : null;
    const row = {
      coach_id:        coachId,
      graph_id:        graphId || null,
      suggestion_kind: String(kind || ''),
      original_text:   (original ?? '').toString(),
      modified_text:   (modified ?? '').toString(),
      reason_category: reason_category || null,
      reason_text:     reason_text || null,
      context_jsonb:   context || {},
    };
    const { error } = await sb.from('ai_feedback_log').insert(row);
    if (error) throw error;
    return true;
  }

  // Bind on DOMContentLoaded so the modal is ready early
  document.addEventListener('DOMContentLoaded', _wire);

  window.RPMFeedback = { ask, log };
})();
