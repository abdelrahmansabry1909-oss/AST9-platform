/* ═══════════════════════════════════════════════════════════════
   CLIENT TRAIN — guided recovery journey (Recovery Journey redesign · S2)

   Merges Daily Routine + Program into one calm, guided experience that
   answers three questions, top to bottom:

     1. Where am I?       journey header: stage + visual stepper + streak
     2. What today?       one dominant "Start session" action
     3. What's next?      the next milestone, in plain language

   Detailed content is kept behind progressive disclosure:
     - "Start session" reveals the existing daily-routine checklist
       (DailyRoutine.mountTracker) inline, lazily.
     - "Your training plan" reveals the day-based program
       (ClientProgram.render) inline, lazily.

   Presentation-layer only. Reuses DailyRoutine + ProgramPublish + the
   --nc-* tokens. No backend changes. Mounted by clientShell on the
   Train tab; render() is client-only.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // Shared helpers (S5): delegate to ClientUtil so escaping and the
  // Recovery Journey stage map stay identical across the client screens.
  const _esc        = (s) => ClientUtil.esc(s);
  const STAGES      = ClientUtil.STAGES;
  const _stageIndex = (phase) => ClientUtil.stageIndex(phase);

  function _nextMilestone(nextStage) {
    switch (nextStage) {
      case 'Strength Rebuilding':    return 'Once your mobility base feels steady, you will start rebuilding strength.';
      case 'Return to Performance':  return 'With strength returning, you will progress toward full performance.';
      case 'Peak Performance':       return 'You are approaching the final stage: performing at your best.';
      default:                       return 'Your coach will guide your next milestone.';
    }
  }

  function _stepper(idx) {
    return `<div style="display:flex;gap:6px;margin-top:14px">${
      STAGES.map((s, i) => `<div title="${_esc(s)}" aria-hidden="true"
        style="flex:1;height:6px;border-radius:99px;background:${i <= idx ? 'var(--nc-teal,#14B8A6)' : 'var(--nc-track)'};
               ${i === idx ? 'box-shadow:0 0 10px rgba(20,184,166,.5)' : ''}"></div>`).join('')
    }</div>`;
  }

  // Streak via the shared accountability calc (S5).
  const _streak = async (clientId) => (await ClientUtil.accountability(clientId)).streak;

  async function render(container) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) return;

    const profile  = (typeof Auth !== 'undefined' && Auth.getProfile) ? Auth.getProfile() : null;
    const clientId = profile?.id || null;
    const idx      = _stageIndex(profile?.current_phase);
    const nextStage = idx < STAGES.length - 1 ? STAGES[idx + 1] : null;

    // Read-only when the subscription has lapsed: the plan stays viewable
    // but check-ins are disabled (reuses the tracker's readOnly mode).
    const subState = (typeof Auth !== 'undefined' && Auth.getSubscriptionState) ? Auth.getSubscriptionState() : null;
    const canWrite = (typeof SubscriptionService !== 'undefined' && SubscriptionService.canWrite)
      ? SubscriptionService.canWrite(subState) : true;

    host.innerHTML = `
      <div style="max-width:520px;margin:0 auto;padding:6px 2px 8px">

        ${ClientUtil.isOffline() ? ClientUtil.offlineNote() : ''}

        <!-- WHERE AM I? -->
        <div style="margin:4px 4px 18px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Recovery Journey</div>
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:2px">
            <div style="font-size:22px;font-weight:800;letter-spacing:-.01em;color:var(--nc-text-primary,#F8FAFC)">${_esc(STAGES[idx])}</div>
            <div aria-live="polite" style="font-size:12px;color:var(--nc-text-secondary,#94A3B8);white-space:nowrap">🔥 <b id="ct-streak" style="color:var(--nc-text-primary,#F8FAFC)">…</b></div>
          </div>
          ${_stepper(idx)}
          <div style="margin-top:8px;font-size:12px;color:var(--nc-text-muted,#64748B)">Stage ${idx + 1} of ${STAGES.length}</div>
        </div>

        <!-- WHAT TODAY? -->
        <div style="border-radius:var(--nc-r-2xl,28px);background:var(--nc-bg-card,rgba(15,23,42,.7));border:1px solid var(--nc-border,rgba(255,255,255,.08));box-shadow:var(--nc-shadow-card,0 8px 32px rgba(0,0,0,.4));padding:20px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Today</div>
          <div style="font-size:18px;font-weight:700;color:var(--nc-text-primary,#F8FAFC);margin-top:2px">Today’s session</div>
          <div style="font-size:13px;color:var(--nc-text-secondary,#94A3B8);margin-top:4px">Move, breathe, reset. A few calm minutes.</div>
          <button id="ct-start" type="button"
            style="margin-top:16px;width:100%;min-height:60px;border:0;border-radius:var(--nc-r-lg,16px);background:var(--nc-teal,#14B8A6);color:#052e2b;
                   display:flex;align-items:center;justify-content:space-between;padding:14px 20px;cursor:pointer;
                   box-shadow:var(--nc-shadow-teal,0 0 40px rgba(20,184,166,.18));-webkit-tap-highlight-color:transparent">
            <span id="ct-start-label" style="font-size:16px;font-weight:700">Start session</span>
            <span style="font-size:20px">→</span>
          </button>
        </div>
        <div id="ct-session" style="margin-top:12px;display:none"></div>

        <!-- WHAT'S NEXT? -->
        <div style="margin-top:16px;border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-lg,16px);background:var(--nc-fill-1);padding:16px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">What's next</div>
          ${nextStage
            ? `<div style="font-size:16px;font-weight:700;color:var(--nc-text-primary,#F8FAFC);margin-top:2px">${_esc(nextStage)}</div>
               <div style="font-size:13px;line-height:1.5;color:var(--nc-text-secondary,#94A3B8);margin-top:4px">${_esc(_nextMilestone(nextStage))}</div>`
            : `<div style="font-size:14px;line-height:1.5;color:var(--nc-text-secondary,#94A3B8);margin-top:4px">You are in the final stage of your journey. Keep it up.</div>`}
        </div>

        <!-- FULL PLAN (progressive disclosure) -->
        <button id="ct-plan-toggle" type="button" aria-expanded="false"
          style="margin-top:16px;width:100%;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;cursor:pointer;
                 border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-lg,16px);background:transparent;
                 color:var(--nc-text-primary,#F8FAFC);-webkit-tap-highlight-color:transparent">
          <span style="font-size:14px;font-weight:600">Your training plan</span>
          <span id="ct-plan-chev" style="font-size:14px;color:var(--nc-text-muted,#64748B);transition:transform 180ms cubic-bezier(0.16,1,0.3,1)">▾</span>
        </button>
        <div id="ct-plan" style="margin-top:10px;display:none"></div>

      </div>`;

    // Streak (async, non-blocking).
    _streak(clientId).then((n) => {
      const el = host.querySelector('#ct-streak');
      if (el) el.textContent = `${n} day${n === 1 ? '' : 's'}`;
    });

    // Start session: reveal the existing daily-routine checklist inline (lazy).
    const startBtn  = host.querySelector('#ct-start');
    const startLbl  = host.querySelector('#ct-start-label');
    const sessionEl = host.querySelector('#ct-session');
    let sessionMounted = false;
    startBtn?.addEventListener('click', () => {
      const hidden = sessionEl.style.display === 'none';
      if (hidden) {
        sessionEl.style.display = 'block';
        if (startLbl) startLbl.textContent = 'Hide session';
        if (!sessionMounted && window.DailyRoutine && DailyRoutine.mountTracker) {
          DailyRoutine.mountTracker(sessionEl, { clientId, readOnly: !canWrite });
          sessionMounted = true;
        }
        sessionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        sessionEl.style.display = 'none';
        if (startLbl) startLbl.textContent = 'Start session';
      }
    });

    // Full plan: reveal the day-based program inline (lazy). CX1 — the old
    // stacked render is replaced by ClientProgram (day cards → day detail →
    // guided execution). The Today CTA deep-links here via _ncOpenProgram.
    const planToggle = host.querySelector('#ct-plan-toggle');
    const planEl     = host.querySelector('#ct-plan');
    const chev       = host.querySelector('#ct-plan-chev');
    let planMounted  = false;
    const openPlan = (openToday) => {
      planEl.style.display = 'block';
      planToggle.setAttribute('aria-expanded', 'true');
      if (chev) chev.style.transform = 'rotate(180deg)';
      if (!planMounted && window.ClientProgram && ClientProgram.render) {
        ClientProgram.render(planEl, { openToday: !!openToday });
        planMounted = true;
      }
    };
    const closePlan = () => {
      planEl.style.display = 'none';
      planToggle.setAttribute('aria-expanded', 'false');
      if (chev) chev.style.transform = '';
    };
    planToggle?.addEventListener('click', () => {
      if (planEl.style.display !== 'none') closePlan(); else openPlan(false);
    });

    // Express path: arriving from Today's "Start today's session" opens the
    // plan straight to today's day, so the client can start in two taps.
    if (window._ncOpenProgram) {
      window._ncOpenProgram = false;
      openPlan(true);
      requestAnimationFrame(() => { try { planEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} });
    }
  }

  window.ClientTrain = { render };
})();
