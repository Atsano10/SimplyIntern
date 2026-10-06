// saved.js — renders the user's bookmarked jobs (their shortlist). Cards reuse
// the search page's `.jobs` styling; the actions here are Mark Applied / Remove /
// View Listing. Source of truth is Supabase when signed in, else localStorage.

let savedJobs = [];

// Normalizes a listing row into the compact shape we persist in `si_saved`.
// Kept in sync with the identical helper in search.js (separate page, no shared import).
function toSavedEntry(job) {
  return {
    listingId: job.id,
    title:     job.title,
    company:   job.company,
    location:  job.location || '',
    url:       job.url || '',
    pay:       job.pay || '',
    posted_at: job.posted_at || null,
    type:      job.type || null,
  };
}

async function loadSaved() {
  try {
    const { data: { user } } = await client.auth.getUser();
    if (user) {
      const { data, error } = await client
        .from('saved_jobs')
        .select('created_at, listings(*)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (!error && data) {
        savedJobs = data.filter(r => r.listings).map(r => toSavedEntry(r.listings));
        localStorage.setItem('si_saved', JSON.stringify(savedJobs));
        renderSaved();
        return;
      }
    }
  } catch (_) {}

  // Logged out or Supabase unreachable — fall back to the local cache.
  savedJobs = JSON.parse(localStorage.getItem('si_saved') || '[]');
  renderSaved();
}

function renderSaved() {
  const list  = document.getElementById('saved_list');
  const empty = document.getElementById('saved_empty');

  if (!savedJobs.length) {
    list.innerHTML = '';
    list.classList.remove('visible');
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.classList.add('visible');
  list.innerHTML = '';

  const frag = document.createDocumentFragment();
  savedJobs.forEach(job => {
    const div = document.createElement('div');
    div.className = 'jobs';
    div.innerHTML = `
      <div class="left_jobs">
        <div class="info_title">${esc(job.title)}</div>
        <div class="info_company">${esc(job.company)}</div>
        <div class="info_location">${esc(job.location || 'Location not listed')}</div>
        ${payBadgeHtml(job.pay)}
      </div>
      <div class="center_jobs">
        <button class="apply_btn" data-listing-id="${esc(job.listingId || '')}">Mark Applied</button>
        <button class="save_btn saved" data-listing-id="${esc(job.listingId || '')}">✕ Remove</button>
      </div>
      <div class="right_jobs">
        <div class="info_rate">${esc(postedLabel(job))}</div>
        <a class="info_link" href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">View Listing</a>
      </div>
    `;
    div.querySelector('.apply_btn').addEventListener('click', function () { applyFromSaved(job, this); });
    div.querySelector('.save_btn').addEventListener('click', () => removeSaved(job.listingId));
    frag.appendChild(div);
  });
  list.appendChild(frag);
}

// Un-bookmarks a listing: removes the card right away, then deletes it in Supabase,
// putting the card back if that fails.
async function removeSaved(listingId) {
  const index = savedJobs.findIndex(s => s.listingId === listingId);
  if (index === -1) return;
  const [job] = savedJobs.splice(index, 1);
  localStorage.setItem('si_saved', JSON.stringify(savedJobs));
  renderSaved();

  const user = await signedInUser();
  if (!user) return;

  const { error } = await client.from('saved_jobs').delete()
    .eq('user_id', user.id).eq('listing_id', listingId);
  if (error) {
    savedJobs.splice(Math.min(index, savedJobs.length), 0, job);
    localStorage.setItem('si_saved', JSON.stringify(savedJobs));
    renderSaved();
    showSyncError(`Couldn’t remove “${job.title}” from your saved jobs.`, error);
  }
}

// Moves a saved job into the tracker (applications) and off the shortlist. If the
// tracker insert fails, the job stays saved and the button can be clicked again.
async function applyFromSaved(job, btn) {
  btn.disabled = true;

  const entry = {
    listingId: job.listingId,
    url:       job.url || '',
    position:  job.title,
    company:   job.company,
    location:  job.location || '',
    pay:       job.pay || 'Not listed',
    status:    'Pending',
    notes:     '',
    cycle:     CURRENT_CYCLE,
  };

  const user = await signedInUser();
  if (user) {
    const { data, error } = await client.from('applications').insert({
      user_id:    user.id,
      listing_id: entry.listingId,
      url:        entry.url || null,   // the DB also fills this from the listing
      position:   entry.position,
      company:    entry.company,
      location:   entry.location,
      pay:        entry.pay,
      status:     entry.status,
      notes:      entry.notes,
      cycle:      entry.cycle,
    }).select().single();
    if (error) {
      btn.disabled = false;
      showSyncError(`Couldn’t add “${job.title}” to your tracker.`, error);
      return;
    }
    entry.id = data.id;
  }

  const apps = JSON.parse(localStorage.getItem('si_applications') || '[]');
  apps.push(entry);
  localStorage.setItem('si_applications', JSON.stringify(apps));

  await removeSaved(job.listingId);   // now applied, so it leaves the shortlist
  await showAlert(`Added "${job.title}" to your tracker.`, 'Marked applied');
}

loadSaved();

// Re-sync if the browser restores this page from bfcache.
window.addEventListener('pageshow', (e) => { if (e.persisted) loadSaved(); });
