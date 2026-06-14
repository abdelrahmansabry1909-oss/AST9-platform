-- ════════════════════════════════════════════════════════════════
--  Community privacy hardening + realtime enablement
--
--  BUG 2 (P0 — cross-tenant leak): the SELECT policies on client_posts
--    and client_comments let ANY coach/admin read EVERY client's posts
--    and comments — so a coach could see content belonging to clients
--    assigned to *other* coaches. Tighten to:
--      • the client (owner) — their own posts/comments
--      • the post owner    — comments on their own posts (so a coach's
--                            reply is visible to that client)
--      • the ASSIGNED coach — only their own clients' content
--      • admin             — everything
--    Client→client visibility is unchanged (a client still only sees
--    their own posts), so this only ever *removes* access; no client
--    gains visibility they didn't already have.
--
--  BUG 3 (no auto-refresh): coach_messages / client_posts /
--    client_comments were never members of the supabase_realtime
--    publication, so the app's existing postgres_changes subscriptions
--    never fired. Publish them so messaging, the community feed, and
--    comments update live. Realtime enforces the same RLS policies
--    above, so live delivery stays private.
--
--  Reversible — see rollbacks/20260614040000_community_privacy_realtime_down.sql
-- ════════════════════════════════════════════════════════════════

-- ── client_posts: owner / assigned-coach / admin ────────────────
drop policy if exists "client_posts_select" on public.client_posts;
create policy "client_posts_select" on public.client_posts
  for select to public
  using (
    (select auth.uid()) = client_id
    or public.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = client_posts.client_id
        and p.assigned_coach = (select auth.uid())
    )
  );

-- ── client_comments: author / post-owner / assigned-coach / admin ─
drop policy if exists "client_comments_select" on public.client_comments;
create policy "client_comments_select" on public.client_comments
  for select to public
  using (
    (select auth.uid()) = author_id
    or public.is_admin()
    or exists (
      select 1 from public.client_posts cp
      where cp.id = client_comments.post_id
        and cp.client_id = (select auth.uid())
    )
    or exists (
      select 1 from public.client_posts cp
      join public.profiles p on p.id = cp.client_id
      where cp.id = client_comments.post_id
        and p.assigned_coach = (select auth.uid())
    )
  );

-- ── Realtime: publish the community tables (RLS still enforced) ──
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='coach_messages') then
    alter publication supabase_realtime add table public.coach_messages;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='client_posts') then
    alter publication supabase_realtime add table public.client_posts;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='client_comments') then
    alter publication supabase_realtime add table public.client_comments;
  end if;
end $$;
