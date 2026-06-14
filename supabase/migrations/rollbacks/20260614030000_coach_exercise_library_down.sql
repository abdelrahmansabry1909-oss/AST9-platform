-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK — Coach Exercise Library (Phase 5)
-- Restores the prior permissive policies and drops the added columns.
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "exercises_select" on public.exercises;
drop policy if exists "exercises_insert" on public.exercises;
drop policy if exists "exercises_update" on public.exercises;
drop policy if exists "exercises_delete" on public.exercises;

-- Restore the original permissive policies (pre-Phase-5).
create policy "exercises_client_read" on public.exercises
  for select using (true);
create policy "exercises_coach_crud" on public.exercises
  for all using (public.is_coach_or_admin());

alter table public.exercises
  drop column if exists target_area,
  drop column if exists difficulty,
  drop column if exists equipment,
  drop column if exists youtube_url,
  drop column if exists notes,
  drop column if exists channel_url,
  drop column if exists channel_name,
  drop column if exists is_global;
