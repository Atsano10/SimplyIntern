let applications = [];
let editingApp = null; // the application object being edited, or null when adding

// ── FOLDERS / CYCLES ──────────────────────────────────────────────────────────
const ALL_FOLDERS = '__all__';                 // sentinel for the "All folders" view
let folders = [];                              // the user's CUSTOM folder names
let activeFolder = CURRENT_CYCLE;              // the folder currently being viewed

// Predefined cycles first, then any custom folders (deduped, order-preserving).
function allFolderNames() {
    const custom = folders.filter(f => !PREDEFINED_CYCLES.includes(f));
    return [...PREDEFINED_CYCLES, ...custom];
}

// Applications in the active folder (or all of them when "All folders" is selected).
function getVisibleApps() {
    if (activeFolder === ALL_FOLDERS) return applications;
    return applications.filter(a => (a.cycle || CURRENT_CYCLE) === activeFolder);
}

// Loads the user's custom folders (DB when signed in, else localStorage mirror).
async function loadFolders() {
    let names = [];
    try {
        const { data: { user } } = await client.auth.getUser();
        if (user) {
            const { data } = await client
                .from('folders')
                .select('name')
                .eq('user_id', user.id)
                .order('created_at', { ascending: true });
            if (data) names = data.map(f => f.name);
        }
    } catch (_) {}

    if (names.length > 0) {
        localStorage.setItem('si_folders', JSON.stringify(names));
    } else {
        names = JSON.parse(localStorage.getItem('si_folders') || '[]');
    }
    folders = names;
}

// (Re)builds the folder picker and the modal's folder <select>.
function populateFolderSelects() {
    const names = allFolderNames();

    // Guard: if the remembered folder no longer exists, fall back to the current cycle.
    if (activeFolder !== ALL_FOLDERS && !names.includes(activeFolder)) {
        activeFolder = CURRENT_CYCLE;
        localStorage.setItem('si_active_folder', activeFolder);
    }

    updateFolderButton();

    const msel = document.getElementById('m_folder');
    if (msel) msel.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

// ── FOLDER PICKER (custom popup replacing the native <select>) ──────────────

function folderAppCount(folder) {
    if (folder === ALL_FOLDERS) return applications.length;
    return applications.filter(a => (a.cycle || CURRENT_CYCLE) === folder).length;
}

// Shows the active folder's name + application count on the picker button.
function updateFolderButton() {
    document.getElementById('folder_btn_name').textContent =
        activeFolder === ALL_FOLDERS ? 'All folders' : activeFolder;
    document.getElementById('folder_btn_count').textContent = folderAppCount(activeFolder);
}

// One selectable row in the menu. Built with textContent: folder names are user input.
function folderMenuItem(value, label, tag) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'folder_item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(value === activeFolder));
    item.dataset.folder = value;

    const check = document.createElement('span');
    check.className = 'folder_item_check';
    check.textContent = value === activeFolder ? '✓' : '';

    const name = document.createElement('span');
    name.className = 'folder_item_name';
    name.textContent = label;

    item.append(check, name);
    if (tag) {
        const t = document.createElement('span');
        t.className = 'folder_item_tag';
        t.textContent = tag;
        item.appendChild(t);
    }
    const count = document.createElement('span');
    count.className = 'folder_item_count';
    count.textContent = folderAppCount(value);
    item.appendChild(count);
    return item;
}

function folderMenuSection(title) {
    const h = document.createElement('div');
    h.className = 'folder_menu_title';
    h.textContent = title;
    return h;
}

// Rebuilds the menu each time it opens, so counts and the checkmark are always current.
function renderFolderMenu() {
    const menu = document.getElementById('folder_menu');
    menu.replaceChildren();

    menu.appendChild(folderMenuItem(ALL_FOLDERS, 'All folders'));

    menu.appendChild(folderMenuSection('Recruitment cycles'));
    PREDEFINED_CYCLES.forEach(c =>
        menu.appendChild(folderMenuItem(c, c, c === CURRENT_CYCLE ? 'Current' : '')));

    const custom = allFolderNames().filter(f => !PREDEFINED_CYCLES.includes(f));
    if (custom.length) {
        menu.appendChild(folderMenuSection('Your folders'));
        custom.forEach(f => menu.appendChild(folderMenuItem(f, f)));
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'folder_item folder_item_new';
    add.textContent = '+ New folder';
    add.addEventListener('click', () => { closeFolderMenu(); createFolder(); });
    menu.appendChild(add);
}

function openFolderMenu() {
    renderFolderMenu();
    const menu = document.getElementById('folder_menu');
    menu.hidden = false;
    document.getElementById('folder_btn').setAttribute('aria-expanded', 'true');
    (menu.querySelector('.folder_item[aria-selected="true"]') || menu.querySelector('.folder_item')).focus();
}

function closeFolderMenu(returnFocus) {
    const menu = document.getElementById('folder_menu');
    if (menu.hidden) return;
    menu.hidden = true;
    const btn = document.getElementById('folder_btn');
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus();
}

function selectFolder(folder) {
    activeFolder = folder;
    localStorage.setItem('si_active_folder', activeFolder);
    closeFolderMenu(true);
    renderTable();
}

document.getElementById('folder_btn').addEventListener('click', () => {
    if (document.getElementById('folder_menu').hidden) openFolderMenu();
    else closeFolderMenu();
});

document.getElementById('folder_menu').addEventListener('click', e => {
    const item = e.target.closest('.folder_item[data-folder]');
    if (item) selectFolder(item.dataset.folder);
});

// Keyboard: arrows move between rows, Escape closes, Tab leaves and closes.
document.getElementById('folder_menu').addEventListener('keydown', e => {
    const items = [...document.querySelectorAll('#folder_menu .folder_item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFolderMenu(true); }
    else if (e.key === 'Tab') closeFolderMenu();
});

document.getElementById('folder_btn').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && document.getElementById('folder_menu').hidden) {
        e.preventDefault();
        openFolderMenu();
    }
});

