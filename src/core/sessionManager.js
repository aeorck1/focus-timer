/**
 * @fileoverview SessionManager — Focus Timer Core
 *
 * Responsible for creating, updating, completing and persisting session objects.
 * Also manages the daily stats record and streak calculation.
 *
 * SessionManager does NOT manage alarms or timers — that is timerEngine's job.
 * It does NOT calculate scores — that is scoringEngine's job.
 * It communicates outcomes via the eventBus.
 *
 * @module core/sessionManager
 */

'use strict';

import * as storage  from './storageAdapter.js';
import * as scoring  from './scoringEngine.js';
import { emit, HOOKS } from './eventBus.js';

// ─── ID Generation ────────────────────────────────────────────────────────────

/**
 * Generates a short, collision-resistant session ID.
 * Format: timestamp base-36 + 4 random base-36 chars.
 *
 * @returns {string}
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Session Factory ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} SessionObject
 * @property {string} id                     - Unique session identifier.
 * @property {number} startTime              - Unix ms when session began.
 * @property {number} duration               - Planned duration in seconds.
 * @property {number} tabSwitchCount         - Number of tab switches.
 * @property {number} distractionVisits      - Visits to distracting sites.
 * @property {number} distractionSeconds     - Total seconds on distracting sites.
 * @property {string|null} lastDistractionDomain
 * @property {boolean} interrupted           - Whether the session was paused.
 * @property {number} [endTime]              - Unix ms when session ended.
 * @property {boolean} [completed]           - True for naturally completed sessions.
 * @property {number} [score]                - Focus score (set on completion).
 * @property {string} [qualityLabel]         - Quality tier label (set on completion).
 */

/**
 * Creates a new, blank session object for a timer of `duration` seconds.
 *
 * @param {number} duration - Session duration in seconds.
 * @returns {SessionObject}
 */
export function createSession(duration) {
  return {
    id:                   generateId(),
    startTime:            Date.now(),
    duration,
    tabSwitchCount:       0,
    distractionVisits:    0,
    distractionSeconds:   0,
    lastDistractionDomain: null,
    interrupted:          false,
  };
}

/**
 * Returns a copy of the session with incremented tab switch counter.
 *
 * @param {SessionObject} session
 * @returns {SessionObject}
 */
export function recordTabSwitch(session) {
  return { ...session, tabSwitchCount: (session.tabSwitchCount || 0) + 1 };
}

/**
 * Returns a copy of the session with a distraction visit recorded.
 *
 * @param {SessionObject} session
 * @param {string} domain
 * @returns {SessionObject}
 */
export function recordDistractionVisit(session, domain) {
  return {
    ...session,
    distractionVisits:    (session.distractionVisits || 0) + 1,
    lastDistractionDomain: domain,
  };
}

/**
 * Returns a copy of the session with `seconds` added to distractionSeconds.
 *
 * @param {SessionObject} session
 * @param {number} seconds
 * @returns {SessionObject}
 */
export function addDistractionTime(session, seconds) {
  return { ...session, distractionSeconds: (session.distractionSeconds || 0) + seconds };
}

/**
 * Returns a copy of the session marked as interrupted (was paused).
 *
 * @param {SessionObject} session
 * @returns {SessionObject}
 */
export function markInterrupted(session) {
  return { ...session, interrupted: true };
}

// ─── Session Completion ───────────────────────────────────────────────────────

/**
 * Finalises a session: scores it, persists it, updates daily stats and
 * weekly data, and emits the onSessionEnd and onScoreCalculated hooks.
 *
 * @param {SessionObject} session - The session to complete.
 * @param {number} actualDuration - Actual duration in seconds (may differ from planned).
 * @returns {Promise<SessionObject>} The persisted, scored session.
 */
export async function completeSession(session, actualDuration) {
  const result  = scoring.score(session);
  const endTime = Date.now();

  const completed = {
    ...session,
    endTime,
    duration:     actualDuration,
    score:        result.score,
    qualityLabel: result.qualityLabel,
    completed:    true,
  };

  // Persist session record
  await storage.appendSession(completed);

  // Update daily stats
  await _updateDailyStats(completed, result.score);

  // Update weekly data
  await _updateWeeklyData(completed, result.score, result.qualityLabel);

  // Emit lifecycle hooks
  emit(HOOKS.SCORE_CALCULATED, { score: result.score, qualityLabel: result.qualityLabel, session: completed });
  emit(HOOKS.SESSION_END, { session: completed, score: result.score, qualityLabel: result.qualityLabel });

  return completed;
}

