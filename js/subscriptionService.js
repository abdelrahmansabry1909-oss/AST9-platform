/* ═══════════════════════════════════════════════════════════════
   NeuCore — Subscription Service
   Single source of truth for "what is this client's subscription
   state right now, and what may they do?"

   Reads `public.v_client_subscription_state` (defined in
   20260530_subscription_grace.sql), exposes a tiny synchronous
   surface over the cached state, and owns the only renewal path.

   Consumed by:
     • js/auth.js              — gates login, caches state on profile
     • js/clientDashboard.js   — renders pill + grace banner
     • js/subscriptions.js     — coach stats, filter, Reactivate
     • future js/workout*.js   — write-gate via canWrite()

   Architecture rule (locked):
     effective_status === 'active' || 'grace'  → write access
     effective_status === 'expired' || 'none'  → view only, login blocked
     effective_status === 'pending'            → no write, no client login
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ── State cache (one effective row per client; keyed by id) ─────
  const _cache = new Map();        // client_id → state object
  let   _lastFetchAt = 0;

  // ── Constants ───────────────────────────────────────────────────
  const STATUSES = Object.freeze(['active', 'grace', 'expired', 'pending', 'none']);

  // ── Internal: SQL → state object ────────────────────────────────
  function _normalize(row) {
    if (!row) return { effective_status: 'none', sub_id: null };
    return {
      effective_status: row.effective_status || 'none',
      sub_id:           row.sub_id,
      plan:             row.plan,
      start_date:       row.start_date,
      end_date:         row.end_date,
      status:           row.status,
      grace_days:       row.grace_days ?? 7,
      grace_until:      row.grace_until,
      days_remaining:   row.days_remaining ?? null,
      grace_days_left:  row.grace_days_left ?? 0,
      notes:            row.notes || null,
    };
  }

  // ── Fetch effective state for a single client ───────────────────
  // Returns the cached value within 30s unless force=true.
  async function getEffectiveState(clientId, { force = false } = {}) {
    if (!clientId || typeof sb === 'undefined') {
      return _normalize(null);
    }
    const cached = _cache.get(clientId);
    const fresh  = cached && (Date.now() - _lastFetchAt < 30_000);
    if (cached && fresh && !force) return cached;

    try {
      const { data, error } = await sb
        .from('v_client_subscription_state')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
      if (error) {
        console.warn('[SubscriptionService] view read failed:', error.message);
        // Fail-soft: a read error is NOT a real "no subscription". Returning
        // 'none' here would gate + bounce a valid client on a flaky network.
        return { effective_status: 'unknown', error: true };
      }
      const state = _normalize(data);
      _cache.set(clientId, state);
      _lastFetchAt = Date.now();
      return state;
    } catch (e) {
      console.warn('[SubscriptionService] view read threw:', e.message);
      // Fail-soft (see above): transient failure → 'unknown', never 'none'.
      return { effective_status: 'unknown', error: true };
    }
  }

  // ── Bulk read for the coach Subscriptions page ──────────────────
  async function listAllStates() {
    if (typeof sb === 'undefined') return [];
    const { data, error } = await sb
      .from('v_client_subscription_state')
      .select('*');
    if (error) {
      console.warn('[SubscriptionService] list failed:', error.message);
      return [];
    }
    const rows = (data || []).map(_normalize);
    // Warm cache while we're here.
    rows.forEach(r => { if (r.sub_id) _cache.set(r.client_id ?? r.sub_id, r); });
    return rows;
  }

  // ── Write-gate primitive used everywhere ────────────────────────
  // active + grace → writes allowed. Everything else read-only.
  function canWrite(state) {
    const s = state?.effective_status || 'none';
    return s === 'active' || s === 'grace';
  }

  // ── Pill / banner copy + tone (UI helper) ───────────────────────
  // tone ∈ teal | amber | rose | gray
  function formatPill(state) {
    const s = state?.effective_status || 'none';
    if (s === 'active') {
      const d = state.days_remaining ?? 0;
      if (d > 14) return { label: `Active · ${d} days left`,  tone: 'teal'  };
      if (d > 0)  return { label: `Active · ${d} days left`,  tone: 'amber' };
      return        { label: 'Active · ends today',           tone: 'amber' };
    }
    if (s === 'grace') {
      const g = state.grace_days_left ?? 0;
      return { label: `Grace · ${g} day${g === 1 ? '' : 's'} to renew`, tone: 'rose' };
    }
    if (s === 'pending') return { label: 'Pending activation',   tone: 'amber' };
    if (s === 'expired') return { label: 'Subscription expired', tone: 'rose'  };
    if (s === 'unknown') return { label: 'Checking subscription…', tone: 'gray' };
    return                       { label: 'No subscription',     tone: 'gray'  };
  }

  // ── Reactivate / extend — coach + admin only ────────────────────
  // Delegates to the SECURITY DEFINER reactivate_subscription() RPC
  // so the permission check (assigned_coach OR admin) lives in SQL.
  async function reactivate(clientId, { months = 3, startDate = null, notes = null } = {}) {
    if (!clientId) throw new Error('clientId required');
    if (!Number.isInteger(months) || months < 1 || months > 60) {
      throw new Error('Months must be a whole number between 1 and 60');
    }
    const { data, error } = await sb.rpc('reactivate_subscription', {
      p_client_id: clientId,
      p_months:    months,
      p_start:     startDate,
      p_notes:     notes,
    });
    if (error) throw new Error(error.message || 'Reactivation failed');
    // Invalidate cache so subsequent reads pick up the new row.
    _cache.delete(clientId);
    return data;                       // new subscription id
  }

  // ── Create a client access subscription — admin + assigned coach ──
  // Delegates to the SECURITY DEFINER create_client_subscription() RPC so
  // the permission check (assigned_coach OR admin) lives in SQL, not the UI.
  async function createSubscription({
    clientId, planName = null, months, startDate = null,
    endDate = null, status = 'active', notes = null,
  } = {}) {
    if (!clientId) throw new Error('clientId required');
    if (!Number.isInteger(months) || months < 1 || months > 60) {
      throw new Error('Months must be a whole number between 1 and 60');
    }
    const { data, error } = await sb.rpc('create_client_subscription', {
      p_client_id: clientId,
      p_plan_name: planName,
      p_months:    months,
      p_start:     startDate,
      p_end:       endDate,
      p_status:    status,
      p_notes:     notes,
    });
    if (error) throw new Error(error.message || 'Could not create subscription');
    _cache.delete(clientId);
    return data;                       // new subscription id
  }

  // ── Edit a client access subscription — admin + assigned coach ────
  // Delegates to update_client_subscription() (same SQL authz check).
  async function updateSubscription({
    subId, planName = null, months, startDate, endDate,
    status, notes = null, graceDays = null,
  } = {}) {
    if (!subId) throw new Error('subId required');
    if (!Number.isInteger(months) || months < 1 || months > 60) {
      throw new Error('Months must be a whole number between 1 and 60');
    }
    const { data, error } = await sb.rpc('update_client_subscription', {
      p_subscription_id: subId,
      p_plan_name:       planName,
      p_months:          months,
      p_start:           startDate,
      p_end:             endDate,
      p_status:          status,
      p_notes:           notes,
      p_grace_days:      graceDays,
    });
    if (error) throw new Error(error.message || 'Could not update subscription');
    // A client id isn't passed here; clear all cached state to be safe.
    _cache.clear();
    return data;                       // subscription id
  }

  // ── Filter helper for coach dashboard ───────────────────────────
  // filter ∈ 'all' | effective_status value
  function filterRows(rows, filter) {
    if (!Array.isArray(rows)) return [];
    if (!filter || filter === 'all') return rows;
    return rows.filter(r => (r.effective_status || 'none') === filter);
  }

  // ── Cache management ────────────────────────────────────────────
  function clearCache(clientId)  { clientId ? _cache.delete(clientId) : _cache.clear(); }
  function peekCache(clientId)   { return _cache.get(clientId) || null; }

  window.SubscriptionService = {
    getEffectiveState, listAllStates,
    canWrite, formatPill, reactivate, filterRows,
    createSubscription, updateSubscription,
    clearCache, peekCache,
    STATUSES,
  };
})();
