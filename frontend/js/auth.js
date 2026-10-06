const SUPABASE_URL = window.SUPABASE_URL
const SUPABASE_KEY = window.SUPABASE_ANON_KEY

const { createClient } = supabase
const client = createClient(SUPABASE_URL, SUPABASE_KEY)

async function signUp() {
    // Take user input
    const email = document.getElementById('email').value.trim()
    const username = document.getElementById('username').value.trim()
    const password = document.getElementById('password').value
    const confirmPassword = document.getElementById("con_password").value

    if (!email || !username || !password) {
        await showAlert('Please fill in your email, username, and password.', 'Sign up')
        return
    }
    if (!USERNAME_PATTERN.test(username)) {
        await showAlert(USERNAME_RULE, 'Sign up')
        return
    }
    if (confirmPassword !== password) {
        await showAlert('Passwords do not match!', 'Sign up')
        return
    }

    // Pre-check the username. If email confirmation is enabled, profile creation is
    // deferred until the user confirms (see below), so we can't rely on the insert to
    // surface a duplicate at signup time. username_exists is a safe anon-callable RPC.
    const { data: taken } = await client.rpc('username_exists', { p_username: username })
    if (taken) {
        await showAlert('Username already taken!', 'Sign up')
        return
    }

    // Create the auth account. The chosen username rides along in user_metadata so the
    // profile can be created after confirmation even on a different device, and the
    // confirmation link returns the user to the login page.
    const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
            data: { username },
            emailRedirectTo: window.location.origin + '/index.html',
        },
    })

    if (error) {
        await showAlert(error.message, 'Sign up failed')
        return
    }

    // Supabase obfuscates re-signups of an already-registered email: it returns a user
    // with an empty identities array and no error. Treat that as "already exists".
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        await showAlert('An account with this email already exists. Try logging in instead.', 'Sign up')
        return
    }

    // No session => email confirmation is required. We CANNOT create the profile yet
    // (RLS needs auth.uid()), so defer it to first sign-in and prompt verification.
    if (!data.session) {
        localStorage.setItem('si_pending_username', username)
        localStorage.setItem('si_pending_email', email)
        showVerifyNotice()
        await showAlert(`We sent a verification link to ${email}. Click it to activate your account, then log in.`, 'Verify your email')
        return
    }

    // Confirmation disabled: we have a session, so create the profile now.
    const { error: insertError } = await client.from('profiles').insert({
        id: data.user.id,
        username,
        email,
    })

    if (insertError) {
        await client.auth.signOut()

        // 23505 = Postgres unique_violation. Decide which field clashed by the
        // constraint NAME (reliable), not by loose words in the message text.
        if (insertError.code === '23505') {
            if (insertError.message.includes('profiles_username_key')) {
                await showAlert('Username already taken!', 'Sign up')
            } else if (insertError.message.includes('profiles_email_key')) {
                await showAlert('An account with this email already exists!', 'Sign up')
            } else {
                await showAlert('That username or email is already taken.', 'Sign up')
            }
        } else {
            await showAlert('Profile save failed: ' + insertError.message, 'Sign up failed')
        }
        return
    }

    await showAlert('Account created successfully!', 'Welcome to SimplyIntern')
    window.location.href = 'search.html'
}

// Reveals the "check your email" notice + resend link (present on login & signup pages).
function showVerifyNotice() {
    const notice = document.getElementById('verify_notice')
    if (notice) notice.style.display = 'block'
}

// Re-sends the signup confirmation email. Uses the email field or the stashed address.
async function resendVerification() {
    const emailField = document.getElementById('email')
    const email = (emailField && emailField.value.trim()) || localStorage.getItem('si_pending_email')
    if (!email) {
        await showAlert('Enter your email above first, then click “Resend email”.', 'Resend verification')
        return
    }
    const { error } = await client.auth.resend({ type: 'signup', email })
    if (error) {
        await showAlert(error.message, 'Resend verification')
        return
    }
    await showAlert('Verification email resent. Check your inbox (and spam).', 'Resend verification')
}

const resendLink = document.getElementById('resend_link')
if (resendLink) resendLink.addEventListener('click', (e) => { e.preventDefault(); resendVerification() })

