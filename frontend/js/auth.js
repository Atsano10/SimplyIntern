const SUPABASE_URL = "https://mijakorauzqwzfffvcwb.supabase.co"
const SUPABASE_KEY = "sb_publishable_-mOlAX8M7oRYTL75kUCwZg_x0c7A-QB"

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

    // check if email already exists in profiles
    const { data: existingEmail } = await client
        .from('profiles')
        .select('email')
        .eq('email', email)
        .maybeSingle()

    if (existingEmail) {
        alert('An account with this email already exists!')
        return
    }

    // check if username already taken
    const { data: existingUsername } = await client
        .from('profiles')
        .select('username')
        .eq('username', username)
        .maybeSingle()

    if (existingUsername) {
        alert('Username already taken!')
        return
    }

    // create auth account
    const { data, error } = await client.auth.signUp({
        email: email,
        password: password
    })

    if (error) {
        alert(error.message)
        return
    }

    // save profile
    const { error: insertError } = await client.from('profiles').insert({
        id: data.user.id,
        username: username,
        email: email
    })

    if (insertError) {
    await client.auth.signOut()
    
    if (insertError.message.includes('username')) {
        alert('Username already taken!')
    } else {
        alert('Profile save failed: ' + insertError.message)
    }
    return
}

    alert('Account created successfully!')
    window.location.href = 'index.html'
}

async function logIn(){
    const username = document.getElementById('username').value
    const password = document.getElementById('password').value

    if (!username || !password){
        alert('Please enter your username and password!')
        return
    }

    const { data:profileData, error: profileError } = await client
        .from('profiles')
        .select('email')
        .eq('username', username)
        .single()

    if (profileError) {
        alert('Username not found!')
        return
    }

    const { data, error } = await client.auth.signInWithPassword({
        email: profileData.email,
        password: password
    })

    if (error) {
        alert('Incorrect password!')
        return
    }

    window.location.href = 'search.html'
}

async function googleSignIn() {
    const {error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin + '/username-setup.html'
        }
    })

    if (error){
        alert(error.message)
        return
    }
}

async function saveUsername(){
    const username = document.getElementById('username').value

    const { data: { user } } = await client.auth.getUser()

    const { data:existing } = await client
        .from('profiles')
        .select('username')
        .eq('username' , username)
        .single()

    if(existing){
        alert('Username already taken!')
        return
    }

    const { error: insertError } = await client.from('profiles').insert({
        id: user.id,
        username: username,
        email: user.email
    })

    if (insertError) {
        console.error('Insert failed:', insertError.message)
        alert('Something went wrong, please try again.')
        return
    }

    window.location.href = 'search.html'
}

async function checkUsername (){
    const { data: {user} } = await client.auth.getUser()

    if (!user) {
        window.location.href = 'index.html'
        return
    }

    const { data:profile } = await client
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .single()

    if(profile){
        window.location.href = 'search.html'
    }
}

if (window.location.pathname.includes('username-setup')) {
    checkUsername()
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
            window.location.href = 'username-setup.html'
        }
    }
}

if (!window.location.pathname.includes('search') &&
    !window.location.pathname.includes('tracker') &&
    !window.location.pathname.includes('signup') &&
    !window.location.pathname.includes('username-setup') &&
    !window.location.pathname.includes('settings') &&
    !window.location.pathname.includes('leaderboard')) {
    checkSession()
}

async function logOut() {
    await client.auth.signOut()
    window.location.href = 'index.html'
}
