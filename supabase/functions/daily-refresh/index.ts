// Supabase Edge Function — daily-refresh
// Scheduled via Supabase cron to run once per day (e.g. 0 6 * * *)
//
// What goes here:
//   - Import fetchAllGreenhouse() and fetchAllGithub() from shared source modules
//   - Run both fetchers in parallel (Promise.all)
//   - Merge and deduplicate results by URL
//   - Upsert all listings into the Supabase `listings` table (upsert on url field)
//   - Delete any listings older than 30 days that weren't re-upserted (dead link cleanup)
//   - Log a summary: how many added, updated, removed
//
// Environment variables needed:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_TOKEN (optional but recommended)
//
// To deploy: `supabase functions deploy daily-refresh`
// To set cron: add schedule in supabase/config.toml under [functions.daily-refresh]
