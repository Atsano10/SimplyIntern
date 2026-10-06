-- 020: Location filter counts in one call. Authored 2026-10-04.
--
-- The search page builds its location filter (Remote / U.S. states / countries,
-- each with a listing count) from every listing's location string. It used to page
-- through the whole listings table to get them: one request per 1000 rows, ~110 KB
-- at 3k listings, on every Search page load, growing with the table.
--
-- This returns each distinct location with how many listings have it, e.g.
--   {"Seattle, WA": 12, "Remote": 40, ...}
-- The browser still sorts them into buckets (js/locations.js), so the filter
-- options and counts don't change.
--
-- It returns ONE jsonb value instead of a row per location on purpose: PostgREST
-- caps row results at 1000 rows, and there are already 800+ distinct locations.
-- A single value isn't subject to that cap, so the list can't silently get cut off.

CREATE OR REPLACE FUNCTION public.listing_locations()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER          -- listings has public-read RLS, so caller rights are fine
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_object_agg(location, n), '{}'::jsonb)
  FROM (
    SELECT l.location, count(*) AS n
    FROM listings l
    WHERE l.location IS NOT NULL AND l.location <> ''
    GROUP BY l.location
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.listing_locations() TO anon, authenticated;
