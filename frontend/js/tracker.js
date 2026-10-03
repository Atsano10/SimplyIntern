let applications = [];
let editingId = null; // Supabase UUID or localStorage index

// Interview-stage statuses (includes the legacy 'Interview').
const INTERVIEW_STATUSES = ['1st Round Interview', '2nd Round Interview', 'Interview'];

// Maintains the reached_interview milestone for an application based on its status:
// reaching any interview round turns it on; returning to Pending clears it (a restart);
// Accepted/Rejected leave it untouched, so an interview that ended in a later
// accept/reject still counts as an interview.
function applyInterviewMilestone(app) {
    if (app.status === 'Pending' || app.status === 'Applied') {
        app.reached_interview = false;
    } else if (INTERVIEW_STATUSES.includes(app.status)) {
        app.reached_interview = true;
    }
}

// ── LOAD ────────────────────────────────────────────────────────────────────

async function loadApplications() {
    try {
        const { data: { user } } = await client.auth.getUser();
        if (user) {
            const { data, error } = await client
                .from('applications')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (!error && data !== null) {
                if (data.length > 0) {
                    // Cloud has data — use it as the source of truth
                    applications = data.map(row => ({
                        id: row.id,
                        position: row.position,
                        company: row.company,
                        location: row.location || '',
                        pay: row.pay || '',
                        date_applied: row.date_applied || '',
                        status: row.status,
                        notes: row.notes || '',
                        reached_interview: row.reached_interview ?? false,
                    }));
                    localStorage.setItem('si_applications', JSON.stringify(applications));
                    renderTable();
                    return;
                }

                // Cloud returned empty for THIS user. Keep only apps that were
                // never synced (no id) — those are genuinely unsaved local work.
                // Apps WITH an id belong to a different account's cloud data
                // (e.g. a previous login in this browser), so we drop them
                // instead of showing them under the current account.
                const local = JSON.parse(localStorage.getItem('si_applications') || '[]');
                const unsynced = local.filter(a => !a.id);
                if (unsynced.length > 0) {
                    applications = unsynced;
                    localStorage.setItem('si_applications', JSON.stringify(applications));
                    renderTable();
                    syncLocalApps(user); // non-blocking background sync
                    return;
                }

                applications = [];
                localStorage.setItem('si_applications', '[]');
                renderTable();
                return;
            }
        }
    } catch (_) {}

    // Fallback: not logged in or Supabase unreachable
    applications = JSON.parse(localStorage.getItem('si_applications') || '[]');
    renderTable();
}

// Push any local-only apps (no cloud id) up to Supabase
async function syncLocalApps(user) {
    let changed = false;
    for (const app of applications) {
        if (app.id) continue; // already in Supabase
        const { data, error } = await client
            .from('applications')
            .insert({
                user_id: user.id,
                position: app.position,
                company: app.company,
                location: app.location,
                pay: app.pay,
                date_applied: app.date_applied || null,
                status: app.status,
                notes: app.notes,
                reached_interview: app.reached_interview ?? false,
            })
            .select()
            .single();
        if (data) { app.id = data.id; changed = true; }
        if (error) showSyncBanner(error.message);
    }
    if (changed) localStorage.setItem('si_applications', JSON.stringify(applications));
}

function showSyncBanner(errorMsg) {
    const existing = document.getElementById('sync_banner');
    if (existing) existing.remove();
    const isDark = document.body.classList.contains('dark');
    const banner = document.createElement('div');
    banner.id = 'sync_banner';
    banner.style.cssText = [
        `background:${isDark ? '#2a200a' : '#fff3cd'}`,
        `color:${isDark ? '#ffc107' : '#856404'}`,
        'padding:10px 20px',
        'font-size:13px',
        `border-bottom:1px solid ${isDark ? '#5a4000' : '#ffc107'}`,
        'display:flex',
        'align-items:center',
        'justify-content:space-between',
        'gap:12px',
    ].join(';');
    const msg = errorMsg ? `⚠ Sync failed: "${errorMsg}"` : '⚠ Sync failed — unknown error.';
    // Build with DOM methods: textContent can't execute markup (no esc needed),
    // and the close button uses addEventListener instead of an inline onclick.
    const span = document.createElement('span');
    span.textContent = msg;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;color:inherit;flex-shrink:0;';
    closeBtn.addEventListener('click', () => banner.remove());
    banner.append(span, closeBtn);
    const section = document.querySelector('.tracker_section');
    if (section) section.prepend(banner);
}

