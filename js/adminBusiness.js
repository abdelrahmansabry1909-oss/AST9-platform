/* ═══════════════════════════════════════════════════════════════
   NeuCore — Admin Business Tracking (Phase 9)

   Admin-only operations surface: every coach's package, slots, revenue
   estimate, signup, verification, active status + CSV export, plus manual
   package management (reuses the admin_set_coach_package RPC).

   Data: admin_coach_business_overview() RPC (SECURITY DEFINER, admin-only
   — coaches/clients get "permission denied"). Prices are NOT in the DB;
   revenue is estimated here from window.Packages. No passwords anywhere.

   Public API (window.AdminBusiness):
     load()                 — fetch + render the table
     openManage(coachId)    — open the package modal for a coach
     savePackage()          — apply admin_set_coach_package
     exportBusinessCsv()    — download the coach business overview
     exportClientEmailsCsv()— download coach→client email list
     copyClientEmails(id)   — copy one coach's client emails

   Module pattern: vanilla IIFE, exposes as window.AdminBusiness.
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  let _rows = [];                 // last RPC result
  const _byId = {};               // coach_id → row

  // ── Helpers ───────────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const $ = (id) => document.getElementById(id);
  const _toast = (m, k) => { if (typeof Dashboard !== 'undefined') Dashboard.toast?.(m, k); };
  const _money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const _date = (s) => s ? new Date(s).toLocaleDateString() : '—';

  // Estimated revenue from the presentation catalog (window.Packages).
  // Billing interval is not stored, so we show BOTH monthly and annual as
  // reference — never a claimed/charged amount.
  function _revenue(row) {
    const key = row.package_key;
    if (key === 'custom') {
      const qty = row.custom_qty || row.client_limit || (window.Packages ? Packages.CUSTOM_MIN : 60);
      return window.Packages
        ? { m: Packages.customPrice(qty, 'monthly'), a: Packages.customPrice(qty, 'annual') }
        : { m: 0, a: 0 };
    }
    const p = window.Packages ? Packages.byKey(key) : null;
    return { m: p ? (p.monthly.price || 0) : 0, a: p ? (p.annual.price || 0) : 0 };
  }

  function _pkgLabel(key) { return window.Packages ? Packages.label(key) : (key || '—'); }

  // ── Load + render ─────────────────────────────────────────────
  async function load() {
    const host = $('abz-root');
    if (!host) return;
    host.innerHTML = `<div class="abz-loading"><span class="spinner"></span> Loading business overview…</div>`;

    if (typeof sb === 'undefined') { host.innerHTML = `<div class="abz-error">Not connected — please reload.</div>`; return; }
    const { data, error } = await sb.rpc('admin_coach_business_overview');
    if (error) {
      console.error('[AdminBusiness] load failed:', error.message);
      host.innerHTML = `<div class="abz-error">${esc(error.message || 'Could not load business overview.')}</div>`;
      return;
    }
    _rows = Array.isArray(data) ? data : [];
    Object.keys(_byId).forEach(k => delete _byId[k]);
    _rows.forEach(r => { _byId[r.coach_id] = r; });
    _render();
  }

  function _render() {
    const host = $('abz-root');
    if (!host) return;

    if (!_rows.length) {
      host.innerHTML = `<div class="abz-empty">No coaches yet.</div>`;
      return;
    }

    let totMrr = 0, totArr = 0, totClients = 0;
    const body = _rows.map(r => {
      const rev = _revenue(r);
      totMrr += rev.m; totArr += rev.a; totClients += (r.client_count || 0);
      const verified = r.email_verified ? '<span class="abz-ok">✓</span>' : '<span class="abz-muted">—</span>';
      const active = (r.is_active === false) ? '<span class="abz-muted">Inactive</span>' : '<span class="abz-ok">Active</span>';
      const limit = (r.client_limit == null) ? '∞' : r.client_limit;
      return `
        <tr>
          <td>${esc(r.coach_name || '—')}</td>
          <td><span class="mono" style="font-size:12px">${esc(r.coach_email || '—')}</span></td>
          <td>${esc(r.phone || '—')}</td>
          <td>${esc(r.country || '—')}</td>
          <td>${esc(r.business_name || '—')}</td>
          <td>${esc(r.professional_title || '—')}</td>
          <td style="text-align:center">${verified}</td>
          <td>${esc(_pkgLabel(r.package_key))}</td>
          <td style="text-align:center;text-transform:capitalize">${esc(r.billing_interval || 'monthly')}</td>
          <td style="text-align:center">${r.client_count ?? 0}</td>
          <td style="text-align:center">${limit}</td>
          <td style="text-align:center">${r.remaining_slots ?? '—'}</td>
          <td style="text-align:right">${_money(rev.m)}</td>
          <td style="text-align:right">${_money(rev.a)}</td>
          <td style="font-size:12px;color:var(--text-tertiary)">${_date(r.signup_date)}</td>
          <td style="text-align:center">${active}</td>
          <td style="text-align:center">${esc(r.package_status || '—')}</td>
          <td class="abz-actions">
            <button class="btn btn-xs btn-ghost" onclick="AdminBusiness.openManage('${r.coach_id}')">Package</button>
            <button class="btn btn-xs btn-ghost" onclick="AdminBusiness.copyClientEmails('${r.coach_id}')">✉ Emails</button>
          </td>
        </tr>`;
    }).join('');

    host.innerHTML = `
      <div class="abz-summary">
        <div class="abz-stat"><div class="abz-stat-n">${_rows.length}</div><div class="abz-stat-l">Coaches</div></div>
        <div class="abz-stat"><div class="abz-stat-n">${totClients}</div><div class="abz-stat-l">Clients</div></div>
        <div class="abz-stat"><div class="abz-stat-n">${_money(totMrr)}</div><div class="abz-stat-l">Est. MRR</div></div>
        <div class="abz-stat"><div class="abz-stat-n">${_money(totArr)}</div><div class="abz-stat-l">Est. ARR (annual plan)</div></div>
      </div>
      <div class="abz-toolbar">
        <button class="btn btn-sm btn-ghost" onclick="AdminBusiness.exportBusinessCsv()">⬇ Export business CSV</button>
        <button class="btn btn-sm btn-ghost" onclick="AdminBusiness.exportClientEmailsCsv()">⬇ Export client emails CSV</button>
      </div>
      <div class="abz-note">Revenue is <strong>estimated</strong> from package pricing (MRR = monthly, ARR = annual); each coach's stored billing interval is shown in the <strong>Interval</strong> column. No payment is processed. Passwords are never shown or exported.</div>
      <div class="abz-table-wrap">
        <table class="abz-table">
          <thead><tr>
            <th>Coach</th><th>Email</th><th>Mobile</th><th>Country</th><th>Business</th><th>Title</th>
            <th>Verified</th><th>Package</th><th>Interval</th>
            <th>Clients</th><th>Limit</th><th>Remaining</th><th>Est. MRR</th><th>Est. ARR</th>
            <th>Signup</th><th>Status</th><th>Package status</th><th>Actions</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  // ── Package management (reuses admin_set_coach_package) ────────
  function openManage(coachId) {
    const row = _byId[coachId];
    const sel = $('abz-pkg-coach');
    if (sel) {
      // Populate coach options once per open so the list is always current.
      sel.innerHTML = _rows.map(r => `<option value="${r.coach_id}">${esc(r.coach_name || r.coach_email)}</option>`).join('');
      if (coachId) sel.value = coachId;
    }
    const tierSel = $('abz-pkg-tier');
    if (tierSel && window.Packages) {
      tierSel.innerHTML = Packages.CATALOG.map(p => `<option value="${p.key}">${esc(p.label)} (${p.limit == null ? p.blurb : p.limit + ' clients'})</option>`).join('');
      if (row) tierSel.value = row.package_key;
    }
    const interval = $('abz-pkg-interval');
    if (interval) interval.value = (row && row.billing_interval) || 'monthly';
    const qty = $('abz-pkg-qty');
    if (qty) qty.value = (row && row.custom_qty) ? row.custom_qty : '';
    const notes = $('abz-pkg-notes');
    if (notes) notes.value = 'Admin-assigned package';
    _syncCustom();
    if (typeof Dashboard !== 'undefined') Dashboard.openModal('modal-coach-package');
  }

  // Show the custom-qty field only for the custom tier.
  function _syncCustom() {
    const tier = $('abz-pkg-tier')?.value;
    const wrap = $('abz-pkg-qty-wrap');
    if (wrap) wrap.style.display = (tier === 'custom') ? '' : 'none';
  }

  async function savePackage() {
    const coachId = $('abz-pkg-coach')?.value;
    const tier = $('abz-pkg-tier')?.value;
    const interval = ($('abz-pkg-interval')?.value === 'annual') ? 'annual' : 'monthly';
    const notes = ($('abz-pkg-notes')?.value || '').trim() || 'Admin-assigned package';
    if (!coachId || !tier) { _toast('Select a coach and a package.', 'error'); return; }

    let customQty = null;
    if (tier === 'custom') {
      customQty = parseInt($('abz-pkg-qty')?.value, 10);
      if (!Number.isFinite(customQty) || customQty < (window.Packages ? Packages.CUSTOM_MIN : 60)) {
        _toast(`Custom packages need at least ${window.Packages ? Packages.CUSTOM_MIN : 60} clients.`, 'error');
        return;
      }
    }

    const btn = $('abz-pkg-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const { error } = await sb.rpc('admin_set_coach_package', {
        p_coach_id: coachId, p_package_key: tier,
        p_custom_qty: customQty, p_notes: notes,
        p_billing_interval: interval,
      });
      if (error) throw error;
      _toast('Package updated (admin-assigned).', 'success');
      if (typeof Dashboard !== 'undefined') Dashboard.closeModal('modal-coach-package');
      await load();
    } catch (e) {
      console.error('[AdminBusiness] savePackage failed:', e?.message || e);
      _toast(e?.message || 'Could not update the package.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save package'; }
    }
  }

  // ── CSV export (no passwords, ever) ───────────────────────────
  function _csvCell(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function _download(filename, rows) {
    const csv = rows.map(r => r.map(_csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const _today = () => new Date().toISOString().slice(0, 10);

  function exportBusinessCsv() {
    if (!_rows.length) { _toast('Nothing to export.', 'error'); return; }
    const header = ['Coach', 'Email', 'Mobile', 'Country', 'Business', 'Title', 'Verified',
      'Package', 'Billing Interval', 'Clients', 'Limit', 'Remaining',
      'Est Monthly USD', 'Est Annual USD', 'Package Status', 'Active', 'Signup', 'Onboarded'];
    const rows = [header].concat(_rows.map(r => {
      const rev = _revenue(r);
      return [
        r.coach_name || '', r.coach_email || '', r.phone || '',
        r.country || '', r.business_name || '', r.professional_title || '',
        r.email_verified ? 'yes' : 'no', _pkgLabel(r.package_key), r.billing_interval || 'monthly',
        r.client_count ?? 0, r.client_limit == null ? 'unlimited' : r.client_limit,
        r.remaining_slots ?? '', rev.m, rev.a, r.package_status || '',
        (r.is_active === false) ? 'inactive' : 'active',
        r.signup_date ? new Date(r.signup_date).toISOString().slice(0, 10) : '',
        r.onboarding_completed_at ? new Date(r.onboarding_completed_at).toISOString().slice(0, 10) : '',
      ];
    }));
    _download(`ast9-coaches-business-${_today()}.csv`, rows);
    _toast('Business CSV downloaded.', 'success');
  }

  function exportClientEmailsCsv() {
    if (!_rows.length) { _toast('Nothing to export.', 'error'); return; }
    const rows = [['Coach', 'Coach Email', 'Client Email']];
    _rows.forEach(r => (r.client_emails || []).forEach(ce => {
      rows.push([r.coach_name || '', r.coach_email || '', ce]);
    }));
    if (rows.length === 1) { _toast('No client emails to export.', 'info'); return; }
    _download(`ast9-client-emails-${_today()}.csv`, rows);
    _toast(`Client emails CSV downloaded (${rows.length - 1}).`, 'success');
  }

  async function copyClientEmails(coachId) {
    const row = _byId[coachId];
    const emails = (row && row.client_emails) || [];
    if (!emails.length) { _toast('This coach has no client emails.', 'info'); return; }
    const text = emails.join(', ');
    try {
      await navigator.clipboard.writeText(text);
      _toast(`Copied ${emails.length} client email(s).`, 'success');
    } catch {
      // Clipboard blocked — surface the list so the admin can copy manually.
      window.prompt('Client emails:', text);
    }
  }

  // ── Wire the tier→custom toggle once the modal exists ─────────
  document.addEventListener('DOMContentLoaded', () => {
    const tierSel = document.getElementById('abz-pkg-tier');
    if (tierSel && !tierSel._bound) { tierSel._bound = true; tierSel.addEventListener('change', _syncCustom); }
  });

  // ── Expose ────────────────────────────────────────────────────
  window.AdminBusiness = {
    load, openManage, savePackage,
    exportBusinessCsv, exportClientEmailsCsv, copyClientEmails,
  };
})();
