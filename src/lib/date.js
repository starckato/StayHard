// QROK · date utilities
// Pure functions for date formatting. No app state. No DOM.
// Safely importable from anywhere; also exposed on window via src/main.js
// for inline-onclick compatibility during migration.

/**
 * Format a Date as YYYY-MM-DD (local timezone).
 * @param {Date} d
 * @returns {string}
 */
export function dkey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * Normalize a date-like string to YYYY-MM-DD prefix only.
 * @param {string|null|undefined} s
 * @returns {string|null}
 */
export function normKey(s) {
  return s ? s.slice(0, 10) : null;
}
