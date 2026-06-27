-- ════════════════════════════════════════════════════════════════
--  Phase R1C-Backend-1 — Legal Acceptance Foundation
--
--  Backend foundation for MANDATORY, backend-persisted legal acceptance
--  before account use. Supports versioned legal documents, append-only user
--  acceptance audit, required latest-version acceptance, and re-acceptance
--  when a legal version changes. RLS-safe (own + admin reads; append-only;
--  no anonymous write hole). The frontend checkbox / blocking screen is a
--  SEPARATE later phase (Antigravity) and is NOT part of this migration.
--
--  ⚖️  NOT legal advice. Final legal review required before production launch.
--      No legal document TEXT is stored here — only version metadata and a
--      body_ref pointing at future static legal pages.
--
--  Two new tables (ADDITIVE — touches NO existing table; profiles is referenced
--  by FK only):
--    • public.legal_documents    — version registry (admin-managed)
--    • public.legal_acceptances  — append-only acceptance audit log
--
--  Two SECURITY DEFINER RPCs:
--    • has_accepted_current_legal(uuid) — gate read (self or admin)
--    • record_legal_acceptance(jsonb,text) — validated, role-stamped write
--
--  One supporting trigger function (tg_legal_touch) keeps legal_documents.
--  updated_at honest on admin version edits (the column is mandated by spec;
--  a touch trigger is the correct way to maintain it). It is dropped by the
--  rollback. NOT reused from / shared with any other domain.
--
--  Depends on (pre-existing, live):
--    • public.profiles(id, role)
--    • public.is_admin()  (SECURITY DEFINER role helper)
--
--  Additive · idempotent · reversible.
--  Rollback: supabase/rollbacks/20260627000000_legal_acceptance_foundation_down.sql
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- 1. legal_documents — versioned legal document registry.
--    Exactly one CURRENT row per doc_type (partial unique index).
--    is_required marks the documents a user MUST accept to use the account.
-- ════════════════════════════════════════════════════════════════
create table if not exists public.legal_documents (
  id            uuid primary key default gen_random_uuid(),
  doc_type      text not null check (
                  doc_type in ('terms','privacy','medical_disclaimer',
                               'health_data_consent','refund','cookie')),
  version       text not null check (length(btrim(version)) > 0),
  title         text not null check (length(btrim(title)) > 0),
  body_ref      text,                       -- path to future static page; NO legal text in DB
  is_required   boolean not null default false,
  is_current    boolean not null default false,
  effective_from timestamptz not null default now(),
  published_by  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint legal_documents_doc_type_version_key unique (doc_type, version)
);

-- One current document per type (the gate reads is_current rows).
create unique index if not exists idx_legal_documents_one_current_per_type
  on public.legal_documents (doc_type) where is_current = true;

create index if not exists idx_legal_documents_doc_type_current
  on public.legal_documents (doc_type, is_current);
create index if not exists idx_legal_documents_required_current
  on public.legal_documents (is_required, is_current);

-- ════════════════════════════════════════════════════════════════
-- 2. legal_acceptances — APPEND-ONLY audit log. One row per acceptance
--    event; the version columns snapshot what the user agreed to at that
--    moment (so audit survives later document-version changes).
--    role_at_acceptance is stamped server-side (see record_legal_acceptance).
--    ip_hash / user_agent_hash are OPTIONAL, nullable, HASHED-ONLY, and are
--    NOT populated in v1 (no raw IP / user-agent is ever stored).
-- ════════════════════════════════════════════════════════════════
create table if not exists public.legal_acceptances (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references public.profiles(id) on delete cascade,
  accepted_at                 timestamptz not null default now(),
  acceptance_source           text not null check (
                                acceptance_source in ('signup','first_login_gate',
                                                      'reaccept_version_change','admin_seed')),
  role_at_acceptance          text not null check (role_at_acceptance in ('admin','coach','client')),
  terms_version               text,
  privacy_version             text,
  medical_disclaimer_version  text,
  health_data_consent_version text,
  refund_policy_version       text,
  cookie_policy_version       text,
  ip_hash                     text,         -- nullable, hashed-only, not populated in v1
  user_agent_hash             text,         -- nullable, hashed-only, not populated in v1
  created_at                  timestamptz not null default now()
);

