/**
 * @fileoverview VisualEnforcement Feature Module
 *
 * Coordinates all visual focus enforcement across browser tabs:
 *   - Injects content scripts into tabs that were open before the session started
 *   - Broadcasts focus state changes to all content scripts
 *   - Targets the active tab when showing the session-complete overlay
 *   - Falls back to a Chrome notification if the active tab is not injectable
 *
 * This module holds no business logic — it is purely a messaging coordinator.
 * All rendering decisions are made inside content.js.
 *
 * Subscribes to: onSessionStart, onSessionEnd, onFocusModeEnabled, onFocusModeDisabled
 *
 * @module features/visualEnforcement
 */

'use strict';

import * as storage       from '../../core/storageAdapter.js';
import { on, HOOKS }      from '../../core/eventBus.js';

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Wires up eventBus subscriptions for visual enforcement.
 * Call once from background.js during startup.
 */
export function init() {
  on(HOOKS.FOCUS_MODE_ENABLED, async () => {
    const [state, sites] = await Promise.all([
      storage.getState(),
      storage.getDistractingSites(),
    ]);
    await injectIntoAllTabs();
    await broadcastState(state, sites);
  });

  on(HOOKS.FOCUS_MODE_DISABLED, async () => {
    await broadcastCleanup();
  });
}

// ─── Tab Injection ────────────────────────────────────────────────────────────

/**
 * Returns true if a URL can receive content script injection.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isInjectableUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

/**
 * Ensures the content script is loaded in the given tab.
 * Uses a ping/inject pattern: if the content script responds to a ping,
 * it is already loaded; otherwise it is injected programmatically.
 *
 * @param {number} tabId
 * @param {string} url
 * @returns {Promise<boolean>} True if content script is now present.
 */
export async function ensureContentScript(tabId, url) {
  if (!isInjectableUrl(url)) return false;
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return resp?.loaded === true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
      return true;
    } catch { return false; }
  }
}

/**
 * Injects the content script into every currently open HTTP/HTTPS tab.
 * Safe to call repeatedly — tabs that already have the script loaded are skipped.
 *
 * @returns {Promise<void>}
 */
export async function injectIntoAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter(t => isInjectableUrl(t.url))
      .map(t => ensureContentScript(t.id, t.url))
  );
}

// ─── State Broadcasting ───────────────────────────────────────────────────────

/**
 * Sends the current focus state and sites list to all injectable tabs.
 * Content scripts use this to update their visual enforcement mode.
 *
 * @param {import('../../core/storageAdapter.js').FocusState} state
 * @param {string[]} sites
 * @returns {Promise<void>}
 */
export async function broadcastState(state, sites) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter(t => isInjectableUrl(t.url))
      .map(t => _msgTab(t.id, { action: 'applyFocusMode', state, sites }))
  );
}

/**
 * Tells all content scripts to remove all focus enforcement UI.
 *
 * @returns {Promise<void>}
 */
export async function broadcastCleanup() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter(t => isInjectableUrl(t.url))
      .map(t => _msgTab(t.id, { action: 'cleanupFocusMode' }))
  );
}

// ─── Session Complete Overlay ─────────────────────────────────────────────────

/**
 * Shows the in-page session-complete overlay in the currently active tab.
 * Falls back to a Chrome notification if the tab is not injectable.
 *
 * @param {{ sessionId: string, score: number, qualityLabel: string, duration: number }} data
 * @returns {Promise<boolean>} True if the overlay was successfully injected.
 */
export async function showSessionOverlay(data) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !isInjectableUrl(activeTab.url)) {
      return _notifyFallback(data);
    }
    await ensureContentScript(activeTab.id, activeTab.url);
    await chrome.tabs.sendMessage(activeTab.id, { action: 'showSessionOverlay', data });
    return true;
  } catch {
    return _notifyFallback(data);
  }
}

// ─── Private ──────────────────────────────────────────────────────────────────

/** Sends a message to a single tab, silently swallowing errors. */
async function _msgTab(tabId, payload) {
  try { await chrome.tabs.sendMessage(tabId, payload); } catch { /* no-op */ }
}

/** Shows a Chrome notification as a fallback when no tab can receive the overlay. */
function _notifyFallback({ duration, score, qualityLabel, sessionId }) {
  try {
    chrome.notifications.create(`focusComplete_${sessionId}`, {
      type:     'basic',
      iconUrl:  'icons/icon128.png',
      title:    `Focus Session Complete — ${qualityLabel}`,
      message:  `${Math.round(duration / 60)}m session · Score: ${score}. Open the extension to save your reflection.`,
      priority: 2,
    });
  } catch { /* notifications may be unavailable */ }
  return false;
}
