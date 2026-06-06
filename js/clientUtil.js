/* ═══════════════════════════════════════════════════════════════
   CLIENT UTIL — shared helpers for the Recovery Journey client app (S5)

   One home for the small helpers that Today, Train, Progress, and Coach
   all need, so they stop drifting apart: HTML escaping, the recovery
   band scale, the Recovery Journey stage map, streak/consistency, and a
   few calm state-helpers (loading skeleton, offline note, error).

   Presentation-layer only. Loaded before the client screens. No backend
   changes; the only data read here is DailyRoutine.historyFor (already
   client-readable). Coach/admin code never references this module.
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function firstName(profile) {
    return (profile?.full_name || '').trim().split(/\s+/)[0] || 'there';
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  // ── Recovery Journey stage map (no clinical phase numbers on screen) ──
  const STAGES = ['Mobility Restoration', 'Strength Rebuilding', 'Return to Performance', 'Peak Performance'];
  function stageIndex(phase) {
    const n = parseInt(String(phase || '').replace(/\D/g, ''), 10) || 1;
    return Math.max(0, Math.min(STAGES.length - 1, n - 1));
  }
  function stageName(phase) { return STAGES[stageIndex(phase)]; }

  // ── Recovery band: committed hue + calm, encouraging wording ──
  function band(score) {
    const s = Number(score) || 0;
    if (s >= 80) return { color: '#14B8A6', word: 'Strong',          message: 'You are recovering well. Keep your rhythm steady.' };
    if (s >= 60) return { color: '#84CC16', word: 'Steady',          message: 'Solid progress. Stay consistent this week.' };
    if (s >= 40) return { color: '#F59E0B', word: 'Building',        message: 'You are building momentum, one session at a time.' };
    if (s >= 20) return { color: '#F97316', word: 'Early days',      message: 'Early in the journey. Small steps add up.' };
    return            { color: '#67E8F9', word: 'Getting started',   message: 'Let us get your first sessions in.' };
  }

  // ── Soft relative time ("2 days ago") ──
  function ago(iso) {
    if (!iso) return '';
    const sec = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (sec < 90)  return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60)  return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24)   return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const d = Math.round(hr / 24);
    if (d < 30)    return `${d} day${d === 1 ? '' : 's'} ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  }

  // ── Accountability from one DailyRoutine.historyFor read ──
  // streak: consecutive most-recent days at >=60% (today not yet logged is
  // forgiven, never breaks it). consistency: days >=60% across the last 7.
  async function accountability(clientId) {
    const out = { streak: 0, consistency: 0 };
    try {
      if (!clientId || !(window.DailyRoutine && DailyRoutine.historyFor)) return out;
      const hist = await DailyRoutine.historyFor(clientId, 30);   // ascending
      const byDate = {};
      (hist || []).forEach((h) => { byDate[h.log_date] = h.percent ?? 0; });
      for (let i = 0; i < 30; i++) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        const p = byDate[d];
        if (i < 7 && p != null && p >= 60) out.consistency++;
        if (p != null && p >= 60) out.streak++;
        else if (i === 0) continue;          // today not logged yet — keep the streak
        else break;
      }
    } catch (_) { /* calm fallback to zeros */ }
    return out;
  }

  // ── Calm state helpers ─────────────────────────────────────────
  function isOffline() {
    return (typeof navigator !== 'undefined') && navigator.onLine === false;
  }

  // A shimmer placeholder block (loading state).
  function skeleton(height = 96, radius = 'var(--nc-r-lg,16px)') {
    const h = typeof height === 'number' ? `${height}px` : height;
    return `<div class="nc-skel" aria-hidden="true" style="height:${h};border-radius:${radius}"></div>`;
  }

  // A calm offline banner (string).
  function offlineNote() {
    return `<div role="status" style="display:flex;align-items:center;gap:8px;padding:10px 14px;margin-bottom:12px;
        border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-lg,16px);
        background:rgba(148,163,184,.08);font-size:12.5px;color:var(--nc-text-secondary,#94A3B8)">
        <span aria-hidden="true">○</span><span>You are offline. Showing what we last loaded.</span></div>`;
  }

  // Keep Tab focus inside an open dialog/sheet. Call from a keydown handler
  // after handling Escape; selector defaults to the usual focusables.
  function trapTab(e, container, selector) {
    if (!e || e.key !== 'Tab' || !container) return;
    const f = container.querySelectorAll(selector || 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // Render a calm error with a Retry into host; retry() is called on tap.
  function errorState(host, message, retry) {
    if (!host) return;
    host.innerHTML = `
      <div role="alert" style="border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-lg,16px);
           background:rgba(255,255,255,.02);padding:18px;text-align:center">
        <div style="font-size:22px;line-height:1" aria-hidden="true">⚠</div>
        <div style="font-size:14px;font-weight:600;color:var(--nc-text-primary,#F8FAFC);margin-top:8px">${esc(message || 'Something went wrong')}</div>
        <button type="button" data-nc-retry style="margin-top:12px;min-height:44px;padding:10px 20px;border:1px solid var(--nc-border,rgba(255,255,255,.12));
                border-radius:var(--nc-r-full,999px);background:transparent;color:var(--nc-text-primary,#F8FAFC);font-size:13px;font-weight:600;cursor:pointer">
          Try again
        </button>
      </div>`;
    host.querySelector('[data-nc-retry]')?.addEventListener('click', () => { try { retry && retry(); } catch (_) {} });
  }

  window.ClientUtil = {
    esc, firstName, greeting,
    STAGES, stageIndex, stageName,
    band, ago, accountability,
    isOffline, skeleton, offlineNote, errorState, trapTab,
  };
})();
