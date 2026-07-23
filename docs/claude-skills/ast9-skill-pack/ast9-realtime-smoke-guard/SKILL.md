---
name: ast9-realtime-smoke-guard
description: "AST9/NeuCore guard for realtime / no-refresh behavior and how to test it honestly. Use when working on community, messaging, notifications, appointments, Supabase realtime channels, subscriptions, sidebar badges, mark-read, inbox previews, or any 'updates without refresh' feature. Triggers: 'realtime', 'no refresh', 'live update', 'subscribeInbox', 'channel', 'badge', 'mark read', 'notification', 'supabase_realtime publication', 'it didn't update'. Encodes the false-negative where realtime was declared broken because the test never opened the subscribed thread. DO NOT USE for load/concurrency claims about 500 users (smoke != load) or auth routing (use ast9-auth-routing-guard)."
---

# AST9 — Realtime / No-Refresh Smoke Guard

Apply when building or testing anything that is supposed to update live. Parent: `AI_WORKFLOW_GUARDRAILS.md` §4 (browser smoke).

## The mistakes this prevents

- Realtime was once declared **broken** because the test sat on the landing/list view and never **opened the conversation thread** — so the per-thread channel was never subscribed. With the thread open, realtime worked. (Later a fix added an app-level inbox channel for the badge/preview, with care to avoid duplicate subscriptions; also note the `supabase_realtime` publication must include the table or nothing streams.)
- The lesson: **test the actual subscribed state**, and be explicit about *where* live updates are expected.

## Core invariants

1. Test the real **subscribed** state, not just the static landing/list state.
2. Be explicit about where realtime is expected: landing preview, sidebar badge, an open thread, or all of them — confirm which before judging pass/fail.
3. Avoid duplicate channels for the same resource.
4. Drop/replace an old channel before resubscribing.
5. Confirm RLS lets **only** intended participants receive the data.
6. Clean up any test messages/data created during the smoke.
7. An intentional 403/permission test counts as "expected" **only** when it is clearly scoped as such.
8. Never claim 500-user / high-concurrency readiness from a low-concurrency smoke.

## Anti-patterns — BLOCK these

- Concluding "realtime is broken" without opening the subscribed view (thread/channel) that drives the subscription.
- Opening two subscriptions to the same channel (duplicate events / leaks).
- Resubscribing without tearing down the previous channel.
- Forgetting the table in the `supabase_realtime` publication and then blaming the client code.
- Leaving test data/messages behind in a shared/live DB.
- Extrapolating a 2-tab smoke into a "handles 500 concurrent users" claim.

## Required tests

```
thread-open realtime (the subscribed view receives live events)
thread-closed / landing behavior (only if live preview is a stated feature)
sidebar badge behavior
mark-read behavior
no duplicate subscriptions (inspect channel count)
RLS participant isolation (a non-participant receives nothing)
console: zero errors / no unhandled rejections
test-data cleanup performed
production vs local environment stated explicitly
```

## Ownership classification

- Realtime data flow, channels, RLS participant scoping, publication config → **Codex** (backend/product); Claude audits and reviews.
- The visual rendering of badges/threads/empty states → **Antigravity**.

## Required honesty

- State the environment (local vs production) and the exact subscribed view that was open during the test.
- If you only verified one surface (e.g. open thread) and not another (e.g. sidebar badge), say which was and wasn't tested.
- Do not generalize concurrency/scale from a smoke; a 500-user claim requires an actual load test.
