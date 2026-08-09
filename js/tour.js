// ═══════════════════════════════════════════════════════════════
//  js/tour.js — story-driven onboarding tour (Coach + Client)
//
//  Porcelain instrument tray art direction. Named chapters following the
//  clinical working day spine: assessment → findings → program → adherence → reassessment.
//  Gated on (role === 'coach' || role === 'client') && !profile.onboarding_completed_at.
//  Server-side persistence via complete_onboarding() RPC.
// ═══════════════════════════════════════════════════════════════
(() => {
  'use strict';

  const COACH_CHAPTERS = [
    {
      id: 'bench',
      name: 'Your bench',
      steps: [
        { sel: '#nav-dashboard', title: 'Your command center', body: 'Your dashboard overview — KPIs, recovery pulse alerts, and practice activity at a glance.' },
        // Anchored to the sidebar item, not `#notif-bell`. Above 901px the bell
        // is `display:none` unless the sidebar is hovered or focused, and during
        // a tour the cursor is on the card — so it would spotlight nothing.
        { sel: '#nav-notifications', title: 'Alerts & activity', body: 'Stay updated on approvals, client updates, and clinical notifications.' }
      ]
    },
    {
      id: 'client-arrives',
      name: 'A client arrives',
      steps: [
        { sel: '#nav-clients', title: 'Client roster', body: 'View and manage your client roster, active plans, and intake details.' },
        // Not a nav item — the button lives inside #section-clients, so the
        // section it needs has to be named rather than derived.
        { sel: '[onclick*="modal-add-client"]', section: 'clients', title: 'Add new client', body: 'Onboard a new client directly from your roster toolbar.' },
        { sel: '#nav-subscriptions', title: 'Client slots & access', body: 'Manage active access passes, seat allocations, and client tier limits.' }
      ]
    },
    {
      id: 'assessment',
      name: 'The assessment',
      steps: [
        { sel: '#nav-new-session', title: 'Clinical intake', body: 'Run structured movement assessments to capture baseline clinical data.' },
        { sel: '#nav-my-graph', title: '3D Body Map', body: 'Inspect regional tissue load and movement quality on the interactive 3D model.' }
      ]
    },
    {
      id: 'program',
      name: 'Findings become a program',
      steps: [
        { sel: '#nav-programs', title: 'Program generation', body: 'Transform assessment findings into periodised, multi-phase programs.' },
        { sel: '#nav-programs', title: 'Review & publish', body: 'Refine phase durations, exercise prescriptions, and publish to the client.' }
      ]
    },
    {
      id: 'adherence',
      name: 'What they actually did',
      steps: [
        { sel: '#nav-workout-history', title: 'Workout history', body: 'Track completed sessions, exercise volume, and reported execution quality.' },
        { sel: '#nav-appointments', title: 'Appointments', body: 'Schedule and review 1-on-1 check-ins and follow-up assessment sessions.' },
        { sel: '#nav-community', title: 'Client community', body: 'Engage with your client community and broadcast practice updates.' }
      ]
    },
    {
      id: 'practice',
      name: 'Your practice',
      steps: [
        { sel: '#nav-billing', title: 'Billing & membership', body: 'Manage your practice plan, client slots, and subscription billing.' },
        { sel: '#nav-exercise-library', title: 'Exercise library', body: 'Access and customize the clinical exercise database and movement cues.' }
      ]
    }
  ];

  const CLIENT_CHAPTERS = [
    {
      id: 'today',
      name: 'Today',
      steps: [
        { sel: '#section-dashboard', section: 'dashboard', title: 'Today’s view', body: 'Your daily dashboard — see your active tasks, progress, and upcoming sessions.' }
      ]
    },
    {
      id: 'program',
      name: 'Your program',
      steps: [
        { sel: '#section-client-train', section: 'client-train', title: 'Your training plan', body: 'Find your active training program prescribed by your coach.' },
        { sel: '#section-client-train', section: 'client-train', title: 'Starting a session', body: 'Open your current workout phase to follow guided exercises and log reps.' }
      ]
    },
    {
      id: 'progress',
      name: 'Seeing it work',
      steps: [
        { sel: '#section-client-progress', section: 'client-progress', title: 'Progress tracking', body: 'Track your movement scores, adherence trends, and recovery over time.' },
        { sel: '#section-my-graph', section: 'my-graph', title: 'Your Body Map', body: 'Visualize joint mobility and regional load changes as you improve.' }
      ]
    },
    {
      id: 'coach',
      name: 'Your coach',
      steps: [
        { sel: '#section-client-coach', section: 'client-coach', title: 'Coach check-ins', body: 'Connect with your coach, view feedback, and stay aligned on your goals.' },
        { sel: '#section-community', section: 'community', title: 'Community feed', body: 'Stay connected with fellow members and view practice announcements.' }
      ]
    },
    {
      id: 'rest',
      name: 'The rest',
      steps: [
        { sel: '#section-nutrition-plan', section: 'nutrition-plan', title: 'Nutrition guidance', body: 'View prescribed nutritional plans and hydration targets.' },
        { sel: '#section-client-settings', section: 'client-settings', title: 'Account settings', body: 'Update your profile, notification preferences, or replay this tour anytime.' }
      ]
    }
  ];

  let _i = 0;
  let _running = false;
  let _els = null;
  let _flatSteps = [];
  let _returnSection = null;   // where the user was before the tour moved them

  // The tour may only run on the app screen itself. Rather than listing the
  // gates — there are five `#screen-*` elements and the previous list named two
  // of them, plus an `#app` that does not exist, so that clause never fired —
  // require the app screen to be showing and every other screen to be hidden.
  // A new gate screen is then covered the day it is added.
  function _isGateVisible() {
    const shown = (el) => !!el && !el.classList.contains('hidden') && el.offsetParent !== null;

    const app = document.getElementById('screen-app');
    if (!shown(app)) return true;                       // app not on screen yet

    for (const screen of document.querySelectorAll('[id^="screen-"]')) {
      if (screen !== app && shown(screen)) return true; // some gate is up
    }
    return false;
  }

  // Which section a step wants on screen. Nav anchors map 1:1 (`#nav-clients`
  // -> section `clients`), so deriving it beats annotating every step: the two
  // can never drift apart. Anything else — the header bell, a button inside a
  // section — declares `section` explicitly, or nothing to stay put.
  function _sectionFor(step) {
    if (step.section) return step.section;
    const m = /^#nav-([a-z0-9-]+)$/.exec(step.sel || '');
    return m ? m[1] : null;
  }

  // Navigation only. `Dashboard.showSection` reads and swaps `.active`; it
  // writes nothing. It also enforces its own role guard, so a client can never
  // be routed somewhere they may not go, whatever a step asks for.
  function _showSectionFor(step) {
    const id = _sectionFor(step);
    if (!id) return;
    try {
      if (typeof Dashboard !== 'undefined' && Dashboard.showSection) Dashboard.showSection(id);
    } catch (e) {
      console.warn('[tour] could not open section', id, e.message);
    }
  }

  function start() {
    if (_running) return;
    if (_isGateVisible()) return;

    const role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'coach';
    const chapters = (role === 'client') ? CLIENT_CHAPTERS : COACH_CHAPTERS;

    _flatSteps = [];
    chapters.forEach((ch, cIdx) => {
      ch.steps.forEach((st, sIdx) => {
        _flatSteps.push({
          ...st,
          chapterIdx: cIdx,
          chapterName: ch.name,
          chapterCount: chapters.length,
          stepInChapter: sIdx + 1,
          totalInChapter: ch.steps.length,
          flatIdx: _flatSteps.length
        });
      });
    });

    if (!_flatSteps.length) return;

    // Remember the current screen so Finish/Skip can return to it. `.section`
    // ids are prefixed (`section-clients`); showSection takes the bare name.
    const active = document.querySelector('.section.active');
    _returnSection = active ? active.id.replace(/^section-/, '') : 'dashboard';

    _running = true;
    _i = 0;
    _build();
    _render();
    window.addEventListener('resize', _reposition);
    window.addEventListener('keydown', _onKey, true);
  }

  function _build() {
    const backdrop = document.createElement('div');
    backdrop.id = 'nc-tour-backdrop';

    const ring = document.createElement('div');
    ring.id = 'nc-tour-ring';

    const card = document.createElement('div');
    card.id = 'nc-tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Onboarding tour');

    backdrop.appendChild(ring);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    _els = { backdrop, ring, card };
  }

  function _render() {
    if (!_els || !_flatSteps.length) return;
    const step = _flatSteps[_i];
    const isLastStepInTour = (_i === _flatSteps.length - 1);
    const isLastChapter = (step.chapterIdx === step.chapterCount - 1);

    // Render chapter rail
    let railHtml = '<div class="nc-tour-rail">';
    for (let c = 0; c < step.chapterCount; c++) {
      let stateClass = 'upcoming';
      if (c < step.chapterIdx) stateClass = 'completed';
      else if (c === step.chapterIdx) stateClass = 'current';
      railHtml += `<div class="nc-tour-rail-seg ${stateClass}"></div>`;
    }
    railHtml += '</div>';

    const stepInChapterStr = step.totalInChapter > 1 ? `<span class="nc-tour-step-count">${step.stepInChapter} of ${step.totalInChapter}</span>` : '';

    _els.card.innerHTML = `
      <div class="nc-tour-header">
        ${railHtml}
        <div class="nc-tour-head-meta">
          <span class="nc-tour-chapter-title">Chapter ${step.chapterIdx + 1} of ${step.chapterCount} · ${step.chapterName}${stepInChapterStr}</span>
          <button type="button" class="nc-tour-btn-skip-tour" data-tour="skip">Skip tour</button>
        </div>
      </div>
      <div class="nc-tour-body">
        <div class="nc-tour-title">${step.title}</div>
        <div class="nc-tour-text">${step.body}</div>
      </div>
      <div class="nc-tour-footer">
        <button type="button" class="nc-tour-btn-back" data-tour="back" ${_i === 0 ? 'disabled' : ''}>← Back</button>
        <div style="display:flex;align-items:center;gap:8px">
          ${!isLastChapter ? '<button type="button" class="nc-tour-btn-skip-chapter" data-tour="skip-chapter">Skip chapter</button>' : ''}
          <button type="button" class="${isLastStepInTour ? 'nc-tour-btn-finish' : 'nc-tour-btn-next'}" data-tour="next">
            ${isLastStepInTour ? 'Finish' : 'Next →'}
          </button>
        </div>
      </div>`;

    _els.card.querySelector('[data-tour="skip"]').onclick = _complete;
    _els.card.querySelector('[data-tour="next"]').onclick = () => (isLastStepInTour ? _complete() : _go(1));
    _els.card.querySelector('[data-tour="back"]').onclick = () => _go(-1);
    const skipChBtn = _els.card.querySelector('[data-tour="skip-chapter"]');
    if (skipChBtn) skipChBtn.onclick = _skipChapter;

    // Put the screen this step describes on display, then measure. The anchor
    // may only exist once its section is active — "+ Add Client" lives inside
    // #section-clients — so positioning before the swap would spotlight nothing
    // and drop the card in the middle of the viewport.
    _showSectionFor(step);
    requestAnimationFrame(() => requestAnimationFrame(_reposition));
  }

  function _skipChapter() {
    const currentStep = _flatSteps[_i];
    const nextIdx = _flatSteps.findIndex(s => s.chapterIdx > currentStep.chapterIdx);
    if (nextIdx !== -1) {
      _i = nextIdx;
      _render();
    }
  }

  function _go(delta) {
    const n = _i + delta;
    if (n < 0 || n >= _flatSteps.length) return;
    _i = n;
    _render();
  }

  function _reposition() {
    if (!_els || !_flatSteps.length) return;
    const step = _flatSteps[_i];
    const target = step.sel ? document.querySelector(step.sel) : null;
    const visible = target && target.offsetParent !== null && target.getBoundingClientRect().width > 0;
    const card = _els.card, ring = _els.ring;

    // Some steps point at a whole screen rather than a control. Client steps do
    // this by necessity: a client has no sidebar — it is `display:none` at every
    // width — so there is no icon to ring, and the section itself is the
    // subject. Ringing a screen draws a border around everything and leaves the
    // card no room but on top of what it is pointing at (measured: 12-34% of the
    // target covered). Dim the page and centre the card instead.
    //
    // Section containers are recognised by what they are, not by how big they
    // happen to be, so the behaviour does not change with viewport or content.
    // The area rule is a backstop for any other target that grows to fill the
    // screen.
    const DOMINATES_SCREEN = 0.6;
    let isScreenTarget = false;
    if (visible) {
      const b = target.getBoundingClientRect();
      isScreenTarget = target.classList.contains('section')
        || (b.width * b.height) / (window.innerWidth * window.innerHeight) > DOMINATES_SCREEN;
    }

    if (!visible || isScreenTarget) {
      ring.style.display = 'none';
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%,-50%)';
      return;
    }
    card.style.transform = 'none';
    const r = target.getBoundingClientRect();
    const pad = 6;

    let targetRadius = 12;
    try {
      const computedRad = parseFloat(window.getComputedStyle(target).borderRadius);
      if (!isNaN(computedRad) && computedRad > 0) targetRadius = Math.min(computedRad + 2, 20);
    } catch (_) {}

    ring.style.display = 'block';
    ring.style.borderRadius = `${targetRadius}px`;
    ring.style.left = (r.left - pad) + 'px';
    ring.style.top = (r.top - pad) + 'px';
    ring.style.width = (r.width + pad * 2) + 'px';
    ring.style.height = (r.height + pad * 2) + 'px';

    const cw = Math.min(380, window.innerWidth - 32);
    const ch = card.offsetHeight || 240;

    let left, top;
    if (r.right + 16 + cw < window.innerWidth) {
      left = r.right + 16;
      top = Math.min(r.top, window.innerHeight - ch - 16);
    } else if (r.bottom + 16 + ch < window.innerHeight) {
      left = Math.min(r.left, window.innerWidth - cw - 16);
      top = r.bottom + 16;
    } else {
      left = Math.min(r.left, window.innerWidth - cw - 16);
      top = Math.max(16, r.top - ch - 16);
    }
    card.style.left = Math.max(16, left) + 'px';
    card.style.top = Math.max(16, top) + 'px';
  }

  function _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); _complete(); }
    else if (e.key === 'ArrowRight') { _go(1); }
    else if (e.key === 'ArrowLeft') { _go(-1); }
  }

  async function _complete() {
    _teardown();
    // The tour moved the user around; put them back where they started rather
    // than abandoning them on whatever chapter happened to be last.
    try {
      if (_returnSection && typeof Dashboard !== 'undefined' && Dashboard.showSection) {
        Dashboard.showSection(_returnSection);
      }
    } catch (e) {
      console.warn('[tour] could not restore section:', e.message);
    }
    _returnSection = null;
    try {
      if (typeof sb !== 'undefined' && sb.rpc) {
        await sb.rpc('complete_onboarding');
      }
      const p = (typeof Auth !== 'undefined' && Auth.getProfile) ? Auth.getProfile() : null;
      if (p) p.onboarding_completed_at = new Date().toISOString();
    } catch (e) {
      console.warn('[tour] complete_onboarding failed:', e.message);
    }
  }

  function _teardown() {
    _running = false;
    window.removeEventListener('resize', _reposition);
    window.removeEventListener('keydown', _onKey, true);
    if (_els?.backdrop) _els.backdrop.remove();
    _els = null;
    _flatSteps = [];
  }

  window.Tour = { start, complete: _complete, isRunning: () => _running };
})();
