/**
 * @fileoverview InsightsEngine — Focus Timer Feature Module
 *
 * Aggregates session data into hourly/daily usage patterns and generates
 * rule-based recommendations. All analysis is performed locally — no data
 * ever leaves the browser.
 *
*
 * @module features/insightsEngine
 */

'use strict';

import * as storage  from '../../core/storageAdapter.js';
import { on, HOOKS } from '../../core/eventBus.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Human-readable day names aligned with Date.getDay() (0 = Sunday). */
const DAY_LABELS = Object.freeze([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]);

/**
 * Named time-of-day buckets.
 * Night wraps: spans 21–23 AND 0–4.
 *
 * @type {ReadonlyArray<{name: string, start: number, end: number, wraps: boolean}>}
 */
const TIME_BUCKETS = Object.freeze([
  { name: 'Early Morning', start: 5,  end: 9,  wraps: false },
  { name: 'Late Morning',  start: 10, end: 11, wraps: false },
  { name: 'Afternoon',     start: 12, end: 16, wraps: false },
  { name: 'Evening',       start: 17, end: 20, wraps: false },
  { name: 'Night',         start: 21, end: 4,  wraps: true  },
]);

// ─── Exported Time Helpers ────────────────────────────────────────────────────

/**
 * Returns the LOCAL hour (0–23) for a Unix millisecond timestamp.
 *
 * Uses `Date.prototype.getHours()` which always returns the hour in the
 * runtime's local timezone — automatically DST-safe, no manual offset needed.
 * Returns `null` for invalid or missing timestamps so callers can distinguish
 * "no data" from "hour zero".
 *
 * @param {number} timestamp - Unix milliseconds.
 * @returns {number|null} Local hour 0–23, or null if timestamp is invalid.
 *
 * @example
 * // User is in UTC-5. 2024-03-10T03:30:00Z = 22:30 local.
 * getLocalHour(1710037800000); // → 22
 */
export function getLocalHour(timestamp) {
  if (!_isValidTimestamp(timestamp)) return null;
  return new Date(timestamp).getHours();
}

/**
 * Returns the LOCAL weekday index (0 = Sunday … 6 = Saturday) for a timestamp.
 *
 * Uses `Date.prototype.getDay()` so the result matches JavaScript's native
 * calendar and is immune to UTC day-boundary mismatches that occur for users in
 * UTC− zones late at night (e.g. 23:00 local Sunday = 07:00 UTC Monday).
 * Returns `null` for invalid timestamps.
 *
 * @param {number} timestamp - Unix milliseconds.
 * @returns {number|null} 0 (Sun) through 6 (Sat), or null if invalid.
 *
 * @example
 * // User in UTC-8. It is 23:00 local Sunday but 07:00 UTC Monday.
 * // getDay() returns 0 (Sunday) — the correct local calendar day.
 * getWeekdayIndex(timestamp); // → 0
 */
export function getWeekdayIndex(timestamp) {
  if (!_isValidTimestamp(timestamp)) return null;
  return new Date(timestamp).getDay();
}

/**
 * Returns true when two Unix timestamps fall within the same LOCAL calendar week.
 *
 * "Same week" is defined as sharing the same Monday-anchored week in local time.
 * Both timestamps are converted to their local Monday anchor via integer
 * arithmetic on local year/month/day — no UTC conversion, therefore DST-safe.
 *
 * @param {number} tsA - Unix milliseconds.
 * @param {number} tsB - Unix milliseconds.
 * @returns {boolean}
 *
 * @example
 * // Both timestamps are Mon–Sun of the same local week → true
 * isSameWeek(mondayTs, saturdayTs); // → true
 * isSameWeek(sundayTs, nextMondayTs); // → false
 */
export function isSameWeek(tsA, tsB) {
  if (!_isValidTimestamp(tsA) || !_isValidTimestamp(tsB)) return false;
  return _localWeekAnchor(tsA) === _localWeekAnchor(tsB);
}

/**
 * Returns the named time-of-day bucket for a given local hour.
 * Bucket boundaries are defined in TIME_BUCKETS above.
 *
 * @param {number} localHour - Integer 0–23.
 * @returns {string} One of: 'Early Morning', 'Late Morning', 'Afternoon', 'Evening', 'Night'.
 */
