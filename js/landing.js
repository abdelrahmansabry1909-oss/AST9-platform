/* ═══════════════════════════════════════════════════════════════
   NEUCORE LANDING — INTERACTIONS
   - Sticky nav scroll state
   - Feature tabs
   - Case studies carousel (snap + drag + dots + arrows)
   - Scroll-reveal via IntersectionObserver
   - Animated stats counter
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ── 1. Year ─────────────────────────────────────────────── */
  const yearEl = document.getElementById('nc-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ── 2. Sticky nav ───────────────────────────────────────── */
  const nav = document.getElementById('nc-nav');
  if (nav) {
    const onScroll = () => {
      if (window.scrollY > 24) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── 3. Feature tabs ─────────────────────────────────────── */
  const tabTriggers = document.querySelectorAll('.nc-tab-trigger');
  const tabPanels   = document.querySelectorAll('.nc-tab-panel');

  tabTriggers.forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const target = trigger.dataset.tab;

      tabTriggers.forEach((t) => {
        const isActive = t === trigger;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      tabPanels.forEach((p) => {
        p.classList.toggle('active', p.dataset.panel === target);
      });
    });
  });

  /* ── 4. Case studies carousel ────────────────────────────── */
  const viewport  = document.getElementById('nc-carousel');
  const track     = document.getElementById('nc-carousel-track');
  const prevBtn   = document.getElementById('nc-carousel-prev');
  const nextBtn   = document.getElementById('nc-carousel-next');
  const dotsHost  = document.getElementById('nc-carousel-dots');

  if (viewport && track) {
    const slides = Array.from(track.children);
    let currentIndex = 0;

    // Build dots
    if (dotsHost) {
      slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = 'nc-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
        dot.addEventListener('click', () => goTo(i));
        dotsHost.appendChild(dot);
      });
    }

    const getSlideStep = () => {
      if (slides.length < 2) return 0;
      const a = slides[0].getBoundingClientRect();
      const b = slides[1].getBoundingClientRect();
      return b.left - a.left; // slide width + gap
    };

    const maxIndex = () => {
      const step = getSlideStep();
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

    const applyTranslate = () => {
      const offset = currentIndex * getSlideStep();
      track.style.transform = `translateX(${-offset}px)`;
    };

    const goTo = (i) => {
      const max = maxIndex();
      currentIndex = Math.max(0, Math.min(i, max));
      applyTranslate();
      updateControls();
    };

    if (prevBtn) prevBtn.addEventListener('click', () => goTo(currentIndex - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goTo(currentIndex + 1));

    // Drag to scroll
    let dragStartX = 0;
    let dragStartTranslate = 0;
    let isDragging = false;

    const getTranslateX = () => {
      const m = track.style.transform.match(/-?\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) * (track.style.transform.includes('-') ? -1 : 1) : 0;
    };

    const onPointerDown = (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartTranslate = currentIndex * getSlideStep();
      track.style.transition = 'none';
      viewport.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      track.style.transform = `translateX(${-(dragStartTranslate - dx)}px)`;
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      track.style.transition = '';
      const dx = e.clientX - dragStartX;
      const step = getSlideStep();
      const moved = Math.round(-dx / step);
      goTo(currentIndex + moved);
      viewport.releasePointerCapture?.(e.pointerId);
    };

    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('pointerleave', (e) => { if (isDragging) onPointerUp(e); });

    // Keep alignment correct on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const max = maxIndex();
        if (currentIndex > max) currentIndex = max;
        applyTranslate();
        updateControls();
      }, 120);
    });

    // Initial state
    requestAnimationFrame(() => {
      applyTranslate();
      updateControls();
    });
  }

  /* ── 5. Scroll reveal ────────────────────────────────────── */
  const reveals = document.querySelectorAll('.nc-reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('in-view'));
  }

  /* ── 6. Animated stat counter (reveal-once) ──────────────── */
  const stats = document.querySelectorAll('.nc-stat-value');
  if ('IntersectionObserver' in window && stats.length) {
    const animateNumber = (el) => {
      const raw = el.textContent.trim();
      const match = raw.match(/^([\d.]+)(.*)$/);
      if (!match) return;
      const target = parseFloat(match[1]);
      const suffix = match[2] || '';
      const duration = 1400;
      const start = performance.now();

      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const value = target * eased;
        const formatted = target % 1 === 0
          ? Math.round(value).toLocaleString()
          : value.toFixed(1);
        el.textContent = formatted + suffix;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const statObs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateNumber(entry.target);
          statObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    stats.forEach((s) => statObs.observe(s));
  }

  /* ── 7. Smooth-scroll for in-page anchors (header offset) ─ */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const navHeight = nav ? nav.offsetHeight : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 12;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
})();