async function logIn(){
    // Log in with email (username is a public display name, not a login key).
    const email = document.getElementById('email').value
    const password = document.getElementById('password').value

    if (!email || !password){
        await showAlert('Please enter your email and password!', 'Log in')
        return
    }

    const { data, error } = await client.auth.signInWithPassword({
        email: email,
        password: password
    })

    if (error) {
        // Supabase returns a specific error when the email hasn't been confirmed yet.
        if (/email not confirmed|not confirmed|confirm/i.test(error.message)) {
            localStorage.setItem('si_pending_email', email)
            showVerifyNotice()
            await showAlert('Your email isn’t verified yet. Check your inbox for the link, or resend it below.', 'Verify your email')
        } else {
            await showAlert('Incorrect email or password!', 'Log in failed')
        }
        return
    }

    // Defense in depth: never let an unverified account through, even if a session
    // was somehow issued (e.g. the account predates enabling email confirmation).
    if (data.user && !data.user.email_confirmed_at) {
        await client.auth.signOut()
        localStorage.setItem('si_pending_email', email)
        showVerifyNotice()
        await showAlert('Please verify your email before logging in. Check your inbox for the link, or resend it below.', 'Verify your email')
        return
    }

    window.location.href = 'search.html'
}

async function googleSignIn() {
    const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin + '/index.html'
        }
    })

    if (error){
        await showAlert(error.message, 'Google sign-in failed')
        return
    }
}

async function checkSession() {
    const { data: { session } } = await client.auth.getSession()
    if (session) {
        // Defense in depth: an unconfirmed session must not reach the app. This also
        // invalidates sessions created before email confirmation was enabled.
        if (!session.user.email_confirmed_at) {
            await client.auth.signOut()
            return
        }

        const { data: profile } = await client
            .from('profiles')
            .select('username')
            .eq('id', session.user.id)
            .maybeSingle()

        if (!profile) {
            // No profile yet — Google OAuth user or someone who just confirmed email.
            await createProfileFor(session)
        }
        window.location.href = 'search.html'
    }
}

// Creates the profile row for a session's user, choosing the username they picked at
// signup (user_metadata or local stash) and falling back to the email prefix, deduped
// against existing usernames. Returns true if a profile exists afterward.
// Every name tried goes through toValidUsername, so the database's format rule can't
// reject it (e.g. a 25-character email prefix, or a name picked before the rule).
async function createProfileFor(session) {
    const base = toValidUsername(session.user.user_metadata?.username
        || localStorage.getItem('si_pending_username')
        || session.user.email.split('@')[0])

    // Try a few username variants. We RETRY on the actual insert, not just the
    // availability check, so a race (name free at check time, taken at insert) still
    // resolves. Each 23505 is inspected by constraint name so we never silently
    // "succeed" on a conflict that left the user without a profile (the bug that hid
    // the leaderboard issue for so long).
    for (let attempt = 0; attempt < 6; attempt++) {
        const username = attempt === 0 ? base : toValidUsername(base, String(attempt))

        // Best-effort pre-check so we usually land on the first attempt.
        try {
            const { data: taken } = await client.rpc('username_exists', { p_username: username })
            if (taken) continue
        } catch (_) {}

        const { error } = await client.from('profiles').insert({
            id: session.user.id,
            username,
            email: session.user.email,
        })

        if (!error) {
            localStorage.removeItem('si_pending_username')
            localStorage.removeItem('si_pending_email')
            return true
        }

        if (error.code === '23505') {
            const msg = error.message || ''
            // A profile already exists for this user id → genuinely done.
            if (msg.includes('profiles_pkey')) {
                localStorage.removeItem('si_pending_username')
                localStorage.removeItem('si_pending_email')
                return true
            }
            // Username clash → try the next variant.
            if (msg.includes('profiles_username_key')) continue
            // Email clash (e.g. an orphan profile holds this email) — unresolvable
            // client-side. Surface it loudly instead of leaving the user profile-less.
            console.error('Profile creation blocked (email already in use by another profile):', msg)
            return false
        }

        console.error('Profile creation failed:', error.message)
        return false
    }

    console.error('Profile creation failed: no available username after several attempts')
    return false
}

// Ensures the signed-in user has a profile row WITHOUT redirecting. Runs on the app
// pages (which skip checkSession), so users who reached them directly — e.g. straight
// to the Tracker after confirming email — still get a profile and therefore show up on
// the leaderboard. Without this, such accounts have applications but no profile and are
// invisible to the (profile-driven) leaderboard.
async function ensureProfile() {
    try {
        const { data: { session } } = await client.auth.getSession()
        if (!session) return
        const { data: profile } = await client
            .from('profiles')
            .select('id')
            .eq('id', session.user.id)
            .maybeSingle()
        if (!profile) await createProfileFor(session)
    } catch (_) {}
}

