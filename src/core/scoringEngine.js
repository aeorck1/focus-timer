/**
 * @fileoverview ScoringEngine — Focus Timer Core
 *
 * Pure functions for calculating the focus score and assigning a quality label.
 * This module has zero side effects and no external dependencies — it is
 * entirely deterministic given the same inputs, making it trivial to test.
 *
 * Scoring formula:
 *   Base score:              100
 *   Per tab switch:          −5
 *   Per distraction visit:   −10
 *   Per minute distracted:   −1
 *   No interruptions bonus:  +10
 *   Clamp:                   [0, 100]
 *
 * @module core/scoringEngine
 */

'use strict';

// ─── Quality Thresholds ───────────────────────────────────────────────────────

/**
 * Ordered quality tiers from best to worst.
 * The first tier whose `min` is ≤ the score wins.
 *
 * @type {{ label: string, min: number, color: string }[]}
 */
export const QUALITY_TIERS = Object.freeze([
  { label: 'Deep Work',  min: 90, color: '#818cf8' },
  { label: 'Focused',    min: 70, color: '#4ade80' },
  { label: 'Fragmented', min: 40, color: '#fbbf24' },
  { label: 'Distracted', min: 0,  color: '#f87171' },
]);

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SessionMetrics
 * @property {number} [tabSwitchCount=0]    - Number of tab switches during session.
 * @property {number} [distractionVisits=0] - Number of visits to distracting sites.
 * @property {number} [distractionSeconds=0]- Total seconds spent on distracting sites.
 * @property {boolean} [interrupted=false]  - Whether the session was paused at any point.
 */

/**
 * Calculates the focus score for a completed session.
 *
 * The score is designed to reward unbroken deep work and penalise both the
 * frequency and duration of distraction events. All deductions and bonuses
 * are additive so that plugin authors can reason about the formula easily.
 *
 * @param {SessionMetrics} session
 * @returns {number} Integer in the range [0, 100].
 */
export function calcFocusScore(session) {
  let score = 100;

  score -= (session.tabSwitchCount    || 0) * 5;
  score -= (session.distractionVisits || 0) * 10;
  score -= Math.round((session.distractionSeconds || 0) / 60); // 1 pt per distracted minute

  // Reward for zero interruptions throughout the entire session
  if (!session.interrupted) score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Returns the quality tier for a given score.
 *
 * @param {number} score - An integer in [0, 100].
 * @returns {{ label: string, min: number, color: string }}
 */
export function getTier(score) {
  return QUALITY_TIERS.find(t => score >= t.min) || QUALITY_TIERS[QUALITY_TIERS.length - 1];
}

/**
 * Returns the human-readable quality label for a score.
 *
 * @param {number} score
 * @returns {string} e.g. 'Deep Work', 'Focused', 'Fragmented', 'Distracted'
 */
export function qualityLabel(score) {
  return getTier(score).label;
}

/**
 * Returns the theme color associated with a quality tier.
 *
 * @param {number} score
 * @returns {string} CSS hex colour string.
 */
export function qualityColor(score) {
  return getTier(score).color;
}

/**
 * Calculates the live (in-progress) score estimate from partial session data.
 * Identical to calcFocusScore but safe to call at any point during a session.
 *
 * @param {SessionMetrics} session
 * @returns {number} Integer in [0, 100].
 */
export function calcLiveScore(session) {
  return calcFocusScore(session);
}

/**
 * Returns a complete scored result object, combining score and quality metadata.
 *
 * @param {SessionMetrics} session
 * @returns {{ score: number, qualityLabel: string, qualityColor: string, tier: Object }}
 */
export function score(session) {
  const s    = calcFocusScore(session);
  const tier = getTier(s);
  return {
    score:        s,
    qualityLabel: tier.label,
    qualityColor: tier.color,
    tier,
  };
}
