const SUPABASE_URL = window.SUPABASE_URL
const SUPABASE_KEY = window.SUPABASE_ANON_KEY

const { createClient } = supabase
const client = createClient(SUPABASE_URL, SUPABASE_KEY)

async function signUp() {
    // Take user input
    const email = document.getElementById('email').value
    const username = document.getElementById('username').value
    const password = document.getElementById('password').value
    const confirmPassword = document.getElementById("con_password").value

    // confirm passwords match
    if (confirmPassword != password) {
        alert('Passwords do not match!')
        return
    }

    // create auth account (Supabase enforces unique email in auth.users)
    const { data, error } = await client.auth.signUp({
        email: email,
        password: password
    })

    if (error) {
        alert(error.message)
        return
    }

    // save profile. The DB unique constraints on username/email are the source
    // of truth — we no longer pre-check profiles (which required public reads).
    const { error: insertError } = await client.from('profiles').insert({
        id: data.user.id,
        username: username,
        email: email
    })

    if (insertError) {
        await client.auth.signOut()

        if (insertError.message.includes('username')) {
            alert('Username already taken!')
        } else if (insertError.message.includes('email')) {
            alert('An account with this email already exists!')
        } else {
            alert('Profile save failed: ' + insertError.message)
        }
        return
    }

    alert('Account created successfully!')
    window.location.href = 'index.html'
}

async function logIn(){
    // Log in with email (username is a public display name, not a login key).
    const email = document.getElementById('email').value
    const password = document.getElementById('password').value

    if (!email || !password){
        alert('Please enter your email and password!')
        return
    }

    const { data, error } = await client.auth.signInWithPassword({
        email: email,
        password: password
    })

    if (error) {
        alert('Incorrect email or password!')
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
        alert(error.message)
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
            // Google OAuth user with no profile — auto-create one from email prefix
            const emailPrefix = session.user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_')
            let username = emailPrefix
            let suffix = 1

            while (true) {
                // Safe availability check (profiles is no longer publicly readable)
                const { data: taken } = await client.rpc('username_exists', { p_username: username })
                if (!taken) break
                username = emailPrefix + suffix
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

            window.location.href = 'search.html'
        }
    }
}

if (!window.location.pathname.includes('search') &&
    !window.location.pathname.includes('tracker') &&
    !window.location.pathname.includes('signup') &&
    !window.location.pathname.includes('settings') &&
    !window.location.pathname.includes('leaderboard')) {
    checkSession()
}

async function logOut() {
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
