-- 017: Cascade-delete applications with their auth user. Authored 2026-10-03.
--
-- applications.user_id never had an FK to auth.users (see 003), so deleting a user from
-- the dashboard left their applications behind. A deleted user's access token stays
-- valid until it expires (up to an hour), and RLS only compares auth.uid() = user_id —
-- so that user could keep reading and writing their orphaned rows. With this FK the
-- rows vanish with the account and any new insert fails the FK check. profiles (015)
-- and saved_jobs (008) already cascade, so this closes the last gap.
--
-- 1. Delete applications with no backing auth user (dead rows; includes NULL user_id,
--    which no RLS policy could ever expose anyway).
-- 2. Add the cascade FK + make user_id NOT NULL.

DELETE FROM public.applications a
WHERE a.user_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id);

ALTER TABLE public.applications ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_user_id_fkey') THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
