// Small pure helpers for daily-refresh, kept out of index.ts so they can be unit
// tested (helpers_test.ts) without starting the server.

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
