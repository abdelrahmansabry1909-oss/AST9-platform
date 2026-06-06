/* ═══════════════════════════════════════════════════════════════
   CLIENT COACH — recovery support screen (Recovery Journey · S4)

   NOT an inbox or a notification center. A calm screen that makes the
   client feel supported, guided, connected, and accountable. Order,
   top to bottom:

     1. Coach Presence    a real person is guiding recovery: name (or a
                          dignified generic), monogram, a warm intro.
     2. Latest Guidance   the most recent coach notes/recommendations,
                          reframed as guidance (no archive/unread chrome).
     3. Accountability    current streak + recovery consistency, with
                          gentle, never guilt-driven encouragement.
     4. Contact Coach     one simple CTA. Reuses the existing mailto
                          capability. No messaging infrastructure.

   RLS reality (no backend changes allowed): a client can read only their
   OWN profile row, so the coach's real name/avatar/email are not
   reachable. The only client-readable coach identity is their own
   profiles.coach_name; when absent we present "Your recovery coach"
   rather than a blank. The contact CTA reuses the brand support address
   already used elsewhere in the app.

   Presentation-layer only. Reuses Notifications + DailyRoutine + Auth +
   the --nc-* tokens. Mounted by clientShell on the Coach tab and by the
   Dashboard.showSection('client-coach') loader; render() is client-only.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // Shared helpers (S5): delegate to ClientUtil so escaping, the stage
  // map, the name helper, relative time, and the streak/consistency
  // calculation stay identical across all four client screens.
  const _esc            = (s) => ClientUtil.esc(s);
  const _stage          = (phase) => ClientUtil.stageName(phase);
  const _firstName      = (profile) => ClientUtil.firstName(profile);
  const _ago            = (iso) => ClientUtil.ago(iso);
  const _accountability = (clientId) => ClientUtil.accountability(clientId);

  function _initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  function _encouragement({ streak, consistency }) {
    // Always supportive, never guilt-driven.
    if (streak >= 3)      return 'You keep showing up for yourself. That steady consistency is exactly what heals.';
    if (streak >= 1)      return 'You have started building momentum. Keep it gentle and steady, one day at a time.';
    if (consistency >= 1) return 'You have moved this week, and that counts. Each session adds up.';
    return 'Recovery is not a straight line. Today is a good day to begin again, gently.';
  }

  // ── Section builders ────────────────────────────────────────────
  function _presence(profile) {
    const coachName = (profile?.coach_name || '').trim();
    const name = coachName || 'Your recovery coach';
    const monogram = _initials(coachName) || '♥';
    const stage = _stage(profile?.current_phase);
    const intro = coachName
      ? `I am guiding you through your ${_esc(stage)}, ${_esc(_firstName(profile))}. Small, steady steps, and we do this together.`
      : `Someone is in your corner through your ${_esc(stage)}, ${_esc(_firstName(profile))}. Small, steady steps, and we do this together.`;

    return `
      <div style="border-radius:var(--nc-r-2xl,28px);background:var(--nc-bg-card,rgba(15,23,42,.7));
           border:1px solid var(--nc-border,rgba(255,255,255,.08));box-shadow:var(--nc-shadow-card,0 8px 32px rgba(0,0,0,.4));padding:22px">
        <div style="display:flex;align-items:center;gap:16px">
          <div aria-hidden="true" style="flex:0 0 auto;width:60px;height:60px;border-radius:var(--nc-r-full,999px);
               display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#052e2b;
               background:linear-gradient(135deg,var(--nc-teal,#14B8A6),var(--nc-cyan,#67E8F9));
               box-shadow:var(--nc-shadow-teal,0 0 40px rgba(20,184,166,.18))">${_esc(monogram)}</div>
          <div style="min-width:0">
            <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Your coach</div>
            <div style="font-size:20px;font-weight:800;letter-spacing:-.01em;color:var(--nc-text-primary,#F8FAFC);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(name)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
              <span aria-hidden="true" style="width:7px;height:7px;border-radius:50%;background:var(--nc-teal,#14B8A6);box-shadow:0 0 8px rgba(20,184,166,.8)"></span>
              <span style="font-size:12px;color:var(--nc-text-secondary,#94A3B8)">Guiding your recovery</span>
            </div>
          </div>
        </div>
        <div style="margin-top:16px;font-size:14px;line-height:1.55;color:var(--nc-text-primary,#F8FAFC)">${intro}</div>
      </div>`;
  }

  function _guidanceCard(row) {
    const title = _esc(row.title || 'A note from your coach');
    const body  = row.body ? `<div style="font-size:13px;line-height:1.55;color:var(--nc-text-secondary,#94A3B8);margin-top:4px">${_esc(row.body)}</div>` : '';
    return `
      <div style="border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-lg,16px);
           background:rgba(255,255,255,.02);padding:16px;margin-top:10px">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <span aria-hidden="true" style="flex:0 0 auto;font-size:15px;color:var(--nc-teal,#14B8A6);line-height:1.4">“</span>
          <div style="min-width:0">
            <div style="font-size:14px;font-weight:700;color:var(--nc-text-primary,#F8FAFC)">${title}</div>
            ${body}
            <div style="font-size:11px;color:var(--nc-text-muted,#64748B);margin-top:6px">${_esc(_ago(row.created_at))}</div>
          </div>
        </div>
      </div>`;
  }

  function _guidanceEmpty() {
    return `
      <div style="border:1px dashed var(--nc-border,rgba(255,255,255,.10));border-radius:var(--nc-r-lg,16px);
           background:rgba(255,255,255,.015);padding:18px;margin-top:10px;text-align:center">
        <div style="font-size:22px;line-height:1" aria-hidden="true">🌿</div>
        <div style="font-size:14px;font-weight:600;color:var(--nc-text-primary,#F8FAFC);margin-top:8px">No new guidance right now</div>
        <div style="font-size:13px;line-height:1.5;color:var(--nc-text-secondary,#94A3B8);margin-top:4px">Keep following your plan. Your coach is watching your progress and will reach out when it matters.</div>
      </div>`;
  }

  function _accountabilityCard({ streak, consistency }) {
    const stat = (value, label) => `
      <div style="flex:1;text-align:center">
        <div style="font-size:26px;font-weight:800;line-height:1;color:var(--nc-text-primary,#F8FAFC)">${value}</div>
        <div style="font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--nc-text-muted,#64748B);margin-top:5px">${_esc(label)}</div>
      </div>`;
    return `
      <div style="border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-xl,20px);
           background:var(--nc-bg-card,rgba(15,23,42,.7));padding:20px">
        <div style="display:flex;align-items:center;gap:8px">
          ${stat(`🔥 ${streak}`, `day${streak === 1 ? '' : 's'} in a row`)}
          <div style="width:1px;align-self:stretch;background:var(--nc-border,rgba(255,255,255,.08))"></div>
          ${stat(`${consistency}/7`, 'days this week')}
        </div>
        <div style="margin-top:16px;font-size:13.5px;line-height:1.55;color:var(--nc-text-primary,#F8FAFC);text-align:center">${_esc(_encouragement({ streak, consistency }))}</div>
      </div>`;
  }

  function _contact(profile) {
    const subject = encodeURIComponent('Message for my recovery coach');
    const who = (profile?.full_name || '').trim();
    const body = encodeURIComponent(
      `Hi, this is ${who || 'a NeuCore client'}.\n\nI would like to reach my recovery coach about:\n\n`
    );
    const href = `mailto:hello@neucore.io?subject=${subject}&body=${body}`;
    return `
      <a href="${href}"
        style="margin-top:14px;display:flex;align-items:center;justify-content:center;gap:10px;text-decoration:none;
               width:100%;min-height:56px;border-radius:var(--nc-r-lg,16px);background:var(--nc-teal,#14B8A6);color:#052e2b;
               font-size:16px;font-weight:700;box-shadow:var(--nc-shadow-teal,0 0 40px rgba(20,184,166,.18));-webkit-tap-highlight-color:transparent">
        <span aria-hidden="true">✉</span><span>Contact your coach</span>
      </a>
      <div style="margin-top:8px;font-size:12px;line-height:1.5;color:var(--nc-text-muted,#64748B);text-align:center">Send a note and your coach will follow up with you.</div>`;
  }

  function _sectionLabel(text) {
    return `<div style="margin:22px 4px 2px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">${_esc(text)}</div>`;
  }

  // ── Render ──────────────────────────────────────────────────────
  async function render(container) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) return;

    const profile  = (typeof Auth !== 'undefined' && Auth.getProfile) ? Auth.getProfile() : null;
    const clientId = profile?.id || null;

    host.innerHTML = `
      <div style="max-width:520px;margin:0 auto;padding:6px 2px 8px">

        ${ClientUtil.isOffline() ? ClientUtil.offlineNote() : ''}

        <div style="margin:4px 4px 16px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Recovery Journey</div>
          <div style="font-size:20px;font-weight:800;letter-spacing:-.01em;color:var(--nc-text-primary,#F8FAFC)">Your Support</div>
        </div>

        ${_presence(profile)}

        ${_sectionLabel('Latest guidance')}
        <div id="cc-guidance">${ClientUtil.skeleton(76)}</div>

        ${_sectionLabel('Your consistency')}
        <div id="cc-accountability">${ClientUtil.skeleton(110, 'var(--nc-r-xl,20px)')}</div>

        ${_sectionLabel('Reach out')}
        ${_contact(profile)}

      </div>`;

    // Latest guidance (reuse Notifications data, reframed; no inbox chrome).
    (async () => {
      const el = host.querySelector('#cc-guidance');
      if (!el) return;
      let rows = [];
      try {
        if (window.Notifications && Notifications.list) rows = await Notifications.list({ limit: 12 });
      } catch (_) { /* calm fallback to empty state */ }
      // Guidance = coach communication, not billing/system alerts. Subscription
      // state already lives on Today (attention card + pill); excluding it here
      // keeps this section feeling like a note from a person, not an inbox.
      const top = (rows || [])
        .filter((r) => !String(r.type || '').startsWith('subscription'))
        .slice(0, 3);
      el.innerHTML = top.length ? top.map(_guidanceCard).join('') : _guidanceEmpty();
    })();

    // Accountability (reuse DailyRoutine history).
    _accountability(clientId).then((acc) => {
      const el = host.querySelector('#cc-accountability');
      if (el) el.innerHTML = _accountabilityCard(acc);
    });
  }

  window.ClientCoach = { render };
})();
