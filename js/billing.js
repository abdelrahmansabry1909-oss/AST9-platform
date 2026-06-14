// ═══════════════════════════════════════════════════════════════
//  js/billing.js
//  Coach/Admin Billing tab — current package, client-slot usage, the
//  upgrade catalog, and the custom-tier calculator.
//
//  Reads the server's single source of truth via the coach_slot_status
//  RPC (so what the UI shows can never drift from what enforcement will
//  allow in Phase 3). NO payment is collected or implied here — package
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

  // ── Upgrade catalog grid ───────────────────────────────────────
  function _upgradeGrid(s) {
    if (typeof Packages === 'undefined') return '';
    const current = s.package_key;
    const cards = Packages.CATALOG.map((p) => {
      const isCurrent = p.key === current;
      const priceBlock = p.key === 'custom'
        ? `<div style="font-size:20px;font-weight:800;color:var(--text-primary)">${_money(Packages.CUSTOM_UNIT)}<span style="font-size:12px;font-weight:600;color:var(--text-tertiary)">/client</span></div>`
        : `<div style="font-size:24px;font-weight:800;color:var(--text-primary)">${_money(p.price)}${p.oldPrice != null ? `<span style="font-size:13px;font-weight:600;color:var(--text-tertiary);text-decoration:line-through;margin-left:8px">${_money(p.oldPrice)}</span>` : ''}</div>`;
      return `
        <div class="card" style="border:1px solid ${isCurrent ? 'rgba(20,184,166,.5)' : 'var(--nc-border,rgba(13,24,40,.1))'};${isCurrent ? 'box-shadow:0 0 0 1px rgba(20,184,166,.35)' : ''};padding:18px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:15px;font-weight:700;color:var(--text-primary)">${esc(p.label)}</div>
            ${isCurrent ? `<span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:999px;background:rgba(20,184,166,.14);color:${TEAL};border:1px solid rgba(20,184,166,.35)">Current</span>` : ''}
          </div>
          <div style="margin-top:10px">${priceBlock}</div>
          <div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">${esc(p.blurb)}</div>
        </div>`;
    }).join('');
    return `
      <div style="font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-tertiary);margin:0 0 12px">Plans</div>
      <div class="grid-3 stagger" style="margin-bottom:var(--sp-5)">${cards}</div>`;
  }

  // ── Custom-tier calculator ─────────────────────────────────────
  function _customCalc() {
    if (typeof Packages === 'undefined') return '';
    const min = Packages.CUSTOM_MIN;
    return `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div style="font-size:15px;font-weight:700;color:var(--text-primary)">Custom plan calculator</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">For ${min}+ clients, billed at ${_money(Packages.CUSTOM_UNIT)} per client.</div>
        <div style="display:flex;align-items:flex-end;gap:16px;margin-top:14px;flex-wrap:wrap">
          <div>
            <label for="billing-custom-qty" style="display:block;font-size:11px;color:var(--text-tertiary);margin-bottom:4px">Number of clients</label>
            <input id="billing-custom-qty" class="form-input" type="number" min="${min}" step="1" value="${min}" style="max-width:160px">
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px">Estimated monthly price</div>
            <div id="billing-custom-total" style="font-size:24px;font-weight:800;color:${TEAL}">${_money(Packages.customPrice(min))}</div>
          </div>
        </div>
      </div>`;
  }

  function _footerNote(isAdmin) {
    const msg = isAdmin
      ? 'As admin you have unlimited access. Coach packages are assigned by admin; online billing arrives in a future update.'
      : 'To change your plan, contact your admin. Online self-serve billing is coming in a future update — no payment is collected here.';
    return `<div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">${esc(msg)}</div>`;
  }

  function _wireCalc(host) {
    const qty   = host.querySelector('#billing-custom-qty');
    const total = host.querySelector('#billing-custom-total');
    if (!qty || !total || typeof Packages === 'undefined') return;
    const update = () => { total.textContent = _money(Packages.customPrice(qty.value)); };
    qty.addEventListener('input', update);
  }

  async function render() {
    const host = document.getElementById('billing-root');
    if (!host) return;
    host.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--text-tertiary)"><span class="spinner"></span></div>`;

    const status = await _fetchStatus();
    if (!status) {
      host.innerHTML = `<div class="card" style="padding:24px;color:var(--text-secondary)">Could not load your billing status. Please refresh.</div>`;
      return;
    }
    const isAdmin = (typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin());
    host.innerHTML =
      _currentPlanCard(status) +
      _upgradeGrid(status) +
      _customCalc() +
      _footerNote(isAdmin);
    _wireCalc(host);
  }

  window.Billing = { render };
})();
