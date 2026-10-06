const PAGE_SIZE = 50;
let currentFilters = {};
let currentOffset  = 0;
let isLoading      = false;
let hasMore        = true;
// Bumped on every new search so a slow request from an older search can't append
// its results to the new one.
let searchGen      = 0;

// On refresh we re-fetch as many rows as were loaded, capped so a user who scrolled
// thousands of rows deep doesn't fire dozens of requests at once.
const MAX_RESTORE_ROWS = 500;
const SCROLL_KEY = 'si_search_scroll';

// We restore scroll ourselves once results load. The browser's automatic restore
// runs before the async results exist, so it would land on an empty page at the top.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

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

// ── New since your last visit ────────────────────────────────────────────────
// The database works out the cut-off per user (start_search_visit, migration 026):
// listings added after it get a "New" badge, and the "New since your last visit"
// option shows only those. Searches wait for this, so badges are right from the start.
let newSince = null;
const visitReady = (async () => {
  try {
    const { data, error } = await client.rpc('start_search_visit');
    if (error || !data?.[0]?.since) return;
    newSince = data[0].since;
    const option = new Option(`New since your last visit (${data[0].new_count})`, 'new');
    document.getElementById('posted_select').options.add(option, 1);   // right after "Any time"
  } catch (_) {}
})();

function isNewListing(job) {
  return !!(newSince && job.created_at && new Date(job.created_at) > new Date(newSince));
}

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

// Every distinct listing location with its listing count, in one call
// (migration 020) instead of paging through the whole listings table.
async function fetchLocationCounts() {
  const { data, error } = await client.rpc('listing_locations');
  if (error) throw error;
  return data || {};
}

// Builds the grouped location panel: Remote / United States, then U.S. states, then
// international countries — each with its listing count — plus a live search box.
async function loadLocationFilter() {
  const panel = document.getElementById('ms_location_panel');
  let index;
  try {
    index = buildLocationIndex(await fetchLocationCounts());
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

document.getElementById('search_btn').addEventListener('click', () => performSearch());
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
  document.getElementById('sort_select').value = 'relevance';
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

// ── Infinite scroll ──────────────────────────────────────────────────────────
// An invisible marker sits under the results. The browser tells us when it comes
// within 300px of the viewport, instead of us checking on every scroll event.
const scrollSentinel = document.getElementById('scroll_sentinel');

function sentinelNearViewport() {
  return scrollSentinel.getBoundingClientRect().top < window.innerHeight + 300;
}

// Loads the next page if there's room for it. Also called after each page renders:
// the observer only fires when the marker *enters* view, so if a page wasn't tall
// enough to push it back out (big screens), nothing else would trigger the next load.
function maybeLoadMore() {
  if (!document.getElementById('job_list').classList.contains('visible')) return;
  if (isLoading || !hasMore || !sentinelNearViewport()) return;
  loadMore();
}

new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting)) maybeLoadMore();
}, { rootMargin: '0px 0px 300px 0px' }).observe(scrollSentinel);

// ── Search state in the URL ──────────────────────────────────────────────────
// The URL holds the search (search.html?q=swe&loc=us:CA&sort=newest) so a refresh,
// the back button, or a shared link brings back the same results.
const URL_KEYS = ['q', 'loc', 'ind', 'type', 'sort', 'posted', 'remote'];

function filtersToQuery() {
  const p = new URLSearchParams();
  if (currentFilters.keyword) p.set('q', currentFilters.keyword);
  msState.locations.forEach(v => p.append('loc', v));
  msState.industries.forEach(v => p.append('ind', v));
  msState.jobTypes.forEach(v => p.append('type', v));
  // Always written, so even a search with no filters leaves a marker in the URL.
  p.set('sort', currentFilters.sort);
  if (currentFilters.postedWithinDays) p.set('posted', String(currentFilters.postedWithinDays));
  if (currentFilters.newSince) p.set('posted', 'new');
  if (currentFilters.remoteOnly) p.set('remote', '1');
  return '?' + p.toString();
}

// Sets a <select> only if the value is one of its options (URLs can be hand-edited).
function setSelectIfValid(id, value) {
  const sel = document.getElementById(id);
  if (value != null && [...sel.options].some(o => o.value === value)) sel.value = value;
}

// Checks the given values in a filter panel. Values with no matching checkbox are
// ignored, so a stale or edited URL can't put unknown values into the search.
function msSelect(id, stateKey, values) {
  const wanted = new Set(values);
  document.querySelectorAll(`#${id}_panel input[type="checkbox"]`).forEach(cb => {
    if (wanted.has(cb.value)) {
      cb.checked = true;
      msState[stateKey].add(cb.value);
    }
  });
  msRefresh(id, stateKey);
}

function applyQueryToForm(params) {
  document.getElementById('search_input').value = params.get('q') || '';
  setSelectIfValid('sort_select', params.get('sort'));
  setSelectIfValid('posted_select', params.get('posted'));
  document.getElementById('remote_only').checked = params.get('remote') === '1';
  msSelect('ms_location', 'locations', params.getAll('loc'));
  msSelect('ms_industry', 'industries', params.getAll('ind'));
  msSelect('ms_type', 'jobTypes', params.getAll('type'));
}

