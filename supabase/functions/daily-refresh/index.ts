// daily-refresh: pulls internship listings from company job boards (Greenhouse, Lever,
// Ashby) and community GitHub lists, and saves them to the `listings` table.
// Runs once a day from the pg_cron job (migration 019), or on demand.
//
// Files: locations.ts (location cleanup), readme.ts (GitHub README parsers),
// helpers.ts (small pure helpers). helpers_test.ts and locations_test.ts test them.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  ashbyPay, cleanCompanyName, getType, greenhousePostedDate, isInternship, leverPay, type Listing,
  mapLimit, prepareListings, timingSafeEqual,
} from './helpers.ts';
import { jobLocation, normalizeGreenhouseLocation } from './locations.ts';
import { type GithubRepo, parseGithubReadme } from './readme.ts';

// GET a JSON API with a timeout. null when the request fails or the board doesn't
// exist (a missing Ashby board even answers with plain text, so only parse on success).
// deno-lint-ignore no-explicit-any
async function fetchJson(url: string, timeoutMs: number): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) { await res.body?.cancel(); return null; }
    return await res.json();
  } catch {
    return null;
  }
}

// ── Greenhouse ───────────────────────────────────────────────────────────────

// The companies I pull from Greenhouse's public job board API.
// Checked 2026-10-04: every slug here is a live board. 41 others returned 404 (moved
// off Greenhouse or renamed) and were removed. Many of those moved to Ashby or Lever
// and are read from there now (notion, ramp, plaid, snowflake, confluent, benchling,
// amplitude, clickup, miro). Duplicates fever/feverup and rocketlab/rocketlabusa
// resolved to the live one; internshiplist (an aggregator) is gone.
// hubspot was removed 2026-10-06 (its board started returning 404).
const GREENHOUSE_COMPANIES = [
  'cloudflare', 'didi', 'thesocialhub', 'ses', 'roku', 'celonis',
  'revolutionmedicines', 'asm', 'astranis', 'xometry', 'rocketlab', 'inter',
  'neuralink', 'agoda', 'feverup', 'hasbro', 'appier', 'dept', 'sezzle',
  'hunterdouglas', 'mirakl', 'bybit', 'casetify', 'sanmar', 'pacvue',
  'stripe', 'figma', 'discord', 'lyft', 'pinterest', 'mongodb', 'brex',
  'airtable', 'gusto', 'scaleai', 'mercury', 'webflow', 'intercom', 'lattice',
  'airbnb', 'instacart', 'robinhood', 'coinbase', 'databricks', 'duolingo',
  'squarespace', 'asana', 'twilio', 'datadog', 'elastic', 'mixpanel',
  'dropbox', 'okta', 'gitlab', 'mozilla', 'pendo', 'brainstation', 'workato',
  'toast', 'ripple', 'block', 'point72', 'virtu', 'verkada',
];

// Board names cleanCompanyName can't fix ("Inter Carreiras" = "Inter Careers").
const COMPANY_NAME_OVERRIDES: Record<string, string> = {
  inter:   'Inter',
  intercom: 'Intercom',   // board is branded "Fin", its AI product
};

