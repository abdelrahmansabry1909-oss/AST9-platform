/* ═══════════════════════════════════════════════════════════════
   CLIENT DASHBOARD — "Today" (Recovery Journey redesign · S1)

   The status-first mobile home for clients. It answers three questions
   and nothing else:

     1. How am I doing?      → the Recovery Dial (hero)
     2. What should I do now? → one dominant CTA
     3. What needs attention? → one optional attention card

   Deliberately absent from Today (moved to the Progress tab in S3):
   the 3D hologram, the four progression gauges, the force/CoG/risk
   charts, the assessment report, ROM tables, and all clinical wording.
   The earlier analytics implementation lives in git history and is
   rebuilt into Progress (S3) from the intact AssessmentSnapshot,
   Progression, and ClientCharts modules.

   Presentation-layer only. Reuses Progression.getScores()
   (v_client_progression), SubscriptionService, Notifications data, and
   the existing --nc-* design tokens. No backend changes.

   PRESERVE FIRST: nothing here touches coach/admin flows. render() is
   only invoked for role=client via Dashboard.showSection('dashboard').
   ═══════════════════════════════════════════════════════════════ */

const ClientDashboard = (() => {
  'use strict';

  // Shared helpers live in ClientUtil (S5); these delegate so call sites
  // are unchanged and the logic stops drifting across the client screens.
  const _esc          = (s) => ClientUtil.esc(s);
  const _greeting     = () => ClientUtil.greeting();
  const _journeyStage = (phase) => ClientUtil.stageName(phase);
  const _recoveryBand = (s) => ClientUtil.band(s);

  // ── Navigation: prefer the mobile shell router, fall back to sections ──
  const _SECTION_FOR = { train: 'client-train', progress: 'client-progress', coach: 'client-coach' };
  function _go(tab) {
    if (window.ClientShell && ClientShell.go) { ClientShell.go(tab); return; }
    const id = _SECTION_FOR[tab];
    if (id && typeof Dashboard !== 'undefined') Dashboard.showSection(id);
  }

  // ── Subscription pill (header, compact) ──
  const PILL_TONE = {
    teal:  'background:rgba(20,184,166,.14);color:#14B8A6;border:1px solid rgba(20,184,166,.35)',
    amber: 'background:rgba(245,158,11,.14);color:#F59E0B;border:1px solid rgba(245,158,11,.35)',
    rose:  'background:rgba(244,63,94,.14);color:#F5426C;border:1px solid rgba(244,63,94,.35)',
    gray:  'background:rgba(148,163,184,.10);color:#94A3B8;border:1px solid rgba(148,163,184,.25)',
  };
  function _getState() {
    if (typeof Auth === 'undefined' || !Auth.getSubscriptionState) return null;
    return Auth.getSubscriptionState();
  }
  function _renderPill() {
    const state = _getState();
    if (!state) return '';
    const pill = (typeof SubscriptionService !== 'undefined')
      ? SubscriptionService.formatPill(state) : { label: 'Subscription', tone: 'gray' };
    const style = PILL_TONE[pill.tone] || PILL_TONE.gray;
    return `<div title="Subscription status"
      style="display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;
             font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;${style}">
      <span style="width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.7"></span>${_esc(pill.label)}</div>`;
  }

  // ── Recovery dial (dependency-free SVG ring) ──
  function _dialSVG(score, color) {
    const r = 86, c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, Number(score) || 0));
    const off = c * (1 - pct / 100);
    return `
      <svg viewBox="0 0 200 200" width="100%" height="100%" style="display:block;transform:rotate(-90deg)">
        <circle cx="100" cy="100" r="${r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="14"/>
        <circle id="cd-dial-arc" cx="100" cy="100" r="${r}" fill="none" stroke="${color}" stroke-width="14"
                stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}"
                data-target="${off.toFixed(2)}"
                style="transition:stroke-dashoffset 900ms cubic-bezier(0.16,1,0.3,1);filter:drop-shadow(0 0 10px ${color}66)"/>
      </svg>`;
  }

  // ── Public entry point — Dashboard.showSection('dashboard') for clients ──
  function render() {
    const root = document.getElementById('client-dashboard-root');
    if (!root) return;

    const profile   = (typeof Auth !== 'undefined' && Auth.getProfile) ? Auth.getProfile() : null;
    const firstName = ClientUtil.firstName(profile);
    const clientId  = profile?.id || null;

    root.innerHTML = `
      <div class="cd-today" style="max-width:520px;margin:0 auto;padding:6px 2px 8px">

        ${ClientUtil.isOffline() ? ClientUtil.offlineNote() : ''}

        <!-- header -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:4px 4px 16px">
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Recovery Journey</div>
            <div style="font-size:20px;font-weight:700;letter-spacing:-.01em;color:var(--nc-text-primary,#F8FAFC)">${_greeting()}, ${_esc(firstName)}</div>
          </div>
          ${_renderPill()}
        </div>

        <!-- HOW AM I DOING? — recovery dial hero -->
        <div id="cd-dial" role="button" tabindex="0" aria-label="View your progress"
             style="cursor:pointer;border-radius:var(--nc-r-2xl,28px);background:var(--nc-bg-card,rgba(15,23,42,.7));
                    border:1px solid var(--nc-border,rgba(255,255,255,.08));box-shadow:var(--nc-shadow-card,0 8px 32px rgba(0,0,0,.4));
                    padding:26px 20px 22px;text-align:center">
          <div style="display:flex;justify-content:center;padding:20px 0"><span class="spinner"></span></div>
        </div>

        <!-- WHAT SHOULD I DO NOW? — one dominant CTA -->
        <div id="cd-cta" style="margin-top:16px"></div>

        <!-- RECOVERY PULSE (F8 · S2) — calm trajectory summary -->
        <div id="cd-pulse" style="margin-top:12px"></div>

        <!-- WHAT NEEDS ATTENTION? — one optional card -->
        <div id="cd-attention" style="margin-top:12px"></div>

      </div>`;

    _loadToday(clientId, profile);
  }

  async function _loadToday(clientId, profile) {
    let row = null;
    try {
      if (window.Progression && Progression.getScores && clientId) row = await Progression.getScores(clientId);
    } catch (e) { console.warn('[today] recovery read:', e?.message); }

    _renderDial(row, profile);
    await _renderCTA(clientId);
    await _renderPulse(clientId);
    await _renderAttention(clientId);
  }

  function _renderDial(row, profile) {
    const el = document.getElementById('cd-dial');
    if (!el) return;
    const hasScore = row && row.recovery != null;
    const score = hasScore ? Math.round(Number(row.recovery)) : null;
    const band  = hasScore ? _recoveryBand(score) : { color: '#67E8F9', word: 'Not yet', message: 'Complete your first assessment with your coach to unlock your recovery score.' };
    const stage = _journeyStage(profile?.current_phase);

    el.innerHTML = `
      <div style="position:relative;width:200px;height:200px;margin:0 auto">
        ${_dialSVG(hasScore ? score : 0, band.color)}
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="font-size:54px;font-weight:800;line-height:1;color:var(--nc-text-primary,#F8FAFC)">${hasScore ? score : '–'}</div>
          <div style="font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--nc-text-muted,#64748B);margin-top:6px">Recovery</div>
        </div>
      </div>
      <div style="margin-top:14px;font-size:13px;font-weight:700;letter-spacing:.04em;color:${band.color}">${_esc(band.word)}</div>
      <div style="margin-top:6px;font-size:14.5px;line-height:1.5;color:var(--nc-text-primary,#F8FAFC)">${_esc(band.message)}</div>
      <div style="margin-top:10px;font-size:12px;color:var(--nc-text-secondary,#94A3B8)">${_esc(stage)} <span style="opacity:.5">·</span> tap for details</div>`;

    // Announce the loaded score to assistive tech via a meaningful label.
    el.setAttribute('aria-label', hasScore
      ? `Recovery ${score}, ${band.word}. Tap to view your progress.`
      : 'Recovery score not available yet. Tap to view your progress.');

    // Animate the arc fill after paint.
    const arc = el.querySelector('#cd-dial-arc');
    if (arc && hasScore) requestAnimationFrame(() => requestAnimationFrame(() => { arc.style.strokeDashoffset = arc.dataset.target; }));

    el.onclick = () => _go('progress');
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _go('progress'); } };
  }

  async function _renderCTA(clientId) {
    const el = document.getElementById('cd-cta');
    if (!el) return;

    const state    = _getState();
    const canWrite = (typeof SubscriptionService !== 'undefined' && SubscriptionService.canWrite)
      ? SubscriptionService.canWrite(state) : true;

    // Read-only (lapsed) clients: the single CTA becomes "renew", calm.
    if (!canWrite) {
      el.innerHTML = _ctaButton({
        label: 'Renew to continue', sub: 'Your plan has ended. Reach out to your coach.',
        tone: 'muted', tab: 'coach',
      });
      _wireCTA(el);
      return;
    }

    // Done today? (light read; never blocks the CTA)
    let done = false;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await sb.from('daily_routine_logs')
        .select('id').eq('client_id', clientId).eq('log_date', today).eq('completed', true).limit(1);
      done = !!(data && data.length);
    } catch (_) { /* non-blocking */ }

    el.innerHTML = done
      ? _ctaButton({ label: 'Done for today', sub: 'Nice work. Review or train again.', tone: 'done', tab: 'train', openProgram: true })
      : _ctaButton({ label: 'Start today’s session', sub: 'Continue your recovery journey', tone: 'primary', tab: 'train', openProgram: true });
    _wireCTA(el);
  }

  function _ctaButton({ label, sub, tone, tab, openProgram }) {
    const bg = tone === 'primary' ? 'var(--nc-teal,#14B8A6)'
             : tone === 'done'    ? 'rgba(20,184,166,.12)'
             : 'rgba(148,163,184,.10)';
    const fg = tone === 'primary' ? '#052e2b' : 'var(--nc-text-primary,#F8FAFC)';
    const border = tone === 'primary' ? 'none' : '1px solid var(--nc-border,rgba(255,255,255,.08))';
    const subColor = tone === 'primary' ? 'rgba(5,46,43,.75)' : 'var(--nc-text-secondary,#94A3B8)';
    const icon = tone === 'done' ? '✓' : '→';
    return `
      <button type="button" data-tab="${_esc(tab)}"${openProgram ? ' data-open-program="1"' : ''}
        style="width:100%;min-height:64px;border:${border};border-radius:var(--nc-r-lg,16px);background:${bg};color:${fg};
               display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;cursor:pointer;
               box-shadow:${tone === 'primary' ? 'var(--nc-shadow-teal,0 0 40px rgba(20,184,166,.18))' : 'none'};
               -webkit-tap-highlight-color:transparent;transition:transform 180ms cubic-bezier(0.16,1,0.3,1)">
        <span style="text-align:left">
          <span style="display:block;font-size:16px;font-weight:700;letter-spacing:-.01em">${_esc(label)}</span>
          <span style="display:block;font-size:12px;font-weight:500;margin-top:2px;color:${subColor}">${_esc(sub)}</span>
        </span>
        <span style="font-size:20px;font-weight:700;flex-shrink:0">${icon}</span>
      </button>`;
  }
  function _wireCTA(el) {
    const btn = el.querySelector('button[data-tab]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // CX1 express path: open the Train tab straight to today's day.
      if (btn.dataset.openProgram) window._ncOpenProgram = true;
      _go(btn.dataset.tab);
    });
    btn.addEventListener('pointerdown', () => { btn.style.transform = 'scale(.985)'; });
    const reset = () => { btn.style.transform = ''; };
    btn.addEventListener('pointerup', reset);
    btn.addEventListener('pointerleave', reset);
  }

  // ── Recovery Pulse (F8 · S2) — one calm, client-friendly summary ──
  // Reads v_client_pulse (RLS → self only). Raw status words are never
  // shown; each maps to encouraging, non-clinical language. New clients
  // get onboarding warmth, never a warning. Fails calmly (renders
  // nothing) on error / no row so Today never breaks.
  const PULSE = {
    new:        { word: 'Getting started', color: 'var(--nc-cyan,#67E8F9)', action: { label: 'Begin your session',  tab: 'train', openProgram: true } },
    on_track:   { word: 'On track',        color: 'var(--nc-teal,#14B8A6)', action: { label: 'Continue today',     tab: 'train', openProgram: true } },
    slipping:   { word: 'Keep momentum',   color: 'var(--nc-gold,#D4AF37)', action: { label: 'Ease back in',       tab: 'train', openProgram: true } },
    at_risk:    { word: 'Let’s reconnect', color: '#F59E0B',                action: { label: 'Start gently',       tab: 'train', openProgram: true } },
    regressing: { word: 'Let’s check in',  color: '#5A9BD4',                action: { label: 'Message your coach', tab: 'coach' } },
  };

  function _momentumChip(m) {
    const map = {
      up:   { t: '↑ trending up', c: '#14B8A6', bg: 'rgba(20,184,166,.14)', bd: 'rgba(20,184,166,.30)' },
      down: { t: '↓ easing',      c: '#F59E0B', bg: 'rgba(245,158,11,.14)', bd: 'rgba(245,158,11,.30)' },
      flat: { t: 'steady',        c: '#94A3B8', bg: 'rgba(148,163,184,.10)', bd: 'rgba(148,163,184,.22)' },
    };
    const x = map[m] || map.flat;
    return `<span style="display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;
            font-size:10.5px;font-weight:700;background:${x.bg};color:${x.c};border:1px solid ${x.bd}">${x.t}</span>`;
  }

  // One plain-language reason — data-aware where it helps, never clinical.
  function _pulseReason(status, pulse, canWrite) {
    if (!canWrite)            return 'Your plan has paused — your coach can help you pick back up.';
    if (status === 'new')     return 'Welcome — let’s build your first week. Small, steady steps add up.';
    const dsa = pulse.days_since_activity;
    if (dsa != null && dsa >= 7) return `It’s been ${dsa} days since your last session — an easy one today helps.`;
    if (status === 'on_track')   return 'You’re moving steadily this week. Keep the rhythm going.';
    if (status === 'slipping')   return 'A lighter week — a short session is a great way to ease back in.';
    if (status === 'at_risk')    return 'A gentle session today helps you build momentum again.';
    if (status === 'regressing') return 'Recovery ebbs and flows — your coach can help you adjust.';
    return 'Keep going at your own pace.';
  }

  function _pulseCard(pulse, canWrite) {
    const status = pulse.pulse_status || 'new';
    const meta   = PULSE[status] || PULSE.new;
    const isNew  = status === 'new';
    const action = canWrite ? meta.action : { label: 'Reach out to your coach', tab: 'coach' };
    const chip   = (!isNew && canWrite) ? _momentumChip(pulse.momentum) : '';
    return `
      <div style="border-radius:var(--nc-r-xl,20px);background:var(--nc-bg-card,rgba(15,23,42,.7));
           border:1px solid var(--nc-border,rgba(255,255,255,.08));box-shadow:var(--nc-shadow-card,0 8px 32px rgba(0,0,0,.4));padding:18px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Recovery Pulse</div>
          ${chip}
        </div>
        <div style="font-size:18px;font-weight:800;letter-spacing:-.01em;color:${meta.color};margin-top:6px">${_esc(meta.word)}</div>
        <div style="font-size:13.5px;line-height:1.5;color:var(--nc-text-secondary,#94A3B8);margin-top:4px">${_esc(_pulseReason(status, pulse, canWrite))}</div>
        <button type="button" data-tab="${_esc(action.tab)}"${action.openProgram ? ' data-open-program="1"' : ''}
          style="margin-top:12px;display:inline-flex;align-items:center;gap:7px;background:transparent;border:0;cursor:pointer;
                 color:var(--nc-teal,#14B8A6);font-size:13.5px;font-weight:700;padding:6px 2px;min-height:40px;-webkit-tap-highlight-color:transparent">
          ${_esc(action.label)} <span aria-hidden="true">→</span></button>
      </div>`;
  }

  async function _renderPulse(clientId) {
    const el = document.getElementById('cd-pulse');
    if (!el) return;
    if (!clientId) { el.innerHTML = ''; return; }

    let pulse = null;
    try {
      const { data, error } = await sb.from('v_client_pulse')
        .select('pulse_status, momentum, days_since_activity')
        .eq('client_id', clientId).maybeSingle();
      if (error) throw error;
      pulse = data;
    } catch (e) {
      console.warn('[today] pulse read:', e?.message);
      el.innerHTML = '';   // calm: Today still works without the card
      return;
    }
    if (!pulse) { el.innerHTML = ''; return; }   // no row → no card, no error

    const canWrite = (typeof SubscriptionService !== 'undefined' && SubscriptionService.canWrite)
      ? SubscriptionService.canWrite(_getState()) : true;
    el.innerHTML = _pulseCard(pulse, canWrite);
    _wireCTA(el);   // reuse: data-tab + data-open-program (express path) + _go
  }

  async function _renderAttention(clientId) {
    const el = document.getElementById('cd-attention');
    if (!el) return;

    const state = _getState();
    const eff   = state?.effective_status;

    // Priority 1: a blocking / expiring subscription.
    if (eff === 'expired') return _attentionCard(el, '⏸', 'Your plan has ended', 'Reach out to your coach to continue your journey.', 'coach');
    if (eff === 'grace') {
      const d = state?.grace_days_left ?? 0;
      return _attentionCard(el, '⚠', `Plan ends in ${d} day${d === 1 ? '' : 's'}`, 'Reach out to your coach to renew before access pauses.', 'coach');
    }

    // Priority 2: the latest unread guidance from the coach side. Subscription
    // alerts are excluded here (handled above and via the header pill) so this
    // stays consistent with the Coach screen, which also filters them out.
    try {
      const uid = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser()?.id : clientId;
      if (uid) {
        const { data } = await sb.from('notifications')
          .select('title').eq('recipient_id', uid).is('read_at', null)
          .not('type', 'like', 'subscription%')
          .order('created_at', { ascending: false }).limit(1);
        if (data && data.length) {
          return _attentionCard(el, '✦', data[0].title || 'New update from your coach', 'Tap to see what your coach shared.', 'coach');
        }
      }
    } catch (_) { /* non-blocking */ }

    el.innerHTML = '';   // nothing needs attention
  }

  function _attentionCard(el, icon, title, sub, tab) {
    el.innerHTML = `
      <button type="button" data-tab="${_esc(tab)}"
        style="width:100%;display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;text-align:left;
               border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-lg,16px);
               background:rgba(255,255,255,.02);-webkit-tap-highlight-color:transparent">
        <span style="font-size:18px;flex-shrink:0">${icon}</span>
        <span style="flex:1;min-width:0">
          <span style="display:block;font-size:14px;font-weight:600;color:var(--nc-text-primary,#F8FAFC)">${_esc(title)}</span>
          <span style="display:block;font-size:12px;margin-top:1px;color:var(--nc-text-secondary,#94A3B8)">${_esc(sub)}</span>
        </span>
        <span style="font-size:16px;color:var(--nc-text-muted,#64748B);flex-shrink:0">›</span>
      </button>`;
    el.querySelector('button[data-tab]')?.addEventListener('click', () => _go(tab));
  }

  return { render };
})();

window.ClientDashboard = ClientDashboard;
