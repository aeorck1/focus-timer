/**
 * @fileoverview TimerEngine — Focus Timer Core
 *
 * Manages the Chrome alarms API and orchestrates the session lifecycle.
 * This is the single source of truth for timer state mutations.
 *
 * Responsibilities:
 *   - Creating and clearing Chrome alarms (MV3 compliant, no setInterval)
 *   - Updating the extension badge
 *   - Calling sessionManager and storageAdapter at the right moments
 *   - Broadcasting state changes to content scripts via tab messaging
 *   - Emitting lifecycle events through the eventBus
 *
 * What it does NOT do:
 *   - Score calculation (see scoringEngine)
 *   - Session object shape (see sessionManager)
 *   - Storage access (see storageAdapter)
 *
 * @module core/timerEngine
 */

'use strict';

import * as storage        from './storageAdapter.js';
import * as sessionMgr     from './sessionManager.js';
import { emit, HOOKS }     from './eventBus.js';

// ─── Alarm Names ─────────────────────────────────────────────────────────────

/** @enum {string} */
export const ALARMS = Object.freeze({
  COMPLETE: 'focusComplete', // fires once when the session timer expires
  TICK:     'focusTick',     // fires every ~1 minute for badge updates
});

// ─── Badge ────────────────────────────────────────────────────────────────────

/**
 * Updates the extension action badge to reflect current timer status.
 *
 * @param {'idle'|'running'|'paused'} status
 * @param {number} [remaining=0] - Remaining seconds (used when running).
 */
export function updateBadge(status, remaining = 0) {
  if (status === 'running') {
    chrome.action.setBadgeText({ text: `${Math.ceil(remaining / 60)}m` });
    chrome.action.setBadgeBackgroundColor({ color: '#818cf8' });
  } else if (status === 'paused') {
    chrome.action.setBadgeText({ text: '⏸' });
    chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Timer Controls ───────────────────────────────────────────────────────────

/**
 * Starts a new focus session.
 * Creates the required alarms, persists state, and emits onSessionStart.
 *
 * @param {number} duration - Session duration in seconds.
 * @returns {Promise<import('./storageAdapter.js').FocusState>} The new state.
 */
export async function start(duration) {
  const session  = sessionMgr.createSession(duration);
  const newState = await storage.patchState({
    status:             'running',
    duration,
    remaining:          duration,
    startedAt:          Date.now(),
    pausedAt:           null,
    elapsedBeforePause: 0,
    pendingReflection:  null,
    currentSession:     session,
  });

  _setAlarms(duration);
  updateBadge('running', duration);
  emit(HOOKS.SESSION_START, { session, duration });
  emit(HOOKS.FOCUS_MODE_ENABLED, {});

  return newState;
}

/**
 * Pauses the running timer.
 * Records elapsed time so the session can be resumed accurately.
 *
 * @returns {Promise<import('./storageAdapter.js').FocusState>}
 */
export async function pause() {
  const state = await storage.getState();
  if (state.status !== 'running') return state;

  const now       = Date.now();
  const elapsed   = Math.floor((now - state.startedAt) / 1000) + state.elapsedBeforePause;
  const remaining = Math.max(0, state.duration - elapsed);

  const newState = await storage.patchState({
    status:             'paused',
    pausedAt:           now,
    remaining,
    elapsedBeforePause: elapsed,
    currentSession:     state.currentSession
      ? sessionMgr.markInterrupted(state.currentSession)
      : null,
  });

  _clearAlarms();
  updateBadge('paused', remaining);
  return newState;
}

/**
 * Resumes a paused timer from where it left off.
 *
 * @returns {Promise<import('./storageAdapter.js').FocusState>}
 */
export async function resume() {
  const state = await storage.getState();
  if (state.status !== 'paused') return state;

  const newState = await storage.patchState({
    status:    'running',
    startedAt: Date.now(),
    pausedAt:  null,
  });

  _setAlarms(state.remaining);
  updateBadge('running', state.remaining);
  return newState;
}

/**
 * Resets the timer to idle without completing the session.
 * Existing session data is discarded.
 *
 * @returns {Promise<import('./storageAdapter.js').FocusState>}
 */
export async function reset() {
  const state  = await storage.getState();
  _clearAlarms();
  const newState = await storage.patchState({
    ...storage.defaultState(),
    duration:  state.duration,
    remaining: state.duration,
  });
  updateBadge('idle');
  emit(HOOKS.FOCUS_MODE_DISABLED, {});
  return newState;
}

/**
 * Completes the session naturally (alarm fired or remaining reached zero).
 * Delegates scoring and persistence to sessionManager, then updates state.
 *
 * @returns {Promise<{state: FocusState, completedSession: SessionObject}>}
 */
export async function complete() {
  _clearAlarms();
  const state   = await storage.getState();
  const session = state.currentSession || sessionMgr.createSession(state.duration);

  const completedSession = await sessionMgr.completeSession(session, state.duration);
  const reflection = {
    sessionId:    completedSession.id,
    score:        completedSession.score,
    qualityLabel: completedSession.qualityLabel,
    duration:     completedSession.duration,
  };

  const newState = await storage.patchState({
    ...storage.defaultState(),
    duration:          state.duration,
    remaining:         state.duration,
    pendingReflection: reflection,
  });

  updateBadge('idle');
  emit(HOOKS.FOCUS_MODE_DISABLED, {});
  return { state: newState, completedSession };
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

/**
 * Called by the TICK alarm handler (~every 1 minute).
 * Recomputes remaining time and checks for expiry.
 *
 * @returns {Promise<{state: FocusState, expired: boolean}>}
 */
export async function tick() {
  const state = await storage.getState();
  if (state.status !== 'running') return { state, expired: false };

  const elapsed   = Math.floor((Date.now() - state.startedAt) / 1000) + state.elapsedBeforePause;
  const remaining = Math.max(0, state.duration - elapsed);
  const newState  = await storage.patchState({ remaining });

  updateBadge('running', remaining);
  emit(HOOKS.TICK, { remaining });

  if (remaining <= 0) {
    const result = await complete();
    return { state: result.state, expired: true };
  }
  return { state: newState, expired: false };
}

// ─── Startup Recovery ────────────────────────────────────────────────────────

/**
 * Called on chrome.runtime.onStartup to recover timer state after browser restart.
 * If a session was running when the browser was closed, we either complete it
 * (if the time has passed) or restore the remaining time and alarms.
 *
 * @returns {Promise<import('./storageAdapter.js').FocusState>}
 */
export async function recover() {
  const state = await storage.getState();
  if (state.status !== 'running') return state;

  const elapsed   = Math.floor((Date.now() - state.startedAt) / 1000) + state.elapsedBeforePause;
  const remaining = Math.max(0, state.duration - elapsed);

  if (remaining <= 0) {
    const result = await complete();
    return result.state;
  }

  const newState = await storage.patchState({ remaining });
  _setAlarms(remaining);
  updateBadge('running', remaining);
  return newState;
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Creates both the completion alarm and the periodic tick alarm.
 *
 * @param {number} durationSeconds
 */
function _setAlarms(durationSeconds) {
  chrome.alarms.create(ALARMS.COMPLETE, { delayInMinutes: durationSeconds / 60 });
  chrome.alarms.create(ALARMS.TICK,     { periodInMinutes: 1 });
}

/** Clears both alarms. Safe to call even if alarms are not set. */
function _clearAlarms() {
  chrome.alarms.clear(ALARMS.COMPLETE);
  chrome.alarms.clear(ALARMS.TICK);
}
