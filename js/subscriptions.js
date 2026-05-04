// ═══════════════════════════════════════════════════════════════
//  js/subscriptions.js
//  Handles: subscription list rendering, create, activate, delete,
//           stat counters, expiry email trigger.
// ═══════════════════════════════════════════════════════════════

const Subscriptions = (() => {

  async function loadAll() {
    const tbody = document.getElementById('subs-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px"><span class="spinner spinner-lg"></span></td></tr>`;

    const { data, error } = await sb
      .from('subscriptions')
      .select('*, profiles!subscriptions_client_id_fkey(full_name, email)')
      .order('created_at', { ascending: false });

    if (error || !data?.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-tertiary)">No subscriptions yet.</td></tr>`;
      _setStats(0, 0, 0);
      return;
    }

    const today = new Date();
    const in7   = new Date(); in7.setDate(in7.getDate() + 7);
    let active = 0, expiring = 0, expired = 0;

    tbody.innerHTML = data.map(s => {
      const clientName = s.profiles?.full_name || s.profiles?.email || '–';
      const endDate    = new Date(s.end_date);
      const startDate  = new Date(s.start_date);
      const isActive   = s.status === 'active' && endDate >= today;
      const isExpiring = isActive && endDate <= in7;
      const isExpired  = endDate < today || s.status === 'expired';
      const isPending  = s.status === 'pending';

      if (isExpired || s.status === 'expired') expired++;
      else if (isExpiring) { expiring++; active++; }
      else if (isActive) active++;

      const totalDays = Math.max(1, (endDate - startDate) / 86400000);
      const daysDone  = Math.max(0, (today - startDate) / 86400000);
      const pct       = Math.min(100, Math.round((daysDone / totalDays) * 100));
      const daysLeft  = Math.max(0, Math.round((endDate - today) / 86400000));

      const statusBadge = isExpired || s.status === 'expired'
        ? `<span class="badge badge-expired">Expired</span>`
        : isPending
        ? `<span class="badge badge-pending">Pending</span>`
        : isExpiring
        ? `<span class="badge badge-pending badge-dot">Expiring</span>`
        : `<span class="badge badge-active badge-dot">Active</span>`;

      const progressColor = isExpired ? 'danger' : isExpiring ? 'danger' : '';

      return `
      <tr>
        <td>
          <div class="client-row-name">
            <div class="avatar avatar-sm">${clientName[0].toUpperCase()}</div>
            <div class="client-row-info">
              <div class="name">${clientName}</div>
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
          <div style="display:flex;gap:6px">
            ${isPending ? `<button class="btn btn-teal btn-xs" onclick="Subscriptions.activate('${s.id}','${s.client_id}','${s.plan}','${s.start_date}','${s.end_date}')">Activate</button>` : ''}
            <button class="btn btn-rose btn-xs" onclick="Subscriptions.remove('${s.id}')">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    _setStats(active, expiring, expired);
  }

  function _setStats(active, expiring, expired) {
    const s = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
    s('sub-stat-active', active);
    s('sub-stat-expiring', expiring);
    s('sub-stat-expired', expired);
    // Also update dashboard stat
    const dashSub = document.getElementById('stat-subs');
    if (dashSub) dashSub.textContent = active;
    const dashExp = document.getElementById('stat-expiring');
    if (dashExp) dashExp.textContent = expiring;
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

    const { data, error } = await sb.from('subscriptions').insert({
      client_id: clientId,
      plan: parseInt(plan),
      start_date: start,
      end_date: end,
      status: activate === 'immediate' ? 'active' : 'pending',
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
    loadAll();
  }

  async function activate(subId, clientId, plan, start, end) {
    const { error } = await sb.from('subscriptions').update({ status: 'active' }).eq('id', subId);
    if (error) { Dashboard.toast(error.message, 'error'); return; }
    await _sendEmail('subscription_activated', clientId, { plan, start, end });
    Dashboard.toast('Subscription activated!', 'success');
    loadAll();
  }

  async function remove(subId) {
    if (!confirm('Delete this subscription? This cannot be undone.')) return;
    await sb.from('subscriptions').delete().eq('id', subId);
    Dashboard.toast('Subscription deleted', 'info');
    loadAll();
  }

  async function _sendEmail(type, clientId, extra = {}) {
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ type, client_id: clientId, ...extra })
      });
    } catch(e) { console.warn('Email send error:', e); }
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

  return { loadAll, submit, activate, remove };

})();

window.Subscriptions = Subscriptions;