// ── Scroll position across refreshes ─────────────────────────────────────────
// Saved in sessionStorage (this tab only; cleared when it closes). We remember the
// card at the top of the screen, not just the pixel offset, because new listings
// from the daily refresh shift every row down under "Newest" sort.
function saveScrollSnapshot() {
  try {
    const cards = document.querySelectorAll('#job_list .jobs');
    // Nothing on screen (mid-load, or no results): keep the previous snapshot. If a
    // new search is loading, its URL already differs, so that snapshot won't apply.
    if (cards.length === 0) return;
    const anchor = [...cards].find(c => c.getBoundingClientRect().bottom > 0);
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify({
      query:     location.search,
      count:     cards.length,
      anchorId:  anchor?.dataset.listingId || null,
      anchorTop: anchor ? anchor.getBoundingClientRect().top : 0,
      scrollY:   window.scrollY,
    }));
  } catch (_) {}
}

// pagehide covers refresh and navigation. visibilitychange covers mobile browsers,
// which can kill a backgrounded tab without ever firing pagehide.
window.addEventListener('pagehide', saveScrollSnapshot);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveScrollSnapshot();
});

// Returns the saved snapshot only if it belongs to the search currently in the URL.
function readScrollSnapshot() {
  try {
    const snap = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null');
    return snap && snap.query === location.search ? snap : null;
  } catch (_) {
    return null;
  }
}

// Puts the saved card back at the same spot on screen, or falls back to the old
// pixel offset if that listing is gone or no longer within the restored rows.
function restoreScroll(snap) {
  const card = snap.anchorId &&
    document.querySelector(`#job_list .jobs[data-listing-id="${CSS.escape(snap.anchorId)}"]`);
  const y = card
    ? card.getBoundingClientRect().top + window.scrollY - (snap.anchorTop || 0)
    : snap.scrollY || 0;
  window.scrollTo(0, Math.max(0, y));
}

// On page load, rerun the search described by the URL, if there is one.
async function initFromUrl(locationsReady) {
  const params = new URLSearchParams(location.search);
  if (!URL_KEYS.some(k => params.has(k))) return;
  // Location checkboxes (and their DB patterns) only exist once the panel is built.
  if (params.has('loc')) await locationsReady;
  await visitReady;   // the "new" option only exists once the visit is known
  applyQueryToForm(params);
  performSearch({ restore: readScrollSnapshot() });
}

// Runs a fresh search with the current filters, replacing any existing results.
// With `restore` (a scroll snapshot), it reloads as many rows as were on screen
// before the refresh and scrolls back to where the user was.
async function performSearch({ restore = null } = {}) {
  document.getElementById('empty_state').style.display = 'none';
  await visitReady;

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
    postedWithinDays: postedVal && postedVal !== 'new' ? Number(postedVal) : null,
    newSince:         postedVal === 'new' ? newSince : null,
    remoteOnly:       document.getElementById('remote_only').checked,
  };
  currentOffset = 0;
  hasMore       = true;
  // Held true during the first fetch so the scroll marker (visible on a near-empty
  // page) can't start a loadMore for this same first page.
  isLoading     = true;
  const gen     = ++searchGen;

  history.replaceState(null, '', filtersToQuery());

  const jobList = document.getElementById('job_list');
  jobList.classList.add('visible');
  jobList.innerHTML = '<div class="no_results">Loading listings...</div>';

  // Restoring fetches all the pages in parallel (not one by one) so it's quick.
  const rows  = restore ? Math.min(Math.max(restore.count || 0, PAGE_SIZE), MAX_RESTORE_ROWS) : PAGE_SIZE;
  const pages = Math.ceil(rows / PAGE_SIZE);

  try {
    const results = await Promise.all(
      Array.from({ length: pages }, (_, i) => fetchJobs(currentFilters, i * PAGE_SIZE, PAGE_SIZE)));
    if (gen !== searchGen) return;   // a newer search started while this one loaded

    // Stop at the first short page; anything after it would leave a gap.
    const jobs = [];
    for (const page of results) {
      jobs.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    renderResults(jobs, false);
    currentOffset = jobs.length;
    hasMore = jobs.length === pages * PAGE_SIZE;
    if (restore) restoreScroll(restore);
  } catch (err) {
    if (gen !== searchGen) return;
    console.error('Search failed:', err);
    jobList.innerHTML = '<div class="no_results">Could not load listings. Please try again.</div>';
    hasMore = false;
  }

  isLoading = false;
  maybeLoadMore();
}

