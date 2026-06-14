// ═══════════════════════════════════════════════════════════════
//  js/billing.js
//  Coach/Admin Billing tab — current package, client-slot usage, the
//  upgrade catalog (Monthly / Annual), and the custom-tier calculator.
//
//  Reads the server's single source of truth via the coach_slot_status
//  RPC (so what the UI shows can never drift from what the create-user
//  slot gate enforces). NO payment is collected or implied here — package
//  changes are an admin action until a payment provider is wired in a
//  later, separately-approved phase.
//
//  Mounted by Dashboard.showSection('billing'); the route is gated to
//  coach/admin by the Phase-1 role guard, so clients never reach it.
// ═══════════════════════════════════════════════════════════════
(() => {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TEAL = '#14b8a6';

  // View state (interval is a presentation toggle — not stored server-side
  // yet; it will be persisted when a payment provider lands).
  let _interval = 'monthly';   // 'monthly' | 'annual'
  let _status   = null;        // cached coach_slot_status result

  async function _fetchStatus() {
    if (typeof sb === 'undefined') return null;
    const { data, error } = await sb.rpc('coach_slot_status');   // self
    if (error) { console.warn('[billing] coach_slot_status failed:', error.message); return null; }
    return data || null;
  }

  function _money(n) {
    if (n == null) return '';
    return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
  }

  const _suffix = () => (_interval === 'annual' ? '/yr' : '/mo');

  // ── Current-plan card ──────────────────────────────────────────
  function _currentPlanCard(s) {
    const unlimited = !!s.unlimited;
    const used      = s.used ?? 0;
    const limit     = s.client_limit;
    const remaining = s.remaining;
    const pkgLabel  = (typeof Packages !== 'undefined') ? Packages.label(s.package_key) : s.package_key;
    const pct       = unlimited || !limit ? 100 : Math.min(100, Math.round((used / limit) * 100));
    const slotsLine = unlimited
      ? `${used} active · <span style="color:${TEAL}">unlimited</span>`
      : `${used} of ${limit} client slots used · <b style="color:${TEAL}">${remaining}</b> remaining`;
    const atLimit   = !unlimited && remaining === 0;

    return `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--text-tertiary)">Current plan</div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
              <span style="font-size:26px;font-weight:800;letter-spacing:-.5px;color:var(--text-primary)">${esc(pkgLabel)}</span>
              <span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;background:rgba(20,184,166,.14);color:${TEAL};border:1px solid rgba(20,184,166,.35)">${esc(s.status || 'active')}</span>
            </div>
          </div>
        </div>
        <div style="margin-top:18px;font-size:13px;color:var(--text-secondary)">${slotsLine}</div>
        <div style="height:8px;border-radius:99px;background:var(--nc-track,rgba(13,24,40,.1));overflow:hidden;margin-top:10px">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#14b8a6,#2dd4bf);transition:width .4s ease"></div>
        </div>
        ${atLimit ? `<div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.35);font-size:12px;color:#b9770b;line-height:1.5">
          <b>You have used ${used} of ${limit} client slots.</b> Upgrade your plan to add more clients.</div>` : ''}
      </div>`;
  }

  // ── Monthly / Annual toggle ────────────────────────────────────
  function _intervalToggle() {
    const btn = (key, main, sub) => `
      <button type="button" data-interval="${key}"
        style="flex:1;padding:9px 12px;border-radius:9px;border:1px solid ${_interval===key?'rgba(20,184,166,.5)':'var(--nc-border,rgba(13,24,40,.1))'};
               background:${_interval===key?'rgba(20,184,166,.12)':'transparent'};cursor:pointer;font:inherit;
               color:${_interval===key?TEAL:'var(--text-secondary)'};font-weight:700;font-size:13px">
        ${main}${sub?`<span style="font-weight:600;font-size:11px;opacity:.85"> · ${sub}</span>`:''}
      </button>`;
    return `
      <div style="display:flex;gap:8px;max-width:420px;margin:0 0 16px">
        ${btn('monthly','Monthly','')}
        ${btn('annual','Annual','2 months free')}
      </div>`;
  }

  // ── Upgrade catalog grid (interval-aware) ──────────────────────
  function _upgradeGrid(s) {
    if (typeof Packages === 'undefined') return '';
    const current = s.package_key;
    const annual  = _interval === 'annual';
    const cards = Packages.CATALOG.map((p) => {
      const isCurrent = p.key === current;
      let priceBlock;
      if (p.key === 'custom') {
        const unit = Packages.customUnit(_interval);
        priceBlock = `<div style="font-size:20px;font-weight:800;color:var(--text-primary)">${_money(unit)}<span style="font-size:12px;font-weight:600;color:var(--text-tertiary)">/client${_suffix()}</span></div>`;
      } else {
        const pr = annual ? p.annual : p.monthly;
        priceBlock = `<div style="font-size:24px;font-weight:800;color:var(--text-primary)">${_money(pr.price)}<span style="font-size:12px;font-weight:600;color:var(--text-tertiary)">${_suffix()}</span>${pr.old != null ? `<span style="font-size:13px;font-weight:600;color:var(--text-tertiary);text-decoration:line-through;margin-left:8px">${_money(pr.old)}</span>` : ''}</div>`;
      }
      const saveNote = annual && p.key !== 'free'
        ? `<div style="margin-top:6px;font-size:11px;font-weight:600;color:${TEAL}">2 months free</div>` : '';
      return `
        <div class="card" style="border:1px solid ${isCurrent ? 'rgba(20,184,166,.5)' : 'var(--nc-border,rgba(13,24,40,.1))'};${isCurrent ? 'box-shadow:0 0 0 1px rgba(20,184,166,.35)' : ''};padding:18px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:15px;font-weight:700;color:var(--text-primary)">${esc(p.label)}</div>
            ${isCurrent ? `<span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:999px;background:rgba(20,184,166,.14);color:${TEAL};border:1px solid rgba(20,184,166,.35)">Current</span>` : ''}
          </div>
          <div style="margin-top:10px">${priceBlock}</div>
          ${saveNote}
          <div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">${esc(p.blurb)}</div>
        </div>`;
    }).join('');
    return `
      <div style="font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-tertiary);margin:0 0 12px">Plans</div>
      ${_intervalToggle()}
      <div class="grid-3 stagger" style="margin-bottom:var(--sp-5)">${cards}</div>`;
  }

  // ── Custom-tier calculator (interval-aware) ────────────────────
  function _customCalc() {
    if (typeof Packages === 'undefined') return '';
    const min  = Packages.CUSTOM_MIN;
    const unit = Packages.customUnit(_interval);
    const total = Packages.customPrice(min, _interval);
    return `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div style="font-size:15px;font-weight:700;color:var(--text-primary)">Custom plan calculator</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">For ${min}+ clients, billed at ${_money(unit)} per client${_suffix()}${_interval==='annual'?' (2 months free)':''}.</div>
        <div style="display:flex;align-items:flex-end;gap:16px;margin-top:14px;flex-wrap:wrap">
          <div>
            <label for="billing-custom-qty" style="display:block;font-size:11px;color:var(--text-tertiary);margin-bottom:4px">Number of clients</label>
            <input id="billing-custom-qty" class="form-input" type="number" min="${min}" step="1" value="${min}" style="max-width:160px">
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px">Estimated price</div>
            <div id="billing-custom-total" style="font-size:24px;font-weight:800;color:${TEAL}">${_money(total)}<span style="font-size:12px;font-weight:600;color:var(--text-tertiary)">${_suffix()}</span></div>
          </div>
        </div>
      </div>`;
  }

  function _footerNote(isAdmin) {
    const msg = isAdmin
      ? 'As admin you have unlimited access. Coach packages are assigned by admin; online billing arrives in a future update.'
      : 'Billing interval is for preview only and is not stored yet. To change your plan, contact your admin — online self-serve billing is coming in a future update. No payment is collected here.';
    return `<div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">${esc(msg)}</div>`;
  }

  function _wireCalc(host) {
    const qty   = host.querySelector('#billing-custom-qty');
    const total = host.querySelector('#billing-custom-total');
    if (!qty || !total || typeof Packages === 'undefined') return;
    const update = () => {
      total.innerHTML = `${_money(Packages.customPrice(qty.value, _interval))}<span style="font-size:12px;font-weight:600;color:var(--text-tertiary)">${_suffix()}</span>`;
    };
    qty.addEventListener('input', update);
  }

  // Re-paint from cached status (no refetch) — used by the interval toggle.
  function _paint(host) {
    const isAdmin = (typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin());
    host.innerHTML =
      _currentPlanCard(_status) +
      _upgradeGrid(_status) +
      _customCalc() +
      _footerNote(isAdmin);
    host.querySelectorAll('[data-interval]').forEach((b) =>
      b.addEventListener('click', () => { _interval = b.dataset.interval; _paint(host); }));
    _wireCalc(host);
  }

  async function render() {
    const host = document.getElementById('billing-root');
    if (!host) return;
    host.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--text-tertiary)"><span class="spinner"></span></div>`;

    _status = await _fetchStatus();
    if (!_status) {
      host.innerHTML = `<div class="card" style="padding:24px;color:var(--text-secondary)">Could not load your billing status. Please refresh.</div>`;
      return;
    }
    _paint(host);
  }

  window.Billing = { render };
})();
