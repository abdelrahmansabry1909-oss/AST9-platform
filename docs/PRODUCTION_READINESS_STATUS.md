# AST9 Production Readiness Status

> Baseline date: 2026-07-23. This is the durable status matrix for the
> "Production Reality" checklist. It records evidence, not aspirations. A green
> application build does not turn partial operational controls into completed
> production controls.

## Status definitions

- **Verified:** implemented with repository or production evidence.
- **Partial:** a real foundation exists, but a required production control or
  validation is missing.
- **Paused:** intentionally deferred by the owner.
- **Not started:** no production-grade implementation or approved operating
  process was found.

## Current baseline

- Production source: `origin/main` at `ccc287a`.
- Deployment: GitHub Pages; the deployment for this source revision succeeded.
- Backend: Supabase project `byquokhcbagofshsclfy` in `eu-central-1`.
- Repository inventory: 60 migration files, 14 rollback files, and 11 Edge
  Functions.
- Latest scheduled Ops Health Check reviewed on 2026-07-23: passed.
- Production dependency audit after the Phase 0 lock refresh:
  `npm audit --omit=dev` reports zero vulnerabilities.

## Production checklist

| Area | Status | Current evidence | What remains |
|---|---|---|---|
| Authentication | Verified | Email auth, role routing, owner-only admin controls, legal gate, inactive-subscription gate | Keep authenticated smoke credentials non-production and exercise the flows in CI |
| Payments | Paused | Provider-neutral event ledger and service-role period application | Paymob webhook/checkout phases, signature verification, replay tests, reconciliation |
| Billing logic | Partial | Packages, coach slots, monthly/annual periods, manual fallback | Complete provider integration and failure/refund/reconciliation operations |
| Subscription states | Verified with known gap | Server-derived state, grace handling, custom subscriptions, RPC authorization | Add an explicit `cancelled` view branch before any cancel feature |
| CRUD logic | Verified for shipped Rehab workflows | RLS-backed assessments, programs, workouts, appointments, library, community | Continue per-feature role matrix tests |
| Access control | Verified for shipped scope | RLS, SECURITY DEFINER authorization, assigned-coach isolation, owner-only admin | Re-run role matrices for every new table/RPC |
| Data integrity | Partial | Constraints, FKs, append-only legal acceptance, idempotent payment-event key | Reconcile historical migration registry drift and add restore validation |
| Scalability | Partial | Real staged load test reached 500 VUs without observed 5xx/429 | p95 was about 20 s at 500 VUs; establish paid-tier baseline and SLO |
| Latency optimization | Partial | Load-test bottleneck is measured | Profile slow queries/functions and set regression thresholds |
| Load balancing | Not started | Supabase/Pages provider-managed distribution only | Define capacity architecture only when measured demand requires it |
| Logging | Partial | Supabase logs, frontend errors-only Sentry, ops snapshot | Centralize correlation and add backend/Edge error monitoring |
| Alerting | Partial | Scheduled Ops Health Check and Recovery Pulse alerts | Define owner paging thresholds and escalation ownership |
| Incident response | Verified foundation | Incident playbook, runbook, rollback guidance, Sentry kill switch | Run a tabletop incident and record evidence |
| Disaster recovery | Partial | Rollback scripts and provider backups exist as foundations | Approve RTO/RPO and perform a restore drill |
| Data retention | Not started | No approved platform-wide schedule found | Define retention, deletion, export, backup, and audit-log rules |
| GDPR/CCPA | Not started as compliance | Versioned legal records and privacy-safe Sentry foundation only | Lawyer/privacy review, data-subject workflows, retention policy; make no compliance claim |
| Rate limiting | Partial | Best-effort per-instance limits on sensitive Edge Functions | Add durable distributed controls for abuse-sensitive endpoints |
| CI/CD | Verified foundation | PR Playwright smoke, main deploy workflow, scheduled ops health | Make authenticated smoke consistently runnable; add dependency audit gate |
| Environments | Partial | Production plus local/preview workflows | Establish seeded non-production staging with no real user data |
| Rollbacks | Partial | 14 rollback files, Git deploy rollback process | Close migration rollback coverage and test restore paths |
| Feature flags | Not started | Sentry DSN kill switch is feature-specific | Add authorization-safe runtime flags only for justified risky features |
| Test coverage | Partial | Public Playwright smoke and Node unit tests exist | Expand backend/RLS contracts and authenticated critical journeys |
| Instrumentation | Partial | Sentry errors and operational health telemetry | Add product event schema, latency traces, and release dashboards |
| Conversion | Not started | No production funnel instrumentation found | Define funnel only after legal/privacy event rules |
| Retention | Partial | Recovery Pulse/churn-risk operational signals | Define product retention metrics and validate interventions |
| Churn control | Partial | Needs-Attention and pulse alerts | Add measured workflows and outcome reporting |
| Cloud costs | Not started | No budget/alert evidence found | Add provider budgets, cost owner, and monthly review |
| Multi-region support | Not started | Single Supabase region | Defer until SLO/data-residency demand justifies it |
| Idempotency | Partial | Payment event uniqueness and selected idempotent jobs/RPCs | Apply explicit keys to every retryable external side effect |
| Support ops | Not started | No formal support queue/SLA found | Define intake, severity, ownership, and response targets |
| Escalations | Partial | Technical incident severity model exists | Add customer/support and billing escalation paths |
| Governance | Partial | Decision logs and owner-only admin model | Add access review cadence, change approvals, and audit ownership |
| Platform support | Not started | No browser/device support policy found | Define supported versions and a regression matrix |
| Adtech | Not started / not required | No ad platform integration found | Keep out until there is an approved business and privacy case |
| Cookies | Partial | Cookie policy page and legal version registry | Verify runtime cookie/storage inventory and consent requirements with counsel |
| Secrets management | Partial | GitHub/Supabase secret stores and revocable monitoring keys | Document rotation cadence and remove any reliance on local recovered credentials |
| Documentation | Partial but active | Control docs, runbook, issue/decision/dev logs | Keep current facts synchronized at each major phase |
| A/B testing | Not started | No experiment framework found | Defer until instrumentation and privacy rules are approved |
| Vendor lock-in | Accepted risk | Supabase, GitHub Pages, Sentry, and future Paymob dependencies | Document export/exit paths for critical data and auth |

## Ordered continuation plan

1. **Phase 0 — Baseline hardening (current):** dependency advisory, truthful
   documentation, role ownership, and verification evidence.
2. **Phase 1 — Critical test gate:** make public smoke stable on clean `main`, add
   dependable authenticated staging smoke, and add backend/RLS contract tests.
3. **Phase 2 — Reliability operations:** distributed rate limiting for sensitive
   Edge Functions, Edge error monitoring, incident tabletop, restore drill, and
   approved RTO/RPO.
4. **Phase 3 — Privacy and data lifecycle:** lawyer review, retention/deletion/
   export procedures, cookie/storage inventory, and no unsupported compliance
   claims.
5. **Phase 4 — Performance:** paid-tier staging baseline, query profiling, SLOs,
   and CI regression thresholds.
6. **Phase 5 — Paymob:** resume only when the owner supplies the provider account
   and explicitly approves the payment architecture. Webhooks remain
   authoritative and idempotent.
7. **Phase 6 — Product operations:** product instrumentation, conversion and
   retention metrics, support/escalation process, cost budgets, and justified
   feature flags.
