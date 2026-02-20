/**
 * @fileoverview StorageAdapter — Focus Timer Core
 *
 * Provides a unified, type-safe abstraction over chrome.storage.local.
 * All reads and writes across the extension go through this module.
 * This ensures data integrity, centralises schema definitions, and
 * makes it trivial to swap storage backends in the future.
 *
 * @module core/storageAdapter
 */

'use strict';

// ─── Storage Keys ─────────────────────────────────────────────────────────────

/** @enum {string} All storage keys used by the extension. */
export const KEYS = Object.freeze({
  STATE:       'focusState',
  STATS:       'focusStats',
  SESSIONS:    'sessions',
  SITES:       'distractingSites',
  WEEKLY:      'weeklyData',
  PATTERNS:    'patterns',
  REFLECTIONS: 'reflections',
  SCHEMA_VER:  'schemaVersion',
});

/** Current storage schema version. Bump when making breaking changes. */
export const SCHEMA_VERSION = 2;

// ─── Default Structures ───────────────────────────────────────────────────────

/** @type {string[]} Default set of distracting domains. */
export const DEFAULT_SITES = Object.freeze([
  'youtube.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'reddit.com', 'tiktok.com', 'netflix.com', 'twitch.tv', 'hulu.com',
  'pinterest.com', 'snapchat.com', 'linkedin.com',
]);

/**
 * @typedef {Object} FocusState
 * @property {'idle'|'running'|'paused'} status
 * @property {number} duration - Total session duration in seconds
 * @property {number} remaining - Remaining seconds
 * @property {number|null} startedAt - Unix ms timestamp
 * @property {number|null} pausedAt - Unix ms timestamp
 * @property {number} elapsedBeforePause - Seconds elapsed before last pause
 * @property {SessionObject|null} currentSession
 * @property {PendingReflection|null} pendingReflection
 */

/** @returns {FocusState} Fresh default state object. */
export function defaultState() {
  return {
    status: 'idle',
    duration: 25 * 60,
    remaining: 25 * 60,
    startedAt: null,
    pausedAt: null,
    elapsedBeforePause: 0,
    currentSession: null,
    pendingReflection: null,
  };
}

/**
 * @typedef {Object} DailyStats
 * @property {string} date - ISO date string YYYY-MM-DD
 * @property {number} totalFocusMinutes
 * @property {number} sessionsCompleted
 * @property {number} totalTabSwitches
 * @property {number} totalDistractionVisits
 * @property {number} totalDistractionSeconds
 * @property {number} streak
 */

/** @returns {Patterns} Fresh pattern aggregation object. */
export function defaultPatterns() {
  return {
    focusMinutesByHour: Array(24).fill(0),
    focusMinutesByDay:  Array(7).fill(0),
    distractionByHour:  Array(24).fill(0),
    sessionsByHour:     Array(24).fill(0),
    scoresByHour:       Array(24).fill(0),
  };
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Reads one or more keys from chrome.storage.local.
 *
 * @param {string|string[]} keys - Single key or array of keys to retrieve.
 * @returns {Promise<Object>} Object with the requested key/value pairs.
 */
export async function get(keys) {
  return chrome.storage.local.get(keys);
}

/**
 * Writes one or more key/value pairs to chrome.storage.local.
 *
 * @param {Object} items - Key/value map to persist.
 * @returns {Promise<void>}
 */
export async function set(items) {
  return chrome.storage.local.set(items);
}

/**
 * Reads a single key and returns its value (or a fallback).
 *
 * @template T
 * @param {string} key
 * @param {T} [fallback] - Value to return when key is missing.
 * @returns {Promise<T>}
 */
export async function getValue(key, fallback = null) {
  const result = await chrome.storage.local.get(key);
  return result[key] !== undefined ? result[key] : fallback;
}

/**
 * Writes a single key/value pair.
 *
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function setValue(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

/**
 * Reads a key, applies a pure updater function, and writes the result back.
 * Useful for atomic-style updates on non-concurrent storage.
 *
 * @template T
 * @param {string} key
 * @param {T} fallback - Default value if the key does not exist.
 * @param {function(T): T} updater - Pure function receiving current value, returning new value.
 * @returns {Promise<T>} The updated value.
 */
export async function update(key, fallback, updater) {
  const current = await getValue(key, fallback);
  const next = updater(current);
  await setValue(key, next);
  return next;
}

// ─── Typed Accessors ─────────────────────────────────────────────────────────

/**
 * Retrieves the current FocusState, returning a fresh default if absent.
 *
 * @returns {Promise<FocusState>}
 */
export async function getState() {
  const r = await chrome.storage.local.get(KEYS.STATE);
  return r[KEYS.STATE] || defaultState();
}

/**
 * Merges a partial patch into the current FocusState and persists it.
 *
 * @param {Partial<FocusState>} patch
 * @returns {Promise<FocusState>} The merged state.
 */
export async function patchState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  await setValue(KEYS.STATE, next);
  return next;
}