// Clicking anywhere outside the picker closes it.
document.addEventListener('click', e => {
    if (!e.target.closest('.folder_picker')) closeFolderMenu();
});

// Creates a new custom folder and switches to it.
async function createFolder() {
    const name = await showPrompt({
        title: 'New folder',
        message: 'Name this folder (e.g. a recruitment cycle):',
        placeholder: 'Off-Season 2026',
        confirmText: 'Create',
    });
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    if (allFolderNames().includes(trimmed) || trimmed === ALL_FOLDERS) {
        await showAlert('A folder with that name already exists.', 'New folder');
        return;
    }

    folders.push(trimmed);
    localStorage.setItem('si_folders', JSON.stringify(folders));
    try {
        const { data: { user } } = await client.auth.getUser();
        if (user) await client.from('folders').insert({ user_id: user.id, name: trimmed });
    } catch (_) {}

    activeFolder = trimmed;
    localStorage.setItem('si_active_folder', activeFolder);
    populateFolderSelects();
    renderTable();
}

// Permanently deletes every application in the active folder (or all folders).
async function deleteFolderApps() {
    const victims = getVisibleApps();
    const scope = activeFolder === ALL_FOLDERS ? 'ALL folders' : `"${activeFolder}"`;

    if (victims.length === 0) {
        await showAlert(`No applications to delete in ${scope}.`, 'Permanently delete');
        return;
    }

    const ok = await showConfirm(
        `Permanently delete all ${victims.length} application${victims.length === 1 ? '' : 's'} in ${scope}? This cannot be undone.`,
        'Permanently delete'
    );
    if (!ok) return;

    const ids = victims.filter(a => a.id).map(a => a.id);
    try {
        const { data: { user } } = await client.auth.getUser();
        if (user && ids.length) await client.from('applications').delete().in('id', ids);
    } catch (_) {}

    const victimSet = new Set(victims);
    applications = applications.filter(a => !victimSet.has(a));
    localStorage.setItem('si_applications', JSON.stringify(applications));
    renderTable();
}

// The cycle an application should get when created from each entry point.
function cycleForNewApp() {
    return activeFolder === ALL_FOLDERS ? CURRENT_CYCLE : activeFolder;
}

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
                        cycle: row.cycle || CURRENT_CYCLE,
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
                cycle: app.cycle || CURRENT_CYCLE,
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
                        cycle: entry.cycle || CURRENT_CYCLE,
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
                        cycle: entry.cycle || CURRENT_CYCLE,
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

async function deleteApp(app) {
    if (!app) return;

    if (app.id) {
        try {
            await client.from('applications').delete().eq('id', app.id);
        } catch (_) {}
    }

    applications = applications.filter(a => a !== app);
    localStorage.setItem('si_applications', JSON.stringify(applications));
    renderTable();
}

