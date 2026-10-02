let applications = [];
let editingId = null; // Supabase UUID or localStorage index

// Funnel stage rank per status (see migration 011). Rejected carries no rank — it's
// an outcome, not a stage — so a rejection never lowers an application's high-water mark.
const STAGE_RANK = {
    'Pending': 0, 'Applied': 0,
    '1st Round Interview': 1, 'Interview': 1,
    '2nd Round Interview': 2,
    'Accepted': 3,
    'Rejected': 0,
};
const rankOf = status => STAGE_RANK[status] ?? 0;

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
                        max_stage: row.max_stage ?? 0,
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
                max_stage: app.max_stage ?? rankOf(app.status),
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
                        max_stage: entry.max_stage ?? rankOf(entry.status),
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
                        max_stage: entry.max_stage ?? rankOf(entry.status),
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

// Builds the funnel (Applied → Interviewed → Offers) and the conversion rates from
// the in-memory applications array. Counts come from each application's max_stage
// high-water mark (migration 011), so a later rejection no longer erases the fact
// that an application reached an interview or offer. All values are derived, so the
// markup is built from numbers/static labels only (no user input to escape).
function renderInsights() {
    const total = applications.length;

    const sub = document.getElementById('insights_sub');
    const funnelEl = document.getElementById('funnel');
    const ratesEl  = document.getElementById('rates_row');

    if (total === 0) {
        sub.textContent = '';
        funnelEl.innerHTML = '<div class="insights_empty">Track a few applications to see your funnel and conversion rates here.</div>';
        ratesEl.innerHTML = '';
        return;
    }

    const stage = a => a.max_stage || 0;
    const reachedInterview = applications.filter(a => stage(a) >= 1).length;
    const offers           = applications.filter(a => stage(a) >= 3).length;
    // Heard back = reached an interview at some point OR got an explicit rejection.
    const responded        = applications.filter(a => stage(a) >= 1 || a.status === 'Rejected').length;

    sub.textContent = `across ${total} application${total === 1 ? '' : 's'}`;

    const pct = (n, d = total) => d ? Math.round((n / d) * 100) : 0;

    // Funnel stages: bar width is relative to total so the three bars read as a funnel.
    const stages = [
        { label: 'Applied',     count: total,            cls: 'applied' },
        { label: 'Interviewed', count: reachedInterview, cls: 'interviewed' },
        { label: 'Offers',      count: offers,           cls: 'offers' },
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

    // Conversion rates: response rate, Applied→Interview, and Interview→Offer
    // (the last is relative to interviews, not total — a true stage conversion).
    const rates = [
        { pct: pct(responded),                       label: 'Response rate',     hint: 'heard back (interview or rejection)' },
        { pct: pct(reachedInterview),                label: 'Applied → Interview', hint: 'share of applications that reached an interview' },
        { pct: pct(offers, reachedInterview),        label: 'Interview → Offer',  hint: 'share of interviews that became offers' },
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
    const editBtn = e.target.closest('.row_edit');
    const delBtn  = e.target.closest('.row_delete');
    if (editBtn) openModal(Number(editBtn.dataset.index));
    else if (delBtn) deleteApp(Number(delBtn.dataset.index));
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

    // High-water mark: never below what this application previously reached.
    const priorMax = editingId !== null ? (applications[editingId].max_stage || 0) : 0;
    entry.max_stage = Math.max(priorMax, rankOf(entry.status));

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

// ── INIT ─────────────────────────────────────────────────────────────────────

loadApplications();

// Re-sync from Supabase if browser restores this page from bfcache
window.addEventListener('pageshow', (e) => {
    if (e.persisted) loadApplications();
});
