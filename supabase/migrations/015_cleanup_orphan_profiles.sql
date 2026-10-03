-- 015: Remove orphan profiles + prevent future ones. Authored 2026-10-03.
--
-- profiles.id had no FK to auth.users, so deleting (or recreating) an auth user left
-- its profile row behind as an orphan. Because profiles.email is UNIQUE, an orphan
-- holding an email BLOCKS the live account that reuses that email from ever creating
-- its own profile — the account accumulates applications but can never appear on the
-- (profile-driven) leaderboard, and its username/email show blank in the UI.
--
-- 1. Delete any profile with no backing auth user (safe by definition — dead rows).
-- 2. Add a cascade FK so a deleted auth user takes its profile with it, for good.

DELETE FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