// Resets a single application back to 'Pending', which clears its interview/offer
// contribution to the funnel (stats read current status, so this fully restarts it).
async function resetApp(app) {
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
    const visible = getVisibleApps();

    if (visible.length === 0) {
        const where = activeFolder === ALL_FOLDERS ? 'any folder' : `“${esc(activeFolder)}”`;
        tbody.innerHTML = `
            <tr><td colspan="8">
                <div class="table_empty">
                    <p>No applications in ${where} yet.</p>
                    <p>Click "Add Application", use "Mark Applied" on Search, or Import a list.</p>
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

    tbody.innerHTML = visible.map((app, i) => {
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
    updateFolderButton();   // keep the picker's count in step with the table
    const visible = getVisibleApps();
    document.getElementById('stat_total').textContent = visible.length;
    document.getElementById('stat_pending').textContent =
        visible.filter(a => ['Pending', 'Applied', 'Interview', '1st Round Interview', '2nd Round Interview'].includes(a.status)).length;
    document.getElementById('stat_rejected').textContent =
        visible.filter(a => a.status === 'Rejected').length;
    document.getElementById('stat_accepted').textContent =
        visible.filter(a => a.status === 'Accepted').length;

    renderInsights();
}

// Builds the funnel (Applied / Interviewed / Offers) and the rates from the
// in-memory applications array. "Interviewed" uses the reached_interview milestone
// (so it survives a later accept/reject); "Offers" uses the current Accepted status
// (so a rescinded/rejected offer drops off). All values are derived, so the markup
// is built from numbers/static labels only (no user input to escape).
function renderInsights() {
    const visible = getVisibleApps();
    const total = visible.length;

    const sub = document.getElementById('insights_sub');
    const funnelEl = document.getElementById('funnel');
    const ratesEl  = document.getElementById('rates_row');

    if (total === 0) {
        sub.textContent = '';
        funnelEl.innerHTML = '<div class="insights_empty">Track a few applications to see your funnel and response rates here.</div>';
        ratesEl.innerHTML = '';
        return;
    }

    const interviewed = visible.filter(a => a.reached_interview).length;
    const offers      = visible.filter(a => a.status === 'Accepted').length;
    // Heard back = ever interviewed, currently holding an offer, or rejected.
    const responded   = visible.filter(a =>
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

function openModal(app = null) {
    editingApp = app;
    document.getElementById('modal_title').textContent = app ? 'Edit Application' : 'Add Application';
    populateFolderSelects(); // keep the folder picker fresh

    if (app) {
        document.getElementById('m_position').value = app.position;
        document.getElementById('m_company').value = app.company;
        document.getElementById('m_location').value = app.location || '';
        document.getElementById('m_pay').value = app.pay || '';
        document.getElementById('m_date').value = app.date_applied || '';
        document.getElementById('m_status').value = app.status;
        document.getElementById('m_notes').value = app.notes || '';
        document.getElementById('m_folder').value = app.cycle || CURRENT_CYCLE;
    } else {
        document.getElementById('m_position').value = '';
        document.getElementById('m_company').value = '';
        document.getElementById('m_location').value = '';
        document.getElementById('m_pay').value = '';
        document.getElementById('m_date').value = '';
        document.getElementById('m_status').value = 'Pending';
        document.getElementById('m_notes').value = '';
        document.getElementById('m_folder').value = cycleForNewApp();
    }

    document.getElementById('modal_overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal_overlay').style.display = 'none';
    editingApp = null;
}

// Edit/Delete are bound via delegation (rows are re-rendered, so we listen on
// the stable tbody instead of using inline onclick — required for a strict CSP).
document.getElementById('app_tbody').addEventListener('click', e => {
    const editBtn  = e.target.closest('.row_edit');
    const delBtn   = e.target.closest('.row_delete');
    const resetBtn = e.target.closest('.row_reset');
    const visible = getVisibleApps();           // data-index refers to this filtered list
    if (editBtn) openModal(visible[Number(editBtn.dataset.index)]);
    else if (delBtn) deleteApp(visible[Number(delBtn.dataset.index)]);
    else if (resetBtn) resetApp(visible[Number(resetBtn.dataset.index)]);
});

// Folder controls.
document.getElementById('new_folder_btn').addEventListener('click', createFolder);
document.getElementById('delete_folder_btn').addEventListener('click', deleteFolderApps);

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

    const fields = {
        position,
        company,
        location: document.getElementById('m_location').value.trim(),
        pay: document.getElementById('m_pay').value.trim(),
        date_applied: document.getElementById('m_date').value,
        status: document.getElementById('m_status').value,
        notes: document.getElementById('m_notes').value.trim(),
        cycle: document.getElementById('m_folder').value,
    };

    let entry;
    if (editingApp) {
        // Mutate in place so the id and array position are preserved.
        Object.assign(editingApp, fields);
        entry = editingApp;
    } else {
        entry = { ...fields, reached_interview: false };
        applications.push(entry);
    }

    // The new status updates the interview milestone (reaching an interview sets it;
    // Pending clears it); a later accept/reject leaves it intact.
    applyInterviewMilestone(entry);

    await saveApplication(entry);

    // If the app was moved into a different folder than the one being viewed, keep the
    // current view selected (it'll simply drop out of this folder's list).
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

    let msg = `${n} application${n === 1 ? '' : 's'} ready to import into “${cycleForNewApp()}”`;
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

    // Imported rows land in the folder currently being viewed.
    const importCycle = cycleForNewApp();
    parsed.entries.forEach(e => { e.cycle = importCycle; });

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
                cycle:             e.cycle,
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

async function initTracker() {
    activeFolder = localStorage.getItem('si_active_folder') || CURRENT_CYCLE;
    await loadFolders();
    populateFolderSelects();
    await loadApplications();
}

initTracker();

// Re-sync from Supabase if browser restores this page from bfcache
window.addEventListener('pageshow', (e) => {
    if (e.persisted) initTracker();
});
