-- 023: Leaderboard shows the top 50 scorers, plus your exact rank wherever you are.
-- Authored 2026-10-06.
--
-- Before: leaderboard.js downloaded every profile from leaderboard_scores (018),
-- including everyone with 0 points, and "Your Standing" never showed a rank.
--
-- Now:
--   leaderboard_ranked  (internal) every user with score > 0, numbered in board order.
--                       The ONE place the ordering is defined, so the table and your
--                       rank can't disagree.
--   leaderboard_top     (public)   the first 50 rows of leaderboard_ranked.
--   my_leaderboard_score()         also returns your rank (NULL if you have 0 points or
--                                  opted out of the board).
--   leaderboard_scores  no longer readable through the API, so the 50 cap is enforced
--                       by the database, not just by the page.
--
-- Ties are ordered by username (same as the page always did), so every rank is unique.
--
-- Safe to re-run.

-- my_leaderboard_score's return type changes (adds rank), which CREATE OR REPLACE
-- can't do, so drop it and the views first and recreate them below.
DROP FUNCTION IF EXISTS public.my_leaderboard_score();
DROP VIEW IF EXISTS public.leaderboard_top;
DROP VIEW IF EXISTS public.leaderboard_ranked;

-- ── 1. Ranking (internal) ────────────────────────────────────────────────────
CREATE VIEW public.leaderboard_ranked AS
SELECT row_number() OVER (ORDER BY score DESC, username) AS rank,
       username, rejected, pending, score
FROM public.leaderboard_scores
WHERE score > 0;

-- Supabase's default privileges grant new views to anon/authenticated; this one is
-- internal (the full list is what the 50 cap is meant to hide).
REVOKE ALL ON public.leaderboard_ranked FROM anon, authenticated;

-- ── 2. Top 50 (public) ───────────────────────────────────────────────────────
-- Runs as the view owner, like leaderboard_scores, so it can read the internal views.
CREATE VIEW public.leaderboard_top AS
SELECT rank, username, rejected, pending, score
FROM public.leaderboard_ranked
WHERE rank <= 50;

GRANT SELECT ON public.leaderboard_top TO anon, authenticated;

-- ── 3. The full board is no longer public ────────────────────────────────────
-- Nothing on the site reads it any more (leaderboard.js uses leaderboard_top).
REVOKE ALL ON public.leaderboard_scores FROM anon, authenticated;

-- ── 4. Your score + rank ─────────────────────────────────────────────────────
-- Same as 018, plus rank. Ranked by username because leaderboard_ranked has no user
-- ids; usernames are unique (profiles_username_key), so the match is exact.
CREATE FUNCTION public.my_leaderboard_score()
RETURNS TABLE (rejected bigint, pending bigint, score bigint, rank bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(c.rejected, 0),
         coalesce(c.pending, 0),
         coalesce(c.rejected, 0) + coalesce(c.pending, 0),
         r.rank
  FROM (SELECT auth.uid() AS uid) me
  LEFT JOIN leaderboard_counts c ON c.user_id = me.uid
  LEFT JOIN profiles p           ON p.id = me.uid
  LEFT JOIN leaderboard_ranked r ON r.username = p.username;
$$;

REVOKE ALL ON FUNCTION public.my_leaderboard_score() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_leaderboard_score() TO authenticated;
