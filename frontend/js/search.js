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

// Maps each location option value (e.g. 'us:CA') to the DB ILIKE patterns that select it.
// Built by buildLocationIndex() in js/locations.js.
let locationPatternMap = {};

// Display label for each option value, per filter (so the button shows "California", not "us:CA").
const msLabels = { locations: {}, industries: {}, jobTypes: {} };

// Builds the checkbox list inside a filter panel from { value, label, count? } items.
// `container` defaults to the panel itself; the location filter passes a group element.
function msInit(id, stateKey, items, container) {
  const target = container || document.getElementById(id + '_panel');
  items.forEach(({ value, label, count }) => {
    msLabels[stateKey][value] = label;
    const lbl = document.createElement('label');
    lbl.className = 'ms_option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = value;
    cb.addEventListener('change', () => {
      msState[stateKey][cb.checked ? 'add' : 'delete'](value);
      msRefresh(id, stateKey);
    });
    const text = document.createElement('span');
    text.className = 'ms_option_label';
    text.textContent = label;
    lbl.append(cb, text);
    if (count != null) {
      const num = document.createElement('span');
      num.className = 'ms_count';
      num.textContent = count;
      lbl.appendChild(num);
    }
    target.appendChild(lbl);
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
    const names = [...set].map(v => msLabels[stateKey][v] || v);
    lbl.textContent = names.length <= 2 ? names.join(', ') : `${names.length} selected`;
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

// Supabase returns at most 1000 rows per request, so page through every listing's
// location (a single .limit(2000) silently stopped at 1000 and dropped half the places).
async function fetchAllLocations() {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; from < 50000; from += PAGE) {
    const { data, error } = await client
      .from('listings')
      .select('location')
      .not('location', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    data.forEach(r => all.push(r.location));
    if (data.length < PAGE) break;
  }
  return all;
}

// Builds the grouped location panel: Remote / United States, then U.S. states, then
// international countries — each with its listing count — plus a live search box.
async function loadLocationFilter() {
  const panel = document.getElementById('ms_location_panel');
  let index;
  try {
    index = buildLocationIndex(await fetchAllLocations());
  } catch (err) {
    console.error('Could not load locations:', err);
    const msg = document.createElement('div');
    msg.className = 'ms_empty';
    msg.textContent = 'Couldn’t load locations. Refresh to try again.';
    panel.appendChild(msg);
    return;
  }
  locationPatternMap = index.patterns;

  const searchEl = document.createElement('input');
  searchEl.type = 'text';
  searchEl.placeholder = 'Search locations…';
  searchEl.className = 'ms_search';
  panel.appendChild(searchEl);

  const GROUPS = [
    { key: 'top',  title: null },
    { key: 'us',   title: 'U.S. states' },
    { key: 'intl', title: 'International' },
  ];
  GROUPS.forEach(({ key, title }) => {
    const items = index.options.filter(o => o.group === key);
    if (items.length === 0) return;
    const group = document.createElement('div');
    group.className = 'ms_group';
    if (title) {
      const h = document.createElement('div');
      h.className = 'ms_group_title';
      h.textContent = title;
      group.appendChild(h);
    }
    msInit('ms_location', 'locations', items, group);
    panel.appendChild(group);
  });

  const noMatch = document.createElement('div');
  noMatch.className = 'ms_empty';
  noMatch.textContent = 'No matching locations';
  noMatch.hidden = true;
  panel.appendChild(noMatch);

  // Filter options as you type; hide a group's title when none of its options match.
  searchEl.addEventListener('input', () => {
    const q = searchEl.value.trim().toLowerCase();
    let anyVisible = false;
    panel.querySelectorAll('.ms_group').forEach(group => {
      let visible = 0;
      group.querySelectorAll('.ms_option').forEach(opt => {
        const show = opt.querySelector('.ms_option_label').textContent.toLowerCase().includes(q);
        opt.hidden = !show;
        if (show) visible++;
      });
      group.hidden = visible === 0;
      if (visible) anyVisible = true;
    });
    noMatch.hidden = anyVisible;
  });
}

// Search

document.getElementById('search_btn').addEventListener('click', performSearch);
document.getElementById('search_input').addEventListener('keydown', e => {
  if (e.key === 'Enter') performSearch();
});

// Filter buttons (moved off inline onclick handlers for a strict CSP).
document.getElementById('ms_location_btn').addEventListener('click', () => msToggle('ms_location'));
document.getElementById('ms_industry_btn').addEventListener('click', () => msToggle('ms_industry'));
document.getElementById('ms_type_btn').addEventListener('click', () => msToggle('ms_type'));
document.getElementById('clear_btn').addEventListener('click', clearFilters);

// Sort / recency / remote controls re-run the search immediately, but only once
// results are on screen (so changing them before the first Search is a no-op).
['sort_select', 'posted_select', 'remote_only'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    if (document.getElementById('job_list').classList.contains('visible')) performSearch();
  });
});

