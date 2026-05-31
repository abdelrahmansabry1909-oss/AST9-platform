/* ═══════════════════════════════════════════════════════════════
   NeuCore — Exercise Picker (reusable modal component)

   ONE picker, two consumers:
     * Feature 5  — coach picks an exercise in programPublish editor
     * Feature 6  — coach picks a substitute in the alt-response modal

   Both autosuggest (typeahead under the input) AND filter-chip
   workflows are wired. The 7 chips ship per spec:
     All · Phase 1 · Phase 2 · Phase 3 · Mobility · Strength · Conditioning

   Chip → query mapping:
     All           → no filter
     Phase 1/2/3   → ExerciseLibrary.loadAll({ phase: 'Phase N' })
     Mobility      → loadAll({ category: 'Mobility' })
     Strength      → loadAll({ category: 'Strength' })
     Conditioning  → loadAll({ tag: 'conditioning' })  ← tag-based,
                     because the live exercises.category CHECK doesn't
                     include 'Conditioning' and we're under a zero-
                     migration constraint. Coaches tag exercises with
                     'conditioning' to surface them here.

   Public surface (window.ExercisePicker):
     open({ phase, defaultFilter, onSelect, title })
         → returns a Promise that resolves on select / rejects on close

   onSelect signature (also the Promise resolve value):
     { exercise_id, exercise_name, exercise }   ← full row available
                                                  if consumer wants
                                                  default sets/reps/etc

   Caller pattern (sync, no await needed):
     ExercisePicker.open({
       defaultFilter: 'Phase 1',
       onSelect: ({ exercise_id, exercise_name }) => { ... },
     });
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Filter chips — ordered exactly as the spec lists.
  const FILTERS = [
    { id: 'all',          label: 'All' },
    { id: 'phase1',       label: 'Phase 1' },
    { id: 'phase2',       label: 'Phase 2' },
    { id: 'phase3',       label: 'Phase 3' },
    { id: 'mobility',     label: 'Mobility' },
    { id: 'strength',     label: 'Strength' },
    { id: 'conditioning', label: 'Conditioning' },
  ];

  // Map filter id → ExerciseLibrary.loadAll() options.
  function _filterQuery(id) {
    switch (id) {
      case 'phase1':       return { phase: 'Phase 1' };
      case 'phase2':       return { phase: 'Phase 2' };
      case 'phase3':       return { phase: 'Phase 3' };
      case 'mobility':     return { category: 'Mobility' };
      case 'strength':     return { category: 'Strength' };
      case 'conditioning': return { tag:      'conditioning' };
      case 'all':
      default:             return {};
    }
  }

  // ── Modal singleton DOM ────────────────────────────────────────
  function _ensureModal() {
    let modal = document.getElementById('modal-exercise-picker');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'modal-exercise-picker';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal" style="max-width:680px;max-height:85vh;display:flex;flex-direction:column">
        <div class="modal-header" style="flex-shrink:0">
          <h3 id="ep-title">Pick Exercise</h3>
          <button class="btn-icon" data-action="close">✕</button>
        </div>
        <div class="modal-body" style="padding-top:8px;flex:1;overflow:hidden;display:flex;flex-direction:column">

          <input id="ep-search" class="form-input" placeholder="Search exercise name…"
                 autocomplete="off" style="margin-bottom:10px;flex-shrink:0">

          <div id="ep-suggest" class="hidden"
               style="position:absolute;background:var(--bg-raised,#0f172a);
                      border:1px solid var(--border-subtle);border-radius:8px;
                      max-height:240px;overflow:auto;z-index:9999;
                      box-shadow:0 12px 32px rgba(0,0,0,.45);min-width:300px"></div>

          <div id="ep-filters" role="tablist"
               style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px;flex-shrink:0">
            ${FILTERS.map((f) => `
              <button type="button" class="btn btn-ghost btn-sm ep-chip" data-filter="${f.id}">${esc(f.label)}</button>
            `).join('')}
          </div>

          <div id="ep-list"
               style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:4px">
          </div>
        </div>
        <div class="modal-footer" style="flex-shrink:0">
          <span id="ep-meta" style="font-size:11px;color:var(--text-tertiary);margin-right:auto"></span>
          <button class="btn btn-ghost" data-action="close">Close</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  // ── Open ───────────────────────────────────────────────────────
  function open(opts = {}) {
    if (typeof ExerciseLibrary === 'undefined') {
      console.warn('[picker] ExerciseLibrary not loaded');
      return Promise.reject(new Error('ExerciseLibrary not loaded'));
    }

    const modal = _ensureModal();
    const title    = modal.querySelector('#ep-title');
    const search   = modal.querySelector('#ep-search');
    const suggest  = modal.querySelector('#ep-suggest');
    const filters  = modal.querySelector('#ep-filters');
    const list     = modal.querySelector('#ep-list');
    const metaEl   = modal.querySelector('#ep-meta');
    const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;

    title.textContent = opts.title || 'Pick Exercise';
    search.value = '';
    suggest.classList.add('hidden');
    let activeFilter = opts.defaultFilter || (opts.phase ? _phaseFilterId(opts.phase) : 'all');

    // ── State + resolver ─────────────────────────────────────────
    let resolved = false;
    const result = new Promise((resolve, reject) => {
      modal._resolve = (v) => { if (!resolved) { resolved = true; resolve(v); } };
      modal._reject  = () => { if (!resolved) { resolved = true; reject(new Error('cancelled')); } };
    });

    // ── Close handlers ───────────────────────────────────────────
    const close = () => {
      modal.classList.add('hidden');
      suggest.classList.add('hidden');
      modal._reject?.();
      _detachHandlers();
    };
    function _onOverlayClick(e) { if (e.target === modal) close(); }
    function _onKey(e) { if (e.key === 'Escape') close(); }
    function _detachHandlers() {
      modal.removeEventListener('click', _onOverlayClick);
      document.removeEventListener('keydown', _onKey);
    }
    modal.querySelectorAll('[data-action="close"]').forEach((b) => b.onclick = close);
    modal.addEventListener('click', _onOverlayClick);
    document.addEventListener('keydown', _onKey);

    // ── Picker resolution ────────────────────────────────────────
    function _pick(ex) {
      const payload = {
        exercise_id:   ex.id,
        exercise_name: ex.name,
        exercise:      ex,
      };
      modal.classList.add('hidden');
      suggest.classList.add('hidden');
      _detachHandlers();
      modal._resolve?.(payload);
      if (onSelect) {
        try { onSelect(payload); }
        catch (e) { console.warn('[picker] onSelect threw:', e); }
      }
    }

    // ── Filter chips ─────────────────────────────────────────────
    function _highlightChip() {
      filters.querySelectorAll('.ep-chip').forEach((b) => {
        const on = b.dataset.filter === activeFilter;
        b.classList.toggle('btn-primary', on);
        b.classList.toggle('btn-ghost', !on);
      });
    }
    filters.querySelectorAll('.ep-chip').forEach((b) => {
      b.onclick = () => { activeFilter = b.dataset.filter; _highlightChip(); _renderList(); };
    });
    _highlightChip();

    // ── Search + autosuggest (200ms debounce) ────────────────────
    let _suggestTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(_suggestTimer);
      const q = search.value.trim();
      if (!q) { suggest.classList.add('hidden'); _renderList(); return; }
      _suggestTimer = setTimeout(async () => {
        const items = await ExerciseLibrary.loadAll({ search: q });
        _renderSuggest(items.slice(0, 8));
        _renderList(items);
      }, 200);
    });
    search.addEventListener('focus', () => {
      if (search.value.trim()) suggest.classList.remove('hidden');
    });
    search.addEventListener('blur', () => {
      // Delay so clicks on suggestions register before hide.
      setTimeout(() => suggest.classList.add('hidden'), 180);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = suggest.querySelector('[data-pick-id]');
        if (first) first.click();
      }
    });

    function _renderSuggest(items) {
      if (!items.length) { suggest.classList.add('hidden'); return; }
      suggest.innerHTML = items.map((ex) => `
        <div data-pick-id="${esc(ex.id)}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border-subtle);font-size:12px;color:var(--text-primary)">
          <div style="font-weight:600">${esc(ex.name)}</div>
          <div style="font-size:11px;color:var(--text-tertiary)">${esc(ex.phase || '')} · ${esc(ex.category || '')}</div>
        </div>`).join('');
      // Position under the input
      const rect = search.getBoundingClientRect();
      suggest.style.top   = (rect.bottom + window.scrollY + 4) + 'px';
      suggest.style.left  = (rect.left   + window.scrollX) + 'px';
      suggest.style.width = rect.width + 'px';
      suggest.classList.remove('hidden');
      suggest.querySelectorAll('[data-pick-id]').forEach((row) => {
        row.onmousedown = (e) => e.preventDefault();   // keep input focus
        row.onclick = () => {
          const ex = items.find((x) => x.id === row.dataset.pickId);
          if (ex) _pick(ex);
        };
      });
    }

    // ── Main list (filter-driven) ────────────────────────────────
    async function _renderList(preItems) {
      list.innerHTML = `<div style="text-align:center;padding:24px"><span class="spinner"></span></div>`;
      const q     = search.value.trim();
      const items = preItems || await ExerciseLibrary.loadAll({
        ...(_filterQuery(activeFilter)),
        ...(q ? { search: q } : {}),
      });
      metaEl.textContent = `${items.length} exercise${items.length === 1 ? '' : 's'}`;
      if (!items.length) {
        list.innerHTML = `<div class="empty-state" style="padding:32px">
          <span class="empty-icon">▶</span>
          <div class="empty-title">No matches</div>
          <p class="empty-desc">Try a different filter or clear the search.</p>
        </div>`;
        return;
      }
      list.innerHTML = items.map((ex) => `
        <div data-row-id="${esc(ex.id)}"
             style="display:grid;grid-template-columns:60px 1fr auto;gap:10px;align-items:center;
                    padding:8px;border:1px solid var(--border-subtle);border-radius:8px;
                    background:rgba(255,255,255,.02);cursor:pointer">
          ${_thumb(ex)}
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ex.name)}</div>
            <div style="font-size:11px;color:var(--text-tertiary)">
              ${esc(ex.phase || '—')} · ${esc(ex.category || '—')}
              ${(Array.isArray(ex.tags) && ex.tags.length) ? ' · ' + esc(ex.tags.slice(0, 3).join(', ')) : ''}
            </div>
          </div>
          <button class="btn btn-primary btn-xs">Pick →</button>
        </div>`).join('');
      list.querySelectorAll('[data-row-id]').forEach((row) => {
        row.onclick = () => {
          const ex = items.find((x) => x.id === row.dataset.rowId);
          if (ex) _pick(ex);
        };
      });
    }

    function _thumb(ex) {
      const url = ex.thumbnail_url
        || (ex.video_url && typeof ExerciseLibrary.getThumbnailUrl === 'function'
            ? ExerciseLibrary.getThumbnailUrl(ex.video_url) : null);
      if (url) {
        return `<img src="${esc(url)}" alt="" loading="lazy"
                style="width:60px;height:40px;object-fit:cover;border-radius:4px;background:#0f172a">`;
      }
      return `<div style="width:60px;height:40px;border-radius:4px;background:rgba(255,255,255,.04);
                          display:flex;align-items:center;justify-content:center;color:#475569;font-size:14px">▶</div>`;
    }

    modal.classList.remove('hidden');
    _renderList();
    setTimeout(() => search.focus(), 50);
    return result;
  }

  function _phaseFilterId(phase) {
    if (phase === 'Phase 1') return 'phase1';
    if (phase === 'Phase 2') return 'phase2';
    if (phase === 'Phase 3') return 'phase3';
    return 'all';
  }

  window.ExercisePicker = { open };
})();
