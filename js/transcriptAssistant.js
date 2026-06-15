/* ═══════════════════════════════════════════════════════════════
   NeuCore — Subjective Assessment Transcript Assistant (Phase 8, V1)

   Paste an assessment-call transcript → get a STRUCTURED DRAFT mapped to
   the existing NeuCore Subjective fields. The coach reviews each suggestion
   and applies what they want; nothing is finalized here — the normal wizard
   Finalize remains the only save-into-assessment gate.

   Backend: edge function `subjective-transcript-assistant` (Anthropic when a
   key is configured, otherwise a deterministic bilingual heuristic). The
   transcript is sent over an authenticated request, processed transiently,
   and never stored, logged, or put in localStorage / notifications.

   Public API (window.TranscriptAssistant):
     open()            — opens the modal (requires a selected client)
     analyze()         — sends the transcript, renders draft suggestions
     apply(col)        — applies one suggestion into the wizard draft
     applyAll()        — applies every suggestion

   Module pattern: vanilla IIFE, exposes as window.TranscriptAssistant.
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const FN  = 'subjective-transcript-assistant';
  const MAX = 16000;   // mirror the edge function's MAX_TRANSCRIPT

  // Draft column → wizard field metadata. Columns MUST match
  // js/rpm/subjective.js. red_flag_screen and the 0-10 sliders are
  // deliberately absent — never auto-filled.
  const FIELDS = [
    { col: 'external_pain',          label: 'External pain (where / when / how)',         step: 11, kind: 'text' },
    { col: 'life_impact',            label: 'Internal motivator — what pain stops them',   step: 2,  kind: 'text' },
    { col: 'mechanism_of_injury',    label: 'Mechanism of injury',                         step: 3,  kind: 'text' },
    { col: 'aggravating_factors',    label: 'Aggravating factors',                         step: 4,  kind: 'chips' },
    { col: 'easing_factors',         label: 'Easing factors',                              step: 4,  kind: 'chips' },
    { col: 'stress_timeline',        label: 'Stressors timeline',                          step: 5,  kind: 'stress' },
    { col: 'past_treatments',        label: 'Past treatments',                             step: 6,  kind: 'treat' },
    { col: 'hidden_objections',      label: 'Hidden objections',                           step: 6,  kind: 'text' },
    { col: 'fast_start_opportunity', label: 'Fast-start opportunity',                      step: 8,  kind: 'text' },
    { col: 'medications',            label: 'Medications',                                 step: 10, kind: 'chips' },
    { col: 'yellow_flags',           label: 'Yellow flags / medical history',              step: 10, kind: 'text' },
    { col: 'dream_outcome',          label: 'Dream outcome',                               step: 12, kind: 'text' },
  ];
  const BY_COL = Object.fromEntries(FIELDS.map(f => [f.col, f]));

  let _draft = null;
  let _clientId = null;

  // ── Helpers ───────────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const $ = (id) => document.getElementById(id);
  function _toast(msg, kind) { if (typeof Dashboard !== 'undefined') Dashboard.toast?.(msg, kind); }

  function _hasValue(v) {
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'string' && v.trim().length > 0;
  }

  function _preview(f, v) {
    if (f.kind === 'chips')  return (v || []).join('  ·  ');
    if (f.kind === 'stress') return (v || []).map(r => `${r.year || '?'} — ${r.event || ''}${r.type ? ` (${r.type})` : ''}`).join('  ·  ');
    if (f.kind === 'treat')  return (v || []).map(r => `${r.modality || '?'}${r.outcome ? ` (${r.outcome.replace(/_/g, ' ')})` : ''}`).join('  ·  ');
    return String(v || '');
  }

  // ── Open ──────────────────────────────────────────────────────
  function open() {
    const cid = $('ns-client-select')?.value || null;
    if (!cid) { _toast('Select a client first to import a transcript.', 'error'); return; }
    _clientId = cid;
    _draft = null;
    if ($('ta-text'))    $('ta-text').value = '';
    if ($('ta-lang'))    $('ta-lang').value = 'mixed';
    if ($('ta-results')) $('ta-results').innerHTML = '';
    _setLoading(false);
    if (typeof Dashboard !== 'undefined') Dashboard.openModal('modal-transcript');
  }

  // ── Analyze ───────────────────────────────────────────────────
  function _setLoading(on) {
    const btn = $('ta-analyze');
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? 'Analyzing…' : 'Analyze transcript';
  }

  async function _serverMessage(err) {
    try { const j = await err?.context?.json?.(); return j?.error || ''; } catch { return ''; }
  }

  async function analyze() {
    const transcript = ($('ta-text')?.value || '').trim();
    const language   = $('ta-lang')?.value || 'mixed';
    const out = $('ta-results');

    if (transcript.length < 12)   { _toast('Paste a transcript first.', 'error'); return; }
    if (transcript.length > MAX)  { _toast(`Transcript is too long (max ${MAX.toLocaleString()} characters).`, 'error'); return; }
    if (!_clientId)               { _toast('Select a client first.', 'error'); return; }
    if (typeof sb === 'undefined') { _toast('Not connected — please reload.', 'error'); return; }

    _setLoading(true);
    if (out) out.innerHTML = `<div class="ta-loading">Reading the transcript…</div>`;
    try {
      const { data, error } = await sb.functions.invoke(FN, {
        body: { transcript, language, client_id: _clientId },
      });
      if (error) {
        const msg = await _serverMessage(error);
        throw new Error(msg || 'analysis failed');
      }
      _draft = (data && data.draft) || {};
      _renderResults(data || {});
    } catch (e) {
      // Never log the transcript — only the error message.
      console.error('[TranscriptAssistant] analyze failed:', e?.message || 'error');
      if (out) out.innerHTML = `<div class="ta-error">${esc(e?.message || 'Could not analyse the transcript.')}</div>`;
    } finally {
      _setLoading(false);
    }
  }

  // ── Render review panel ───────────────────────────────────────
  function _renderResults(data) {
    const out = $('ta-results');
    if (!out) return;
    const draft = data.draft || {};
    const cautions = Array.isArray(data.cautions) ? data.cautions : [];
    const isAI = data.source === 'anthropic';
    const suggestions = FIELDS.filter(f => _hasValue(draft[f.col]));

    let html = `
      <div class="ta-banner ${isAI ? 'ta-ai' : 'ta-heur'}">
        <span class="ta-badge">${isAI ? '✨ AI-assisted draft' : '⚙ Heuristic draft'}</span>
        <span class="ta-warn">These are draft insights from the transcript. Review before applying.</span>
      </div>`;
    if (data.summary) html += `<div class="ta-summary">${esc(data.summary)}</div>`;

    if (cautions.length) {
      html += `<div class="ta-caution">⚠ Possible red-flag mentions: ${cautions.map(esc).join(', ')}.
        Screen the <strong>Red Flags</strong> step manually — these are never auto-applied.</div>`;
    }

    if (!suggestions.length) {
      html += `<div class="ta-empty">No structured suggestions found in this transcript. You can still write the assessment manually.</div>`;
      out.innerHTML = html;
      return;
    }

    html += `<div class="ta-apply-all"><button class="btn btn-sm btn-primary" onclick="TranscriptAssistant.applyAll()">Apply all suggestions</button></div>`;
    html += `<div class="ta-list">`;
    suggestions.forEach(f => {
      html += `
        <div class="ta-item" data-col="${esc(f.col)}">
          <div class="ta-item-head">
            <span class="ta-item-label">${esc(f.label)}</span>
            <span class="ta-item-step">Step ${f.step}</span>
          </div>
          <div class="ta-item-val">${esc(_preview(f, draft[f.col]))}</div>
          <button class="btn btn-sm btn-ghost ta-apply" onclick="TranscriptAssistant.apply('${f.col}')">Apply</button>
        </div>`;
    });
    html += `</div>`;
    out.innerHTML = html;
  }

  function _markApplied(col) {
    const item = document.querySelector(`.ta-item[data-col="${col}"]`);
    if (!item) return;
    item.classList.add('ta-applied');
    const btn = item.querySelector('.ta-apply');
    if (btn) { btn.disabled = true; btn.textContent = '✓ Applied'; }
  }

  // ── Apply ─────────────────────────────────────────────────────
  function _canApply() {
    if (typeof RPMSubjective === 'undefined' || !RPMSubjective.applyDraft) {
      _toast('Open a client assessment first.', 'error');
      return false;
    }
    return true;
  }

  function apply(col) {
    if (!_draft || !BY_COL[col] || !_hasValue(_draft[col])) return;
    if (!_canApply()) return;
    RPMSubjective.applyDraft({ [col]: _draft[col] });
    _markApplied(col);
    _toast('Applied to the assessment draft — review it in the wizard.', 'success');
  }

  function applyAll() {
    if (!_draft || !_canApply()) return;
    const partial = {};
    FIELDS.forEach(f => { if (_hasValue(_draft[f.col])) partial[f.col] = _draft[f.col]; });
    if (!Object.keys(partial).length) return;
    RPMSubjective.applyDraft(partial);
    Object.keys(partial).forEach(_markApplied);
    _toast('All suggestions applied to the draft — review every field in the wizard.', 'success');
  }

  // ── Expose ────────────────────────────────────────────────────
  window.TranscriptAssistant = { open, analyze, apply, applyAll };
})();
