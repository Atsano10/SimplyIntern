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

const INTERN_RE = /\b(intern|internship|co-op|coop|co\s+op|externship|extern|summer|winter)\b/i;

const isInternship = (text: string) => INTERN_RE.test(text);

function getType(title: string): string {
  const lower = title.toLowerCase();
  if (['co-op', 'coop', 'co op'].some(kw => lower.includes(kw))) return 'co-op';
  if (['extern', 'externship'].some(kw => lower.includes(kw)))   return 'externship';
  return 'internship';
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Location normalisation ───────────────────────────────────────────────────

const STATE_CODES: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY',
};

function titleCase(s: string): string {
  return s.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '').join(' ');
}

function normalizeOnePart(part: string): string {
  const p = part.trim();
  if (!p) return '';
  if (/\bremote\b/i.test(p)) return 'Remote';

  if (/^us->/i.test(p)) {
    const rest = p.slice(4).replace(/_/g, ' ').trim();
    if (/\bremote\b/i.test(rest)) return 'Remote';
    if (/^washington[\s,]+dc$/i.test(rest) || /^district of columbia$/i.test(rest)) return 'Washington, DC';
    const withCode = rest.match(/^(.+),\s*([A-Za-z]{2})$/);
    if (withCode) return `${titleCase(withCode[1])}, ${withCode[2].toUpperCase()}`;
    const code = STATE_CODES[rest.toLowerCase()];
    if (code) return `${titleCase(rest)}, ${code}`;
    return titleCase(rest);
  }

  // Other country->city format (canada->toronto, uk->london)
  const arrowMatch = p.match(/^([a-z][a-z_\s]*)->.*/i);
  if (arrowMatch) return titleCase(arrowMatch[1].replace(/_/g, ' ').trim());

  // Plain word / underscore-separated country name (india, united_kingdom)
  if (/^[a-z][a-z_\s]*$/i.test(p) && !p.includes(',')) return titleCase(p.replace(/_/g, ' '));

  // Already clean (Greenhouse "San Francisco, CA", "London, England")
  return p;
}

function normalizeLocation(raw: string): string | null {
  if (!raw) return null;
  const detagged = raw
    .replace(/<br\s*\/?>/gi, '|')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!detagged) return null;
  const parts = detagged.split('|').map(p => p.trim()).filter(Boolean);
  const normalized = [...new Set(parts.map(normalizeOnePart).filter(Boolean))];
  if (normalized.length === 0) return null;
  return normalized.join(' / ');
}

// ─── Greenhouse ──────────────────────────────────────────────────────────────

const GREENHOUSE_COMPANIES = [
  // From leaderboard — active Greenhouse boards with internship listings
  'ey', 'cloudflare', 'didi', 'alo', 'thesocialhub', 'ses', 'roku', 'celonis',
  'anymindgroup', 'munichre', 'sonypicturesentertainment', 'snowflake',
  'revolutionmedicines', 'authenticbrands', 'internshiplist', 'asm', 'astranis',
  'xometry', 'rocketlab', 'inter', 'neuralink', 'equipmentshare', 'lge',
  'gallagher', 'stepstonegroup', 'fever', 'planet', 'agoda', 'sentinelone',
  'feverup', 'superhuman', 'aeg', 'rocketlabusa', 'hasbro', 'appier', 'dept',
  'sezzle', 'hunterdouglas', 'unity', 'dialectica', 'mirakl', 'bybit',
  'rocket', 'casetify', 'sanmar', 'pacvue', 'xpeng',
  'stripe', 'figma', 'notion', 'discord', 'lyft', 'pinterest', 'mongodb',
  'brex', 'plaid', 'ramp', 'airtable', 'retool', 'gusto', 'rippling',
  'amplitude', 'hashicorp', 'confluent', 'scaleai', 'mercury', 'webflow',
  'intercom', 'benchling', 'lattice', 'airbnb', 'doordash', 'instacart',
  'robinhood', 'coinbase', 'databricks', 'duolingo', 'squarespace', 'asana',
  'twilio', 'zendesk', 'hubspot', 'datadog', 'elastic', 'mixpanel',
  'grammarly', 'loom', 'deel', 'dropbox', 'okta', 'gitlab', 'mozilla',
  'clickup', 'miro', 'pendo', 'fullstory', 'heap', 'segment', 'brainstation',
  'workato', 'toast', 'ripple', 'block', 'point72', 'virtu', 'verkada',
];

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
        pay:        null,
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

