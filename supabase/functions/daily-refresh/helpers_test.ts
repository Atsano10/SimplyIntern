// Run: deno test supabase/functions/daily-refresh
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  ashbyPay, cleanCellText, cleanCompanyName, cleanZapplyLocation, dedupeKey, formatPay, getType, greenhousePostedDate,
  isInternship, leverPay, type Listing, mapPipeColumns, parseGithubAge, prepareListings, programPay,
  stripTrackingParams, timingSafeEqual,
} from './helpers.ts';

Deno.test('cleanCompanyName strips suffixes, labels, and symbols', () => {
  const cases: [string, string][] = [
    ['Rocket Lab Corporation', 'Rocket Lab'],
    ['Gusto, Inc.', 'Gusto'],
    ['SanMar- External ', 'SanMar'],
    ['DEPT®', 'DEPT'],
    ['Point72 ', 'Point72'],
    ['Acme LLC', 'Acme'],
    ['Stripe', 'Stripe'],
    ['CASETiFY', 'CASETiFY'],
    ['Incredible Health', 'Incredible Health'],   // "Inc" inside a word stays
  ];
  for (const [raw, want] of cases) assertEquals(cleanCompanyName(raw), want, raw);
});

Deno.test('timingSafeEqual', () => {
  assert(timingSafeEqual('abc123', 'abc123'));
  assert(!timingSafeEqual('abc124', 'abc123'));
  assert(!timingSafeEqual('abc', 'abc123'));
  assert(!timingSafeEqual('', 'abc123'));
  assert(!timingSafeEqual('abc123x', 'abc123'));
});

Deno.test('cleanCellText strips status emoji and flags without leaving broken halves', () => {
  const us = 'Software Engineer Intern \u{1F1FA}\u{1F1F8}';
  assertEquals(cleanCellText(us), 'Software Engineer Intern');
  assertEquals(cleanCellText('Product Intern 🛂 🎓'), 'Product Intern');
  assertEquals(cleanCellText('🔥 Stripe'), 'Stripe');
  assertEquals(cleanCellText('Data Intern 🚀'), 'Data Intern 🚀');   // unrelated emoji kept whole
  assertEquals(cleanCellText('broken \uddfa\uddf8 half'), 'broken half');
  for (const s of [us, 'Product Intern 🛂', 'x 🔒 y']) {
    assert(!/\p{Cs}/u.test(cleanCellText(s)), 'no lone surrogates: ' + s);
  }
});

Deno.test('parseGithubAge: absolute dates get the right year', () => {
  const now = new Date(Date.UTC(2026, 9, 4));   // Oct 4, 2026
  assertEquals(parseGithubAge('Aug 21', now), '2026-08-21');      // was 2001-08-21
  assertEquals(parseGithubAge('Oct 4', now), '2026-10-04');
  assertEquals(parseGithubAge('Dec 15', now), '2025-12-15');      // future -> last year
  assertEquals(parseGithubAge('September 30, 2025', now), '2025-09-30');
  assertEquals(parseGithubAge('2026-07-15', now), '2026-07-15');
  assertEquals(parseGithubAge('Feb 31', now), null);
  assertEquals(parseGithubAge('Foo 3', now), null);
  assertEquals(parseGithubAge('', now), null);
  assertEquals(parseGithubAge(undefined, now), null);
});

Deno.test('parseGithubAge: relative ages', () => {
  const now = new Date(Date.UTC(2026, 9, 4, 12));
  assertEquals(parseGithubAge('3d', now), '2026-10-01');
  assertEquals(parseGithubAge('2w', now), '2026-09-20');
  assertEquals(parseGithubAge('1mo', now), '2026-09-04');
  assertEquals(parseGithubAge('13h', now), '2026-10-03');
  assertEquals(parseGithubAge('<span>5d</span>', now), '2026-09-29');
});

