document.addEventListener('DOMContentLoaded', async () => {
    await loadLeaderboard();
    await loadYourStanding();
});

async function loadLeaderboard() {
    // 1. Fetch every registered user
    const { data: profiles, error: profileError } = await client
        .from('profiles')
        .select('id, username, leaderboard_opt_out');

    if (profileError || !profiles) {
        showTableError();
        return;
    }

    // 2. Fetch all applications that count toward grind score
    const { data: apps } = await client
        .from('applications')
        .select('user_id, status')
        .in('status', ['Rejected', 'Pending', 'Applied', 'Interview']);

    // 3. Build ranked list — exclude opted-out users
    const ranked = profiles.filter(p => !p.leaderboard_opt_out).map(profile => {
        const userApps = apps ? apps.filter(a => a.user_id === profile.id) : [];
        const rejected = userApps.filter(a => a.status === 'Rejected').length;
        const pending  = userApps.filter(a => ['Pending', 'Applied', 'Interview'].includes(a.status)).length;
        return { username: profile.username, rejected, pending, score: rejected + pending };
    }).sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));

    renderPodium(ranked);
    renderTable(ranked);
}

function renderPodium(ranked) {
    if (ranked.length < 1) return;

    // Only show podium when there are users
    document.getElementById('podium_section').style.display = 'flex';

    const slots = [
        { suffix: '1', rank: 0 },
        { suffix: '2', rank: 1 },
        { suffix: '3', rank: 2 },
    ];

    slots.forEach(({ suffix, rank }) => {
        const user = ranked[rank];
        const card = document.getElementById(`rank_${suffix}`);
        if (!card) return;

        if (!user) {
            card.style.visibility = 'hidden';
            return;
        }

        document.getElementById(`p${suffix}_avatar`).textContent    = user.username[0].toUpperCase();
        document.getElementById(`p${suffix}_username`).textContent   = user.username;
        document.getElementById(`p${suffix}_score`).textContent      = user.score + ' pts';
        document.getElementById(`p${suffix}_breakdown`).textContent  =
            `${user.rejected} rejected · ${user.pending} pending`;
    });
}

function renderTable(ranked) {
    const tbody = document.getElementById('lb_tbody');

    if (ranked.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="table_loading">No users yet.</div></td></tr>`;
        return;
    }

    tbody.innerHTML = ranked.map((user, i) => `
        <tr class="rank_row">
            <td class="col_rank">
                <span class="rank_num ${i < 3 ? 'top3' : ''}">${i + 1}</span>
            </td>
            <td class="username_cell">
                <span class="lb_avatar">${user.username[0].toUpperCase()}</span>
                ${user.username}
            </td>
            <td class="col_stat"><span class="stat_rejected">${user.rejected}</span></td>
            <td class="col_stat"><span class="stat_pending">${user.pending}</span></td>
            <td class="col_score"><strong>${user.score}</strong></td>
        </tr>
    `).join('');
}

function showTableError() {
    document.getElementById('lb_tbody').innerHTML =
        `<tr><td colspan="5"><div class="table_loading">Could not load data.</div></td></tr>`;
}

async function loadYourStanding() {
    try {
        const { data: { user } } = await client.auth.getUser();
        if (!user) return;

        const { data: profile } = await client
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single();

        if (profile) {
            document.getElementById('your_username').textContent = '@' + profile.username;
        }

        const { data: apps } = await client
            .from('applications')
            .select('status')
            .eq('user_id', user.id);

        const rejected = (apps || []).filter(a => a.status === 'Rejected').length;
        const pending  = (apps || []).filter(a => ['Pending', 'Applied', 'Interview'].includes(a.status)).length;
        const score    = rejected + pending;

        document.getElementById('your_score').textContent = score;

        document.querySelector('.standing_sub').textContent = score === 0
            ? 'Start tracking applications to appear on the board.'
            : `${rejected} rejected · ${pending} pending — keep grinding`;
    } catch (_) {}
}
