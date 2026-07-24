/**
 * lib/sheets.js
 * ------------------------------------------------------------------
 * Helpers for working with Google Sheets URLs and for converting
 * between column letters (A, B, …) and 1-based indices (1, 2, …).
 */

/**
 * Returns true when the given URL points to a Google Sheets document.
 * Works for both /spreadsheets/d/... and /d/.../edit style URLs.
 * @param {string} url
 * @returns {boolean}
 */
export function isGoogleSheetsUrl(url = "") {
  return /docs\.google\.com\/spreadsheets\//.test(url) ||
         /docs\.google\.com\/.*\b(d|spreadsheets)\b/.test(url);
}

/**
 * Convert a 1-based column index to a letter (1 -> "A", 27 -> "AA").
 * @param {number} index
 * @returns {string}
 */
export function columnLetter(index) {
  if (index < 1) throw new Error(`Invalid column index: ${index}`);
  let n = index;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/**
 * Convert a column letter to a 1-based index ("A" -> 1, "AA" -> 27).
 * @param {string} letter
 * @returns {number}
 */
export function columnIndex(letter = "A") {
  const upper = letter.toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) throw new Error(`Invalid column letter: ${letter}`);
  let result = 0;
  for (const ch of upper) result = result * 26 + (ch.charCodeAt(0) - 64);
  return result;
}
