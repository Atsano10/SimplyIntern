-- Smoke test for the search_listings RPC (migration 006).
-- Paste these into the Supabase SQL editor AFTER running 006. This file is NOT a
-- migration (it lives outside migrations/) so it never auto-runs. Nothing here
-- writes data; it only reads.
--
-- For each check, the RPC result should equal the "expected" baseline query that
-- reproduces the OLD client-side JS semantics. If the counts match, parity holds.

-- 0. Sanity: unfiltered first page returns up to 50 rows, newest first.
SELECT count(*) AS first_page_rows
FROM search_listings(NULL, NULL, NULL, NULL, 50, 0);

-- 1. Keyword parity: 'engineer' on title OR company.
--    RPC count should equal the baseline count.
SELECT
  (SELECT count(*) FROM search_listings('engineer', NULL, NULL, NULL, 100000, 0)) AS rpc_count,
  (SELECT count(*) FROM listings
     WHERE title ILIKE '%engineer%' OR company ILIKE '%engineer%')               AS expected_count;

-- 2. Keyword with a literal '%' must be treated as text, not a wildcard.
--    This should return only rows that literally contain a percent sign (usually 0),
--    NOT every row. If it returns everything, the LIKE-escaping regressed.
SELECT count(*) AS literal_percent_rows
FROM search_listings('%', NULL, NULL, NULL, 100000, 0);

-- 3. Location parity: New York patterns (as built in search.js).
SELECT
  (SELECT count(*) FROM search_listings(NULL, ARRAY['%, NY','%, NY /%'], NULL, NULL, 100000, 0)) AS rpc_count,
  (SELECT count(*) FROM listings WHERE location ILIKE ANY (ARRAY['%, NY','%, NY /%']))            AS expected_count;

-- 4. Industry parity: a couple of 'tech' keywords from INDUSTRY_KEYWORDS.
SELECT
  (SELECT count(*) FROM search_listings(NULL, NULL, ARRAY['%software%','%developer%'], NULL, 100000, 0)) AS rpc_count,
  (SELECT count(*) FROM listings WHERE title ILIKE ANY (ARRAY['%software%','%developer%']))              AS expected_count;

-- 5. Type parity: 'internship' -> '%intern%'.
SELECT
  (SELECT count(*) FROM search_listings(NULL, NULL, NULL, ARRAY['%intern%'], 100000, 0)) AS rpc_count,
  (SELECT count(*) FROM listings WHERE title ILIKE ANY (ARRAY['%intern%']))              AS expected_count;

-- 6. Combined AND across groups: tech software internships in NY.
SELECT
  (SELECT count(*) FROM search_listings('engineer', ARRAY['%, NY','%, NY /%'], ARRAY['%software%'], ARRAY['%intern%'], 100000, 0)) AS rpc_count,
  (SELECT count(*) FROM listings
     WHERE (title ILIKE '%engineer%' OR company ILIKE '%engineer%')
       AND location ILIKE ANY (ARRAY['%, NY','%, NY /%'])
       AND title   ILIKE ANY (ARRAY['%software%'])
       AND title   ILIKE ANY (ARRAY['%intern%']))                                                                                 AS expected_count;

-- 7. Pagination is stable (no overlap between consecutive pages).
--    Expected: 0 overlapping ids.
WITH p0 AS (SELECT id FROM search_listings(NULL, NULL, NULL, NULL, 50, 0)),
     p1 AS (SELECT id FROM search_listings(NULL, NULL, NULL, NULL, 50, 50))
SELECT count(*) AS overlapping_ids
FROM p0 JOIN p1 USING (id);
