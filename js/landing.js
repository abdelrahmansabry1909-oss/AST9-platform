/* ═══════════════════════════════════════════════════════════════
   NeuCore Landing — behaviour
   ───────────────────────────────────────────────────────────────
   Three jobs only: the nav's scrolled state, the mobile menu, and
   the footer year. The previous version also drove a tab strip and
   a drag carousel; the 2026 rebuild has neither, so that code is
   gone rather than left dead.

   Loaded as a classic script (not a module) so it runs on the
   static page without a build step.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── Scroll reveal ──────────────────────────────────────────
  // Each tagged block gets one entrance the first time it comes into
  // view. Groups reveal their children on a short stagger so a grid
  // reads as a single arrival instead of four separate events.
  const groups  = Array.from(document.querySelectorAll('[data-reveal-group]'));
  const singles = Array.from(document.querySelectorAll('[data-reveal]'))
    .filter((el) => !el.closest('[data-reveal-group]'));
  const revealTargets = [...groups, ...singles];

  if (revealTargets.length) {
    const root = document.documentElement;

    if (!('IntersectionObserver' in window)) {
      // No observer: show everything rather than hide it forever.
      root.classList.remove('js-reveal');
    } else {
      for (const group of groups) {
        Array.from(group.children).forEach((child, i) => {
          // Capped so a long grid never leaves the last card waiting.
          child.style.setProperty('--reveal-delay', `${Math.min(i, 5) * 70}ms`);
        });
      }

      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);  // one-shot: replaying on scroll-up is noise
        }
      }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });

      for (const el of revealTargets) io.observe(el);
    }
  }

  // ── Nav follows the section in view ────────────────────────
  // The margins collapse the observer's window to a band across the
  // middle of the viewport, so exactly one section is ever current.
  const navLinks = Array.from(document.querySelectorAll('.nav-link[href^="#"]'));
  const spied = navLinks
    .map((link) => ({ link, el: document.querySelector(link.getAttribute('href')) }))
    .filter((pair) => pair.el);

  if (spied.length && 'IntersectionObserver' in window) {
    const setCurrent = (hit) => {
      for (const pair of spied) {
        const on = pair === hit;
        pair.link.classList.toggle('is-current', on);
        if (on) pair.link.setAttribute('aria-current', 'true');
        else pair.link.removeAttribute('aria-current');
      }
    };

    const spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        setCurrent(spied.find((pair) => pair.el === entry.target));
      }
    }, { rootMargin: '-45% 0px -45% 0px' });

    for (const pair of spied) spy.observe(pair.el);
  }

  // ── Footer year ────────────────────────────────────────────
  const yearEl = document.getElementById('nc-year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // ── Nav border appears once the page has moved ─────────────
  const nav = document.getElementById('nc-nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ── Mobile menu ────────────────────────────────────────────
  // The panel is real and this handler is what makes the toggle a
  // control rather than decoration. A hamburger with no menu once
  // shipped here and left phone users with no way to reach Sign In,
  // so if the button is visible it must open something.
  const toggle = document.getElementById('nc-nav-toggle');
  const panel  = document.getElementById('nc-nav-panel');

  if (toggle && panel) {
    const setOpen = (open) => {
      panel.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };

    toggle.addEventListener('click', () => {
      setOpen(!panel.classList.contains('open'));
    });

    // Any navigation from inside the panel closes it.
    panel.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });

    // Escape closes it, and returns focus to the control that opened it.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) {
        setOpen(false);
        toggle.focus();
      }
    });

    // Leaving the mobile breakpoint must not strand an open panel
    // behind a hidden toggle.
    const wide = window.matchMedia('(min-width: 961px)');
    const onChange = (e) => { if (e.matches) setOpen(false); };
    if (wide.addEventListener) wide.addEventListener('change', onChange);
    else if (wide.addListener) wide.addListener(onChange);
  }

  // ── Movement Intelligence: one joint, several surfaces ─────
  // A joint can be represented four ways at once: a hotspot on the
  // composed photo, an outline over the card art painted into that
  // photo, a dot on the SVG figure, and a real telemetry card. Only
  // one presentation is on screen at a given width, but they share
  // a single selection so the behaviour never depends on which.
  const section = document.getElementById('visual');

  if (section) {
    const pick = (sel) => Array.from(section.querySelectorAll(sel));
    const hotspots = pick('.hot[data-joint]');        // photo, ≥961px
    const outlines = pick('.hot-card[data-joint]');   // photo card art
    const markers  = pick('#holo-stage [data-joint]'); // SVG echo, pointer only
    const cards    = pick('#joint-list [data-joint]'); // live layout, ≤960px

    const controls = [...hotspots, ...cards];         // take clicks + keys
    const styled   = [...hotspots, ...cards, ...markers];
    const mine = (el, joint) => el.dataset.joint === joint;

    let selected = null;

    const paint = (joint, cls, on) => {
      for (const el of styled) {
        if (mine(el, joint)) el.classList.toggle(cls, on);
      }
      for (const el of outlines) {
        if (mine(el, joint)) el.classList.toggle('is-lit', on);
      }
    };

    const hover = (joint, on) => {
      // A pinned joint keeps its selected styling; hover must not fight it.
      if (joint === selected) return;
      paint(joint, 'is-hot', on);
    };

    const select = (joint) => {
      const next = selected === joint ? null : joint;
      if (selected) { paint(selected, 'is-selected', false); paint(selected, 'is-hot', false); }
      for (const el of controls) el.setAttribute('aria-pressed', String(mine(el, next)));
      if (next) { paint(next, 'is-hot', false); paint(next, 'is-selected', true); }
      selected = next;
    };

    for (const el of styled) {
      const { joint } = el.dataset;
      el.addEventListener('mouseenter', () => hover(joint, true));
      el.addEventListener('mouseleave', () => hover(joint, false));
      el.addEventListener('click', () => select(joint));
    }

    for (const el of controls) {
      const { joint } = el.dataset;
      el.addEventListener('focus', () => hover(joint, true));
      el.addEventListener('blur',  () => hover(joint, false));
      // A real <button> fires click from Enter/Space on its own; the
      // telemetry card is an <article role="button"> and does not.
      if (el.tagName === 'BUTTON') continue;
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        e.preventDefault();   // Space would otherwise scroll the page
        select(joint);
      });
    }
  }

  // ── Athletic Performance: coming-soon dialog ───────────────
  // The lane is gated to admin in the app, so the landing card must
  // not send anyone to a sign-in they cannot use.
  const soon = document.getElementById('soon-modal');

  if (soon) {
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(soon.querySelectorAll(FOCUSABLE))
      .filter((el) => el.getClientRects().length > 0);

    let opener = null;

    const openSoon = (trigger) => {
      opener = trigger;
      soon.classList.add('open');
      document.body.style.overflow = 'hidden';
      focusables()[0]?.focus();
    };

    const closeSoon = () => {
      soon.classList.remove('open');
      // Another .vm may still be up; only hand scrolling back if none is.
      if (!document.querySelector('.vm.open')) document.body.style.overflow = '';
      opener?.focus();   // send the keyboard back where it came from
      opener = null;
    };

    for (const trigger of document.querySelectorAll('[data-soon]')) {
      trigger.addEventListener('click', () => openSoon(trigger));
    }
    for (const btn of soon.querySelectorAll('[data-soon-close]')) {
      btn.addEventListener('click', closeSoon);
    }
    // The backdrop dismisses; a click inside the card must not.
    soon.addEventListener('click', (e) => { if (e.target === soon) closeSoon(); });

    document.addEventListener('keydown', (e) => {
      if (!soon.classList.contains('open')) return;
      if (e.key === 'Escape') { closeSoon(); return; }
      if (e.key !== 'Tab') return;

      // A dialog the keyboard can walk out of is not actually modal.
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last  = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
})();
