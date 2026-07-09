---
name: ast9-payments-webhook-guard
description: "AST9/NeuCore guard for ALL payments, billing activation, and provider-webhook work (Paymob primary; provider-neutral). Use BEFORE writing or reviewing checkout flows, webhook handlers, subscription/access activation, HMAC verification, or the payment_events ledger. Triggers: 'Paymob', 'Stripe', 'payment', 'checkout', 'webhook', 'HMAC', 'intention', 'billing', 'activate subscription', 'grant access', 'payment_events', 'provider', 'refund', 'currency'. Enforces webhook-authoritative activation, signature verification before trust, server-side price resolution, idempotency, secrets-out-of-repo, and PCI-safe scrubbing. DO NOT USE for non-payment DB schema/RLS in general (use ast9-supabase-backend-guard) or auth login routing (use ast9-auth-routing-guard)."
---

# AST9 — Payments & Webhook Security Guard

Apply to any payments/billing/activation code. Provider decision: **Paymob** (Stripe is
unavailable in Egypt), kept **provider-neutral** (`provider` = `manual|paymob|stripe`).
Foundation already live: `payment_events` idempotency ledger + `coach_subscriptions`
provider columns + `apply_paid_coach_package_period_system` (service-role-only RPC),
migration `20260702000000_provider_neutral_payments_foundation.sql`. Parent:
`AI_WORKFLOW_GUARDRAILS.md` §8; audit "Payments" lane. Pairs with
`ast9-supabase-backend-guard` for the DB side.

## The mistakes this prevents

- **Granting paid access from a client-side "success" redirect** — trivially spoofable by
  editing the URL. Access must flip **only** on a verified server signal.
- **Processing an unverified webhook payload** (no/failed signature check) → forged payments.
- **Trusting client-supplied amount/currency/plan** → price tampering (pay 1 EGP, get the annual plan).
- **Replay / double-processing** a retried webhook → double-applied periods or double credit.
- **Leaking the HMAC secret / API keys** into the repo, logs, or chat.
- **Storing card data** (PAN) or raw customer PII in the ledger.
- **Float money bugs** — rounding drift on amounts stored as floats.

## Core invariants

1. **Webhook-authoritative.** The subscription/access state changes **only** when a
   server-verified webhook (or a server-side confirmed intention) says paid. The browser
   redirect is a UX hint, never the source of truth.
2. **Verify signature before trusting anything.** Paymob: compute **HMAC-SHA512** over the
   exact ordered field list and compare (constant-time) to the `hmac` param; **reject on
   mismatch** before any DB write. No signature → no processing.
3. **Resolve price server-side.** Never read amount/currency/plan/limits from the client or
   the redirect. Look up the canonical package price + client limit by package id on the server.
4. **Idempotent by construction.** Every provider event carries a unique id →
   `payment_events` has `UNIQUE(provider, provider_event_id)`; **insert the event first**
   with `ON CONFLICT DO NOTHING`; if it short-circuits, the webhook is a duplicate → no-op.
   The apply-period RPC is **service-role-only** (called by the edge fn, never by a browser).
5. **Provider-neutral.** No provider name hardcoded in shared logic; branch on `provider`.
   Keep the `manual` path working. Record the Stripe-in-Egypt limitation as the reason Paymob is primary.
6. **Secrets live in Vault / Edge secrets — never the repo.** The HMAC secret and API keys
   are read from the edge function's environment only. **Do not** read, print, echo, log, or
   paste any secret; do not inspect `.env`/Vault/GitHub secrets. Ask the owner to store keys
   themselves.
7. **PCI-safe data.** `payment_events` stores a **scrubbed_summary jsonb only** — no PAN, no
   CVV, no full customer PII. Never touch or persist card numbers.
8. **Money is integer minor units** (piastres/cents) with an ISO-4217 currency
   (`^[A-Z]{3}$`). No floats. Refunds/partials reconcile against the ledger, not a recomputed guess.
9. **RLS on payment tables.** Admin-select only; **no client write policy**; the webhook
   writes via `service_role` exclusively. (Delegate the SQL specifics to
   `ast9-supabase-backend-guard`.)

## Required report after payments work

State: is activation webhook-authoritative (y/n); is the signature verified before any
write (which algorithm/fields); is amount/plan resolved server-side; is processing
idempotent (ledger-first, unique event id); where the secret comes from (Vault/env — **not**
repo, and confirm none was printed); RLS on any touched payment table; and whether a live
provider call was actually exercised or only mocked (label honestly).

## Self-check before delivery

- [ ] Access flips only on a server-verified signal — never a client redirect?
- [ ] Signature (HMAC-SHA512) verified and mismatches rejected before any DB write?
- [ ] Amount/currency/plan resolved server-side from the package id, never the client?
- [ ] Duplicate webhook is a no-op (event inserted first, `ON CONFLICT DO NOTHING`)?
- [ ] Apply RPC is service-role-only; browser cannot call it?
- [ ] No secret read/printed/committed; keys come from Vault/env?
- [ ] No card data stored; ledger holds scrubbed summary only; money is integer minor units?
- [ ] Provider-neutral (no hardcoded provider in shared logic); `manual` path intact?

If any box is unchecked, fix before shipping.
