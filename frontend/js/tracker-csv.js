// tracker-csv.js — the tracker's spreadsheet import (parseImport) and export
// (applicationsToCsv). No DOM or Supabase access, so it can be unit-tested on its own
// (tests/frontend/). Loaded on the tracker page after util.js (uses
// applyInterviewMilestone and normalizeUrlInput).

// ── IMPORT ───────────────────────────────────────────────────────────────────

// Column-header aliases → our internal fields (case/space-insensitive match).
const IMPORT_HEADER_ALIASES = {
    position:     ['position', 'role', 'title', 'job', 'job title', 'jobtitle', 'posting'],
    company:      ['company', 'employer', 'organization', 'organisation', 'org'],
    location:     ['location', 'city', 'place', 'where', 'loc'],
    pay:          ['pay', 'salary', 'compensation', 'pay rate', 'payrate', 'rate', 'stipend'],
    date_applied: ['date', 'date applied', 'applied', 'application date', 'applied on', 'dateapplied'],
    status:       ['status', 'stage', 'result', 'outcome'],
    notes:        ['notes', 'note', 'comments', 'comment'],
    url:          ['link', 'url', 'listing', 'listing link', 'listing url', 'job link', 'job url',
                   'posting link', 'posting url', 'job posting link', 'application link', 'link to posting'],
};

// Positional order assumed when the pasted data has no recognizable header row.
const IMPORT_POSITIONAL = ['position', 'company', 'location', 'pay', 'date_applied', 'status', 'notes', 'url'];

// Maps a free-text status onto our known set; defaults to 'Pending'.
function normalizeImportStatus(raw) {
    const s = (raw || '').trim().toLowerCase();
    if (!s) return 'Pending';
    if (/reject|declin|denied/.test(s))                   return 'Rejected';
    if (/accept|offer|hired/.test(s))                     return 'Accepted';
    if (/2nd|second|final|round 2|onsite|super/.test(s))  return '2nd Round Interview';
    if (/interview|1st|first|phone|screen|round|technical/.test(s)) return '1st Round Interview';
    return 'Pending'; // applied / pending / submitted / unknown
}

// A spreadsheet date → YYYY-MM-DD, or '' if it isn't a real date. Handles 2026-10-05,
// 10/5/2026, 10/5/26 (month first, US style), "Oct 5, 2026", and dates with no year
// ("Oct 5", "10/5"), which get the current year — or last year if that would be in the
// future (a "Dec 15" application imported in January). Same rule as the scraper's
// parseGithubAge. `now` is only passed by tests.
//
// Two traps this avoids: `new Date("Oct 5")` alone gives the year 2001, and
// toISOString() converts to UTC first, which moved every date a day earlier for anyone
// east of UTC. So the date is built from its parts and read back in local time.
function normalizeImportDate(raw, now = new Date()) {
    const s = (raw || '').trim();
    if (!s) return '';

    let year, month, day;   // month is 1-12; year stays null when the text has none
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
        [year, month, day] = [+m[1], +m[2], +m[3]];
    } else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/))) {
        [month, day] = [+m[1], +m[2]];
        year = m[3] ? +m[3] : null;
        if (year !== null && year < 100) year += 2000;
    } else {
        // Written-out months ("Oct 5, 2026", "5 October 2026"), or a date with a time.
        const parsed = new Date(s);
        if (isNaN(parsed.getTime())) return '';
        [month, day] = [parsed.getMonth() + 1, parsed.getDate()];
        year = /\b\d{4}\b/.test(s) ? parsed.getFullYear() : null;
    }

    if (year === null) {
        year = now.getFullYear();
        if (new Date(year, month - 1, day) > now) year--;
    }

    // Rejects dates that don't exist (Feb 30 would otherwise roll over to Mar 2).
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return '';

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Picks the delimiter from the first non-empty line: tabs (spreadsheet paste) win,
// otherwise commas.
function detectDelimiter(text) {
    const line = text.split(/\r?\n/).find(l => l.trim() !== '') || '';
    const tabs = (line.match(/\t/g) || []).length;
    const commas = (line.match(/,/g) || []).length;
    return tabs > 0 && tabs >= commas ? '\t' : ',';
}

// Splits delimited text into rows of fields, honoring "quoted, fields" and escaped
// "" quotes. Blank rows are dropped.
function parseDelimited(text, delim) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === delim) {
            row.push(field); field = '';
        } else if (c === '\n') {
            row.push(field); rows.push(row); row = []; field = '';
        } else if (c !== '\r') {
            field += c;
        }
    }
    row.push(field);
    rows.push(row);
    return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

