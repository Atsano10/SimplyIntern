import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { cleanCompanyName, timingSafeEqual } from './helpers.ts';

// Shape of a job listing as stored in the DB
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

// Internship detection

// I check job titles against this regex to filter out full-time roles from the scraped data
const INTERN_RE = /\b(intern|internship|co-op|coop|co\s+op|externship|extern|summer|winter)\b/i;

const isInternship = (text: string) => INTERN_RE.test(text);

// Figures out whether a listing is an internship, co-op, or externship based on its title
function getType(title: string): string {
  const lower = title.toLowerCase();
  if (['co-op', 'coop', 'co op'].some(kw => lower.includes(kw))) return 'co-op';
  if (['extern', 'externship'].some(kw => lower.includes(kw)))   return 'externship';
  return 'internship';
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Location normalization
// Both GitHub and Greenhouse send inconsistent location strings, so I normalize everything
// into "City, ST" for US or "City, Country" for international before saving to the DB.
// This is what makes the location filter actually work.

// Used to convert full state names like "California" into codes like "CA"
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

// Capitalizes the first letter of each word
function titleCase(s: string): string {
  return s.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '').join(' ');
}

// Handles a single location chunk from a GitHub README.
// GitHub repos use "us->state" or "country->city" format which I convert to clean strings.
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

  // Other country->city format (e.g. canada->toronto, uk->london) — I just extract the country
  const arrowMatch = p.match(/^([a-z][a-z_\s]*)->.*/i);
  if (arrowMatch) return titleCase(arrowMatch[1].replace(/_/g, ' ').trim());

  // Plain lowercase country name or underscore-separated (e.g. "india", "united_kingdom")
  if (/^[a-z][a-z_\s]*$/i.test(p) && !p.includes(',')) return titleCase(p.replace(/_/g, ' '));

  // Already clean (e.g. "San Francisco, CA" or "London, England")
  return p;
}

