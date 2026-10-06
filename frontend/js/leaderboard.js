async function refreshAll() {
    const cycleEl = document.getElementById('lb_cycle');
    if (cycleEl) cycleEl.textContent = CURRENT_CYCLE;
    // Make sure the signed-in user has a profile before building the board, so a
    // newly-created profile appears right away instead of after a manual refresh.
    if (typeof ensureProfile === 'function') await ensureProfile();
    await loadLeaderboard();
    await loadYourStanding();
}

document.addEventListener('DOMContentLoaded', refreshAll);

// Re-fetch when browser restores this page from bfcache so stats stay current
window.addEventListener('pageshow', (e) => {
    if (e.persisted) refreshAll();
});

async function loadLeaderboard() {
    // The top 50 scorers, ranked by the database (leaderboard_top, migration 023).
    // It exposes ONLY username + counts (never emails or notes), and the raw
    // profiles/applications tables are locked to per-user access.
    const { data: ranked, error } = await client
        .from('leaderboard_top')
        .select('rank, username, rejected, pending, score')
        .order('rank', { ascending: true });

    if (error || !ranked) {
        showTableError();
        return;
    }

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

// Must match the cap in the leaderboard_top view (migration 023).
const LEADERBOARD_SIZE = 50;

function renderTable(ranked) {
    const tbody = document.getElementById('lb_tbody');

    if (ranked.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="table_loading">No one on the board yet.</div></td></tr>`;
        return;
    }

    const rows = ranked.map(user => `
        <tr class="rank_row">
            <td class="col_rank">
                <span class="rank_num ${user.rank <= 3 ? 'top3' : ''}">${user.rank}</span>
            </td>
            <td class="username_cell">
                <span class="lb_avatar">${esc(user.username[0].toUpperCase())}</span>
                ${esc(user.username)}
            </td>
            <td class="col_stat"><span class="stat_rejected">${user.rejected}</span></td>
            <td class="col_stat"><span class="stat_pending">${user.pending}</span></td>
            <td class="col_score"><strong>${user.score}</strong></td>
        </tr>
    `).join('');

    // The view stops at 50, so a full page means there may be more people below.
    const more = ranked.length >= LEADERBOARD_SIZE
        ? `<tr><td colspan="5" class="lb_more">Showing the top ${LEADERBOARD_SIZE} · your rank is below</td></tr>`
        : '';
    tbody.innerHTML = rows + more;
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
            .select('username, leaderboard_opt_out')
            .eq('id', user.id)
            .single();

        if (profile) {
            document.getElementById('your_username').textContent = '@' + profile.username;
        }

        // Scored by the database with the same rules as the board (current cycle,
        // verified links only, each listing once, interviews count as pending),
        // so this can't drift from what everyone else sees.
        const { data, error } = await client.rpc('my_leaderboard_score');
        if (error || !data || !data[0]) return;
        const { rejected, pending, score, rank } = data[0];

        document.getElementById('your_score').textContent = score;
        // rank is null when you have 0 points or have opted out of the board.
        document.getElementById('your_rank').textContent = rank ? '#' + rank : '#—';

        let sub;
        if (profile?.leaderboard_opt_out) sub = 'You’re hidden from the board. Change this in Settings.';
        else if (score === 0)            sub = 'Track applications with a listing link to appear on the board.';
        else                             sub = `${rejected} rejected · ${pending} pending — keep grinding`;
        document.querySelector('.standing_sub').textContent = sub;
    } catch (_) {}
}
