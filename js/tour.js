// ═══════════════════════════════════════════════════════════════
//  js/tour.js — first-login onboarding tour (Phase 4)
//
//  Premium, skippable, step-based spotlight. Shown once to a new coach
//  (role=coach && profiles.onboarding_completed_at IS NULL). Completion is
//  persisted server-side via the complete_onboarding() RPC (not local-only),
//  so it never repeats after finish or skip. Existing coaches were
//  backfilled to "completed" and are never disrupted.
//
//  Anchors each step to a real nav target when visible; otherwise centers
//  the card (used for not-yet-live features). Started from UI._showApp().
// ═══════════════════════════════════════════════════════════════
(() => {
  'use strict';

  const STEPS = [
    { sel: '#nav-dashboard', title: 'Your dashboard', body: 'Your command center — KPIs, recovery alerts and business growth at a glance.' },
    { sel: '#nav-clients',   title: 'Clients',        body: 'Create and manage your clients. Your plan decides how many you can add.' },
    { sel: '#nav-billing',   title: 'Billing & plans', body: 'See your package, client-slot usage and upgrade options — billed monthly or annually.' },
    { sel: '#nav-new-session', title: 'Assessment',   body: 'Run a full assessment to capture the clinical picture for each client.' },
    { sel: '#nav-new-session', title: 'Program generation', body: 'Turn an assessment into an intelligent, periodised recovery program in seconds.' },
    { sel: '#nav-programs',  title: 'Programs',        body: 'Review and publish each client’s program. A manual builder is coming soon.' },
    { sel: '#nav-clients',   title: 'Recovery Pulse',  body: 'Recovery Pulse ranks who needs attention first — surfaced on your dashboard and client list.' },
    { sel: '#notif-bell',    title: 'Notifications',   body: 'Stay on top of alerts, approvals and client activity. Appointment scheduling is on the way.' },
  ];

  let _i = 0;
  let _running = false;
  let _els = null;        // { backdrop, ring, card } once built

  function start() {
    if (_running) return;
    _running = true;
    _i = 0;
    _build();
    _render();
    window.addEventListener('resize', _reposition);
    window.addEventListener('keydown', _onKey, true);
  }

  function _build() {
    const backdrop = document.createElement('div');
    backdrop.id = 'nc-tour';
    backdrop.style.cssText =
      'position:fixed;inset:0;z-index:9000;background:rgba(13,24,40,0.45);' +
      'backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)';

    const ring = document.createElement('div');
    ring.style.cssText =
      'position:fixed;z-index:9001;border-radius:14px;pointer-events:none;' +
      'box-shadow:0 0 0 3px #14b8a6, 0 0 0 9px rgba(20,184,166,0.25), 0 0 0 9999px rgba(13,24,40,0.45);' +
      'transition:all .3s ease;display:none';

    const card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Onboarding tour');
    card.style.cssText =
      'position:fixed;z-index:9002;max-width:330px;width:calc(100vw - 36px);' +
      'background:#fff;color:#0D1828;border-radius:16px;padding:20px 20px 16px;' +
      'box-shadow:0 24px 60px rgba(13,24,40,0.28);border:1px solid rgba(13,24,40,0.08);' +
      'font-family:var(--nc-font-body,Inter,sans-serif)';

    backdrop.appendChild(ring);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    _els = { backdrop, ring, card };
  }

  function _render() {
    const step = STEPS[_i];
    const total = STEPS.length;
    const dots = STEPS.map((_, k) =>
      `<span style="width:6px;height:6px;border-radius:99px;background:${k === _i ? '#14b8a6' : 'rgba(13,24,40,0.18)'}"></span>`
    ).join('');
    const isLast = _i === total - 1;

    _els.card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#14b8a6">Step ${_i + 1} of ${total}</span>
        <button type="button" data-tour="skip" style="background:none;border:none;cursor:pointer;font:inherit;font-size:12px;color:#7C89A4">Skip tour</button>
      </div>
      <div style="font-size:17px;font-weight:800;letter-spacing:-.3px;margin-bottom:6px">${step.title}</div>
      <div style="font-size:13px;line-height:1.55;color:#41506A">${step.body}</div>
      <div style="display:flex;align-items:center;gap:5px;margin:16px 0 0">${dots}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
        <button type="button" data-tour="back" ${_i === 0 ? 'disabled' : ''}
          style="background:none;border:none;cursor:${_i === 0 ? 'default' : 'pointer'};font:inherit;font-size:13px;font-weight:600;color:${_i === 0 ? 'rgba(13,24,40,0.25)' : '#41506A'}">← Back</button>
        <button type="button" data-tour="next"
          style="background:linear-gradient(135deg,#14b8a6,#2dd4bf);border:none;cursor:pointer;font:inherit;
                 font-size:13px;font-weight:700;color:#fff;padding:9px 18px;border-radius:10px">
          ${isLast ? 'Finish' : 'Next'}</button>
      </div>`;

    _els.card.querySelector('[data-tour="skip"]').onclick = _complete;
    _els.card.querySelector('[data-tour="next"]').onclick = () => (isLast ? _complete() : _go(1));
    _els.card.querySelector('[data-tour="back"]').onclick = () => _go(-1);

    _reposition();
  }

  function _go(delta) {
    const n = _i + delta;
    if (n < 0 || n >= STEPS.length) return;
    _i = n;
    _render();
  }

  function _reposition() {
    if (!_els) return;
    const step = STEPS[_i];
    const target = step.sel ? document.querySelector(step.sel) : null;
    const visible = target && target.offsetParent !== null && target.getBoundingClientRect().width > 0;
    const card = _els.card, ring = _els.ring;

    if (!visible) {
      ring.style.display = 'none';
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%,-50%)';
      return;
    }
    card.style.transform = 'none';
    const r = target.getBoundingClientRect();
    const pad = 6;
    ring.style.display = 'block';
    ring.style.left = (r.left - pad) + 'px';
    ring.style.top = (r.top - pad) + 'px';
    ring.style.width = (r.width + pad * 2) + 'px';
    ring.style.height = (r.height + pad * 2) + 'px';

    const cw = Math.min(330, window.innerWidth - 36);
    const ch = card.offsetHeight || 220;
    // Prefer right of the target (desktop sidebar); fall back to below, then above.
    let left, top;
    if (r.right + 16 + cw < window.innerWidth) {
      left = r.right + 16; top = Math.min(r.top, window.innerHeight - ch - 16);
    } else if (r.bottom + 16 + ch < window.innerHeight) {
      left = Math.min(r.left, window.innerWidth - cw - 16); top = r.bottom + 16;
    } else {
      left = Math.min(r.left, window.innerWidth - cw - 16); top = Math.max(16, r.top - ch - 16);
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
    // Persist completion so the tour never repeats (server-side, not local).
    try {
      if (typeof sb !== 'undefined') await sb.rpc('complete_onboarding');
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
  }

  window.Tour = { start };
})();