// ── SAVE ────────────────────────────────────────────────────────────────────

async function saveApplication(entry) {
    try {
        const { data: { user } } = await client.auth.getUser();
        if (user) {
            if (entry.id) {
                // Update existing row
                const { error } = await client
                    .from('applications')
                    .update({
                        position: entry.position,
                        company: entry.company,
                        location: entry.location,
                        pay: entry.pay,
                        date_applied: entry.date_applied || null,
                        status: entry.status,
                        notes: entry.notes,
                        reached_interview: entry.reached_interview ?? false,
                    })
                    .eq('id', entry.id);
                if (error) console.error('Update failed:', error.message);
            } else {
                // Insert new row and get back the UUID
                const { data, error } = await client
                    .from('applications')
                    .insert({
                        user_id: user.id,
                        position: entry.position,
                        company: entry.company,
                        location: entry.location,
                        pay: entry.pay,
                        date_applied: entry.date_applied || null,
                        status: entry.status,
                        notes: entry.notes,
                        reached_interview: entry.reached_interview ?? false,
                    })
                    .select()
                    .single();
                if (error) {
                    console.error('Insert failed:', error.message);
                    showSyncBanner(error.message);
                } else if (data) {
                    entry.id = data.id;
                }
            }
        }
    } catch (err) {
        console.error('Save error:', err);
    }

    localStorage.setItem('si_applications', JSON.stringify(applications));
}

// ── DELETE ──────────────────────────────────────────────────────────────────

async function deleteApp(index) {
    const app = applications[index];

    if (app.id) {
        try {
            await client.from('applications').delete().eq('id', app.id);
        } catch (_) {}
    }

    applications.splice(index, 1);
    localStorage.setItem('si_applications', JSON.stringify(applications));
    renderTable();
}

// Resets a single application back to 'Pending', which clears its interview/offer
// contribution to the funnel (stats read current status, so this fully restarts it).
async function resetApp(index) {
    const app = applications[index];
    if (!app || app.status === 'Pending') return;

    const ok = await showConfirm(
        `Reset "${app.position}" back to Pending? This clears its interview/offer progress in your stats.`,
        'Reset application'
    );
    if (!ok) return;

    app.status = 'Pending';
    applyInterviewMilestone(app); // Pending clears the interview milestone
    await saveApplication(app);   // persists to Supabase (if synced) + localStorage
    renderTable();
}

// ── RENDER ──────────────────────────────────────────────────────────────────

