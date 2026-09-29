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