// Resets the keyword input, unchecks all filter options, and snaps the button labels back to default
function clearFilters() {
  document.getElementById('search_input').value = '';
  document.getElementById('sort_select').value = 'newest';
  document.getElementById('posted_select').value = '';
  document.getElementById('remote_only').checked = false;

  [
    { id: 'ms_location',  key: 'locations'  },
    { id: 'ms_industry',  key: 'industries' },
    { id: 'ms_type',      key: 'jobTypes'   },
  ].forEach(({ id, key }) => {
    msState[key].clear();
    document.querySelectorAll(`#${id}_panel input[type="checkbox"]`).forEach(cb => {
      cb.checked = false;
    });
    // Also reset the location search box, which unhides any filtered-out options
    const searchBox = document.querySelector(`#${id}_panel .ms_search`);
    if (searchBox) {
      searchBox.value = '';
      searchBox.dispatchEvent(new Event('input'));
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

  // Expand each selected location into its DB query patterns (deduped — e.g. picking
  // both "United States" and "California" would otherwise repeat California's).
  const locationPatterns = [...new Set(
    [...msState.locations].flatMap(v => locationPatternMap[v] || []))];

  const postedVal = document.getElementById('posted_select').value;

  currentFilters = {
    keyword:          document.getElementById('search_input').value.trim(),
    locationPatterns,
    industries:       [...msState.industries],
    jobTypes:         [...msState.jobTypes],
    sort:             document.getElementById('sort_select').value,
    postedWithinDays: postedVal ? Number(postedVal) : null,
    remoteOnly:       document.getElementById('remote_only').checked,
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
  const savedIds    = getSavedIds();

  const fragment = document.createDocumentFragment();
  jobs.forEach(job => {
    if (job.id) jobById[job.id] = job;   // remember for toggleSaved

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
          data-listing-id="${esc(job.id || '')}"
          data-title="${esc(job.title)}"
          data-company="${esc(job.company)}"
          data-location="${esc(job.location || '')}">Mark Applied</button>
        <button class="save_btn" data-listing-id="${esc(job.id || '')}">☆ Save</button>
      </div>
      <div class="right_jobs">
        <div class="info_rate">${esc(timeAgo(job.posted_at))}</div>
        <a class="info_link" href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">View Listing</a>
      </div>
    `;

    const saveBtn = div.querySelector('.save_btn');
    if (job.id && savedIds.has(job.id)) setSavedBtnState(saveBtn, true);
    saveBtn.addEventListener('click', function () { toggleSaved(this); });

    const btn = div.querySelector('.apply_btn');

    // Restore the applied state if this listing was previously marked. Prefer the
    // stable listing_id; fall back to the old position+company match for legacy
    // entries saved before listing_id existed.
    const prior = appliedApps.find(a =>
      (a.listingId && job.id && a.listingId === job.id) ||
      (!a.listingId && a.position === job.title && a.company === job.company));
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

// ── Saved jobs ───────────────────────────────────────────────────────────────
// A bookmarked shortlist, separate from "applied". Mirrors the applied-state
// pattern: localStorage `si_saved` is the synchronous source the cards read on
// render, and Supabase is kept in sync in the background when signed in.

// listing_id -> full job row for the current results, so toggleSaved can build a
// saved entry without re-fetching.
const jobById = {};

// Normalizes a listing row into the compact shape we persist for the saved list.
function toSavedEntry(job) {
  return {
    listingId: job.id,
    title:     job.title,
    company:   job.company,
    location:  job.location || '',
    url:       job.url || '',
    pay:       job.pay || '',
    posted_at: job.posted_at || null,
  };
}

// The set of listing ids currently saved, read from the local cache.
function getSavedIds() {
  const saved = JSON.parse(localStorage.getItem('si_saved') || '[]');
  return new Set(saved.map(s => s.listingId).filter(Boolean));
}

function setSavedBtnState(btn, isSaved) {
  btn.classList.toggle('saved', isSaved);
  btn.textContent = isSaved ? '★ Saved' : '☆ Save';
}

// Pull the user's saved rows from Supabase into the local cache so saved state is
// correct across devices/sessions. No-op (keeps localStorage) when logged out.
async function syncSavedFromCloud() {
  try {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    const { data, error } = await client
      .from('saved_jobs')
      .select('created_at, listings(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error || !data) return;
    const entries = data.filter(r => r.listings).map(r => toSavedEntry(r.listings));
    localStorage.setItem('si_saved', JSON.stringify(entries));
  } catch (_) {}
}

// Bookmarks or un-bookmarks a listing. Updates localStorage immediately and
// syncs to Supabase when signed in. Safe to call for logged-out users (local only).
async function toggleSaved(btn) {
  const listingId = btn.dataset.listingId;
  if (!listingId) return;

  const saved = JSON.parse(localStorage.getItem('si_saved') || '[]');
  const already = saved.some(s => s.listingId === listingId);

  if (already) {
    localStorage.setItem('si_saved', JSON.stringify(saved.filter(s => s.listingId !== listingId)));
    setSavedBtnState(btn, false);
    try {
      const { data: { user } } = await client.auth.getUser();
      if (user) await client.from('saved_jobs').delete()
        .eq('user_id', user.id).eq('listing_id', listingId);
    } catch (_) {}
  } else {
    const job = jobById[listingId];
    if (job) saved.push(toSavedEntry(job));
    localStorage.setItem('si_saved', JSON.stringify(saved));
    setSavedBtnState(btn, true);
    try {
      const { data: { user } } = await client.auth.getUser();
      if (user) await client.from('saved_jobs')
        .upsert({ user_id: user.id, listing_id: listingId }, { onConflict: 'user_id,listing_id' });
    } catch (_) {}
  }
}

// Saves an application to localStorage and Supabase, then marks the button green.
// Clicking the green button again calls unmarkApplied to undo it.
async function markApplied(btn) {
  if (btn.classList.contains('applied')) {
    await unmarkApplied(btn);
    return;
  }

  const entry = {
    listingId: btn.dataset.listingId || null,
    position:  btn.dataset.title,
    company:   btn.dataset.company,
    location:  btn.dataset.location,
    pay:       btn.dataset.pay || 'Not listed',
    status:    'Pending',
    notes:     '',
    cycle:     CURRENT_CYCLE,
  };

  try {
    const { data: { user } } = await client.auth.getUser();
    if (user) {
      const { data, error } = await client.from('applications').insert({
        user_id:    user.id,
        listing_id: entry.listingId,
        position:   entry.position,
        company:    entry.company,
        location:   entry.location,
        pay:        entry.pay,
        status:     entry.status,
        notes:      entry.notes,
        cycle:      entry.cycle,
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
  const listingId = btn.dataset.listingId;
  let filtered;
  if (appId) {
    filtered = apps.filter(a => String(a.id) !== String(appId));
  } else if (listingId) {
    filtered = apps.filter(a => a.listingId !== listingId);
  } else {
    filtered = apps.filter(a => a.position !== btn.dataset.title || a.company !== btn.dataset.company);
  }
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

// Refresh the saved-jobs cache from Supabase so bookmarks render correctly.
syncSavedFromCloud();
