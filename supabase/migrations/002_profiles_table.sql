-- Captured from the live database on 2026-09-29 via catalog introspection.
-- Reflects the CURRENT state of the `profiles` table and its RLS policies.
-- NOTE: some of these policies are intentionally permissive and are flagged
-- for review in a follow-up migration (see the security notes in the PR/chat).

CREATE TABLE IF NOT EXISTS profiles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  username            VARCHAR     NOT NULL UNIQUE,
  email               VARCHAR,
  leaderboard_opt_out BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Unique username is enforced at the DB level (source of truth for signup).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key ON profiles (username);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ⚠️ Anon can read every profile row (incl. email) — enables email enumeration.
DROP POLICY IF EXISTS "Allow public to check duplicates" ON profiles;
CREATE POLICY "Allow public to check duplicates" ON profiles
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow users to insert their own profile" ON profiles;
CREATE POLICY "Allow users to insert their own profile" ON profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Allow users to read their own profile" ON profiles;
CREATE POLICY "Allow users to read their own profile" ON profiles
  FOR SELECT TO public USING (auth.uid() = id);

-- ⚠️ Any logged-in user can read every profile row (incl. others' emails).
DROP POLICY IF EXISTS "Authenticated users can read all profiles" ON profiles;
CREATE POLICY "Authenticated users can read all profiles" ON profiles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE TO public USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
