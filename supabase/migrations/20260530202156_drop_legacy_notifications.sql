-- ═══════════════════════════════════════════════════════════════
--  Path-A precursor to the Notifications Inbox migration (F3)
--
--  A legacy empty `notifications` table predated the F3 work with
--  schema (user_id, from_user_id, type, title, message, is_read).
--  Pre-drop verification confirmed 0 rows + 0 dependencies. Dropping
--  it CASCADE lets 20260530202555_notifications_inbox.sql recreate
--  the table with the F3 polymorphic-inbox schema cleanly.
--
--  Idempotent — IF EXISTS guard means this is safe to run on any
--  database (fresh preview or production) without errors.
-- ═══════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.notifications CASCADE;
