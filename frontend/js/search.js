const PAGE_SIZE = 50;
let currentFilters = {};
let currentOffset  = 0;
let isLoading      = false;
let hasMore        = true;

// Multi-select filter state - I track which values are checked in each dropdown
const msState = {
  locations:  new Set(),
  industries: new Set(),
  jobTypes:   new Set(),
};

// Maps each filter label (e.g. 'California') to the DB ilike patterns I'll use to query it
const locationPatternMap = {};

// Builds the checkbox list inside a filter panel from an array of { value, label } items
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

// Updates the filter button label to reflect what's currently selected
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

// Opens or closes a filter panel, closing any other open ones first
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

// Close any open filter panel when the user clicks outside of it
document.addEventListener('click', e => {
  if (!e.target.closest('.filter_multi')) {
    document.querySelectorAll('.filter_multi_panel.open').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.filter_multi_btn.open').forEach(b => b.classList.remove('open'));
  }
});

// Location filter

// Maps 2-letter US state codes to full state names for the filter dropdown
const STATE_NAMES = {
  AL: 'Alabama',       AK: 'Alaska',         AZ: 'Arizona',        AR: 'Arkansas',
  CA: 'California',    CO: 'Colorado',        CT: 'Connecticut',    DE: 'Delaware',
  FL: 'Florida',       GA: 'Georgia',         HI: 'Hawaii',         ID: 'Idaho',
  IL: 'Illinois',      IN: 'Indiana',         IA: 'Iowa',           KS: 'Kansas',
  KY: 'Kentucky',      LA: 'Louisiana',       ME: 'Maine',          MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan',        MN: 'Minnesota',      MS: 'Mississippi',
  MO: 'Missouri',      MT: 'Montana',         NE: 'Nebraska',       NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey',      NM: 'New Mexico',     NY: 'New York',
  NC: 'North Carolina',ND: 'North Dakota',    OH: 'Ohio',           OK: 'Oklahoma',
  OR: 'Oregon',        PA: 'Pennsylvania',    RI: 'Rhode Island',   SC: 'South Carolina',
  SD: 'South Dakota',  TN: 'Tennessee',       TX: 'Texas',          UT: 'Utah',
  VT: 'Vermont',       VA: 'Virginia',        WA: 'Washington',     WV: 'West Virginia',
  WI: 'Wisconsin',     WY: 'Wyoming',         DC: 'Washington DC',
};
const US_STATES = new Set(Object.keys(STATE_NAMES));

