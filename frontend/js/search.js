document.getElementById('search_btn').addEventListener('click', performSearch);
document.getElementById('search_input').addEventListener('keydown', e => {
    if (e.key === 'Enter') performSearch();
});

function performSearch() {
    document.getElementById('empty_state').style.display = 'none';
    document.getElementById('job_list').classList.add('visible');
    renderDemoResults();
}

function renderDemoResults() {
    const jobList = document.getElementById('job_list');
    const query = document.getElementById('search_input').value.toLowerCase();

    const demoJobs = [
        { title: 'Software Engineering Intern', company: 'Stripe', location: 'San Francisco, CA', pay: '$45 / hr', link: '#' },
        { title: 'Product Design Intern', company: 'Figma', location: 'Remote', pay: '$35 / hr', link: '#' },
        { title: 'Data Science Intern', company: 'Spotify', location: 'New York, NY', pay: '$38 / hr', link: '#' },
        { title: 'Backend Engineering Intern', company: 'Cloudflare', location: 'Austin, TX', pay: '$40 / hr', link: '#' },
        { title: 'Marketing Intern', company: 'HubSpot', location: 'Boston, MA', pay: '$22 / hr', link: '#' },
    ];

    const filtered = query
        ? demoJobs.filter(j =>
            j.title.toLowerCase().includes(query) ||
            j.company.toLowerCase().includes(query) ||
            j.location.toLowerCase().includes(query)
          )
        : demoJobs;

    if (filtered.length === 0) {
        jobList.innerHTML = '<div class="no_results">No results found. Try a different search.</div>';
        return;
    }

    jobList.innerHTML = filtered.map((job, i) => `
        <div class="jobs" data-index="${i}">
            <div class="left_jobs">
                <div class="info_title">${job.title}</div>
                <div class="info_company">${job.company}</div>
                <div class="info_location">${job.location}</div>
            </div>
            <div class="center_jobs">
                <button class="apply_btn" data-index="${i}">Mark Applied</button>
            </div>
            <div class="right_jobs">
                <div class="info_rate">${job.pay}</div>
                <a class="info_link" href="${job.link}" target="_blank">View Listing</a>
            </div>
        </div>
    `).join('');

    // Wire up each "Mark Applied" button
    jobList.querySelectorAll('.apply_btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const job = filtered[parseInt(btn.dataset.index)];
            markApplied(btn, job);
        });
    });
}

async function markApplied(btn, job) {
    if (btn.classList.contains('applied')) return;

    const entry = {
        position: job.title,
        company: job.company,
        location: job.location,
        pay: job.pay,
        status: 'Applied',
        notes: '',
    };

    // Save to Supabase if logged in
    try {
        const { data: { user } } = await client.auth.getUser();
        if (user) {
            const { data, error } = await client.from('applications').insert({
                user_id: user.id,
                position: entry.position,
                company: entry.company,
                location: entry.location,
                pay: entry.pay,
                status: entry.status,
                notes: entry.notes,
            }).select().single();

            if (!error && data) {
                entry.id = data.id;
            }
        }
    } catch (_) {}

    // Always keep localStorage in sync as local cache
    const apps = JSON.parse(localStorage.getItem('si_applications') || '[]');
    apps.push(entry);
    localStorage.setItem('si_applications', JSON.stringify(apps));

    btn.textContent = 'Applied';
    btn.classList.add('applied');
    btn.disabled = true;
}
