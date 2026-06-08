const PAGE_SIZE = 50;
let currentFilters = {};
let currentOffset  = 0;
let isLoading      = false;
let hasMore        = true;

// ── MULTI-SELECT ──────────────────────────────────────────────────────────────

const msState = {
  locations:  new Set(),
  industries: new Set(),
  jobTypes:   new Set(),
};

// Maps country/region name → array of ilike substrings to match against location field
const locationPatternMap = {};

function msInit(id, stateKey, items) {
  const panel = document.getElementById(id + '_panel');
  items.forEach(({ value, label }) => {
    const lbl = document.createElement('label');
    lbl.className = 'ms_option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = value;
    cb.addEventListener('change', () => {
      msState[stateKey][cb.checked ? 'add' : 'delete'](value);
      msRefresh(id, stateKey);
    });
    lbl.append(cb, document.createTextNode(' ' + label));
    panel.appendChild(lbl);
  });
}

function msRefresh(id, stateKey) {
  const btn = document.getElementById(id + '_btn');
  const set = msState[stateKey];
  const lbl = btn.querySelector('.ms_label');
  if (set.size === 0) {
    lbl.textContent = btn.dataset.all;
    btn.classList.remove('ms_active');
  } else {
    const vals = [...set];
    lbl.textContent = vals.length <= 2 ? vals.join(', ') : `${vals.length} selected`;
    btn.classList.add('ms_active');
  }
}

function msToggle(id) {
  const panel  = document.getElementById(id + '_panel');
  const btn    = document.getElementById(id + '_btn');
  const isOpen = panel.classList.contains('open');
  document.querySelectorAll('.filter_multi_panel.open').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.filter_multi_btn.open').forEach(b => b.classList.remove('open'));
  if (!isOpen) {
    panel.classList.add('open');
    btn.classList.add('open');
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('.filter_multi')) {
    document.querySelectorAll('.filter_multi_panel.open').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.filter_multi_btn.open').forEach(b => b.classList.remove('open'));
  }
});

// ── LOCATION LOADING ──────────────────────────────────────────────────────────

function locToCountry(loc) {
  const s = (loc || '').trim();
  if (!s) return null;
  if (/\bremote\b/i.test(s)) return 'Remote';
  // US: "City, ST" ends with 2-letter state code
  if (/,\s*[A-Z]{2}\s*$/.test(s)) return 'United States';
  // "City, Country" — last comma segment
  const parts = s.split(',');
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].trim();
    if (/^[A-Z]{2}$/.test(last)) return 'United States'; // state code fallback
    return last;
  }
  return s;
}

async function loadLocationFilter() {
  try {
    const { data } = await client
      .from('listings')
      .select('location')
      .not('location', 'is', null)
      .limit(2000);

    const cpMap = {};
    (data || []).forEach(row => {
      const loc = (row.location || '').trim();
      if (!loc) return;
      const country = locToCountry(loc);
      if (!country) return;
      if (!cpMap[country]) cpMap[country] = new Set();

      if (/\bremote\b/i.test(loc)) {
        cpMap[country].add('remote');
      } else {
        const m = loc.match(/,\s*([A-Z]{2})\s*$/);
        if (m) {
          cpMap[country].add(`, ${m[1]}`); // ", NY", ", CA" etc.
        } else {
          // For international, match on the country name itself
          const parts = loc.split(',');
          cpMap[country].add(parts[parts.length - 1].trim());
        }
      }
    });

    Object.keys(cpMap).forEach(c => { locationPatternMap[c] = [...cpMap[c]]; });
  } catch {
    locationPatternMap['Remote']        = ['remote'];
    locationPatternMap['United States'] = [', NY', ', CA', ', IL', ', MA', ', WA', ', TX'];
  }

  const countries = Object.keys(locationPatternMap).sort((a, b) => {
    if (a === 'Remote') return -1;
    if (b === 'Remote') return 1;
    return a.localeCompare(b);
  });

  msInit('ms_location', 'locations', countries.map(c => ({ value: c, label: c })));
}

// ── SEARCH ────────────────────────────────────────────────────────────────────

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

  // Expand selected countries into ilike patterns
  const locationPatterns = [...msState.locations].flatMap(c => locationPatternMap[c] || [c]);

  currentFilters = {
    keyword:          document.getElementById('search_input').value.trim(),
    locationPatterns,
    industries:       [...msState.industries],
    jobTypes:         [...msState.jobTypes],
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
    const pay = typeof job.pay === 'string' && job.pay ? job.pay : '';
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
          data-pay="${esc(pay)}">Mark Applied</button>
      </div>
      <div class="right_jobs">
        <div class="info_rate">${esc(pay) || 'Pay not listed'}</div>
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
    status:   'Pending',
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

// ── INIT ──────────────────────────────────────────────────────────────────────

msInit('ms_industry', 'industries', [
  { value: 'tech',      label: 'Technology' },
  { value: 'medical',   label: 'Healthcare / Medical' },
  { value: 'finance',   label: 'Finance / Business' },
  { value: 'marketing', label: 'Marketing / Comms' },
  { value: 'legal',     label: 'Legal / Compliance' },
  { value: 'research',  label: 'Science / Research' },
]);

msInit('ms_type', 'jobTypes', [
  { value: 'internship',  label: 'Internship' },
  { value: 'co-op',       label: 'Co-op' },
  { value: 'externship',  label: 'Externship' },
]);

loadLocationFilter();
