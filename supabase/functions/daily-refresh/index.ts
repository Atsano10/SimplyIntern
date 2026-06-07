// Supabase Edge Function — runs on Deno (not Node.js).
// Scheduled via config.toml to run once per day at 6am UTC.
//
// Flow: fetch Greenhouse + GitHub → deduplicate by URL → upsert to listings table
//       → delete rows not seen in 30 days (dead link cleanup)
//
// Required secrets (set via: supabase secrets set KEY=value):
//   SUPABASE_SERVICE_ROLE_KEY  — allows writing to the listings table
//   GITHUB_TOKEN               — optional, raises GitHub API rate limit from 60 to 5000/hr

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Listing {
  title:      string;
  company:    string;
  location:   string | null;
  pay:        string | null;
  type:       string;
  url:        string;
  source:     string;
  posted_at:  string | null;
  updated_at: string;
}

// ─── Greenhouse ──────────────────────────────────────────────────────────────

const GREENHOUSE_COMPANIES = [
  'stripe', 'figma', 'notion', 'discord', 'cloudflare',
  'lyft', 'pinterest', 'mongodb', 'brex', 'plaid',
  'ramp', 'airtable', 'retool', 'gusto', 'rippling',
  'amplitude', 'hashicorp', 'confluent', 'scaleai',
  'mercury', 'webflow', 'intercom', 'benchling', 'lattice',
];

const INTERN_KEYWORDS = ['intern', 'internship', 'co-op', 'coop', 'summer'];
const isInternship = (title: string) =>
  INTERN_KEYWORDS.some(kw => title.toLowerCase().includes(kw));

async function fetchGreenhouse(company: string): Promise<Listing[]> {
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${company}/jobs`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json();
    return (data.jobs ?? [])
      .filter((j: any) => isInternship(j.title))
      .map((j: any): Listing => ({
        title:      j.title,
        company:    company.charAt(0).toUpperCase() + company.slice(1),
        location:   j.location?.name ?? null,
        pay:        null,
        type:       'internship',
        url:        j.absolute_url,
        source:     'greenhouse',
        posted_at:  j.updated_at ? j.updated_at.split('T')[0] : null,
        updated_at: new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

// ─── GitHub ──────────────────────────────────────────────────────────────────

const GITHUB_REPOS = [
  { owner: 'pittcsc',      repo: 'Summer2026-Internships' },
  { owner: 'SimplifyJobs', repo: 'Summer2026-Internships' },
];

function parseMarkdownTable(content: string): Listing[] {
  const lines = content.split('\n');
  const jobs: Listing[] = [];
  let rowsInTable = 0;

  for (const line of lines) {
    if (!line.trim().startsWith('|')) { rowsInTable = 0; continue; }
    rowsInTable++;
    if (rowsInTable <= 2) continue; // header + separator

    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 4) continue;

    const [companyRaw, roleRaw, locationRaw, linkCol] = cols;

    const mdLink   = linkCol.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
    const htmlLink = linkCol.match(/href="(https?:\/\/[^"]+)"/);
    const url = mdLink?.[1] ?? htmlLink?.[1];
    if (!url) continue;

    const role    = roleRaw.replace(/[*_`[\]🔒✅❌]/g, '').trim();
    const company = companyRaw.replace(/[*_`[\]]/g, '').trim();
    const location = locationRaw.replace(/[*_`[\]]/g, '').trim();

    if (!role || !company || !isInternship(role)) continue;

    jobs.push({
      title:      role,
      company,
      location:   location || null,
      pay:        null,
      type:       'internship',
      url,
      source:     'github',
      posted_at:  null,
      updated_at: new Date().toISOString(),
    });
  }
  return jobs;
}

async function fetchGithubRepo(owner: string, repo: string, token?: string): Promise<Listing[]> {
  try {
    const headers: Record<string, string> = { 'User-Agent': 'SimplyIntern/1.0' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    return parseMarkdownTable(await res.text());
  } catch {
    return [];
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
// Deno.serve() is how Edge Functions register their HTTP handler.
// The cron scheduler calls this function via HTTP once per day.

Deno.serve(async (_req: Request) => {
  // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase into every Edge Function
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const githubToken = Deno.env.get('GITHUB_TOKEN');

  // Fetch all sources in parallel — don't wait for one before starting another
  const ghResults = await Promise.all(GREENHOUSE_COMPANIES.map(fetchGreenhouse));
  const gitResults = await Promise.all(
    GITHUB_REPOS.map(({ owner, repo }) => fetchGithubRepo(owner, repo, githubToken))
  );

  const allJobs: Listing[] = [...ghResults.flat(), ...gitResults.flat()];

  // Deduplicate by URL — a job can appear in both Greenhouse and GitHub repos
  const seen = new Set<string>();
  const unique = allJobs.filter(j => {
    if (seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });

  // Upsert in batches of 500 (Supabase has a row limit per request)
  // onConflict: 'url' means: if a row with this URL already exists, update it
  // This also bumps updated_at to now(), which is how we track "still alive" listings
  let upserted = 0;
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const { error } = await supabase
      .from('listings')
      .upsert(batch, { onConflict: 'url' });
    if (!error) upserted += batch.length;
    else console.error('Upsert batch error:', error.message);
  }

  // Dead link cleanup: delete any listing whose updated_at wasn't touched in 30 days.
  // If a company's Greenhouse board goes offline and stays offline, jobs age out naturally.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: removed } = await supabase
    .from('listings')
    .delete({ count: 'exact' })
    .lt('updated_at', cutoff);

  const summary = { total_found: unique.length, upserted, removed: removed ?? 0 };
  console.log('daily-refresh complete:', summary);

  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
