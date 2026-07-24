/**
 * background.js  (service worker – MV3)
 * ------------------------------------------------------------------
 * The background service worker is the "brain" of the extension.
 * It receives the FILL_SHEET command from the popup, orchestrates
 * the whole workflow (extract -> find tab -> switch -> wait -> fill
 * -> return -> notify), and broadcasts progress / success / error
 * messages back to the popup.
 *
 * Architecture
 * -------------
 *   popup.js  ──FILL_SHEET──►  background.js  ──EXTRACT_DATA──►  content.js
 *        ▲                          │                              │
 *        │                          │                              │
 *        └──PROGRESS/SUCCESS/ERROR──┘◄──DATA_RESULT────────────────┘
 *
 * Every step is async and uses chrome.tabs / chrome.scripting /
 * chrome.runtime messaging.  No DOM access happens in the worker.
 */

import {
  MSG,
  MAX_SHEET_LOAD_RETRIES,
  SHEET_LOAD_RETRY_DELAY_MS,
  TAB_SWITCH_SETTLE_MS,
} from "./lib/constants.js";
import { getSettings } from "./lib/settings.js";
import { isGoogleSheetsUrl } from "./lib/sheets.js";
import { log, debug, error, setDebugEnabled } from "./lib/logger.js";

const TAG = "bg";

/* ------------------------------------------------------------------ */
/*  Small utilities                                                     */
/* ------------------------------------------------------------------ */

/** Promise wrapper around chrome.tabs.query. */
const queryTabs = (queryInfo) =>
  new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));

/** Promise wrapper around chrome.tabs.update. */
const updateTab = (tabId, updateProps) =>
  new Promise((resolve) => chrome.tabs.update(tabId, updateProps, resolve));

/** Sleep helper. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Broadcast a message to the popup (no-op if the popup is closed). */
function broadcast(type, payload = {}) {
  chrome.runtime
    .sendMessage({ type, payload })
    .catch(() => { /* popup may be closed – ignore */ });
}

/**
 * Inject and run a function inside a tab and return its result.
 * Uses chrome.scripting.executeScript with a serialised function.
 */
async function runInTab(tabId, func, args = []) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: "MAIN",
  });
  return result;
}

/* ------------------------------------------------------------------ */
/*  Message router                                                      */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case MSG.FILL_SHEET:
        await handleFillSheet();
        sendResponse({ ok: true });
        break;
      case MSG.GET_STATE:
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  })();
  return true; // keep the channel open for the async response
});

/* ------------------------------------------------------------------ */
/*  Main orchestration                                                  */
/* ------------------------------------------------------------------ */

async function handleFillSheet() {
  const settings = await getSettings();
  setDebugEnabled(settings.debugLogs);

  try {
    log(TAG, "Workflow started");

    // 1. Identify the active tab (the source page).
    const [activeTab] = await queryTabs({ active: true, currentWindow: true });
    if (!activeTab) throw new Error("No active tab found.");
    debug(TAG, "Active source tab:", activeTab.id, activeTab.url);

    // 2. Extract data from the source page via the content script.
    broadcast(MSG.PROGRESS, { step: "Extracting data from page…" });
    const extracted = await extractDataFromTab(activeTab.id);
    if (!extracted || !extracted.values || extracted.values.length === 0) {
      throw new Error("Could not extract any data from this page.");
    }
    log(TAG, "Extracted data:", extracted);

    // 3. Find an already-open Google Sheets tab.
    broadcast(MSG.PROGRESS, { step: "Looking for an open Google Sheets tab…" });
    const sheetsTab = await findSheetsTab(settings.spreadsheetUrl);
    if (!sheetsTab) {
      throw new Error(
        "No open Google Sheets tab was found. Open your spreadsheet in a tab first."
      );
    }
    debug(TAG, "Sheets tab found:", sheetsTab.id, sheetsTab.url);

    // 4. Switch to the Sheets tab.
    broadcast(MSG.PROGRESS, { step: "Switching to Google Sheets…" });
    await updateTab(sheetsTab.id, { active: true });
    await sleep(TAB_SWITCH_SETTLE_MS);

    // 5. Wait until Sheets has finished loading.
    broadcast(MSG.PROGRESS, { step: "Waiting for Google Sheets to finish loading…" });
    await waitForSheetReady(sheetsTab.id);
    log(TAG, "Sheet is ready");

    // 6. Fill the next empty row.
    broadcast(MSG.PROGRESS, { step: "Filling the next empty row…" });
    await fillRow(sheetsTab.id, extracted.values, settings);

    // 7. Return focus to the original page.
    broadcast(MSG.PROGRESS, { step: "Returning to the original page…" });
    await updateTab(activeTab.id, { active: true });

    // 8. Success notification.
    broadcast(MSG.SUCCESS, { rows: extracted.values.length });
    notify("Sheets Auto-Filler", `Filled ${extracted.values.length} row(s) successfully.`);
    log(TAG, "Workflow completed successfully");
  } catch (err) {
    error(TAG, err);
    broadcast(MSG.ERROR, { message: err.message || String(err) });
    notify("Sheets Auto-Filler — Error", err.message || String(err), true);
  }
}