export function getTimeBucket(localHour) {
  if (typeof localHour !== 'number' || localHour < 0 || localHour > 23) {
    return 'Night';
  }
  for (const bucket of TIME_BUCKETS) {
    if (bucket.wraps) {
      if (localHour >= bucket.start || localHour <= bucket.end) return bucket.name;
    } else {
      if (localHour >= bucket.start && localHour <= bucket.end) return bucket.name;
    }
  }
  return 'Night';
}

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Wires the insights engine into the event bus.
 * Must be called once from background.js during service-worker startup.
 */
export function init() {
  on(HOOKS.SESSION_END, ({ session, score }) => {
    recordPattern(session, score).catch(err =>
      console.error('[InsightsEngine] Pattern recording failed:', err));
  });
}

// ─── Pattern Recording ────────────────────────────────────────────────────────

/**
 * Records a completed session into the hourly and daily pattern aggregates.
 *
 * Implementation guarantees:
 * - `session.startTime` is validated; invalid timestamps are rejected with a
 *   warning rather than silently re-bucketed to `Date.now()`.
 * - The patterns object is deep-copied before mutation so concurrent session
 *   completions cannot corrupt each other via aliased array references.
 * - All time values are derived from local-time Date methods (getHours,
 *   getDay), making the logic DST-safe without any manual offset arithmetic.
 * - Corrupted array entries (wrong length, NaN values) are normalised before
 *   use so stale data in storage does not propagate.
 *
 * @param {import('../../core/sessionManager.js').SessionObject} session
 * @param {number} score - Focus score 0–100.
 * @returns {Promise<void>}
 */