// Fetches the next page of results and appends them below the existing ones
async function loadMore() {
  if (isLoading || !hasMore) return;
  isLoading = true;
  const gen = searchGen;

  const loadingMsg = document.createElement('div');
  loadingMsg.id = 'load_more_msg';
  loadingMsg.className = 'no_results';
  loadingMsg.textContent = 'Loading more...';
  document.getElementById('job_list').appendChild(loadingMsg);

  try {
    const jobs = await fetchJobs(currentFilters, currentOffset, PAGE_SIZE);
    if (gen !== searchGen) return;   // results belong to an older search; drop them
    loadingMsg.remove();
    renderResults(jobs, true);
    currentOffset += jobs.length;
    hasMore = jobs.length === PAGE_SIZE;
  } catch {
    if (gen !== searchGen) return;
    loadingMsg.remove();
    // Stop auto-retrying; otherwise a visible marker would loop on a failing request.
    // Scrolling away and back (re-entering view) tries again.
    isLoading = false;
    return;
  }

  isLoading = false;
  maybeLoadMore();
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
    if (job.id) div.dataset.listingId = job.id;   // anchor for scroll restore
    div.innerHTML = `
      <div class="left_jobs">
        <div class="info_title">${isNewListing(job) ? '<span class="new_badge">New</span>' : ''}${esc(job.title)}</div>
        <div class="info_company">${esc(job.company)}</div>
        <div class="info_location">${esc(job.location || 'Location not listed')}</div>
        ${payBadgeHtml(job.pay)}
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
        <div class="info_rate">${esc(postedLabel(job))}</div>
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

// ── Saved jobs ───────────────────────────────────────────────────────────────
// A bookmarked shortlist, separate from "applied". Mirrors the applied-state
// pattern: localStorage `si_saved` is the synchronous source the cards read on
// render, and Supabase is kept in sync in the background when signed in.

// listing_id -> full job row for the current results, so toggleSaved can build a
// saved entry without re-fetching.
const jobById = {};

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

// Adds or removes one listing in the local saved cache. Only touches that one
// listing, so undoing a failed save can't wipe out a different card's change.
function setLocalSaved(listingId, isSaved) {
  const saved = JSON.parse(localStorage.getItem('si_saved') || '[]')
    .filter(s => s.listingId !== listingId);
  const job = jobById[listingId];
  if (isSaved && job) saved.push(toSavedEntry(job));
  localStorage.setItem('si_saved', JSON.stringify(saved));
}

// Bookmarks or un-bookmarks a listing. Flips the button and localStorage right away,
// then syncs to Supabase when signed in, undoing the flip if that fails. Safe to call
// for logged-out users (local only).
async function toggleSaved(btn) {
  const listingId = btn.dataset.listingId;
  if (!listingId) return;

  const already = getSavedIds().has(listingId);
  setLocalSaved(listingId, !already);
  setSavedBtnState(btn, !already);

  // Disabled until the server answers, so a fast second click can't send a save and
  // an unsave that reach the server in the wrong order.
  btn.disabled = true;
  const user = await signedInUser();
  if (!user) {
    btn.disabled = false;
    return;
  }

  const { error } = already
    ? await client.from('saved_jobs').delete().eq('user_id', user.id).eq('listing_id', listingId)
    : await client.from('saved_jobs')
        .upsert({ user_id: user.id, listing_id: listingId }, { onConflict: 'user_id,listing_id' });
  btn.disabled = false;

  if (error) {
    setLocalSaved(listingId, already);
    setSavedBtnState(btn, already);
    showSyncError(already ? 'Couldn’t remove this from your saved jobs.' : 'Couldn’t save this job.', error);
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
    url:       jobById[btn.dataset.listingId]?.url || '',
    position:  btn.dataset.title,
    company:   btn.dataset.company,
    location:  btn.dataset.location,
    pay:       btn.dataset.pay || 'Not listed',
    date_applied: todayLocal(),   // marking it applied = applied today
    status:    'Pending',
    notes:     '',
    cycle:     CURRENT_CYCLE,
  };

  btn.disabled = true;   // until saved, so a double click can't add it twice
  const user = await signedInUser();
  if (user) {
    const { data, error } = await client.from('applications')
      .insert(toApplicationRow(entry, user.id)).select().single();

    if (error) {
      btn.disabled = false;
      showSyncError(`Couldn’t add “${entry.position}” to your tracker.`, error);
      return;
    }
    entry.id = data.id;
    btn.dataset.appId = data.id;
  }
  btn.disabled = false;

  const apps = JSON.parse(localStorage.getItem('si_applications') || '[]');
  apps.push(entry);
  localStorage.setItem('si_applications', JSON.stringify(apps));

  btn.textContent = 'Applied ✓';
  btn.classList.add('applied');
}

// Removes the application from the DB and localStorage, then resets the button to
// its default state. If the DB delete fails, it stays applied.
async function unmarkApplied(btn) {
  const appId = btn.dataset.appId;

  btn.disabled = true;
  const user = await signedInUser();
  if (user && appId) {
    const { error } = await client.from('applications').delete().eq('id', appId);
    if (error) {
      btn.disabled = false;
      showSyncError('Couldn’t remove this from your tracker.', error);
      return;
    }
  }

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

  btn.disabled = false;
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

const locationsReady = loadLocationFilter();

// If the URL describes a search (refresh, back button, shared link), run it again.
initFromUrl(locationsReady);

// Refresh the saved-jobs cache from Supabase so bookmarks render correctly.
syncSavedFromCloud();
