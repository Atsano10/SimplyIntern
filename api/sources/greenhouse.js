// Greenhouse Job Feed Fetcher
//
// What goes here:
//   - A list of target companies that use Greenhouse (e.g. Stripe, Notion, Figma, etc.)
//   - fetchGreenhouseJobs(company) — hits `https://boards.greenhouse.io/{company}/jobs.json`
//   - fetchAllGreenhouse() — loops over all companies and aggregates results
//   - Normalize each job into the standard format:
//       { title, company, location, pay, type, url, source: 'greenhouse', posted_at }
//   - Filter to only internship-relevant roles (keyword match on title: intern, co-op, etc.)
//   - Handle failed/offline company boards gracefully (try/catch per company)
//
// This module is imported by supabase/functions/daily-refresh/index.ts
