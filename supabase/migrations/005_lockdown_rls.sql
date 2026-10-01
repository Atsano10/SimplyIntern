-- 005: Lock RLS down to least-privilege + provide safe access paths.
-- Authored 2026-09-29. Closes two live read-leaks found by auditing 002/003:
--   * applications were world-readable (position/company/notes exposed)
--   * profiles were world-readable (emails exposed -> enumeration)
-- The leaderboard and username checks that RELIED on those open reads are
-- given dedicated, minimal-exposure replacements below.

-- 1. Leaderboard aggregate. Exposes ONLY username + counts (never emails or
--    notes). Runs with the view owner's rights (default security_invoker=off),
--    so it can still read the base tables after we lock their RLS below.
DROP VIEW IF EXISTS public.leaderboard_scores;
CREATE VIEW public.leaderboard_scores AS
SELECT
  p.username,
  count(*) FILTER (WHERE a.status = 'Rejected')                             AS rejected,
  count(*) FILTER (WHERE a.status IN ('Pending','Applied','Interview'))     AS pending,
  count(*) FILTER (WHERE a.status = 'Rejected')
    + count(*) FILTER (WHERE a.status IN ('Pending','Applied','Interview')) AS score
FROM public.profiles p
LEFT JOIN public.applications a ON a.user_id = p.id
WHERE p.leaderboard_opt_out = false
GROUP BY p.id, p.username;

GRANT SELECT ON public.leaderboard_scores TO anon, authenticated;

-- 2. Safe username-availability check. Usernames are already public (shown on
--    the leaderboard), so a boolean "does this exist?" leaks nothing. Excludes
--    the caller's own row so a user can re-save their own username. Used by
--    Google-OAuth signup and the settings username change without reading the
--    now-locked profiles table.
CREATE OR REPLACE FUNCTION public.username_exists(p_username text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE username = p_username
      AND id IS DISTINCT FROM auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.username_exists(text) TO anon, authenticated;

-- 3. Enforce email uniqueness at the DB level (replaces the racy app-side
--    SELECT-then-insert check). Guarded so re-running is safe. NOTE: fails if
--    duplicate emails already exist in profiles — see the chat if it errors.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_email_key') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);
  END IF;
END $$;

-- 4. Tighten applications: drop the world-readable SELECT. Owners keep full
--    access to their own rows via the existing "Users manage own applications"
--    ALL policy (which already covers SELECT of own rows).
DROP POLICY IF EXISTS "Anyone can read application counts" ON public.applications;

-- 5. Tighten profiles: drop BOTH world-readable SELECT policies. Users keep
--    read/insert/update of their OWN profile via the remaining policies.
DROP POLICY IF EXISTS "Allow public to check duplicates" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can read all profiles" ON public.profiles;
