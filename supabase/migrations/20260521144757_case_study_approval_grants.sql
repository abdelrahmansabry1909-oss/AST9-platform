-- ═══════════════════════════════════════════════════════════════
--  Case Study approval — function grants
--  Companion to 20260521142823_case_study_approval.sql.
--  Split out to match the remote registry's two-version layout.
--
--  Evaluating an RLS policy requires EXECUTE on every function it
--  references — for every role that may run the query, anon included.
--  Without these, a logged-out (or under-privileged) request errors
--  out instead of returning the rows its policy allows.
-- ═══════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.is_admin()          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_coach()          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_coach_or_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_coach() TO anon, authenticated;
