// ═══════════════════════════════════════════════════════════════
//  js/billing.js
//  Coach/Admin Billing tab — current package, client-slot usage, unified
//  tier catalog grid with InstaPay self-service requests, and the custom-tier calculator.
//
//  Reads server slot status via coach_slot_status RPC and InstaPay package
//  prices via package_prices table / request_coach_package_payment RPC.
//
//  Mounted by Dashboard.showSection('billing'); gated to coach/admin.
// ═══════════════════════════════════════════════════════════════
(() => {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TEAL = '#14b8a6';

  // View state
  let _interval    = 'monthly'; // 'monthly' | 'annual'
  let _status      = null;      // cached coach_slot_status result
  let _billingData = null;      // cached { prices, settings, requests } from PaymentUI

  async function _fetchStatus() {
    if (typeof sb === 'undefined') return null;
    const { data, error } = await sb.rpc('coach_slot_status');
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
    if (!s) return '';
    const unlimited = !!s.unlimited;
    const used      = s.used ?? 0;
    const limit     = s.client_limit;
    const remaining = s.remaining;
    const pkgLabel  = (typeof Packages !== 'undefined') ? Packages.label(s.package_key) : s.package_key;
    const isExpired = !!s.expired || s.status === 'expired';
    const endDate   = s.current_period_end ? new Date(s.current_period_end).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;

    const pct       = unlimited || !limit ? 100 : Math.min(100, Math.round((used / limit) * 100));

    let slotsLine;
    if (isExpired) {
      slotsLine = `<span style="color:#ef4444;font-weight:700">Package Expired</span> · ${used} assigned client${used === 1 ? '' : 's'} active · <b style="color:#ef4444">0 new slots</b>`;
    } else if (unlimited) {
      slotsLine = `${used} active · <span style="color:${TEAL}">unlimited</span>`;
    } else {
      slotsLine = `${used} of ${limit} client slots used · <b style="color:${TEAL}">${remaining}</b> remaining`;
    }

    const atLimit = !unlimited && remaining === 0 && !isExpired;

    const statusBadge = isExpired
      ? `<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;background:rgba(239,68,68,.14);color:#ef4444;border:1px solid rgba(239,68,68,.35)">EXPIRED</span>`
      : `<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;background:rgba(20,184,166,.14);color:${TEAL};border:1px solid rgba(20,184,166,.35)">${esc(s.status || 'active')}</span>`;

    const billingDesc = isExpired
      ? (endDate ? `Expired on ${esc(endDate)}` : `Package expired`)
      : `Billed ${s.billing_interval === 'annual' ? 'annually' : 'monthly'} · admin-assigned`;

    let alertBlock = '';
    if (isExpired) {
      alertBlock = `
        <div style="margin-top:14px;padding:14px;border-radius:10px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);font-size:12.5px;color:var(--text-secondary);line-height:1.5">
          <div style="font-weight:700;color:#ef4444;margin-bottom:4px">Your ${esc(pkgLabel)} package expired${endDate ? ` on ${esc(endDate)}` : ''}.</div>
          <div>Existing assigned clients continue to work normally. However, you cannot add new clients until you renew your package.</div>
          <div style="margin-top:10px">
            <button type="button" class="btn btn-emerald btn-sm" onclick="const el=document.getElementById('billing-catalog');if(el)el.scrollIntoView({behavior:'smooth'})">Renew Package Below ↓</button>
          </div>
        </div>`;
    } else if (atLimit) {
      alertBlock = `
        <div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.35);font-size:12px;color:#b9770b;line-height:1.5">
          <b>You have used ${used} of ${limit} client slots.</b> Upgrade your plan to add more clients.
        </div>`;
    }

    return `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--text-tertiary)">Current plan</div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
              <span style="font-size:26px;font-weight:800;letter-spacing:-.5px;color:var(--text-primary)">${esc(pkgLabel)}</span>
              ${statusBadge}
            </div>
            <div style="font-size:12px;color:var(--text-tertiary);margin-top:5px">${billingDesc}</div>
          </div>
        </div>
        <div style="margin-top:18px;font-size:13px;color:var(--text-secondary)">${slotsLine}</div>
        <div style="height:8px;border-radius:99px;background:var(--nc-track,rgba(13,24,40,.1));overflow:hidden;margin-top:10px">
          <div style="height:100%;width:${pct}%;background:${isExpired ? '#ef4444' : 'linear-gradient(90deg,#14b8a6,#2dd4bf)'};transition:width .4s ease"></div>
        </div>
        ${alertBlock}
      </div>`;
  }

  // ── Monthly / Annual toggle ────────────────────────────────────
  function _intervalToggle() {
    const btn = (key, main, sub) => `
      <button type="button" data-interval="${key}"
        style="flex:1;padding:9px 12px;border-radius:99px;border:1px solid ${_interval===key?'rgba(20,184,166,.5)':'var(--nc-border,rgba(13,24,40,.1))'};
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

  // ── Unified Upgrade catalog grid (interval-aware & purchasable) ─
  function _upgradeGrid(s, prices, openReq, settings) {
    if (typeof Packages === 'undefined') return '';
    const current = s ? s.package_key : null;
    const annual  = _interval === 'annual';
    const monthsNum = annual ? 12 : 1;

    const cards = Packages.CATALOG.map((p) => {
      const isCurrent = p.key === current;

      // Check if an active package_prices row exists for this tier & duration
      const priceRow = (prices || []).find(r => r.package_key === p.key && r.months === monthsNum && r.active);
      const isPurchasable = !!priceRow && p.key !== 'free' && p.key !== 'custom';

      let priceBlock;
      if (p.key === 'custom') {
        const unit = Packages.customUnit(_interval);
        priceBlock = `<div style="font-size:20px;font-weight:800;color:var(--text-primary)">${_money(unit)}<span style="font-size:12px;font-weight:600;color:var(--text-tertiary)">/client${_suffix()}</span></div>`;
      } else {
        const pr = annual ? p.annual : p.monthly;
        priceBlock = `<div style="font-size:24px;font-weight:800;color:var(--text-primary)">${_money(pr.price)}<span style="font-size:12px;font-weight:600;color:var(--text-tertiary)">${_suffix()}</span>${pr.old != null ? `<span style="font-size:13px;font-weight:600;color:var(--text-tertiary);text-decoration:line-through;margin-left:8px">${_money(pr.old)}</span>` : ''}</div>`;
      }

      const saveNote = annual && p.key !== 'free'
        ? `<div style="margin-top:4px;font-size:11px;font-weight:600;color:${TEAL}">2 months free</div>` : '';

      // Display EGP charge amount if self-service purchasable
      let egpBlock = '';
      if (isPurchasable && priceRow.charge_amount_minor != null) {
        const egpAmount = (priceRow.charge_amount_minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        egpBlock = `<div style="font-size:13px;font-weight:700;color:${TEAL};margin-top:6px">EGP ${egpAmount} <span style="font-size:11px;font-weight:500;color:var(--text-tertiary)">(InstaPay transfer)</span></div>`;
      }

      // Determine card action block based on per-tier rules
      let actionBlock = '';
      if (p.key === 'free') {
        actionBlock = isCurrent
          ? `<div style="font-size:12px;font-weight:600;color:var(--text-tertiary);margin-top:14px;text-align:center">Included with your plan</div>`
          : `<div style="font-size:12px;color:var(--text-tertiary);margin-top:14px;line-height:1.4">Standard starter tier.</div>`;
      } else if (p.key === 'custom') {
        actionBlock = `<div style="font-size:12px;color:var(--text-tertiary);margin-top:14px;line-height:1.4">Always contact your administrator — custom tiers are admin-assigned.</div>`;
      } else if (isPurchasable) {
        const btnText = isCurrent ? 'Renew' : 'Select';
        const hasOpenReq = !!openReq;
        actionBlock = `
          <div style="margin-top:16px">
            <button type="button" class="btn btn-emerald" style="width:100%"
              data-action="buy-package" data-key="${esc(p.key)}" data-months="${monthsNum}" data-is-current="${isCurrent}"
              ${hasOpenReq ? 'disabled title="You have an open payment request in progress"' : ''}>
              ${hasOpenReq ? 'Request Pending' : btnText}
            </button>
            ${hasOpenReq ? `<div style="font-size:11px;color:#b9770b;margin-top:4px;text-align:center">Open request in progress</div>` : ''}
          </div>`;
      } else {
        // Muted note when no active price row exists for this tier
        actionBlock = `<div style="font-size:12px;color:var(--text-tertiary);margin-top:14px;line-height:1.4">Self-service payment not available yet — contact your administrator.</div>`;
      }

      return `
        <div class="card" style="display:flex;flex-direction:column;justify-content:space-between;border:1px solid ${isCurrent ? 'rgba(20,184,166,.5)' : 'var(--nc-border,rgba(13,24,40,.1))'};${isCurrent ? 'box-shadow:0 0 0 1px rgba(20,184,166,.35)' : ''};padding:18px">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-size:15px;font-weight:700;color:var(--text-primary)">${esc(p.label)}</div>
              ${isCurrent ? `<span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:999px;background:rgba(20,184,166,.14);color:${TEAL};border:1px solid rgba(20,184,166,.35)">Current</span>` : ''}
            </div>
            <div style="margin-top:10px">${priceBlock}</div>
            ${saveNote}
            ${egpBlock}
            <div style="margin-top:8px;font-size:12px;color:var(--text-secondary);line-height:1.4">${esc(p.blurb)}</div>
          </div>
          <div>
            ${actionBlock}
          </div>
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
      ? 'As admin you have unlimited access. Coach packages and billing intervals are admin-assigned or managed via InstaPay requests.'
      : 'Select a package tier above to request InstaPay transfer details. After completing your transfer, tap "I\'ve sent it" to submit your request for owner confirmation. Package activation occurs upon owner approval.';
    return `<div style="font-size:12px;color:var(--text-tertiary);line-height:1.6;margin-top:16px">${esc(msg)}</div>`;
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

  // Package purchase handler
  async function _handleBuy(btn) {
    const key = btn.dataset.key;
    const months = Number(btn.dataset.months);
    const settings = _billingData ? _billingData.settings : null;

    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Requesting…';

      // Server-side price resolution — DO NOT send p_amount_minor!
      const reqData = await PaymentUI.requestPackagePayment(key, months);

      if (typeof Dashboard !== 'undefined' && typeof Dashboard.toast === 'function') {
        Dashboard.toast('Payment request created! Please review payment instructions.', 'success');
      }

      PaymentUI.openInstaPayModal(reqData, settings);

      // Refresh billing data and view
      if (typeof PaymentUI !== 'undefined' && typeof PaymentUI.fetchBillingData === 'function') {
        _billingData = await PaymentUI.fetchBillingData();
      }
      const host = document.getElementById('billing-root');
      if (host) _paint(host);
    } catch (e) {
      if (typeof Dashboard !== 'undefined' && typeof Dashboard.toast === 'function') {
        Dashboard.toast(e.message || 'Could not create payment request', 'danger');
      }
      btn.disabled = false;
      btn.innerHTML = (btn.dataset.isCurrent === 'true') ? 'Renew' : 'Select';
    }
  }

  // Render view
  function _paint(host) {
    const isAdmin = (typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin());
    const prices = _billingData ? _billingData.prices : [];
    const settings = _billingData ? _billingData.settings : null;
    const requests = _billingData ? _billingData.requests : [];

    const openReq = (requests || []).find(r => r.status === 'pending' || r.status === 'awaiting_review');
    const latestReq = (requests || [])[0];

    // Status Panel at top if requests exist
    let statusHtml = '';
    if (latestReq && typeof PaymentUI !== 'undefined' && typeof PaymentUI.renderCoachStatusCard === 'function') {
      statusHtml = PaymentUI.renderCoachStatusCard(latestReq, settings);
    }

    host.innerHTML =
      _currentPlanCard(_status) +
      statusHtml +
      `<div id="billing-catalog">` +
      _upgradeGrid(_status, prices, openReq, settings) +
      `</div>` +
      _customCalc() +
      _footerNote(isAdmin);

    // Interval toggle listeners
    host.querySelectorAll('[data-interval]').forEach((b) =>
      b.addEventListener('click', () => {
        _interval = b.dataset.interval;
        _paint(host);
      }));

    // Tier purchase button listeners
    host.querySelectorAll('[data-action="buy-package"]').forEach((btn) =>
      btn.addEventListener('click', () => _handleBuy(btn)));

    // Reopen pending request modal listener
    host.querySelectorAll('[data-action="reopen-instapay-modal"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const reqId = btn.dataset.reqId;
        const req = (requests || []).find(r => r.id === reqId);
        if (req && typeof PaymentUI !== 'undefined' && typeof PaymentUI.openInstaPayModal === 'function') {
          PaymentUI.openInstaPayModal({
            request_id: req.id,
            package_key: req.package_key,
            months: req.months,
            amount_minor: req.amount_minor,
            currency: req.currency,
            coach_reference: req.coach_reference
          }, settings);
        }
      });
    });

    _wireCalc(host);
  }

  async function render() {
    const host = document.getElementById('billing-root');
    if (!host) return;
    host.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--text-tertiary)"><span class="spinner"></span></div>`;

    const [statusRes, billingRes] = await Promise.all([
      _fetchStatus(),
      (typeof PaymentUI !== 'undefined' && typeof PaymentUI.fetchBillingData === 'function')
        ? PaymentUI.fetchBillingData()
        : Promise.resolve(null)
    ]);

    _status = statusRes;
    _billingData = billingRes;

    if (!_status) {
      host.innerHTML = `<div class="card" style="padding:24px;color:var(--text-secondary)">Could not load your billing status. Please refresh.</div>`;
      return;
    }

    _interval = (_status.billing_interval === 'annual') ? 'annual' : 'monthly';
    _paint(host);
  }

  window.Billing = { render };
})();
