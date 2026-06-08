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

// ─── Classification helpers ──────────────────────────────────────────────────

const INTERN_KEYWORDS = ['intern', 'internship', 'co-op', 'coop', 'co op', 'externship', 'extern'];

const isInternship = (text: string) =>
  INTERN_KEYWORDS.some(kw => text.toLowerCase().includes(kw));

function getType(title: string): string {
  const lower = title.toLowerCase();
  if (['co-op', 'coop', 'co op'].some(kw => lower.includes(kw))) return 'co-op';
  if (['extern', 'externship'].some(kw => lower.includes(kw)))   return 'externship';
  return 'internship';
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Greenhouse ──────────────────────────────────────────────────────────────

const GREENHOUSE_COMPANIES = [
  // Original set
  'stripe', 'figma', 'notion', 'discord', 'cloudflare',
  'lyft', 'pinterest', 'mongodb', 'brex', 'plaid',
  'ramp', 'airtable', 'retool', 'gusto', 'rippling',
  'amplitude', 'hashicorp', 'confluent', 'scaleai',
  'mercury', 'webflow', 'intercom', 'benchling', 'lattice',
  // Expanded
  'airbnb', 'doordash', 'instacart', 'robinhood', 'coinbase',
  'databricks', 'duolingo', 'squarespace', 'asana', 'twilio',
  'zendesk', 'hubspot', 'datadog', 'elastic', 'mixpanel',
  'grammarly', 'loom', 'deel', 'dropbox', 'okta',
  'gitlab', 'mozilla', 'clickup', 'miro', 'pendo',
  'fullstory', 'heap', 'segment', 'brainstation', 'workato',
];

function extractGreenhousePay(job: any): string | null {
  // Some companies configure a pay/salary metadata field on their Greenhouse board
  for (const meta of (job.metadata ?? [])) {
    if (!meta.name || !meta.value) continue;
    const name = meta.name.toLowerCase();
    if (['pay', 'salary', 'compensation', 'wage', 'rate', 'stipend'].some(k => name.includes(k))) {
      return String(meta.value).trim();
    }
  }
  // Fallback: parse a pay pattern directly from the job title e.g. "$25/hr"
  const m = (job.title ?? '').match(/\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*\/\s*(?:hr|hour|yr|year|mo|month))?/i);
  return m ? m[0] : null;
}

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
        company:    capitalize(company),
        location:   j.location?.name ?? null,
        pay:        extractGreenhousePay(j),
        type:       getType(j.title),
        url:        j.absolute_url,
        source:     'greenhouse',
        posted_at:  j.updated_at ? j.updated_at.split('T')[0] : null,
        updated_at: new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

// ─── Lever ───────────────────────────────────────────────────────────────────

const LEVER_COMPANIES = [
  'netflix', 'reddit', 'twitch', 'coursera', 'khanacademy',
  'descript', 'faire', 'checkr', 'gem', 'outreach',
  'persona', 'ironclad', 'nerdwallet', 'seatgeek', 'betterment',
  'carta', 'addepar', 'blend', 'unit', 'plaid',
];

function extractLeverPay(job: any): string | null {
  if (!job.salaryRange) return null;
  const { currency = '$', min, max, interval } = job.salaryRange;
  const suffix = interval ? `/${interval.replace('per-', '')}` : '';
  if (min && max) return `${currency}${Number(min).toLocaleString()}–${currency}${Number(max).toLocaleString()}${suffix}`;
  if (min)        return `${currency}${Number(min).toLocaleString()}+${suffix}`;
  return null;
}