function renderTable() {
    const tbody = document.getElementById('app_tbody');

    if (applications.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="7">
                <div class="table_empty">
                    <p>No applications yet.</p>
                    <p>Click "Add Application" or use "Mark Applied" on the Search page.</p>
                </div>
            </td></tr>`;
        updateStats();
        return;
    }

    const STATUS_CLASS = {
        'Pending':             'Pending',
        'Applied':             'Applied',       // backward compat
        'Interview':           'Interview',     // backward compat
        '1st Round Interview': 'Interview1',
        '2nd Round Interview': 'Interview2',
        'Accepted':            'Accepted',
        'Rejected':            'Rejected',
    };

    tbody.innerHTML = applications.map((app, i) => {
        const cls = STATUS_CLASS[app.status] || 'Pending';
        return `
        <tr>
            <td>${esc(app.position)}</td>
            <td>${esc(app.company)}</td>
            <td>${esc(app.location) || '—'}</td>
            <td>${esc(app.pay) || '—'}</td>
            <td>${formatDate(app.date_applied)}</td>
            <td><span class="status_badge ${cls}">${esc(app.status)}</span></td>
            <td>${esc(app.notes) || '—'}</td>
            <td class="row_actions">
                ${app.status !== 'Pending' ? `<button class="row_reset" data-index="${i}" title="Reset to Pending">&#8634;</button>` : ''}
                <button class="row_edit" data-index="${i}" title="Edit">&#9998;</button>
                <button class="row_delete" data-index="${i}" title="Remove">&#10005;</button>
            </td>
        </tr>`;
    }).join('');

    updateStats();
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return `${m}/${d}/${y}`;
}

function updateStats() {
    document.getElementById('stat_total').textContent = applications.length;
    document.getElementById('stat_pending').textContent =
        applications.filter(a => ['Pending', 'Applied', 'Interview', '1st Round Interview', '2nd Round Interview'].includes(a.status)).length;
    document.getElementById('stat_rejected').textContent =
        applications.filter(a => a.status === 'Rejected').length;
    document.getElementById('stat_accepted').textContent =
        applications.filter(a => a.status === 'Accepted').length;

    renderInsights();
}

// Builds the funnel (Applied / Interviewed / Offers) and the rates from the
// in-memory applications array. "Interviewed" uses the reached_interview milestone
// (so it survives a later accept/reject); "Offers" uses the current Accepted status
// (so a rescinded/rejected offer drops off). All values are derived, so the markup
// is built from numbers/static labels only (no user input to escape).
function renderInsights() {
    const total = applications.length;

    const sub = document.getElementById('insights_sub');
    const funnelEl = document.getElementById('funnel');
    const ratesEl  = document.getElementById('rates_row');

    if (total === 0) {
        sub.textContent = '';
        funnelEl.innerHTML = '<div class="insights_empty">Track a few applications to see your funnel and response rates here.</div>';
        ratesEl.innerHTML = '';
        return;
    }

    const interviewed = applications.filter(a => a.reached_interview).length;
    const offers      = applications.filter(a => a.status === 'Accepted').length;
    // Heard back = ever interviewed, currently holding an offer, or rejected.
    const responded   = applications.filter(a =>
        a.reached_interview || a.status === 'Accepted' || a.status === 'Rejected').length;

    sub.textContent = `across ${total} application${total === 1 ? '' : 's'}`;

    const pct = n => total ? Math.round((n / total) * 100) : 0;

    // Funnel: Interviewed is the milestone count; Offers is the current-Accepted count.
    // Bar width is relative to total.
    const stages = [
        { label: 'Applied',     count: total,       cls: 'applied' },
        { label: 'Interviewed', count: interviewed, cls: 'interviewed' },
        { label: 'Offers',      count: offers,      cls: 'offers' },
    ];
    funnelEl.innerHTML = stages.map(s => `
        <div class="funnel_stage">
            <div class="funnel_label">${s.label}</div>
            <div class="funnel_track">
                <div class="funnel_bar ${s.cls}" style="width:${Math.max(pct(s.count), s.count > 0 ? 3 : 0)}%"></div>
            </div>
            <div class="funnel_meta">
                <span class="funnel_count">${s.count}</span>
                <span class="funnel_pct">${pct(s.count)}%</span>
            </div>
        </div>
    `).join('');

    // Headline rates, each as a share of all applications (always 0–100%).
    const rates = [
        { pct: pct(responded),   label: 'Response rate',  hint: 'heard back — interview, offer, or rejection' },
        { pct: pct(interviewed), label: 'Interview rate', hint: 'reached an interview at some point' },
        { pct: pct(offers),      label: 'Offer rate',     hint: 'currently hold an offer' },
    ];
    ratesEl.innerHTML = rates.map(r => `
        <div class="rate_card" title="${r.hint}">
            <div class="rate_pct">${r.pct}%</div>
            <div class="rate_label">${r.label}</div>
        </div>
    `).join('');
}

// ── MODAL ───────────────────────────────────────────────────────────────────

function openModal(index = null) {
    editingId = index;
    document.getElementById('modal_title').textContent = index !== null ? 'Edit Application' : 'Add Application';

    if (index !== null) {
        const app = applications[index];
        document.getElementById('m_position').value = app.position;
        document.getElementById('m_company').value = app.company;
        document.getElementById('m_location').value = app.location || '';
        document.getElementById('m_pay').value = app.pay || '';
        document.getElementById('m_date').value = app.date_applied || '';
        document.getElementById('m_status').value = app.status;
        document.getElementById('m_notes').value = app.notes || '';
    } else {
        document.getElementById('m_position').value = '';
        document.getElementById('m_company').value = '';
        document.getElementById('m_location').value = '';
        document.getElementById('m_pay').value = '';
        document.getElementById('m_date').value = '';
        document.getElementById('m_status').value = 'Pending';
        document.getElementById('m_notes').value = '';
    }

    document.getElementById('modal_overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal_overlay').style.display = 'none';
    editingId = null;
}

// Edit/Delete are bound via delegation (rows are re-rendered, so we listen on
// the stable tbody instead of using inline onclick — required for a strict CSP).
document.getElementById('app_tbody').addEventListener('click', e => {
    const editBtn  = e.target.closest('.row_edit');
    const delBtn   = e.target.closest('.row_delete');
    const resetBtn = e.target.closest('.row_reset');
    if (editBtn) openModal(Number(editBtn.dataset.index));
    else if (delBtn) deleteApp(Number(delBtn.dataset.index));
    else if (resetBtn) resetApp(Number(resetBtn.dataset.index));
});

document.getElementById('add_btn').addEventListener('click', () => openModal());
document.getElementById('modal_close').addEventListener('click', closeModal);
document.getElementById('modal_cancel').addEventListener('click', closeModal);
document.getElementById('modal_overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal_overlay')) closeModal();
});

document.getElementById('modal_save').addEventListener('click', async () => {
    const position = document.getElementById('m_position').value.trim();
    const company = document.getElementById('m_company').value.trim();

    if (!position || !company) {
        await showAlert('Position and Company are required.', 'Add application');
        return;
    }

    const entry = {
        position,
        company,
        location: document.getElementById('m_location').value.trim(),
        pay: document.getElementById('m_pay').value.trim(),
        date_applied: document.getElementById('m_date').value,
        status: document.getElementById('m_status').value,
        notes: document.getElementById('m_notes').value.trim(),
    };

    // Carry the interview milestone forward from the existing row, then let the new
    // status update it (reaching an interview sets it; Pending clears it).
    entry.reached_interview = editingId !== null ? (applications[editingId].reached_interview || false) : false;
    applyInterviewMilestone(entry);

    if (editingId !== null) {
        entry.id = applications[editingId].id;
        applications[editingId] = entry;
    } else {
        applications.push(entry);
    }

    await saveApplication(entry);
    renderTable();
    closeModal();
});

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
};

// Positional order assumed when the pasted data has no recognizable header row.
const IMPORT_POSITIONAL = ['position', 'company', 'location', 'pay', 'date_applied', 'status', 'notes'];

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

// Best-effort date → YYYY-MM-DD; '' if unparseable.
function normalizeImportDate(raw) {
    const s = (raw || '').trim();
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
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

    const FIELDS = ['position', 'company', 'location', 'pay', 'date_applied', 'status', 'notes'];

    for (const cells of dataRows) {
        const vals = {};
        for (const f of FIELDS) {
            const idx = headerMap ? headerMap[f] : IMPORT_POSITIONAL.indexOf(f);
            vals[f] = (idx != null && idx >= 0 && idx < cells.length) ? cells[idx].trim() : '';
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
        };
        applyInterviewMilestone(entry);
        result.entries.push(entry);
    }
    return result;
}

// Holds the text of the uploaded file (import is file-only — no paste box).
let importFileText = '';

function openImportModal() {
    importFileText = '';
    document.getElementById('import_file').value = '';
    document.getElementById('import_preview').textContent = '';
    document.getElementById('import_confirm').disabled = true;
    document.getElementById('import_overlay').style.display = 'flex';
}

function closeImportModal() {
    document.getElementById('import_overlay').style.display = 'none';
}

// Live preview: count of importable rows + a small sample.
function renderImportPreview() {
    const text = importFileText;
    const preview = document.getElementById('import_preview');
    const confirmBtn = document.getElementById('import_confirm');

    if (!text.trim()) {
        preview.textContent = '';
        confirmBtn.disabled = true;
        return;
    }

    const parsed = parseImport(text);
    const n = parsed.entries.length;
    confirmBtn.disabled = n === 0;

    let msg = `${n} application${n === 1 ? '' : 's'} ready to import`;
    if (parsed.headerDetected) msg += ' · header detected';
    if (parsed.skipped) msg += ` · ${parsed.skipped} skipped (missing position/company)`;

    if (n > 0) {
        const sample = parsed.entries.slice(0, 3)
            .map(e => `• ${e.position} — ${e.company}${e.status !== 'Pending' ? ' (' + e.status + ')' : ''}`)
            .join('\n');
        msg += '\n' + sample + (n > 3 ? `\n…and ${n - 3} more` : '');
    }
    preview.textContent = msg;
}

async function doImport() {
    const parsed = parseImport(importFileText);
    if (parsed.entries.length === 0) return;

    const confirmBtn = document.getElementById('import_confirm');
    confirmBtn.disabled = true;

    let synced = false;
    try {
        const { data: { user } } = await client.auth.getUser();
        if (user) {
            const payload = parsed.entries.map(e => ({
                user_id:           user.id,
                position:          e.position,
                company:           e.company,
                location:          e.location,
                pay:               e.pay,
                date_applied:      e.date_applied || null,
                status:            e.status,
                notes:             e.notes,
                reached_interview: e.reached_interview ?? false,
            }));
            const { error } = await client.from('applications').insert(payload);
            if (error) showSyncBanner(error.message);
            else synced = true;
        }
    } catch (_) {}

    closeImportModal();

    if (synced) {
        // Reload from the cloud so the imported rows come back with their real ids.
        await loadApplications();
    } else {
        // Logged out or sync failed — keep them locally (no ids).
        applications = parsed.entries.concat(applications);
        localStorage.setItem('si_applications', JSON.stringify(applications));
        renderTable();
    }

    await showAlert(
        `Imported ${parsed.entries.length} application${parsed.entries.length === 1 ? '' : 's'}.` +
        (parsed.skipped ? ` ${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} skipped (missing position or company).` : ''),
        'Import complete'
    );
}

document.getElementById('import_btn').addEventListener('click', openImportModal);
document.getElementById('import_close').addEventListener('click', closeImportModal);
document.getElementById('import_cancel').addEventListener('click', closeImportModal);
document.getElementById('import_overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('import_overlay')) closeImportModal();
});
document.getElementById('import_confirm').addEventListener('click', doImport);

// File picker loads the file's text, then previews it.
document.getElementById('import_file').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) {
        importFileText = '';
        renderImportPreview();
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        importFileText = String(reader.result || '');
        renderImportPreview();
    };
    reader.readAsText(file);
});

// ── INIT ─────────────────────────────────────────────────────────────────────

loadApplications();

// Re-sync from Supabase if browser restores this page from bfcache
window.addEventListener('pageshow', (e) => {
    if (e.persisted) loadApplications();
});