/* ------------------------------------------------------------------ */
/*  Step 2 – extract data from the source page                          */
/* ------------------------------------------------------------------ */

async function extractDataFromTab(tabId) {
  // The content script is already injected on http(s) pages via the
  // manifest.  We simply ask it to extract data.
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: MSG.EXTRACT_DATA },
      (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) return reject(new Error(lastError.message));
        if (!response || !response.ok) return reject(new Error(response?.error || "Extraction failed."));
        resolve(response.data);
      }
    );
  });
}

/* ------------------------------------------------------------------ */
/*  Step 3 – find an open Google Sheets tab                             */
/* ------------------------------------------------------------------ */

async function findSheetsTab(configuredUrl) {
  const tabs = await queryTabs({});
  debug(TAG, "Open tabs:", tabs.map((t) => t.url));

  // If the user configured a specific spreadsheet URL, match by it.
  if (configuredUrl) {
    const target = normaliseUrl(configuredUrl);
    const match = tabs.find((t) => t.url && normaliseUrl(t.url).startsWith(target));
    if (match) return match;
  }

  // Otherwise fall back to any tab that looks like Google Sheets.
  return tabs.find((t) => t.url && isGoogleSheetsUrl(t.url)) || null;
}

/** Strip query strings and trailing slashes for comparison. */
function normaliseUrl(url) {
  return url.split("#")[0].split("?")[0].replace(/\/$/, "");
}

/* ------------------------------------------------------------------ */
/*  Step 5 – wait for Google Sheets to finish loading                    */
/* ------------------------------------------------------------------ */

async function waitForSheetReady(tabId) {
  for (let attempt = 1; attempt <= MAX_SHEET_LOAD_RETRIES; attempt++) {
    const ready = await runInTab(tabId, sheetReadyProbe);
    debug(TAG, `sheetReady attempt ${attempt}:`, ready);
    if (ready) return;
    await sleep(SHEET_LOAD_RETRY_DELAY_MS);
  }
  throw new Error("Google Sheets did not finish loading in time.");
}

/**
 * Runs in the page.  Returns true when the Sheets grid is interactive.
 * We look for the main grid element and the absence of the loading
 * overlay.  This function is stringified by chrome.scripting, so it
 * cannot reference outer-scope variables.
 */
function sheetReadyProbe() {
  const grid = document.querySelector(".grid-scrollable-wrapper, .waffle, [class*='grid-container']");
  const loading = document.querySelector(".docs-loading, .loading-screen, .docs-butterbar-butter");
  const hasCells = document.querySelectorAll(".cell-input, .waffle-grid, .docs-sheet, .grid-row").length > 0;
  return !!(grid && !loading && hasCells);
}

/* ------------------------------------------------------------------ */
/*  Step 6 – fill the next empty row                                     */
/* ------------------------------------------------------------------ */

async function fillRow(tabId, rows, settings) {
  // First, discover the next empty row (or use the configured start).
  const startRow = settings.autoFindNextEmptyRow
    ? await findNextEmptyRow(tabId, settings)
    : settings.startingRow;

  const startColIdx = columnLetterToIndex(settings.startingColumn);

  log(TAG, `Filling starting at row ${startRow}, column ${settings.startingColumn}`);

  for (let r = 0; r < rows.length; r++) {
    const rowData = rows[r];
    const targetRow = startRow + r;

    // Move to the starting cell of this row.
    await focusCell(tabId, targetRow, startColIdx);

    for (let c = 0; c < rowData.length; c++) {
      const value = String(rowData[c] ?? "");

      // Type the value, then Tab to the next column.
      await typeIntoCell(tabId, value, settings.keystrokeDelayMs);

      if (c < rowData.length - 1) {
        await sendKey(tabId, "Tab");
        await sleep(settings.keystrokeDelayMs);
      }
    }

    // Move down to the next row (Enter) so the next iteration starts fresh.
    if (r < rows.length - 1) {
      await sendKey(tabId, "Enter");
      await sleep(settings.keystrokeDelayMs);
    }
  }

  // Optional: prevent duplicate entries by storing a fingerprint.
  await saveLastRun(rows);
}

