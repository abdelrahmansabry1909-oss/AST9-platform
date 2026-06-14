// ═══════════════════════════════════════════════════════════════
//  js/packages.js
//  Coach package catalog — PRESENTATION source of truth (labels +
//  monthly/annual prices + the custom unit rate). The DB stores only
//  the enforced integer client_limit (see coach_subscriptions /
//  coach_slot_status); prices never live in the database.
//
//  Annual model: pay for 10 months, get 12 (2 months free) → annual
//  price = monthly × 10. Old/reference prices follow the same rule.
//
//  Keep package keys in sync with the CHECK constraint in
//  20260614000000_coach_packages_foundation.sql.
// ═══════════════════════════════════════════════════════════════
(() => {
  'use strict';

  const ANNUAL_MONTHS       = 10;     // pay 10 months, get 12 (2 free)
  const CUSTOM_UNIT_MONTHLY = 0.65;   // $/client/month for the custom tier
  const CUSTOM_UNIT_ANNUAL  = CUSTOM_UNIT_MONTHLY * ANNUAL_MONTHS; // 6.50
  const CUSTOM_MIN          = 60;     // custom tier starts at 60 clients

  // Ordered for the upgrade grid. `limit:null` = unlimited/variable.
  // Each tier carries both monthly and annual { price, old } blocks.
  const CATALOG = Object.freeze([
    { key: 'free',    label: 'Free',    limit: 1,    monthly: { price: 0,    old: null }, annual: { price: 0,    old: null }, blurb: '1 client' },
    { key: 'starter', label: 'Starter', limit: 5,    monthly: { price: 5,    old: 10   }, annual: { price: 50,   old: 100  }, blurb: '2–5 clients' },
    { key: 'growth',  label: 'Growth',  limit: 10,   monthly: { price: 10,   old: 20   }, annual: { price: 100,  old: 200  }, blurb: 'Up to 10 clients' },
    { key: 'pro',     label: 'Pro',     limit: 20,   monthly: { price: 20,   old: 35   }, annual: { price: 200,  old: 350  }, blurb: 'Up to 20 clients' },
    { key: 'scale',   label: 'Scale',   limit: 50,   monthly: { price: 35,   old: 45   }, annual: { price: 350,  old: 450  }, blurb: 'Up to 50 clients' },
    { key: 'custom',  label: 'Custom',  limit: null, monthly: { price: null, old: null }, annual: { price: null, old: null }, blurb: `${CUSTOM_MIN}+ clients` },
  ].map((p) => Object.freeze({ ...p, monthly: Object.freeze(p.monthly), annual: Object.freeze(p.annual) })));

  const _byKey = Object.freeze(
    CATALOG.reduce((m, p) => { m[p.key] = p; return m; }, {})
  );

  function byKey(key) { return _byKey[key] || null; }

  // 'admin' is an internal, non-purchasable tier (unlimited) returned by
  // coach_slot_status for admins — not part of the purchasable catalog.
  function label(key) { return key === 'admin' ? 'Admin' : (_byKey[key]?.label || key || '–'); }

  // Per-client unit rate for the selected interval.
  function customUnit(interval) {
    return interval === 'annual' ? CUSTOM_UNIT_ANNUAL : CUSTOM_UNIT_MONTHLY;
  }

  // Live custom price = qty × unit rate for the interval, rounded to cents.
  function customPrice(qty, interval) {
    const n = Number(qty);
    if (!Number.isFinite(n) || n < 1) return 0;
    return Math.round(n * customUnit(interval) * 100) / 100;
  }

  window.Packages = Object.freeze({
    CATALOG, ANNUAL_MONTHS, CUSTOM_UNIT_MONTHLY, CUSTOM_UNIT_ANNUAL, CUSTOM_MIN,
    byKey, label, customUnit, customPrice,
  });
})();
