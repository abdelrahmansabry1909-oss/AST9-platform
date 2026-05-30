// ═══════════════════════════════════════════════════════════════
//  js/subscriptions.js
//  Coach Subscriptions page: list, filter, create, activate,
//  reactivate (grace/expired), delete, stat counters.
//
//  Joins:
//    public.subscriptions (raw rows)         — for full table info
//    public.v_client_subscription_state      — for effective_status,
//                                              grace_days_left, etc.
//
//  Reactivation goes through SubscriptionService (service holds the
//  single renewal path). UI never calls reactivate_subscription() directly.
// ═══════════════════════════════════════════════════════════════

const Subscriptions = (() => {

  let _filter = 'all';   // 'all' | 'active' | 'grace' | 'expired' | 'pending'
  let _rows   = [];      // last loaded raw row set, annotated with effective state

  // ── Load + render ───────────────────────────────────────────────
  async function loadAll(filter = _filter) {
    _filter = filter || 'all';
    _highlightFilter();

    const tbody = document.getElementById('subs-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px"><span class="spinner spinner-lg"></span></td></tr>`;

    // Parallel: raw rows + per-client effective states.
    const [rawRes, states] = await Promise.all([
      sb.from('subscriptions')
        .select('*, profiles!subscriptions_client_id_fkey(full_name, email)')
        .order('created_at', { ascending: false }),
      typeof SubscriptionService !== 'undefined'
        ? SubscriptionService.listAllStates()
        : Promise.resolve([]),
    ]);

    if (rawRes.error || !rawRes.data?.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-tertiary)">No subscriptions yet.</td></tr>`;
      _setStats({ active: 0, expiring: 0, grace: 0, expired: 0 });
      _rows = [];
      return;
    }

    // Index states by sub_id so every raw row carries its effective tag.
    const stateBySub = new Map();
    states.forEach(s => stateBySub.set(s.sub_id, s));

    _rows = rawRes.data.map(r => ({
      ...r,
      effective: stateBySub.get(r.id) || null,
    }));

    _render();
    _recalcStats();
  }

  function _filteredRows() {
    if (_filter === 'all') return _rows;
    return _rows.filter(r => (r.effective?.effective_status || 'none') === _filter);
  }

  function _render() {
    const tbody = document.getElementById('subs-tbody');
    if (!tbody) return;
    const rows = _filteredRows();
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-tertiary)">No subscriptions match this filter.</td></tr>`;
      return;
    }

    const today = new Date();
    tbody.innerHTML = rows.map(s => {
      const clientName = s.profiles?.full_name || s.profiles?.email || '–';
      const endDate    = new Date(s.end_date);
      const startDate  = new Date(s.start_date);
      const eff        = s.effective?.effective_status || 'none';
      const isPending  = eff === 'pending';
      const isGrace    = eff === 'grace';
      const isExpired  = eff === 'expired';
      const isActive   = eff === 'active';

      const totalDays = Math.max(1, (endDate - startDate) / 86400000);
      const daysDone  = Math.max(0, (today - startDate) / 86400000);
      const pct       = Math.min(100, Math.round((daysDone / totalDays) * 100));
      const daysLeft  = Math.max(0, Math.round((endDate - today) / 86400000));
      const graceLeft = s.effective?.grace_days_left ?? 0;

      const statusBadge = isExpired
        ? `<span class="badge badge-expired">Expired</span>`
        : isGrace
        ? `<span class="badge" style="background:rgba(244,63,94,0.12);color:#f43f5e;border:1px solid rgba(244,63,94,0.3)">Grace · ${graceLeft}d</span>`
        : isPending
        ? `<span class="badge badge-pending">Pending</span>`
        : (daysLeft <= 7 && isActive)
        ? `<span class="badge badge-pending badge-dot">Expiring · ${daysLeft}d</span>`
        : `<span class="badge badge-active badge-dot">Active · ${daysLeft}d</span>`;

      const progressColor = (isExpired || isGrace) ? 'danger'
        : (daysLeft <= 7 && isActive) ? 'danger' : '';

      const reactivateBtn = (isExpired || isGrace)
        ? `<button class="btn btn-teal btn-xs" onclick="Subscriptions.reactivate('${_esc(s.client_id)}', ${parseInt(s.plan) || 3})">↺ Reactivate</button>`
        : '';

      return `
      <tr>
        <td>
          <div class="client-row-name">
            <div class="avatar avatar-sm">${(clientName || '?')[0].toUpperCase()}</div>
            <div class="client-row-info">
              <div class="name">${_esc(clientName)}</div>
            </div>
          </div>
        </td>
        <td style="font-weight:600">${s.plan} months</td>
        <td style="font-size:12px;color:var(--text-secondary)">${s.start_date}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${s.end_date}</td>
        <td>${statusBadge}</td>
        <td style="min-width:130px">
          <div class="sub-progress-label">
            <span>${pct}% used</span>
            <span>${daysLeft}d left</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${progressColor}" style="width:${pct}%"></div>
          </div>
        </td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${isPending ? `<button class="btn btn-teal btn-xs" onclick="Subscriptions.activate('${_esc(s.id)}','${_esc(s.client_id)}','${_esc(s.plan)}','${_esc(s.start_date)}','${_esc(s.end_date)}')">Activate</button>` : ''}
            ${reactivateBtn}
            <button class="btn btn-rose btn-xs" onclick="Subscriptions.remove('${s.id}')">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function _recalcStats() {
    let active = 0, expiring = 0, grace = 0, expired = 0;
    const today = new Date();
    const in7   = new Date(); in7.setDate(in7.getDate() + 7);

    _rows.forEach(r => {
      const eff = r.effective?.effective_status || 'none';
      if (eff === 'active') {
        active++;
        const end = new Date(r.end_date);
        if (end <= in7) expiring++;
      } else if (eff === 'grace')   grace++;
      else if (eff === 'expired')   expired++;
    });

    _setStats({ active, expiring, grace, expired });
  }

  function _setStats({ active, expiring, grace, expired }) {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('sub-stat-active',   active);
    set('sub-stat-expiring', expiring);
    set('sub-stat-grace',    grace);
    set('sub-stat-expired',  expired);
    // Mirror onto coach dashboard.
    set('stat-subs',     active);
    set('stat-expiring', expiring);
  }

  function _highlightFilter() {
    document.querySelectorAll('#subs-filter .subs-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === _filter);
    });
  }

  // ── Public actions ──────────────────────────────────────────────
  function setFilter(filter) {
    _filter = filter || 'all';
    _highlightFilter();
    _render();
  }

  async function submit() {
    const clientId = document.getElementById('sub-client')?.value;
    const plan     = document.getElementById('sub-plan')?.value;
    const start    = document.getElementById('sub-start')?.value;
    const end      = document.getElementById('sub-end')?.value;
    const activate = document.getElementById('sub-activate')?.value;
    const notes    = document.getElementById('sub-notes')?.value || '';

    if (!clientId || !start || !end) {
      Dashboard.toast('Please select a client and set dates', 'error'); return;
    }

    const btn = document.getElementById('sub-submit-btn');
    _setBtnLoading(btn);

    const { error } = await sb.from('subscriptions').insert({
      client_id:  clientId,
      plan:       parseInt(plan),
      start_date: start,
      end_date:   end,
      status:     activate === 'immediate' ? 'active' : 'pending',
      notes,
      created_by: Auth.getUser()?.id,
    }).select().single();

    _resetBtn(btn);

    if (error) { Dashboard.toast(error.message, 'error'); return; }

    if (activate === 'immediate') {
      await _sendEmail('subscription_activated', clientId, { plan, start, end });
    }

    Dashboard.toast('Subscription created!', 'success');
    Dashboard.closeModal('modal-add-subscription');
    document.getElementById('sub-notes').value = '';
    SubscriptionService?.clearCache?.(clientId);
    loadAll();
  }

  async function activate(subId, clientId, plan, start, end) {
    const { error } = await sb.from('subscriptions').update({ status: 'active' }).eq('id', subId);
    if (error) { Dashboard.toast(error.message, 'error'); return; }
    await _sendEmail('subscription_activated', clientId, { plan, start, end });
    Dashboard.toast('Subscription activated!', 'success');
    SubscriptionService?.clearCache?.(clientId);
    loadAll();
  }

  // Renewal delegated to SubscriptionService — single renewal path.
  async function reactivate(clientId, months = 3) {
    if (typeof SubscriptionService === 'undefined') {
      Dashboard.toast('SubscriptionService not loaded', 'error');
      return;
    }
    if (!confirm(`Reactivate this client for ${months} more month${months === 1 ? '' : 's'}?`)) return;
    try {
      await SubscriptionService.reactivate(clientId, { months });
      await _sendEmail('subscription_activated', clientId, {
        plan: months,
        start: new Date().toISOString().slice(0, 10),
      });
      Dashboard.toast('Subscription reactivated!', 'success');
      loadAll();
    } catch (e) {
      Dashboard.toast(e.message || 'Reactivation failed', 'error');
    }
  }

  async function remove(subId) {
    if (!confirm('Delete this subscription? This cannot be undone.')) return;
    await sb.from('subscriptions').delete().eq('id', subId);
    Dashboard.toast('Subscription deleted', 'info');
    SubscriptionService?.clearCache?.();
    loadAll();
  }

  // ── Helpers ─────────────────────────────────────────────────────
  async function _sendEmail(type, clientId, extra = {}) {
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ type, client_id: clientId, ...extra }),
      });
    } catch (e) { console.warn('Email send error:', e); }
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
  }
  function _setBtnLoading(btn) {
    if (!btn) return;
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner spinner-sm"></span>';
    btn.disabled = true;
  }
  function _resetBtn(btn) {
    if (!btn) return;
    btn.innerHTML = btn.dataset.orig || 'Create';
    btn.disabled = false;
  }

  // ── Wire filter UI on first render ──────────────────────────────
  function _wireFilter() {
    document.querySelectorAll('#subs-filter .subs-filter-btn').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });
    document.querySelectorAll('.stat-card[data-sub-filter]').forEach(card => {
      if (card.dataset.wired) return;
      card.dataset.wired = '1';
      card.addEventListener('click', () => setFilter(card.dataset.subFilter));
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wireFilter);
  } else { _wireFilter(); }

  return { loadAll, submit, activate, reactivate, remove, setFilter };

})();

window.Subscriptions = Subscriptions;
