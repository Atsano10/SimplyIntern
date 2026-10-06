// Pure link-checking logic for the verify-link function. No Supabase imports here so
// it can be unit-tested on its own (check_test.ts).
//
// Verdicts:
//   ok           the job posting loaded
//   unverifiable the site blocks automated checks (Indeed, Handshake login, rate limits)
//                — we can't prove it either way, so it's allowed
//   dead         page not found / removed / the website doesn't exist — save is blocked
//   invalid      not a usable job link (bad format, homepage, private address)

export type Verdict = 'ok' | 'unverifiable' | 'dead' | 'invalid';
export interface CheckResult { status: Verdict; reason: string; http_status?: number }

const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS    = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; SimplyInternLinkCheck/1.0; +https://simply-intern.vercel.app)';

const REASONS = {
  ok:           'Link verified.',
  unverifiable: "This site blocks automatic checks, so we couldn't confirm it — it's allowed.",
  notFound:     "That job posting doesn't exist (page not found). Double-check the link.",
  removed:      'That job posting has been removed or closed.',
  noSite:       "That website doesn't exist. Double-check the link.",
};

// ── Format checks (no network) ───────────────────────────────────────────────

const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,   // carrier-grade NAT
];

export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return PRIVATE_V4.some(re => re.test(v));
  // IPv6: loopback, unspecified, unique-local (fc/fd), link-local (fe80), v4-mapped
  if (v === '::1' || v === '::') return true;
  if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v)) return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

// Returns an error message if the URL can't be a public job link, else null.
// Also used on every redirect hop, so a public URL can't bounce us to an internal one.
export function formatProblem(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return 'That doesn’t look like a web address. Paste the full link, starting with https://'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Links must start with http:// or https://';
  if (raw.length > 2048) return 'That link is too long.';
  if (u.username || u.password) return 'Links with a username or password aren’t allowed.';
  if (u.port && u.port !== '80' && u.port !== '443') return 'Use the normal job posting link (no custom port).';
  const host = u.hostname.toLowerCase();
  // Job postings never live on raw IP addresses or local network names. Blocking these
  // stops the checker from being pointed at internal services (SSRF).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) return 'Use the job posting’s web address, not an IP address.';
  if (!host.includes('.') || /\.(local|internal|localhost|lan|home|corp)$/.test(host) || host === 'localhost') {
    return 'That isn’t a public website.';
  }
  return null;
}

// Separate from formatProblem because redirects to a homepage are a "removed" signal,
// not a user error.
export function isHomepage(raw: string): boolean {
  const u = new URL(raw);
  return (u.pathname === '/' || u.pathname === '') && !u.search;
}

// ── Network ──────────────────────────────────────────────────────────────────

// Resolves the host and rejects private addresses — catches public hostnames that point
// inside a network (DNS rebinding). Skipped quietly if the runtime has no DNS API.
async function resolvesPrivate(host: string): Promise<boolean> {
  const resolve = (Deno as { resolveDns?: typeof Deno.resolveDns }).resolveDns;
  if (typeof resolve !== 'function') return false;
  for (const type of ['A', 'AAAA'] as const) {
    try {
      const addrs = await resolve(host, type);
      if (addrs.some(isPrivateAddress)) return true;
    } catch { /* no records of this type, or lookup failed — fetch will report it */ }
  }
  return false;
}

type FetchOutcome =
  | { kind: 'response'; status: number; hops: string[] }   // hops[0] = start, last = final
  | { kind: 'blocked'; reason: string }
  | { kind: 'no-site' }
  | { kind: 'error' };

// GET with redirects followed by hand (max 5), re-validating each hop. The body is
// never read — only the status matters.
async function safeFetch(start: string, headers: Record<string, string> = {}): Promise<FetchOutcome> {
  let url = start;
  const hops = [start];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = formatProblem(url);
    if (problem) return { kind: 'blocked', reason: problem };
    if (await resolvesPrivate(new URL(url).hostname)) return { kind: 'blocked', reason: 'That isn’t a public website.' };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8', ...headers },
      });
    } catch (err) {
      // Deno wraps the real cause ("dns error: failed to lookup address") in err.cause.
      const msg = `${(err as Error)?.message} ${(err as { cause?: unknown })?.cause}`.toLowerCase();
      if (/dns|lookup|name or service not known|no address|nodename|failed to resolve/.test(msg)) return { kind: 'no-site' };
      return { kind: 'error' };   // timeout, TLS, reset — could be temporary
    }
    await res.body?.cancel().catch(() => {});

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).toString();
      hops.push(url);
      continue;
    }
    return { kind: 'response', status: res.status, hops };
  }
  return { kind: 'error' };   // redirect loop
}