// ─── Daily Stats ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} DailyStats
 * @property {string} date
 * @property {number} totalFocusMinutes
 * @property {number} sessionsCompleted
 * @property {number} totalTabSwitches
 * @property {number} totalDistractionVisits
 * @property {number} totalDistractionSeconds
 * @property {number} streak
 */

/**
 * Retrieves today's DailyStats, rolling the record and computing streak when the day has changed.
 *
 * @returns {Promise<DailyStats>}
 */
export async function getDailyStats() {
  const today  = _todayKey();
  const stored = await storage.getValue(storage.KEYS.STATS, null);

  if (!stored || stored.date !== today) {
    const streak = _calcStreak(stored);
    const fresh  = {
      date: today, totalFocusMinutes: 0, sessionsCompleted: 0,
      totalTabSwitches: 0, totalDistractionVisits: 0, totalDistractionSeconds: 0,
      streak,
    };
    await storage.setValue(storage.KEYS.STATS, fresh);
    return fresh;
  }
  return stored;
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/** @returns {string} Today as YYYY-MM-DD */
function _todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Calculates the new streak based on the previous DailyStats record.
 * Streak increments if yesterday had ≥ 30 minutes of focus.
 *
 * @param {DailyStats|null} prev
 * @returns {number}
 */
function _calcStreak(prev) {
  if (!prev) return 0;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = yesterday.toISOString().slice(0, 10);
  return (prev.date === yKey && prev.totalFocusMinutes >= 30)
    ? (prev.streak || 0) + 1
    : 0;
}

/**
 * Applies a completed session to today's DailyStats.
 *
 * @param {SessionObject} session
 * @param {number} score
 */
async function _updateDailyStats(session, score) {
  const stats    = await getDailyStats();
  const focusMins = Math.round((session.duration || 0) / 60);
  const next = {
    ...stats,
    totalFocusMinutes:       stats.totalFocusMinutes + focusMins,
    sessionsCompleted:       stats.sessionsCompleted + 1,
    totalTabSwitches:        stats.totalTabSwitches + (session.tabSwitchCount || 0),
    totalDistractionVisits:  stats.totalDistractionVisits + (session.distractionVisits || 0),
    totalDistractionSeconds: stats.totalDistractionSeconds + (session.distractionSeconds || 0),
  };
  await storage.setValue(storage.KEYS.STATS, next);
}

/**
 * Aggregates a completed session into the weekly data store.
 * Ensures today's entry always exists in weekly.days so the UI can show it.
 *
 * @param {SessionObject} session
 * @param {number} score
 * @param {string} ql - qualityLabel
 */
async function _updateWeeklyData(session, score, ql) {
  const weekly = await storage.getWeeklyData();
  const today  = _todayKey();

  const prev = weekly.days[today] || {
    focusMinutes: 0, sessions: 0, distractionMinutes: 0,
    totalScore: 0, scoreCount: 0,
    qualityCounts: { 'Deep Work': 0, 'Focused': 0, 'Fragmented': 0, 'Distracted': 0 },
  };

  const qc = { ...prev.qualityCounts };
  qc[ql]   = (qc[ql] || 0) + 1;

  weekly.days[today] = {
    focusMinutes:       prev.focusMinutes + Math.round((session.duration || 0) / 60),
    sessions:           prev.sessions + 1,
    distractionMinutes: prev.distractionMinutes + Math.round((session.distractionSeconds || 0) / 60),
    totalScore:         prev.totalScore + score,
    scoreCount:         prev.scoreCount + 1,
    qualityCounts:      qc,
  };

  await storage.setValue(storage.KEYS.WEEKLY, weekly);
}

/**
 * Ensures today's date key exists in weekly.days (even with zero values).
 * Called on startup so the UI always shows today in the weekly chart.
 *
 * @returns {Promise<void>}
 */
export async function ensureTodayInWeekly() {
  const weekly = await storage.getWeeklyData();
  const today  = _todayKey();
  if (!weekly.days[today]) {
    weekly.days[today] = {
      focusMinutes: 0, sessions: 0, distractionMinutes: 0,
      totalScore: 0, scoreCount: 0,
      qualityCounts: { 'Deep Work': 0, 'Focused': 0, 'Fragmented': 0, 'Distracted': 0 },
    };
    await storage.setValue(storage.KEYS.WEEKLY, weekly);
  }
}