export async function recordPattern(session, score) {
  // ── Validate session object ────────────────────────────────────────────────
  if (!session || typeof session !== 'object') {
    console.warn('[InsightsEngine] recordPattern: received non-object session — skipping.');
    return;
  }

  const ts = session.startTime;
  if (!_isValidTimestamp(ts)) {
    console.warn(
      '[InsightsEngine] recordPattern: invalid startTime', ts,
      '— skipping session', session.id ?? '(no id)'
    );
    return;
  }

  // ── Derive local-time indices ─────────────────────────────────────────────
  // getLocalHour() and getWeekdayIndex() both delegate to Date's local-time
  // methods (.getHours(), .getDay()), which the JavaScript engine adjusts for
  // the system timezone including DST. No manual offset arithmetic is needed.
  const hour = getLocalHour(ts);    // 0–23, local time
  const day  = getWeekdayIndex(ts); // 0=Sun … 6=Sat, local time

  if (hour === null || day === null) {
    console.warn('[InsightsEngine] recordPattern: hour/day derivation failed for session', session.id);
    return;
  }

  // ── Compute safe increments ────────────────────────────────────────────────
  const focusMins    = _safeMins(session.duration);
  const distractMins = _safeMins(session.distractionSeconds);
  const safeScore    = typeof score === 'number' && isFinite(score)
    ? Math.max(0, Math.min(100, Math.round(score)))
    : 0;

  // ── Deep-copy stored patterns before mutation ─────────────────────────────
  // storage.getPatterns() may return an object whose arrays are the same
  // references held by an in-memory cache. Spreading each array creates fresh
  // copies so this write cannot alias a concurrent read or write.
  const stored = await storage.getPatterns();
  const p = {
    focusMinutesByHour: [...(stored.focusMinutesByHour ?? [])],
    focusMinutesByDay:  [...(stored.focusMinutesByDay  ?? [])],
    distractionByHour:  [...(stored.distractionByHour  ?? [])],
    sessionsByHour:     [...(stored.sessionsByHour     ?? [])],
    scoresByHour:       [...(stored.scoresByHour       ?? [])],
  };

  // Normalise lengths and replace any NaN/Infinity entries with 0
  _ensureArrayLength(p.focusMinutesByHour, 24);
  _ensureArrayLength(p.focusMinutesByDay,  7);
  _ensureArrayLength(p.distractionByHour,  24);
  _ensureArrayLength(p.sessionsByHour,     24);
  _ensureArrayLength(p.scoresByHour,       24);

  // ── Apply increments ──────────────────────────────────────────────────────
  p.focusMinutesByHour[hour] += focusMins;
  p.focusMinutesByDay[day]   += focusMins;
  p.distractionByHour[hour]  += distractMins;
  p.sessionsByHour[hour]     += 1;
  p.scoresByHour[hour]       += safeScore;

  await storage.setValue(storage.KEYS.PATTERNS, p);
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Suggestion
 * @property {string} type   - Stable machine-readable identifier.
 * @property {string} icon   - Emoji icon for display.
 * @property {string} title  - Short headline.
 * @property {string} body   - Actionable explanation.
 */

/**
 * Generates up to 4 rule-based recommendations from the user's pattern history.
 * Pure computation — no storage writes, no mutation of inputs.
 * Returns an empty array (never throws) when data is insufficient or corrupt.
 *
 * @returns {Promise<Suggestion[]>}
 */
export async function generateSuggestions() {
  let p, sessions;

  try {
    p        = await storage.getPatterns();
    sessions = (await storage.getSessions()).filter(_isValidSession);
  } catch (err) {
    console.error('[InsightsEngine] generateSuggestions: storage read failed:', err);
    return [];
  }

  const out = [];

  // ── Defensive: ensure arrays exist ────────────────────────────────────────
  const focusByHour = Array.isArray(p.focusMinutesByHour) ? p.focusMinutesByHour : [];
  const distByHour  = Array.isArray(p.distractionByHour)  ? p.distractionByHour  : [];
  const focusByDay  = Array.isArray(p.focusMinutesByDay)  ? p.focusMinutesByDay  : [];

  // ── Peak focus hour ────────────────────────────────────────────────────────
  const maxFocusMins = focusByHour.length ? Math.max(...focusByHour) : 0;
  if (maxFocusMins > 0) {
    const peakHour = focusByHour.indexOf(maxFocusMins);
    out.push({
      type:  'peak_time',
      icon:  '⏰',
      title: 'Your peak focus hour',
      body:  `You do your best deep work around ${_fmtHour(peakHour)}. Schedule your hardest tasks then.`,
    });
  }

  // ── Distraction spike ──────────────────────────────────────────────────────
  const maxDistractMins = distByHour.length ? Math.max(...distByHour) : 0;
  if (maxDistractMins > 5) {
    const spikeHour = distByHour.indexOf(maxDistractMins);
    out.push({
      type:  'distraction_spike',
      icon:  '⚡',
      title: spikeHour >= 12 ? 'Afternoon distraction spike' : 'Morning distraction spike',
      body:  `You get most distracted around ${_fmtHour(spikeHour)}. Try scheduling low-stakes tasks for this window.`,
    });
  }

  // ── Most productive day ───────────────────────────────────────────────────
  // Index aligns with Date.getDay(): 0=Sunday, 1=Monday … 6=Saturday.
  // DAY_LABELS is ordered identically, so no offset is applied.
  const maxDayMins = focusByDay.length ? Math.max(...focusByDay) : 0;
  if (maxDayMins > 0) {
    const peakDay = focusByDay.indexOf(maxDayMins);
    const dayName = DAY_LABELS[peakDay] ?? 'Unknown';
    out.push({
      type:  'best_day',
      icon:  '📅',
      title: 'Most productive day',
      body:  `${dayName}s are your strongest focus days. Protect that time.`,
    });
  }

  // ── Score trend ───────────────────────────────────────────────────────────
  if (sessions.length >= 6) {
    const recentAvg = _avg(sessions.slice(-3).map(s => s.score));
    const olderAvg  = _avg(sessions.slice(-6, -3).map(s => s.score));
    if (recentAvg < olderAvg - 10) {
      out.push({
        type:  'declining_score',
        icon:  '📉',
        title: 'Focus score declining',
        body:  'Your recent sessions score lower. Try a shorter 25-min sprint to rebuild momentum.',
      });
    } else if (recentAvg > olderAvg + 10) {
      out.push({
        type:  'improving_score',
        icon:  '🚀',
        title: 'Focus improving!',
        body:  'Your recent sessions show a clear upward trend. Keep the streak going.',
      });
    }
  }

  // ── Long session drag ──────────────────────────────────────────────────────
  if (sessions.length >= 4) {
    const longSessions = sessions.filter(s => (s.duration || 0) >= 3600);
    if (longSessions.length / sessions.length > 0.6) {
      const longAvg = _avg(longSessions.map(s => s.score));
      if (longAvg < 65) {
        out.push({
          type:  'session_length',
          icon:  '⏱',
          title: 'Long sessions dragging scores down',
          body:  'Your 90-min sessions score lower on average. Try alternating with 25-min sprints.',
        });
      }
    }
  }

  return out.slice(0, 4);
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Returns true when `ts` is a finite positive number usable as a Unix ms
 * timestamp. Rejects 0, NaN, Infinity, negative values, strings, and null.
 *
 * @param {*} ts
 * @returns {boolean}
 */
function _isValidTimestamp(ts) {
  return typeof ts === 'number' && isFinite(ts) && ts > 0;
}

/**
 * Returns true when a session object has the minimum required fields for
 * pattern recording and suggestion generation.
 *
 * @param {*} s
 * @returns {boolean}
 */
function _isValidSession(s) {
  return (
    s !== null &&
    typeof s === 'object' &&
    _isValidTimestamp(s.startTime) &&
    typeof s.score === 'number' &&
    isFinite(s.score)
  );
}

/**
 * Converts a raw seconds value to whole minutes, safely.
 * Returns 0 for any non-positive, non-finite, or absent value.
 *
 * @param {*} rawSeconds
 * @returns {number}
 */
function _safeMins(rawSeconds) {
  if (typeof rawSeconds !== 'number' || !isFinite(rawSeconds) || rawSeconds <= 0) return 0;
  return Math.round(rawSeconds / 60);
}

/**
 * Returns the arithmetic mean of an array of numbers.
 * Returns 0 for empty arrays to avoid NaN propagation.
 *
 * @param {number[]} nums
 * @returns {number}
 */
function _avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

/**
 * Ensures `arr` has exactly `len` elements that are all finite numbers.
 * Pads with zeros if too short; truncates if too long.
 * Replaces NaN/Infinity/non-numeric entries with 0.
 * ONLY call this on a freshly-copied array — this function mutates in place.
 *
 * @param {number[]} arr
 * @param {number} len
 */
function _ensureArrayLength(arr, len) {
  while (arr.length < len) arr.push(0);
  if (arr.length > len) arr.length = len;
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'number' || !isFinite(arr[i])) arr[i] = 0;
  }
}

