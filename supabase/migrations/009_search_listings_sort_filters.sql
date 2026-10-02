-- 009: Add sorting + extra filters to search_listings. Authored 2026-10-01.
--
-- Extends migration 006 with controls the UI now exposes:
--   * p_posted_within_days -> only listings posted in the last N days
--   * p_remote_only        -> only listings whose location mentions "remote"
--   * p_sort              -> 'newest' (default) | 'oldest' | 'company'
-- Keyword/location/industry/type behavior is unchanged from 006.
--
-- NOTE: no salary/pay filter. The daily-refresh scraper hardcodes pay = NULL for
-- every source (Greenhouse's API and the GitHub README tables don't expose it),
-- so `listings.pay` is empty for 100% of rows -- any pay filter would match
-- nothing. A pay filter only becomes possible once a structured pay column is
-- populated at scrape time.
--
-- CREATE OR REPLACE can't change a function's argument list, and earlier drafts of
-- this migration shipped different signatures (one briefly had a p_has_pay arg).
-- To be safe to re-run from ANY prior state, drop EVERY overload of
-- search_listings first -- otherwise leftover overloads make PostgREST fail with
-- an "ambiguous function" error when the frontend calls it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'search_listings'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.search_listings(
  p_keyword            text    DEFAULT NULL,
  p_location_patterns  text[]  DEFAULT NULL,
  p_industry_patterns  text[]  DEFAULT NULL,
  p_type_patterns      text[]  DEFAULT NULL,
  p_posted_within_days int     DEFAULT NULL,
  p_remote_only        boolean DEFAULT false,
  p_sort               text    DEFAULT 'newest',
  p_limit              int     DEFAULT 50,
  p_offset             int     DEFAULT 0
)
RETURNS SETOF listings
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT l.*
  FROM listings l
  WHERE
    ( p_keyword IS NULL OR p_keyword = '' OR
      l.title   ILIKE '%' || replace(replace(replace(p_keyword, '\', '\\'), '%', '\%'), '_', '\_') || '%' OR
      l.company ILIKE '%' || replace(replace(replace(p_keyword, '\', '\\'), '%', '\%'), '_', '\_') || '%' )
    AND ( p_location_patterns IS NULL OR array_length(p_location_patterns, 1) IS NULL OR
          l.location ILIKE ANY (p_location_patterns) )
    AND ( p_industry_patterns IS NULL OR array_length(p_industry_patterns, 1) IS NULL OR
          l.title ILIKE ANY (p_industry_patterns) )
    AND ( p_type_patterns IS NULL OR array_length(p_type_patterns, 1) IS NULL OR
          l.title ILIKE ANY (p_type_patterns) )
    -- posted within N days: a NULL posted_at never matches a recency window.
    AND ( p_posted_within_days IS NULL OR
          l.posted_at >= current_date - p_posted_within_days )
    -- remote only
    AND ( NOT p_remote_only OR l.location ILIKE '%remote%' )
  ORDER BY
    -- Only the clause matching p_sort is non-NULL for every row; the rest fall
    -- through. posted_at DESC is the general tiebreaker, id the deterministic
    -- final key so OFFSET pagination can't skip or duplicate rows.
    CASE WHEN p_sort = 'company' THEN lower(l.company) END ASC NULLS LAST,
    CASE WHEN p_sort = 'oldest'  THEN l.posted_at END ASC NULLS LAST,
    l.posted_at DESC NULLS LAST,
    l.id
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.search_listings(text, text[], text[], text[], int, boolean, text, int, int)
  TO anon, authenticated;
