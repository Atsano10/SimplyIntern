// Tests for the shared helpers in js/util.js.
// Run: deno test --allow-read tests
import { assertEquals } from 'jsr:@std/assert@1';
import { constOf, loadScripts, plain } from './load_scripts.ts';

const sb = loadScripts('js/util.js');
const { toApplicationRow, toSavedEntry, applyInterviewMilestone, normalizeUrlInput, esc, toValidUsername, todayLocal } = sb;
const CURRENT_CYCLE = constOf(sb, 'CURRENT_CYCLE');

const entry = {
  id: 'app-1', listingId: 'listing-9', url: 'https://stripe.com/jobs/1',
  position: 'SWE Intern', company: 'Stripe', location: 'Remote', pay: '$50/hr',
  date_applied: '2026-10-01', status: '1st Round Interview', notes: 'hi',
  reached_interview: true, cycle: '2027 Summer',
};

Deno.test('toApplicationRow: insert row has every column, user_id and listing_id', () => {
  assertEquals(plain(toApplicationRow(entry, 'user-1')), {
    url: 'https://stripe.com/jobs/1', position: 'SWE Intern', company: 'Stripe',
    location: 'Remote', pay: '$50/hr', date_applied: '2026-10-01',
    status: '1st Round Interview', notes: 'hi', reached_interview: true,
    cycle: '2027 Summer', user_id: 'user-1', listing_id: 'listing-9',
  });
});

Deno.test('toApplicationRow: update row never changes user_id or listing_id', () => {
  const row = plain(toApplicationRow(entry));
  assertEquals('user_id' in row, false);
  assertEquals('listing_id' in row, false);
  assertEquals('id' in row, false);   // the id goes in .eq('id', ...), not the row
});

Deno.test('toApplicationRow: empty values become null / defaults the database expects', () => {
  const row = plain(toApplicationRow({ position: 'Intern', company: 'Co', status: 'Pending' }, 'user-1'));
  assertEquals(row.url, null);
  assertEquals(row.date_applied, null);
  assertEquals(row.listing_id, null);
  assertEquals(row.reached_interview, false);
  assertEquals(row.cycle, CURRENT_CYCLE);
});

Deno.test('toSavedEntry keeps the compact saved-job shape', () => {
  assertEquals(plain(toSavedEntry({ id: 'l1', title: 'Intern', company: 'Figma', extra: 'dropped' })), {
    listingId: 'l1', title: 'Intern', company: 'Figma', location: '', url: '', pay: '',
    posted_at: null, type: null,
  });
});

Deno.test('applyInterviewMilestone: interviews set it, Pending clears it, outcomes keep it', () => {
  const after = (status: string, before: boolean) => {
    const app = { status, reached_interview: before };
    applyInterviewMilestone(app);
    return app.reached_interview;
  };
  assertEquals(after('1st Round Interview', false), true);
  assertEquals(after('2nd Round Interview', false), true);
  assertEquals(after('Interview', false), true);           // legacy value
  assertEquals(after('Pending', true), false);
  assertEquals(after('Applied', true), false);             // legacy value
  assertEquals(after('Rejected', true), true);             // interviewed, then rejected
  assertEquals(after('Accepted', false), false);
});

Deno.test('status lists: pending = waiting on an answer (matches the leaderboard SQL)', () => {
  assertEquals(plain(constOf(sb, 'PENDING_STATUSES')),
    ['Pending', 'Applied', '1st Round Interview', '2nd Round Interview', 'Interview']);
});

Deno.test('normalizeUrlInput adds https:// only to bare domains', () => {
  assertEquals(normalizeUrlInput('  www.stripe.com/jobs/1 '), 'https://www.stripe.com/jobs/1');
  assertEquals(normalizeUrlInput('stripe.com'), 'https://stripe.com');
  assertEquals(normalizeUrlInput('https://stripe.com/x'), 'https://stripe.com/x');
  assertEquals(normalizeUrlInput('mailto:a@b.com'), 'mailto:a@b.com');
  assertEquals(normalizeUrlInput('not a link'), 'not a link');
  assertEquals(normalizeUrlInput(''), '');
});

Deno.test('esc escapes everything that could break out of HTML or an attribute', () => {
  assertEquals(esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assertEquals(esc(null), '');
});

Deno.test('toValidUsername always produces a name the database accepts', () => {
  const RULE = /^[A-Za-z0-9_]{3,20}$/;
  for (const raw of ['Gavin Chang', 'ab', '', null, 'émile', '🎉🎉', 'x'.repeat(30), '___']) {
    assertEquals(RULE.test(toValidUsername(raw)), true, `from ${JSON.stringify(raw)}`);
    assertEquals(RULE.test(toValidUsername(raw, '12')), true, `from ${JSON.stringify(raw)} + suffix`);
  }
  assertEquals(toValidUsername('Gavin Chang'), 'Gavin_Chang');
});

Deno.test('todayLocal is the local calendar date, not the UTC one', () => {
  assertEquals(todayLocal(new Date(2026, 9, 6, 23, 30)), '2026-10-06');   // late evening
  assertEquals(todayLocal(new Date(2026, 9, 6, 0, 15)), '2026-10-06');    // just after midnight
  assertEquals(todayLocal(new Date(2027, 0, 9)), '2027-01-09');           // zero-padded
});
