// Self-contained on purpose: we create our own client here and deliberately do
// NOT load auth.js, whose checkSession() would redirect the recovery session
// away to the search page before the user can set a new password.
const { createClient } = supabase
const client = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)

const statusEl = document.getElementById('reset_status')
const setStatus = (msg) => { statusEl.textContent = msg }

// When this page loads from the email link, supabase-js reads the recovery
// token from the URL and establishes a temporary session automatically.
document.getElementById('reset_btn').addEventListener('click', async () => {
    const pw        = document.getElementById('new_password').value
    const confirmPw = document.getElementById('con_password').value

    if (!pw || pw.length < 6) return setStatus('Password must be at least 6 characters.')
    if (pw !== confirmPw)     return setStatus('Passwords do not match.')

    const { error } = await client.auth.updateUser({ password: pw })

    if (error) {
        setStatus(/session/i.test(error.message)
            ? 'This reset link is invalid or has expired. Request a new one from the login page.'
            : error.message)
        return
    }

    setStatus('Password updated! Redirecting to log in…')
    await client.auth.signOut()
    setTimeout(() => { window.location.href = 'index.html' }, 1500)
})