// Entry point for GitHub locations.
// Some repos use multi-location HTML cells like <details><summary>3 locations</summary>...<br>...</details>
// I strip the tags, split on <br>, normalize each part, and join them with " / ".
function normalizeLocation(raw: string): string | null {
  if (!raw) return null;
  const detagged = raw
    .replace(/<summary>[\s\S]*?<\/summary>/gi, '')   // drop the "N locations" label
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

// Quick lookup to check if a 2-letter code is a real US state
const US_STATE_CODE_SET = new Set([...Object.values(STATE_CODES), 'DC']);

// Some Greenhouse boards prefix locations with a 2-letter country code like "ES-Barcelona" or "NL-Hub".
// I use this to map those prefixes to readable country names.
const COUNTRY_CODE_PREFIXES: Record<string, string> = {
  NL: 'Netherlands', ES: 'Spain', DE: 'Germany', FR: 'France',
  GB: 'United Kingdom', IT: 'Italy', SE: 'Sweden', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', BE: 'Belgium', CH: 'Switzerland',
  AT: 'Austria', PT: 'Portugal', PL: 'Poland', CZ: 'Czech Republic',
  TR: 'Turkey', AE: 'UAE', SG: 'Singapore', JP: 'Japan', CN: 'China',
  AU: 'Australia', NZ: 'New Zealand', BR: 'Brazil', MX: 'Mexico',
  AR: 'Argentina', CO: 'Colombia', CL: 'Chile', ZA: 'South Africa',
};

// Greenhouse sometimes sends just a city name without a state.
// I use this map to fill in the state so it groups correctly in the filter.
const KNOWN_US_CITIES: Record<string, string> = {
  'sf': 'San Francisco, CA',         'san francisco': 'San Francisco, CA',
  'nyc': 'New York, NY',             'new york': 'New York, NY',
  'new york city': 'New York, NY',   'los angeles': 'Los Angeles, CA',
  'chicago': 'Chicago, IL',          'boston': 'Boston, MA',
  'austin': 'Austin, TX',            'denver': 'Denver, CO',
  'atlanta': 'Atlanta, GA',          'miami': 'Miami, FL',
  'dallas': 'Dallas, TX',            'houston': 'Houston, TX',
  'dc': 'Washington, DC',            'washington dc': 'Washington, DC',
  'phoenix': 'Phoenix, AZ',          'portland': 'Portland, OR',
  'san diego': 'San Diego, CA',      'san jose': 'San Jose, CA',
  'palo alto': 'Palo Alto, CA',      'mountain view': 'Mountain View, CA',
  'sunnyvale': 'Sunnyvale, CA',      'menlo park': 'Menlo Park, CA',
  'redwood city': 'Redwood City, CA','bellevue': 'Bellevue, WA',
  'cambridge': 'Cambridge, MA',      'seattle': 'Seattle, WA',
  'minneapolis': 'Minneapolis, MN',  'philadelphia': 'Philadelphia, PA',
  'pittsburgh': 'Pittsburgh, PA',    'raleigh': 'Raleigh, NC',
  'charlotte': 'Charlotte, NC',      'nashville': 'Nashville, TN',
  'salt lake city': 'Salt Lake City, UT', 'las vegas': 'Las Vegas, NV',
};

// Same idea for international cities — "Paris" alone becomes "Paris, France"
// so it groups under France in the filter instead of appearing as its own entry
const KNOWN_INTL_CITIES: Record<string, string> = {
  'paris': 'Paris, France',             'london': 'London, England',
  'berlin': 'Berlin, Germany',          'amsterdam': 'Amsterdam, Netherlands',
  'madrid': 'Madrid, Spain',            'barcelona': 'Barcelona, Spain',
  'rome': 'Rome, Italy',                'milan': 'Milan, Italy',
  'zurich': 'Zurich, Switzerland',      'stockholm': 'Stockholm, Sweden',
  'oslo': 'Oslo, Norway',               'copenhagen': 'Copenhagen, Denmark',
  'helsinki': 'Helsinki, Finland',      'brussels': 'Brussels, Belgium',
  'vienna': 'Vienna, Austria',          'prague': 'Prague, Czech Republic',
  'warsaw': 'Warsaw, Poland',           'lisbon': 'Lisbon, Portugal',
  'toronto': 'Toronto, Canada',         'vancouver': 'Vancouver, Canada',
  'montreal': 'Montreal, Canada',       'ottawa': 'Ottawa, Canada',
  'sydney': 'Sydney, Australia',        'melbourne': 'Melbourne, Australia',
  'tokyo': 'Tokyo, Japan',              'osaka': 'Osaka, Japan',
  'singapore': 'Singapore',             'hong kong': 'Hong Kong',
  'dubai': 'Dubai, UAE',                'tel aviv': 'Tel Aviv, Israel',
  'bangalore': 'Bangalore, India',      'mumbai': 'Mumbai, India',
  'delhi': 'Delhi, India',              'hyderabad': 'Hyderabad, India',
  'beijing': 'Beijing, China',          'shanghai': 'Shanghai, China',
  'seoul': 'Seoul, South Korea',        'taipei': 'Taipei, Taiwan',
  'mexico city': 'Mexico City, Mexico', 'bogota': 'Bogotá, Colombia',
  'buenos aires': 'Buenos Aires, Argentina', 'sao paulo': 'São Paulo, Brazil',
  'cape town': 'Cape Town, South Africa', 'nairobi': 'Nairobi, Kenya',
};

// Greenhouse location strings are all over the place — companies enter whatever they want.
// This function handles every weird format I've seen and turns it into a clean
// "City, ST" (US) or "City, Country" (international) string.
function normalizeGreenhouseLocation(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // "In-Office" isn't a real location, so I drop it
  if (/^in[-\s]?office$/i.test(s)) return null;

  // Various ways companies write "United States"
  if (/^(usa|u\.s\.a\.|united states of america)$/i.test(s)) return 'United States';

  // 3-letter ISO country codes like "CAN", "GBR", "DEU"
  const ISO3: Record<string, string> = {
    USA: 'United States', CAN: 'Canada',  GBR: 'United Kingdom', DEU: 'Germany',
    FRA: 'France',        AUS: 'Australia', IND: 'India',         CHN: 'China',
    JPN: 'Japan',         KOR: 'South Korea', SGP: 'Singapore',   NLD: 'Netherlands',
    ESP: 'Spain',         ITA: 'Italy',    BRA: 'Brazil',         MEX: 'Mexico',
    ARG: 'Argentina',     COL: 'Colombia', CHL: 'Chile',          ZAF: 'South Africa',
    NZL: 'New Zealand',   SWE: 'Sweden',   NOR: 'Norway',         DNK: 'Denmark',
    FIN: 'Finland',       BEL: 'Belgium',  CHE: 'Switzerland',    AUT: 'Austria',
    PRT: 'Portugal',      POL: 'Poland',   CZE: 'Czech Republic', TUR: 'Turkey',
    ISR: 'Israel',        ARE: 'UAE',      TWN: 'Taiwan',         HKG: 'Hong Kong',
    THA: 'Thailand',      IDN: 'Indonesia', MYS: 'Malaysia',      PHL: 'Philippines',
    VNM: 'Vietnam',       UKR: 'Ukraine',  EGY: 'Egypt',          NGA: 'Nigeria',
    KEN: 'Kenya',         GHA: 'Ghana',    IRE: 'Ireland',        IRL: 'Ireland',
  };
  if (/^[A-Z]{3}$/.test(s) && ISO3[s]) return ISO3[s];

  if (/^remote$/i.test(s)) return 'Remote';
  // Regional "remote" labels like "APAC - Remote" or "EMEA - Remote"
  if (/^(apac|emea|americas|latam|global)\s*[-–]\s*remote$/i.test(s)) return 'Remote';

  // Some companies list multiple locations separated by semicolons — I normalize each one
  if (s.includes(';')) {
    const parts = s.split(';')
      .map(p => normalizeGreenhouseLocation(p.trim()))
      .filter((p): p is string => p !== null && p !== '');
    const unique = [...new Set(parts)];
    return unique.length > 0 ? unique.join(' / ') : null;
  }

  // Anything that contains "remote" anywhere (e.g. "Colombia, Remote") → just Remote
  if (/\bremote\b/i.test(s)) return 'Remote';

  // "US > State > City" format  e.g. "US > Arizona > Phoenix"
  const usArrow = s.match(/^us\s*>\s*([^>]+?)\s*>\s*([^>]+)$/i);
  if (usArrow) {
    const code = STATE_CODES[usArrow[1].trim().toLowerCase()];
    const city = titleCase(usArrow[2].replace(/\(.*?\)/g, '').trim());
    return code ? `${city}, ${code}` : `${city}, US`;
  }

  // "Country > City" or any other arrow format — I just extract the country
  if (s.includes('>')) {
    return titleCase(s.split('>')[0].replace(/[()]/g, '').trim()) || null;
  }

  // "XX-CityOrLabel" — either a US state prefix or a country code prefix
  // e.g. "ES-Barcelona" → Spain, "NL-Hub" → Netherlands, "CA-Toronto" → Toronto, CA (California)
  const prefixM = s.match(/^([A-Z]{2})-(.+)$/);
  if (prefixM) {
    const code = prefixM[1];
    if (US_STATE_CODE_SET.has(code)) return `${titleCase(prefixM[2].replace(/-/g, ' ').trim())}, ${code}`;
    if (COUNTRY_CODE_PREFIXES[code]) return COUNTRY_CODE_PREFIXES[code];
  }

  // "City, ST United States" with a missing comma before the country
  // e.g. "San Mateo, CA United States" → "San Mateo, CA"
  const missingComma = s.match(/^(.+,\s*[A-Z]{2})\s+United States$/i);
  if (missingComma) return missingComma[1].trim();

  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // Strip trailing "United States" or "US" — some companies append it redundantly
    const trimmed = /^(united states|us)$/i.test(parts[parts.length - 1])
      ? parts.slice(0, -1)
      : parts;

    if (trimmed.length >= 2) {
      const last = trimmed[trimmed.length - 1];
      // "City, Full State Name" e.g. "South San Francisco, California" → "South San Francisco, CA"
      const stateCode = STATE_CODES[last.toLowerCase()];
      if (stateCode) return `${trimmed[0]}, ${stateCode}`;
      // International "City, Country" — keep as-is
      return `${trimmed[0]}, ${last}`;
    }
    return trimmed[0];
  }

  // Single word or short phrase — check my known city lookup tables
  const lower = s.toLowerCase();
  const knownUs = KNOWN_US_CITIES[lower];
  if (knownUs !== undefined) return knownUs || null;
  const knownIntl = KNOWN_INTL_CITIES[lower];
  if (knownIntl !== undefined) return knownIntl;

  return s;
}

