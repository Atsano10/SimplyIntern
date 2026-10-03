-- 013: Recruitment cycles / folders. Authored 2026-10-03.
--
-- Lets students organize applications into folders (recruitment cycles), reset
-- between cycles, and keeps the leaderboard scoped to a single current cycle so
-- everyone competes on equal footing.
--
-- Pieces:
--   1. applications.cycle  — which folder an application belongs to.
--   2. folders             — per-user CUSTOM folders (predefined cycles live in the
--                            frontend as constants and are always shown).
--   3. leaderboard_scores  — rebuilt to count ONLY the current cycle.

-- 1. Folder label on each application. Existing rows join the current cycle so they
--    keep counting on the leaderboard.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS cycle text NOT NULL DEFAULT '2026 Summer';
UPDATE applications SET cycle = '2026 Summer' WHERE cycle IS NULL OR cycle = '';

-- 2. Custom folders, owner-only. Predefined cycles (2026 Summer/Winter/Spring) are
--    NOT stored here — the frontend always offers them; this table is only the
--    user-created extras, so an empty custom folder still persists across devices.
CREATE TABLE IF NOT EXISTS folders (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS folders_user_idx ON folders (user_id);

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own folders" ON folders;
CREATE POLICY "Users manage own folders" ON folders
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Scope the leaderboard to the CURRENT cycle. Only the cycle filter is added to
--    the join; the score logic is unchanged from migration 005. Bump the cycle
--    literal below each season (keep it in sync with CURRENT_CYCLE in util.js).
DROP VIEW IF EXISTS public.leaderboard_scores;
CREATE VIEW public.leaderboard_scores AS
SELECT
  p.username,
  count(*) FILTER (WHERE a.status = 'Rejected')                             AS rejected,
  count(*) FILTER (WHERE a.status IN ('Pending','Applied','Interview'))     AS pending,
  count(*) FILTER (WHERE a.status = 'Rejected')
    + count(*) FILTER (WHERE a.status IN ('Pending','Applied','Interview')) AS score
FROM public.profiles p
LEFT JOIN public.applications a
  ON a.user_id = p.id
  AND a.cycle = '2026 Summer'   -- CURRENT CYCLE — bump each season
WHERE p.leaderboard_opt_out = false
GROUP BY p.id, p.username;

GRANT SELECT ON public.leaderboard_scores TO anon, authenticated;