create index if not exists idx_legal_acceptances_user_accepted
  on public.legal_acceptances (user_id, accepted_at desc);
create index if not exists idx_legal_acceptances_user
  on public.legal_acceptances (user_id);

-- ════════════════════════════════════════════════════════════════
-- 3. tg_legal_touch — keep legal_documents.updated_at current on UPDATE.
--    Plain trigger function (runs as invoker; no elevated privilege needed).
-- ════════════════════════════════════════════════════════════════
create or replace function public.tg_legal_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.tg_legal_touch() from public, anon, authenticated;

drop trigger if exists trg_legal_documents_touch on public.legal_documents;
create trigger trg_legal_documents_touch
  before update on public.legal_documents
  for each row execute function public.tg_legal_touch();

-- ════════════════════════════════════════════════════════════════
-- 4. has_accepted_current_legal(p_user_id) — compliance check used by the
--    auth gate. TRUE only when the user has, in some acceptance row, the
--    CURRENT version of EVERY required+current legal document.
--    Authorization: self or admin only (a non-admin probing another user
--    always gets FALSE — no cross-user information leak).
-- ════════════════════════════════════════════════════════════════
create or replace function public.has_accepted_current_legal(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_user_id is null then false
    when (select auth.uid()) is null then false
    when p_user_id <> (select auth.uid()) and not public.is_admin() then false
    else not exists (
      -- a required+current doc for which the user has NO matching-version acceptance
      select 1
      from public.legal_documents d
      where d.is_current = true
        and d.is_required = true
        and not exists (
          select 1
          from public.legal_acceptances a
          where a.user_id = p_user_id
            and (case d.doc_type
                   when 'terms'                then a.terms_version
                   when 'privacy'              then a.privacy_version
                   when 'medical_disclaimer'   then a.medical_disclaimer_version
                   when 'health_data_consent'  then a.health_data_consent_version
                   when 'refund'               then a.refund_policy_version
                   when 'cookie'               then a.cookie_policy_version
                 end) = d.version
        )
    )
  end;
$$;

revoke all on function public.has_accepted_current_legal(uuid) from public, anon;
grant execute on function public.has_accepted_current_legal(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. record_legal_acceptance(p_versions, p_source) — the SAFE write path.
--    • user id  = auth.uid()  (rejects null / unauthenticated)
--    • role_at_acceptance stamped from profiles.role (NEVER client input)
--    • validates submitted versions == current required versions (rejects
--      stale / forged input)
--    • inserts ONE append-only acceptance row; returns its id
--    • never stores raw IP / user-agent
--    p_versions is a jsonb map: {"terms":"…","privacy":"…", … , optional refund/cookie}
-- ════════════════════════════════════════════════════════════════
create or replace function public.record_legal_acceptance(p_versions jsonb, p_source text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_role    text;
  v_missing text;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- 'admin_seed' is reserved for out-of-band seeding, never a real user acceptance.
  if p_source is null
     or p_source not in ('signup','first_login_gate','reaccept_version_change') then
    raise exception 'invalid acceptance_source: %', coalesce(p_source, '(null)')
      using errcode = '22023';
  end if;

  if p_versions is null or jsonb_typeof(p_versions) <> 'object' then
    raise exception 'p_versions must be a json object' using errcode = '22023';
  end if;

  -- Stamp the role from the DB, not from anything the client supplied.
  select role into v_role from public.profiles where id = v_uid;
  if v_role is null then
    raise exception 'no profile for user' using errcode = 'P0002';
  end if;

  -- Every required+current document must be present with its CURRENT version.
  select string_agg(d.doc_type, ', ' order by d.doc_type) into v_missing
  from public.legal_documents d
  where d.is_current = true
    and d.is_required = true
    and coalesce(p_versions ->> d.doc_type, '') <> d.version;
  if v_missing is not null then
    raise exception 'submitted versions do not match current required legal documents: %', v_missing
      using errcode = '22023';
  end if;

  insert into public.legal_acceptances (
    user_id, acceptance_source, role_at_acceptance,
    terms_version, privacy_version, medical_disclaimer_version,
    health_data_consent_version, refund_policy_version, cookie_policy_version
  )
  values (
    v_uid, p_source, v_role,
    p_versions ->> 'terms',
    p_versions ->> 'privacy',
    p_versions ->> 'medical_disclaimer',
    p_versions ->> 'health_data_consent',
    p_versions ->> 'refund',
    p_versions ->> 'cookie'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_legal_acceptance(jsonb, text) from public, anon;
grant execute on function public.record_legal_acceptance(jsonb, text) to authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6. RLS
-- ════════════════════════════════════════════════════════════════

-- ── legal_documents: authenticated read; admin-only insert/update; no delete ──
alter table public.legal_documents enable row level security;

drop policy if exists "legal_documents_select" on public.legal_documents;
create policy "legal_documents_select" on public.legal_documents
  for select to authenticated
  using (true);

drop policy if exists "legal_documents_insert" on public.legal_documents;
create policy "legal_documents_insert" on public.legal_documents
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "legal_documents_update" on public.legal_documents;
create policy "legal_documents_update" on public.legal_documents
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
-- (no DELETE policy — published versions are retained for audit/history)

-- ── legal_acceptances: own + admin read; own insert; APPEND-ONLY (no update/delete) ──
alter table public.legal_acceptances enable row level security;

drop policy if exists "legal_acceptances_select" on public.legal_acceptances;
create policy "legal_acceptances_select" on public.legal_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Defense-in-depth own-row insert. The integrity-enforcing path is the
-- record_legal_acceptance() RPC (validates versions + stamps role server-side).
drop policy if exists "legal_acceptances_insert" on public.legal_acceptances;
create policy "legal_acceptances_insert" on public.legal_acceptances
  for insert to authenticated
  with check (user_id = (select auth.uid()));
-- (no UPDATE policy, no DELETE policy — acceptance history is append-only)

-- ════════════════════════════════════════════════════════════════
-- 7. Seed initial CURRENT document versions (metadata only — NO legal text).
--    Required (blocking): terms, privacy, medical_disclaimer, health_data_consent.
--    Versioned + linked but not blocking in v1: refund, cookie.
--    Idempotent via the (doc_type, version) unique constraint.
-- ════════════════════════════════════════════════════════════════
insert into public.legal_documents (doc_type, version, title, body_ref, is_required, is_current)
values
  ('terms',                '2026-06-27', 'Terms of Service',                    '/legal/terms.html',                 true,  true),
  ('privacy',              '2026-06-27', 'Privacy Policy',                      '/legal/privacy.html',               true,  true),
  ('medical_disclaimer',   '2026-06-27', 'Medical Disclaimer',                  '/legal/medical-disclaimer.html',    true,  true),
  ('health_data_consent',  '2026-06-27', 'Consent to Process Health/Rehab Data','/legal/health-data-consent.html',   true,  true),
  ('refund',               '2026-06-27', 'Refund Policy',                       '/legal/refund-policy.html',         false, true),
  ('cookie',               '2026-06-27', 'Cookie Policy',                       '/legal/cookie-policy.html',         false, true)
on conflict (doc_type, version) do nothing;

-- ── Smoke (after apply, impersonated) ───────────────────────────
--   any authenticated  → SELECT legal_documents               -> 6 rows (read ok)
--   non-admin user      → INSERT legal_documents              -> 42501 (admin only)
--   client/coach        → SELECT another user's acceptances   -> 0 rows (own+admin only)
--   client              → has_accepted_current_legal(self)    -> false (none accepted yet)
--   client              → record_legal_acceptance(current,'first_login_gate') -> uuid, then
--                         has_accepted_current_legal(self)    -> true
--   client              → record_legal_acceptance(stale)      -> 22023 (rejected)
--   any                 → UPDATE/DELETE legal_acceptances     -> 0 rows / blocked (append-only)