async function fetchLever(company: string): Promise<Listing[]> {
  try {
    const res = await fetch(
      `https://api.lever.co/v0/postings/${company}?mode=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter((j: any) => isInternship(j.text ?? '') || isInternship(j.categories?.commitment ?? ''))
      .map((j: any): Listing => ({
        title:      j.text ?? 'Untitled',
        company:    capitalize(company),
        location:   j.categories?.location ?? null,
        pay:        extractLeverPay(j),
        type:       getType(j.text ?? ''),
        url:        j.hostedUrl ?? '',
        source:     'lever',
        posted_at:  j.createdAt ? new Date(j.createdAt).toISOString().split('T')[0] : null,
        updated_at: new Date().toISOString(),
      }))
      .filter((j: Listing) => Boolean(j.url));
  } catch {
    return [];
  }
}

// ─── Ashby ───────────────────────────────────────────────────────────────────

const ASHBY_COMPANIES = [
  'openai', 'anthropic', 'replit', 'cohere', 'together',
  'modal', 'braintrust', 'cursor', 'perplexity', 'posthog',
  'anyscale', 'prefect', 'codeium', 'supabase', 'linear',
  'vercel', 'netlify', 'loom', 'descript', 'planetscale',
];

function extractAshbyPay(job: any): string | null {
  const comp = job.compensation;
  if (!comp) return null;
  const { min, max, currency = 'USD', interval } = comp;
  if (!min && !max) return null;
  const sym = currency === 'USD' ? '$' : currency;
  const suffix = interval ? `/${interval.toLowerCase().replace('ly', '').replace('per-', '')}` : '';
  if (min && max) return `${sym}${Number(min).toLocaleString()}–${sym}${Number(max).toLocaleString()}${suffix}`;
  return `${sym}${Number(min || max).toLocaleString()}${suffix}`;
}

async function fetchAshby(company: string): Promise<Listing[]> {
  try {
    const res = await fetch(
      'https://api.ashbyhq.com/posting-public/job/list',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationHostedJobsPageName: company }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json();
    if (!data.success || !Array.isArray(data.results)) return [];
    return data.results
      .filter((j: any) => j.isListed && (isInternship(j.title ?? '') || j.employmentType === 'Intern'))
      .map((j: any): Listing => ({
        title:      j.title ?? 'Untitled',
        company:    capitalize(company),
        location:   j.locationName ?? null,
        pay:        extractAshbyPay(j),
        type:       j.employmentType === 'Intern' ? 'internship' : getType(j.title ?? ''),
        url:        j.jobUrl ?? '',
        source:     'ashby',
        posted_at:  j.publishedDate ? j.publishedDate.split('T')[0] : null,
        updated_at: new Date().toISOString(),
      }))
      .filter((j: Listing) => Boolean(j.url));
  } catch {
    return [];
  }
}

// ─── GitHub ──────────────────────────────────────────────────────────────────

const GITHUB_REPOS = [
  { owner: 'pittcsc',      repo: 'Summer2026-Internships' },
  { owner: 'SimplifyJobs', repo: 'Summer2026-Internships' },
  { owner: 'ouckah',       repo: 'Summer2026-Internships' },
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

    const role     = roleRaw.replace(/[*_`[\]🔒✅❌]/g, '').trim();
    const company  = companyRaw.replace(/[*_`[\]]/g, '').trim();
    const location = locationRaw.replace(/[*_`[\]]/g, '').trim();

    if (!role || !company || !isInternship(role)) continue;

    jobs.push({
      title:      role,
      company,
      location:   location || null,
      pay:        null,
      type:       getType(role),
      url,
      source:     'github',
      posted_at:  null,
      updated_at: new Date().toISOString(),
    });
  }
  return jobs;
}

// Tries dev → main → master so repos with a dev branch get the freshest data.
async function fetchGithubRepo(owner: string, repo: string, token?: string): Promise<Listing[]> {
  const headers: Record<string, string> = { 'User-Agent': 'SimplyIntern/1.0' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  for (const branch of ['dev', 'main', 'master']) {
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) continue;
      const jobs = parseMarkdownTable(await res.text());
      if (jobs.length > 0) return jobs;
    } catch {
      continue;
    }
  }
  return [];
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const githubToken = Deno.env.get('GITHUB_TOKEN');

  // Fetch all sources in parallel
  const [ghResults, leverResults, ashbyResults, gitResults] = await Promise.all([
    Promise.all(GREENHOUSE_COMPANIES.map(fetchGreenhouse)),
    Promise.all(LEVER_COMPANIES.map(fetchLever)),
    Promise.all(ASHBY_COMPANIES.map(fetchAshby)),
    Promise.all(GITHUB_REPOS.map(({ owner, repo }) => fetchGithubRepo(owner, repo, githubToken))),
  ]);

  const allJobs: Listing[] = [
    ...ghResults.flat(),
    ...leverResults.flat(),
    ...ashbyResults.flat(),
    ...gitResults.flat(),
  ];

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = allJobs.filter(j => {
    if (seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });

  // Upsert in batches of 500
  let upserted = 0;
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const { error } = await supabase
      .from('listings')
      .upsert(batch, { onConflict: 'url' });
    if (!error) upserted += batch.length;
    else console.error('Upsert batch error:', error.message);
  }

  // Delete listings not refreshed in 30 days
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
