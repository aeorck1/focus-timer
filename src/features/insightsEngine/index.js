/**
 * @fileoverview InsightsEngine Feature Module
 *
 * Aggregates session data into hourly/daily usage patterns and generates
 * rule-based recommendations. All analysis is performed locally — no data
 * ever leaves the browser.
 *
 * Subscribes to onSessionEnd to record patterns automatically.
 *
 * @module features/insightsEngine
 */

'use strict';

import * as storage    from '../../core/storageAdapter.js';
import { on, HOOKS }   from '../../core/eventBus.js';

// ─── Day labels ───────────────────────────────────────────────────────────────
const DAY_LABELS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Initialises the insights engine.
 * Subscribes to session end events to record patterns automatically.
 * Call once from background.js during startup.
 */
export function init() {
  on(HOOKS.SESSION_END, ({ session, score }) => {
    _recordPattern(session, score).catch(err =>
      console.error('[InsightsEngine] pattern recording failed:', err));
  });
}

// ─── Pattern Recording ────────────────────────────────────────────────────────

/**
 * Records a completed session into hourly and daily pattern aggregates.
 * Called internally via the eventBus subscription; exposed for testing.
 *
 * @param {import('../../core/sessionManager.js').SessionObject} session
 * @param {number} score
 * @returns {Promise<void>}
 */
export async function recordPattern(session, score) {
  return _recordPattern(session, score);
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Suggestion
 * @property {string} type   - Machine-readable identifier.
 * @property {string} icon   - Emoji icon for display.
 * @property {string} title  - Short headline.
 * @property {string} body   - Longer explanation.
 */

/**
 * Generates a list of actionable suggestions based on the user's history.
 * Uses rule-based heuristics — no external API calls.
 *
 * @returns {Promise<Suggestion[]>} Up to 4 suggestions.
 */
export async function generateSuggestions() {
  const p        = await storage.getPatterns();
  const sessions = (await storage.getSessions()).filter(s => s.score != null);
  const out      = [];

  // ── Peak focus hour ───────────────────────────────────────────────────────
  const maxFocusHour = p.focusMinutesByHour.indexOf(Math.max(...p.focusMinutesByHour));
  if (p.focusMinutesByHour[maxFocusHour] > 0) {
    out.push({
      type: 'peak_time',
      icon: '⏰',
      title: 'Your peak focus hour',
      body:  `You do your best deep work around ${_fmtHour(maxFocusHour)}. Schedule your hardest tasks then.`,
    });
  }

  // ── Distraction spike ─────────────────────────────────────────────────────
  const maxDistractHour = p.distractionByHour.indexOf(Math.max(...p.distractionByHour));
  if (p.distractionByHour[maxDistractHour] > 5) {
    const label = _fmtHour(maxDistractHour);
    out.push({
      type:  'distraction_spike',
      icon:  '⚡',
      title: maxDistractHour >= 12 ? 'Afternoon distraction spike' : 'Morning distraction spike',
      body:  `You get most distracted around ${label}. Try scheduling low-stakes tasks for this window.`,
    });
  }

  // ── Most productive day ────────────────────────────────────────────────────
  const maxDay = p.focusMinutesByDay.indexOf(Math.max(...p.focusMinutesByDay));
  if (p.focusMinutesByDay[maxDay] > 0) {
    out.push({
      type:  'best_day',
      icon:  '📅',
      title: 'Most productive day',
      body:  `${DAY_LABELS[maxDay]}s are your strongest focus days. Protect that time.`,
    });
  }

  // ── Score trend ────────────────────────────────────────────────────────────
  if (sessions.length >= 6) {
    const recent = sessions.slice(-3).reduce((a, s) => a + s.score, 0) / 3;
    const older  = sessions.slice(-6, -3).reduce((a, s) => a + s.score, 0) / 3;
    if (recent < older - 10) {
      out.push({
        type:  'declining_score',
        icon:  '📉',
        title: 'Focus score declining',
        body:  'Your recent sessions score lower. Try a shorter 25-min sprint to rebuild momentum.',
      });
    } else if (recent > older + 10) {
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
    const long = sessions.filter(s => (s.duration || 0) >= 3600);
    if (long.length / sessions.length > 0.6) {
      const avg = long.reduce((a, s) => a + s.score, 0) / long.length;
      if (avg < 65) {
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

// ─── Private ──────────────────────────────────────────────────────────────────

/**
 * @param {import('../../core/sessionManager.js').SessionObject} session
 * @param {number} score
 */
async function _recordPattern(session, score) {
  const startDate    = new Date(session.startTime || Date.now());
  const hour         = startDate.getHours();
  const day          = startDate.getDay();
  const focusMins    = Math.round((session.duration || 0) / 60);
  const distractMins = Math.round((session.distractionSeconds || 0) / 60);

  const p = await storage.getPatterns();
  p.focusMinutesByHour[hour]  = (p.focusMinutesByHour[hour]  || 0) + focusMins;
  p.focusMinutesByDay[day]    = (p.focusMinutesByDay[day]    || 0) + focusMins;
  p.distractionByHour[hour]   = (p.distractionByHour[hour]   || 0) + distractMins;
  p.sessionsByHour[hour]      = (p.sessionsByHour[hour]       || 0) + 1;
  p.scoresByHour[hour]        = (p.scoresByHour[hour]         || 0) + score;

  await storage.setValue(storage.KEYS.PATTERNS, p);
}

/** Formats a 24h integer as a readable AM/PM string. */
function _fmtHour(h) {
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}
