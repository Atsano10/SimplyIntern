-- 025: Usernames are unique ignoring case, and offensive ones are blocked.
-- Authored 2026-10-06.
--
-- 1. "Gavin" and "gavin" could both exist: the unique rule compared exact text, which
--    allows look-alikes on the public leaderboard. Uniqueness is now on lower(username).
-- 2. Nothing stopped slurs or explicit names, which are shown publicly on the
--    leaderboard. username_is_offensive() is enforced by a CHECK constraint.
--
-- Signup and settings ask check_username() first, so people get a clear message; the
-- constraints are what actually enforce the rules.
--
-- Existing names that break either rule are renamed first (listed as NOTICEs):
--   offensive          -> user, user1, user2, ...
--   case clash         -> the oldest account keeps its name; later ones get a number
--
-- Safe to re-run.

-- ── 1. What counts as offensive ──────────────────────────────────────────────
-- The name is split into words on "_" and camelCase ("BigAss" -> big, ass), common
-- digit swaps are undone (sh1t, a55), and leftover digits are dropped. Repeated
-- letters still match ("fuuuck"), since each letter of a blocked word may repeat.
--
-- Two lists, because of the "Scunthorpe problem" — short words hide inside normal ones:
--   anywhere:  words that essentially never appear inside an innocent word, matched
--              anywhere in the name, even across "_" (f_u_c_k).
--   whole word: words that do ("class", "Dickson", "therapist", "Sussex", and "shit"
--              in surnames like Yamashita or Dikshit), blocked only as a separate
--              word in the name (plurals included).
-- No list is perfect; this aims to stop the obvious cases without blocking real names.
CREATE OR REPLACE FUNCTION public.username_is_offensive(p_username text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  WITH words AS (
    SELECT regexp_replace(translate(lower(w), '0134578', 'oieastb'), '[0-9]', '', 'g') AS w
    FROM unnest(regexp_split_to_array(
           regexp_replace(coalesce(p_username, ''), '([a-z])([A-Z])', '\1_\2', 'g'), '_+')) AS w
  ),
  joined AS (SELECT string_agg(w, '') AS s FROM words)
  SELECT
    EXISTS (
      SELECT 1 FROM joined, unnest(ARRAY[
        'fuck', 'bullshit', 'shithead', 'shitty', 'dipshit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore',
        'slut', 'pussy', 'penis', 'vagina', 'dildo', 'jizz', 'cocksuck', 'blowjob',
        'handjob', 'asshole', 'dumbass', 'jackass', 'dickhead', 'horny', 'milf',
        'molest', 'pedophile', 'paedophile', 'incest', 'hitler', 'kkk', 'whitepower',
        'tranny', 'wetback', 'beaner', 'killyourself'
      ]) AS bad
      WHERE joined.s ~ regexp_replace(bad, '(.)', '\1+', 'g'))
    OR EXISTS (
      SELECT 1 FROM words, unnest(ARRAY[
        'shit', 'ass', 'arse', 'anal', 'anus', 'cock', 'cum', 'dick', 'tit', 'twat', 'wank',
        'fag', 'rape', 'rapist', 'pedo', 'porn', 'porno', 'sex', 'sexy', 'nude', 'boob',
        'nazi', 'chink', 'spic', 'kike', 'gook', 'coon', 'dyke', 'kys'
      ]) AS bad
      WHERE words.w ~ ('^' || regexp_replace(bad, '(.)', '\1+', 'g') || '(e?s)?$'));
$$;

-- ── 2. Rename existing names that break the new rules ───────────────────────
-- Picks base, base1, base2, ... (cut to fit 20 characters) that no other profile
-- uses, ignoring case. A temporary helper: it only exists while this migration runs.
CREATE OR REPLACE FUNCTION pg_temp.free_username(p_base text, p_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text := p_base;
  n int := 0;
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.profiles
                WHERE lower(username) = lower(candidate) AND id <> p_id) LOOP
    n := n + 1;
    candidate := left(p_base, 20 - length(n::text)) || n::text;
  END LOOP;
  RETURN candidate;
END;
$$;

DO $$
DECLARE
  r       record;
  renamed text;
BEGIN
  FOR r IN SELECT id, username FROM public.profiles
           WHERE public.username_is_offensive(username) ORDER BY created_at, id LOOP
    renamed := pg_temp.free_username('user', r.id);
    UPDATE public.profiles SET username = renamed WHERE id = r.id;
    RAISE NOTICE 'Renamed offensive username % -> %', r.username, renamed;
  END LOOP;

  -- Case clashes: everyone except the oldest holder of each name gets a number.
  FOR r IN SELECT id, username FROM (
             SELECT id, username, created_at, row_number() OVER (
                      PARTITION BY lower(username) ORDER BY created_at NULLS LAST, id) AS nth
             FROM public.profiles) x
           WHERE nth > 1 ORDER BY created_at NULLS LAST, id LOOP
    renamed := pg_temp.free_username(r.username, r.id);
    UPDATE public.profiles SET username = renamed WHERE id = r.id;
    RAISE NOTICE 'Renamed username % -> % (same name as an older account, ignoring case)', r.username, renamed;
  END LOOP;
END $$;

-- ── 3. The rules ─────────────────────────────────────────────────────────────
-- Same index name as the old case-sensitive one, so the app's existing check for
-- "profiles_username_key" in a duplicate-name error keeps working. The old rule was
-- created as a UNIQUE constraint (002), so drop it either way it exists.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_username_key;
DROP INDEX IF EXISTS public.profiles_username_key;
CREATE UNIQUE INDEX profiles_username_key ON public.profiles (lower(username));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_appropriate') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_username_appropriate CHECK (NOT public.username_is_offensive(username));
  END IF;
END $$;

-- ── 4. Checks the app calls before saving ───────────────────────────────────
-- Now ignores case, matching the new unique rule (still skips the caller's own row,
-- so re-saving your own name in different capitals is allowed).
CREATE OR REPLACE FUNCTION public.username_exists(p_username text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(p_username)
      AND id IS DISTINCT FROM auth.uid()
  );
$$;

-- Everything wrong with a username, in the order the user should fix it:
--   'ok' | 'format' (3-20 letters/numbers/_) | 'offensive' | 'taken'
-- Callable before signing in (signup), like username_exists.
CREATE OR REPLACE FUNCTION public.check_username(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_username IS NULL OR p_username !~ '^[A-Za-z0-9_]{3,20}$' THEN 'format'
    WHEN public.username_is_offensive(p_username)                   THEN 'offensive'
    WHEN public.username_exists(p_username)                         THEN 'taken'
    ELSE 'ok'
  END;
$$;

REVOKE ALL ON FUNCTION public.check_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_username(text)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.username_exists(text)  TO anon, authenticated;
