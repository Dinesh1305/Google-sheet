/**
 * popup.js
 * ------------------------------------------------------------------
 * Controls the popup UI.  Responsibilities:
 *   • Show the main view (Fill Sheet / Settings buttons).
 *   • Show the settings view (load + save chrome.storage settings).
 *   • Send FILL_SHEET to the background worker and listen for
 *     PROGRESS / SUCCESS / ERROR broadcasts to update the UI.
 */

import { MSG, DEFAULT_SETTINGS } from "./lib/constants.js";
import { getSettings, saveSettings } from "./lib/settings.js";
import { log, error } from "./lib/logger.js";

const TAG = "popup";

/* ------------------------------------------------------------------ */
/*  DOM references                                                      */
/* ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);

const els = {
  statusIndicator: $("statusIndicator"),
  fillBtn:         $("fillBtn"),
  settingsBtn:     $("settingsBtn"),
  spinner:         $("spinner"),
  message:         $("message"),
  mainView:        $("mainView"),
  settingsView:   $("settingsView"),
  // settings fields
  spreadsheetUrl:      $("spreadsheetUrl"),
  startingColumn:      $("startingColumn"),
  startingRow:         $("startingRow"),
  autoFindNextEmptyRow:$("autoFindNextEmptyRow"),
  keystrokeDelay:      $("keystrokeDelay"),
  debugLogs:           $("debugLogs"),
  saveSettingsBtn:     $("saveSettingsBtn"),
  cancelSettingsBtn:   $("cancelSettingsBtn"),
  settingsMessage:     $("settingsMessage"),
};

/* ------------------------------------------------------------------ */
/*  Status helpers                                                      */
/* ------------------------------------------------------------------ */
function setStatus(state, title) {
  els.statusIndicator.className = "status-dot " + state;
  els.statusIndicator.title = title || "";
}

function showMessage(type, text) {
  els.message.className = "message " + type;
  els.message.textContent = text;
}

function clearMessage() {
  els.message.className = "message hidden";
  els.message.textContent = "";
}

function setBusy(busy) {
  els.fillBtn.disabled = busy;
  els.spinner.classList.toggle("hidden", !busy);
  setStatus(busy ? "busy" : "", busy ? "Working…" : "");
}

/* ------------------------------------------------------------------ */
/*  View switching                                                      */
/* ------------------------------------------------------------------ */
function showView(view) {
  const showMain = view === "main";
  els.mainView.classList.toggle("hidden", !showMain);
  els.settingsView.classList.toggle("hidden", showMain);
  if (showMain) clearMessage();
  else els.settingsMessage.classList.add("hidden");
}

/* ------------------------------------------------------------------ */
/*  Settings load / save                                                */
/* ------------------------------------------------------------------ */
async function loadSettingsIntoForm() {
  const s = await getSettings();
  els.spreadsheetUrl.value       = s.spreadsheetUrl;
  els.startingColumn.value       = s.startingColumn;
  els.startingRow.value          = s.startingRow;
  els.autoFindNextEmptyRow.checked = s.autoFindNextEmptyRow;
  els.keystrokeDelay.value       = s.keystrokeDelayMs;
  els.debugLogs.checked          = s.debugLogs;
}

async function handleSaveSettings() {
  const patch = {
    spreadsheetUrl:        els.spreadsheetUrl.value.trim(),
    startingColumn:        (els.startingColumn.value || "A").trim().toUpperCase(),
    startingRow:           Math.max(1, parseInt(els.startingRow.value, 10) || 1),
    autoFindNextEmptyRow:  els.autoFindNextEmptyRow.checked,
    keystrokeDelayMs:      Math.max(0, parseInt(els.keystrokeDelay.value, 10) || 0),
    debugLogs:             els.debugLogs.checked,
  };
  await saveSettings(patch);
  els.settingsMessage.className = "message success";
  els.settingsMessage.textContent = "Settings saved.";
  log(TAG, "Settings saved", patch);
}

/* ------------------------------------------------------------------ */
/*  Fill-sheet action                                                   */
/* ------------------------------------------------------------------ */
async function handleFill() {
  clearMessage();
  setBusy(true);
  try {
    await chrome.runtime.sendMessage({ type: MSG.FILL_SHEET });
    // The background worker will broadcast PROGRESS / SUCCESS / ERROR.
  } catch (err) {
    error(TAG, err);
    setBusy(false);
    setStatus("error", "Error");
    showMessage("error", err.message || String(err));
  }
}

/* ------------------------------------------------------------------ */
/*  Listen for broadcasts from the background worker                    */
/* ------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case MSG.PROGRESS:
      setBusy(true);
      showMessage("info", message.payload.step);
      break;

    case MSG.SUCCESS:
      setBusy(false);
      setStatus("ok", "Done");
      showMessage("success", `Success! Filled ${message.payload.rows} row(s).`);
      break;

    case MSG.ERROR:
      setBusy(false);
      setStatus("error", "Error");
      showMessage("error", message.payload.message);
      break;
  }
});

/* ------------------------------------------------------------------ */
/*  Wire up events                                                      */
/* ------------------------------------------------------------------ */
els.fillBtn.addEventListener("click", handleFill);
els.settingsBtn.addEventListener("click", () => { showView("settings"); loadSettingsIntoForm(); });
els.cancelSettingsBtn.addEventListener("click", () => showView("main"));
els.saveSettingsBtn.addEventListener("click", handleSaveSettings);

/* ------------------------------------------------------------------ */
/*  Init                                                                */
/* ------------------------------------------------------------------ */
(async () => {
  log(TAG, "Popup opened");
  await loadSettingsIntoForm(); // keep form in sync even if user never opens settings
  setStatus("", "Idle");
})();