// Greenhouse

// The list of companies I pull from Greenhouse's public job board API.
// Checked 2026-10-04: every slug here is a live board. 41 others returned 404 (moved
// off Greenhouse or renamed) and were removed — incl. ey, snowflake, notion, ramp,
// plaid, retool, rippling, deel, doordash, unity, zendesk, confluent, hashicorp,
// grammarly, miro, sentinelone, benchling, amplitude, clickup, segment. Many moved to
// Ashby/Lever (see the "more data sources" TODO). Duplicates fever/feverup and
// rocketlab/rocketlabusa resolved to the live one; internshiplist (an aggregator) is gone.
const GREENHOUSE_COMPANIES = [
  'cloudflare', 'didi', 'thesocialhub', 'ses', 'roku', 'celonis',
  'revolutionmedicines', 'asm', 'astranis', 'xometry', 'rocketlab', 'inter',
  'neuralink', 'agoda', 'feverup', 'hasbro', 'appier', 'dept', 'sezzle',
  'hunterdouglas', 'mirakl', 'bybit', 'casetify', 'sanmar', 'pacvue',
  'stripe', 'figma', 'discord', 'lyft', 'pinterest', 'mongodb', 'brex',
  'airtable', 'gusto', 'scaleai', 'mercury', 'webflow', 'intercom', 'lattice',
  'airbnb', 'instacart', 'robinhood', 'coinbase', 'databricks', 'duolingo',
  'squarespace', 'asana', 'twilio', 'hubspot', 'datadog', 'elastic', 'mixpanel',
  'dropbox', 'okta', 'gitlab', 'mozilla', 'pendo', 'brainstation', 'workato',
  'toast', 'ripple', 'block', 'point72', 'virtu', 'verkada',
];

