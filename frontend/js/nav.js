document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('beforeend', `
        <div id="nav_overlay"></div>
        <div id="nav_drawer">
            <div class="drawer_header">
                <div class="drawer_user_info">
                    <div class="drawer_username" id="drawer_username">Loading...</div>
                    <div class="drawer_label">Signed in</div>
                </div>
                <button id="nav_close">&#10005;</button>
            </div>
            <div class="drawer_body">
                <a href="search.html" class="drawer_link">Search</a>
                <a href="leaderboard.html" class="drawer_link">Leaderboard</a>
                <a href="tracker.html" class="drawer_link">Tracker</a>
                <div class="drawer_divider"></div>
                <a href="settings.html" class="drawer_link">Settings</a>
            </div>
            <div class="drawer_footer">
                <button class="drawer_logout_btn" id="drawer_logout">Log Out</button>
            </div>
        </div>
    `);

    document.querySelector('.additional').addEventListener('click', openDrawer);
    document.getElementById('nav_close').addEventListener('click', closeDrawer);
    document.getElementById('nav_overlay').addEventListener('click', closeDrawer);
    document.getElementById('drawer_logout').addEventListener('click', () => logOut());

    // Mark active nav link
    const path = window.location.pathname;
    document.querySelectorAll('.nav_section').forEach(section => {
        const href = section.querySelector('a')?.getAttribute('href') || '';
        if (href && path.includes(href.replace('.html', ''))) {
            section.classList.add('active');
        }
    });

    loadDrawerUser();
});

function openDrawer() {
    document.getElementById('nav_overlay').classList.add('open');
    document.getElementById('nav_drawer').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeDrawer() {
    document.getElementById('nav_overlay').classList.remove('open');
    document.getElementById('nav_drawer').classList.remove('open');
    document.body.style.overflow = '';
}

async function loadDrawerUser() {
    try {
        const { data: { user } } = await client.auth.getUser();
        if (!user) return;
        const { data: profile } = await client
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single();
        if (profile) {
            document.getElementById('drawer_username').textContent = '@' + profile.username;
        }
    } catch (_) {}
}
