# SimplyIntern

A clean, automated internship aggregator that pulls listings from multiple sources into one unified feed — with application tracking, a global leaderboard, and daily auto-refresh.

## Features

- **Search** — Filter 1000+ internship listings by location, industry, job type, and keyword
- **Tracker** — Log and track your applications with status, notes, pay, and dates
- **Leaderboard** — Compete globally on a "Grind Score" based on application activity
- **Daily Refresh** — Listings auto-update every day; dead links are removed automatically
- **Auth** — Email/password and Google OAuth with account management

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML5, CSS3 |
| Backend | Supabase (PostgreSQL + Auth + Edge Functions) |
| Scraping | Deno Edge Function (TypeScript) |
| Deployment | Vercel (static hosting) |

## Data Sources

- **Greenhouse** — Public job boards from 48+ companies (Stripe, Figma, Notion, Discord, Lyft, etc.)
- **GitHub** — [SimplifyJobs/Summer2026-Internships](https://github.com/SimplifyJobs/Summer2026-Internships) and [vanshb03/Summer2027-Internships](https://github.com/vanshb03/Summer2027-Internships)

Listings are deduplicated by URL and location is normalized to a consistent `City, ST` / `City, Country` format across all sources.

## Project Structure

```
├── frontend/
│   ├── index.html          # Login
│   ├── signup.html         # Registration
│   ├── search.html         # Job search
│   ├── tracker.html        # Application tracker
│   ├── leaderboard.html    # Global rankings
│   ├── settings.html       # Account settings
│   ├── js/                 # Page logic + shared modules
│   └── css/                # Per-page stylesheets
├── supabase/
│   ├── migrations/         # DB schema
│   └── functions/
│       └── daily-refresh/  # Scheduled scraping Edge Function
├── scripts/
│   └── inject-env.js       # Build-time env injection
└── vercel.json
```

## Local Development

**Prerequisites:** Node.js, Supabase CLI

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/Atsano10/SimplyIntern.git
   cd SimplyIntern
   npm install
   ```

2. Set up environment variables:
   ```bash
   cp .env.example .env
   # Fill in SUPABASE_URL and SUPABASE_ANON_KEY
   ```

3. Inject env vars and serve the frontend:
   ```bash
   node scripts/inject-env.js
   # Then open frontend/index.html in a browser or use a local server
   ```

## Deployment

The app is deployed on [Vercel](https://vercel.com). On each deploy, `scripts/inject-env.js` runs as the build step to write Supabase credentials into `frontend/js/config.js`.

Set the following environment variables in your Vercel project:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

The `daily-refresh` Edge Function is deployed via Supabase and runs on a daily schedule to scrape and sync listings.

## Database Schema

| Table | Purpose |
|---|---|
| `listings` | Internship job postings (public read-only) |
| `profiles` | User accounts (username, leaderboard opt-out) |
| `applications` | Per-user application records |

