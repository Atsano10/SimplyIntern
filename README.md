# SimplyIntern

A clean, automated internship aggregator that pulls listings from multiple sources into one unified feed — with saved jobs, application tracking, a global leaderboard, and daily auto-refresh.

**Live:** [simply-intern.vercel.app](https://simply-intern.vercel.app)

## Features

- **Search** — Filter internship listings by keyword, location, industry, job type, posting date, and remote-only, sorted newest/oldest/company. Filtering runs server-side with infinite scroll.
- **Saved** — Bookmark listings into a shortlist and move them to the tracker once applied
- **Tracker** — Log applications with status, notes, pay, and dates; organize them into recruitment-cycle folders; import from a CSV/TSV spreadsheet export; see a funnel and response/interview/offer rates
- **Leaderboard** — Compete on a "Grind Score" (rejected + pending applications in the current cycle), with an opt-out in settings
- **Daily Refresh** — Listings auto-update every day; listings not seen for 30 days are removed
- **Auth** — Email/password (with email verification and password reset) and Google OAuth, plus account settings, dark mode, and account deletion

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML5, CSS3 |
| Backend | Supabase (PostgreSQL + Auth + Row Level Security + Edge Functions) |
| Scraping | Deno Edge Function (TypeScript), scheduled with `pg_cron` |
| Deployment | Vercel (static hosting) |

## Data Sources

- **Greenhouse** — Public job boards from 65 companies (Stripe, Figma, Databricks, Coinbase, Lyft, etc.)
- **GitHub internship lists** — [SimplifyJobs/Summer2027-Internships](https://github.com/SimplifyJobs/Summer2027-Internships), [vanshb03/Summer2027-Internships](https://github.com/vanshb03/Summer2027-Internships), and [zapplyjobs/Internships-2027](https://github.com/zapplyjobs/Internships-2027)
- **Open-source programs** — [deepanshu1422/List-Of-Open-Source-Internships-Programs](https://github.com/deepanshu1422/List-Of-Open-Source-Internships-Programs) (GSoC, Outreachy, MLH Fellowship, contests, bootcamps), each labeled Paid stipend / Unpaid / Tuition on Search

Listings are deduplicated by URL and location is normalized to a consistent `City, ST` / `City, Country` format across all sources.

## Project Structure

```
├── .github/workflows/ci.yml  # Tests, lint, and the Vercel build on every push
├── frontend/                 # Vercel Root Directory
│   ├── index.html            # Login
│   ├── signup.html           # Registration
│   ├── reset-password.html   # Password reset (from emailed link)
│   ├── search.html           # Job search
│   ├── saved.html            # Saved jobs
│   ├── tracker.html          # Application tracker
│   ├── leaderboard.html      # Global rankings
│   ├── settings.html         # Account settings
│   ├── js/                   # Page logic + shared modules (util.js, auth.js, nav.js)
│   ├── css/                  # Per-page stylesheets
│   ├── images/               # Logo, favicons
│   ├── scripts/
│   │   └── inject-env.js     # Build step: writes js/config.js from env vars
│   └── vercel.json           # Build config + security headers (CSP)
└── supabase/
    ├── migrations/           # DB schema, RLS, RPCs, cron schedule
    ├── tests/                # SQL smoke tests
    └── functions/
        ├── daily-refresh/    # Scheduled scraping Edge Function
        └── verify-link/      # Checks that a pasted listing link is real
└── tests/frontend/           # Unit tests for the shared JS, CSV import, and HTML pages
```

## Local Development

**Prerequisites:** Node.js (no npm dependencies needed)

1. Clone the repo:
   ```bash
   git clone https://github.com/Atsano10/SimplyIntern.git
   cd SimplyIntern/frontend
   ```

2. Generate `js/config.js` with your Supabase credentials:
   ```bash
   SUPABASE_URL=https://<project>.supabase.co SUPABASE_ANON_KEY=<anon-key> node scripts/inject-env.js
   ```

3. Serve the `frontend/` folder with any static server (e.g. VS Code Live Server) and open `index.html`.

Note: the security headers in `frontend/vercel.json` are only applied on Vercel, not by a local static server.

## Testing

Tests run with [Deno](https://deno.com), from the repo root:

```bash
deno test supabase/functions                  # scraper + link-checker helpers
deno test --allow-read tests                  # shared JS, CSV import, HTML page checks
deno lint --rules-exclude=no-import-prefix supabase/functions tests
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of these on every push, plus the Vercel build step, and shows ✅ / ❌ on the commit. The frontend tests run in two timezones (New York and Tokyo), since date handling can differ on either side of UTC.

## Deployment

The app is deployed on [Vercel](https://vercel.com) with the project's **Root Directory set to `frontend/`**. Vercel only reads `vercel.json` from the Root Directory, so `frontend/vercel.json` is the one that applies. On each deploy, `frontend/scripts/inject-env.js` runs as the build step: it writes the Supabase credentials into `js/config.js`, then stamps every local script/stylesheet URL in the HTML pages with a hash of that file's contents (`js/util.js?v=3f9c2a1b7e`).

Set the following environment variables in your Vercel project:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Cache busting is automatic: editing a JS or CSS file changes its hash, so browsers fetch the new copy, while unchanged files stay cached (stamped URLs get a one-year `immutable` cache header). Don't add `?v=` to the HTML by hand. Reference new files as plain `js/x.js` / `css/x.css`, and the build stamps them. A page that points at a file that doesn't exist fails the build.

**Supabase:** migrations in `supabase/migrations/` are applied manually in order (via the Supabase SQL Editor). The `daily-refresh` Edge Function is deployed with the Supabase CLI and triggered daily at 06:00 UTC by the `pg_cron` job in migration `010`.

**New recruitment cycle:** update `CURRENT_CYCLE` / `PREDEFINED_CYCLES` in `frontend/js/util.js` and the cycle literal in the `leaderboard_counts` view (latest leaderboard migration, currently 018) together.

## Database Schema

| Object | Purpose |
|---|---|
| `listings` | Internship job postings (public read-only) |
| `profiles` | User accounts (username, email, leaderboard opt-out) |
| `applications` | Per-user application records (status, cycle, interview milestone) |
| `saved_jobs` | Per-user bookmarked listings |
| `folders` | Per-user custom tracker folders |
| `leaderboard_scores` (view) | Aggregated usernames + counts only — no emails or notes |
| `search_listings()` (RPC) | Server-side filtered, paginated listing search |
| `username_exists()` (RPC) | Safe username availability check |
| `delete_user()` (RPC) | Deletes the caller's own account |

All user tables are protected by Row Level Security, scoped to the signed-in user.

## License

MIT
