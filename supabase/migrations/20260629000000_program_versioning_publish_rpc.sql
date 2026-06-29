-- ════════════════════════════════════════════════════════════════
--  Phase R2B — Program Versioning + Single Active Published Program Rule
--
--  Scope (owner decision): OPTION (a) — history over time only. For each
--  client there is EXACTLY ONE client-visible active published program at a
--  time. Concurrent separate active program "families" are explicitly NOT
--  built here (a future phase if ever needed).
--
--  This migration is ADDITIVE and does three things:
--   1. Widens client_program_versions.status to allow a coach-only 'draft'
--      (drafts are never client-visible: client RLS requires published=true).
--   2. Adds a HARD database guarantee that a client can never have two active
--      versions at once (partial unique index where status='active') — this is
--      the structural prevention of the "client sees two active programs" bug.
--   3. Adds public.publish_program_version() — an atomic, SECURITY DEFINER
--      RPC that supersedes the prior active version, activates the chosen one,
--      and updates the single client_programs pointer + revision audit, in one
--      transaction.
--
--  UNCHANGED / PRESERVED:
--   • client_programs stays the single client-visible pointer (its existing
--     UNIQUE(client_id) is the primary one-active guarantee; NOT relaxed).
--   • client_program_revisions remains the legacy revision audit trail (the RPC
--     keeps writing it, mirroring the existing publish flow).
--   • workout_sessions / workout_exercise_logs are NOT touched — historical
--     logs stay attached to the program/version/client_programs row they were
--     performed under (snapshot-safe; no log is ever rewritten).
--   • RLS on client_program_versions / client_programs is ALREADY correct
--     (client = own + published + effective_from<=now(); coach = assigned;
--     admin = all) and is therefore NOT changed here. Drafts (published=false)
--     are already coach-only under the existing policies.
--   • No auth / subscription / Athletic / legal objects are touched.
--
--  Additive · idempotent · reversible · RLS-safe · no destructive data change.
--  Rollback: supabase/rollbacks/20260629000000_program_versioning_publish_rpc_down.sql
--
--  Depends on (pre-existing, live):
--   • public.client_program_versions   (20260624000000 — E1b)
--   • public.client_programs           (20260522000000 — UNIQUE(client_id))
--   • public.client_program_revisions  (20260615000000 — program modes audit)
--   • public.profiles(id, assigned_coach), public.is_admin()
-- ════════════════════════════════════════════════════════════════

-- ── 1. Widen status to allow a coach-only 'draft' ────────────────
--    (drop+add the SAME named CHECK with a wider value set — additive, no
--    data change; existing rows all use the original four values.)
alter table public.client_program_versions
  drop constraint if exists client_program_versions_status_check;
alter table public.client_program_versions
  add constraint client_program_versions_status_check
  check (status in ('draft','scheduled','active','superseded','archived'));

-- Defense in depth: a 'draft' must never be published (so it can never satisfy
-- the client SELECT predicate, which requires published=true).
alter table public.client_program_versions
  drop constraint if exists client_program_versions_draft_unpublished_chk;
alter table public.client_program_versions
  add constraint client_program_versions_draft_unpublished_chk
  check (status <> 'draft' or published = false);

-- An 'active' version must always be published (the active row IS the client-
-- visible one). Safe with current live data (all active rows are published).
alter table public.client_program_versions
  drop constraint if exists client_program_versions_active_published_chk;
alter table public.client_program_versions
  add constraint client_program_versions_active_published_chk
  check (status <> 'active' or published = true);

-- ── 2. HARD single-active guarantee ──────────────────────────────
--    At most ONE active version per client. This is the structural backstop
--    that makes "client sees two active programs" impossible even under
--    concurrent publishes (the second committer hits this unique violation).
create unique index if not exists uq_cpv_one_active_per_client
  on public.client_program_versions(client_id)
  where status = 'active';

-- ── 3. Tighten the CLIENT read: ACTIVE published only ────────────
--    Re-create cpv_select so the CLIENT branch additionally requires
--    status='active'. Without this, a client could — at the TABLE level —
--    read an older still-published superseded/archived version (the product
--    rule must hold in RLS, not only in the UI's client_programs query).
--    Coach/admin history visibility (ALL statuses incl. drafts) is preserved
--    verbatim — only the client branch is tightened.
drop policy if exists "cpv_select" on public.client_program_versions;
create policy "cpv_select" on public.client_program_versions
  for select to authenticated
  using (
    (
      client_id = (select auth.uid())
      and status = 'active'
      and published = true
      and effective_from <= now()
    )
    or public.is_admin()
    or coach_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = client_program_versions.client_id
        and p.assigned_coach = (select auth.uid())
    )
  );

