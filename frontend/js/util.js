// Shared utilities loaded on every page.

// Escapes strings before inserting them into innerHTML to prevent XSS.
// Turns HTML-significant characters into harmless display-only equivalents,
// so user-supplied text is always shown, never executed as markup.
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

// ── Recruitment cycles ────────────────────────────────────────────────────────
// Folders that always appear in the tracker. CURRENT_CYCLE is the one the
// leaderboard counts — keep it in sync with the SQL literal in migration 013.
const PREDEFINED_CYCLES = ['2026 Summer', '2026 Winter', '2026 Spring'];
const CURRENT_CYCLE = '2026 Summer';
