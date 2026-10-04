-- 019: Send a shared secret with the daily-refresh cron call. Authored 2026-10-04.
--
-- daily-refresh is verify_jwt = false and was called with the public key (010), so
-- anyone could trigger a full scrape. The function now refuses requests without the
-- right `x-refresh-secret` header (it reads REFRESH_SECRET from its function secrets).
-- This re-schedules the cron job to send that header.
--
-- The secret's VALUE never appears in this file (migrations are committed to git).
-- The job reads it from Supabase Vault each time it runs. Before applying this:
--   1. Generate a value:            openssl rand -hex 32
--   2. Function secret:             supabase secrets set REFRESH_SECRET=<value>
--                                   (or Dashboard → Edge Functions → Secrets)
--   3. Vault, in the SQL Editor:    select vault.create_secret('<value>', 'refresh_secret');
-- Both places must hold the same value.

-- Stop here with a clear message if step 3 hasn't been done, rather than scheduling a
-- job that would silently get 401s every morning.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'refresh_secret') THEN
    RAISE EXCEPTION 'Vault secret "refresh_secret" is missing. Run: select vault.create_secret(''<value>'', ''refresh_secret''); (same value as the REFRESH_SECRET function secret), then apply this migration again.';
  END IF;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'daily-refresh';
END $$;

-- Same schedule, URL, and timeout as 010; only the x-refresh-secret header is new.
SELECT cron.schedule(
  'daily-refresh',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://mijakorauzqwzfffvcwb.supabase.co/functions/v1/daily-refresh',
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'apikey',           'sb_publishable_bYBRF2cJLC6Z4eBRb7xjXA_rdSXdfJU',
      'Authorization',    'Bearer sb_publishable_bYBRF2cJLC6Z4eBRb7xjXA_rdSXdfJU',
      'x-refresh-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'refresh_secret')
    ),
    timeout_milliseconds := 120000
  );
  $$
);
