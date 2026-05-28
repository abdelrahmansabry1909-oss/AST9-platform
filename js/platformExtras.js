/* ═══════════════════════════════════════════════════════════════
   NEUCORE PLATFORM EXTRAS
   - Case Studies carousel (sidebar "Case Studies" section)
   - Data-driven: shows admin-APPROVED community case studies.
     Approved cases come from the Community → Case Study board after
     an admin accepts them. With none approved yet, the hardcoded
     marketing cards in app.html are kept as a fallback.
   - Wired by Dashboard.showSection('case-studies').
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const state = {
    viewport:     null,
    track:        null,
    prevBtn:      null,
    nextBtn:      null,
    dotsHost:     null,
    slides:       [],
    index:        0,
    wired:        false,   // static control listeners bound only once
    fallbackHTML: null,    // original hardcoded marketing cards
  };

  // ── Helpers ───────────────────────────────────────────────────────
  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Deterministic gradient per card — distinct but stable across reloads.
  const _GRADIENTS = [
    'linear-gradient(155deg,#0E2A33,#103D4A 55%,#1A5563)',
    'linear-gradient(155deg,#10243A,#16324F 55%,#1E4A6E)',
    'linear-gradient(155deg,#241032,#341A4A 55%,#4A2563)',
    'linear-gradient(155deg,#2A1012,#4A1A1E 55%,#632530)',
    'linear-gradient(155deg,#102A1C,#1A4A33 55%,#236347)',
  ];
  function _gradFor(str) {
    let h = 0;
    for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return _GRADIENTS[Math.abs(h) % _GRADIENTS.length];
  }

  function _caseCardHTML(c) {
    const tags  = Array.isArray(c.tags) ? c.tags : [];
    const tag   = tags[0] || 'Case Study';
    const coach = c.coach?.full_name || c.coach?.email || 'NeuCore Coach';
    return `
      <a href="#" class="nc-case-card nc-case-card--data"
         style="background:${_gradFor(c.title)}" onclick="return false">
        <div class="nc-case-content">
          <span class="nc-case-tag">${_esc(tag)}</span>
          <div class="nc-case-title">${_esc(c.title)}</div>
          ${c.description ? `<div class="nc-case-desc">${_esc(c.description)}</div>` : ''}
          <div class="nc-case-readmore">Shared by ${_esc(coach)}</div>
        </div>
      </a>`;
  }

  // ── Carousel mechanics (operate on state.slides) ──────────────────
  const _getStep = () => {
    if (state.slides.length < 2) return 0;
    const a = state.slides[0].getBoundingClientRect();
    const b = state.slides[1].getBoundingClientRect();
    return b.left - a.left;
  };

  const _maxIndex = () => {
    const step = _getStep();
    if (!step) return 0;
    const visible = Math.max(1, Math.floor(state.viewport.clientWidth / step));
    return Math.max(0, state.slides.length - visible);
  };

  const _apply = () => {
    state.track.style.transform = `translateX(${-state.index * _getStep()}px)`;
  };

  const _updateControls = () => {
    const max = _maxIndex();
    if (state.prevBtn) state.prevBtn.disabled = state.index <= 0;
    if (state.nextBtn) state.nextBtn.disabled = state.index >= max;
    if (state.dotsHost) {
      Array.from(state.dotsHost.children).forEach((d, i) =>
        d.classList.toggle('active', i === state.index));
    }
  };

  const _goTo = (i) => {
    state.index = Math.max(0, Math.min(i, _maxIndex()));
    _apply();
    _updateControls();
  };

  function _buildDots() {
    if (!state.dotsHost) return;
    state.dotsHost.innerHTML = '';
    state.slides.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'nc-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
      dot.addEventListener('click', () => _goTo(i));
      state.dotsHost.appendChild(dot);
    });
  }

  // Static listeners — bound exactly once; they read live state.
  function _wireControls() {
    if (state.wired) return;
    state.wired = true;

    if (state.prevBtn) state.prevBtn.addEventListener('click', () => _goTo(state.index - 1));
    if (state.nextBtn) state.nextBtn.addEventListener('click', () => _goTo(state.index + 1));

    // Pointer drag
    let dragX = 0, dragBase = 0, dragging = false;
    const onDown = (e) => {
      dragging = true;
      dragX = e.clientX;
      dragBase = state.index * _getStep();
      state.track.style.transition = 'none';
      state.viewport.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragX;
      state.track.style.transform = `translateX(${-(dragBase - dx)}px)`;
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      state.track.style.transition = '';
      const step = _getStep();
      const moved = step ? Math.round(-(e.clientX - dragX) / step) : 0;
      _goTo(state.index + moved);
      state.viewport.releasePointerCapture?.(e.pointerId);
    };

    state.viewport.addEventListener('pointerdown', onDown);
    state.viewport.addEventListener('pointermove', onMove);
    state.viewport.addEventListener('pointerup', onUp);
    state.viewport.addEventListener('pointercancel', onUp);
    state.viewport.addEventListener('pointerleave', (e) => { if (dragging) onUp(e); });

    // Resize-safe alignment
    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        if (state.index > _maxIndex()) state.index = _maxIndex();
        _apply();
        _updateControls();
      }, 120);
    });
  }

  // ── Public entry point — re-runnable each time the section opens ───
  async function initCaseStudiesCarousel() {
    const viewport = document.getElementById('pf-carousel');
    const track    = document.getElementById('pf-carousel-track');
    if (!viewport || !track) return;

    state.viewport = viewport;
    state.track    = track;
    state.prevBtn  = document.getElementById('pf-carousel-prev');
    state.nextBtn  = document.getElementById('pf-carousel-next');
    state.dotsHost = document.getElementById('pf-carousel-dots');

    // Capture the hardcoded marketing cards once — the empty-state fallback.
    if (state.fallbackHTML === null) state.fallbackHTML = track.innerHTML;

    // Pull admin-approved community case studies.
    let cases = [];
    try {
      if (typeof Community !== 'undefined' && Community.loadApprovedCaseShares) {
        cases = await Community.loadApprovedCaseShares(20);
      }
    } catch (e) {
      console.warn('[case-studies] load failed:', e?.message || e);
      cases = [];
    }

    // Approved cases drive the carousel; with none, keep the marketing cards.
    track.innerHTML = cases.length
      ? cases.map(_caseCardHTML).join('')
      : state.fallbackHTML;

    state.slides = Array.from(track.children);
    state.index  = 0;
    _buildDots();
    _wireControls();
    requestAnimationFrame(() => { _apply(); _updateControls(); });
  }

  // Public API for Dashboard loaders
  window.PlatformExtras = {
    initCaseStudiesCarousel,
  };
})();
