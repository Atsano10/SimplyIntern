-- 008: Saved / bookmarked jobs. Authored 2026-10-01.
--
-- A shortlist that's distinct from "applied" (applications table): users bookmark
-- listings they're interested in before committing to apply. One row per
-- (user, listing); UNIQUE prevents double-saves and lets the UI treat save as a
-- toggle. Written to the stricter standard than the legacy applications table:
-- user_id is NOT NULL with a real FK to auth.users, and RLS is owner-only.
CREATE TABLE IF NOT EXISTS saved_jobs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id uuid        NOT NULL REFERENCES listings(id)   ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS saved_jobs_user_idx ON saved_jobs (user_id);

ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;

-- Owner-only: a user can see and manage only their own saved rows.
DROP POLICY IF EXISTS "Users manage own saved jobs" ON saved_jobs;
CREATE POLICY "Users manage own saved jobs" ON saved_jobs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