// ─── GitHub ──────────────────────────────────────────────────────────────────

const GITHUB_REPOS = [
  { owner: 'SimplifyJobs', repo: 'Summer2026-Internships' },
  { owner: 'vanshb03',     repo: 'Summer2027-Internships' },
];

// Parses the HTML <table> format used by SimplifyJobs repos.
// deno-lint-ignore no-explicit-any
function parseHtmlTable(content: string): Listing[] {
  const jobs: Listing[] = [];
  let lastCompany = '';

  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
  let rowM: RegExpExecArray | null;

  while ((rowM = rowRe.exec(content)) !== null) {
    const rowHtml = rowM[1];
    const tdRe = /<td>([\s\S]*?)<\/td>/gi;
    const cols: string[] = [];
    let tdM: RegExpExecArray | null;
    while ((tdM = tdRe.exec(rowHtml)) !== null) cols.push(tdM[1].trim());
    if (cols.length < 4) continue;

    const [companyCol, roleCol, locationCol, linkCol] = cols;

    // Company: extract from <a> tag, or carry forward last for ↳ rows
    const rawCompanyText = companyCol.replace(/<[^>]+>/g, '').replace(/[🔥🔒]/g, '').trim();
    let company: string;
    if (rawCompanyText === '↳') {
      if (!lastCompany) continue;
      company = lastCompany;
    } else {
      const aM = companyCol.match(/<a[^>]*>([^<]+)<\/a>/);
      company = (aM ? aM[1] : rawCompanyText).replace(/[🔥🔒]/g, '').trim();
      if (!company) continue;
      lastCompany = company;
    }

    const role     = roleCol.replace(/<[^>]+>/g, '').replace(/[🔒✅❌🛂🎓]/g, '').trim();
    const location = normalizeLocation(locationCol);
    const urlM     = linkCol.match(/href="(https?:\/\/[^"]+)"/);
    const url      = urlM?.[1];
    if (!url || !role || !isInternship(role)) continue;

    jobs.push({
      title: role, company, location, pay: null,
      type: getType(role), url, source: 'github',
      posted_at: null, updated_at: new Date().toISOString(),
    });
  }
  return jobs;
}

// Parses the legacy markdown pipe-table format used by some repos.
function parsePipeTable(content: string): Listing[] {
  const lines = content.split('\n');
  const jobs: Listing[] = [];
  let rowsInTable = 0;
  let lastCompany = '';

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

    const role = roleRaw.replace(/[*_`[\]🔒✅❌🛂🎓]/g, '').trim();
    const companyClean = companyRaw.replace(/[*_`[\]🔥]/g, '').trim();
    let company: string;
    if (companyClean === '↳') {
      if (!lastCompany) continue;
      company = lastCompany;
    } else {
      company = companyClean;
      if (company) lastCompany = company;
    }

    const location = normalizeLocation(locationRaw.replace(/[*_`[\]]/g, '').trim());
    if (!role || !company || !isInternship(role)) continue;

    jobs.push({
      title: role, company, location, pay: null,
      type: getType(role), url, source: 'github',
      posted_at: null, updated_at: new Date().toISOString(),
    });
  }
  return jobs;
}

function parseGithubReadme(content: string): Listing[] {
  return /<table[\s>]/i.test(content)
    ? parseHtmlTable(content)
    : parsePipeTable(content);
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
      const jobs = parseGithubReadme(await res.text());
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
  const [ghResults, gitResults] = await Promise.all([
    Promise.all(GREENHOUSE_COMPANIES.map(fetchGreenhouse)),
    Promise.all(GITHUB_REPOS.map(({ owner, repo }) => fetchGithubRepo(owner, repo, githubToken))),
  ]);

  const allJobs: Listing[] = [
    ...ghResults.flat(),
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
