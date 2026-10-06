// Small pure helpers for daily-refresh, kept out of index.ts so they can be unit
// tested (helpers_test.ts) without starting the server.

// A job listing as the sources produce it. updated_at is added when it's saved.
export interface Listing {
  title:     string;
  company:   string;
  location:  string | null;
  pay:       string | null;
  type:      string;
  url:       string;
  source:    string;
  posted_at: string | null;
}

// Whether a listing is an internship, co-op, or externship, from its title.
// Whole words only, like isInternship: "External Comms Intern" isn't an externship,
// and "Cooper Labs Intern" isn't a co-op.
export function getType(title: string): string {
  if (/\b(co-?ops?|co\s+op)\b/i.test(title)) return 'co-op';
  if (/\b(externs?|externships?)\b/i.test(title)) return 'externship';
  return 'internship';
}

// Greenhouse board names are what the company typed into Greenhouse, so they come with
// legal suffixes and internal labels ("Rocket Lab Corporation", "Gusto, Inc.",
// "SanMar- External ", "DEPT®"). This trims them to the name people actually search for.
export function cleanCompanyName(raw: string): string {
  return raw
    .replace(/[®™©]/g, '')
    .replace(/\s*-\s*external\s*$/i, '')
    .replace(/,?\s+(inc\.?|llc|ltd\.?|corporation|corp\.?)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Compares a provided secret to the expected one in constant time, so response timing
// can't leak how many leading characters were right.
export function timingSafeEqual(provided: string, expected: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// GitHub internship lists decorate company/role cells with status emoji (🔥 hot,
// 🔒 closed, 🛂 no sponsorship, 🇺🇸 citizenship required, 🎓 degree...). This strips them.
// The `u` flag matters: without it JavaScript splits each emoji into two halves, and a
// character class like [🔒🎓] deletes the shared first half of EVERY emoji — leaving
// broken half-emoji (lone surrogates) that Postgres rejects as invalid text, failing
// the whole 500-row upsert batch. The last replace removes any such halves regardless.
export function cleanCellText(s: string): string {
  return s
    .replace(/[🔥🔒✅❌🛂🎓]/gu, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')   // flags are pairs of these letters
    .replace(/\p{Cs}/gu, '')                    // lone surrogates (broken emoji halves)
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Converts the relative "age" value from a GitHub README's Date-Posted column
// (e.g. "4d", "2mo", "1y", "12h", or an absolute "Jul 15") into an absolute
// YYYY-MM-DD date. Because this function reruns daily and the age grows in
// lockstep with the calendar, today-minus-age yields a STABLE posted date across
// runs (posted 10d ago stays the same absolute date tomorrow). Returns null when
// the value is missing or unparseable, so posted_at simply stays null (no regression).
export function parseGithubAge(raw: string | undefined, now: Date = new Date()): string | null {
  if (!raw) return null;
  const s = raw.replace(/<[^>]+>/g, '').trim();
  if (!s) return null;

  const toDate = (d: Date) => d.toISOString().split('T')[0];

  // Relative age like "3d", "2w", "5mo", "1y", "12h"
  const m = s.match(/^(\d+)\s*(h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)(?:\s+ago)?$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const d = new Date(now);
    if      (unit.startsWith('h'))  d.setUTCHours(d.getUTCHours() - n);
    else if (unit.startsWith('d'))  d.setUTCDate(d.getUTCDate() - n);
    else if (unit.startsWith('w'))  d.setUTCDate(d.getUTCDate() - n * 7);
    else if (unit.startsWith('mo')) d.setUTCMonth(d.getUTCMonth() - n);
    else if (unit.startsWith('y'))  d.setUTCFullYear(d.getUTCFullYear() - n);
    return toDate(d);
  }

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))) return s;

  // "Aug 21" / "August 21, 2026". Parsed by hand because `new Date("Aug 21")` with no
  // year gives 2001, which made those postings look 25 years old. With no year, use
  // the current one — or last year if that would put the date in the future (a
  // "Dec 15" posting seen in January).
  const md = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (md) {
    const month = MONTHS.indexOf(md[1].slice(0, 3).toLowerCase());
    const day = parseInt(md[2], 10);
    if (month < 0 || day < 1 || day > 31) return null;
    let year = md[3] ? parseInt(md[3], 10) : now.getUTCFullYear();
    let d = new Date(Date.UTC(year, month, day));
    if (!md[3] && d.getTime() > now.getTime() + 86_400_000) d = new Date(Date.UTC(--year, month, day));
    return d.getUTCMonth() === month ? toDate(d) : null;   // rejects "Feb 31"
  }

  return null;
}

// The date a Greenhouse job was first posted, as YYYY-MM-DD. Uses first_published, not
// updated_at: updated_at changes every time the company edits the posting, which made
// months-old jobs look brand new under "Newest" and "Last 7 days". The date is the
// company's local date, as written in the timestamp. updated_at is only a fallback in
// case first_published is ever missing.
export function greenhousePostedDate(
  job: { first_published?: string | null; updated_at?: string | null },
): string | null {
  const raw = job.first_published || job.updated_at;
  return raw ? raw.split('T')[0] : null;
}

// zapply's locations need a little help before normalizeGreenhouseLocation:
//   "El Segundo, California, United..."  (cut off)   -> "El Segundo, California"
//   "Mountain View, CA, USA"                          -> "Mountain View, CA"
//   "US, Oregon, Hillsboro"           (reversed)      -> "Hillsboro, Oregon"
export function cleanZapplyLocation(raw: string): string {
  let s = raw.trim().replace(/,\s*[^,]*(\.\.\.|…)$/, '');
  s = s.replace(/,\s*(USA|U\.S\.A\.?|US|U\.S\.)$/i, '');
  const reversed = s.match(/^(?:US|USA|United States),\s*([^,]+),\s*([^,]+)$/i);
  if (reversed) s = `${reversed[2]}, ${reversed[1]}`;
  return s.trim();
}

// Tracking params that differ between lists for the SAME posting (Simplify adds
// ?utm_source=Simplify&ref=Simplify, vanshb03 adds its own utm_source, ...).
const TRACKING_PARAM = /^(utm_.*|ref|referrer|source|src|gh_src|trk|refid|trackingid|lever-source|lever-origin|fbclid|gclid)$/i;

// Key used to spot the same posting across sources: host without www, path without a
// trailing slash, and the query minus tracking params. The stored URL is unchanged.
export function dedupeKey(url: string): string {
  try {
    const u = new URL(url);
    const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAM.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? '?' + new URLSearchParams(params).toString() : '';
    return u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + query;
  } catch {
    return url;
  }
}

// The rows to save: each posting once (matching ignores tracking params and
// www/trailing-slash differences, see dedupeKey; the first copy in `all` wins), with
// broken half-emoji removed and updated_at set to `now`.
// The emoji cleanup is a safety net: one lone surrogate anywhere makes Postgres reject
// the WHOLE 500-row batch.
export function prepareListings(all: Listing[], now: string): (Listing & { updated_at: string })[] {
  const seen = new Set<string>();
  const noHalves = (s: string) => s.replace(/\p{Cs}/gu, '');
  return all
    .filter(j => {
      const key = dedupeKey(j.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(j => ({
      ...j,
      title:      noHalves(j.title),
      company:    noHalves(j.company),
      location:   j.location == null ? null : noHalves(j.location),
      updated_at: now,
    }));
}

// Removes tracking/referral params from a URL we display (e.g. "?ref=30daysofcoding").
export function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

// Turns the open-source list's money column into the pay label shown on Search.
// The column is called Stipend, Rewards, or Cost depending on the table — and "Paid"
// means opposite things: a paid stipend vs. tuition the student pays (bootcamps).
export function programPay(column: string, value: string): string {
  const col = column.toLowerCase();
  const v = value.trim();
  if (col.includes('cost')) {
    if (/free/i.test(v)) return 'Unpaid (free program)';
    return /^paid$/i.test(v) ? 'Tuition required' : `Tuition: ${v}`;
  }
  if (/\b(yes|stipend|paid)\b/i.test(v)) return 'Paid stipend';
  if (/grant/i.test(v)) return 'Grant';
  if (/cash|prize\s*pool|[$₹€£]|\d+\s*k\b/i.test(v)) return 'Cash prizes';
  return 'Unpaid';
}

// Finds which column holds what in a markdown table from its header row, since each
// list orders them differently (zapply: Company | Role | Location | Posted | Visa | Apply).
// Returns null if this isn't a job table.
export interface PipeColumns { company: number; role: number; location: number; link: number; date: number }
export function mapPipeColumns(headerCells: string[]): PipeColumns | null {
  const names = headerCells.map(c => c.replace(/[*_`]/g, '').trim().toLowerCase());
  const find = (re: RegExp) => names.findIndex(n => re.test(n));
  const cols = {
    company:  find(/^(company|employer|organization)$/),
    role:     find(/^(role|position|title|job|job title)$/),
    location: find(/^(location|locations)$/),
    link:     find(/^(apply|application|link|links|application\/link|posting)$/),
    date:     find(/^(date posted|posted|age|date)$/),
  };
  return cols.company >= 0 && cols.role >= 0 && cols.link >= 0 ? cols : null;
}

// Runs fn over items with at most `limit` in flight, keeping input order.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// ── Internships ──────────────────────────────────────────────────────────────

// Titles that mean an internship-type role. Plurals count too ("Research Internships").
// "International" and "Internal" don't match: \b needs the word to end right there.
const INTERN_RE = /\b(interns?|internships?|co-?ops?|co\s+op|externships?|externs?|summer|winter)\b/i;

export const isInternship = (text: string) => INTERN_RE.test(text);

// ── Pay ──────────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', CAD: 'CA$', EUR: '€', GBP: '£', AUD: 'A$' };
const PAY_UNITS: Record<string, string> = { hour: 'hr', week: 'wk', month: 'mo', year: 'yr' };

// A pay range as a short label: "$25–$33/hr", "$12,500/mo", "$120K–$150K/yr".
// `interval` is any text naming the period ("per-hour-wage", "1 HOUR"); returns null
// when there's no amount or the period isn't one we know (e.g. a one-off bonus).
export function formatPay(min: number | null | undefined, max: number | null | undefined,
                          currency: string | null | undefined, interval: string | null | undefined): string | null {
  const unit = Object.keys(PAY_UNITS).find(u => (interval ?? '').toLowerCase().includes(u));
  const lo = min || max, hi = max || min;
  if (!unit || !lo || !hi) return null;
  const code = (currency || 'USD').toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  const amount = (n: number) =>
    unit === 'year' && n >= 1000 ? `${symbol}${Math.round(n / 1000)}K`
    : `${symbol}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `${amount(lo)}${hi !== lo ? '–' + amount(hi) : ''}/${PAY_UNITS[unit]}`;
}

// Lever's optional salaryRange: { currency, min, max, interval: "per-hour-wage" }.
export function leverPay(range?: { currency?: string; min?: number; max?: number; interval?: string } | null) {
  return range ? formatPay(range.min, range.max, range.currency, range.interval) : null;
}

// Ashby's compensation (with includeCompensation=true): the base pay part of
// summaryComponents, e.g. { compensationType: "Salary", interval: "1 MONTH", minValue }.
// Equity and bonuses are left out.
export function ashbyPay(comp?: {
  summaryComponents?: { compensationType?: string; interval?: string; currencyCode?: string;
                        minValue?: number | null; maxValue?: number | null }[];
} | null) {
  const base = comp?.summaryComponents?.find(c => c.compensationType === 'Salary');
  return base ? formatPay(base.minValue, base.maxValue, base.currencyCode, base.interval) : null;
}