// Normalizes a header cell for alias matching: lowercase, punctuation→space, collapsed.
// So "Status:", "Pay Rate", "Date Applied " all match cleanly.
function normalizeHeaderCell(cell) {
    return cell.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// For a candidate header row, returns its field→columnIndex map and how many fields matched.
function headerMapFor(cells) {
    const map = {};
    let hits = 0;
    cells.forEach((cell, i) => {
        const norm = normalizeHeaderCell(cell);
        if (!norm) return;
        for (const [field, aliases] of Object.entries(IMPORT_HEADER_ALIASES)) {
            if (!(field in map) && aliases.includes(norm)) { map[field] = i; hits++; break; }
        }
    });
    return { map, hits };
}

// Parses CSV/TSV text into { entries, skipped, headerDetected }.
function parseImport(text) {
    const result = { entries: [], skipped: 0, headerDetected: false };
    if (!text.trim()) return result;

    const rows = parseDelimited(text, detectDelimiter(text));
    if (rows.length === 0) return result;

    // Spreadsheet exports often have title/blank rows and leading empty columns before
    // the real header, so scan the first several rows for the best header match rather
    // than assuming row 0. Column indices from the matched header also absorb any
    // leading empty columns, since data rows share the same layout.
    let headerMap = null, headerIdx = -1, bestHits = 1; // need >= 2 matches to qualify
    const scanLimit = Math.min(rows.length, 15);
    for (let i = 0; i < scanLimit; i++) {
        const { map, hits } = headerMapFor(rows[i]);
        if (hits > bestHits && ('company' in map || 'position' in map)) {
            bestHits = hits; headerMap = map; headerIdx = i;
        }
    }

    const dataRows = headerMap ? rows.slice(headerIdx + 1) : rows;
    result.headerDetected = !!headerMap;

    const FIELDS = ['position', 'company', 'location', 'pay', 'date_applied', 'status', 'notes', 'url'];

    for (const cells of dataRows) {
        const vals = {};
        for (const f of FIELDS) {
            const idx = headerMap ? headerMap[f] : IMPORT_POSITIONAL.indexOf(f);
            vals[f] = (idx != null && idx >= 0 && idx < cells.length) ? unprotectCell(cells[idx].trim()) : '';
        }

        if (!vals.position || !vals.company) {
            // Only flag rows that had some real content in a mapped column; blank or
            // purely structural spreadsheet rows (empty cells, stray counts) are ignored.
            if (FIELDS.some(f => vals[f] !== '')) result.skipped++;
            continue;
        }

        const entry = {
            position:     vals.position,
            company:      vals.company,
            location:     vals.location,
            pay:          vals.pay,
            date_applied: normalizeImportDate(vals.date_applied),
            status:       normalizeImportStatus(vals.status),
            notes:        vals.notes,
            // Filler like "N/A", "-", "TBD" (nothing with a dot in it) means no link.
            url:          vals.url.includes('.') ? normalizeUrlInput(vals.url) : '',
        };
        applyInterviewMilestone(entry);
        result.entries.push(entry);
    }
    return result;
}

// ── EXPORT ───────────────────────────────────────────────────────────────────

// Export columns: [header, field]. The headers are names the import recognizes, so an
// exported file can be imported again. (Folder is informational: an import goes into
// the folder you're viewing.)
const EXPORT_COLUMNS = [
    ['Position', 'position'], ['Company', 'company'], ['Location', 'location'],
    ['Pay', 'pay'], ['Date Applied', 'date_applied'], ['Status', 'status'],
    ['Notes', 'notes'], ['Link', 'url'], ['Folder', 'cycle'],
];

// Spreadsheet apps run a cell that starts with = + - or @ as a formula, so a note like
// "=HYPERLINK(...)" could do something when the file is opened ("CSV injection").
// A leading apostrophe makes the app show it as plain text; the import removes it.
function protectCell(value) {
    return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}
function unprotectCell(value) {
    return value.replace(/^'(?=[=+\-@])/, '');
}

// One CSV field: quoted when it holds a comma, quote, or line break (quotes doubled).
function csvField(value) {
    const s = protectCell(String(value ?? ''));
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// The applications as CSV text: a header row, then one row each (Windows line endings,
// which every spreadsheet app reads).
function applicationsToCsv(apps) {
    const rows = [EXPORT_COLUMNS.map(([header]) => header)]
        .concat(apps.map(app => EXPORT_COLUMNS.map(([, field]) => app[field])));
    return rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
