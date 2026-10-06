let applications = [];
let editingApp = null; // the application object being edited, or null when adding

// This browser's copy of the applications (the cloud is read and written separately).
function storedApplications() {
    return JSON.parse(localStorage.getItem('si_applications') || '[]');
}
function storeApplications() {
    localStorage.setItem('si_applications', JSON.stringify(applications));
}

// "3 applications", "1 application".
function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ── FOLDERS / CYCLES ──────────────────────────────────────────────────────────
const ALL_FOLDERS = '__all__';                 // sentinel for the "All folders" view
let folders = [];                              // the user's CUSTOM folder names
let activeFolder = CURRENT_CYCLE;              // the folder currently being viewed

// Custom folders, minus any that repeat a predefined cycle's name.
function customFolderNames() {
    return folders.filter(f => !PREDEFINED_CYCLES.includes(f));
}

// Predefined cycles first, then the custom folders.
function allFolderNames() {
    return [...PREDEFINED_CYCLES, ...customFolderNames()];
}

// Applications in a folder (every application for "All folders").
function appsInFolder(folder) {
    if (folder === ALL_FOLDERS) return applications;
    return applications.filter(a => (a.cycle || CURRENT_CYCLE) === folder);
}

// Applications in the folder being viewed.
function getVisibleApps() {
    return appsInFolder(activeFolder);
}

// The folder a new application goes into: the one being viewed, or the current
// cycle when viewing "All folders".
function cycleForNewApp() {
    return activeFolder === ALL_FOLDERS ? CURRENT_CYCLE : activeFolder;
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

// Shows the active folder's name + application count on the picker button.
function updateFolderButton() {
    document.getElementById('folder_btn_name').textContent =
        activeFolder === ALL_FOLDERS ? 'All folders' : activeFolder;
    document.getElementById('folder_btn_count').textContent = getVisibleApps().length;
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
    count.textContent = appsInFolder(value).length;
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

    const custom = customFolderNames();
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
    const trimmed = (name || '').trim();
    if (!trimmed) return;

    if (allFolderNames().includes(trimmed) || trimmed === ALL_FOLDERS) {
        await showAlert('A folder with that name already exists.', 'New folder');
        return;
    }

    const user = await signedInUser();
    if (user) {
        const { error } = await client.from('folders').insert({ user_id: user.id, name: trimmed });
        if (error) {
            showSyncError(`Couldn’t create the folder “${trimmed}”. Try again.`, error);
            return;
        }
    }

    folders.push(trimmed);
    localStorage.setItem('si_folders', JSON.stringify(folders));
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
        `Permanently delete all ${plural(victims.length, 'application')} in ${scope}? This cannot be undone.`,
        'Permanently delete'
    );
    if (!ok) return;

    const ids = victims.filter(a => a.id).map(a => a.id);
    const user = await signedInUser();
    if (user && ids.length) {
        const { error } = await client.from('applications').delete().in('id', ids);
        if (error) {
            showSyncError('Couldn’t delete those applications, so nothing was removed. Try again.', error);
            return;
        }
    }

    const victimSet = new Set(victims);
    applications = applications.filter(a => !victimSet.has(a));
    storeApplications();
    renderTable();
}

// ── LOAD ────────────────────────────────────────────────────────────────────

// The tracker entry for an applications-table row (the reverse of toApplicationRow).
function fromApplicationRow(row) {
    return {
        id:                row.id,
        listingId:         row.listing_id || null,
        url:               row.url || '',
        position:          row.position,
        company:           row.company,
        location:          row.location || '',
        pay:               row.pay || '',
        date_applied:      row.date_applied || '',
        status:            row.status,
        notes:             row.notes || '',
        reached_interview: row.reached_interview ?? false,
        cycle:             row.cycle || CURRENT_CYCLE,
    };
}