// Pulls all unique locations from the DB, groups them into state/country buckets,
// and populates the location dropdown. Remote always appears first.
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

      // A single listing can have multiple locations joined by " / " (e.g. "New York, NY / Remote")
      const parts = loc.split(' / ').map(p => p.trim()).filter(Boolean);
      parts.forEach(part => {
        if (/\bremote\b/i.test(part)) {
          if (!cpMap['Remote']) cpMap['Remote'] = new Set();
          cpMap['Remote'].add('%remote%');
          return;
        }

        // US locations end with a known 2-letter state code like ", NY"
        const stateMatch = part.match(/,\s*([A-Z]{2})\s*$/);
        if (stateMatch && US_STATES.has(stateMatch[1])) {
          const code      = stateMatch[1];
          const stateName = STATE_NAMES[code];
          // Anchor the state code to a part boundary: either the end of the whole
          // location string ("%, NY") or right before a " / " separator in a
          // multi-location listing ("%, NY /%"). A plain substring like "%, DE%"
          // would wrongly match countries — ", DEnmark", ", INdia", ", COlombia" —
          // which is why "United States" was surfacing Denmark, India, etc.
          const patterns = [`%, ${code}`, `%, ${code} /%`];
          if (!cpMap[stateName]) cpMap[stateName] = new Set();
          // Every US state also rolls up under the "United States" filter option,
          // so selecting it returns listings from every state.
          if (!cpMap['United States']) cpMap['United States'] = new Set();
          for (const pat of patterns) {
            cpMap[stateName].add(pat);
            cpMap['United States'].add(pat);
          }
          return;
        }

        // International - I use the last comma segment as the country name
        const locParts = part.split(',');
        const country = locParts.length >= 2
          ? locParts[locParts.length - 1].trim()
          : part;
        if (!country) return;
        if (!cpMap[country]) cpMap[country] = new Set();
        // Anchor the country to the end of the string or before a " / " separator
        // so "India" matches "Mumbai, India" but not "Indianapolis, IN".
        cpMap[country].add(`%${country}`);
        cpMap[country].add(`%${country} /%`);
      });
    });

    // Some companies use abbreviations or alternate names for the same place.
    // I merge these into canonical labels so duplicates don't appear in the filter.
    const LOCATION_ALIASES = {
      // United States variants
      'USA': 'United States', 'U.S.': 'United States',
      'United States of America': 'United States', 'U.S.A.': 'United States',
      // United Kingdom variants
      'UK': 'United Kingdom', 'England': 'United Kingdom',
      'Great Britain': 'United Kingdom', 'GBR': 'United Kingdom',
      // City abbreviations that should roll up to their state
      'Nyc': 'New York', 'NYC': 'New York',
      'La': 'California', 'Sf': 'California', 'SF': 'California',
      'Seattle': 'Washington',
      // Standalone cities that should roll up to their country
      'Rotterdam': 'Netherlands', 'Amsterdam': 'Netherlands',
      // Brazilian state codes (MG = Minas Gerais, SP = São Paulo, etc.)
      'MG': 'Brazil', 'SP': 'Brazil', 'RJ': 'Brazil', 'RS': 'Brazil',
      // 3-letter ISO country codes that sometimes slip through from Greenhouse
      'CAN': 'Canada',    'DEU': 'Germany',   'FRA': 'France',
      'AUS': 'Australia', 'IND': 'India',     'CHN': 'China',
      'JPN': 'Japan',     'KOR': 'South Korea', 'SGP': 'Singapore',
      'NLD': 'Netherlands', 'ESP': 'Spain',   'ITA': 'Italy',
      'BRA': 'Brazil',    'MEX': 'Mexico',    'ARG': 'Argentina',
      'COL': 'Colombia',  'CHL': 'Chile',     'ZAF': 'South Africa',
      'NZL': 'New Zealand', 'SWE': 'Sweden',  'NOR': 'Norway',
      'DNK': 'Denmark',   'FIN': 'Finland',   'BEL': 'Belgium',
      'CHE': 'Switzerland', 'AUT': 'Austria', 'PRT': 'Portugal',
      'POL': 'Poland',    'CZE': 'Czech Republic', 'TUR': 'Turkey',
      'ISR': 'Israel',    'ARE': 'UAE',       'TWN': 'Taiwan',
      'HKG': 'Hong Kong', 'IRE': 'Ireland',   'IRL': 'Ireland',
    };
    Object.entries(LOCATION_ALIASES).forEach(([alias, canonical]) => {
      if (!cpMap[alias]) return;
      if (!cpMap[canonical]) cpMap[canonical] = new Set();
      for (const p of cpMap[alias]) cpMap[canonical].add(p);
      delete cpMap[alias];
    });

    // Drop anything that's clearly not a real location (e.g. "or Paris" fragments, single chars)
    Object.keys(cpMap).forEach(key => {
      if (/^or\s/i.test(key) || key.length <= 1) delete cpMap[key];
    });

    Object.keys(cpMap).forEach(c => { locationPatternMap[c] = [...cpMap[c]]; });
  } catch {
    // If the DB query fails I fall back to a hardcoded set of common US states.
    // Patterns are anchored the same way as the live ones: end-of-string or before " / ".
    locationPatternMap['Remote']       = ['%remote%'];
    locationPatternMap['New York']     = ['%, NY', '%, NY /%'];
    locationPatternMap['California']   = ['%, CA', '%, CA /%'];
    locationPatternMap['Illinois']     = ['%, IL', '%, IL /%'];
    locationPatternMap['Massachusetts']= ['%, MA', '%, MA /%'];
    locationPatternMap['Washington']   = ['%, WA', '%, WA /%'];
    locationPatternMap['Texas']        = ['%, TX', '%, TX /%'];
  }

  // Sort alphabetically, Remote always first
  const countries = Object.keys(locationPatternMap).sort((a, b) => {
    if (a === 'Remote') return -1;
    if (b === 'Remote') return 1;
    return a.localeCompare(b);
  });

  msInit('ms_location', 'locations', countries.map(c => ({ value: c, label: c })));

  // The location panel has a lot of options so I add a live search box at the top
  const searchEl = document.createElement('input');
  searchEl.type = 'text';
  searchEl.placeholder = 'Search locations…';
  searchEl.className = 'ms_search';
  searchEl.addEventListener('input', () => {
    const q = searchEl.value.toLowerCase();
    document.querySelectorAll('#ms_location_panel .ms_option').forEach(opt => {
      opt.style.display = opt.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  document.getElementById('ms_location_panel').prepend(searchEl);
}

// Search

document.getElementById('search_btn').addEventListener('click', performSearch);
document.getElementById('search_input').addEventListener('keydown', e => {
  if (e.key === 'Enter') performSearch();
});

// Resets the keyword input, unchecks all filter options, and snaps the button labels back to default
function clearFilters() {
  document.getElementById('search_input').value = '';

  [
    { id: 'ms_location',  key: 'locations'  },
    { id: 'ms_industry',  key: 'industries' },
    { id: 'ms_type',      key: 'jobTypes'   },
  ].forEach(({ id, key }) => {
    msState[key].clear();
    document.querySelectorAll(`#${id}_panel input[type="checkbox"]`).forEach(cb => {
      cb.checked = false;
    });
    // Also reset the location search box and unhide any filtered-out options
    const searchBox = document.querySelector(`#${id}_panel .ms_search`);
    if (searchBox) {
      searchBox.value = '';
      document.querySelectorAll(`#${id}_panel .ms_option`).forEach(opt => {
        opt.style.display = '';
      });
    }
    msRefresh(id, key);
  });
}

// Listens for scroll position and triggers loadMore when the user gets near the bottom
window.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
  if (scrollTop + clientHeight >= scrollHeight - 300 && !isLoading && hasMore) {
    loadMore();
  }
});

// Runs a fresh search with the current filters, replacing any existing results
async function performSearch() {
  document.getElementById('empty_state').style.display = 'none';

  // Expand each selected location label into its DB query patterns
  const locationPatterns = [...msState.locations].flatMap(c => locationPatternMap[c] || [`%${c}%`]);

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

// Fetches the next page of results and appends them below the existing ones
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

// Builds and inserts job cards into the list.
// I also check localStorage here so listings the user already applied to
// show their green "Applied ✓" state immediately without needing to re-click.
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

  // Read once outside the loop so I'm not hitting localStorage on every card
  const appliedApps = JSON.parse(localStorage.getItem('si_applications') || '[]');

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
          data-location="${esc(job.location || '')}">Mark Applied</button>
      </div>
      <div class="right_jobs">
        <div class="info_rate">${esc(timeAgo(job.posted_at))}</div>
        <a class="info_link" href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">View Listing</a>
      </div>
    `;

    const btn = div.querySelector('.apply_btn');

    // Restore the applied state if this listing was previously marked
    const prior = appliedApps.find(a => a.position === job.title && a.company === job.company);
    if (prior) {
      btn.textContent = 'Applied ✓';
      btn.classList.add('applied');
      if (prior.id) btn.dataset.appId = String(prior.id);
    }

    btn.addEventListener('click', function () { markApplied(this); });
    fragment.appendChild(div);
  });

  jobList.appendChild(fragment);
}

// Converts a date string into something readable like "Posted 3 days ago"
function timeAgo(dateStr) {
  if (!dateStr) return 'Recently posted';
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return 'Recently posted';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0)  return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 7)   return `Posted ${days} days ago`;
  if (days < 14)  return 'Posted 1 week ago';
  if (days < 30)  return `Posted ${Math.floor(days / 7)} weeks ago`;
  if (days < 60)  return 'Posted 1 month ago';
  return `Posted ${Math.floor(days / 30)} months ago`;
}

// Escapes strings before inserting them into innerHTML to prevent XSS
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Saves an application to localStorage and Supabase, then marks the button green.
// Clicking the green button again calls unmarkApplied to undo it.
async function markApplied(btn) {
  if (btn.classList.contains('applied')) {
    await unmarkApplied(btn);
    return;
  }

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

      if (!error && data) {
        entry.id = data.id;
        btn.dataset.appId = data.id;
      }
    }
  } catch (_) {}

  const apps = JSON.parse(localStorage.getItem('si_applications') || '[]');
  apps.push(entry);
  localStorage.setItem('si_applications', JSON.stringify(apps));

  btn.textContent = 'Applied ✓';
  btn.classList.add('applied');
}

// Removes the application from localStorage and the DB, then resets the button to its default state
async function unmarkApplied(btn) {
  const appId = btn.dataset.appId;

  try {
    const { data: { user } } = await client.auth.getUser();
    if (user && appId) {
      await client.from('applications').delete().eq('id', appId);
    }
  } catch (_) {}

  const apps = JSON.parse(localStorage.getItem('si_applications') || '[]');
  const filtered = appId
    ? apps.filter(a => String(a.id) !== String(appId))
    : apps.filter(a => a.position !== btn.dataset.title || a.company !== btn.dataset.company);
  localStorage.setItem('si_applications', JSON.stringify(filtered));

  btn.textContent = 'Mark Applied';
  btn.classList.remove('applied');
  delete btn.dataset.appId;
}

// Init - set up the static filters and load locations from the DB

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
