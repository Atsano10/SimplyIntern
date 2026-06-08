const PAGE_SIZE = 50;
let currentFilters = {};
let currentOffset  = 0;
let isLoading      = false;
let hasMore        = true;

document.getElementById('search_btn').addEventListener('click', performSearch);
document.getElementById('search_input').addEventListener('keydown', e => {
  if (e.key === 'Enter') performSearch();
});

window.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
  if (scrollTop + clientHeight >= scrollHeight - 300 && !isLoading && hasMore) {
    loadMore();
  }
});

async function performSearch() {
  document.getElementById('empty_state').style.display = 'none';

  currentFilters = {
    keyword:  document.getElementById('search_input').value.trim(),
    location: document.getElementById('filter_location').value,
    jobType:  document.getElementById('filter_type').value,
  };
  currentOffset = 0;
  hasMore       = true;
  isLoading     = false;

  const jobList = document.getElementById('job_list');
  jobList.classList.add('visible');
  jobList.innerHTML = '<div class="no_results">Loading listings...</div>';

  try {
    const jobs = await fetchJobs(currentFilters, 0, PAGE_SIZE);
    renderResults(jobs, false);
    currentOffset = jobs.length;
    hasMore = jobs.length === PAGE_SIZE;
  } catch (err) {
    console.error('Search failed:', err);
    jobList.innerHTML = '<div class="no_results">Could not load listings. Please try again.</div>';
  }
}

async function loadMore() {
  if (isLoading || !hasMore) return;
  isLoading = true;

  const sentinel = document.createElement('div');
  sentinel.id = 'load_sentinel';
  sentinel.className = 'no_results';
  sentinel.textContent = 'Loading more...';
  document.getElementById('job_list').appendChild(sentinel);

  try {
    const jobs = await fetchJobs(currentFilters, currentOffset, PAGE_SIZE);
    document.getElementById('load_sentinel')?.remove();
    renderResults(jobs, true);
    currentOffset += jobs.length;
    hasMore = jobs.length === PAGE_SIZE;
  } catch {
    document.getElementById('load_sentinel')?.remove();
  }

  isLoading = false;
}

function renderResults(jobs, append) {
  const jobList = document.getElementById('job_list');

  if (!append) {
    if (jobs.length === 0) {
      jobList.innerHTML = '<div class="no_results">No results found. Try a different search.</div>';
      return;
    }
    jobList.innerHTML = '';
  }

  if (jobs.length === 0) return;

  const fragment = document.createDocumentFragment();
  jobs.forEach(job => {
    const div = document.createElement('div');
    div.className = 'jobs';
    div.innerHTML = `
      <div class="left_jobs">
        <div class="info_title">${esc(job.title)}</div>
        <div class="info_company">${esc(job.company)}</div>
        <div class="info_location">${esc(job.location || 'Location not listed')}</div>
      </div>
      <div class="center_jobs">
        <button class="apply_btn"
          data-title="${esc(job.title)}"
          data-company="${esc(job.company)}"
          data-location="${esc(job.location || '')}"
          data-pay="${esc(job.pay || '')}">Mark Applied</button>
      </div>
      <div class="right_jobs">
        <div class="info_rate">${esc(job.pay || 'Pay not listed')}</div>
        <a class="info_link" href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">View Listing</a>
      </div>
    `;
    div.querySelector('.apply_btn').addEventListener('click', function () {
      markApplied(this);
    });
    fragment.appendChild(div);
  });

  jobList.appendChild(fragment);
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

async function markApplied(btn) {
  if (btn.classList.contains('applied')) return;

  const entry = {
    position: btn.dataset.title,
    company:  btn.dataset.company,
    location: btn.dataset.location,
    pay:      btn.dataset.pay || 'Not listed',
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