/**
 * Returns a LOCAL date string (YYYY-MM-DD) for a timestamp.
 *
 * Uses `getFullYear()`, `getMonth()`, `getDate()` — all local-time methods —
 * so the result matches the user's calendar day rather than the UTC day.
 *
 * Contrast with `new Date(ts).toISOString().slice(0,10)` which returns the
 * UTC date and can be one calendar day behind for UTC− users after ~20:00.
 *
 * @param {number} timestamp - Unix milliseconds.
 * @returns {string} e.g. '2024-03-10'
 */
function _localISODate(timestamp) {
  const d   = new Date(timestamp);
  const y   = d.getFullYear();
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mon}-${day}`;
}

/**
 * Returns a canonical string identifying the LOCAL calendar week containing
 * `timestamp`. The anchor is the Monday of that week as a local ISO date.
 *
 * Used by `isSameWeek()` to compare two timestamps purely in local time.
 * Computing the anchor with local-time fields (getDate, getDay) means DST
 * transitions and UTC offsets cannot shift the result to a wrong calendar day.
 *
 * @param {number} timestamp - Unix milliseconds.
 * @returns {string} e.g. '2024-03-04' (the local Monday of that week)
 */
function _localWeekAnchor(timestamp) {
  const d = new Date(timestamp);
  // getDay(): 0=Sun,1=Mon…6=Sat  →  days back to Monday = (getDay()+6)%7
  const daysSinceMonday = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - daysSinceMonday);
  return _localISODate(monday.getTime());
}

/**
 * Formats a local hour (0–23) as a human-readable AM/PM string.
 *
 * @param {number} h - Integer 0–23.
 * @returns {string} e.g. '12am', '3pm', '11am'
 */
function _fmtHour(h) {
  if (typeof h !== 'number' || h < 0 || h > 23) return '—';
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}