// Kicks the user back to the login page with all per-account caches wiped. scope:'local'
// clears the stored session without calling the server, which matters when the account
// was deleted — a global sign-out would just fail against a user that no longer exists.
async function forceLogout() {
    localStorage.removeItem('si_applications')
    localStorage.removeItem('si_saved')
    try { await client.auth.signOut({ scope: 'local' }) } catch (_) {}
    window.location.replace('index.html')
}

// Server-side check that the session's account still exists. getSession() only reads
// the token from localStorage, and that token stays valid for up to an hour after the
// account is deleted — so a deleted user kept "working" on the cached data. getUser()
// asks Supabase Auth directly and errors once the user is gone. Returns true if the
// user may stay on the page.
async function verifyAccount() {
    const { data, error } = await client.auth.getUser()
    if (data?.user) return true
    // Network hiccup / Supabase down: don't log a real user out. The DB itself still
    // rejects a deleted user's requests (FK cascade, migration 017).
    if (error?.name === 'AuthRetryableFetchError') return true
    // No session, user deleted (403 user_not_found), or token revoked/invalid.
    await forceLogout()
    return false
}

// App pages are hidden until the account is verified so a deleted or logged-out user
// never sees a flash of cached tracker/saved data before the redirect.
// Pages that need a signed-in account (see the data-page check at the bottom).
const APP_PAGES = ['search', 'saved', 'leaderboard', 'tracker', 'settings']

async function requireAuth() {
    document.documentElement.style.visibility = 'hidden'
    const ok = await verifyAccount()
    if (!ok) return
    document.documentElement.style.visibility = ''

    // Re-check when the tab regains focus and every few minutes, so a user deleted
    // while the page is open gets logged out instead of carrying on.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') verifyAccount()
    })
    setInterval(verifyAccount, 5 * 60 * 1000)

    // Supabase fires SIGNED_OUT when a token refresh fails (e.g. the account was
    // deleted) or the user logs out in another tab.
    client.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT') forceLogout()
    })

    // Make sure a profile exists here — otherwise an account can accumulate
    // applications but never appear on the leaderboard.
    ensureProfile()
}

// Each page names itself with <body data-page="...">, so this doesn't depend on the
// URL. (The old check matched any path containing the word, so a page named
// "research.html" would have counted as Search.)
// The login page sends signed-in users into the app, signup is open to everyone, and
// every other page requires an account. An unknown or missing name gets the
// strictest treatment, so a new page that forgets the attribute still isn't public.
const PAGE = document.body.dataset.page
if (PAGE === 'login') {
    checkSession()
} else if (PAGE !== 'signup') {
    if (!APP_PAGES.includes(PAGE)) console.error(`auth.js: unknown data-page "${PAGE}" — treating it as signed-in only`)
    requireAuth()
}

async function logOut() {
    // Clear cached applications and saved jobs so they don't leak into the next
    // account that logs in on this browser.
    localStorage.removeItem('si_applications')
    localStorage.removeItem('si_saved')
    await client.auth.signOut()
    window.location.href = 'index.html'
}

// Wire up auth buttons (moved off inline onclick handlers for a strict CSP).
// Each guard runs only on the page where that button exists.
const loginBtn = document.getElementById('login_btn')
if (loginBtn) loginBtn.addEventListener('click', logIn)

const signupBtn = document.getElementById('signup_btn')
if (signupBtn) signupBtn.addEventListener('click', signUp)

const googleBtn = document.getElementById('google_btn')
if (googleBtn) googleBtn.addEventListener('click', googleSignIn)

// Sends a password-reset email. Uses the email typed into the login form.
async function forgotPassword() {
    const email = document.getElementById('email').value
    if (!email) {
        await showAlert('Enter your email above first, then click "Forgot password?"', 'Reset password')
        return
    }

    // Confirm the destination address before sending anything.
    const ok = await showConfirm(`Send a password-reset link to ${email}?`, 'Reset password')
    if (!ok) return

    const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password.html'
    })

    if (error) {
        await showAlert(error.message, 'Something went wrong')
        return
    }

    // Deliberately neutral message — don't reveal whether the email is registered.
    await showAlert('If an account exists for that email, a password-reset link is on its way. Check your inbox.', 'Check your inbox')
}

const forgotLink = document.getElementById('forgot_link')
if (forgotLink) forgotLink.addEventListener('click', (e) => { e.preventDefault(); forgotPassword() })
