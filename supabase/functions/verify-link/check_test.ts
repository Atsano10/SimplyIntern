// Unit tests for the no-network parts of check.ts.  Run: deno test supabase/functions/verify-link
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { formatProblem, isHomepage, isPrivateAddress, mapLimit } from './check.ts';

Deno.test('formatProblem accepts normal job links', () => {
  for (const u of [
    'https://job-boards.greenhouse.io/stripe/jobs/123',
    'http://jobs.lever.co/ramp/abc',
    'https://www.linkedin.com/jobs/view/4465207877/',
    'https://nvidia.wd5.myworkdayjobs.com/en-US/Site/job/X_JR1',
    'https://careers.example.com:443/jobs/1',
  ]) assertEquals(formatProblem(u), null, u);
});

Deno.test('formatProblem rejects non-web, private, and odd links', () => {
  for (const u of [
    'not a url',
    'javascript:alert(1)',
    'ftp://example.com/job',
    'file:///etc/passwd',
    'http://localhost/admin',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data',   // cloud metadata
    'http://10.0.0.5/jobs/1',
    'http://[::1]/',
    'http://intranet/jobs',
    'http://printer.local/jobs',
    'https://example.com:8080/jobs/1',
    'https://user:pass@example.com/jobs/1',
    'https://example.com/' + 'a'.repeat(2100),
  ]) assert(formatProblem(u) !== null, u);
});

Deno.test('isPrivateAddress', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
                    '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert(isPrivateAddress(ip), ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert(!isPrivateAddress(ip), ip);
  }
});

Deno.test('isHomepage', () => {
  assert(isHomepage('https://google.com'));
  assert(isHomepage('https://google.com/'));
  assert(!isHomepage('https://google.com/?jobId=1'));
  assert(!isHomepage('https://google.com/careers/1'));
});

Deno.test('mapLimit keeps order and caps concurrency', async () => {
  let inFlight = 0, peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3], 2, async n => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(r => setTimeout(r, n * 5));
    inFlight--;
    return n * 10;
  });
  assertEquals(out, [50, 10, 40, 20, 30]);
  assert(peak <= 2);
});
