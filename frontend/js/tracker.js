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

            if (!error && data) {
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
                // Keep localStorage in sync as cache
                localStorage.setItem('si_applications', JSON.stringify(applications));
                renderTable();
                return;
            }
        }
    } catch (_) {}

    // Fallback: load from localStorage (not logged in or table doesn't exist yet)
    applications = JSON.parse(localStorage.getItem('si_applications') || '[]');
    renderTable();
}

// ── SAVE ────────────────────────────────────────────────────────────────────

async function saveApplication(entry) {
    try {
        const { data: { user } } = await client.auth.getUser();
        if (user) {
            if (entry.id) {
                // Update existing row
                await client
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
            } else {
                // Insert new row and get back the UUID
                const { data } = await client
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
                if (data) entry.id = data.id;
            }
        }
    } catch (_) {}

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
