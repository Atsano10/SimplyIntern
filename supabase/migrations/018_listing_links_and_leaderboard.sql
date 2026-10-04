-- 018: Listing links on applications + a leaderboard that only counts real ones.
-- Authored 2026-10-04.
--
-- Two problems with the old leaderboard (014):
--   1. It only counted 'Pending','Applied','Interview' as pending, but the app saves
--      '1st Round Interview' / '2nd Round Interview' — reaching an interview LOWERED
--      your score. Interviews now count as pending (it's an unemployment board: you
--      score for rejections and things still in limbo, never for offers).
--   2. Anyone could type (or CSV-import) thousands of fake applications.
--
-- The fix: every application can carry the URL of the listing. The `verify-link`
-- edge function checks that the URL really exists and records the result in
-- `verified_links`, a table only the server can write. Apps added from our own
-- listings (listing_id) get that listing's URL recorded as verified by a trigger.
-- The leaderboard then has ONE rule: an application scores only if its URL is in
-- verified_links — so the trust decision never depends on the browser, and calling
-- the REST API directly can't fake it. Each listing counts once per user.
--
-- Apps without a link (e.g. "Import without links") still live in the tracker; they
-- just don't score.

-- ── 1. URL normalization ─────────────────────────────────────────────────────
-- One canonical form per listing, so the same job pasted with different tracking
-- params, "www.", a trailing slash, or http vs https counts once. This is the single
-- source of truth: the edge function asks the DB to normalize instead of reimplementing it.
-- IMMUTABLE so it can back an expression index.
CREATE OR REPLACE FUNCTION public.normalize_job_url(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE STRICT
SET search_path = ''
AS $$
DECLARE
  m     text[];
  host  text;
  path  text;
  query text;
  kept  text[];
  li_id text;
BEGIN
  m := regexp_match(btrim(p_url), '^https?://([^/?#]+)([^?#]*)(\?[^#]*)?', 'i');
  IF m IS NULL THEN
    RETURN NULL;
  END IF;

  host := lower(m[1]);
  host := regexp_replace(host, '^.*@', '');          -- drop user:pass@
  host := regexp_replace(host, ':(80|443)$', '');    -- default ports
  host := regexp_replace(host, '^www\.', '');
  path  := regexp_replace(coalesce(m[2], ''), '/+$', '');
  query := coalesce(substr(m[3], 2), '');

  -- LinkedIn has several URL shapes for one job (slugged /jobs/view/, search pages
  -- with ?currentJobId=). Collapse them all to the job id.
  IF host ~ '(^|\.)linkedin\.com$' THEN
    li_id := coalesce(
      (regexp_match(path, '^/jobs/view/(?:[^/]*-)?([0-9]+)$'))[1],
      (regexp_match(query, '(?:^|&)currentJobId=([0-9]+)'))[1]);
    IF li_id IS NOT NULL THEN
      RETURN 'https://linkedin.com/jobs/view/' || li_id;
    END IF;
  END IF;

  -- Drop tracking params; sort the rest so parameter order doesn't matter.
  SELECT array_agg(p ORDER BY p) INTO kept
  FROM unnest(string_to_array(query, '&')) AS p
  WHERE p <> ''
    AND lower(split_part(p, '=', 1)) !~
      '^(utm_.*|trk|trackingid|refid|ref|gh_src|lever-source|lever-origin|source|src|fbclid|gclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi)$';

  RETURN 'https://' || host || path
      || CASE WHEN kept IS NULL THEN '' ELSE '?' || array_to_string(kept, '&') END;
END;
$$;

-- Lets the edge function match a pasted URL against our scraped listings quickly.
CREATE INDEX IF NOT EXISTS listings_url_normalized_idx
  ON public.listings (public.normalize_job_url(url));

-- ── 2. applications.url ──────────────────────────────────────────────────────
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS url text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_url_format') THEN
    ALTER TABLE public.applications ADD CONSTRAINT applications_url_format
      CHECK (url IS NULL OR (url ~* '^https?://' AND length(url) <= 2048));
  END IF;
END $$;

-- ── 3. verified_links (server-written only) ──────────────────────────────────
-- status: 'ok'           the page loaded
--         'unverifiable' the site blocks automated checks (LinkedIn, Indeed,
--                        Handshake login walls...) — real-looking, allowed, counts
--         'dead'         404 / 410 / domain doesn't exist — blocked, doesn't count
CREATE TABLE IF NOT EXISTS public.verified_links (
  url_normalized text        PRIMARY KEY,
  status         text        NOT NULL CHECK (status IN ('ok', 'unverifiable', 'dead')),
  http_status    int,
  checked_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS on with no policies = no access for anon/authenticated through the API.
-- The explicit REVOKE is belt-and-braces: Supabase's default privileges grant new
-- tables to anon/authenticated.
ALTER TABLE public.verified_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verified_links FROM anon, authenticated;

-- ── 4. Helpers for the verify-link edge function (service_role only) ─────────
-- For each pasted URL: its normalized form, any earlier verdict, and whether it's
-- one of our own scraped listings (those are known-real, no fetch needed).
CREATE OR REPLACE FUNCTION public.link_check_prepare(p_urls text[])
RETURNS TABLE (input text, url_normalized text, cached_status text, in_listings boolean)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT u.input,
         x.n,
         v.status,
         EXISTS (SELECT 1 FROM listings l WHERE normalize_job_url(l.url) = x.n)
  FROM unnest(p_urls) AS u(input)
  CROSS JOIN LATERAL (SELECT normalize_job_url(u.input) AS n) x
  LEFT JOIN verified_links v ON v.url_normalized = x.n;
$$;

-- Records verdicts. Only ever UPGRADES a link (dead -> unverifiable -> ok): a job that
-- closes after people applied must not knock their applications off the board.
CREATE OR REPLACE FUNCTION public.record_link_checks(p_rows jsonb)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO verified_links (url_normalized, status, http_status, checked_at)
  SELECT DISTINCT ON (r->>'url_normalized')
         r->>'url_normalized', r->>'status', (r->>'http_status')::int, now()
  FROM jsonb_array_elements(p_rows) AS r
  WHERE r->>'url_normalized' IS NOT NULL
  ORDER BY r->>'url_normalized'
  ON CONFLICT (url_normalized) DO UPDATE
    SET status = EXCLUDED.status, http_status = EXCLUDED.http_status, checked_at = now()
    WHERE verified_links.status = 'dead'
       OR (verified_links.status = 'unverifiable' AND EXCLUDED.status = 'ok');
$$;

-- Functions are executable by PUBLIC by default; lock these to the server.
REVOKE ALL ON FUNCTION public.link_check_prepare(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_link_checks(jsonb)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_check_prepare(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_link_checks(jsonb)  TO service_role;

-- ── 5. Apps added from our listings ─────────────────────────────────────────
-- When listing_id is set, the row's url is ALWAYS that listing's url (so a client
-- can't pair a real listing_id with a made-up url), and the url is recorded as
-- verified. Recording it — rather than trusting listing_id in the view — matters
-- because the daily refresh deletes old listings, which nulls listing_id
-- (ON DELETE SET NULL, 007); the application must keep counting after that.
-- SECURITY DEFINER because the caller (a signed-in user) can't write verified_links.
CREATE OR REPLACE FUNCTION public.applications_sync_listing_url()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lurl text;
BEGIN
  IF NEW.listing_id IS NOT NULL THEN
    SELECT url INTO lurl FROM listings WHERE id = NEW.listing_id;
    IF lurl ~* '^https?://' AND length(lurl) <= 2048 AND normalize_job_url(lurl) IS NOT NULL THEN
      NEW.url := lurl;
      INSERT INTO verified_links (url_normalized, status)
      VALUES (normalize_job_url(lurl), 'ok')
      ON CONFLICT (url_normalized) DO UPDATE
        SET status = 'ok', checked_at = now()
        WHERE verified_links.status <> 'ok';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill rows added from Search before this migration, then start the trigger.
UPDATE public.applications a
SET url = l.url
FROM public.listings l
WHERE a.listing_id = l.id
  AND a.url IS NULL
  AND l.url ~* '^https?://' AND length(l.url) <= 2048;

INSERT INTO public.verified_links (url_normalized, status)
SELECT DISTINCT public.normalize_job_url(l.url), 'ok'
FROM public.applications a
JOIN public.listings l ON l.id = a.listing_id
WHERE public.normalize_job_url(l.url) IS NOT NULL
ON CONFLICT (url_normalized) DO NOTHING;

DROP TRIGGER IF EXISTS applications_sync_listing_url ON public.applications;
CREATE TRIGGER applications_sync_listing_url
  BEFORE INSERT OR UPDATE OF listing_id, url ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_sync_listing_url();

-- ── 6. Leaderboard ───────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.leaderboard_scores;
DROP VIEW IF EXISTS public.leaderboard_counts;

-- Internal: per-user counts of applications that are allowed to score. Not exposed
-- through the API (it has user ids); the public view and my_leaderboard_score() read it.
CREATE VIEW public.leaderboard_counts AS
WITH eligible AS (
  -- Only verified links score, and each listing once per user (DISTINCT ON the
  -- normalized url), so pasting the same job twice doesn't double-count.
  SELECT DISTINCT ON (a.user_id, nu.n)
         a.user_id, a.status
  FROM public.applications a
  CROSS JOIN LATERAL (SELECT public.normalize_job_url(a.url) AS n) nu
  JOIN public.verified_links v
    ON v.url_normalized = nu.n AND v.status IN ('ok', 'unverifiable')
  WHERE a.cycle = '2027 Summer'   -- CURRENT CYCLE — bump each season (and CURRENT_CYCLE in util.js)
  ORDER BY a.user_id, nu.n, a.created_at
)
SELECT user_id,
       count(*) FILTER (WHERE status = 'Rejected') AS rejected,
       -- Interview rounds count as pending: still no offer. 'Applied'/'Interview' are legacy.
       count(*) FILTER (WHERE status IN ('Pending', 'Applied', 'Interview',
                                         '1st Round Interview', '2nd Round Interview')) AS pending
FROM eligible
GROUP BY user_id;

REVOKE ALL ON public.leaderboard_counts FROM anon, authenticated;

CREATE VIEW public.leaderboard_scores AS
SELECT p.username,
       coalesce(c.rejected, 0)                           AS rejected,
       coalesce(c.pending, 0)                            AS pending,
       coalesce(c.rejected, 0) + coalesce(c.pending, 0)  AS score
FROM public.profiles p
LEFT JOIN public.leaderboard_counts c ON c.user_id = p.id
WHERE p.leaderboard_opt_out = false;

GRANT SELECT ON public.leaderboard_scores TO anon, authenticated;

-- The signed-in user's own score, from the same rules as the board (also works when
-- they've opted out of the public board). Replaces the client-side recount in
-- leaderboard.js, which had drifted from the SQL.
CREATE OR REPLACE FUNCTION public.my_leaderboard_score()
RETURNS TABLE (rejected bigint, pending bigint, score bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(c.rejected, 0),
         coalesce(c.pending, 0),
         coalesce(c.rejected, 0) + coalesce(c.pending, 0)
  FROM (SELECT auth.uid() AS uid) me
  LEFT JOIN leaderboard_counts c ON c.user_id = me.uid;
$$;

REVOKE ALL ON FUNCTION public.my_leaderboard_score() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_leaderboard_score() TO authenticated;
