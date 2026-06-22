const fs = require('fs');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  process.exit(1);
}

const content = `window.SUPABASE_URL = "${url}";\nwindow.SUPABASE_ANON_KEY = "${key}";\n`;
fs.writeFileSync('frontend/js/config.js', content);
console.log('Generated frontend/js/config.js');
