// Vercel build step (buildCommand in frontend/vercel.json). Runs from frontend/.
//   1. Writes js/config.js from the Supabase env vars.
//   2. Cache busting: stamps every local script/stylesheet URL in the HTML pages with
//      a hash of that file's contents (js/util.js -> js/util.js?v=3f9c2a1b7e). Edit a
//      file and its URL changes, so browsers fetch the new copy. Unchanged files keep
//      their URL and stay cached. Nobody has to bump ?v= by hand anymore.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  process.exit(1);
}

const content = `window.SUPABASE_URL = "${url}";\nwindow.SUPABASE_ANON_KEY = "${key}";\n`;
fs.writeFileSync(path.join(ROOT, 'js/config.js'), content);
console.log('Generated js/config.js');

// Only stamp on Vercel. The build rewrites the HTML files in place, which is fine in
// Vercel's throwaway build copy but would leave changes in a local git checkout.
if (!process.env.VERCEL) {
  console.log('Not on Vercel, so asset URLs were left unstamped');
  process.exit(0);
}

const hashes = {};
function hashOf(file) {
  if (!hashes[file]) {
    const full = path.join(ROOT, file);
    // A page pointing at a file that doesn't exist is a typo: fail the build
    // instead of shipping a page with a broken script.
    if (!fs.existsSync(full)) throw new Error(`Referenced file not found: ${file}`);
    hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 10);
  }
  return hashes[file];
}

// Matches src="js/x.js" / href="css/x.css", with or without an existing ?v=.
// External URLs (https://...) and absolute paths (/_vercel/...) don't match.
const ASSET_REF = /\b(src|href)="((?:js|css)\/[^"?#]+\.(?:js|css))(?:\?[^"]*)?"/g;

for (const page of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
  const file = path.join(ROOT, page);
  const html = fs.readFileSync(file, 'utf8');
  let count = 0;
  const stamped = html.replace(ASSET_REF, (_, attr, asset) => {
    count++;
    return `${attr}="${asset}?v=${hashOf(asset)}"`;
  });
  fs.writeFileSync(file, stamped);
  console.log(`Stamped ${count} asset URLs in ${page}`);
}
