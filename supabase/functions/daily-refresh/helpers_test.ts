// Run: deno test supabase/functions/daily-refresh
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { cleanCompanyName, timingSafeEqual } from './helpers.ts';

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