Deno.test('cleanZapplyLocation', () => {
  assertEquals(cleanZapplyLocation('El Segundo, California, United...'), 'El Segundo, California');
  assertEquals(cleanZapplyLocation('Mountain View, CA, USA'), 'Mountain View, CA');
  assertEquals(cleanZapplyLocation('US, Oregon, Hillsboro'), 'Hillsboro, Oregon');
  assertEquals(cleanZapplyLocation('Dallas, TX'), 'Dallas, TX');
});

Deno.test('dedupeKey matches the same posting across lists', () => {
  const a = 'https://bah.wd1.myworkdayjobs.com/bah_jobs/job/X_R1?utm_source=Simplify&ref=Simplify';
  const b = 'https://bah.wd1.myworkdayjobs.com/bah_jobs/job/X_R1/?utm_source=github-vansh-ouckah';
  const c = 'https://www.bah.wd1.myworkdayjobs.com/bah_jobs/job/X_R1';
  assertEquals(dedupeKey(a), dedupeKey(b));
  assertEquals(dedupeKey(a), dedupeKey(c));
  // real ids in the query are kept, so different jobs stay different
  assert(dedupeKey('https://stripe.com/jobs/search?gh_jid=1') !== dedupeKey('https://stripe.com/jobs/search?gh_jid=2'));
});

Deno.test('stripTrackingParams', () => {
  assertEquals(stripTrackingParams('https://masteringbackend.com?ref=30daysofcoding'), 'https://masteringbackend.com/');
  assertEquals(stripTrackingParams('https://x.com/a?id=5&utm_source=y'), 'https://x.com/a?id=5');
});

Deno.test('programPay labels money correctly per column', () => {
  assertEquals(programPay('Stipend', 'Yes'), 'Paid stipend');
  assertEquals(programPay('Stipend', 'No'), 'Unpaid');
  assertEquals(programPay('Stipend', 'Grants'), 'Grant');
  assertEquals(programPay('Rewards', 'Swag'), 'Unpaid');
  assertEquals(programPay('Rewards', 'Certificates, swag'), 'Unpaid');
  assertEquals(programPay('Rewards', 'Cash prizes'), 'Cash prizes');
  assertEquals(programPay('Rewards', 'PrizePool Worth of 20K (Including Swags)'), 'Cash prizes');
  assertEquals(programPay('Rewards', 'Stipend'), 'Paid stipend');
  assertEquals(programPay('Cost', 'Paid'), 'Tuition required');             // student pays, NOT a stipend
  assertEquals(programPay('Cost', 'Income Share Agreement'), 'Tuition: Income Share Agreement');
  assertEquals(programPay('Cost', 'Free (3 months)'), 'Unpaid (free program)');
});

Deno.test('mapPipeColumns reads each list\'s header', () => {
  assertEquals(mapPipeColumns(['Company', 'Role', 'Location', 'Application/Link', 'Date Posted']),
    { company: 0, role: 1, location: 2, link: 3, date: 4 });
  assertEquals(mapPipeColumns(['Company', 'Role', 'Location', 'Posted', 'Visa', '**Apply**']),
    { company: 0, role: 1, location: 2, link: 5, date: 3 });
  assertEquals(mapPipeColumns(['Name', 'Stipend', 'Timeline']), null);
});

Deno.test('greenhousePostedDate uses first_published, not the last edit', () => {
  // Real shape from the Robinhood board: posted in May 2025, edited last week.
  assertEquals(greenhousePostedDate({
    first_published: '2025-05-08T14:52:01-04:00', updated_at: '2026-10-02T18:48:15-04:00',
  }), '2025-05-08');
  assertEquals(greenhousePostedDate({ updated_at: '2026-10-02T18:48:15-04:00' }), '2026-10-02');
  assertEquals(greenhousePostedDate({ first_published: null, updated_at: null }), null);
  assertEquals(greenhousePostedDate({}), null);
});