async function loadApplications() {
    let user = null;
    let rows = null;   // stays null when signed out or Supabase can't be reached
    try {
        ({ data: { user } } = await client.auth.getUser());
        if (user) {
            const { data, error } = await client
                .from('applications')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });
            if (!error) rows = data;
        }
    } catch (_) {}

    let upload = false;
    if (rows === null) {
        // Signed out or offline: show this browser's copy.
        applications = storedApplications();
    } else if (rows.length > 0) {
        // The cloud has data, so it's the source of truth.
        applications = rows.map(fromApplicationRow);
        storeApplications();
    } else {
        // The cloud is empty for THIS user. Keep only apps that were never synced (no
        // id): those are genuinely unsaved local work. Apps WITH an id belong to a
        // different account (e.g. a previous login in this browser), so they're dropped
        // instead of showing up under this one.
        applications = storedApplications().filter(a => !a.id);
        storeApplications();
        upload = applications.length > 0;
    }
    renderTable();
    if (upload) syncLocalApps(user);   // in the background
}

// Push any local-only apps (no cloud id) up to Supabase
async function syncLocalApps(user) {
    let changed = false;
    for (const app of applications) {
        if (app.id) continue; // already in Supabase
        const { data, error } = await client
            .from('applications')
            .insert(toApplicationRow(app, user.id))
            .select()
            .single();
        if (data) { app.id = data.id; changed = true; }
        if (error) showSyncError(`Couldn’t upload “${app.position}” from this browser to your account.`, error);
    }
    if (changed) storeApplications();
}

// ── SAVE ────────────────────────────────────────────────────────────────────

// Writes one application to Supabase: updates the row if it has an id, otherwise
// inserts it and stores the new id on `entry`. Returns false (after showing the sync
// banner) when the write fails, so the caller can leave its local state untouched.
// Signed out there's nothing to write, so it returns true.
async function saveApplication(entry) {
    const user = await signedInUser();
    if (!user) return true;

    if (entry.id) {
        const { error } = await client.from('applications').update(toApplicationRow(entry)).eq('id', entry.id);
        if (error) {
            showSyncError(`Couldn’t save your changes to “${entry.position}”.`, error);
            return false;
        }
    } else {
        const { data, error } = await client
            .from('applications')
            .insert(toApplicationRow(entry, user.id))
            .select()
            .single();
        if (error) {
            showSyncError(`Couldn’t add “${entry.position}” to your account.`, error);
            return false;
        }
        entry.id = data.id;
    }
    return true;
}

// ── DELETE ──────────────────────────────────────────────────────────────────

// Removes the row right away, then puts it back if the server delete fails.
async function deleteApp(app) {
    if (!app) return;

    const index = applications.indexOf(app);
    applications = applications.filter(a => a !== app);
    storeApplications();
    renderTable();

    if (!app.id) return;
    const user = await signedInUser();
    if (!user) return;

    const { error } = await client.from('applications').delete().eq('id', app.id);
    if (error) {
        applications.splice(Math.min(index, applications.length), 0, app);
        storeApplications();
        renderTable();
        showSyncError(`Couldn’t delete “${app.position}”, so it’s back in your list.`, error);
    }
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

    // Change a copy, so a failed save leaves the row as it was.
    const updated = { ...app, status: 'Pending' };
    applyInterviewMilestone(updated); // Pending clears the interview milestone
    if (!(await saveApplication(updated))) return;

    Object.assign(app, updated);
    storeApplications();
    renderTable();
}

// ── RENDER ──────────────────────────────────────────────────────────────────

// Status → badge class. 'Applied' and 'Interview' are legacy values.
const STATUS_CLASS = {
    'Pending':             'Pending',
    'Applied':             'Applied',
    'Interview':           'Interview',
    '1st Round Interview': 'Interview1',
    '2nd Round Interview': 'Interview2',
    'Accepted':            'Accepted',
    'Rejected':            'Rejected',
};

