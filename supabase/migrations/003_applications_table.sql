-- Captured from the live database on 2026-09-29 via catalog introspection.
-- Reflects the CURRENT state of the `applications` table and its RLS policies.

CREATE TABLE IF NOT EXISTS applications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid,                       -- NOTE: nullable + no FK to auth.users
  position     TEXT        NOT NULL,
  company      TEXT        NOT NULL,
  location     TEXT,
  pay          TEXT,
  status       TEXT        DEFAULT 'Pending',
  notes        TEXT,
  date_applied DATE,
  data_applied DATE,                        -- NOTE: typo/duplicate column, unused by the app
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

-- ⚠️ Public (incl. anon) can SELECT *every* application row — this exposes all
-- users' position/company/notes, not just aggregate counts. Flagged for review.
DROP POLICY IF EXISTS "Anyone can read application counts" ON applications;
CREATE POLICY "Anyone can read application counts" ON applications
  FOR SELECT TO public USING (true);

-- Writes are correctly locked per-user: a user can only insert/update/delete
-- rows where user_id = their own auth.uid().
DROP POLICY IF EXISTS "Users manage own applications" ON applications;
CREATE POLICY "Users manage own applications" ON applications
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
