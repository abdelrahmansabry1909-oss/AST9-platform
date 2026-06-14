// ═══════════════════════════════════════════════════════════════
//  js/packages.js
//  Coach package catalog — PRESENTATION source of truth (labels +
//  prices + the custom unit rate). The DB stores only the enforced
//  integer client_limit (see coach_subscriptions / coach_slot_status);
//  prices never live in the database.
//
//  Keep this in sync with the package_key CHECK constraint in
//  20260614000000_coach_packages_foundation.sql.
// ═══════════════════════════════════════════════════════════════
(() => {
  'use strict';

  const CUSTOM_UNIT = 0.65;   // $/client/month for the custom tier
  const CUSTOM_MIN  = 60;     // custom tier starts at 60 clients

  // Ordered for the upgrade grid. `limit:null` = unlimited/variable.
  const CATALOG = Object.freeze([
    { key: 'free',    label: 'Free',    limit: 1,    price: 0,    oldPrice: null, blurb: '1 client' },
    { key: 'starter', label: 'Starter', limit: 5,    price: 5,    oldPrice: 10,   blurb: '2–5 clients' },
    { key: 'growth',  label: 'Growth',  limit: 10,   price: 10,   oldPrice: 20,   blurb: 'Up to 10 clients' },
    { key: 'pro',     label: 'Pro',     limit: 20,   price: 20,   oldPrice: 35,   blurb: 'Up to 20 clients' },
    { key: 'scale',   label: 'Scale',   limit: 50,   price: 35,   oldPrice: 45,   blurb: 'Up to 50 clients' },
    { key: 'custom',  label: 'Custom',  limit: null, price: null, oldPrice: null, blurb: `${CUSTOM_MIN}+ clients · $${CUSTOM_UNIT}/client` },
  ].map(Object.freeze));

  const _byKey = Object.freeze(
    CATALOG.reduce((m, p) => { m[p.key] = p; return m; }, {})
  );

  function byKey(key)  { return _byKey[key] || null; }

  // 'admin' is an internal, non-purchasable tier (unlimited) returned by
  // coach_slot_status for admins — it is not in the purchasable catalog.
  function label(key)  { return key === 'admin' ? 'Admin' : (_byKey[key]?.label || key || '–'); }

  // Live custom price = qty × unit rate, rounded to cents.
  function customPrice(qty) {
    const n = Number(qty);
    if (!Number.isFinite(n) || n < 1) return 0;
    return Math.round(n * CUSTOM_UNIT * 100) / 100;
  }

  window.Packages = Object.freeze({
    CATALOG, CUSTOM_UNIT, CUSTOM_MIN,
    byKey, label, customPrice,
  });
})();
