-- 022: Enforce the username format in the database. Authored 2026-10-06.
--
-- Usernames are public (they're shown on the leaderboard), but the only rules were
-- in the browser, so anyone could store a 5,000-character name, emoji, spaces, or
-- look-alike characters straight through the API. This makes the database the source
-- of truth: 3-20 characters, letters, digits and underscores only.
-- The same rule lives in frontend/js/util.js (USERNAME_PATTERN), so signup and
-- settings can explain the problem before sending anything.
--
-- Step 1 renames any existing username that breaks the rule (so step 2 can't fail):
-- other characters become "_", it's cut to 20, padded to 3, and a number is added if
-- the result is already taken. Renamed rows are listed as NOTICEs in the output.

DO $$
DECLARE
  r         record;
  base      text;
  candidate text;
  n         int;
BEGIN
  FOR r IN
    SELECT id, username FROM public.profiles
    WHERE username !~ '^[A-Za-z0-9_]{3,20}$'
  LOOP
    base := left(regexp_replace(coalesce(r.username, ''), '[^A-Za-z0-9_]', '_', 'g'), 20);
    IF base ~ '^_*$' THEN base := 'user'; END IF;   -- nothing usable was left
    -- Only pad short names: rpad also CUTS longer strings down to the length given.
    IF length(base) < 3 THEN base := rpad(base, 3, '_'); END IF;

    candidate := base;
    n := 0;
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = candidate AND id <> r.id) LOOP
      n := n + 1;
      candidate := left(base, 20 - length(n::text)) || n::text;
    END LOOP;

    UPDATE public.profiles SET username = candidate WHERE id = r.id;
    RAISE NOTICE 'Renamed username % -> %', r.username, candidate;
  END LOOP;
END $$;

-- Step 2: the rule itself. Guarded so re-running the migration is safe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_format') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_username_format CHECK (username ~ '^[A-Za-z0-9_]{3,20}$');
  END IF;
END $$;