// The company's real display name from its Greenhouse board ("scaleai" -> "Scale AI"),
// falling back to the slug with a capital first letter if the lookup fails.
async function fetchCompanyName(slug: string): Promise<string> {
  if (COMPANY_NAME_OVERRIDES[slug]) return COMPANY_NAME_OVERRIDES[slug];
  const board = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}`, 8000);
  return cleanCompanyName(String(board?.name ?? '')) || slug.charAt(0).toUpperCase() + slug.slice(1);
}

// Internship listings from one company's Greenhouse board.
async function fetchGreenhouse(slug: string): Promise<Listing[]> {
  try {
    const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, 8000);
    // deno-lint-ignore no-explicit-any
    const interns = (data?.jobs ?? []).filter((j: any) => isInternship(j.title));
    if (interns.length === 0) return [];
    // Only look up the name for boards that actually have internships (saves requests).
    const company = await fetchCompanyName(slug);
    // deno-lint-ignore no-explicit-any
    return interns.map((j: any): Listing => ({
      title:     j.title,
      company,
      location:  normalizeGreenhouseLocation(j.location?.name ?? null),
      pay:       null,
      type:      getType(j.title),
      url:       j.absolute_url,
      source:    'greenhouse',
      posted_at: greenhousePostedDate(j),
    }));
  } catch {
    return [];
  }
}

// ── Lever and Ashby ──────────────────────────────────────────────────────────

// Two more job-board systems with public APIs, like Greenhouse. Many companies that
// left Greenhouse moved to one of these. Neither API returns the company's name, so
// it's listed with the board's slug. Checked 2026-10-06: every board here is live.
// Boards marked "seasonal" had no internships that day but usually post them.
// Left out on purpose: slugs that belong to different companies on each platform
// (neon, unify, finch), and OpenAI (800+ jobs, no internships, a very large download).
const LEVER_COMPANIES: Record<string, string> = {
  palantir: 'Palantir', hermeus: 'Hermeus', aircall: 'Aircall', shieldai: 'Shield AI',
  belvederetrading: 'Belvedere Trading', waabi: 'Waabi', rigetti: 'Rigetti', matchgroup: 'Match Group',
  // seasonal
  spotify: 'Spotify', wealthfront: 'Wealthfront', zoox: 'Zoox',
};

const ASHBY_COMPANIES: Record<string, string> = {
  etched: 'Etched', saronic: 'Saronic', skydio: 'Skydio', helion: 'Helion', ramp: 'Ramp',
  snowflake: 'Snowflake', notion: 'Notion', perplexity: 'Perplexity', cohere: 'Cohere',
  harvey: 'Harvey', mercor: 'Mercor', '1x': '1X', abridge: 'Abridge', kalshi: 'Kalshi',
  sierra: 'Sierra', voleon: 'Voleon', speak: 'Speak', physicalintelligence: 'Physical Intelligence',
  chaidiscovery: 'Chai Discovery', decagon: 'Decagon', eightsleep: 'Eight Sleep', hex: 'Hex',
  lambda: 'Lambda', modal: 'Modal', pika: 'Pika', rho: 'Rho', sentry: 'Sentry',
  wealthsimple: 'Wealthsimple', weaviate: 'Weaviate', claylabs: 'Clay', commure: 'Commure',
  exa: 'Exa', ledger: 'Ledger', semgrep: 'Semgrep', replit: 'Replit',
  // seasonal
  confluent: 'Confluent', benchling: 'Benchling', handshake: 'Handshake', cerebras: 'Cerebras',
  crusoe: 'Crusoe', amplitude: 'Amplitude', '1password': '1Password', nerdwallet: 'NerdWallet',
  clickup: 'ClickUp', miro: 'Miro', snyk: 'Snyk', zapier: 'Zapier', plaid: 'Plaid', cursor: 'Cursor',
  whoop: 'WHOOP', quora: 'Quora', vanta: 'Vanta', supabase: 'Supabase', posthog: 'PostHog',
  elevenlabs: 'ElevenLabs', cognition: 'Cognition',
};

// Internship listings from one company's Lever board (one JSON array with every
// posting). The board's own "commitment" field also marks interns whose title doesn't.
async function fetchLever(slug: string): Promise<Listing[]> {
  try {
    const posts = await fetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json`, 15000);
    if (!Array.isArray(posts)) return [];
    return posts
      .filter(p => p.text && p.hostedUrl &&
                   (isInternship(p.text) || /^intern(ship)?s?$/i.test(p.categories?.commitment ?? '')))
      .map((p): Listing => ({
        title:     p.text.trim(),
        company:   LEVER_COMPANIES[slug],
        location:  jobLocation(p.categories?.allLocations ?? [p.categories?.location], p.workplaceType === 'remote'),
        pay:       leverPay(p.salaryRange),
        type:      getType(p.text),
        url:       p.hostedUrl,
        source:    'lever',
        posted_at: typeof p.createdAt === 'number' ? new Date(p.createdAt).toISOString().split('T')[0] : null,
      }));
  } catch {
    return [];
  }
}

