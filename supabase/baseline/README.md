# AST9 public-schema baseline

`production_public_schema.sql` is a reviewed, schema-only export of the current
production `public` schema. It exists because the first ten historical migration
files are registry-alignment markers and cannot reconstruct the foundational
schema on a new Supabase project.

## Integrity and privacy

- Source: owner-authorized `supabase db dump --linked --schema public`
- SHA-256: `a057aee18df15bdb05cb6e0bbc2fcb03e6dad99c6cdbee4d717111ffa5fd220f`
- Size at review: 259,682 bytes
- Exported rows: none
- `COPY ... FROM stdin`: none
- Dumped `auth` or `storage` schema: none
- Production credentials, project refs, emails, and health data: none

The SQL inside stored-function bodies is application source, not exported table
data. The baseline must remain byte-identical to the reviewed artifact.

## Safety boundary

This file is intentionally outside `supabase/migrations/`. It is single-use and
not idempotent: it contains unguarded indexes, constraints, and policies. Never
run it against production or any database whose `public` schema already contains
objects.

The guarded command emitter is:

```powershell
npm run staging:provision-check -- --ref <staging-project-ref>
```

It requires `AST9_STAGING_SEED_CONFIRM` to exactly match the target ref, rejects
the production ref, verifies this file's hash and the 60-version repair manifest,
and prints commands without executing them. Its emitted `psql` command checks for
an empty `public` schema and applies this baseline in one transaction. The database
host is constructed from the validated staging ref; an arbitrary connection URL
cannot bypass the production guard.

After the baseline succeeds:

1. Link the repository CLI to the isolated staging project.
2. Mark every version in `repair-versions.txt` as applied.
3. Run `supabase db push`; only the two post-baseline forward migrations should
   remain pending.
4. Stop if any historical migration is still pending.
5. Run the staging fixture and smoke sequence documented in `docs/RUNBOOK.md`.

Rollback for a failed or partial baseline is deletion and recreation of the
disposable staging project. Do not attempt to reapply this file.