function fromStatus(status: number): CheckResult {
  if (status >= 200 && status < 300) return { status: 'ok', reason: REASONS.ok, http_status: status };
  if (status === 404 || status === 410) return { status: 'dead', reason: REASONS.notFound, http_status: status };
  return { status: 'unverifiable', reason: REASONS.unverifiable, http_status: status };
}

// ── Site-specific checks ─────────────────────────────────────────────────────
// Some job sites are JavaScript apps that answer "200 OK" even for fake jobs, or block
// plain page loads. These use the site's own public job API for a real yes/no.
// Each returns null when the URL isn't that site's job-link shape (generic check runs).

// linkedin.com/jobs/view/123 → the public guest API answers 404 for jobs that don't exist.
async function checkLinkedIn(u: URL): Promise<CheckResult | null> {
  if (!/(^|\.)linkedin\.com$/.test(u.hostname)) return null;
  const id = u.pathname.match(/^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/)?.[1]
          ?? u.searchParams.get('currentJobId')?.match(/^\d+$/)?.[0];
  if (!id) return null;
  return fromOutcome(await safeFetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`));
}

// {tenant}.wdN.myworkdayjobs.com/[en-US/]{site}/job/... → Workday's CXS JSON API.
async function checkWorkday(u: URL): Promise<CheckResult | null> {
  if (!/\.myworkdayjobs\.com$/.test(u.hostname)) return null;
  const tenant = u.hostname.split('.')[0];
  const parts = u.pathname.split('/').filter(Boolean);
  if (/^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || '')) parts.shift();   // optional locale
  const [site, kind, ...rest] = parts;
  if (!site || kind !== 'job' || rest.length === 0) return null;
  const api = `https://${u.hostname}/wday/cxs/${tenant}/${site}/job/${rest.join('/')}`;
  return fromOutcome(await safeFetch(api, { Accept: 'application/json' }));
}

// jobs.ashbyhq.com/{org}/{uuid} → the org's public posting API must list that job id.
async function checkAshby(u: URL): Promise<CheckResult | null> {
  if (u.hostname !== 'jobs.ashbyhq.com') return null;
  const [org, jobId] = u.pathname.split('/').filter(Boolean);
  if (!org || !jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  try {
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) { await res.body?.cancel(); return fromStatus(res.status); }   // 404: no such board
    const board = await res.json() as { jobs?: { id: string }[] };
    return (board.jobs || []).some(j => j.id.toLowerCase() === jobId.toLowerCase())
      ? { status: 'ok', reason: REASONS.ok, http_status: 200 }
      : { status: 'dead', reason: REASONS.removed, http_status: 404 };
  } catch {
    return { status: 'unverifiable', reason: REASONS.unverifiable };
  }
}

function fromOutcome(out: FetchOutcome): CheckResult {
  switch (out.kind) {
    case 'blocked':  return { status: 'invalid', reason: out.reason };
    case 'no-site':  return { status: 'dead', reason: REASONS.noSite };
    case 'error':    return { status: 'unverifiable', reason: REASONS.unverifiable };
    case 'response': return fromStatus(out.status);
  }
}

// Sites where every job page sits behind a login, so a fetch can't tell real from fake.
const LOGIN_WALLED = /(^|\.)(joinhandshake\.com)$/;

// Checks one URL that already passed formatProblem() and isn't a homepage.
export async function checkLink(raw: string): Promise<CheckResult> {
  const u = new URL(raw);
  if (LOGIN_WALLED.test(u.hostname)) return { status: 'unverifiable', reason: REASONS.unverifiable };
  for (const special of [checkLinkedIn, checkWorkday, checkAshby]) {
    const result = await special(u);
    if (result) return result;
  }

  const out = await safeFetch(raw);
  if (out.kind !== 'response') return fromOutcome(out);

  // A redirect chain can say more than the final page does, so look at every hop.
  const redirects = out.hops.slice(1).map(h => new URL(h));
  // Login walls (Handshake) send real AND fake job links to a login page, so landing
  // on one tells us nothing either way.
  if (redirects.some(h => /(^|\/)(login|log-in|signin|sign-in|sign_in|auth|sso)(\/|$)/i.test(h.pathname))) {
    return { status: 'unverifiable', reason: REASONS.unverifiable, http_status: out.status };
  }
  // Removed postings: Greenhouse bounces closed jobs to ?error=true (and from there on
  // to the company's careers page); many sites send them to their homepage.
  if (out.status >= 200 && out.status < 300 && redirects.length &&
      (redirects.some(h => h.searchParams.get('error') === 'true') || isHomepage(out.hops.at(-1)!))) {
    return { status: 'dead', reason: REASONS.removed, http_status: out.status };
  }
  return fromStatus(out.status);
}

// Runs fn over items with at most `limit` in flight, keeping input order.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
