// verify-link: checks that job-posting links really exist, for the tracker.
//
// POST { urls: string[] }  (1–25, signed-in users only)
// → { results: [{ url, status, reason }] }  in the same order
//
// status is 'ok' | 'unverifiable' | 'dead' | 'invalid' (see check.ts). The browser
// blocks saving on 'dead'/'invalid', but that's only UX: the leaderboard trusts
// nothing from the browser. Verdicts are written to `verified_links` here with the
// service role, and the leaderboard only counts applications whose URL is in that
// table (migration 018).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { checkLink, formatProblem, isHomepage, mapLimit, type CheckResult } from './check.ts';

const MAX_URLS    = 25;
const CONCURRENCY = 6;
const HOMEPAGE_REASON = 'Paste the link to the specific job posting, not the company’s homepage.';

// CORS is not the security boundary here (a valid user session is), it just keeps
// other websites from using signed-in visitors' browsers to call this.
const ALLOWED_ORIGIN = /^(https:\/\/simply-intern(-[a-z0-9-]+)?\.vercel\.app|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN.test(origin) ? origin : 'https://simply-intern.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Signed-in users only, so this can't be used as an anonymous URL fetcher.
  // (verify_jwt is off in config.toml; the session is checked here instead, which works
  // with both legacy and new-style Supabase keys.)
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!user) return json(req, 401, { error: 'Sign in to verify links.' });

  let urls: unknown;
  try { ({ urls } = await req.json()); } catch { return json(req, 400, { error: 'Invalid JSON body.' }); }
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > MAX_URLS ||
      !urls.every(u => typeof u === 'string')) {
    return json(req, 400, { error: `Send 1–${MAX_URLS} links as { urls: [...] }.` });
  }
  const inputs = (urls as string[]).map(u => u.trim());

  // 1. Format problems need no network.
  const results: (CheckResult | null)[] = inputs.map(u => {
    const problem = formatProblem(u);
    if (problem) return { status: 'invalid', reason: problem };
    if (isHomepage(u)) return { status: 'invalid', reason: HOMEPAGE_REASON };
    return null;
  });

  // 2. Normalize in the DB (one source of truth), and find links we already know.
  const pending = inputs.map((u, i) => ({ u, i })).filter(({ i }) => results[i] === null);
  const normalized = new Map<number, string>();
  if (pending.length) {
    const { data: prep, error } = await admin.rpc('link_check_prepare', { p_urls: pending.map(p => p.u) });
    if (error || !prep) return json(req, 500, { error: 'Could not check links right now. Try again.' });

    const toFetch: { i: number; u: string }[] = [];
    (prep as { url_normalized: string | null; cached_status: string | null; in_listings: boolean }[])
      .forEach((row, k) => {
        const { u, i } = pending[k];
        if (!row.url_normalized) { results[i] = { status: 'invalid', reason: 'That doesn’t look like a job link.' }; return; }
        normalized.set(i, row.url_normalized);
        if (row.in_listings) results[i] = { status: 'ok', reason: 'Link verified.' };
        else if (row.cached_status === 'ok') results[i] = { status: 'ok', reason: 'Link verified.' };
        else toFetch.push({ i, u });   // never checked, dead before, or unverifiable before (retry)
      });

    // 3. Check the rest against the real websites.
    const checked = await mapLimit(toFetch, CONCURRENCY, ({ u }) => checkLink(u));
    toFetch.forEach(({ i }, k) => { results[i] = checked[k]; });
  }

  // 4. Record verdicts (the DB only ever upgrades a link: dead → unverifiable → ok).
  const rows = inputs.flatMap((_, i) => {
    const r = results[i]!;
    const n = normalized.get(i);
    return n && r.status !== 'invalid' ? [{ url_normalized: n, status: r.status, http_status: r.http_status ?? null }] : [];
  });
  if (rows.length) {
    const { error } = await admin.rpc('record_link_checks', { p_rows: rows });
    if (error) console.error('record_link_checks failed:', error.message);
  }

  return json(req, 200, {
    results: inputs.map((url, i) => ({ url, status: results[i]!.status, reason: results[i]!.reason })),
  });
});
