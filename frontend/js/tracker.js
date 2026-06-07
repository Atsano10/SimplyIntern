let applications = [];
let editingId = null; // Supabase UUID or localStorage index

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
                    }));
                    localStorage.setItem('si_applications', JSON.stringify(applications));
                    renderTable();
                    return;
                }

                // Cloud returned empty — don't wipe localStorage.
                // If local apps exist (unsaved from a previous session), keep them and try to push them up.
                const local = JSON.parse(localStorage.getItem('si_applications') || '[]');
                if (local.length > 0) {
                    applications = local;
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
    banner.innerHTML = `
        <span>${msg}</span>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;font-size:16px;color:inherit;flex-shrink:0;">✕</button>
    `;
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

    tbody.innerHTML = applications.map((app, i) => `
        <tr>
            <td>${app.position}</td>
            <td>${app.company}</td>
            <td>${app.location || '—'}</td>
            <td>${app.pay || '—'}</td>
            <td>${formatDate(app.date_applied)}</td>
            <td><span class="status_badge ${app.status}">${app.status}</span></td>
            <td>${app.notes || '—'}</td>
            <td class="row_actions">
                <button class="row_edit" onclick="openModal(${i})" title="Edit">&#9998;</button>
                <button class="row_delete" onclick="deleteApp(${i})" title="Remove">&#10005;</button>
            </td>
        </tr>
    `).join('');

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
        applications.filter(a => ['Pending', 'Applied', 'Interview'].includes(a.status)).length;
    document.getElementById('stat_rejected').textContent =
        applications.filter(a => a.status === 'Rejected').length;
    document.getElementById('stat_accepted').textContent =
        applications.filter(a => a.status === 'Accepted').length;
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
        alert('Position and Company are required.');
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
