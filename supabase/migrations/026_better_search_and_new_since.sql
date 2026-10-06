-- 026: Better keyword search, a "Best match" sort, and "New since your last visit".
-- Authored 2026-10-06.
--
-- Search used to look for the whole search text inside the title or company, so
-- "engineering intern new york", "swe" and "sofware" all found nothing. Now each word
-- of the search is matched on its own, and a listing must match every word, in its
-- title, company or location. A word matches when:
--   * it appears in the text ("strip" finds "Stripe"); words of 1-3 letters only as a
--     whole word, so "ai" finds "AI Intern" but not "Maintenance"
--   * a common abbreviation of it does ("swe" -> software engineer, "nyc" -> new york)
--   * its stem does ("engineering" finds "Engineer")
--   * for words of 6+ letters, it's a close spelling ("sofware" finds "Software")
-- Up to 8 words are used; stopwords like "in" or "the" are ignored.
--
-- p_sort 'relevance' ("Best match", now the default) ranks title matches over company
-- over location, and boosts an exact company name or the whole phrase in the title.
-- With no search text it's the same as 'newest'.
--
-- p_new_since: only listings first added after this time (the "New since your last
-- visit" option). start_search_visit() works out that time per user.

-- ── 1. Search data per listing ───────────────────────────────────────────────
-- Stemmed words with weights: title (A) > company (B) > location (C). Location uses the
-- 'simple' config (no stemming), so city names stay as written.
CREATE OR REPLACE FUNCTION public.listing_search_doc(p_title text, p_company text, p_location text)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT setweight(to_tsvector('english', coalesce(p_title, '')), 'A')
      || setweight(to_tsvector('english', coalesce(p_company, '')), 'B')
      || setweight(to_tsvector('simple',  coalesce(p_location, '')), 'C');
$$;

-- ── 2. Abbreviations ─────────────────────────────────────────────────────────
-- Other ways a search word may appear in a listing. Lowercase.
CREATE OR REPLACE FUNCTION public.search_word_alternatives(p_word text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT ARRAY[p_word] || CASE p_word
    WHEN 'swe'  THEN ARRAY['software engineer', 'software engineering', 'software developer']
    WHEN 'sde'  THEN ARRAY['software development', 'software engineer', 'software developer']
    WHEN 'ml'   THEN ARRAY['machine learning']
    WHEN 'ai'   THEN ARRAY['artificial intelligence', 'machine learning']
    WHEN 'pm'   THEN ARRAY['product manager', 'product management', 'project manager']
    WHEN 'ds'   THEN ARRAY['data science', 'data scientist']
    WHEN 'qa'   THEN ARRAY['quality assurance']
    WHEN 'ux'   THEN ARRAY['user experience']
    WHEN 'ib'   THEN ARRAY['investment banking']
    WHEN 'nyc'  THEN ARRAY['new york']
    WHEN 'sf'   THEN ARRAY['san francisco']
    WHEN 'la'   THEN ARRAY['los angeles']
    WHEN 'dc'   THEN ARRAY['washington']
    ELSE ARRAY[]::text[]
  END;
$$;

-- ── 3. search_listings ───────────────────────────────────────────────────────
-- Same arguments as 021 plus p_new_since, so drop every old version first (two
-- overloads would make the API call ambiguous).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc
           WHERE proname = 'search_listings' AND pronamespace = 'public'::regnamespace LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

-- search_path includes "extensions" because that's where Supabase installs pg_trgm
-- (word_similarity, for typos); a schema that doesn't exist is simply skipped.
CREATE FUNCTION public.search_listings(
  p_keyword            text        DEFAULT NULL,
  p_location_patterns  text[]      DEFAULT NULL,
  p_industry_patterns  text[]      DEFAULT NULL,
  p_type_patterns      text[]      DEFAULT NULL,
  p_posted_within_days int         DEFAULT NULL,
  p_remote_only        boolean     DEFAULT false,
  p_sort               text        DEFAULT 'relevance',
  p_limit              int         DEFAULT 50,
  p_offset             int         DEFAULT 0,
  p_new_since          timestamptz DEFAULT NULL
)
RETURNS SETOF listings
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO public, extensions
AS $$
  WITH search AS (
    SELECT lower(btrim(coalesce(p_keyword, ''))) AS phrase
  ),
  words AS (
    -- One row per search word, with every way it may appear:
    --   alt_patterns  ILIKE patterns (% and _ escaped) for words of 4+ characters
    --   alt_regexes   whole-word patterns for shorter ones (special characters escaped,
    --                 and "whole word" means no letter or digit on either side, so
    --                 "c++" works too)
    --   stem          a stemmed prefix query, for plain words of 4+ letters
    SELECT w,
           array(SELECT '%' || replace(replace(replace(a, '\', '\\'), '%', '\%'), '_', '\_') || '%'
                 FROM unnest(search_word_alternatives(w)) a WHERE length(a) > 3) AS alt_patterns,
           array(SELECT '(^|[^[:alnum:]])' || regexp_replace(a, '([^[:alnum:] ])', '\\\1', 'g') || '($|[^[:alnum:]])'
                 FROM unnest(search_word_alternatives(w)) a WHERE length(a) <= 3) AS alt_regexes,
           CASE WHEN w ~ '^[[:alnum:]]{4,}$' THEN to_tsquery('english', w || ':*') END AS stem
    FROM search, unnest((regexp_split_to_array(search.phrase, '\s+'))[1:8]) AS w
    WHERE w <> ''
      -- Skip stopwords ("in", "the", "and"): they'd only filter out good matches.
      AND NOT (w ~ '^[[:alnum:]]+$' AND numnode(to_tsquery('english', w)) = 0)
  ),
  -- All the stems together, for ranking (NULL when there are none).
  all_stems AS (
    SELECT to_tsquery('english', string_agg(w || ':*', ' & ')) AS q
    FROM words WHERE w ~ '^[[:alnum:]]{4,}$'
  )
  SELECT l.*
  FROM listings l
  CROSS JOIN search
  CROSS JOIN all_stems
  -- Only built when there's search text (it's the costly part).
  CROSS JOIN LATERAL (
    SELECT CASE WHEN search.phrase <> '' THEN listing_search_doc(l.title, l.company, l.location) END AS doc
  ) d
  WHERE
    -- Every search word must match somewhere.
    NOT EXISTS (
      SELECT 1 FROM words
      WHERE NOT (
           l.title ILIKE ANY (words.alt_patterns) OR l.company ILIKE ANY (words.alt_patterns)
        OR l.location ILIKE ANY (words.alt_patterns)
        OR l.title ~* ANY (words.alt_regexes) OR l.company ~* ANY (words.alt_regexes)
        OR l.location ~* ANY (words.alt_regexes)
        OR (words.stem IS NOT NULL AND d.doc @@ words.stem)
        -- Close spelling. 0.5 rather than pg_trgm's default 0.6, which misses "sofware"
        -- (0.55); limited to 6+ letters, where a looser match stops catching unrelated
        -- short words ("legal" vs "regal").
        OR (length(words.w) >= 6 AND (word_similarity(words.w, l.title) >= 0.5
                                      OR word_similarity(words.w, l.company) >= 0.5))
      )
    )
    AND ( p_location_patterns IS NULL OR array_length(p_location_patterns, 1) IS NULL OR
          l.location ILIKE ANY (p_location_patterns) )
    AND ( p_industry_patterns IS NULL OR array_length(p_industry_patterns, 1) IS NULL OR
          l.title ILIKE ANY (p_industry_patterns) )
    AND ( p_type_patterns IS NULL OR array_length(p_type_patterns, 1) IS NULL OR
          l.title ILIKE ANY (p_type_patterns) )
    -- posted within N days: a NULL posted_at never matches a recency window.
    AND ( p_posted_within_days IS NULL OR l.posted_at >= current_date - p_posted_within_days )
    AND ( NOT p_remote_only OR l.location ILIKE '%remote%' )
    AND ( p_new_since IS NULL OR l.created_at > p_new_since )
  ORDER BY
    -- Best match: only scored when there's search text; otherwise NULL for every row,
    -- so the order falls through to newest.
    CASE WHEN p_sort = 'relevance' AND search.phrase <> '' THEN
        coalesce(ts_rank(d.doc, all_stems.q), 0)                                          -- stems, weighted by field
      + 0.3 * (SELECT count(*) FROM words                                                 -- words found in the title
               WHERE l.title ILIKE ANY (words.alt_patterns) OR l.title ~* ANY (words.alt_regexes))
      + CASE WHEN lower(l.company) = search.phrase THEN 1 ELSE 0 END                      -- searched the company name
      + CASE WHEN strpos(lower(l.title), search.phrase) > 0 THEN 0.5 ELSE 0 END           -- whole phrase in the title
      + 0.2 * word_similarity(search.phrase, l.title)                                     -- close spelling
    END DESC NULLS LAST,
    CASE WHEN p_sort = 'company' THEN lower(l.company) END ASC NULLS LAST,
    CASE WHEN p_sort = 'oldest'  THEN l.posted_at END ASC NULLS LAST,
    -- posted_at DESC is the general tiebreaker, id the final key so OFFSET pagination
    -- can't skip or duplicate rows.
    l.posted_at DESC NULLS LAST,
    l.id
  -- Capped at 100 (021): the page asks for 50 at a time.
  LIMIT  LEAST(GREATEST(p_limit, 0), 100)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.search_listings(text, text[], text[], text[], int, boolean, text, int, int, timestamptz)
  TO anon, authenticated;

-- ── 4. New since your last visit ─────────────────────────────────────────────
-- search_visit_at: the last time this user opened Search.
-- new_since:       listings first added after this time show as "New".
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS search_visit_at timestamptz,
  ADD COLUMN IF NOT EXISTS new_since       timestamptz;

-- Called when the Search page opens. A visit ends after an hour away from Search, so
-- refreshing or coming back from another page keeps the same "New" badges, while
-- returning the next day shows everything added since the last time.
-- Returns the cut-off and how many listings are new. The first ever visit has nothing
-- new (everything would be).
CREATE OR REPLACE FUNCTION public.start_search_visit()
RETURNS TABLE (since timestamptz, new_count bigint)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH visit AS (
    UPDATE profiles
    SET new_since = CASE
                      WHEN search_visit_at IS NULL                      THEN now()            -- first visit
                      WHEN search_visit_at < now() - interval '1 hour'  THEN search_visit_at  -- a new visit
                      ELSE coalesce(new_since, now())                                         -- same visit
                    END,
        search_visit_at = now()
    WHERE id = auth.uid()
    RETURNING profiles.new_since
  )
  SELECT visit.new_since,
         (SELECT count(*) FROM listings WHERE listings.created_at > visit.new_since)
  FROM visit;
$$;

REVOKE ALL ON FUNCTION public.start_search_visit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_search_visit() TO authenticated;
