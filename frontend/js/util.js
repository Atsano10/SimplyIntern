// Shared utilities loaded on every page (before the page's own scripts).

// ── Escaping ─────────────────────────────────────────────────────────────────

// Escapes strings before inserting them into innerHTML to prevent XSS.
// Turns HTML-significant characters into harmless display-only equivalents,
// so user-supplied text is always shown, never executed as markup. Single quotes are
// escaped too, so it's also safe inside a single-quoted attribute (title='...').
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Dialogs ──────────────────────────────────────────────────────────────────
// Styled, CSP-safe replacements for alert() / confirm() / prompt():
//   showAlert(message[, title])   -> Promise (resolves when dismissed)
//   showConfirm(message[, title]) -> Promise<boolean> (true = confirmed)
//   showPrompt({ title, message, placeholder }) -> Promise<string | null> (null = cancelled)

// Builds the dialog. The promise resolves to confirmValue() for OK (button or Enter)
// and to cancelValue for cancel (button, Escape, or a click on the dimmed backdrop).
// Text goes in with textContent, so it's always shown, never run as markup.
function openDialog({ title, message, confirmText, cancelText, input, confirmValue, cancelValue }) {
  return new Promise((resolve) => {
    const div = (className, text) => {
      const el = document.createElement('div');
      el.className = className;
      if (text) el.textContent = text;
      return el;
    };
    const button = (className, text, onClick) => {
      const el = document.createElement('button');
      el.className = 'si_modal_btn ' + className;
      el.textContent = text;
      el.addEventListener('click', onClick);
      return el;
    };

    const overlay = div('si_modal_overlay');
    const box = div('si_modal');
    const actions = div('si_modal_actions');

    const onKey = (e) => {
      if (e.key === 'Escape') close(cancelValue);
      if (e.key === 'Enter') close(confirmValue());
    };
    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };

    if (title) box.appendChild(div('si_modal_title', title));
    if (message) box.appendChild(div('si_modal_msg', message));
    if (input) box.appendChild(input);
    if (cancelText) actions.appendChild(button('si_modal_cancel', cancelText, () => close(cancelValue)));
    const okBtn = button('si_modal_confirm', confirmText, () => close(confirmValue()));
    actions.appendChild(okBtn);
    box.appendChild(actions);
    overlay.appendChild(box);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(cancelValue); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    (input || okBtn).focus();
  });
}

function showModal({ title, message, confirmText = 'OK', cancelText = null }) {
  return openDialog({ title, message, confirmText, cancelText, confirmValue: () => true, cancelValue: false });
}

function showAlert(message, title)   { return showModal({ title, message, confirmText: 'OK' }); }
function showConfirm(message, title) { return showModal({ title, message, confirmText: 'Confirm', cancelText: 'Cancel' }); }

function showPrompt({ title, message, placeholder = '', confirmText = 'OK', cancelText = 'Cancel' }) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'si_modal_input';
  input.placeholder = placeholder;
  return openDialog({ title, message, confirmText, cancelText, input,
                      confirmValue: () => input.value.trim() || null, cancelValue: null });
}

// ── Saving to Supabase ───────────────────────────────────────────────────────

// The signed-in user, or null when signed out. Reads the session stored in this
// browser instead of asking the server (getUser), so a dropped connection makes the
// write fail visibly rather than looking like "signed out" and quietly saving the
// change only to localStorage, where the next load from the cloud would undo it.
async function signedInUser() {
  try {
    const { data } = await client.auth.getSession();
    return data.session?.user || null;
  } catch (_) {
    return null;
  }
}

