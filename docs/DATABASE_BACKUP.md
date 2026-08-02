# AST9 Local Database Backup

The Supabase organisation is on the **Free** plan: no automated backups, no PITR.
See [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md). Until that changes, the only
recovery point for production data is whatever this script writes to a disk the
owner controls.

`scripts/db-backup.mjs` takes a verified, dated, off-platform dump of the
production database. It is **decision (c)** from the disaster-recovery document:
a self-managed export. It is not equivalent to a platform backup, and it does not
become a backup until a restore has actually been performed.

---

## What it produces

Each run writes one dated directory:

```
<destination>/
  ast9-backup-20260802T030000Z/
    roles.sql        cluster roles (no passwords — pg_dumpall --no-role-passwords)
    schema.sql       tables, RLS policies, functions, triggers, views
    data.sql         row data, including auth.users
    manifest.json    sizes, SHA-256 per file, CLI version, repo commit, exclusions
  backup-status.json last attempt, last success, consecutive failures, last error
```

A run that cannot verify its own output **deletes its partial directory** and
exits non-zero. Only a complete, verified backup ever gets an `ast9-backup-` name,
so anything with that prefix passed its integrity checks.

### What is included

Row data for every application schema, **plus `auth`** — so `auth.users` and the
identities behind every login are captured. This is verified on each run: the
script refuses to keep a `data.sql` that does not contain `"auth"."users"`, and
refuses a `schema.sql` that does not contain `"public"."profiles"`.

### What is NOT included

Restated in every `manifest.json` so a future operator cannot assume otherwise:

- **Supabase Vault secret values** — the `vault` schema is excluded from the dump.
  `cron_secret` and `ops_health_secret` must be regenerated and re-synced to their
  consumers (pg_cron, and the `OPS_HEALTH_SECRET` GitHub Actions secret).
- **Storage API objects** — the database holds only their metadata.
- **Edge Function deployment state and runtime secrets** (`RESEND_API_KEY`,
  `RESEND_FROM`, `FROM_EMAIL`, `GEMINI_API_KEY`, `ALLOWED_ORIGINS`).
- **Auth signing keys and project API keys.**
- **`supabase_migrations` history and `auth.schema_migrations`** — the platform
  manages these; a restored project rebuilds them.

---

## Prerequisites

1. **Docker Desktop must be running.** `supabase db dump` executes `pg_dump`
   inside a `supabase/postgres` container; it does not use a local `pg_dump`.
   Set Docker Desktop to start on login, or the scheduled run fails.
2. **The repository must be linked** (`supabase/.temp/project-ref` present). If
   not: `npx supabase link` once, interactively.
3. `npm ci` has been run, so `node_modules/supabase` exists.

The script pre-flights all three and fails with the specific fix.

## No credential passes through this script

`supabase db dump --linked` mints its own short-lived Postgres login role from the
CLI token in Windows Credential Manager. There is **no database password** in the
environment, on the command line, in the output, or in any file this script
writes. `--db-url`, `--password`, and `--dry-run` are never used, and a unit test
fails the build if any of them is reintroduced.

> ### ⚠ Never run `supabase db dump --dry-run`
>
> Observed 2026-08-02: `--dry-run` prints the minted role's **host, username, and
> password** to stdout as `export PG… ` shell lines. Anything that captures that
> output — a terminal transcript, a CI log, an AI agent's context — captures a
> live database credential. This is why the script never invokes that mode and
> redacts both the `export PGPASSWORD="…"` and the `postgres://user:pass@host`
> shapes from any child output it logs.

---

## Configure

Pick a destination the script will accept. It refuses any path inside the
repository **or inside any git working tree** — this repository is public, and a
dump that lands where `git add` can reach it publishes every client health record.
Prefer a separate drive or an external disk.

```bash
setx AST9_BACKUP_DEST "E:\ast9-backups"
```

Optional — how many dated copies to retain (default 14):

```bash
setx AST9_BACKUP_KEEP "30"
```

## Run it

Pre-flight only; dumps nothing:

```bash
node scripts/db-backup.mjs --check
```

Take a backup:

```bash
node scripts/db-backup.mjs
```

Override the destination for one run:

```bash
node scripts/db-backup.mjs --dest "F:\offsite\ast9" --keep 7
```

## Schedule it (Windows)

Run as the logged-in owner. It must **not** be "run whether user is logged on or
not": the Supabase CLI token lives in Windows Credential Manager and Docker
Desktop only runs in an interactive session.

```bash
schtasks /Create /TN "AST9 database backup" /SC DAILY /ST 03:00 /F /TR "node D:\ASThub\scripts\db-backup.mjs"
```

Then open Task Scheduler and tick **"Run task as soon as possible after a
scheduled start is missed"** — a laptop that was asleep at 03:00 otherwise skips
the day entirely.

## Check it is still working

The single most likely failure is silence: the task stops running and nobody
notices for a month. Check the status file, not the folder listing:

```bash
type E:\ast9-backups\backup-status.json
```

`consecutiveFailures` above zero, or a `lastSuccessUtc` older than two days, means
there is no current recovery point. `lastError` carries the reason.

---

## Restore

Restoring needs `psql` only — no Docker. Run against a **fresh, isolated** project;
never against production during an incident without the drill in
[DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

```bash
psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command "SET session_replication_role = replica" --file data.sql --dbname "<target connection string>"
```

Then, in order:

1. Verify `manifest.json` SHA-256 values against the files you restored from.
2. Compare row counts per table against the manifest's recorded sizes and the
   expectations in the drill procedure.
3. Re-enter Vault secrets and Edge Function runtime secrets from your password
   manager — they are not in the dump.
4. Redeploy Edge Functions from the `repoCommit` recorded in the manifest.
5. Re-create the `OPS_HEALTH_SECRET` GitHub Actions secret to match the new Vault
   value.

## Honest limits of this arrangement

- **Untested.** No restore from one of these dumps has ever been performed. Until
  a drill runs, this is an export, not a proven backup.
- **One machine, one disk.** If the laptop is lost, stolen, or its disk fails, the
  backups go with it. Copy the destination to a second location periodically.
- **Unencrypted at rest.** The dump contains client health data in plain SQL.
  Whole-disk encryption (BitLocker) is the minimum; a separate encrypted volume is
  better.
- **Laptop-dependent RPO.** The real recovery point is the last day the machine
  was awake, online, and running Docker at 03:00 — not "24 hours".
- **The schema still cannot be rebuilt from the repository.** The 69 migrations do
  not replay onto an empty database, so `schema.sql` here is currently the *only*
  machine-readable record of the deployed structure. That makes these dumps more
  load-bearing than they should be.
