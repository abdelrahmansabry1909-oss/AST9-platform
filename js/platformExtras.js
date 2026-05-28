/* ═══════════════════════════════════════════════════════════════
   NEUCORE PLATFORM EXTRAS
   - Case Studies carousel (re-uses landing page pattern)
   - Wired by Dashboard.showSection loaders
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  let _carouselInited = false;

  function initCaseStudiesCarousel() {
    if (_carouselInited) return;
    const viewport = document.getElementById('pf-carousel');
    const track    = document.getElementById('pf-carousel-track');
    const prevBtn  = document.getElementById('pf-carousel-prev');
    const nextBtn  = document.getElementById('pf-carousel-next');
    const dotsHost = document.getElementById('pf-carousel-dots');
    if (!viewport || !track) return;

    const slides = Array.from(track.children);
    let currentIndex = 0;

    if (dotsHost) {
      slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = 'nc-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
        dot.addEventListener('click', () => goTo(i));
        dotsHost.appendChild(dot);
      });
    }

    const getStep = () => {
      if (slides.length < 2) return 0;
      const a = slides[0].getBoundingClientRect();
      const b = slides[1].getBoundingClientRect();
      return b.left - a.left;
    };

    const maxIndex = () => {
      const step = getStep();
      if (!step) return 0;
      const visible = Math.max(1, Math.floor(viewport.clientWidth / step));
      return Math.max(0, slides.length - visible);
    };

    const updateControls = () => {
      const max = maxIndex();
      if (prevBtn) prevBtn.disabled = currentIndex <= 0;
      if (nextBtn) nextBtn.disabled = currentIndex >= max;
      if (dotsHost) {
        Array.from(dotsHost.children).forEach((d, i) =>
          d.classList.toggle('active', i === currentIndex)
        );
      }
    };

    const apply = () => {
      track.style.transform = `translateX(${-currentIndex * getStep()}px)`;
    };

    const goTo = (i) => {
      currentIndex = Math.max(0, Math.min(i, maxIndex()));
      apply();
      updateControls();
    };

    if (prevBtn) prevBtn.addEventListener('click', () => goTo(currentIndex - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goTo(currentIndex + 1));

    // Pointer drag
    let dragX = 0, dragBase = 0, dragging = false;
    const onDown = (e) => {
      dragging = true;
      dragX = e.clientX;
      dragBase = currentIndex * getStep();
      track.style.transition = 'none';
      viewport.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragX;
      track.style.transform = `translateX(${-(dragBase - dx)}px)`;
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      track.style.transition = '';
      const moved = Math.round(-(e.clientX - dragX) / getStep());
      goTo(currentIndex + moved);
      viewport.releasePointerCapture?.(e.pointerId);
    };

    viewport.addEventListener('pointerdown', onDown);
    viewport.addEventListener('pointermove', onMove);
    viewport.addEventListener('pointerup', onUp);
    viewport.addEventListener('pointercancel', onUp);
    viewport.addEventListener('pointerleave', (e) => { if (dragging) onUp(e); });

    // Resize-safe alignment
    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        if (currentIndex > maxIndex()) currentIndex = maxIndex();
        apply();
        updateControls();
      }, 120);
    });

    requestAnimationFrame(() => { apply(); updateControls(); });
    _carouselInited = true;
  }

  // Public API for Dashboard loaders
  window.PlatformExtras = {
    initCaseStudiesCarousel,
  };
})();
