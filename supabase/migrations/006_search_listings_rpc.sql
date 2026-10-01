-- 006: Server-side listing search. Authored 2026-10-01.
--
-- Replaces the client-side loadAllListings() full-table pull (frontend/js/api.js).
-- Before: the browser paged the ENTIRE listings table down in 1000-row chunks,
-- cached it, and filtered in JS. Fine at a few hundred rows; a multi-MB download
-- on every search session once real job data lands at volume.
-- After: the browser asks for ONE page of already-filtered rows via this RPC.
--
-- Filtering semantics mirror the old JS EXACTLY (matchesKeyword / matchesLocation
-- / matchesIndustry / matchesType in api.js), so search results are unchanged:
--   * keyword   -> title OR company substring (case-insensitive)
--   * location  -> ILIKE ANY of the selected location patterns (e.g. '%, NY')
--   * industry  -> title ILIKE ANY of the selected industry keyword patterns
--   * type      -> title ILIKE ANY of the selected type keyword patterns
-- Filter GROUPS are AND-ed; options WITHIN a group are OR-ed (via ILIKE ANY).
--
-- Why an RPC with ILIKE ANY(array) instead of PostgREST .or() strings: the
-- location patterns contain commas ('%, NY'), which collide with PostgREST's
-- comma-delimited .or() syntax and need fragile escaping -- the exact reason the
-- original author went client-side. A parameterized text[] sidesteps that
-- entirely: no query-string encoding, and OR-within-a-group is native.

-- Trigram indexes make the ILIKE / ILIKE ANY scans index-backed rather than
-- sequential, which is what keeps search fast as the table grows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS listings_title_trgm_idx    ON listings USING gin (title    gin_trgm_ops);
CREATE INDEX IF NOT EXISTS listings_company_trgm_idx  ON listings USING gin (company  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS listings_location_trgm_idx ON listings USING gin (location gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_listings(
  p_keyword           text   DEFAULT NULL,
  p_location_patterns text[] DEFAULT NULL,
  p_industry_patterns text[] DEFAULT NULL,
  p_type_patterns     text[] DEFAULT NULL,
  p_limit             int    DEFAULT 50,
  p_offset            int    DEFAULT 0
)
RETURNS SETOF listings
LANGUAGE sql
STABLE
SECURITY INVOKER          -- listings has public-read RLS, so caller rights are fine
SET search_path TO 'public'
AS $$
  SELECT l.*
  FROM listings l
  WHERE
    -- keyword: literal substring on title OR company. The old JS used String
    -- .includes(), so we escape LIKE's wildcards (\ % _) in the user's input to
    -- keep it a plain substring match rather than a pattern.
    ( p_keyword IS NULL OR p_keyword = '' OR
      l.title   ILIKE '%' || replace(replace(replace(p_keyword, '\', '\\'), '%', '\%'), '_', '\_') || '%' OR
      l.company ILIKE '%' || replace(replace(replace(p_keyword, '\', '\\'), '%', '\%'), '_', '\_') || '%' )
    -- location / industry / type: callers pass intentional ILIKE patterns, so
    -- these pass through as-is. Each group is skipped when its array is empty/NULL.
    AND ( p_location_patterns IS NULL OR array_length(p_location_patterns, 1) IS NULL OR
          l.location ILIKE ANY (p_location_patterns) )
    AND ( p_industry_patterns IS NULL OR array_length(p_industry_patterns, 1) IS NULL OR
          l.title ILIKE ANY (p_industry_patterns) )
    AND ( p_type_patterns IS NULL OR array_length(p_type_patterns, 1) IS NULL OR
          l.title ILIKE ANY (p_type_patterns) )
  -- id is a deterministic tiebreaker: without it, rows sharing a posted_at could
  -- shuffle between pages and cause OFFSET pagination to skip or duplicate rows.
  ORDER BY l.posted_at DESC NULLS LAST, l.id
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.search_listings(text, text[], text[], text[], int, int)
  TO anon, authenticated;
