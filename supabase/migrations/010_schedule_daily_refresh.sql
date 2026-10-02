-- 010: Actually schedule the daily-refresh edge function. Authored 2026-10-02.
--
-- The function existed but nothing ran it automatically -- it only refreshed when
-- manually invoked from the dashboard. This wires a pg_cron job that POSTs to the
-- function once a day via pg_net, so listings stay fresh without manual runs.
--
-- Both extensions ship with every Supabase project. pg_net exposes net.http_post;
-- pg_cron runs scheduled SQL inside the database.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: drop any existing job with this name before (re)creating it, so this
-- migration is safe to re-run. (unschedule errors if the job is missing, hence the
-- WHERE-driven form that simply returns no rows when there's nothing to remove.)
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'daily-refresh';
END $$;

-- 06:00 UTC daily. The anon/publishable key below is the SAME public key already
-- shipped in the frontend (frontend/js/config.js) -- it is not a secret. The
-- function is verify_jwt=false, so this only needs to satisfy the API gateway.
SELECT cron.schedule(
  'daily-refresh',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://mijakorauzqwzfffvcwb.supabase.co/functions/v1/daily-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',        'sb_publishable_bYBRF2cJLC6Z4eBRb7xjXA_rdSXdfJU',
      'Authorization', 'Bearer sb_publishable_bYBRF2cJLC6Z4eBRb7xjXA_rdSXdfJU'
    ),
    -- The scrape fans out to ~140 Greenhouse boards + GitHub repos and takes well
    -- over pg_net's 5s default. Wait up to 2 min so the reply is captured as a 200.
    timeout_milliseconds := 120000
  );
  $$
);

-- To verify after running:  SELECT jobname, schedule, active FROM cron.job;
-- To see run history:       SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
