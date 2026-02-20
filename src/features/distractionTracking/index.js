/**
 * @fileoverview DistractionTracking Feature Module
 *
 * Tracks when the user navigates to domains on their distraction list during
 * an active focus session. Records visit counts and time spent.
 *
 * This module subscribes to timer events via eventBus and manages its own
 * runtime state (distractionStart timestamp). It modifies focusState only
 * through the storageAdapter — never by calling timerEngine directly.
 *
 * @module features/distractionTracking
 */

'use strict';

import * as storage           from '../../core/storageAdapter.js';
import * as sessionMgr        from '../../core/sessionManager.js';
import { emit, on, HOOKS }    from '../../core/eventBus.js';

// ─── Runtime State ────────────────────────────────────────────────────────────

/** Unix ms when the current distraction period began, or null if not in distraction. */
let _distractionStart  = null;

/** tabId currently considered a distraction, or null. */
let _distractionTabId  = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialises the distraction tracking feature.
 * Subscribes to session end so we can flush any open distraction period.
 * Call once from background.js during startup.
 */
export function init() {
  // Flush distraction time when session ends naturally
  on(HOOKS.SESSION_END, () => _leaveDistraction());
}

/**
 * Extracts the registrable domain from a URL string.
 *
 * @param {string} url
 * @returns {string} Hostname without leading www., or '' on parse failure.
 */
export function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

/**
 * Returns true when a URL's domain is on the user's distraction list.
 *
 * @param {string} url
 * @param {string[]} sites - The current distracting sites list.
 * @returns {boolean}
 */
export function isDistracting(url, sites) {
  const domain = extractDomain(url);
  if (!domain) return false;
  return sites.some(s => domain === s || domain.endsWith('.' + s));
}

/**
 * Call when the user enters a distracting URL during an active session.
 * Records a visit and starts the distraction timer.
 *
 * @param {number} tabId
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function enterDistraction(tabId, url) {
  _distractionStart = Date.now();
  _distractionTabId = tabId;

  const state = await storage.getState();
  if (!state.currentSession) return;

  const domain     = extractDomain(url);
  const updated    = sessionMgr.recordDistractionVisit(state.currentSession, domain);
  await storage.patchState({ currentSession: updated });

  emit(HOOKS.DISTRACTION, { domain, tabId });
}

/**
 * Call when the user leaves a distracting site (navigates away or switches tab).
 * Accumulates distraction seconds into the current session.
 *
 * @returns {Promise<void>}
 */
export async function leaveDistraction() {
  return _leaveDistraction();
}

/**
 * Returns whether there is an active distraction period.
 *
 * @returns {boolean}
 */
export function isInDistraction() {
  return _distractionStart !== null;
}

/**
 * Returns the tabId currently marked as a distraction tab, or null.
 *
 * @returns {number|null}
 */
export function getDistractionTabId() {
  return _distractionTabId;
}

// ─── Private ──────────────────────────────────────────────────────────────────

async function _leaveDistraction() {
  if (_distractionStart === null) return;

  const elapsed = Math.round((Date.now() - _distractionStart) / 1000);
  _distractionStart = null;
  _distractionTabId = null;

  const state = await storage.getState();
  if (!state.currentSession) return;

  const updated = sessionMgr.addDistractionTime(state.currentSession, elapsed);
  await storage.patchState({ currentSession: updated });
}
