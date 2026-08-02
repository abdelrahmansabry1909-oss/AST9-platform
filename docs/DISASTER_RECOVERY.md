# AST9 Disaster Recovery

> **NO BACKUPS EXIST — verified 2026-08-02.** The coverage checklist below has now
> been answered from the live platform. The Supabase organisation is on the
> **Free** plan, which has **no automated backups and no PITR**, and no scheduled
> export exists anywhere in this repository. There is currently **no recovery
> point for production data**, and the 69 migrations do not replay onto an empty
> database, so the repository cannot rebuild the schema either.
>
> No AST9 restore has ever been tested, because there is nothing to restore from.
> The RPO and RTO below remain proposals with no evidence behind them. Do not
> treat this document as evidence that a usable backup exists — it currently
> documents the opposite.

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

## Backup coverage — answered 2026-08-02

> ## ⚠ The production database has no backups of any kind.
>
> The Supabase organisation is on the **Free** plan. Per the
> [Database Backups guide](https://supabase.com/docs/guides/platform/backups),
> automated daily backups cover **"all Pro, Team, and Enterprise Plan projects"**
> — Free is not included, and the same page tells free-tier projects to
> *"regularly export their data … and maintain off-site backups."* No such export
> is scheduled anywhere in this repository.
>
> **There is currently no recovery point for production data. A destructive event
> means total, permanent loss of every client, coach, assessment, program and
> payment record.**

Answers below were gathered from the live platform, the repository, and the
Supabase documentation. Twelve of the thirteen questions no longer need the
owner; the residual questions are in the next section. No secret values, client
records, or credentials are reproduced here.

| # | Question | Answer (2026-08-02) |
|---|---|---|
| 1 | Which backup/export mechanisms are enabled today? | **None.** Free plan has no automated backups. No scheduled `db dump` exists in the repo or in any workflow. |
| 2 | What would a mechanism include? | N/A — none runs. A manual `supabase db dump` covers schemas and rows, and `auth` only if explicitly included. **Storage API objects are never in a database backup** (the DB holds only metadata). |
| 3 | What recovery points are visible, and when do they expire? | **Zero.** |
| 4 | Is PITR available and enabled? | **Not available.** PITR is a Pro/Team/Enterprise add-on (~$100/mo at 7-day retention). Not enabled; not purchasable on Free. |
| 5 | Can the mechanism restore to an isolated project? | No platform restore path exists at all. A manual dump could be restored to any project, isolated or not. |
| 6 | Where are restore instructions? | [Backup & restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) — CLI `db dump` / `psql` restore. Untested here. |
| 7 | Is there a recent off-platform encrypted copy? | **Owner-only — see residual questions.** Nothing automated produces one. |
| 8 | Are auth records included in a recoverable copy? | No copy exists. Any future dump must include the `auth` schema explicitly, or every login is lost while application rows survive — a partial restore that leaves orphaned `profiles` rows. |
| 9 | Are Vault values recoverable? | Two secrets exist (`cron_secret`, `ops_health_secret`). Values are **not readable and not recoverable** — if the project is lost they must be regenerated *and* re-synced to their consumers (pg_cron, and the `OPS_HEALTH_SECRET` GitHub secret). |
| 10 | Are Edge Function runtime secrets recorded elsewhere? | Eight names are referenced in code: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (platform-injected, regenerate automatically) and `RESEND_API_KEY`, `RESEND_FROM`, `FROM_EMAIL`, `GEMINI_API_KEY`, `ALLOWED_ORIGINS` (**owner-set; recorded nowhere in this repo** — see residual questions). |
| 11 | What protects the repository? | Public repo, default branch `main`, not archived, 0 forks. Branch protection on `main`: force-pushes **blocked**, deletion **blocked**, one required check (`Playwright smoke (Chromium)`), **no required reviews**, and `enforce_admins` **false** — so the owner can bypass all of it. Being public means the code survives as long as GitHub does; it also means nothing secret may ever be committed. |
| 12 | What Pages/Actions settings would need recreating? | Pages builds from a **workflow** (not a branch), source `main` `/`, HTTPS enforced, public. Actions secret `OPS_HEALTH_SECRET` must be re-created and matched to the Vault value. |
| 13 | Do the mechanisms meet the proposed 24h RPO / 8h RTO? | **No — by a wide margin.** With zero recovery points the effective RPO is *unbounded* (total loss), not 24 hours. RTO is undefined because there is nothing to restore from. |

### A second, independent gap: the schema cannot be rebuilt from the repository

Even with the full repository intact, the 69 migrations in `supabase/migrations/`
**do not replay onto an empty database.** Verified on 2026-08-02 against PR #172:
the Supabase Preview check fails at the first migration with
`ERROR: relation "profiles" does not exist (SQLSTATE 42P01)`, because early
migrations assume tables that were created outside the migration history and no
baseline migration exists. See
[MIGRATION_HISTORY_RECONCILIATION.md](MIGRATION_HISTORY_RECONCILIATION.md).

So the repository is **not** a recovery path for the database structure either.
Rebuilding today would mean reconstructing the schema by hand from a live
introspection that, in a real disaster, would no longer be available.

## Residual questions — genuinely owner-only

- [ ] Does any manual database export exist? If so: where is it held, who can
      reach it, is it encrypted, and when was it last restored to prove it works?
      Answer: ______
- [ ] Are the five owner-set Edge Function secrets (`RESEND_API_KEY`,
      `RESEND_FROM`, `FROM_EMAIL`, `GEMINI_API_KEY`, `ALLOWED_ORIGINS`) recorded
      in a password manager or other secured store outside Supabase? Answer: ______
- [ ] Are the two Vault secret **values** recorded outside the platform, or is
      regeneration-and-resync the accepted recovery path? Answer: ______
- [ ] **Decision required.** Choose one and record the date:
      (a) accept an unbounded RPO for now and state that explicitly;
      (b) upgrade to Pro (~$25/mo) for daily backups with 7-day retention;
      (c) add a scheduled off-platform `supabase db dump` (needs a secured
      destination and a restore test — untested exports are not backups).
      Answer: ______

Until (d) one of those is chosen and a drill is run, the RPO and RTO in the
previous section remain **proposals with no evidence behind them**, and the
honest public statement is that the service has no disaster recovery capability.

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
