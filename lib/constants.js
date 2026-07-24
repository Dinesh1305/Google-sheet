/**
 * lib/constants.js
 * ------------------------------------------------------------------
 * Shared constants used across the popup, background service worker,
 * and content script.  Keeping these in one place avoids magic strings
 * scattered through the codebase and makes future renaming trivial.
 */

/** Top-level keys under chrome.storage.local. */
export const STORAGE_KEYS = {
  SETTINGS: "settings",
  LAST_RUN: "lastRun",
};

/** Message types exchanged between popup <-> background <-> content. */
export const MSG = {
  // popup -> background
  FILL_SHEET: "FILL_SHEET",
  GET_STATE: "GET_STATE",
  // background -> popup (broadcast)
  PROGRESS: "PROGRESS",
  SUCCESS: "SUCCESS",
  ERROR: "ERROR",
  // background -> content
  EXTRACT_DATA: "EXTRACT_DATA",
  // content -> background
  DATA_RESULT: "DATA_RESULT",
};

/** Default settings written on first install. */
export const DEFAULT_SETTINGS = {
  spreadsheetUrl: "",
  startingColumn: "A",
  startingRow: 1,
  autoFindNextEmptyRow: true,
  keystrokeDelayMs: 25,
  debugLogs: false,
};

/** Maximum number of times to retry while waiting for Sheets to load. */
export const MAX_SHEET_LOAD_RETRIES = 40;

/** Delay (ms) between two load-detection retries. */
export const SHEET_LOAD_RETRY_DELAY_MS = 500;

/** Delay (ms) after switching tabs before probing the DOM. */
export const TAB_SWITCH_SETTLE_MS = 800;

/** Column letters A-Z used for header/empty-row detection. */
export const COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
