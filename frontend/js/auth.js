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
        const { data: profile } = await client
            .from('profiles')
            .select('username')
            .eq('id', session.user.id)
            .maybeSingle()

        if (profile) {
            window.location.href = 'search.html'
        } else {
            // No profile yet — either a Google OAuth user or someone who just confirmed
            // their email. Prefer the username they picked at signup (carried in
            // user_metadata, or stashed locally), falling back to the email prefix.
            const desired = session.user.user_metadata?.username
                || localStorage.getItem('si_pending_username')
                || session.user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_')

            let username = desired
            let suffix = 1

            while (true) {
                // Safe availability check (profiles is no longer publicly readable)
                const { data: taken } = await client.rpc('username_exists', { p_username: username })
                if (!taken) break
                username = desired + suffix
                suffix++
            }

            const { error: insertError } = await client.from('profiles').insert({
                id: session.user.id,
                username: username,
                email: session.user.email
            })

            if (insertError) {
                console.error('Profile creation failed:', insertError.message)
                return
            }

            // Signup is now fully complete — clear the stashed values.
            localStorage.removeItem('si_pending_username')
            localStorage.removeItem('si_pending_email')

            window.location.href = 'search.html'
        }
    }
}

if (!window.location.pathname.includes('search') &&
    !window.location.pathname.includes('tracker') &&
    !window.location.pathname.includes('signup') &&
    !window.location.pathname.includes('settings') &&
    !window.location.pathname.includes('saved') &&
    !window.location.pathname.includes('leaderboard')) {
    checkSession()
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
