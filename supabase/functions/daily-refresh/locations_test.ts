// Run: deno test supabase/functions/daily-refresh
// Expected values are what the scraper produced before locations.ts was split out of
// index.ts (2026-10-06), so these lock in current behavior. One deliberate change since:
// plain city words in GitHub lists use the known-city table ("NYC" -> "New York, NY").
import { assertEquals } from 'jsr:@std/assert@1';
import { jobLocation, normalizeGreenhouseLocation, normalizeLocation } from './locations.ts';

Deno.test('normalizeGreenhouseLocation: the formats job boards send', () => {
  const cases: [string | null, string | null][] = [
    ['San Francisco, CA', 'San Francisco, CA'],
    ['US > Arizona > Phoenix', 'Phoenix, AZ'],
    ['South San Francisco, California', 'South San Francisco, CA'],
    ['San Mateo, CA United States', 'San Mateo, CA'],
    ['Boston, MA, United States', 'Boston, MA'],
    ['ES-Barcelona', 'Spain'],                 // country-code prefix
    ['CA-Toronto', 'Toronto, CA'],             // ...but CA is read as California
    ['London, United Kingdom', 'London, United Kingdom'],
    ['USA', 'United States'],
    ['DEU', 'Germany'],
    ['APAC - Remote', 'Remote'],
    ['Colombia, Remote', 'Remote'],
    ['New York; Remote', 'New York, NY / Remote'],
    ['Austin; Austin, TX', 'Austin, TX'],      // duplicates collapse
    ['Paris', 'Paris, France'],
    ['nyc', 'New York, NY'],
    ['In-Office', null],
    ['', null],
    [null, null],
  ];
  for (const [raw, want] of cases) assertEquals(normalizeGreenhouseLocation(raw), want, String(raw));
});

Deno.test('normalizeLocation: GitHub README cells', () => {
  const cases: [string, string | null][] = [
    ['us->new_york, ny', 'New York, NY'],
    ['us->washington dc', 'Washington, DC'],
    ['us->california', 'California, CA'],
    ['canada->toronto', 'Canada'],
    ['united_kingdom', 'United Kingdom'],
    ['Remote in USA', 'Remote'],
    ['San Francisco, CA', 'San Francisco, CA'],
    // Multi-location cell; known cities and abbreviations get their full form.
    ['<details><summary>3 locations</summary>NYC<br>Seattle, WA<br>Remote</details>', 'New York, NY / Seattle, WA / Remote'],
    ['SF', 'San Francisco, CA'],
    ['LA', 'Los Angeles, CA'],
    ['South SF', 'South San Francisco, CA'],
    ['London', 'London, England'],
    ['united_kingdom', 'United Kingdom'],   // not a known city: title-cased as before
    ['', null],
  ];
  for (const [raw, want] of cases) assertEquals(normalizeLocation(raw), want, raw);
});

Deno.test('jobLocation: every listed location, plus Remote for remote roles', () => {
  assertEquals(jobLocation(['Atlanta, GA', 'Los Angeles, CA'], false), 'Atlanta, GA / Los Angeles, CA');
  assertEquals(jobLocation(['Toronto, ON', undefined, '  '], true), 'Toronto, ON / Remote');
  assertEquals(jobLocation([], true), 'Remote');
  assertEquals(jobLocation([null], false), null);
});