// Internship listings from one company's Ashby board. Responses include full job
// descriptions (up to a few MB), so the handler fetches these a few at a time.
// employmentType "Intern" also marks interns whose title doesn't say so.
async function fetchAshby(slug: string): Promise<Listing[]> {
  try {
    const board = await fetchJson(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`, 15000);
    // deno-lint-ignore no-explicit-any
    const jobs: any[] = board?.jobs ?? [];
    return jobs
      .filter(j => j.title && j.jobUrl && j.isListed !== false &&
                   (isInternship(j.title) || j.employmentType === 'Intern'))
      .map((j): Listing => ({
        title:     j.title.trim(),
        company:   ASHBY_COMPANIES[slug],
        // workplaceType, not isRemote: Ashby sets isRemote on hybrid jobs too.
        location:  jobLocation([j.location, ...(j.secondaryLocations ?? []).map((s: { location?: string }) => s.location)],
                               j.workplaceType === 'Remote'),
        pay:       ashbyPay(j.compensation),
        type:      getType(j.title),
        url:       j.jobUrl,
        source:    'ashby',
        posted_at: j.publishedAt ? String(j.publishedAt).split('T')[0] : null,
      }));
  } catch {
    return [];
  }
}

// ── GitHub ───────────────────────────────────────────────────────────────────

// Community-maintained repos that track internships. Order matters: when two lists
// have the same posting, the earlier one's copy is kept (see dedupeKey).
//   SimplifyJobs  HTML table (the biggest, most active list)
//   vanshb03      markdown table: Company | Role | Location | Application/Link | Date Posted
//   zapplyjobs    markdown table: Company | Role | Location | Posted | Visa | Apply — links
//                 go through zapply.jobs redirects, resolved to the real posting below
//   deepanshu1422 open-source programs, contests, and bootcamps (not job postings) —
//                 see parseProgramTables in readme.ts
const GITHUB_REPOS: GithubRepo[] = [
  { owner: 'SimplifyJobs',  repo: 'Summer2027-Internships' },
  { owner: 'vanshb03',      repo: 'Summer2027-Internships' },
  { owner: 'zapplyjobs',    repo: 'Internships-2027', messyLocations: true },
  { owner: 'deepanshu1422', repo: 'List-Of-Open-Source-Internships-Programs', kind: 'programs' },
];

const ZAPPLY_HOST = /(^|\.)zapply\.jobs$/;

// zapply links (zapply.jobs/l/d/...) are redirects to the real posting. Following
// them gives Search a direct link and lets dedupeKey match the posting against the
// other lists. Returns:
//   - the real posting URL, when the redirect leads off zapply
//   - null, when zapply bounces to its own job board instead — the posting is gone
//     from zapply even though it's still in their README, so the listing is dropped
//   - the original link, if zapply can't be reached (no way to tell; it may still work)
async function resolveRedirectLink(url: string): Promise<string | null> {
  let current = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) break;
      current = new URL(location, current).toString();
      const u = new URL(current);
      if (!ZAPPLY_HOST.test(u.hostname)) return current;
      if (!u.pathname.startsWith('/l/')) return null;   // sent to zapply's board: expired
    }
  } catch { /* unreachable — keep the original */ }
  return url;
}

// Fetches the README from a GitHub repo, trying dev → main → master in order.
// Returns as soon as it finds a branch with actual listings.
//
// IMPORTANT: we deliberately send NO Authorization header. raw.githubusercontent.com
// is an unauthenticated CDN -- it is NOT the GitHub API and is not subject to the
// 60-req/hr limit, so a token buys nothing. Worse, an invalid/expired token makes
// raw.githubusercontent.com return 404 for every branch, which silently killed all
// GitHub ingestion (the catch swallows it) and left the DB Greenhouse-only.
async function fetchGithubRepo(gh: GithubRepo): Promise<Listing[]> {
  const headers = { 'User-Agent': 'SimplyIntern/1.0' };

  for (const branch of ['dev', 'main', 'master']) {
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${branch}/README.md`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) continue;
      const jobs = parseGithubReadme(await res.text(), gh);
      if (jobs.length === 0) continue;
      // Swap redirect links for the real posting URL (8 at a time); drop expired ones.
      const resolved = await mapLimit(jobs, 8, async (j): Promise<Listing | null> => {
        if (!ZAPPLY_HOST.test(new URL(j.url).hostname)) return j;
        const url = await resolveRedirectLink(j.url);
        return url ? { ...j, url } : null;
      });
      return resolved.filter((j): j is Listing => j !== null);
    } catch {
      continue;
    }
  }
  return [];
}

