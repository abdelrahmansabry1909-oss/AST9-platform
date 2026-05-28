# Architecture Decision Records — AST9 Health Hub

This document captures the major architectural decisions in the AST9
Health Hub / NeuCore platform, the constraints that produced them, and
the trade-offs they imply. Each ADR is grounded in code evidence —
file paths and direct quotes are cited where they exist.

ADRs are immutable once accepted. A new ADR supersedes an old one
rather than rewriting it.

> **Sources of authority** referenced throughout:
>
> - [`AST9_MASTER_PROMPT_v3.md`](./AST9_MASTER_PROMPT_v3.md) — the
>   product/clinical specification, including the *PRIME DIRECTIVES*.
> - [`RPM_ARCHITECTURE_PLAN.md`](./RPM_ARCHITECTURE_PLAN.md) — the
>   Reactive Phase Management module design.
> - [`Documentation.md`](./Documentation.md) and
>   [`Development.md`](./Development.md) — the live engineering reference.

---

## Index

| ADR  | Title                                                                                                       | Status                              |
|------|-------------------------------------------------------------------------------------------------------------|-------------------------------------|
| 001  | [Supabase as the sole backend](#adr-001-supabase-as-the-sole-backend)                                       | Accepted                            |
| 002  | [Two-layer browser architecture (Legacy IIFE + ES modules)](#adr-002-two-layer-browser-architecture-legacy-iife--es-modules) | Accepted                            |
| 003  | [Browser-side clinical computation](#adr-003-browser-side-clinical-computation)                              | Accepted                            |
| 004  | [Three.js anatomical skeleton via a single glTF asset](#adr-004-threejs-anatomical-skeleton-via-a-single-gltf-asset) | Accepted                            |
| 005  | [Edge functions reserved for privileged or AI workflows](#adr-005-edge-functions-reserved-for-privileged-or-ai-workflows) | Accepted                            |
| 006  | [Direct browser → Supabase calls with the public anon key](#adr-006-direct-browser--supabase-calls-with-the-public-anon-key) | Accepted                            |
| 007  | [Row Level Security as the only authorization boundary](#adr-007-row-level-security-as-the-only-authorization-boundary) | Accepted                            |
| 008  | [Idempotent SQL migrations as primary design documents](#adr-008-idempotent-sql-migrations-as-primary-design-documents) | Accepted (cleanup pending)          |
| 009  | [AI features must degrade gracefully](#adr-009-ai-features-must-degrade-gracefully)                          | Accepted                            |
| 010  | [Static hosting, no SSR](#adr-010-static-hosting-no-ssr)                                                    | Accepted                            |
| 011  | [GLB asset loaded once, cached, retried](#adr-011-glb-asset-loaded-once-cached-retried)                     | Accepted                            |
| 012  | [Module-scoped state, no central store](#adr-012-module-scoped-state-no-central-store)                      | Accepted                            |
| 013  | [Generate-page runs two independent code paths](#adr-013-generate-page-runs-two-independent-code-paths)     | Accepted                            |
| 014  | [Community moderation via status column + admin-only UPDATE RLS](#adr-014-community-moderation-via-status-column--admin-only-update-rls) | Accepted                            |
| 015  | [PDF export bundled client-side via jsPDF](#adr-015-pdf-export-bundled-client-side-via-jspdf)               | Accepted                            |
| 016  | [Generate-page narrative calls Claude directly from the browser](#adr-016-generate-page-narrative-calls-claude-directly-from-the-browser) | **Deprecated — needs replacement**  |

---

## ADR-001: Supabase as the sole backend

### Status

Accepted

### Context

The project needed authentication, a relational database, row-level
authorization, file storage potential, a way to email visitors from the
landing page, and a way to call an LLM with a secret key — but it has
one engineer, no operations budget, and the PRIME DIRECTIVES in
[`AST9_MASTER_PROMPT_v3.md`](./AST9_MASTER_PROMPT_v3.md) §0 require
"all external services must run on free tiers during development."

### Decision

Supabase is the entire backend:

- **Postgres** for all persistent data (`supabase/migrations/` +
  `AST9_Phase3_Migrations.sql`).
- **Supabase Auth** for identity, with three roles in `profiles.role`.
- **Row Level Security** as the authorization layer (see
  [ADR-007](#adr-007-row-level-security-as-the-only-authorization-boundary)).
- **Realtime** channels for live messaging + client-feed prepend.
- **Edge Functions** (Deno) for the work the browser cannot safely do
  (see [ADR-005](#adr-005-edge-functions-reserved-for-privileged-or-ai-workflows)).

There is **no custom application server**. The browser talks to
Supabase, and Supabase talks to outside services (Resend, Anthropic).

### Consequences

**Positive:**
- Zero operational surface: no servers to provision, monitor, or patch.
- A single auth context flows through every layer of the system.
- Backend evolution is just SQL + the occasional Deno function.

**Trade-offs / risks:**
- Hard vendor lock-in. Migrating away requires replicating Postgres,
  Auth, Realtime, and Edge Functions on at least three different
  services.
- Free-tier projects auto-pause after inactivity; the first login after
  a pause can take 30–90 s ([`js/auth.js`](./js/auth.js) L60–82 has the
  75 s timeout + retry to absorb this).
- RLS becomes load-bearing — see [ADR-007](#adr-007-row-level-security-as-the-only-authorization-boundary).

### Alternatives Considered

- **Express/Fastify + Postgres** — rejected: another deployment target,
  another auth layer, another secret store.
- **Firebase** — rejected (inferred): the clinical data model is
  relational and benefits from Postgres + SQL; Firestore would have
  forced denormalisation.
- **Hand-rolled JWT + bare Postgres** — rejected: re-implementing
  password reset, magic links, JWT rotation, and row-level rules is a
  multi-month detour with no clinical value.

### Notes for Future Maintainers

- Before adding a custom API service, ask whether the work can live in
  an edge function instead. Each new long-running service is a new
  failure surface.
- If you outgrow Supabase, the migration path is: lift Postgres + RLS
  first, then replace Auth, then replace Edge Functions, then Realtime
  last. The RLS work is the most portable.

---

## ADR-002: Two-layer browser architecture (Legacy IIFE + ES modules)

### Status

Accepted

### Context

The original codebase was vanilla IIFE scripts loaded with `<script>`
tags (no bundler). The 3D skeleton stack required Three.js plus several
of its `examples/jsm/*` add-ons — those resolve cleanly only through a
bundler. The PRIME DIRECTIVE in
[`AST9_MASTER_PROMPT_v3.md`](./AST9_MASTER_PROMPT_v3.md) §0 reads:

> **PRESERVE FIRST** — The existing codebase (auth, roles, dashboard,
> new-session flow, subscriptions, exercise library) must continue
> working. Never break existing Supabase queries or RLS policies.

A full migration to ES modules would have violated that directive.

### Decision

Run two parallel browser layers in the same page:

- **Legacy layer** (`js/*.js`) — IIFE modules that expose globals on
  `window` (`Auth`, `Dashboard`, `Community`, `RPMApproval`, …).
  Loaded with classic `<script>` tags in `app.html`.
- **Modern layer** (`src/neucore/**/*.js`) — ES modules bundled by Vite,
  loaded via `<script type="module" src="/src/main.js">`. Owns the
  Three.js stack.

The layers communicate through three intentional bridges:

| Bridge             | Direction           | Purpose                                         |
|--------------------|---------------------|-------------------------------------------------|
| `window.sb`        | Legacy → Modern     | One Supabase client / one auth session.         |
| `window.THREE`     | Modern → Legacy     | Shared Three.js instance for legacy `bodyMap3D.v2.js`. |
| `window.Dashboard` | Modern → Legacy     | Modern code uses `Dashboard.toast()` for UI feedback. |

### Consequences

**Positive:**
- The PRESERVE FIRST directive is honoured — no legacy feature broke
  when the NeuCore 3D stack landed.
- Each layer keeps the conventions it was written for (browser globals
  for the simple stuff, ES modules for the things that need a bundler).
- The legacy layer remains deployable to a static host without Vite,
  if that ever becomes useful.

**Trade-offs / risks:**
- **Duplicate-name trap.** Both layers contain a `ScoringEngine` and a
  `GaitEngine` with the same name but different code. The legacy ones
  are consumed by `Dashboard.generateProgram`; the NeuCore ones by
  `GaitAnalysisPage`. New contributors regularly assume they are the
  same. Documented in [`Documentation.md`](./Documentation.md#2--the-two-layer-browser-stack).
- Two engines means two clinical implementations to keep in sync if the
  clinical spec changes.
- Coupling through globals is implicit. Renaming `window.Dashboard`
  silently breaks code in another file.

### Alternatives Considered

- **Full rewrite to ES modules** — rejected by PRESERVE FIRST.
- **Keep everything IIFE and inline the GLTFLoader source** — rejected:
  Three's add-on tree is large and changes between versions; vendoring
  it manually was deemed worse than introducing Vite.
- **Web Components per feature** — not in scope and would have required
  a third paradigm in the same page.

### Notes for Future Maintainers

- Read [`Documentation.md §2`](./Documentation.md#2--the-two-layer-browser-stack)
  before you touch either `ScoringEngine` or `GaitEngine`.
- If you rename one of the bridge globals (`sb`, `THREE`, `Dashboard`),
  grep the entire repo first — both layers reference them by string.
- The long-term direction is to collapse to one layer, but only once
  the legacy layer has tests and the duplicate engines have been
  renamed.

---

## ADR-003: Browser-side clinical computation

### Status

Accepted

### Context

The clinical scoring formulas, normative ranges, gait-phase mappings,
and exercise-selection rules are deterministic — they take an
assessment object in and return scores / deficits / a program out. The
PRIME DIRECTIVE on **CLINICAL ACCURACY** mandates that these values are
"locked" and not approximated.

### Decision

All clinical computation runs **in the browser**, not the server:

- `js/scoring.js` and `src/neucore/scoring/ScoringEngine.js` compute
  scores synchronously from the form / 3D-store data.
- `js/gaitEngine.js` and `src/neucore/gait/GaitRules.js` produce gait
  deficits.
- `src/neucore/program/{ProgramGenerator,RuleEngine}.js` and
  `js/programGenerator.js` pick exercises and assemble the program.
- `src/neucore/simulation/MovementSimulator.js` runs the walking-cycle
  kinematics live on the skeleton.

Persistence is **after** the computation — the result is written to
`gait_assessments`, `programs`, `client_programs`, etc.

### Consequences

**Positive:**
- Zero server cost for the hot path.
- The Generate button feels instant (< 100 ms before the AI narrative
  step) — the user sees a populated score panel and a moving skeleton
  before any network round-trip.
- Clinical logic is auditable in source: a reviewer can read
  `js/scoring.js` and check it against the spec without spinning up
  infrastructure.

**Trade-offs / risks:**
- The clinical values are shipped to the client. Anyone with DevTools
  can read the thresholds. This is acceptable for an evidence-based
  framework but would not be for proprietary algorithms.
- Two implementations exist for scoring and gait engines (see
  [ADR-002](#adr-002-two-layer-browser-architecture-legacy-iife--es-modules))
  — a clinical spec change has to be applied to both.
- No automated test suite exists yet, so a regression in scoring is
  caught manually.

### Alternatives Considered

- **Server-side scoring via an edge function** — rejected for cost +
  latency. The math is trivial; the round-trip is not.
- **WASM module of the clinical logic** — overkill; the math is < 5 ms
  on a midrange laptop.

### Notes for Future Maintainers

- Tests for the scoring + gait rules are the highest-leverage code to
  add — pure functions, locked spec, full coverage achievable. Listed
  as debt #4 in [`Development.md`](./Development.md#9--technical-debt-register).
- When the spec changes, change both layers in the same commit.

---

## ADR-004: Three.js anatomical skeleton via a single glTF asset

### Status

Accepted

### Context

The platform needs a real-time, anatomically faithful skeleton: 135
bones in an FK hierarchy, joint hotspots the user can click, the
ability to drive a walking gait cycle by rotating individual bones, and
a holographic visual style consistent with the NeuCore brand.

### Decision

A single `public/models/ecorche_humanoid.glb` (~3.3 MB) is loaded by
[`src/neucore/skeleton/GLBSkeleton.js`](./src/neucore/skeleton/GLBSkeleton.js)
and treated as the source of truth:

- 135 bone meshes parented in an anatomical FK tree (`hip → femur →
  tibula → talus → …`).
- Custom GLSL shaders (`BONE_VERT` / `BONE_FRAG`) implement the
  "polished bone" + cyan-fresnel look without external textures.
- Joint hotspots are *derived* at load-time from the bone bounding
  boxes (`_buildHotspots()`) — they are not stored in the model.
- Inline comments document Blender-side quirks the loader compensates
  for at runtime (e.g. axial bones were modelled right-side-only with a
  Mirror modifier that was never applied — `_mirrorAxialBones()` fixes
  it; arms ship in a T-pose, `_relaxArmsDown()` poses them).

### Consequences

**Positive:**
- One asset to deploy; one place to look when something is wrong.
- Hotspots auto-rebuild if the asset changes — the loader is the
  contract, not a JSON sidecar.
- Mesh-tree FK lets `MovementSimulator` drive gait by rotating ~10
  bones; no skinning pipeline needed.

**Trade-offs / risks:**
- 3.3 MB is large for a first-paint-blocking asset. Mitigated by
  caching ([ADR-011](#adr-011-glb-asset-loaded-once-cached-retried))
  but the *first* visit still pays the cost.
- The runtime fix-ups (`_mirrorAxialBones`, `_relaxArmsDown`) couple
  the loader to specific Blender quirks. If the asset is re-exported
  cleanly, those fix-ups become wrong, not just unnecessary.
- The model is currently **untracked in git** (`public/` is in
  `.gitignore`-equivalent state). A fresh clone produces a silent "3D
  anatomy failed to load" until the file is dropped in.

### Alternatives Considered

- **Procedural skeleton** (the prior `BoneDefinitions` + `SkeletonBuilder`
  approach) — kept around as the historical pattern but supplanted by
  the GLB for anatomical accuracy.
- **Skinned mesh + armature** — the model file *contains* an armature
  + 706-bone rig + skin shell, but the code disposes it and renders
  bones only. Skinning would have added complexity without a clear
  clinical win.
- **Multi-LOD assets** — not needed at current asset size.

### Notes for Future Maintainers

- If the GLB is ever re-exported, delete the `_mirrorAxialBones` and
  `_relaxArmsDown` fix-ups — they will become incorrect, not optional.
- Add the GLB to Git LFS or write a `npm run bootstrap` that fetches
  it before a fresh clone can produce a working gait page.
- Joint-name lookups go through substring + `L`/`R` suffix matching
  (`find(substr, side)`) — three.js sanitises `.` out of glTF names so
  exact matches don't work.

---

## ADR-005: Edge functions reserved for privileged or AI workflows

### Status

Accepted

### Context

The browser can do most work directly against Supabase ([ADR-006](#adr-006-direct-browser--supabase-calls-with-the-public-anon-key)),
but two categories of work cannot:

1. Operations that need a secret the browser must not see (Anthropic
   API key, Resend API key, the Supabase service-role key).
2. Operations triggered by unauthenticated visitors that need to write
   to RLS-protected tables.

### Decision

Edge functions are written only for those two cases. The repo has
exactly two:

| Function           | Category                | Notes                                                                 |
|--------------------|-------------------------|-----------------------------------------------------------------------|
| `rpm-ai-suggest`   | secret-bearing (AI)     | Calls Anthropic with `ANTHROPIC_API_KEY`; falls back to deterministic clinical defaults if the key is missing or the model errors. |
| `visitor-survey`   | unauthenticated writer  | Accepts a `POST` from the landing page (deployed `--no-verify-jwt`), inserts into `visitor_inquiries` via the service role, emails via Resend. |

The function headers (both in `supabase/functions/*/index.ts`) list
every required secret as the canonical contract.

### Consequences

**Positive:**
- The surface of secret-holding code is exactly two files.
- The browser stays simple: one Supabase client, no special-cased
  endpoints.

**Trade-offs / risks:**
- The Generate-page narrative was *not* moved behind an edge function
  ([ADR-016](#adr-016-generate-page-narrative-calls-claude-directly-from-the-browser))
  — that's a known violation of this rule.
- `visitor-survey` ships with `Access-Control-Allow-Origin: "*"` and an
  inline TODO to tighten it. Public deployment must do so first.

### Alternatives Considered

- **All AI calls from the browser with a per-user-supplied key** —
  rejected as a poor product experience.
- **Custom Node/Deno service** — rejected per [ADR-001](#adr-001-supabase-as-the-sole-backend).

### Notes for Future Maintainers

- The convention is: header comment lists every secret, includes the
  exact `supabase functions deploy ...` command. Follow it for any new
  function.
- The fallback pattern in `rpm-ai-suggest` ("try AI first, deterministic
  default on any failure") is the template — see
  [ADR-009](#adr-009-ai-features-must-degrade-gracefully).

---

## ADR-006: Direct browser → Supabase calls with the public anon key

### Status

Accepted

### Context

[ADR-001](#adr-001-supabase-as-the-sole-backend) put all data in
Supabase. Either (a) the browser talks to Supabase directly with the
public anon key, or (b) an intermediate API server proxies every call.

### Decision

The browser talks to Supabase directly. There is one shared client
instantiated in [`js/supabaseClient.js`](./js/supabaseClient.js) and
exposed as `window.sb`; every other module uses it.

The anon key is **intentionally checked into the repository**. The key
is designed to be public — its capabilities are bounded entirely by
RLS policies on individual tables.

A subtle but important detail in `supabaseClient.js`: the auth client
is configured with a pass-through Web Lock —

```js
lock: async (_name, _acquireTimeout, fn) => fn(),
```

The default `navigator.locks`-based serialisation in supabase-js v2
deadlocks when a previous tab crashed or another tab holds the lock,
surfacing as a login "timeout". Single-coach usage doesn't need
cross-tab serialisation, so the lock is bypassed.

### Consequences

**Positive:**
- The simplest possible request shape: `sb.from('foo').select(...)`.
- No proxy code to maintain, no auth-token forwarding boilerplate.

**Trade-offs / risks:**
- RLS becomes load-bearing for security ([ADR-007](#adr-007-row-level-security-as-the-only-authorization-boundary)).
  A missing or incorrect policy is the same as no auth at all.
- The Supabase URL is hard-coded alongside the anon key. Switching
  environments requires editing source rather than swapping `.env`.
  Listed as debt #3 in [`Development.md`](./Development.md#9--technical-debt-register).
- A bug in supabase-js cross-tab locking will hit every user, since the
  custom pass-through bypasses the upstream fix.

### Alternatives Considered

- **GraphQL/REST API layer in front of Supabase** — rejected per
  [ADR-001](#adr-001-supabase-as-the-sole-backend).
- **Embed credentials per environment via build-time replacement** —
  not yet done. A `js/config.js` per environment is the planned
  refactor.

### Notes for Future Maintainers

- The anon key is meant to be public. The *service-role* key is not,
  and never appears in the browser bundle. If you ever see a literal
  key with a `service_role` claim in `js/`, that's a security incident.
- Test every new RLS policy from each role (admin / coach / client / anon)
  before you ship.

---

## ADR-007: Row Level Security as the only authorization boundary

### Status

Accepted

### Context

With browsers talking directly to Postgres ([ADR-006](#adr-006-direct-browser--supabase-calls-with-the-public-anon-key)),
the only place to enforce "who can see / change what" is the database
itself.

### Decision

Every table in `public` schema has RLS **enabled**. Policies are
expressed in terms of three `SECURITY DEFINER` helper functions:

```sql
public.is_admin()           -- profiles.role = 'admin'
public.is_coach()           -- profiles.role = 'coach'
public.is_coach_or_admin()  -- role IN ('coach','admin')
```

Sidebar visibility classes (`role-coach-admin`, `role-admin-only`,
`role-client-only`) are a **UX courtesy**, not a security boundary.
Deep-linking to a hidden section returns nothing because the queries
that section makes are filtered by RLS.

Where the same table needs different rules per operation, we prefer
**named per-operation policies** (`foo_read`, `foo_insert`,
`foo_update`, `foo_delete`) over `FOR ALL`, because policy-merging is
OR'd and broad `FOR ALL` policies are hard to narrow safely.

### Consequences

**Positive:**
- One authorization mental model: "what does the policy on this table
  say?"
- Defence in depth survives a frontend bug — broken UI cannot leak data
  the policy doesn't allow.

**Trade-offs / risks:**
- Every helper function referenced by a policy must have
  `EXECUTE` granted to **every role** that may run the query
  (`anon` included). Otherwise the query errors with `permission
  denied for function is_admin` rather than returning the rows the
  policy allows. The case-study migration discovered this — see
  `supabase/migrations/20260523_case_study_approval.sql`.
- Debugging "I see no rows but I expect rows" is the most common
  RLS-class problem. The fix is almost always to test the same query
  through the SQL editor as the specific user.
- The original Phase 3 migration created the helper functions as
  `Auth.is_admin()` (capital A). Postgres unquoted identifiers fold to
  lowercase, so they actually live in the `auth` schema in the file but
  the live DB has them in `public`. New policies should use
  `public.is_admin()` to match reality.

### Alternatives Considered

- **API-layer authorization** — rejected per [ADR-001](#adr-001-supabase-as-the-sole-backend) and [ADR-006](#adr-006-direct-browser--supabase-calls-with-the-public-anon-key).
- **Postgres `GRANT`s without RLS** — too coarse for per-row rules
  (e.g. "a coach can only see their own clients").

### Notes for Future Maintainers

- When you write a new policy, run this checklist:
  1. Does the policy reference a `public.is_*()` function?
  2. If yes, is `EXECUTE` granted to `anon, authenticated`?
  3. Does another policy on the same table already permit the same row
     via OR? (Two permissive policies are unioned.)
  4. Did you grant the operation you intended (SELECT vs UPDATE vs
     `FOR ALL`)?
- Never use `FOR ALL` as your only policy on a sensitive table unless
  every operation should follow the same rule.

---

## ADR-008: Idempotent SQL migrations as primary design documents

### Status

Accepted (cleanup pending)

### Context

There is no schema-management framework in this repo — no Prisma, no
TypeORM, no Knex. Schema is the SQL files themselves.

### Decision

Every schema or RLS change ships as a SQL file that can be safely
re-applied:

- Filename: `supabase/migrations/<YYYYMMDD>_<short_snake_case>.sql`.
- Tables: `CREATE TABLE IF NOT EXISTS`.
- Columns: `ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar ...;`.
- Policies: `DROP POLICY IF EXISTS "..." ON foo;` then re-create.
- Grants: re-runnable by design.
- Backfills that should run **once** are wrapped in a `DO $$ ... END $$`
  block guarded by an `information_schema.columns` check
  ([`supabase/migrations/20260523_case_study_approval.sql`](./supabase/migrations/20260523_case_study_approval.sql)
  is the reference example).
- Heavy comments — migration files are read as design documents, not
  just executables.

### Consequences

**Positive:**
- The full schema can be reconstructed by replaying every file in
  order against an empty database.
- A migration that errors halfway can be re-run after a fix without
  cleanup.

**Trade-offs / risks:**
- `AST9_Phase3_Migrations.sql` lives in the repo root rather than under
  `supabase/migrations/`, and its text says functions are created in an
  `Auth` schema that doesn't match the live DB. New developers can't
  yet run `supabase db push` and get the actual current state.
- Without a migrations table tracking what has been applied, "is this
  migration applied?" is answered by reading the live schema. That's
  manageable today but won't scale to a larger team.
- Backfill steps that should only ever run once are protected by
  guards; if those guards are written wrong they'll either re-run
  destructively or never run at all.

### Alternatives Considered

- **Supabase CLI migrations table** — partially used. Worth promoting
  to the single source of truth.
- **Prisma / Drizzle** — adds an ORM the project doesn't otherwise use.
- **One ever-growing schema.sql** — would lose history.

### Notes for Future Maintainers

- Consolidate `AST9_Phase3_Migrations.sql` into the
  `supabase/migrations/` directory with a back-dated timestamp prefix
  before this drift gets worse.
- Always heavy-comment the *why*, not just the *what*. The migration is
  the only place future-you can read about the constraint that produced
  the schema.

---

## ADR-009: AI features must degrade gracefully

### Status

Accepted

### Context

LLM availability is bounded by three failure modes: the key isn't set,
the model returns an error, or the model returns un-parseable output.
The clinical pipeline must not block on any of these — the platform's
value sits in the deterministic scoring + program logic, with AI as a
narrative layer on top.

### Decision

Every AI integration follows the same pattern:

1. Try the AI call.
2. On any failure (no key, HTTP error, JSON parse failure, schema
   mismatch), substitute a deterministic fallback.
3. Surface a `console.warn` or a non-blocking toast so the operator
   knows the AI didn't fire.
4. **Never** raise an exception to the caller of the AI step.

The reference implementations:

- `supabase/functions/rpm-ai-suggest/index.ts` — header comment:
  > Behavior: tries Anthropic first; on no-key / error / parse failure
  > falls back to deterministic clinical defaults so the platform never
  > blocks.
- `js/dashboard.js generateProgram()` — catches all errors from the
  Anthropic call and replaces the narrative with a synthesised
  score-summary string.

### Consequences

**Positive:**
- The product works without an Anthropic key. New deployments aren't
  blocked on procurement.
- A bad LLM day doesn't bring the clinical surface down.

**Trade-offs / risks:**
- "AI off" failures are silent unless the operator reads warnings. A
  feature that's quietly always falling back will look fine on paper.
- The deterministic fallback can drift from the AI behaviour in subtle
  ways (e.g. ordering, vocabulary). Worth periodic side-by-side review.

### Alternatives Considered

- **Hard-fail when the AI is unavailable** — rejected: turns a soft
  product issue into a hard outage for every user.
- **Retry with backoff before falling back** — out of scope today but
  worth adding for known-transient errors (429, 503).

### Notes for Future Maintainers

- New AI integrations must declare their fallback in the same PR, not
  in a follow-up.
- When you add a new fallback, add a way for ops to detect "we are
  falling back more than expected" (logging is enough today; consider
  a counter later).

---

## ADR-010: Static hosting, no SSR

### Status

Accepted

### Context

The product is two HTML files (`index.html` + `app.html`), some CSS,
some JS, and a 3.3 MB GLB. All dynamic behaviour comes from Supabase or
the edge functions. There is no per-request server rendering — every
page is the same bytes for every user.

### Decision

`npm run build` produces a Vite-built static bundle. The reference
deployment is GitHub Pages (URL declared in
`AST9_MASTER_PROMPT_v3.md` §1). Any static host (Netlify, Vercel
static, Cloudflare Pages, S3+CDN) will work.

### Consequences

**Positive:**
- Free or near-free hosting at any scale CDN-side caching is
  applicable to.
- Zero deploy-time orchestration: drop `dist/` onto the host.
- No server cold-starts to engineer around.

**Trade-offs / risks:**
- No server-side rendering means no SEO content on the SPA shell. The
  marketing surface is the separate landing page, which is plain HTML
  and indexable.
- No server-side feature flagging without an extra service.
- The Supabase URL + anon key are bundled into the static output,
  reinforcing the need for [ADR-006](#adr-006-direct-browser--supabase-calls-with-the-public-anon-key)
  discipline.

### Alternatives Considered

- **Next.js / SvelteKit** — adds server runtime + framework lock-in for
  features the product doesn't need.
- **Static site generator** — overkill for two HTML files.

### Notes for Future Maintainers

- The `public/` directory ships verbatim to the host. Anything you
  drop there is publicly fetchable.
- The GLB lives in `public/models/`. Whatever deployment pipeline you
  use must include it.

---

## ADR-011: GLB asset loaded once, cached, retried

### Status

Accepted

### Context

The 3.3 MB skeleton is loaded twice in a successful session: once by
the dashboard skeleton on boot, again by `GaitAnalysisPage` when the
user clicks Generate. A network blip on the second fetch surfaced as
the user-visible **"3D anatomy failed to load"** error with no recovery
path.

### Decision

Three layers of resilience, applied bottom-up:

1. **Process-wide cache.** [`src/main.js`](./src/main.js) sets
   `THREE.Cache.enabled = true` immediately after importing Three.
   `GLTFLoader` uses `FileLoader` internally, which honours the cache;
   the second load is therefore a memory hit.
2. **Loader-level retry.** `GLBSkeleton._loadWithRetry(retriesLeft=2)`
   retries the fetch twice on a network error with 600 ms backoff.
   Parse / wiring errors (deterministic) are **not** retried.
3. **Recoverable UI.** If all retries fail,
   `GaitAnalysisPage._initSimulation` shows the real error message + a
   **↻ Retry** button that re-enters the method cleanly (disposes the
   `BodyCanvas`, clears the wrap, restarts the build).

A race guard (`_buildToken` + `_disposed`) on the page-level rebuild
ensures rapid Generate clicks don't double-build the skeleton.

### Consequences

**Positive:**
- The Generate-page gait simulation now becomes a memory operation
  after first boot — fast and immune to network issues.
- Transient network errors no longer require a page reload to recover.
- The retry button surfaces the underlying error to the user instead
  of swallowing it.

**Trade-offs / risks:**
- The cache lives for the page lifetime. A new tab is a new cache.
- Retry adds a small latency cost (~600 ms) when the asset is
  genuinely unavailable.
- The race guard works per `GaitAnalysisPage` instance; cross-instance
  guarantees rely on `destroy()` being called.

### Alternatives Considered

- **Preload the GLB in the page `<head>`** — would help first-paint
  perception but doesn't address the resilience problem.
- **Re-use the dashboard's parsed scene by cloning it** — possible but
  would require deeper plumbing into `GaitAnalysisPage`; deferred.

### Notes for Future Maintainers

- Don't disable `THREE.Cache` thinking it's a memory cost; it's the
  single most effective gait-page fix.
- The retry button is the diagnostic surface — if a user reports the
  error, ask them to click Retry and read the underlying message.

---

## ADR-012: Module-scoped state, no central store

### Status

Accepted

### Context

The app has clear per-feature state (current section, conversation
list, RPM filter, last generated bundle) but no requirement for
cross-feature time-travel debugging or selector-based derived state.

### Decision

State lives inside the module that owns it:

- Per-module `let _foo = ...` private state for module-scoped data.
- A small number of intentional globals: `window.sb`, `window.THREE`,
  `window.Dashboard`, `window._lastGait`, `window._lastBundle`.
- `assessStore` (a plain JS object in `src/main.js`) is the
  shared 3D-form state, sync'd by `ObjectiveSync`.
- A pub/sub bus (`JointBus` at `src/neucore/core/JointBus.js`) is the
  only cross-module event channel.

There is no Redux/Zustand/Pinia/Signals layer.

### Consequences

**Positive:**
- Minimal ceremony — one module owns one piece of state.
- Fewer abstractions to learn for new contributors.
- Pages can be unmounted/remounted without leaking globals if `destroy`
  cascades are kept correct.

**Trade-offs / risks:**
- No single place to see what's in memory. Debugging "where is this
  value set?" relies on grep.
- The few globals (`_lastBundle`, `_lastGait`) carry implicit
  coupling — the PDF export depends on `_lastBundle` having been
  populated by `generateProgram` first.
- Two layers of state synchronisation exist for the assessment
  (form ↔ 3D via `ObjectiveSync`, plus the legacy form fields). If a
  binding is missing, the two surfaces silently disagree.

### Alternatives Considered

- **Redux / Zustand** — rejected: adds a paradigm for cross-module data
  flow the project barely needs.
- **A single `AppState` object on `window`** — rejected: same risks as
  globals plus the appearance of structure.

### Notes for Future Maintainers

- Don't add a state library because one piece of state is awkward — add
  it because three pieces of state are.
- New form fields that should drive the 3D map go through
  `ObjectiveSync.BINDINGS`, not ad-hoc listeners. See
  [`Documentation.md §8`](./Documentation.md#8--event-bus--state-synchronization).

---

## ADR-013: Generate-page runs two independent code paths

### Status

Accepted

### Context

The Generate button (`#generate-btn`) needs to (a) build the NeuCore
Movement Simulation in `#neucore-gait-container` and (b) run the legacy
score / gait engines + AI narrative for the legacy panels. Path (a)
lives in the ES-module layer; path (b) lives in the IIFE layer. Per
[ADR-002](#adr-002-two-layer-browser-architecture-legacy-iife--es-modules),
they cannot easily call each other.

### Decision

The button fires two listeners by design:

- A **capture-phase** listener attached in
  [`src/main.js`](./src/main.js) `_initGenerateButton` runs **first**,
  builds the `GaitAnalysisPage`, and is fire-and-forget.
- The **bubble-phase** `onclick="Dashboard.generateProgram()"` runs
  **second**, executes the legacy scoring + AI narrative path.

The capture listener is intentionally placed in the capture phase so
that path (a) starts even if path (b) early-returns (for example, no
active client session blocks `generateProgram`).

### Consequences

**Positive:**
- Cleanest possible bridging between two layers that don't share types.
- The user always sees the gait simulation when they click Generate,
  regardless of whether the program-generation pre-conditions are met.

**Trade-offs / risks:**
- Two renders of "the same thing" exist — the legacy `#gait-panel`
  and the NeuCore `#neucore-gait-container`. They can disagree. The
  legacy panel is the older one; the user mostly looks at the NeuCore
  page.
- The split is invisible to a new reader of `app.html` unless they
  know to grep for `addEventListener('click', ... , { capture: true })`.
- An AI narrative failure in path (b) doesn't affect path (a), which is
  the right call but is non-obvious.

### Alternatives Considered

- **Move all logic into `Dashboard.generateProgram`** — would require
  importing ES modules into the IIFE layer, which is what
  [ADR-002](#adr-002-two-layer-browser-architecture-legacy-iife--es-modules)
  spent the entire architecture avoiding.
- **Custom event dispatch from `Dashboard.generateProgram`** — adds
  ordering questions (would the gait page start before or after the
  legacy work?). The capture-phase approach is order-deterministic.

### Notes for Future Maintainers

- Don't "fix" the duplicate render until both engines have been
  consolidated.
- The capture-phase trick is documented in [`Documentation.md §6.1`](./Documentation.md#61--generate-program-flow).

---

## ADR-014: Community moderation via status column + admin-only UPDATE RLS

### Status

Accepted

### Context

Coaches share anonymized case studies in Community. Originally every
submission was instantly visible to all coaches. The product needed an
admin gate without inventing a new submission table or moderation
queue table.

### Decision

A single `status` column on `case_shares` (`pending` / `approved` /
`rejected`) plus four named-per-operation RLS policies:

| Policy                | Rule                                                                |
|-----------------------|---------------------------------------------------------------------|
| `case_shares_read`    | `status='approved' OR auth.uid()=coach_id OR public.is_admin()`     |
| `case_shares_insert`  | `auth.uid()=coach_id` (coach can only create rows they own)         |
| `case_shares_update`  | `public.is_admin()` only — **closes the self-approval hole**         |
| `case_shares_delete`  | `auth.uid()=coach_id OR public.is_admin()`                          |

The same `case_shares` table feeds the Community board and the sidebar
Case Studies showcase. The showcase is driven by
`Community.loadApprovedCaseShares(20)` with `status = 'approved'`.

### Consequences

**Positive:**
- No new tables, no separate queue. Moderation status is part of the
  case study itself.
- Authors automatically see their own pending/rejected work without
  any extra query.
- Existing approved rows surface in the showcase without backfill — a
  one-time migration grandfathers pre-flow rows to `approved`.

**Trade-offs / risks:**
- Multiple permissive policies must be reasoned about together. The
  `OR`-union behaviour of RLS is correct but easy to get wrong.
- An admin can edit any column on `case_shares`, not just `status`.
  This is currently fine — there is no admin UI that edits content —
  but the policy is broader than the intent.
- No audit trail of *who* approved *when* beyond `reviewed_by` +
  `reviewed_at` columns. A separate `case_share_reviews` table would
  let you see the history.

### Alternatives Considered

- **Separate `case_share_submissions` queue table** — rejected: doubles
  the data model and adds a copy step on approval.
- **Soft-delete instead of `rejected`** — rejected: a rejected case
  needs to be visible to its author with the rejection note.

### Notes for Future Maintainers

- Reuse this pattern (status column + per-operation policies + helper
  function in the UPDATE policy) for any other admin-moderated feature.
  Reference: `supabase/migrations/20260523_case_study_approval.sql`.

---

## ADR-015: PDF export bundled client-side via jsPDF

### Status

Accepted

### Context

Coaches need to hand clients a polished, branded report after a
Generate run. The data is already in the browser (assessment + scores +
gait + program + AI text in `_lastBundle`); a server round-trip would
add nothing.

### Decision

`jsPDF` (UMD build, `js/lib/jspdf.umd.min.js`) is vendored into the
repo. `js/pdfExport.js` builds the report from `_lastBundle` and
triggers a download.

### Consequences

**Positive:**
- Zero infrastructure for PDF generation. Works offline once loaded.
- The same data the user just saw on-screen drives the report — no
  formatting drift between UI and PDF.
- Vendored UMD means no module-resolution surprise in either layer.

**Trade-offs / risks:**
- PDF fonts and layouts are limited to what jsPDF supports — anything
  complex (rich table styling, embedded charts) requires custom code.
- The Chart.js outputs that appear on screen are not automatically
  pulled into the PDF; they would need to be captured as PNGs and
  embedded.
- The implicit coupling on `_lastBundle` means the **Export Professional
  PDF** button silently does nothing if Generate hasn't run first.

### Alternatives Considered

- **Server-side PDF via Puppeteer or wkhtmltopdf** — rejected per
  [ADR-001](#adr-001-supabase-as-the-sole-backend); requires a server
  with Chromium installed.
- **Browser print → save as PDF** — works as a fallback but lacks
  branding control.

### Notes for Future Maintainers

- If reports get richer, evaluate generating a screen-only print-styled
  HTML and using `window.print()` instead of growing the jsPDF code.

---

## ADR-016: Generate-page narrative calls Claude directly from the browser

### Status

**Deprecated — needs replacement.** A working production implementation
must move this behind an edge function. See debt #1 in
[`Development.md`](./Development.md#9--technical-debt-register).

### Context

When the Generate-page AI narrative was first wired
([`js/dashboard.js`](./js/dashboard.js) ≈ L425), the easiest path was
to `POST` directly to `api.anthropic.com/v1/messages` from the browser:

```js
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify({ model: 'claude-sonnet-4-20250514', ... }),
});
```

The call is missing an `x-api-key` header and Anthropic's CORS policy
won't allow the browser-origin call regardless.

### Decision

In production, the call fails. The `try/catch` block degrades the
output to:

```
[AI narrative unavailable — check API key]
Scores: ROM 72% · Control 68% · Force 75% · Neurology 80%
Composite: 74% → Phase 2 — Strength & Control
```

This is documented in [ADR-009](#adr-009-ai-features-must-degrade-gracefully)
as a hard requirement — the clinical pipeline never blocks on AI.

### Consequences

**Positive:**
- Users never see an error; the scoring + program output is unaffected.

**Trade-offs / risks:**
- The headline "AI clinical narrative" feature does not actually
  produce AI output today.
- The fallback string is short and unbranded.
- Violates the rule in [ADR-005](#adr-005-edge-functions-reserved-for-privileged-or-ai-workflows)
  that secret-bearing calls live in edge functions.

### Alternatives Considered

- **Add an `x-api-key` to the browser fetch** — rejected: would expose
  the key in the bundle.
- **Per-coach API keys** — rejected as a product experience.

### Notes for Future Maintainers

- The right fix is a new `claude-narrative` edge function that mirrors
  `rpm-ai-suggest`: project secret holds the key, function proxies
  the call, browser sends the assessment summary and gets the
  narrative back. The Generate-page degrades gracefully to the
  current fallback if the function errors.
- Until that ships, treat the Generate-page narrative as a stub.

---

# Architectural Risk Register

The honest list, ordered by impact.

## Highest-risk technical areas

| Risk                                                                                              | Where                                                                              | Severity |
|---------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|----------|
| Generate-page narrative is broken-by-design in production                                         | [ADR-016](#adr-016-generate-page-narrative-calls-claude-directly-from-the-browser) | High     |
| RLS is the only authorization layer; one bad policy = silent data exposure                        | [ADR-007](#adr-007-row-level-security-as-the-only-authorization-boundary)          | High     |
| `visitor-survey` CORS is `Access-Control-Allow-Origin: *` with an inline TODO                     | [ADR-005](#adr-005-edge-functions-reserved-for-privileged-or-ai-workflows)         | High     |
| The 3.3 MB GLB is git-untracked — a fresh clone produces a silent "3D anatomy failed to load"     | [ADR-004](#adr-004-threejs-anatomical-skeleton-via-a-single-gltf-asset)            | Medium   |
| Duplicate engines (`ScoringEngine`, `GaitEngine`) live in both layers and can drift apart        | [ADR-002](#adr-002-two-layer-browser-architecture-legacy-iife--es-modules)         | Medium   |

## Scaling bottlenecks

| Concern                                          | Notes                                                                                   |
|--------------------------------------------------|-----------------------------------------------------------------------------------------|
| Supabase free-tier project auto-pauses           | First login after a pause can take 30–90 s; mitigated by the `Auth.login` 75 s timeout. |
| 3.3 MB GLB on first page load                    | Cached for the session ([ADR-011](#adr-011-glb-asset-loaded-once-cached-retried)) but the first visit pays the cost. |
| Browser WebGL context count                      | Each `BodyCanvas` instance allocates a context. Browsers cap at ~16. Relies on `destroy()` cascade staying correct. |
| Realtime channels per user                       | One channel per open thread + one client feed. No automatic reconnect on drop.          |
| Sidebar Approvals badge poller                   | `setInterval(60_000)` is gated on `!document.hidden`; still emits two queries per user per minute. |
| No background workers                            | All work happens inside the browser tab. Long jobs cannot escape the page lifecycle.    |

## Security concerns

| Concern                                                                          | Mitigation today                                                              |
|----------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| Anon key + project URL hardcoded in `js/supabaseClient.js`                       | Anon key is meant to be public; URL leakage is acceptable but not portable.   |
| `visitor-survey` accepts unauthenticated POSTs from any origin                   | RLS doesn't help (service-role write); CORS is the only gate, and it's `*`.   |
| Sidebar role classes are UX-only, not security                                   | RLS at the database is the real gate; nav visibility is decoration.           |
| Helper functions need EXECUTE for `anon` to allow logged-out paths through policies | Already granted as of `20260523_case_study_approval.sql`; new helpers must repeat the grant. |
| Direct `api.anthropic.com` call from the browser                                 | Currently never succeeds — but if a key were ever added it would leak.         |

## Refactor candidates

In order of payoff per hour:

1. Move the Generate-page narrative behind a `claude-narrative` edge
   function ([ADR-016](#adr-016-generate-page-narrative-calls-claude-directly-from-the-browser)).
2. Lock down `visitor-survey` CORS to the production origin.
3. Extract Supabase config to `js/config.js` per environment
   ([ADR-006](#adr-006-direct-browser--supabase-calls-with-the-public-anon-key)).
4. Add Vitest with tests for the clinical engines.
5. Consolidate `AST9_Phase3_Migrations.sql` into
   `supabase/migrations/` and reconcile the `Auth` schema text with the
   `public` schema reality ([ADR-008](#adr-008-idempotent-sql-migrations-as-primary-design-documents)).
6. Rename the NeuCore `ScoringEngine` / `GaitEngine` to remove the
   shadow ([ADR-002](#adr-002-two-layer-browser-architecture-legacy-iife--es-modules)).
7. Wire the placeholder `section-gait` loader or remove the nav item.

## Operational fragility points

| Surface                          | Failure mode                                                                          |
|----------------------------------|---------------------------------------------------------------------------------------|
| Supabase project pause           | First sign-in after a pause can fail before the 75 s timeout if the wake takes longer. |
| GLB asset missing                | A fresh clone or a deploy that excludes `public/` produces a silent gait failure.     |
| Realtime channel disconnect      | No reconnect logic — user must navigate away and back.                                |
| Edge function deploy             | A typo in a secret name (no `ANTHROPIC_API_KEY`) silently triggers the fallback.      |
| RLS regression                   | Without tests, a policy change can either close a feature or open a leak unnoticed.   |

## Long-term maintainability risks

- **No automated tests.** Every clinical regression is caught manually.
  The locked clinical spec is the highest-value test target.
- **Solo-engineer history.** Comments are good but a second pair of
  hands has not yet reviewed the architecture end-to-end.
- **No `CHANGELOG.md`.** Migration filenames are the only audit trail.
- **Two clinical engines** ([ADR-002](#adr-002-two-layer-browser-architecture-legacy-iife--es-modules))
  must be kept in sync by hand.
- **No ADR for the rehab-book methodology.** The clinical references in
  `docs/rehab-book/` are not yet hooked into a "where is this used in
  code?" map.

---

# Recommended Future ADRs

To be drafted as the system evolves:

| ADR # (proposed)  | Title                                                                          | Trigger                                                                       |
|-------------------|--------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| ADR-017           | **Testing strategy for clinical engines**                                      | Once Vitest is introduced. Decides what's a unit test vs an integration test. |
| ADR-018           | **Realtime reconnection policy**                                               | Before any multi-tenant deployment with always-on chat expectations.          |
| ADR-019           | **Asset distribution (Git LFS vs CDN vs bootstrap script)**                    | When the GLB is committed.                                                    |
| ADR-020           | **Multi-tenancy model (per-clinic, per-coach, or shared)**                     | First time a second clinic onboards.                                          |
| ADR-021           | **AI cost + quota strategy**                                                   | When AI usage grows past free-tier limits.                                    |
| ADR-022           | **Internationalisation / localisation**                                        | First non-English market.                                                     |
| ADR-023           | **Audit logging for clinical decisions**                                       | First time a regulator asks for one.                                          |
| ADR-024           | **Versioning policy for the clinical spec**                                    | First time the spec changes and old programs need to keep their old values.   |
| ADR-025           | **Public API surface**                                                         | First third-party integrator (Apple Health, EMR import, wearables).           |
| ADR-026           | **Mobile (PWA vs native wrapper)**                                             | When client adherence demands an installable surface.                         |
| ADR-027           | **Observability stack (logs, errors, metrics)**                                | Before the user base exceeds ~50 active coaches.                              |
| ADR-028           | **Background job runner**                                                      | First time a workflow needs to outlive a tab close (e.g. weekly digests).     |

ADRs are written when the decision is made, not before. Add a file to
this document when a real choice is being weighed, even if the choice
is "we'll do the simplest thing for now" — recording the decision is
more important than the decision being clever.