Deno.test('isInternship: internship titles, including plurals, but not look-alikes', () => {
  for (const t of ['Software Engineer Intern', 'Research Internships', 'Summer Interns', 'Co-op (Winter 2027)',
                   'Engineering Coop', 'Spring Co-ops', 'Legal Externship', 'Summer Analyst'])
    assert(isInternship(t), t);
  for (const t of ['International Tax Manager', 'Internal Audit Lead', 'Software Engineer', 'Cooper Labs Engineer'])
    assert(!isInternship(t), t);
});

Deno.test('formatPay: short labels for each period', () => {
  assertEquals(formatPay(25, 33, 'USD', 'per-hour-wage'), '$25–$33/hr');
  assertEquals(formatPay(27.5, 27.5, 'USD', '1 HOUR'), '$27.5/hr');
  assertEquals(formatPay(12500, 12500, 'USD', '1 MONTH'), '$12,500/mo');
  assertEquals(formatPay(120000, 150000, 'USD', 'per-year-salary'), '$120K–$150K/yr');
  assertEquals(formatPay(40, null, 'CAD', 'per-hour-wage'), 'CA$40/hr');
  assertEquals(formatPay(null, 3000, 'EUR', '1 MONTH'), '€3,000/mo');
  assertEquals(formatPay(30, 40, 'INR', '1 HOUR'), 'INR 30–INR 40/hr');
  assertEquals(formatPay(null, null, 'USD', '1 HOUR'), null);   // no amount
  assertEquals(formatPay(5000, 5000, 'USD', 'NONE'), null);     // one-off, not a rate
});

Deno.test('leverPay and ashbyPay read each API\'s pay shape', () => {
  assertEquals(leverPay({ currency: 'USD', min: 25, max: 33, interval: 'per-hour-wage' }), '$25–$33/hr');
  assertEquals(leverPay(undefined), null);
  assertEquals(ashbyPay({ summaryComponents: [
    { compensationType: 'EquityPercentage', interval: 'NONE', minValue: 0.1, maxValue: 0.2 },
    { compensationType: 'Salary', interval: '1 MONTH', currencyCode: 'USD', minValue: 12500, maxValue: 12500 },
  ] }), '$12,500/mo');
  assertEquals(ashbyPay({ summaryComponents: [] }), null);
  assertEquals(ashbyPay(null), null);
});

Deno.test('getType: co-op and externship from the title, otherwise internship', () => {
  assertEquals(getType('Software Engineer Intern'), 'internship');
  assertEquals(getType('Engineering Co-op'), 'co-op');
  assertEquals(getType('Spring Coop'), 'co-op');
  assertEquals(getType('Legal Externship'), 'externship');
  assertEquals(getType('Summer Co-ops'), 'co-op');
  assertEquals(getType('Medical Extern'), 'externship');
  // Whole words only:
  assertEquals(getType('External Comms Intern'), 'internship');
  assertEquals(getType('Cooper Labs Intern'), 'internship');
  assertEquals(getType('Cooperative Research Intern'), 'internship');
});

Deno.test('prepareListings: first copy of each posting wins, emoji halves removed, timestamp set', () => {
  const row = (url: string, source: string, title = 'Intern'): Listing =>
    ({ title, company: 'Co', location: null, pay: null, type: 'internship', url, source, posted_at: null });
  const out = prepareListings([
    row('https://boards.greenhouse.io/x/jobs/1', 'greenhouse'),
    row('https://www.boards.greenhouse.io/x/jobs/1/?utm_source=Simplify', 'github'),   // same posting
    row('https://jobs.lever.co/y/2', 'lever', 'Intern \uD83D'),                         // lone surrogate
  ], '2026-10-06T00:00:00.000Z');
  assertEquals(out.map(r => r.source), ['greenhouse', 'lever']);
  assertEquals(out[1].title, 'Intern ');
  assertEquals(out.every(r => r.updated_at === '2026-10-06T00:00:00.000Z'), true);
  assertEquals(out[0].location, null);
});