/** Convert a column letter ("A") to a 1-based index (1). */
function columnLetterToIndex(letter) {
  const upper = (letter || "A").toUpperCase();
  let result = 0;
  for (const ch of upper) result = result * 26 + (ch.charCodeAt(0) - 64);
  return result;
}

/**
 * Ask the page to focus the cell at (row, col).
 * We use the Sheets keyboard shortcut: Ctrl+G opens the "go to" box,
 * but the most reliable cross-version method is clicking the cell
 * via its aria-label / row+col attributes.
 */
async function focusCell(tabId, row, col) {
  await runInTab(
    tabId,
    (r, c) => {
      // Google Sheets exposes cells as <div role="gridcell"> with
      // aria-rowindex / aria-colindex attributes.
      const cell = document.querySelector(
        `div[role="gridcell"][aria-rowindex="${r}"][aria-colindex="${c}"]`
      );
      if (cell) {
        cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        cell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        cell.click();
        return true;
      }
      // Fallback: use the keyboard "go to" command.
      return false;
    },
    [row, col]
  );
  await sleep(120);
}

/** Simulate typing text into the currently focused cell. */
async function typeIntoCell(tabId, text, delayMs) {
  await runInTab(
    tabId,
    (value, delay) => {
      // Sheets listens to document-level keydown / input events.
      const target = document.querySelector("input.grid-cell-input, textarea.grid-cell-input, .cell-input") ||
        document.activeElement;
      if (!target) return false;

      // Put focus on the input and set its value.
      target.focus();

      // Use the Sheets text input directly when available.
      if ("value" in target) {
        // Simulate character-by-character input so Sheets records it.
        const setter = Object.getOwnPropertyDescriptor(
          target.__proto__ || Object.getPrototypeOf(target),
          "value"
        )?.set;
        for (const ch of value) {
          if (setter) setter.call(target, target.value + ch);
          else target.value += ch;
          target.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch }));
        }
      } else {
        // ContentEditable fallback.
        for (const ch of value) {
          target.dispatchEvent(
            new KeyboardEvent("keydown", { key: ch, bubbles: true })
          );
          target.dispatchEvent(
            new InputEvent("input", { bubbles: true, data: ch })
          );
        }
      }
      return true;
    },
    [text, delayMs]
  );
  await sleep(delayMs);
}

/** Send a single non-character key (Tab / Enter / Arrow…) to the page. */
async function sendKey(tabId, key) {
  await runInTab(
    tabId,
    (k) => {
      const target = document.activeElement || document.body;
      const opts = { key: k, code: k, keyCode: k === "Tab" ? 9 : 13, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent("keydown", opts));
      target.dispatchEvent(new KeyboardEvent("keyup", opts));
      return true;
    },
    [key]
  );
}

/**
 * Detect the next empty row by scanning the first column's cells.
 * Runs inside the page.
 */
async function findNextEmptyRow(tabId, settings) {
  const result = await runInTab(
    tabId,
    (startRow, startCol) => {
      const cells = document.querySelectorAll('div[role="gridcell"][aria-colindex="' + startCol + '"]');
      let maxRow = startRow;
      for (const cell of cells) {
        const r = Number(cell.getAttribute("aria-rowindex") || 0);
        if (r >= startRow) {
          const txt = (cell.textContent || "").trim();
          if (txt === "") return r; // first empty cell -> use it
          if (r > maxRow) maxRow = r;
        }
      }
      return maxRow + 1; // after the last filled row
    },
    [settings.startingRow, columnLetterToIndex(settings.startingColumn)]
  );
  return result || settings.startingRow;
}

/** Persist a fingerprint of the last run to help prevent duplicates. */
async function saveLastRun(rows) {
  const fingerprint = JSON.stringify(rows).slice(0, 500);
  await chrome.storage.local.set({ lastRun: { time: Date.now(), fingerprint } });
}

/* ------------------------------------------------------------------ */
/*  Notifications                                                       */
/* ------------------------------------------------------------------ */

function notify(title, message, isError = false) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      priority: isError ? 0 : 2,
    });
  } catch (e) {
    // notifications permission may not be granted in some contexts
    error(TAG, "Notification failed:", e);
  }
}

/* ------------------------------------------------------------------ */
/*  First-install defaults                                              */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(async () => {
  log(TAG, "Extension installed – writing default settings");
  const { STORAGE_KEYS, DEFAULT_SETTINGS } = await import("./lib/constants.js");
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  if (!stored[STORAGE_KEYS.SETTINGS]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
});