// One table row. `i` is the app's index in getVisibleApps(), which the row buttons
// carry so the click handler can find it.
function applicationRowHtml(app, i) {
    const href = safeHref(app.url);
    const linkHtml = href
        ? ` <a class="app_link" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="Open job posting" aria-label="Open job posting">&#8599;</a>`
        : '';
    // No link and not from our listings = imported without one; it doesn't score.
    const importedHtml = (!app.url && !app.listingId)
        ? ' <span class="imported_tag" title="No listing link, so this one doesn’t count on the leaderboard. Edit it to add one.">Imported</span>'
        : '';
    return `
        <tr>
            <td>${esc(app.position)}${linkHtml}${importedHtml}</td>
            <td>${esc(app.company)}</td>
            <td>${esc(app.location) || '—'}</td>
            <td>${esc(app.pay) || '—'}</td>
            <td>${formatDate(app.date_applied)}</td>
            <td><span class="status_badge ${STATUS_CLASS[app.status] || 'Pending'}">${esc(app.status)}</span></td>
            <td>${esc(app.notes) || '—'}</td>
            <td class="row_actions">
                ${app.status !== 'Pending' ? `<button class="row_reset" data-index="${i}" title="Reset to Pending">&#8634;</button>` : ''}
                <button class="row_edit" data-index="${i}" title="Edit">&#9998;</button>
                <button class="row_delete" data-index="${i}" title="Remove">&#10005;</button>
            </td>
        </tr>`;
}

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

    tbody.innerHTML = visible.map(applicationRowHtml).join('');

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
        visible.filter(a => PENDING_STATUSES.includes(a.status)).length;
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

    sub.textContent = `across ${plural(total, 'application')}`;

    const pct = n => Math.round((n / total) * 100);

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

// ── LISTING LINKS ───────────────────────────────────────────────────────────
// Every application needs the link to its job posting, and the verify-link edge
// function checks that the posting really exists. Blocking bad links here is just
// for the user's benefit: the leaderboard only trusts what the server recorded
// (migration 018), so skipping this code doesn't earn points.

const VERIFY_BATCH = 25;   // the edge function's per-request limit

// Only http(s) links are ever rendered as clickable.
function safeHref(url) {
    return /^https?:\/\//i.test(url || '') ? url : '';
}

// Asks the server whether each URL is a real posting. Resolves to
// [{ url, status, reason }] in order (status: ok | unverifiable | dead | invalid).
// Throws if the check itself couldn't run (offline, signed out, function down).
async function verifyLinks(urls, onProgress) {
    const results = [];
    for (let i = 0; i < urls.length; i += VERIFY_BATCH) {
        const { data, error } = await client.functions.invoke('verify-link', {
            body: { urls: urls.slice(i, i + VERIFY_BATCH) },
        });
        if (error || !Array.isArray(data?.results)) throw new Error(error?.message || 'Link check failed');
        results.push(...data.results);
        if (onProgress) onProgress(results.length, urls.length);
    }
    return results;
}

// 'unverifiable' (the site blocks automated checks) is allowed through.
const linkBlocked = r => r.status === 'dead' || r.status === 'invalid';

// Link rules for an application (null = a new one):
//  - from our listings: fixed (the DB always uses the listing's own URL)
//  - imported without a link: optional (adding one makes it count)
//  - everything else, including new apps: required
function linkRules(app) {
    const fromListing = !!app?.listingId;
    return { fromListing, optional: !!app && !app.url && !fromListing };
}

// ── MODAL ───────────────────────────────────────────────────────────────────

// Modal input id → application field.
const MODAL_FIELDS = [
    ['m_position', 'position'], ['m_company', 'company'], ['m_location', 'location'],
    ['m_pay', 'pay'], ['m_date', 'date_applied'], ['m_status', 'status'],
    ['m_notes', 'notes'], ['m_folder', 'cycle'],
];

function setupLinkField(app) {
    const input = document.getElementById('m_url');
    const hint = document.getElementById('m_url_hint');
    const { fromListing, optional } = linkRules(app);

    input.value = app?.url || '';
    input.readOnly = fromListing;
    document.getElementById('m_url_required').hidden = optional || fromListing;
    hint.textContent = fromListing
        ? 'Added from a SimplyIntern listing, so the link is already verified.'
        : optional
            ? 'Optional for imported apps. Add the posting link to count this one on the leaderboard.'
            : 'We check that the posting exists. Only apps with a real link count on the leaderboard.';
}

function openModal(app = null) {
    editingApp = app;
    document.getElementById('modal_title').textContent = app ? 'Edit Application' : 'Add Application';
    populateFolderSelects(); // keep the folder picker fresh

    const values = app
        ? { ...app, cycle: app.cycle || CURRENT_CYCLE }
        : { status: 'Pending', cycle: cycleForNewApp() };
    for (const [id, field] of MODAL_FIELDS) document.getElementById(id).value = values[field] || '';
    setupLinkField(app);

    document.getElementById('modal_overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal_overlay').style.display = 'none';
    editingApp = null;
}

// Row buttons are bound via delegation (rows are re-rendered, so we listen on the
// stable tbody instead of using inline onclick — required for a strict CSP).
document.getElementById('app_tbody').addEventListener('click', e => {
    const btn = e.target.closest('.row_edit, .row_delete, .row_reset');
    if (!btn) return;
    const app = getVisibleApps()[Number(btn.dataset.index)];   // data-index is into this list
    if (btn.classList.contains('row_edit')) openModal(app);
    else if (btn.classList.contains('row_delete')) deleteApp(app);
    else resetApp(app);
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

// Shows `label` on the disabled Save button while `work` runs.
async function withSaveButton(label, work) {
    const saveBtn = document.getElementById('modal_save');
    saveBtn.disabled = true;
    saveBtn.textContent = label;
    try {
        return await work();
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
    }
}

// The link to save for the app in the modal, checked first when it's new or changed.
// Returns null (after telling the user why) when the save should stop.
async function linkToSave() {
    const urlInput = document.getElementById('m_url');
    const { fromListing, optional } = linkRules(editingApp);
    const url = fromListing ? editingApp.url : normalizeUrlInput(urlInput.value);

    if (!url && !optional) {
        await showAlert('Paste the link to the job posting. It’s required so the leaderboard only counts real applications.', 'Listing link required');
        urlInput.focus();
        return null;
    }

    // Only check new or changed links: a posting that closed after you applied
    // shouldn't stop you from updating its status.
    if (url && !fromListing && url !== (editingApp?.url || '')) {
        let result;
        try {
            [result] = await withSaveButton('Checking link…', () => verifyLinks([url]));
        } catch (_) {
            await showAlert('We couldn’t check the link right now. Check your connection and try again.', 'Link check failed');
            return null;
        }
        if (linkBlocked(result)) {
            await showAlert(result.reason, 'That link didn’t check out');
            urlInput.focus();
            return null;
        }
    }
    return url || '';
}

document.getElementById('modal_save').addEventListener('click', async () => {
    const position = document.getElementById('m_position').value.trim();
    const company = document.getElementById('m_company').value.trim();

    if (!position || !company) {
        await showAlert('Position and Company are required.', 'Add application');
        return;
    }

    const url = await linkToSave();
    if (url === null) return;

    const fields = {
        url,
        position,
        company,
        location: document.getElementById('m_location').value.trim(),
        pay: document.getElementById('m_pay').value.trim(),
        date_applied: document.getElementById('m_date').value,
        status: document.getElementById('m_status').value,
        notes: document.getElementById('m_notes').value.trim(),
        cycle: document.getElementById('m_folder').value,
    };

    // Save a copy first. If the save fails, the table stays as it was and the modal
    // stays open, so nothing typed is lost and Save can simply be clicked again.
    const entry = editingApp
        ? { ...editingApp, ...fields }
        : { ...fields, reached_interview: false };

    // The new status updates the interview milestone (reaching an interview sets it;
    // Pending clears it); a later accept/reject leaves it intact.
    applyInterviewMilestone(entry);

    if (!(await withSaveButton('Saving…', () => saveApplication(entry)))) return;

    // Edits update the existing object, so its place in the list is kept.
    if (editingApp) Object.assign(editingApp, entry);
    else applications.push(entry);
    storeApplications();

    // If the app was moved into a different folder than the one being viewed, keep the
    // current view selected (it'll simply drop out of this folder's list).
    renderTable();
    closeModal();
});

// ── IMPORT ───────────────────────────────────────────────────────────────────
// The file parser (parseImport) lives in tracker-csv.js so it can be unit-tested.

// Holds the text of the uploaded file (import is file-only — no paste box).
let importFileText = '';

function openImportModal() {
    importFileText = '';
    document.getElementById('import_file').value = '';
    renderImportPreview();   // with no file: empty preview, buttons reset
    document.getElementById('import_overlay').style.display = 'flex';
}

function closeImportModal() {
    document.getElementById('import_overlay').style.display = 'none';
}

// Live preview: count of importable rows + a small sample. Rows with links import
// through the main button; if any lack a link, a separate "without links" button
// appears with a note that those won't count on the leaderboard.
function renderImportPreview() {
    const preview = document.getElementById('import_preview');
    const notice = document.getElementById('import_notice');
    const confirmBtn = document.getElementById('import_confirm');
    const noLinksBtn = document.getElementById('import_nolinks');

    if (!importFileText.trim()) {
        preview.textContent = '';
        notice.hidden = true;
        noLinksBtn.hidden = true;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Import';
        return;
    }

    const parsed = parseImport(importFileText);
    const n = parsed.entries.length;
    const linked = parsed.entries.filter(e => e.url).length;
    const unlinked = n - linked;

    confirmBtn.disabled = linked === 0;
    confirmBtn.textContent = unlinked === 0 ? 'Import' : `Import ${linked} with links`;
    noLinksBtn.hidden = unlinked === 0;
    noLinksBtn.textContent = linked === 0 ? 'Import without links' : `Import all ${n}`;
    notice.hidden = unlinked === 0;
    notice.textContent = unlinked === 0 ? '' :
        `${linked === 0 ? 'None of these have' : `${unlinked} of these ${unlinked === 1 ? 'doesn’t have' : 'don’t have'}`} a listing link. ` +
        'You can still import them. They’ll show as “Imported” in your tracker, but they won’t count on the leaderboard unless you add a link.';

    let msg = `${plural(n, 'application')} ready to import into “${cycleForNewApp()}”`;
    if (parsed.headerDetected) msg += ' · header detected';
    if (parsed.skipped) msg += ` · ${parsed.skipped} skipped (missing position/company)`;
    if (n > 0) {
        msg += `\n${linked} with link${linked === 1 ? '' : 's'} · ${unlinked} without`;
        const sample = parsed.entries.slice(0, 3)
            .map(e => `• ${e.position} — ${e.company}${e.status !== 'Pending' ? ' (' + e.status + ')' : ''}`)
            .join('\n');
        msg += '\n' + sample + (n > 3 ? `\n…and ${n - 3} more` : '');
    }
    preview.textContent = msg;
}

// Checks each distinct link among the entries (showing progress in the preview) and
// splits them into the ones to import and the ones whose link didn't check out.
// Throws if the check itself couldn't run.
async function checkImportLinks(entries) {
    const uniqueUrls = [...new Set(entries.filter(e => e.url).map(e => e.url))];
    if (uniqueUrls.length === 0) return { kept: entries, badLinks: [] };

    const preview = document.getElementById('import_preview');
    preview.textContent = `Checking links… 0 / ${uniqueUrls.length}`;
    const results = await verifyLinks(uniqueUrls, (done, total) => {
        preview.textContent = `Checking links… ${done} / ${total}`;
    });

    const verdict = new Map(results.map((r, i) => [uniqueUrls[i], r]));
    const kept = [], badLinks = [];
    for (const e of entries) {
        const r = e.url && verdict.get(e.url);
        if (r && linkBlocked(r)) badLinks.push({ entry: e, reason: r.reason });
        else kept.push(e);
    }
    return { kept, badLinks };
}

// Imports the parsed rows. includeUnlinked=false imports only rows with a link;
// true also brings in rows without one (tagged "Imported", don't score). Every link
// is checked first, and rows whose link doesn't exist are left out and reported.
async function doImport(includeUnlinked) {
    const parsed = parseImport(importFileText);
    let entries = includeUnlinked ? parsed.entries : parsed.entries.filter(e => e.url);
    if (entries.length === 0) return;

    const preview = document.getElementById('import_preview');
    const buttons = ['import_confirm', 'import_nolinks', 'import_cancel'].map(id => document.getElementById(id));
    const setButtonsDisabled = disabled => buttons.forEach(b => { b.disabled = disabled; });

    setButtonsDisabled(true);
    let badLinks;
    try {
        ({ kept: entries, badLinks } = await checkImportLinks(entries));
    } catch (_) {
        setButtonsDisabled(false);
        renderImportPreview();
        await showAlert('We couldn’t check the links right now. Check your connection and try again.', 'Link check failed');
        return;
    }
    setButtonsDisabled(false);

    const skippedNote = badLinks.length
        ? `\n\nLeft out ${plural(badLinks.length, 'row')} whose link didn’t check out:\n` +
          badLinks.slice(0, 5).map(b => `• ${b.entry.position} — ${b.entry.company}: ${b.reason}`).join('\n') +
          (badLinks.length > 5 ? `\n…and ${badLinks.length - 5} more` : '') +
          '\nFix those links in your sheet and import them again.'
        : '';

    if (entries.length === 0) {
        renderImportPreview();
        await showAlert('Nothing was imported.' + skippedNote, 'Import');
        return;
    }

    // Imported rows land in the folder currently being viewed.
    const importCycle = cycleForNewApp();
    entries.forEach(e => { e.cycle = importCycle; });
    preview.textContent = `Importing ${entries.length}…`;

    const user = await signedInUser();
    if (user) {
        const payload = entries.map(e => toApplicationRow(e, user.id));
        // One insert, so it's all or nothing. On failure, keep the modal open with
        // the file still loaded so Import can be clicked again. (Keeping the rows
        // only in this browser would lose them on the next load from the cloud.)
        const { error } = await client.from('applications').insert(payload);
        if (error) {
            renderImportPreview();
            showSyncError('Couldn’t import your applications, so nothing was added. Try again.', error);
            return;
        }
    }

    closeImportModal();

    if (user) {
        // Reload from the cloud so the imported rows come back with their real ids.
        await loadApplications();
    } else {
        // Logged out — keep them in this browser only (no ids).
        applications = entries.concat(applications);
        storeApplications();
        renderTable();
    }

    const noLink = entries.filter(e => !e.url).length;
    await showAlert(
        `Imported ${plural(entries.length, 'application')}.` +
        (noLink ? ` ${noLink} without a link ${noLink === 1 ? 'is' : 'are'} marked “Imported” and won’t count on the leaderboard.` : '') +
        (parsed.skipped ? ` ${plural(parsed.skipped, 'row')} skipped (missing position or company).` : '') +
        skippedNote,
        'Import complete'
    );
}

document.getElementById('import_btn').addEventListener('click', openImportModal);
document.getElementById('import_close').addEventListener('click', closeImportModal);
document.getElementById('import_cancel').addEventListener('click', closeImportModal);
document.getElementById('import_overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('import_overlay')) closeImportModal();
});
document.getElementById('import_confirm').addEventListener('click', () => doImport(false));
document.getElementById('import_nolinks').addEventListener('click', () => doImport(true));

// File picker loads the file's text, then previews it.
document.getElementById('import_file').addEventListener('change', e => {
    const file = e.target.files?.[0];
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

// ── EXPORT ───────────────────────────────────────────────────────────────────

// Downloads the applications in the folder being viewed as a CSV file
// (simplyintern-2027-summer-2026-10-06.csv). The format is in tracker-csv.js.
async function exportApplications() {
    const apps = getVisibleApps();
    if (apps.length === 0) {
        await showAlert('There are no applications in this folder to export.', 'Export');
        return;
    }
    const folder = activeFolder === ALL_FOLDERS ? 'all-folders' : activeFolder;
    const slug = folder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // The \uFEFF marker tells Excel the file is UTF-8, so accents and emoji survive.
    const blob = new Blob(['\uFEFF' + applicationsToCsv(apps)], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `simplyintern-${slug || 'export'}-${todayLocal()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

document.getElementById('export_btn').addEventListener('click', exportApplications);

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