/**
 * Retrieves the distracting sites list, returning defaults if absent.
 *
 * @returns {Promise<string[]>}
 */
export async function getDistractingSites() {
  const r = await chrome.storage.local.get(KEYS.SITES);
  return r[KEYS.SITES] || [...DEFAULT_SITES];
}

/**
 * Retrieves the pattern aggregation data.
 *
 * @returns {Promise<Patterns>}
 */
export async function getPatterns() {
  const r = await chrome.storage.local.get(KEYS.PATTERNS);
  return r[KEYS.PATTERNS] || defaultPatterns();
}

/**
 * Retrieves the weekly aggregated data, resetting when the week has rolled over.
 *
 * @returns {Promise<WeeklyData>}
 */
export async function getWeeklyData() {
  const wk = _weekKey();
  const r  = await chrome.storage.local.get(KEYS.WEEKLY);
  const data = r[KEYS.WEEKLY];
  if (!data || data.weekStart !== wk) {
    const fresh = { weekStart: wk, days: {} };
    await setValue(KEYS.WEEKLY, fresh);
    return fresh;
  }
  return data;
}

/**
 * Retrieves all stored sessions.
 *
 * @returns {Promise<SessionObject[]>}
 */
export async function getSessions() {
  const r = await chrome.storage.local.get(KEYS.SESSIONS);
  return r[KEYS.SESSIONS] || [];
}

/**
 * Appends a completed session to the sessions list, capping at 200 entries.
 *
 * @param {SessionObject} session
 * @returns {Promise<SessionObject[]>} Updated sessions array.
 */
export async function appendSession(session) {
  const sessions = await getSessions();
  sessions.push(session);
  if (sessions.length > 200) sessions.splice(0, sessions.length - 200);
  await setValue(KEYS.SESSIONS, sessions);
  return sessions;
}

/**
 * Retrieves all saved reflections keyed by sessionId.
 *
 * @returns {Promise<Record<string, {text: string, savedAt: number}>>}
 */
export async function getReflections() {
  const r = await chrome.storage.local.get(KEYS.REFLECTIONS);
  return r[KEYS.REFLECTIONS] || {};
}

/**
 * Saves a reflection for a given session.
 *
 * @param {string} sessionId
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function saveReflection(sessionId, text) {
  const refs = await getReflections();
  refs[sessionId] = { text, savedAt: Date.now() };
  await setValue(KEYS.REFLECTIONS, refs);
}

// ─── Schema Migration ─────────────────────────────────────────────────────────

/**
 * Runs any pending data migrations for backward compatibility.
 * Safe to call on every startup — no-ops when schema is current.
 *
 * @returns {Promise<void>}
 */
export async function migrate() {
  const version = await getValue(KEYS.SCHEMA_VER, 1);

  if (version < 2) {
    // v1 → v2: weekly data gained qualityCounts per day
    const weekly = await getValue(KEYS.WEEKLY, null);
    if (weekly?.days) {
      for (const day of Object.values(weekly.days)) {
        if (!day.qualityCounts) {
          day.qualityCounts = { 'Deep Work': 0, 'Focused': 0, 'Fragmented': 0, 'Distracted': 0 };
        }
      }
      await setValue(KEYS.WEEKLY, weekly);
    }
    await setValue(KEYS.SCHEMA_VER, 2);
    console.info('[FocusTimer] Migrated storage schema to v2');
  }
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/** @returns {string} ISO date string of the current Monday (week anchor). */
function _weekKey() {
  const d   = new Date();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return mon.toISOString().slice(0, 10);
}