// Board names cleanCompanyName can't fix ("Inter Carreiras" = "Inter Careers").
const COMPANY_NAME_OVERRIDES: Record<string, string> = {
  inter:   'Inter',
  hubspot: 'HubSpot',
  intercom: 'Intercom',   // board is branded "Fin", its AI product
};

// The company's real display name from its Greenhouse board ("scaleai" -> "Scale AI"),
// falling back to the capitalized slug if the lookup fails.
async function fetchCompanyName(slug: string): Promise<string> {
  if (COMPANY_NAME_OVERRIDES[slug]) return COMPANY_NAME_OVERRIDES[slug];
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}`,
      { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const name = cleanCompanyName(String((await res.json())?.name ?? ''));
      if (name) return name;
    }
  } catch { /* fall through to the slug */ }
  return capitalize(slug);
}

// Fetches internship listings from a company's Greenhouse job board and normalizes the data
async function fetchGreenhouse(company: string): Promise<Listing[]> {
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${company}/jobs`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json();
    // deno-lint-ignore no-explicit-any
    const interns = (data.jobs ?? []).filter((j: any) => isInternship(j.title));
    if (interns.length === 0) return [];
    // Only look up the name for boards that actually have internships (saves requests).
    const companyName = await fetchCompanyName(company);
    return interns
      // deno-lint-ignore no-explicit-any
      .map((j: any): Listing => ({
        title:      j.title,
        company:    companyName,
        location:   normalizeGreenhouseLocation(j.location?.name ?? null),
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

// GitHub

// Community-maintained repos that track active internship listings.
// SimplifyJobs uses an HTML table format; vanshb03 uses the older markdown pipe table format.
const GITHUB_REPOS = [
  { owner: 'SimplifyJobs', repo: 'Summer2026-Internships' },
  { owner: 'vanshb03',     repo: 'Summer2027-Internships' },
];

// Parses the HTML <table> format that SimplifyJobs switched to.
// Rows with "↳" in the company column are sub-roles — I carry the last company name forward.
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
    const dateCol = cols[4]; // SimplifyJobs: Company | Role | Location | Link | Date Posted

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
      posted_at: parseGithubAge(dateCol), updated_at: new Date().toISOString(),
    });
  }
  return jobs;
}

