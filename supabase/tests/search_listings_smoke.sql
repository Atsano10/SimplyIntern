-- Smoke test for the search_listings RPC (migrations 006 + 009).
-- Paste into the Supabase SQL editor AFTER running both migrations. This file is
-- NOT a migration (it lives outside migrations/) so it never auto-runs. Read-only.
--
-- Uses NAMED argument notation (p_x => ...) so it stays valid even as the
-- function signature grows. Each check compares the RPC against a baseline query
-- that reproduces the same semantics; matching counts = parity holds.

-- 0. Sanity: unfiltered first page returns up to 50 rows.
SELECT count(*) AS first_page_rows
FROM search_listings(p_limit => 50, p_offset => 0);

-- 1. Keyword parity: 'engineer' on title OR company.
SELECT
  (SELECT count(*) FROM search_listings(p_keyword => 'engineer', p_limit => 100000)) AS rpc_count,
  (SELECT count(*) FROM listings
     WHERE title ILIKE '%engineer%' OR company ILIKE '%engineer%')                    AS expected_count;

-- 2. Keyword with a literal '%' must be treated as text, not a wildcard (~0 rows,
--    NOT everything). If it returns everything, the LIKE-escaping regressed.
SELECT count(*) AS literal_percent_rows
FROM search_listings(p_keyword => '%', p_limit => 100000);

-- 3. Location parity: New York patterns.
SELECT
  (SELECT count(*) FROM search_listings(p_location_patterns => ARRAY['%, NY','%, NY /%'], p_limit => 100000)) AS rpc_count,
  (SELECT count(*) FROM listings WHERE location ILIKE ANY (ARRAY['%, NY','%, NY /%']))                         AS expected_count;

-- 4. Remote-only parity.
SELECT
  (SELECT count(*) FROM search_listings(p_remote_only => true, p_limit => 100000)) AS rpc_count,
  (SELECT count(*) FROM listings WHERE location ILIKE '%remote%')                   AS expected_count;

-- 5. Posted-within parity: last 30 days (NULL posted_at must NOT match).
SELECT
  (SELECT count(*) FROM search_listings(p_posted_within_days => 30, p_limit => 100000)) AS rpc_count,
  (SELECT count(*) FROM listings WHERE posted_at >= current_date - 30)                   AS expected_count;

-- 6. Paid-only: every returned row has a non-placeholder pay value.
--    Expected: 0 bad rows.
SELECT count(*) AS unpaid_leaked
FROM search_listings(p_has_pay => true, p_limit => 100000)
WHERE pay IS NULL OR btrim(pay) = '' OR pay ~* '^\s*(not\s*listed|n/?a|none|tbd|unpaid|--)\s*$';

-- 7. Sort = company: result is non-decreasing by lower(company).
--    Expected: 0 out-of-order adjacent pairs.
WITH ordered AS (
  SELECT lower(company) AS c, row_number() OVER () AS rn
  FROM search_listings(p_sort => 'company', p_limit => 100000)
)
SELECT count(*) AS out_of_order
FROM ordered a JOIN ordered b ON b.rn = a.rn + 1
WHERE a.c > b.c;

-- 8. Pagination stable under default sort (no overlap between pages).
--    Expected: 0 overlapping ids.
WITH p0 AS (SELECT id FROM search_listings(p_limit => 50, p_offset => 0)),
     p1 AS (SELECT id FROM search_listings(p_limit => 50, p_offset => 50))
SELECT count(*) AS overlapping_ids
FROM p0 JOIN p1 USING (id);
