-- ═══════════════════════════════════════════════════════════════
--  Case Study approval workflow
--  Coaches submit case studies in Community → an admin approves /
--  rejects them → approved cases surface in the Case Studies carousel.
--
--  Applied to project byquokhcbagofshsclfy on 2026-05-23.
-- ═══════════════════════════════════════════════════════════════

-- 1. Approval columns on case_shares ----------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'case_shares'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE case_shares
      ADD COLUMN status text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','approved','rejected'));
    -- Rows that predate the approval flow were already public on the
    -- board, so grandfather them in as approved.
    UPDATE case_shares SET status = 'approved';
  END IF;
END $$;

ALTER TABLE case_shares
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text;

CREATE INDEX IF NOT EXISTS idx_case_shares_status ON case_shares(status);

-- 2. Row Level Security ----------------------------------------------
-- Read  : anyone may see APPROVED cases; authors see their own (any
--         status); admins see everything.
-- Insert: a coach may only create rows owned by themselves.
-- Update: admin-only — this is the approve/reject gate, so a coach
--         can never self-approve their own submission.
-- Delete: the author or an admin.
DROP POLICY IF EXISTS "case_shares_read"   ON case_shares;
DROP POLICY IF EXISTS "case_shares_edit"   ON case_shares;
DROP POLICY IF EXISTS "case_shares_insert" ON case_shares;
DROP POLICY IF EXISTS "case_shares_update" ON case_shares;
DROP POLICY IF EXISTS "case_shares_delete" ON case_shares;

CREATE POLICY "case_shares_read" ON case_shares
  FOR SELECT USING (
    status = 'approved'
    OR auth.uid() = coach_id
    OR public.is_admin()
  );

CREATE POLICY "case_shares_insert" ON case_shares
  FOR INSERT WITH CHECK (auth.uid() = coach_id);

CREATE POLICY "case_shares_update" ON case_shares
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "case_shares_delete" ON case_shares
  FOR DELETE USING (auth.uid() = coach_id OR public.is_admin());

-- 3. Function grants -------------------------------------------------
-- Evaluating an RLS policy requires EXECUTE on every function it
-- references — for every role that may run the query, anon included.
-- Without these, a logged-out (or under-privileged) request errors out
-- instead of simply returning the rows its policy allows.
GRANT EXECUTE ON FUNCTION public.is_admin()          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_coach()          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_coach_or_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_coach() TO anon, authenticated;
