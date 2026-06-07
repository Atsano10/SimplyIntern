// GitHub Internship List Fetcher
//
// What goes here:
//   - Fetch curated internship markdown tables from repos like:
//       pittcsc/Summer2025-Internships (README.md)
//       SimplifyJobs/New-Grad-Positions (README.md)
//   - Use the GitHub REST API: GET /repos/{owner}/{repo}/readme (returns base64 content)
//   - Parse the markdown table rows into structured job objects
//   - Normalize into the standard format:
//       { title, company, location, pay, type, url, source: 'github', posted_at }
//   - Skip rows marked as "closed" or with a ❌ symbol
//   - Handle rate limits — use a GitHub token from env if available (GITHUB_TOKEN)
//
// This module is imported by supabase/functions/daily-refresh/index.ts
