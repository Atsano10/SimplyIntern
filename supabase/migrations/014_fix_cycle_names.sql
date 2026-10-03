-- 014: Correct cycle names to internship START seasons. Authored 2026-10-03.
--
-- Migration 013 seeded a placeholder current cycle ('2026 Summer'). Folders are
-- actually named by when the internship STARTS, not when you apply — so students
-- applying in late 2026 are targeting 2027 Summer / 2027 Spring / 2026 Winter.
-- Move the placeholder data into the real current cycle and point the leaderboard
-- + the column default at it.

-- Everything backfilled to the placeholder was really current-cycle work.
UPDATE applications SET cycle = '2027 Summer' WHERE cycle = '2026 Summer';

ALTER TABLE applications ALTER COLUMN cycle SET DEFAULT '2027 Summer';

-- Point the leaderboard at the new current cycle (same scoring as before).
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
  AND a.cycle = '2027 Summer'   -- CURRENT CYCLE — bump each season
WHERE p.leaderboard_opt_out = false
GROUP BY p.id, p.username;

GRANT SELECT ON public.leaderboard_scores TO anon, authenticated;
