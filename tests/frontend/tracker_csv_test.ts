// Tests for the tracker's CSV/TSV import and export (js/tracker-csv.js).
// Run: deno test --allow-read tests
import { assertEquals } from 'jsr:@std/assert@1';
import { loadScripts, plain } from './load_scripts.ts';

const { parseImport, normalizeImportStatus, normalizeImportDate, applicationsToCsv } =
  loadScripts('js/util.js', 'js/tracker-csv.js');

const parse = (text: string) => plain(parseImport(text));

Deno.test('finds the header row and maps aliased column names in any order', () => {
  const r = parse('Employer,Job Title,Stage,Link\nStripe,SWE Intern,rejected,https://stripe.com/jobs/1\n');
  assertEquals(r.headerDetected, true);
  assertEquals(r.skipped, 0);
  assertEquals(r.entries.length, 1);
  const e = r.entries[0];
  assertEquals([e.position, e.company, e.status, e.url], ['SWE Intern', 'Stripe', 'Rejected', 'https://stripe.com/jobs/1']);
});

Deno.test('header names ignore case, punctuation, and extra spaces', () => {
  const r = parse('  POSITION: ,Company ,Date Applied ,Pay Rate\nIntern,Figma,2026-10-01,$40/hr\n');
  assertEquals(r.headerDetected, true);
  assertEquals(plain(r.entries[0]).pay, '$40/hr');
  assertEquals(plain(r.entries[0]).date_applied, '2026-10-01');
});

Deno.test('quoted fields keep their commas and escaped quotes', () => {
  const r = parse('Position,Company,Notes\n"Intern, Data Science","Scale, Inc.","Said ""great fit"""\n');
  const e = r.entries[0];
  assertEquals([e.position, e.company, e.notes], ['Intern, Data Science', 'Scale, Inc.', 'Said "great fit"']);
});

Deno.test('a quoted field can span lines (notes with a line break)', () => {
  const r = parse('Position,Company,Notes\nIntern,Stripe,"line one\nline two"\nIntern,Figma,\n');
  assertEquals(r.entries.length, 2);
  assertEquals(r.entries[0].notes, 'line one\nline two');
});

Deno.test('tab-separated text (pasted from a spreadsheet) is detected', () => {
  const r = parse('Company\tRole\tLocation\nBrex\tIntern, Finance\tNew York, NY\n');
  assertEquals(r.entries.length, 1);
  const e = r.entries[0];
  assertEquals([e.company, e.position, e.location], ['Brex', 'Intern, Finance', 'New York, NY']);
});

Deno.test('Windows line endings (\\r\\n) leave no stray characters', () => {
  const r = parse('Position,Company,Status\r\nIntern,Lyft,Pending\r\nIntern,Roku,Offer\r\n');
  assertEquals(r.entries.map((e: { company: string; status: string }) => [e.company, e.status]),
    [['Lyft', 'Pending'], ['Roku', 'Accepted']]);
});

Deno.test('no header row: columns are read in the documented order', () => {
  const r = parse('SWE Intern,Datadog,Boston MA,$45,2026-09-30,interview,met at career fair,datadoghq.com/careers/1\n');
  assertEquals(r.headerDetected, false);
  const e = r.entries[0];
  assertEquals(e.position, 'SWE Intern');
  assertEquals(e.company, 'Datadog');
  assertEquals(e.status, '1st Round Interview');
  assertEquals(e.notes, 'met at career fair');
  assertEquals(e.url, 'https://datadoghq.com/careers/1');
});

Deno.test('title rows, blank rows, and an empty first column before the header', () => {
  const sheet = [
    'My Internship Tracker,,,',
    ',,,',
    ',Company,Position,Status',
    ',Okta,Security Intern,Applied',
    ',Toast,PM Intern,Rejected',
  ].join('\n');
  const r = parse(sheet);
  assertEquals(r.headerDetected, true);
  assertEquals(r.entries.map((e: { company: string }) => e.company), ['Okta', 'Toast']);
  assertEquals(r.skipped, 0);
});

Deno.test('rows missing a position or company are skipped and counted; empty rows are ignored', () => {
  const r = parse('Position,Company\nIntern,\n,Stripe\n,,\nIntern,Figma\n');
  assertEquals(r.entries.length, 1);
  assertEquals(r.skipped, 2);
});

Deno.test('empty or whitespace-only input imports nothing', () => {
  assertEquals(parse(''), { entries: [], skipped: 0, headerDetected: false });
  assertEquals(parse('  \n\n '), { entries: [], skipped: 0, headerDetected: false });
});

Deno.test('links: filler like N/A means no link; bare domains get https://', () => {
  const r = parse([
    'Position,Company,Link',
    'A,Co1,N/A',
    'B,Co2,-',
    'C,Co3,www.stripe.com/jobs/1',
    'D,Co4,https://boards.greenhouse.io/x/jobs/2',
  ].join('\n'));
  assertEquals(r.entries.map((e: { url: string }) => e.url),
    ['', '', 'https://www.stripe.com/jobs/1', 'https://boards.greenhouse.io/x/jobs/2']);
});

