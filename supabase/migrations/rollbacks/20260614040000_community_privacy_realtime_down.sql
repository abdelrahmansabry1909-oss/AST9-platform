-- ════════════════════════════════════════════════════════════════
--  Rollback for 20260614040000_community_privacy_realtime.sql
--  Restores the prior (permissive) SELECT policies and removes the
--  community tables from the realtime publication.
--  NOTE: the prior policies leaked cross-tenant content — only run this
--  if you must revert the privacy fix.
-- ════════════════════════════════════════════════════════════════

-- ── Restore prior client_posts SELECT (any coach/admin saw all) ──
drop policy if exists "client_posts_select" on public.client_posts;
create policy "client_posts_select" on public.client_posts
  for select to public
  using (
    ((select auth.uid()) = client_id)
    or public.is_admin()
    or (exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = any (array['coach','admin'])
    ))
  );

-- ── Restore prior client_comments SELECT (any coach/admin saw all) ─
drop policy if exists "client_comments_select" on public.client_comments;
create policy "client_comments_select" on public.client_comments
  for select to public
  using (
    ((select auth.uid()) = author_id)
    or public.is_admin()
    or (exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = any (array['coach','admin'])
    ))
  );

-- ── Remove community tables from the realtime publication ────────
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname='supabase_realtime' and schemaname='public' and tablename='client_comments') then
    alter publication supabase_realtime drop table public.client_comments;
  end if;
  if exists (select 1 from pg_publication_tables
             where pubname='supabase_realtime' and schemaname='public' and tablename='client_posts') then
    alter publication supabase_realtime drop table public.client_posts;
  end if;
  if exists (select 1 from pg_publication_tables
             where pubname='supabase_realtime' and schemaname='public' and tablename='coach_messages') then
    alter publication supabase_realtime drop table public.coach_messages;
  end if;
end $$;
