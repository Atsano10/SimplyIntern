document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }
    const user = session.user;

    const { data: profile } = await client
        .from('profiles')
        .select('username, email')
        .eq('id', user.id)
        .single();

    if (profile) {
        document.getElementById('s_email').value = profile.email || user.email;
        document.getElementById('s_username').value = profile.username || '';
    }

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

    document.getElementById('delete_account_btn').addEventListener('click', async () => {
        const confirmed = confirm('Are you sure you want to delete your account? This cannot be undone.');
        if (!confirmed) return;

        await client.from('applications').delete().eq('user_id', user.id);
        await client.from('profiles').delete().eq('id', user.id);
        await client.auth.signOut();
        window.location.href = 'index.html';
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