// ── Handler ──────────────────────────────────────────────────────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Pulls fresh listings from every source, deduplicates them, upserts everything to the
// DB, and cleans up anything not seen in the last 30 days.
//
// Locked with a shared secret: the function has to stay verify_jwt = false (the cron
// job calls it with the public key, not a user JWT), so without this check anyone
// with the public key could trigger a full ~135-board scrape whenever they liked.
// The cron job reads the same secret from Supabase Vault and sends it as a header.
Deno.serve(async (req: Request) => {
  // Trimmed on both sides: a stray space or newline picked up while copy-pasting the
  // secret into the dashboard or a header shouldn't lock the cron job out.
  const expected = (Deno.env.get('REFRESH_SECRET') ?? '').trim();
  if (!expected) {
    // Fail closed: a missing secret must never mean "open to everyone".
    console.error('daily-refresh: REFRESH_SECRET is not set — refusing to run.');
    return json(500, { error: 'Not configured' });
  }
  if (!timingSafeEqual((req.headers.get('x-refresh-secret') ?? '').trim(), expected)) {
    return json(401, { error: 'Unauthorized' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  // Fetch all sources in parallel to keep the function fast. Lever and Ashby go a few
  // boards at a time: their responses are large, and this keeps memory use down.
  const [ghResults, leverResults, ashbyResults, gitResults] = await Promise.all([
    Promise.all(GREENHOUSE_COMPANIES.map(fetchGreenhouse)),
    mapLimit(Object.keys(LEVER_COMPANIES), 4, fetchLever),
    mapLimit(Object.keys(ASHBY_COMPANIES), 4, fetchAshby),
    Promise.all(GITHUB_REPOS.map(fetchGithubRepo)),
  ]);

  // Direct company boards first, so they win when a GitHub list has the same posting.
  const unique = prepareListings([
    ...ghResults.flat(),
    ...leverResults.flat(),
    ...ashbyResults.flat(),
    ...gitResults.flat(),
  ], new Date().toISOString());

  // Upsert in batches of 500 to stay within Supabase request size limits
  let upserted = 0;
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const { error } = await supabase
      .from('listings')
      .upsert(batch, { onConflict: 'url' });
    if (!error) upserted += batch.length;
    else console.error('Upsert batch error:', error.message);
  }

  // Remove listings that haven't been refreshed in 30 days — they're probably closed
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: removed } = await supabase
    .from('listings')
    .delete({ count: 'exact' })
    .lt('updated_at', cutoff);

  // `failed` > 0 means a batch was rejected — check the logs for "Upsert batch error".
  const summary = { total_found: unique.length, upserted, failed: unique.length - upserted, removed: removed ?? 0 };
  console.log('daily-refresh complete:', summary);

  return json(200, summary);
});