// Warning bar for a change that didn't reach the server. `message` says what
// failed in plain words; the server's error text is added for debugging. Stays until
// dismissed, and a newer error replaces it.
function showSyncError(message, error) {
  document.getElementById('si_sync_banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'si_sync_banner';
  banner.className = 'si_sync_banner';
  banner.setAttribute('role', 'alert');

  const text = document.createElement('span');
  text.textContent = `⚠ ${message}` + (error?.message ? ` (${error.message})` : '');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'si_sync_close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => banner.remove());

  banner.append(text, closeBtn);
  document.body.appendChild(banner);
}

// ── Usernames ────────────────────────────────────────────────────────────────
// Same rule as the profiles_username_format CHECK in the database (migration 022),
// which is what actually enforces it. Checking here first just gives a clear message.
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const USERNAME_RULE = 'Usernames are 3–20 characters: letters, numbers, and underscores only.';

// What to tell the user for each answer from the check_username() database function
// (migration 025), which also checks case-insensitive uniqueness and offensive words.
const USERNAME_PROBLEMS = {
  format:    USERNAME_RULE,
  offensive: 'That username isn’t allowed. Please choose a different one.',
  taken:     'That username is already taken.',
};

// The message for a profile write the database rejected over a username rule (a name
// that got past check_username, e.g. taken a moment later), or null for other errors.
function usernameErrorMessage(error) {
  const msg = error?.message || '';
  if (msg.includes('profiles_username_key')) return USERNAME_PROBLEMS.taken;
  if (msg.includes('profiles_username_appropriate')) return USERNAME_PROBLEMS.offensive;
  return null;
}

// Turns any string (an email prefix, an old signup name) into a username that passes
// the rule, leaving room for `suffix`, a number added to dodge a name that's taken.
function toValidUsername(raw, suffix = '') {
  let base = String(raw || '').replace(/[^A-Za-z0-9_]/g, '_');
  if (/^_*$/.test(base)) base = 'user';   // nothing usable was left
  return (base.slice(0, 20 - suffix.length) + suffix).padEnd(3, '_');
}

// ── Recruitment cycles ────────────────────────────────────────────────────────
// Folders that always appear in the tracker, named by when the internship STARTS (not
// when you apply): students applying in late 2026 are targeting these. CURRENT_CYCLE is
// the one the leaderboard counts — keep it in sync with the cycle written into the
// leaderboard_counts view (migration 018).
const PREDEFINED_CYCLES = ['2027 Summer', '2027 Spring', '2026 Winter'];
const CURRENT_CYCLE = '2027 Summer';

// ── Applications ──────────────────────────────────────────────────────────────

// Interview-stage statuses ('Interview' is a legacy value older rows may still have).
const INTERVIEW_STATUSES = ['1st Round Interview', '2nd Round Interview', 'Interview'];
// Still waiting on a final answer ('Applied' is legacy). Same set the leaderboard counts
// as pending — keep in sync with leaderboard_counts in the database (migration 018).
const PENDING_STATUSES = ['Pending', 'Applied', ...INTERVIEW_STATUSES];

// Maintains the reached_interview milestone for an application based on its status:
// reaching any interview round turns it on; returning to Pending clears it (a restart);
// Accepted/Rejected leave it untouched, so an interview that ended in a later
// accept/reject still counts as an interview.
function applyInterviewMilestone(app) {
  if (app.status === 'Pending' || app.status === 'Applied') {
    app.reached_interview = false;
  } else if (INTERVIEW_STATUSES.includes(app.status)) {
    app.reached_interview = true;
  }
}

// The applications-table row for a tracker entry — the one place the field mapping
// lives (Search, Saved, the tracker's add/edit/upload, and CSV import all use it).
// Pass userId for an insert. Leave it out for an update: user_id and listing_id are
// set once, when the row is created.
function toApplicationRow(entry, userId) {
  const row = {
    url:               entry.url || null,   // the DB fills this from the listing when listing_id is set
    position:          entry.position,
    company:           entry.company,
    location:          entry.location,
    pay:               entry.pay,
    date_applied:      entry.date_applied || null,
    status:            entry.status,
    notes:             entry.notes,
    reached_interview: entry.reached_interview ?? false,
    cycle:             entry.cycle || CURRENT_CYCLE,
  };
  if (userId) {
    row.user_id    = userId;
    row.listing_id = entry.listingId || null;
  }
  return row;
}

// Today as YYYY-MM-DD in the user's own timezone. Not toISOString(), which is UTC:
// at 9pm in New York that's already tomorrow.
function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Adds https:// when someone pastes "www.site.com/job" without it.
function normalizeUrlInput(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v) && /^[\w-]+(\.[\w-]+)+(\/|\?|$)/.test(v)) return 'https://' + v;
  return v;
}

// ── Listing cards (Search + Saved) ────────────────────────────────────────────

// Normalizes a listing row into the compact shape we persist in `si_saved`.
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

// Open-source programs (type 'program') are standing programs with no posting date.
function postedLabel(job) {
  if (!job.posted_at && job.type === 'program') return 'Ongoing program';
  return timeAgo(job.posted_at);
}

// Pay badge for a card, or '' when pay isn't listed. Colored by meaning: Unpaid and
// tuition (the student pays) are flagged so they don't read as paid internships.
function payBadgeHtml(pay) {
  if (!pay) return '';
  const kind = /^unpaid/i.test(pay) ? 'unpaid' : /^tuition/i.test(pay) ? 'tuition' : 'paid';
  return `<div class="info_pay ${kind}">${esc(pay)}</div>`;
}
