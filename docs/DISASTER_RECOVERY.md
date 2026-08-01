# AST9 Disaster Recovery

> **UNVERIFIED — owner action required.** No AST9 restore has ever been tested.
> Current backup coverage, retention, recovery-point availability, and restore
> capability have not been verified. The RPO and RTO below are proposals awaiting
> owner approval, not current guarantees. Do not treat this document as evidence
> that a usable backup exists.

Use this runbook only after the owner has completed the coverage checklist and an
isolated staging project is available. Never perform the drill against production.
Keep secret values and client health data out of drill notes.

## Recovery inventory

"Repository-reproducible" means the repository contains definitions or source
from which an item can be rebuilt; it does not prove that the deployed platform
matches those files. "Platform-only" means the current value or state is not in
the repository. If a platform-only item is absent from the confirmed backup or a
separate secured record, this repository cannot recover it.

| Recovery item | Repository evidence / source | Recovery classification |
|---|---|---|
| Application data in Postgres | Table definitions are represented by `supabase/baseline/production_public_schema.sql` and ordered files under `supabase/migrations/`; row data is not committed. | Schema is repository-reproducible; current rows are platform-only. |
| RLS policies, database functions, and triggers | The baseline and migrations contain definitions and changes. | Repository-reproducible in principle; exact deployed state is platform-only until compared. |
| Auth users and identities | The application references Supabase Auth, but user and identity records are not committed. | Platform-only. Whether the confirmed recovery method includes them is an open question. |
| Supabase Vault secrets | Migrations and Edge Function source reference `cron_secret` and `ops_health_secret`; no secret values are committed. | Secret names/consumers are repository-reproducible; values are platform-only and must come from a separately confirmed secure source if a recovery does not include them. |
| Scheduled cron jobs | Migrations contain `cron.schedule` / `cron.alter_job` definitions for application jobs; live job state and run history are not committed. | Definitions are partly repository-reproducible; current schedule, active state, and history are platform-only. |
| Edge Functions and configuration | Function source is under `supabase/functions/`. Runtime secrets and current deployment settings are not committed. | Source is repository-reproducible; deployed version, runtime configuration, and secrets are platform-only. |
| GitHub Pages build | Frontend source, `vite.config.js`, `package.json`, and `.github/workflows/deploy.yml` define the build/deploy path; `dist/` is gitignored. | Build is repository-reproducible; the currently served artifact and Pages settings are platform state. |
| Repository state | Git history and tracked files provide the application and infrastructure definitions. | Reproducible from any intact complete clone; availability of the GitHub-hosted repository, branch protections, and other settings must be checked separately. |

## Proposed recovery objectives — awaiting owner approval

- **Proposed RPO: no more than 24 hours of data loss.** Clients log workouts and
  coaches publish programs, so losing a day could require re-entering activity and
  republishing recent changes. A shorter RPO would reduce that harm but requires
  more frequent, verified recovery points and may increase cost and operational
  work. A longer RPO accepts more client and coach rework.
- **Proposed RTO: service restored within 8 elapsed hours of declaring a disaster.**
  This aims to restore same-day access for a coaching/rehab workflow without
  claiming the current platform can meet it. A shorter RTO requires rehearsed
  automation, available operators, and verified restore performance; a longer RTO
  increases disruption to scheduled coaching and client logging.

The owner must approve or replace both values after verifying available recovery
features and completing a timed drill. Until then, there is no approved or
demonstrated RPO or RTO.

## Backup coverage checklist (owner)

Record evidence dates and dashboard/settings locations, but never copy secret
values, client records, credentials, project references, or recovery artifacts
into this document.

- [ ] Which database backup or export mechanisms are enabled today? Answer: ______
- [ ] What exactly does each mechanism include: application schemas and rows,
      `auth` users/identities, Vault, cron definitions/history, or other schemas?
      Answer: ______
- [ ] What recovery points are currently visible, and what are their creation and
      expiration times? Answer: ______
- [ ] Is point-in-time recovery available and enabled for this project? Answer: ______
- [ ] Can the available mechanism restore to an isolated project, or does it require
      a different import/restore path? Answer: ______
- [ ] Where are restore instructions for the mechanism that is actually available?
      Answer: ______
- [ ] Is there a recent off-platform encrypted database copy? Where is its custody,
      how is access controlled, and when was its integrity last checked? Answer: ______
- [ ] Are auth records included in a recoverable copy? Answer: ______
- [ ] Are Vault values recoverable, or is there a separate secured source from
      which the owner can re-enter them? Answer: ______
- [ ] Are Edge Function runtime secrets and deployment settings recorded in a
      separate secured source? Answer: ______
- [ ] In GitHub settings, what protects the repository itself (additional clone or
      mirror, access recovery, branch protection), and when was that protection
      checked? Answer: ______
- [ ] In GitHub Pages/Actions settings, which deployment source, permissions, and
      environment settings would have to be recreated? Answer: ______
- [ ] Do the verified mechanisms plausibly meet the proposed 24-hour RPO and
      8-hour RTO? Evidence/decision: ______

## Restore drill procedure — isolated staging only

