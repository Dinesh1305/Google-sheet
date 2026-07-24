/**
 * lib/logger.js
 * ------------------------------------------------------------------
 * Minimal logging helper.  Every module imports the same `log`
 * function; when debug logging is disabled the calls become no-ops,
 * so there is zero overhead in production usage.
 */

let _debug = false;

/** Enable or disable verbose (debug) logging. */
export function setDebugEnabled(enabled) {
  _debug = !!enabled;
}

/** Tagged info log – always shown. */
export function log(tag, ...args) {
  // eslint-disable-next-line no-console
  console.log(`%c[SheetsAutoFill:${tag}]`, "color:#1a73e8;font-weight:bold", ...args);
}

/** Debug log – only shown when debug logging is enabled. */
export function debug(tag, ...args) {
  if (!_debug) return;
  // eslint-disable-next-line no-console
  console.debug(`%c[SheetsAutoFill:${tag}]`, "color:#999", ...args);
}

/** Error log – always shown. */
export function error(tag, ...args) {
  // eslint-disable-next-line no-console
  console.error(`[SheetsAutoFill:${tag}]`, ...args);
}
