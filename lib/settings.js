/**
 * lib/settings.js
 * ------------------------------------------------------------------
 * Thin async wrapper around chrome.storage.local for reading and
 * writing the extension's settings object.  All methods return
 * Promises so callers can use async/await.
 */

import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./constants.js";

/**
 * Read the current settings, merged on top of defaults so callers
 * never see `undefined` for any field.
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.SETTINGS] || {}) };
}

/**
 * Persist the given settings object, replacing any previous value.
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 * @returns {Promise<typeof DEFAULT_SETTINGS>} the merged settings after saving
 */
export async function saveSettings(patch = {}) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

/** Reset settings back to defaults. */
export async function resetSettings() {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}
