/* ═══════════════════════════════════════════════════════════════
   js/paymentUI.js — Phase P2C-2: Manual InstaPay Payment UI
   
   Coach request + Owner approval workflow for self-service packages.
   
   Data Contracts:
     - package_prices: self-service package EGP prices (starter, growth, pro, scale)
     - payment_settings: owner's InstaPay payment link & enabled toggle
     - coach_payment_requests: request lifecycle records
   
   RPCs used:
     - request_coach_package_payment({ p_package_key, p_months })
     - mark_coach_payment_sent({ p_request_id, p_reference })
     - approve_coach_payment({ p_request_id, p_period_start, p_admin_note })
     - reject_coach_payment({ p_request_id, p_reason })
     
   Exposes window.PaymentUI
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // Helper for HTML escaping
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TEAL = '#14b8a6';

  // Status specifications:
  // THE RULE THAT MATTERS MOST: awaiting_review MUST NEVER read as paid, complete, successful, or active.
  const STATUS_MAP = {
    pending: {
      label: 'Awaiting your transfer',
      badgeClass: 'p2c-badge p2c-badge-amber',
      tone: 'amber',
      desc: 'Please complete the transfer using the InstaPay details and tap "I\'ve sent it".'
    },
    awaiting_review: {
      label: 'Waiting for owner confirmation',
      badgeClass: 'p2c-badge p2c-badge-amber',
      tone: 'amber',
      desc: 'Your transfer claim has been submitted. The owner will verify the InstaPay transfer and activate your package.'
    },
    approved: {
      label: 'Approved — package active',
      badgeClass: 'p2c-badge p2c-badge-green',
      tone: 'green',
      desc: 'Your package request was verified and activated.'
    },
    rejected: {
      label: 'Not confirmed',
      badgeClass: 'p2c-badge p2c-badge-rose',
      tone: 'rose',
      desc: 'The owner could not confirm this transfer.'
    }
  };

  // Format currency helpers
  function formatUSD(minor) {
    if (minor == null) return '';
    const dollars = minor / 100;
    return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
  }

  function formatEGP(minor) {
    if (minor == null) return '';
    const pounds = minor / 100;
    return `EGP ${pounds.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  // Toast notification helper
  function toast(msg, kind) {
    if (typeof Dashboard !== 'undefined' && typeof Dashboard.toast === 'function') {
      Dashboard.toast(msg, kind);
    } else {
      console.log(`[PaymentUI Toast] (${kind || 'info'}): ${msg}`);
    }
  }

  // ── 1. FAIL-SOFT DB READERS ──────────────────────────────────────

  async function fetchActivePackagePrices() {
    if (typeof sb === 'undefined') return [];
    try {
      const { data, error } = await sb
        .from('package_prices')
        .select('*')
        .eq('active', true);
      if (error) {
        console.warn('[PaymentUI] package_prices query error:', error.message);
        return [];
      }
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[PaymentUI] package_prices fetch threw:', e);
      return [];
    }
  }

  async function fetchPaymentSettings() {
    if (typeof sb === 'undefined') return null;
    try {
      const { data, error } = await sb
        .from('payment_settings')
        .select('*')
        .limit(1);
      if (error) {
        console.warn('[PaymentUI] payment_settings query error:', error.message);
        return null;
      }
      return (Array.isArray(data) && data.length > 0) ? data[0] : null;
    } catch (e) {
      console.warn('[PaymentUI] payment_settings fetch threw:', e);
      return null;
    }
  }

  async function fetchCoachRequests(coachId) {
    if (typeof sb === 'undefined') return [];
    if (!coachId) return []; // never fall back to an unscoped select
    try {
      const { data, error } = await sb
        .from('coach_payment_requests')
        .select('*')
        .eq('coach_id', coachId)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[PaymentUI] coach_payment_requests query error:', error.message);
        return [];
      }
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[PaymentUI] coach_payment_requests fetch threw:', e);
      return [];
    }
  }

  async function fetchAllRequestsForAdmin() {
    if (typeof sb === 'undefined') return [];
    try {
      const { data: reqs, error } = await sb
        .from('coach_payment_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[PaymentUI] admin requests fetch error:', error.message);
        return [];
      }
      if (!Array.isArray(reqs) || !reqs.length) return [];

      // Collect coach profiles to show names & emails
      const coachIds = [...new Set(reqs.map(r => r.coach_id).filter(Boolean))];
      let profilesMap = {};
      if (coachIds.length > 0) {
        const { data: profs } = await sb
          .from('profiles')
          .select('id, full_name, email')
          .in('id', coachIds);
        if (Array.isArray(profs)) {
          profs.forEach(p => { profilesMap[p.id] = p; });
        }
      }

      return reqs.map(r => ({
        ...r,
        coach_name: profilesMap[r.coach_id]?.full_name || 'Coach',
        coach_email: profilesMap[r.coach_id]?.email || ''
      }));
    } catch (e) {
      console.warn('[PaymentUI] fetchAllRequestsForAdmin threw:', e);
      return [];
    }
  }

  async function fetchAllPackagePricesForAdmin() {
    if (typeof sb === 'undefined') return [];
    try {
      const { data, error } = await sb
        .from('package_prices')
        .select('*')
        .order('package_key')
        .order('months');
      if (error) {
        console.warn('[PaymentUI] admin package_prices fetch error:', error.message);
        return [];
      }
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[PaymentUI] fetchAllPackagePricesForAdmin threw:', e);
      return [];
    }
  }

  // ── 2. RPC CALLERS ───────────────────────────────────────────────

  // Coach: request a package. SERVER decides price — do NOT send p_amount_minor!
  async function requestPackagePayment(packageKey, months) {
    if (typeof sb === 'undefined') throw new Error('Database connection unavailable');
    const { data, error } = await sb.rpc('request_coach_package_payment', {
      p_package_key: packageKey,
      p_months: Number(months)
    });
    if (error) throw new Error(error.message || 'Payment request failed');
    return data;
  }

  // Coach: declare transfer sent with optional reference note
  async function markPaymentSent(requestId, reference) {
    if (typeof sb === 'undefined') throw new Error('Database connection unavailable');
    const payload = { p_request_id: requestId };
    if (reference && reference.trim()) {
      payload.p_reference = reference.trim().substring(0, 500);
    }
    const { data, error } = await sb.rpc('mark_coach_payment_sent', payload);
    if (error) throw new Error(error.message || 'Action failed');
    return data;
  }

  // Owner ONLY: approve coach payment
  async function approvePayment(requestId, adminNote) {
    if (typeof sb === 'undefined') throw new Error('Database connection unavailable');
    const payload = { p_request_id: requestId, p_period_start: null };
    if (adminNote && adminNote.trim()) {
      payload.p_admin_note = adminNote.trim().substring(0, 500);
    }
    const { data, error } = await sb.rpc('approve_coach_payment', payload);
    if (error) throw new Error(error.message || 'Approval failed');
    return data;
  }

  // Owner ONLY: reject coach payment with mandatory reason
  async function rejectPayment(requestId, reason) {
    if (typeof sb === 'undefined') throw new Error('Database connection unavailable');
    if (!reason || !reason.trim()) {
      throw new Error('A rejection reason is required for the coach.');
    }
    const { data, error } = await sb.rpc('reject_coach_payment', {
      p_request_id: requestId,
      p_reason: reason.trim().substring(0, 500)
    });
    if (error) throw new Error(error.message || 'Rejection failed');
    return data;
  }

  // ── 3. COACH SURFACE (INSTAPAY PACKAGE PURCHASES & REQUEST STATUS) ──

  async function renderCoachBillingSection(containerId, currentInterval, onIntervalChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const monthsNum = currentInterval === 'annual' ? 12 : 1;

    // Parallel fetch: active package prices, payment settings, and coach's requests
    const [prices, settings, requests] = await Promise.all([
      fetchActivePackagePrices(),
      fetchPaymentSettings(),
      fetchCoachRequests()
    ]);

    // Filter active prices matching current interval
    const activeForInterval = prices.filter(p => p.months === monthsNum && p.active);

    let html = '';

    // A. Coach Request Status Panel (If coach has existing requests)
    const openReq = requests.find(r => r.status === 'pending' || r.status === 'awaiting_review');
    const latestReq = requests[0];

    if (latestReq) {
      html += renderCoachStatusCard(latestReq, settings);
    }

    // B. Package Pricing Cards (InstaPay Self-Service)
    html += `
      <div style="margin-top:24px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-size:14px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-tertiary)">InstaPay Self-Service Packages</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">Select a package to request manual InstaPay payment details</div>
        </div>
      </div>`;

    if (!activeForInterval.length) {
      html += `
        <div class="card" style="padding:28px;text-align:center;color:var(--text-secondary);margin-bottom:24px">
          <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px">Pricing not yet available</div>
          <div style="font-size:13px;color:var(--text-tertiary);max-width:480px;margin:0 auto">
            InstaPay payment tiers are not currently configured for this billing interval. Please check back later or contact your administrator.
          </div>
        </div>`;
    } else {
      const cardsHtml = activeForInterval.map(p => {
        const pkgCatalog = (typeof Packages !== 'undefined') ? Packages.byKey(p.package_key) : null;
        const label = pkgCatalog ? pkgCatalog.label : (p.package_key.charAt(0).toUpperCase() + p.package_key.slice(1));
        const blurb = pkgCatalog ? pkgCatalog.blurb : '';
        
        const usdPrice = formatUSD(p.list_amount_minor);
        const wasUSD = p.list_was_amount_minor ? formatUSD(p.list_was_amount_minor) : null;
        const egpPrice = formatEGP(p.charge_amount_minor);
        const intervalSuffix = monthsNum === 12 ? '/yr' : '/mo';

        const hasOpenReq = !!openReq;

        return `
          <div class="card p2c-pkg-card" style="display:flex;flex-direction:column;justify-content:space-between;padding:20px;border:1px solid var(--nc-border,rgba(13,24,40,.1))">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-size:16px;font-weight:700;color:var(--text-primary)">${esc(label)}</div>
                ${monthsNum === 12 ? `<span style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:99px;background:rgba(20,184,166,.12);color:${TEAL}">Annual Savings</span>` : ''}
              </div>
              <div style="margin-top:6px">
                <span style="font-size:22px;font-weight:800;color:var(--text-primary)">${usdPrice}</span>
                <span style="font-size:12px;color:var(--text-tertiary)">${intervalSuffix}</span>
                ${wasUSD ? `<span style="font-size:13px;color:var(--text-tertiary);text-decoration:line-through;margin-left:6px">${wasUSD}</span>` : ''}
              </div>
              <div style="font-size:14px;font-weight:700;color:${TEAL};margin-top:4px">
                ${egpPrice} <span style="font-size:11px;font-weight:500;color:var(--text-tertiary)">(InstaPay Transfer)</span>
              </div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:10px;line-height:1.4">${esc(blurb)}</div>
            </div>
            <div style="margin-top:18px">
              <button type="button" class="btn btn-emerald" style="width:100%"
                data-action="request-pkg" data-key="${esc(p.package_key)}" data-months="${monthsNum}"
                ${hasOpenReq ? 'disabled title="You have an open payment request in progress"' : ''}>
                ${hasOpenReq ? 'Request Pending' : 'Request Package'}
              </button>
            </div>
          </div>`;
      }).join('');

      html += `<div class="grid-3 stagger" style="margin-bottom:24px">${cardsHtml}</div>`;
    }

    container.innerHTML = html;

    // Attach event handlers for "Request Package" buttons
    container.querySelectorAll('[data-action="request-pkg"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        const months = btn.dataset.months;
        try {
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner"></span> Requesting…';
          const reqData = await requestPackagePayment(key, months);
          toast('Payment request created! Please review payment instructions.', 'success');
          openInstaPayModal(reqData, settings);
          renderCoachBillingSection(containerId, currentInterval, onIntervalChange);
        } catch (e) {
          toast(e.message || 'Could not create payment request', 'danger');
          btn.disabled = false;
          btn.innerHTML = 'Request Package';
        }
      });
    });

    // Attach handlers for re-opening pending request payment modal
    container.querySelectorAll('[data-action="reopen-instapay-modal"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const reqId = btn.dataset.reqId;
        const req = requests.find(r => r.id === reqId);
        if (req) {
          openInstaPayModal({
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
  }

  // Coach Status Panel Component
  function renderCoachStatusCard(req, settings) {
    const info = STATUS_MAP[req.status] || STATUS_MAP.pending;
    const pkgLabel = (typeof Packages !== 'undefined') ? Packages.label(req.package_key) : req.package_key;
    const durationLabel = req.months === 12 ? '12 Months (Annual)' : '1 Month';
    const amountStr = formatEGP(req.amount_minor);
    const dateStr = req.created_at ? new Date(req.created_at).toLocaleDateString() : '';

    const isPending = req.status === 'pending';
    const isAwaiting = req.status === 'awaiting_review';

    return `
      <div class="card p2c-status-card" style="margin-bottom:20px;border-left:4px solid ${info.tone === 'green' ? '#10b981' : info.tone === 'rose' ? '#ef4444' : '#f59e0b'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-tertiary)">Most Recent Payment Request</div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap">
              <span style="font-size:18px;font-weight:800;color:var(--text-primary)">${esc(pkgLabel)} · ${esc(durationLabel)}</span>
              <span class="${info.badgeClass}">${esc(info.label)}</span>
            </div>
            <div style="font-size:13px;font-weight:700;color:${TEAL};margin-top:4px">
              ${amountStr} ${dateStr ? `· Requested ${dateStr}` : ''}
            </div>
          </div>
          ${(isPending || isAwaiting) ? `
            <div>
              <button type="button" class="btn btn-sm btn-ghost" data-action="reopen-instapay-modal" data-req-id="${esc(req.id)}">
                View Instructions &amp; Confirm
              </button>
            </div>
          ` : ''}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:10px;line-height:1.5">
          ${esc(info.desc)}
        </div>
        ${req.coach_reference ? `
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px">
            <b>Your reference note:</b> "${esc(req.coach_reference)}"
          </div>
        ` : ''}
        ${req.admin_note && req.status === 'rejected' ? `
          <div style="font-size:12px;color:#ef4444;margin-top:8px;padding:8px 12px;border-radius:8px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2)">
            <b>Owner Reason:</b> ${esc(req.admin_note)}
          </div>
        ` : ''}
      </div>`;
  }

  // Coach InstaPay Payment Modal
  function openInstaPayModal(reqData, settings) {
    let modal = document.getElementById('modal-instapay-instructions');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-instapay-instructions';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    const instructions = reqData.payment_instructions || settings || {};
    const link = instructions.payment_link;
    const label = instructions.display_label || 'InstaPay Account';
    const isEnabled = instructions.enabled !== false && !!link;

    const pkgLabel = (typeof Packages !== 'undefined') ? Packages.label(reqData.package_key) : reqData.package_key;
    const amountEGP = formatEGP(reqData.amount_minor);

    modal.innerHTML = `
      <div class="modal-card" style="max-width:520px;width:92%">
        <div class="modal-header">
          <h3 style="font-size:18px;font-weight:800;color:var(--text-primary)">InstaPay Transfer Instructions</h3>
          <button type="button" class="modal-close" onclick="PaymentUI.closeModal('modal-instapay-instructions')">&times;</button>
        </div>
        <div class="modal-body" style="padding:20px">
          <div style="margin-bottom:16px;padding:14px;border-radius:10px;background:var(--nc-bg-surface,rgba(13,24,40,.04));border:1px solid var(--nc-border,rgba(13,24,40,.1))">
            <div style="font-size:12px;color:var(--text-tertiary);text-transform:uppercase;font-weight:700">Requested Package</div>
            <div style="font-size:16px;font-weight:800;color:var(--text-primary);margin-top:2px">${esc(pkgLabel)} (${reqData.months === 12 ? '12 Months' : '1 Month'})</div>
            <div style="font-size:20px;font-weight:800;color:${TEAL};margin-top:6px">${amountEGP}</div>
          </div>

          ${isEnabled ? `
            <div style="margin-bottom:18px">
              <label style="display:block;font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:6px">Owner Payment Details</label>
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <a href="${esc(link)}" target="_blank" rel="noopener" class="btn btn-emerald" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none">
                  Open ${esc(label)} ↗
                </a>
                <button type="button" class="btn btn-ghost btn-sm" id="btn-copy-payment-link">Copy Link</button>
              </div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:6px;word-break:break-all">${esc(link)}</div>
            </div>
          ` : `
            <div class="p2c-alert p2c-alert-amber" style="margin-bottom:18px">
              <b>Payment Link Not Configured:</b> The owner has not configured their InstaPay payment link yet. Please contact the administrator.
            </div>
          `}

          <div style="margin-bottom:18px">
            <label for="p2c-coach-ref" style="display:block;font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:6px">
              Transfer Reference / Sender Note (Optional)
            </label>
            <input id="p2c-coach-ref" class="form-input" type="text" maxlength="500"
              placeholder="e.g. InstaPay transaction # or sender name"
              value="${esc(reqData.coach_reference || '')}" style="width:100%">
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">
              Provide your name or transaction reference so the owner can verify your transfer quickly.
            </div>
          </div>

          <div style="padding:12px;border-radius:8px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);font-size:12px;color:#b9770b;margin-bottom:20px;line-height:1.4">
            <b>Important:</b> Tapping "I've sent it" submits your request for owner confirmation. Your package will activate once the owner approves your transfer.
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px">
            <button type="button" class="btn btn-ghost" onclick="PaymentUI.closeModal('modal-instapay-instructions')">Close</button>
            <button type="button" class="btn btn-emerald" id="btn-confirm-sent">I've sent it</button>
          </div>
        </div>
      </div>`;

    modal.classList.add('active');

    // Copy link handler
    const copyBtn = modal.querySelector('#btn-copy-payment-link');
    if (copyBtn && link) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(link).then(() => {
          toast('Payment link copied to clipboard!', 'success');
        }).catch(() => {
          toast('Could not copy link', 'warning');
        });
      });
    }

    // "I've sent it" handler
    const sentBtn = modal.querySelector('#btn-confirm-sent');
    if (sentBtn) {
      sentBtn.addEventListener('click', async () => {
        const refInput = modal.querySelector('#p2c-coach-ref');
        const refVal = refInput ? refInput.value : '';
        try {
          sentBtn.disabled = true;
          sentBtn.innerHTML = '<span class="spinner"></span> Submitting…';
          await markPaymentSent(reqData.request_id || reqData.id, refVal);
          toast('Transfer claimed! Waiting for owner confirmation.', 'success');
          closeModal('modal-instapay-instructions');
          // Refresh coach billing
          if (typeof Billing !== 'undefined' && typeof Billing.render === 'function') {
            Billing.render();
          }
        } catch (e) {
          toast(e.message || 'Could not submit confirmation', 'danger');
          sentBtn.disabled = false;
          sentBtn.innerHTML = "I've sent it";
        }
      });
    }
  }

  // ── 4. OWNER / ADMIN SURFACE (REVIEW QUEUE & PRICING SETTINGS) ─────

  async function renderAdminPaymentQueue(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-tertiary)"><span class="spinner"></span> Loading payment requests…</div>`;

    const requests = await fetchAllRequestsForAdmin();

    if (!requests.length) {
      container.innerHTML = `
        <div style="padding:28px;text-align:center;color:var(--text-secondary)">
          No coach payment requests found.
        </div>`;
      return;
    }

    // Sort requests: awaiting_review FIRST, then pending, then approved, then rejected
    const priorityOrder = { awaiting_review: 0, pending: 1, approved: 2, rejected: 3 };
    requests.sort((a, b) => {
      const pa = priorityOrder[a.status] ?? 99;
      const pb = priorityOrder[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    const rowsHtml = requests.map(r => {
      const info = STATUS_MAP[r.status] || STATUS_MAP.pending;
      const pkgLabel = (typeof Packages !== 'undefined') ? Packages.label(r.package_key) : r.package_key;
      const amountStr = formatEGP(r.amount_minor);
      const dateStr = r.created_at ? new Date(r.created_at).toLocaleString() : '—';
      const refStr = r.coach_reference ? esc(r.coach_reference) : '<span style="color:var(--text-tertiary)">—</span>';
      const canAction = r.status === 'awaiting_review';

      return `
        <tr>
          <td>
            <div style="font-weight:700;color:var(--text-primary)">${esc(r.coach_name)}</div>
            <div style="font-size:11px;color:var(--text-tertiary)" class="mono">${esc(r.coach_email)}</div>
          </td>
          <td>
            <div style="font-weight:600;color:var(--text-primary)">${esc(pkgLabel)}</div>
            <div style="font-size:11px;color:var(--text-tertiary)">${r.months === 12 ? '12 Months (Annual)' : '1 Month'}</div>
          </td>
          <td style="font-weight:700;color:${TEAL}">${amountStr}</td>
          <td style="font-size:12px">${refStr}</td>
          <td><span class="${info.badgeClass}">${esc(info.label)}</span></td>
          <td style="font-size:12px;color:var(--text-tertiary)">${dateStr}</td>
          <td style="text-align:right">
            ${canAction ? `
              <button type="button" class="btn btn-xs btn-emerald" data-action="admin-approve" data-id="${esc(r.id)}" data-coach="${esc(r.coach_name)}" data-pkg="${esc(pkgLabel)}" data-amount="${esc(amountStr)}">Approve</button>
              <button type="button" class="btn btn-xs btn-ghost" style="color:#ef4444" data-action="admin-reject" data-id="${esc(r.id)}" data-coach="${esc(r.coach_name)}">Reject</button>
            ` : `<span style="font-size:11px;color:var(--text-tertiary)">Reviewed</span>`}
          </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
      <div style="overflow-x:auto">
        <table class="abz-table" style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="text-align:left;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-tertiary);border-bottom:1px solid var(--border-subtle)">
              <th style="padding:10px 12px">Coach</th>
              <th style="padding:10px 12px">Package</th>
              <th style="padding:10px 12px">EGP Amount</th>
              <th style="padding:10px 12px">Coach Reference</th>
              <th style="padding:10px 12px">Status</th>
              <th style="padding:10px 12px">Requested</th>
              <th style="padding:10px 12px;text-align:right">Action</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    // Attach approve handlers
    container.querySelectorAll('[data-action="admin-approve"]').forEach(btn => {
      btn.addEventListener('click', () => {
        openApproveModal({
          id: btn.dataset.id,
          coach_name: btn.dataset.coach,
          pkg_label: btn.dataset.pkg,
          amount_str: btn.dataset.amount
        });
      });
    });

    // Attach reject handlers
    container.querySelectorAll('[data-action="admin-reject"]').forEach(btn => {
      btn.addEventListener('click', () => {
        openRejectModal({
          id: btn.dataset.id,
          coach_name: btn.dataset.coach
        });
      });
    });
  }

  // Owner Approve Modal
  function openApproveModal(data) {
    let modal = document.getElementById('modal-admin-approve-payment');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-admin-approve-payment';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-card" style="max-width:480px;width:92%">
        <div class="modal-header">
          <h3 style="font-size:18px;font-weight:800;color:var(--text-primary)">Approve Coach Payment</h3>
          <button type="button" class="modal-close" onclick="PaymentUI.closeModal('modal-admin-approve-payment')">&times;</button>
        </div>
        <div class="modal-body" style="padding:20px">
          <!-- VISIBLE REMINDER TO CHECK INSTAPAY ACCOUNT BEFORE APPROVING -->
          <div style="padding:14px;border-radius:10px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);color:#b9770b;margin-bottom:16px;font-size:13px;line-height:1.5">
            <strong>⚠️ InstaPay Verification Reminder:</strong><br>
            Please check your official InstaPay account or bank statement and verify that the transfer of <strong>${esc(data.amount_str)}</strong> from <strong>${esc(data.coach_name)}</strong> has actually arrived before approving.
          </div>

          <div style="margin-bottom:16px;font-size:13px;color:var(--text-secondary)">
            Approving this request will activate the <b>${esc(data.pkg_label)}</b> package for coach <b>${esc(data.coach_name)}</b>.
          </div>

          <div style="margin-bottom:20px">
            <label for="p2c-admin-note" style="display:block;font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:4px">
              Admin Note (Optional)
            </label>
            <input id="p2c-admin-note" class="form-input" type="text" maxlength="500" placeholder="e.g. Confirmed in InstaPay app" style="width:100%">
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px">
            <button type="button" class="btn btn-ghost" onclick="PaymentUI.closeModal('modal-admin-approve-payment')">Cancel</button>
            <button type="button" class="btn btn-emerald" id="btn-submit-approve">Confirm &amp; Activate Package</button>
          </div>
        </div>
      </div>`;

    modal.classList.add('active');

    modal.querySelector('#btn-submit-approve').addEventListener('click', async () => {
      const noteInput = modal.querySelector('#p2c-admin-note');
      const noteVal = noteInput ? noteInput.value : '';
      const btn = modal.querySelector('#btn-submit-approve');

      try {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Approving…';
        const res = await approvePayment(data.id, noteVal);
        
        if (res && res.duplicate) {
          toast('This request was already approved and the period was not extended again.', 'info');
        } else {
          toast('Payment approved! Package activated.', 'success');
        }
        
        closeModal('modal-admin-approve-payment');
        // Refresh admin queue & business overview
        if (typeof AdminBusiness !== 'undefined' && typeof AdminBusiness.load === 'function') {
          AdminBusiness.load();
        }
      } catch (e) {
        toast(e.message || 'Could not approve payment', 'danger');
        btn.disabled = false;
        btn.innerHTML = 'Confirm &amp; Activate Package';
      }
    });
  }

  // Owner Reject Modal
  function openRejectModal(data) {
    let modal = document.getElementById('modal-admin-reject-payment');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-admin-reject-payment';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-card" style="max-width:480px;width:92%">
        <div class="modal-header">
          <h3 style="font-size:18px;font-weight:800;color:var(--text-primary)">Reject Payment Request</h3>
          <button type="button" class="modal-close" onclick="PaymentUI.closeModal('modal-admin-reject-payment')">&times;</button>
        </div>
        <div class="modal-body" style="padding:20px">
          <div style="margin-bottom:16px;font-size:13px;color:var(--text-secondary)">
            Reject payment request for coach <b>${esc(data.coach_name)}</b>.
          </div>

          <div style="margin-bottom:20px">
            <label for="p2c-reject-reason" style="display:block;font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:4px">
              Rejection Reason <span style="color:#ef4444">*</span>
            </label>
            <textarea id="p2c-reject-reason" class="form-input" rows="3" maxlength="500"
              placeholder="State why this transfer was not confirmed (e.g. No matching transfer found in InstaPay account)."
              style="width:100%"></textarea>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px">
            <button type="button" class="btn btn-ghost" onclick="PaymentUI.closeModal('modal-admin-reject-payment')">Cancel</button>
            <button type="button" class="btn" style="background:#ef4444;color:#fff" id="btn-submit-reject">Reject Request</button>
          </div>
        </div>
      </div>`;

    modal.classList.add('active');

    modal.querySelector('#btn-submit-reject').addEventListener('click', async () => {
      const reasonInput = modal.querySelector('#p2c-reject-reason');
      const reasonVal = reasonInput ? reasonInput.value : '';
      const btn = modal.querySelector('#btn-submit-reject');

      if (!reasonVal || !reasonVal.trim()) {
        toast('Please enter a rejection reason for the coach.', 'warning');
        return;
      }

      try {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Rejecting…';
        await rejectPayment(data.id, reasonVal);
        toast('Payment request rejected.', 'success');
        closeModal('modal-admin-reject-payment');
        if (typeof AdminBusiness !== 'undefined' && typeof AdminBusiness.load === 'function') {
          AdminBusiness.load();
        }
      } catch (e) {
        toast(e.message || 'Could not reject payment', 'danger');
        btn.disabled = false;
        btn.innerHTML = 'Reject Request';
      }
    });
  }

  // Owner Settings & Pricing Matrix Component
  async function renderAdminPaymentSettings(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-tertiary)"><span class="spinner"></span> Loading settings &amp; prices…</div>`;

    const [settings, prices] = await Promise.all([
      fetchPaymentSettings(),
      fetchAllPackagePricesForAdmin()
    ]);

    const isEnabled = settings ? !!settings.enabled : false;
    const linkVal = settings ? (settings.payment_link || '') : '';
    const labelVal = settings ? (settings.display_label || 'InstaPay Account') : 'InstaPay Account';

    // Map package prices by key and months
    const priceMap = {};
    prices.forEach(p => {
      priceMap[`${p.package_key}_${p.months}`] = p;
    });

    const targetKeys = ['starter', 'growth', 'pro', 'scale'];
    const targetDurations = [1, 12];

    let priceRowsHtml = '';
    targetKeys.forEach(key => {
      const pkgCatalog = (typeof Packages !== 'undefined') ? Packages.byKey(key) : null;
      const pkgLabel = pkgCatalog ? pkgCatalog.label : key.toUpperCase();

      targetDurations.forEach(m => {
        const rowData = priceMap[`${key}_${m}`] || {};
        const isAct = !!rowData.active;
        const egpVal = rowData.charge_amount_minor != null ? (rowData.charge_amount_minor / 100) : '';
        const usdVal = rowData.list_amount_minor != null ? formatUSD(rowData.list_amount_minor) : '—';
        const wasVal = rowData.list_was_amount_minor != null ? formatUSD(rowData.list_was_amount_minor) : '—';

        priceRowsHtml += `
          <tr>
            <td><b>${esc(pkgLabel)}</b></td>
            <td>${m === 12 ? '12 Months' : '1 Month'}</td>
            <td>${usdVal} ${wasVal !== '—' ? `<span style="font-size:11px;color:var(--text-tertiary);text-decoration:line-through">${wasVal}</span>` : ''}</td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:12px;color:var(--text-tertiary)">EGP</span>
                <input class="form-input" type="number" step="0.01" min="0" data-pkg-key="${esc(key)}" data-pkg-months="${m}"
                  id="egp-input-${esc(key)}-${m}" value="${egpVal !== '' ? egpVal : ''}" placeholder="e.g. 250.00" style="max-width:130px;font-weight:700">
              </div>
            </td>
            <td style="text-align:center">
              <input type="checkbox" id="active-chk-${esc(key)}-${m}" data-pkg-key="${esc(key)}" data-pkg-months="${m}" ${isAct ? 'checked' : ''}>
            </td>
            <td style="text-align:right">
              <button type="button" class="btn btn-xs btn-ghost" data-action="save-price-row" data-pkg-key="${esc(key)}" data-pkg-months="${m}">
                Save Row
              </button>
            </td>
          </tr>`;
      });
    });

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr;gap:20px">
        <!-- 1. InstaPay Payment Link & Settings -->
        <div class="card" style="padding:20px">
          <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:4px">InstaPay Payment Link &amp; Settings</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px">
            Set the InstaPay transfer link and display label shown to coaches when requesting packages.
          </div>
          <form id="form-admin-payment-settings">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
              <div>
                <label style="display:block;font-size:11px;font-weight:700;color:var(--text-tertiary);margin-bottom:4px">Payment Link (InstaPay URL)</label>
                <input id="set-payment-link" class="form-input" type="url" placeholder="https://ipn.eg/S/yourhandle" value="${esc(linkVal)}" style="width:100%">
              </div>
              <div>
                <label style="display:block;font-size:11px;font-weight:700;color:var(--text-tertiary);margin-bottom:4px">Display Label</label>
                <input id="set-display-label" class="form-input" type="text" placeholder="InstaPay @yourhandle" value="${esc(labelVal)}" style="width:100%">
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
              <label style="display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text-primary);cursor:pointer">
                <input id="set-enabled" type="checkbox" ${isEnabled ? 'checked' : ''}>
                Enable InstaPay Payment Gateway
              </label>
              <button type="submit" class="btn btn-emerald btn-sm">Save Payment Settings</button>
            </div>
          </form>
        </div>

        <!-- 2. EGP Price Matrix Card -->
        <div class="card" style="padding:20px">
          <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:4px">Package EGP Charge Pricing</div>
          <!-- Dependency Rule Notice -->
          <div style="padding:10px 14px;border-radius:8px;background:rgba(20,184,166,.08);border:1px solid rgba(20,184,166,.25);font-size:12px;color:var(--text-secondary);margin-bottom:16px">
            <b>Rule:</b> A tier with no EGP charge amount cannot be activated. Until an EGP price is set and the tier is toggled Active, coaches cannot request it.
          </div>
          <div style="overflow-x:auto">
            <table class="abz-table" style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="text-align:left;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-tertiary);border-bottom:1px solid var(--border-subtle)">
                  <th style="padding:10px 12px">Package Tier</th>
                  <th style="padding:10px 12px">Duration</th>
                  <th style="padding:10px 12px">List Price (USD)</th>
                  <th style="padding:10px 12px">Charge Amount (EGP)</th>
                  <th style="padding:10px 12px;text-align:center">Active</th>
                  <th style="padding:10px 12px;text-align:right">Action</th>
                </tr>
              </thead>
              <tbody>${priceRowsHtml}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    // Handle Payment Settings Save
    const settingsForm = container.querySelector('#form-admin-payment-settings');
    if (settingsForm) {
      settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (typeof sb === 'undefined') return;
        const link = container.querySelector('#set-payment-link').value.trim();
        const label = container.querySelector('#set-display-label').value.trim();
        const enabled = container.querySelector('#set-enabled').checked;

        try {
          const payload = {
            id: settings ? settings.id : undefined,
            payment_link: link,
            display_label: label || 'InstaPay Account',
            enabled: enabled,
            updated_at: new Date().toISOString()
          };

          const { error } = await sb.from('payment_settings').upsert(payload);
          if (error) throw error;
          toast('Payment settings saved successfully!', 'success');
        } catch (err) {
          toast('Could not save settings: ' + err.message, 'danger');
        }
      });
    }

    // Handle Price Row Save Buttons
    container.querySelectorAll('[data-action="save-price-row"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (typeof sb === 'undefined') return;
        const key = btn.dataset.pkgKey;
        const months = Number(btn.dataset.pkgMonths);
        const egpInput = container.querySelector(`#egp-input-${key}-${months}`);
        const activeChk = container.querySelector(`#active-chk-${key}-${months}`);

        const egpVal = parseFloat(egpInput.value);
        const isAct = activeChk.checked;

        if (isAct && (isNaN(egpVal) || egpVal <= 0)) {
          toast('Cannot activate package tier without a valid EGP charge amount.', 'warning');
          activeChk.checked = false;
          return;
        }

        const minorVal = !isNaN(egpVal) ? Math.round(egpVal * 100) : null;

        try {
          btn.disabled = true;
          btn.innerHTML = 'Saving…';
          
          const rowData = priceMap[`${key}_${months}`] || {};
          const payload = {
            id: rowData.id || undefined,
            package_key: key,
            months: months,
            charge_amount_minor: minorVal,
            charge_currency: 'EGP',
            active: isAct,
            updated_at: new Date().toISOString()
          };

          const { error } = await sb.from('package_prices').upsert(payload);
          if (error) throw error;

          toast(`Saved pricing for ${key} (${months}mo)`, 'success');
        } catch (err) {
          toast('Save failed: ' + err.message, 'danger');
        } finally {
          btn.disabled = false;
          btn.innerHTML = 'Save Row';
        }
      });
    });
  }

  async function fetchBillingData() {
    const coachId = (typeof Auth !== 'undefined' && typeof Auth.getUser === 'function') ? (Auth.getUser()?.id || null) : null;
    const [prices, settings, requests] = await Promise.all([
      fetchActivePackagePrices(),
      fetchPaymentSettings(),
      fetchCoachRequests(coachId)
    ]);
    return { prices, settings, requests };
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  // Public API
  window.PaymentUI = {
    fetchBillingData,
    fetchActivePackagePrices,
    fetchPaymentSettings,
    fetchCoachRequests,
    renderCoachStatusCard,
    renderCoachBillingSection,
    renderAdminPaymentQueue,
    renderAdminPaymentSettings,
    requestPackagePayment,
    markPaymentSent,
    approvePayment,
    rejectPayment,
    openInstaPayModal,
    openApproveModal,
    openRejectModal,
    closeModal,
    STATUS_MAP
  };
})();
