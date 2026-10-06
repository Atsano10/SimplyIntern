// Shared utilities loaded on every page.

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

// Styled, CSP-safe replacements for alert()/confirm().
//   showAlert(message[, title])   -> Promise (resolves when dismissed)
//   showConfirm(message[, title]) -> Promise<boolean> (true = confirmed)
function showModal({ title, message, confirmText = 'OK', cancelText = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'si_modal_overlay';

    const box = document.createElement('div');
    box.className = 'si_modal';

    if (title) {
      const h = document.createElement('div');
      h.className = 'si_modal_title';
      h.textContent = title;
      box.appendChild(h);
    }

    const msg = document.createElement('div');
    msg.className = 'si_modal_msg';
    msg.textContent = message;         // textContent — safe, never executes markup
    box.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'si_modal_actions';

    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };

    if (cancelText) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'si_modal_btn si_modal_cancel';
      cancelBtn.textContent = cancelText;
      cancelBtn.addEventListener('click', () => close(false));
      actions.appendChild(cancelBtn);
    }

    const okBtn = document.createElement('button');
    okBtn.className = 'si_modal_btn si_modal_confirm';
    okBtn.textContent = confirmText;
    okBtn.addEventListener('click', () => close(true));
    actions.appendChild(okBtn);

    box.appendChild(actions);
    overlay.appendChild(box);
    // Clicking the dimmed backdrop cancels.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    okBtn.focus();
  });
}

function showAlert(message, title)   { return showModal({ title, message, confirmText: 'OK' }); }
function showConfirm(message, title) { return showModal({ title, message, confirmText: 'Confirm', cancelText: 'Cancel' }); }

// Styled, CSP-safe text prompt. Resolves to the trimmed string, or null if cancelled.
function showPrompt({ title, message, placeholder = '', confirmText = 'OK', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'si_modal_overlay';

    const box = document.createElement('div');
    box.className = 'si_modal';

    if (title) {
      const h = document.createElement('div');
      h.className = 'si_modal_title';
      h.textContent = title;
      box.appendChild(h);
    }

    if (message) {
      const msg = document.createElement('div');
      msg.className = 'si_modal_msg';
      msg.textContent = message;
      box.appendChild(msg);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'si_modal_input';
    input.placeholder = placeholder;
    box.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'si_modal_actions';

    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter') close(input.value.trim() || null);
    };
    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'si_modal_btn si_modal_cancel';
    cancelBtn.textContent = cancelText;
    cancelBtn.addEventListener('click', () => close(null));
    actions.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.className = 'si_modal_btn si_modal_confirm';
    okBtn.textContent = confirmText;
    okBtn.addEventListener('click', () => close(input.value.trim() || null));
    actions.appendChild(okBtn);

    box.appendChild(actions);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    input.focus();
  });
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

// Turns any string (an email prefix, an old signup name) into a username that passes
// the rule, leaving room for `suffix`, a number added to dodge a name that's taken.
function toValidUsername(raw, suffix = '') {
  let base = String(raw || '').replace(/[^A-Za-z0-9_]/g, '_');
  if (/^_*$/.test(base)) base = 'user';   // nothing usable was left
  return (base.slice(0, 20 - suffix.length) + suffix).padEnd(3, '_');
}

// ── Recruitment cycles ────────────────────────────────────────────────────────
// Folders that always appear in the tracker.
// Named by when the internship STARTS (not when you apply). Students applying in
// late 2026 are targeting these. CURRENT_CYCLE is what the leaderboard counts —
// keep it in sync with the SQL literal in the latest cycles migration.
const PREDEFINED_CYCLES = ['2027 Summer', '2027 Spring', '2026 Winter'];
const CURRENT_CYCLE = '2027 Summer';

// ── Listing cards (Search + Saved) ────────────────────────────────────────────

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
