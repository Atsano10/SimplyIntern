-- 021: Cap search_listings at 100 rows per call. Authored 2026-10-06.
--
-- p_limit had no upper bound, so anyone with the public key could ask for every listing
-- in one request (only PostgREST's 1000-row cap stopped it). The search page asks for
-- 50 at a time, so 100 leaves headroom and changes nothing for real users.
--
-- Same signature and body as 009. Only the LIMIT line is new, so CREATE OR REPLACE
-- swaps it in place and the grant carries over (it's repeated below anyway).

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
  -- Capped at 100: the page asks for 50 at a time, and without a cap one call could
  -- ask for the whole table (PostgREST's own row cap stopped it at 1000).
  LIMIT  LEAST(GREATEST(p_limit, 0), 100)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.search_listings(text, text[], text[], text[], int, boolean, text, int, int)
  TO anon, authenticated;
