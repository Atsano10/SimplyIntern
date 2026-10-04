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
