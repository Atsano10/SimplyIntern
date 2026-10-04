// Run: deno test supabase/functions/daily-refresh
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { cleanCellText, cleanCompanyName, parseGithubAge, timingSafeEqual } from './helpers.ts';

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
