document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }
    const user = session.user;

    const { data: profile } = await client
        .from('profiles')
        .select('username, email, leaderboard_opt_out')
        .eq('id', user.id)
        .single();

    if (profile) {
        document.getElementById('s_email').value = profile.email || user.email;
        document.getElementById('s_username').value = profile.username || '';
    }

    // ── Dark Mode ──
    const darkToggle = document.getElementById('dark_mode_toggle');
    darkToggle.checked = localStorage.getItem('darkMode') === 'true';
    darkToggle.addEventListener('change', () => {
        const isDark = darkToggle.checked;
        localStorage.setItem('darkMode', String(isDark));
        document.body.classList.toggle('dark', isDark);
    });

    // ── Leaderboard Opt-Out ──
    const lbToggle = document.getElementById('leaderboard_opt_out_toggle');
    lbToggle.checked = profile?.leaderboard_opt_out || false;
    lbToggle.addEventListener('change', async () => {
        const { error } = await client
            .from('profiles')
            .update({ leaderboard_opt_out: lbToggle.checked })
            .eq('id', user.id);
        if (error) {
            lbToggle.checked = !lbToggle.checked;
            alert('Failed to save leaderboard setting: ' + error.message);
        }
    });

    // ── Username ──
    document.getElementById('save_username_btn').addEventListener('click', async () => {
        const newUsername = document.getElementById('s_username').value.trim();
        if (!newUsername) return showStatus('username_status', 'Username cannot be empty.', false);

        const { data: existing } = await client
            .from('profiles')
            .select('id')
            .eq('username', newUsername)
            .neq('id', user.id)
            .maybeSingle();

        if (existing) return showStatus('username_status', 'Username already taken.', false);

        const { error } = await client
            .from('profiles')
            .update({ username: newUsername })
            .eq('id', user.id);

        if (error) return showStatus('username_status', 'Failed to update username.', false);
        showStatus('username_status', 'Username updated!', true);
    });

    // ── Password ──
    document.getElementById('save_password_btn').addEventListener('click', async () => {
        const newPass = document.getElementById('s_new_password').value;
        const confirmPass = document.getElementById('s_confirm_password').value;

        if (!newPass) return showStatus('password_status', 'Please enter a new password.', false);
        if (newPass.length < 6) return showStatus('password_status', 'Password must be at least 6 characters.', false);
        if (newPass !== confirmPass) return showStatus('password_status', 'Passwords do not match.', false);

        const { error } = await client.auth.updateUser({ password: newPass });
        if (error) return showStatus('password_status', error.message, false);

        document.getElementById('s_new_password').value = '';
        document.getElementById('s_confirm_password').value = '';
        showStatus('password_status', 'Password updated!', true);
    });

    // ── Delete Account ──
    document.getElementById('delete_account_btn').addEventListener('click', async () => {
        const confirmed = confirm('Are you sure you want to delete your account? This cannot be undone.');
        if (!confirmed) return;

        const btn = document.getElementById('delete_account_btn');
        btn.disabled = true;
        btn.textContent = 'Deleting…';

        try {
            const { error: appErr } = await client.from('applications').delete().eq('user_id', user.id);
            if (appErr) throw appErr;

            const { error: profileErr } = await client.from('profiles').delete().eq('id', user.id);
            if (profileErr) throw profileErr;

            // Deletes the auth user — requires the delete_user() function in Supabase (see README)
            await client.rpc('delete_user');

            window.location.href = 'index.html';
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Delete Account';
            alert('Could not delete account: ' + (err.message || 'Unknown error'));
        }
    });
});

function showStatus(id, message, success) {
    const el = document.getElementById(id);
    el.textContent = message;
    el.className = 'settings_status ' + (success ? 'success' : 'error');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.textContent = '';
        el.className = 'settings_status';
    }, 3000);
}