-- ── 4. publish_program_version() — atomic publish/republish ──────
--    Supersede prior active → activate target → update the single pointer →
--    write the revision audit, all in one transaction. Authorization is
--    enforced IN-FUNCTION (admin / owning coach / assigned coach); there is no
--    client write path. SECURITY DEFINER + pinned search_path.
create or replace function public.publish_program_version(
  p_version_id uuid,
  p_change_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ver     public.client_program_versions%rowtype;
  v_uid     uuid := (select auth.uid());
  v_allowed boolean;
  v_cp_id   uuid;
  v_new_rev int;
  v_note    text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Lock the target version row for the duration of the transaction.
  select * into v_ver
    from public.client_program_versions
   where id = p_version_id
   for update;
  if not found then
    raise exception 'program version % not found', p_version_id using errcode = 'P0002';
  end if;

  -- Authorize: admin, the owning coach, or the client's assigned coach.
  v_allowed := public.is_admin()
    or v_ver.coach_id = v_uid
    or exists (
      select 1 from public.profiles p
      where p.id = v_ver.client_id and p.assigned_coach = v_uid
    );
  if not v_allowed then
    raise exception 'not authorized to publish this version' using errcode = '42501';
  end if;

  v_note := coalesce(p_change_note, v_ver.change_note);

  -- (a) Supersede any OTHER active version for this client (keep the target).
  update public.client_program_versions
     set status = 'superseded', updated_at = now()
   where client_id = v_ver.client_id
     and status = 'active'
     and id <> v_ver.id;

  -- (b) Activate + publish the target version, effective now.
  update public.client_program_versions
     set status = 'active', published = true,
         effective_from = now(), published_at = now(),
         change_note = v_note, updated_at = now()
   where id = v_ver.id;

  -- (c) Update the single client-visible pointer (UNIQUE per client). Existing
  --     program_mode is preserved (kept off the jsonb); revision increments.
  insert into public.client_programs
    (client_id, coach_id, program, published, published_at, revision, change_note, changed_by, updated_at)
  values
    (v_ver.client_id, v_ver.coach_id, v_ver.program, true, now(), 1, v_note, v_uid, now())
  on conflict (client_id) do update
    set program      = excluded.program,
        coach_id     = coalesce(client_programs.coach_id, excluded.coach_id),
        published    = true,
        published_at = now(),
        revision     = client_programs.revision + 1,
        change_note  = excluded.change_note,
        changed_by   = v_uid,
        updated_at   = now()
  returning id, revision into v_cp_id, v_new_rev;

  -- (d) Snapshot the revision into the audit trail (mirrors the existing flow;
  --     program_mode read back from the preserved pointer row).
  insert into public.client_program_revisions
    (program_id, client_id, coach_id, revision, program, program_mode, change_note, changed_by)
  select v_cp_id, v_ver.client_id, cp.coach_id, v_new_rev, v_ver.program, cp.program_mode, v_note, v_uid
    from public.client_programs cp
   where cp.id = v_cp_id;

  -- Link the published version back to the pointer for history/joins.
  update public.client_program_versions
     set source_program_id = v_cp_id, source_revision = v_new_rev
   where id = v_ver.id;

  return v_ver.id;
end;
$$;

revoke all on function public.publish_program_version(uuid, text) from public, anon;
grant execute on function public.publish_program_version(uuid, text) to authenticated;

-- ── Smoke (after apply, impersonated) ───────────────────────────
--   coach → insert a draft version (published=false,status='draft')   -> ok, client can't see it
--   coach → publish_program_version(v2)                               -> v1 superseded, v2 active, pointer=v2
--   client → SELECT active versions                                   -> exactly 1 (v2)
--   coach  → SELECT versions for client                               -> sees v1(superseded)+v2(active)+drafts
--   any    → 2nd concurrent publish to a different version            -> uq_cpv_one_active_per_client blocks dup active
--   draft with published=true                                         -> rejected by draft_unpublished_chk
--   workout_sessions / workout_exercise_logs                          -> unchanged (no rewrite)