**Blocker:** this drill cannot run until an isolated staging Supabase project is
available and the owner has confirmed a recovery method in the checklist above.
The procedure must not be adapted into an untested production restore during an
incident.

1. **Open a drill record.** Record the drill date, operator, chosen recovery point,
   confirmed recovery method, scope that method claims to include, and start time
   in UTC. Link to evidence without embedding sensitive values or client data.
2. **Prove isolation before any write.** In the dashboard, confirm the target is a
   staging project created for the drill. Compare its project reference with the
   production reference and record only `different: yes/no`, not either value.
   Confirm the target has no production custom domain, no production clients, no
   production webhooks, and no outbound scheduled jobs enabled. If the references
   match, isolation is uncertain, or any outbound integration could affect a real
   user, stop the drill.
3. **Protect the source.** Treat production and the selected recovery artifact as
   read-only. Do not run migrations, imports, or configuration changes against
   production. Record the artifact timestamp and the expected RPO represented by
   that timestamp.
4. **Restore the database into staging.** Follow only the owner-confirmed,
   dashboard-documented restore or import method recorded in step 1. Restore the
   schemas and data that the method actually supports; do not infer that `auth`,
   Vault, cron, or extension-owned objects are included. Capture warnings and
   completion status in the drill record. Immediately inspect and disable any
   cron jobs brought in by the restore before adding endpoints or secrets. If
   isolation cannot prevent a restored job from making an outbound call, stop and
   use a safer staging target.
5. **Reconcile repository-defined database objects.** From the exact Git commit
   selected for the drill, compare the staging schema with
   `supabase/baseline/production_public_schema.sql` plus subsequent ordered
   migrations. Apply missing migrations only to staging and record each one. Do
   not overwrite restored row data merely to make the schema look current.
6. **Recreate platform-only configuration deliberately.** Determine whether auth
   users/identities, Vault values, and cron jobs arrived in the restore. If auth
   records required by the drill are absent and no confirmed recovery source
   exists, mark the drill failed; do not invent replacement identities. Re-enter
   required secrets only from the owner's separately confirmed secure source.
   Keep all cron jobs disabled until verification is complete.
7. **Deploy Edge Functions to staging.** Deploy the function source from the same
   selected Git commit. Configure only staging endpoints and the required runtime
   secrets from the confirmed secure source. Do not copy values into the drill
   record and do not enable production-facing integrations.
8. **Build the frontend from the selected commit.** Run `npm ci`,
   `npm run test:unit`, and `npm run build`, and retain the gate results. Configure
   any staging deployment to address only the staging backend. Do not replace the
   production Pages deployment during the drill.
9. **Verify data quantitatively.** Before declaring success, record table row
   counts from the recovery source's manifest or other approved source and compare
   them with staging counts for every application table in scope. Record expected,
   observed, and delta without copying row contents. Any unexplained delta is a
   failed verification, not an assumed restore success.
10. **Verify security objects quantitatively.** Record and compare the expected
    and staging counts of enabled RLS tables, RLS policies, database functions,
    and non-internal triggers. Generate expected counts from the selected baseline
    plus migrations or from an approved source manifest; do not use current
    production as an unrecorded assumption. Investigate every mismatch.
11. **Run role-based access probes.** Using staging-only test identities for admin,
    coach, client, and anonymous access, verify at minimum: a client can read only
    their own permitted records; a coach can read only assigned-client permitted
    records; anonymous access cannot read protected health/program records; and
    prohibited writes fail. Use synthetic records only. Record pass/fail and the
    tested policy boundary, never tokens or returned health data.
12. **Verify application behavior.** With synthetic data, test sign-in, coach
    program publication, client program visibility, workout logging, and one safe
    Edge Function request. Confirm scheduled jobs remain disabled; inspect their
    definitions without firing production-facing calls.
13. **Measure observed RTO.** Stop the timer only after steps 9–12 pass. Record end
    time, elapsed time, operator-active time, failures/retries, and whether the
    proposed 8-hour RTO was met. This observed drill result is evidence for the
    owner to approve or revise the objective; it is not a future guarantee.
14. **Record outcome and gaps.** Mark the drill pass/fail. List omitted recovery
    items, mismatches, manual steps, missing sources, and follow-up owners. A
    partial restore is a failed full-recovery drill even if the frontend loads.
15. **Mandatory cleanup.** Disable all staging cron jobs and outbound integrations,
    revoke temporary staging credentials, remove any local recovery artifact using
    the approved secure disposal process, and delete the isolated staging project
    after evidence is captured and the owner confirms it is no longer needed.
    Record completion of each cleanup action without recording sensitive values.

## What this does not cover

- No restore has been tested, and this document does not establish recoverability.
- Backup presence, scope, retention, integrity, and recovery-point availability
  have not been verified.
- No off-platform copy has been verified.
- No isolated staging project or drill result is established by this document.
- Recovery depends on one owner-operator; no alternate operator, access escrow,
  or handoff has been verified.
- Provider-account recovery, DNS recovery, third-party service recovery, legal
  notification duties, and business-continuity communications need separate
  owner decisions.
