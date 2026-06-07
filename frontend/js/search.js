document.getElementById('search_btn').addEventListener('click', performSearch);
document.getElementById('search_input').addEventListener('keydown', e => {
  if (e.key === 'Enter') performSearch();
});

async function performSearch() {
  document.getElementById('empty_state').style.display = 'none';

  const keyword  = document.getElementById('search_input').value.trim();
  const location = document.getElementById('filter_location').value;

  const jobList = document.getElementById('job_list');
  jobList.classList.add('visible');
  jobList.innerHTML = '<div class="no_results">Loading listings...</div>';

  try {
    const jobs = await fetchJobs({ keyword, location });
    renderResults(jobs);
  } catch (err) {
    console.error('Search failed:', err);
    jobList.innerHTML = '<div class="no_results">Could not load listings. Please try again.</div>';
  }
}

function renderResults(jobs) {
  const jobList = document.getElementById('job_list');

  if (jobs.length === 0) {
    jobList.innerHTML = '<div class="no_results">No results found. Try a different search.</div>';
    return;
  }

  jobList.innerHTML = jobs.map((job, i) => `
    <div class="jobs" data-index="${i}">
      <div class="left_jobs">
        <div class="info_title">${esc(job.title)}</div>
        <div class="info_company">${esc(job.company)}</div>
        <div class="info_location">${esc(job.location || 'Location not listed')}</div>
      </div>
      <div class="center_jobs">
        <button class="apply_btn" data-index="${i}">Mark Applied</button>
      </div>
      <div class="right_jobs">
        <div class="info_rate">${esc(job.pay || 'Pay not listed')}</div>
        <a class="info_link" href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">View Listing</a>
      </div>
    </div>
  `).join('');

  jobList.querySelectorAll('.apply_btn').forEach(btn => {
    btn.addEventListener('click', () => {
      markApplied(btn, jobs[parseInt(btn.dataset.index)]);
    });
  });
}

// Prevents XSS — always escape user-supplied or external data before injecting into HTML
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function markApplied(btn, job) {
  if (btn.classList.contains('applied')) return;

  const entry = {
    position: job.title,
    company:  job.company,
    location: job.location || '',
    pay:      job.pay || 'Not listed',
    status:   'Applied',
    notes:    '',
  };

  try {
    const { data: { user } } = await client.auth.getUser();
    if (user) {
      const { data, error } = await client.from('applications').insert({
        user_id:  user.id,
        position: entry.position,
        company:  entry.company,
        location: entry.location,
        pay:      entry.pay,
        status:   entry.status,
        notes:    entry.notes,
      }).select().single();

      if (!error && data) entry.id = data.id;
    }
  } catch (_) {}

  const apps = JSON.parse(localStorage.getItem('si_applications') || '[]');
  apps.push(entry);
  localStorage.setItem('si_applications', JSON.stringify(apps));

  btn.textContent = 'Applied ✓';
  btn.classList.add('applied');
  btn.disabled = true;
}
