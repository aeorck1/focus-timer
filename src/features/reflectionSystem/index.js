/**
 * @fileoverview ReflectionSystem Feature Module
 *
 * Handles saving, skipping, and retrieving session reflections.
 * A reflection is a short text note the user writes immediately after a session
 * to capture what they accomplished.
 *
 * This module listens for the onSessionEnd hook to know when to prompt, and
 * emits onReflectionSaved when text is successfully stored.
 *
 * @module features/reflectionSystem
 */

'use strict';

import * as storage        from '../../core/storageAdapter.js';
import { emit, HOOKS }     from '../../core/eventBus.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Saves a reflection for a given session.
 * Clears the pendingReflection flag from state once saved.
 *
 * @param {string} sessionId
 * @param {string} text - The reflection text (may be empty for skipped reflections).
 * @returns {Promise<void>}
 */
export async function save(sessionId, text) {
  await storage.saveReflection(sessionId, text);

  // Clear the pending reflection flag so popup / content script stops prompting
  const state = await storage.getState();
  if (state.pendingReflection?.sessionId === sessionId) {
    await storage.patchState({ pendingReflection: null });
  }

  emit(HOOKS.REFLECTION_SAVED, { sessionId, text, savedAt: Date.now() });
}

/**
 * Skips the reflection for a session (user dismissed without writing).
 * Still clears the pendingReflection flag from state.
 *
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function skip(sessionId) {
  const state = await storage.getState();
  if (state.pendingReflection?.sessionId === sessionId) {
    await storage.patchState({ pendingReflection: null });
  }
}

/**
 * Retrieves all saved reflections keyed by sessionId.
 *
 * @returns {Promise<Record<string, {text: string, savedAt: number}>>}
 */
export async function getAll() {
  return storage.getReflections();
}

/**
 * Retrieves the reflection for a specific session, or null if not saved.
 *
 * @param {string} sessionId
 * @returns {Promise<{text: string, savedAt: number}|null>}
 */
export async function getForSession(sessionId) {
  const all = await storage.getReflections();
  return all[sessionId] || null;
}