// Parses the older markdown pipe-table format that some repos still use
function parsePipeTable(content: string): Listing[] {
  const lines = content.split('\n');
  const jobs: Listing[] = [];
  let rowsInTable = 0;
  let lastCompany = '';

  for (const line of lines) {
    if (!line.trim().startsWith('|')) { rowsInTable = 0; continue; }
    rowsInTable++;
    if (rowsInTable <= 2) continue; // skip header row and separator

    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 4) continue;

    const [companyRaw, roleRaw, locationRaw, linkCol] = cols;
    const dateCol = cols[4]; // trailing Date-Posted/Age column, when present

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
      posted_at: parseGithubAge(dateCol), updated_at: new Date().toISOString(),
    });
  }
  return jobs;
}

// Converts the relative "age" value from a GitHub README's Date-Posted column
// (e.g. "4d", "2mo", "1y", "12h", or an absolute "Jul 15") into an absolute
// YYYY-MM-DD date. Because this function reruns daily and the age grows in
// lockstep with the calendar, today-minus-age yields a STABLE posted date across
// runs (posted 10d ago stays the same absolute date tomorrow). Returns null when
// the value is missing or unparseable, so posted_at simply stays null (no regression).
function parseGithubAge(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/<[^>]+>/g, '').trim();
  if (!s) return null;

  const toDate = (d: Date) => d.toISOString().split('T')[0];

  // Relative age like "3d", "2w", "5mo", "1y", "12h"
  const m = s.match(/^(\d+)\s*(h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)(?:\s+ago)?$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const d = new Date();
    if      (unit.startsWith('h'))  d.setHours(d.getHours() - n);
    else if (unit.startsWith('d'))  d.setDate(d.getDate() - n);
    else if (unit.startsWith('w'))  d.setDate(d.getDate() - n * 7);
    else if (unit.startsWith('mo')) d.setMonth(d.getMonth() - n);
    else if (unit.startsWith('y'))  d.setFullYear(d.getFullYear() - n);
    return toDate(d);
  }

  // Absolute date the repo may use instead (e.g. "Jul 15", "2026-07-15")
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return toDate(parsed);

  return null;
}

// Auto-detects which format the README uses and calls the right parser
function parseGithubReadme(content: string): Listing[] {
  return /<table[\s>]/i.test(content)
    ? parseHtmlTable(content)
    : parsePipeTable(content);
}

// Fetches the README from a GitHub repo, trying dev → main → master in order.
// Returns as soon as it finds a branch with actual listings.
//
// IMPORTANT: we deliberately send NO Authorization header. raw.githubusercontent.com
// is an unauthenticated CDN -- it is NOT the GitHub API and is not subject to the
// 60-req/hr limit, so a token buys nothing. Worse, an invalid/expired token makes
// raw.githubusercontent.com return 404 for every branch, which silently killed all
// GitHub ingestion (the catch swallows it) and left the DB Greenhouse-only.
async function fetchGithubRepo(owner: string, repo: string): Promise<Listing[]> {
  const headers: Record<string, string> = { 'User-Agent': 'SimplyIntern/1.0' };

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

// Main handler
// Invoked daily by the pg_cron job (migration 019) and manually on demand. It
// pulls fresh listings from Greenhouse and GitHub, deduplicates by URL, upserts
// everything to the DB, and cleans up anything not seen in the last 30 days.
//
// Locked with a shared secret: the function has to stay verify_jwt = false (the cron
// job calls it with the public key, not a user JWT), so without this check anyone
// with the public key could trigger a full ~70-board scrape whenever they liked.
// The cron job reads the same secret from Supabase Vault and sends it as a header.
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

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
  // Fetch all sources in parallel to keep the function fast
  const [ghResults, gitResults] = await Promise.all([
    Promise.all(GREENHOUSE_COMPANIES.map(fetchGreenhouse)),
    Promise.all(GITHUB_REPOS.map(({ owner, repo }) => fetchGithubRepo(owner, repo))),
  ]);

  const allJobs: Listing[] = [
    ...ghResults.flat(),
    ...gitResults.flat(),
  ];

  // Deduplicate by URL so the same listing from two sources doesn't appear twice
  const seen = new Set<string>();
  const unique = allJobs.filter(j => {
    if (seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });

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

  const summary = { total_found: unique.length, upserted, removed: removed ?? 0 };
  console.log('daily-refresh complete:', summary);

  return json(200, summary);
});
