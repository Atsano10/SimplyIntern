// Checks every HTML page for mistakes that break a page without any error at build
// time: a missing data-page name, a script that doesn't exist or loads in the wrong
// order, and inline JavaScript that the CSP (script-src 'self') silently blocks.
// Run: deno test --allow-read tests
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { readFrontend } from './load_scripts.ts';

const FRONTEND = new URL('../../frontend/', import.meta.url);
const pages = [...Deno.readDirSync(FRONTEND)]
  .filter(f => f.isFile && f.name.endsWith('.html'))
  .map(f => ({ name: f.name, html: readFrontend(f.name) }));

const BUILD_OUTPUTS = ['js/config.js'];

const scriptsOf = (html: string) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"?]+)/g)].map(m => m[1]);

// APP_PAGES as written in auth.js, so this test can't drift from it.
const appPagesSrc = readFrontend('js/auth.js').match(/const APP_PAGES = \[([^\]]*)\]/);
const APP_PAGES = [...(appPagesSrc?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]);

Deno.test('found the pages and auth.js page list', () => {
  assert(pages.length >= 8, `only ${pages.length} pages found`);
  assert(APP_PAGES.length >= 5, 'APP_PAGES not found in auth.js');
});

for (const { name, html } of pages) {
  Deno.test(`${name}: has a data-page name auth.js knows`, () => {
    const page = html.match(/<body\b[^>]*\bdata-page="([^"]+)"/)?.[1];
    assert(page, 'no <body data-page="..."> (auth.js would treat it as signed-in only)');
    if (scriptsOf(html).includes('js/auth.js')) {
      assert(['login', 'signup', ...APP_PAGES].includes(page), `unknown data-page "${page}"`);
    }
  });

  Deno.test(`${name}: every local script and stylesheet exists`, () => {
    const refs = [...html.matchAll(/\b(?:src|href)="((?:js|css)\/[^"?#]+)/g)].map(m => m[1]);
    for (const ref of refs) {
      // Written by the build (frontend/scripts/inject-env.js) and gitignored, so it's
      // missing from a fresh checkout. CI's build job checks that it gets generated.
      if (BUILD_OUTPUTS.includes(ref)) continue;
      let found = true;
      try { Deno.statSync(new URL(ref, FRONTEND)); } catch { found = false; }
      assert(found, `${ref} doesn't exist`);
    }
  });

  Deno.test(`${name}: no inline JavaScript (blocked by the CSP)`, () => {
    const inlineScript = /<script\b(?![^>]*\bsrc=)[^>]*>/i.exec(html);
    assertEquals(inlineScript, null, `inline <script> — move it to a js/ file`);
    const handler = /<[a-z][^>]*\son[a-z]+\s*=/i.exec(html);
    assertEquals(handler?.[0] ?? null, null, 'inline on...= handler — use addEventListener in a js/ file');
    assert(!/href\s*=\s*["']\s*javascript:/i.test(html), 'javascript: link');
  });

  Deno.test(`${name}: shared scripts load before the scripts that use them`, () => {
    const s = scriptsOf(html);
    const at = (f: string) => s.indexOf(f);
    if (at('js/util.js') >= 0) {
      for (const f of s.filter(f => !['js/config.js', 'js/util.js'].includes(f) && !f.startsWith('js/vendor/') && f.startsWith('js/'))) {
        assert(at('js/util.js') < at(f), `js/util.js must load before ${f}`);
      }
    }
    if (at('js/tracker.js') >= 0) {
      assert(at('js/tracker-csv.js') >= 0, 'tracker.js needs js/tracker-csv.js');
      assert(at('js/tracker-csv.js') < at('js/tracker.js'), 'js/tracker-csv.js must load before js/tracker.js');
    }
  });
}