Deno.test('free-text statuses map onto the tracker statuses', () => {
  const cases: [string, string][] = [
    ['', 'Pending'], ['Applied', 'Pending'], ['submitted', 'Pending'], ['who knows', 'Pending'],
    ['rejected ', 'Rejected'], ['Declined', 'Rejected'], ['denied', 'Rejected'],
    ['Offer!', 'Accepted'], ['accepted', 'Accepted'], ['hired', 'Accepted'],
    ['Phone screen', '1st Round Interview'], ['technical interview', '1st Round Interview'],
    ['Interviewing', '1st Round Interview'],
    ['2nd round', '2nd Round Interview'], ['Final round', '2nd Round Interview'],
    ['onsite', '2nd Round Interview'], ['Superday', '2nd Round Interview'],
  ];
  for (const [raw, want] of cases) assertEquals(normalizeImportStatus(raw), want, `status "${raw}"`);
});

Deno.test('interview statuses set the reached_interview milestone', () => {
  const r = parse('Position,Company,Status\nA,Co1,phone screen\nB,Co2,applied\nC,Co3,rejected\n');
  assertEquals(r.entries.map((e: { reached_interview: boolean }) => e.reached_interview), [true, false, undefined]);
});

// Dates. `now` is fixed so the "no year" cases don't depend on when the test runs.
const NOW = new Date(2026, 9, 6, 12, 0);   // Oct 6 2026, noon local time
const date = (s: string) => normalizeImportDate(s, NOW);

Deno.test('dates: common spreadsheet formats', () => {
  const cases: [string, string][] = [
    ['2026-10-05', '2026-10-05'], ['2026-1-5', '2026-01-05'],
    ['10/05/2026', '2026-10-05'], ['10/5/2026', '2026-10-05'], ['10-5-2026', '2026-10-05'],
    ['10/5/26', '2026-10-05'],
    ['Oct 5, 2026', '2026-10-05'], ['October 5 2026', '2026-10-05'], ['5 Oct 2026', '2026-10-05'],
    ['10/5/2026 14:30', '2026-10-05'],
  ];
  for (const [raw, want] of cases) assertEquals(date(raw), want, `date "${raw}"`);
});

Deno.test('dates with no year use this year, or last year if that would be in the future', () => {
  // Bug this guards: new Date("Oct 5") alone gives 2001.
  assertEquals(date('Oct 5'), '2026-10-05');
  assertEquals(date('10/5'), '2026-10-05');
  assertEquals(date('Oct 6'), '2026-10-06');   // today
  assertEquals(date('Dec 15'), '2025-12-15');  // would be in the future
  assertEquals(date('12/15'), '2025-12-15');
});

Deno.test('dates that do not exist, or are not dates, come back empty', () => {
  for (const raw of ['', '  ', 'N/A', 'last week', '2026-02-30', '2/30/2026', '13/1/2026', '2026-13-01'])
    assertEquals(date(raw), '', `date "${raw}"`);
});

// Bug this guards: toISOString() moved every date a day earlier east of UTC. CI runs
// this file in several timezones (see .github/workflows/ci.yml); this test reports
// which one it ran in, so a failure says where.
Deno.test(`dates don't shift by a day in this timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, () => {
  for (const raw of ['10/5/2026', 'Oct 5, 2026', '2026-10-05', 'Oct 5'])
    assertEquals(date(raw), '2026-10-05', `date "${raw}"`);
});

// ── Export ───────────────────────────────────────────────────────────────────

const apps = [
  { position: 'SWE Intern', company: 'Stripe', location: 'Remote', pay: '$50/hr', date_applied: '2026-10-01',
    status: '1st Round Interview', notes: 'Recruiter: "Sam", call Tues', url: 'https://stripe.com/jobs/1', cycle: '2027 Summer' },
  { position: 'Intern, Data', company: 'Scale, Inc.', location: 'SF', pay: '', date_applied: '',
    status: 'Rejected', notes: 'line one\nline two', url: '', cycle: '2027 Summer' },
  { position: 'PM Intern', company: 'Figma', location: '', pay: '', date_applied: '2026-09-15',
    status: 'Accepted', notes: '=HYPERLINK("http://evil.example","click")', url: 'https://figma.com/j/2', cycle: '2027 Spring' },
];

Deno.test('export: header row uses names the import recognizes', () => {
  const header = applicationsToCsv([]).split('\r\n')[0];
  assertEquals(header, 'Position,Company,Location,Pay,Date Applied,Status,Notes,Link,Folder');
});

Deno.test('export: commas, quotes and line breaks are quoted correctly', () => {
  const csv = applicationsToCsv(apps);
  assertEquals(csv.includes('"Recruiter: ""Sam"", call Tues"'), true);
  assertEquals(csv.includes('"Intern, Data","Scale, Inc."'), true);
  assertEquals(csv.includes('"line one\nline two"'), true);
  assertEquals(csv.endsWith('\r\n'), true);
});

Deno.test('export: cells that a spreadsheet would run as a formula are made plain text', () => {
  const csv = applicationsToCsv([{ position: '=1+1', company: '+cmd', notes: '-2', pay: '@SUM(A1)', status: 'Pending' }]);
  const row = csv.split('\r\n')[1];
  assertEquals(row.startsWith("'=1+1,'+cmd,,'@SUM(A1),,Pending,'-2,"), true, row);
});

Deno.test('export then import gives back the same applications', () => {
  const back = parse(applicationsToCsv(apps));
  assertEquals(back.headerDetected, true);
  assertEquals(back.skipped, 0);
  const fields = ['position', 'company', 'location', 'pay', 'date_applied', 'status', 'notes', 'url'];
  const pick = (a: Record<string, string>) => Object.fromEntries(fields.map(f => [f, a[f] ?? '']));
  assertEquals(back.entries.map(pick), apps.map(pick));
});
