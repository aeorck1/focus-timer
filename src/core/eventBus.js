/**
 * @fileoverview EventBus — Focus Timer Core
 *
 * A lightweight, synchronous pub/sub event bus that powers the plugin system.
 * All core modules emit events through this bus; feature modules and external
 * plugins subscribe to hooks to extend behaviour without modifying core logic.
 *
 * Plugin authors: see PLUGIN_DEVELOPMENT.md for the full authoring guide.
 *
 * @module core/eventBus
 */

'use strict';

// ─── Supported Hook Names ─────────────────────────────────────────────────────

/**
 * Enumeration of all lifecycle hooks the extension emits.
 * Use these constants when subscribing or emitting.
 *
 * @enum {string}
 */
export const HOOKS = Object.freeze({
  /** Fired when a new focus session begins. Payload: { session, duration } */
  SESSION_START:       'onSessionStart',
  /** Fired when a session completes normally or is reset. Payload: { session, score, qualityLabel } */
  SESSION_END:         'onSessionEnd',
  /** Fired when the user visits a distracting domain. Payload: { domain, tabId } */
  DISTRACTION:         'onDistraction',
  /** Fired after the focus score is calculated. Payload: { score, qualityLabel, session } */
  SCORE_CALCULATED:    'onScoreCalculated',
  /** Fired when a reflection text is saved. Payload: { sessionId, text, savedAt } */
  REFLECTION_SAVED:    'onReflectionSaved',
  /** Fired when visual focus enforcement is applied to a tab. Payload: { tabId, url } */
  FOCUS_MODE_ENABLED:  'onFocusModeEnabled',
  /** Fired when visual focus enforcement is removed from all tabs. Payload: {} */
  FOCUS_MODE_DISABLED: 'onFocusModeDisabled',
  /** Fired every background tick while a session is running. Payload: { remaining } */
  TICK:                'onTick',
});

// ─── Internal Registry ────────────────────────────────────────────────────────

/**
 * Map of hook name → array of registered handler functions.
 * @type {Map<string, Function[]>}
 */
const _registry = new Map(Object.values(HOOKS).map(h => [h, []]));

/**
 * Registered plugin metadata, keyed by plugin name.
 * @type {Map<string, {name: string, version: string}>}
 */
const _plugins = new Map();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Registers a plugin with the event bus.
 *
 * A plugin is a plain object with a `name`, `version`, and a `hooks` map.
 * Each hook is a function that will be called when the corresponding event fires.
 * Plugins are isolated — an uncaught error in one hook does not crash others.
 *
 * @param {PluginDefinition} plugin
 * @returns {boolean} True if registration succeeded, false if already registered.
 *
 * @example
 * import { registerPlugin, HOOKS } from './core/eventBus.js';
 * registerPlugin({
 *   name: 'my-logger',
 *   version: '1.0.0',
 *   hooks: {
 *     [HOOKS.SESSION_END]: ({ session, score }) => {
 *       console.log('Session finished. Score:', score);
 *     },
 *   },
 * });
 */
export function registerPlugin(plugin) {
  if (!plugin?.name || !plugin?.version) {
    console.warn('[EventBus] registerPlugin: plugin must have name and version.');
    return false;
  }
  if (_plugins.has(plugin.name)) {
    console.warn(`[EventBus] Plugin "${plugin.name}" is already registered.`);
    return false;
  }

  const hooks = plugin.hooks || {};
  let registered = 0;

  for (const [hookName, handler] of Object.entries(hooks)) {
    if (!_registry.has(hookName)) {
      console.warn(`[EventBus] Plugin "${plugin.name}" tried to register unknown hook: "${hookName}"`);
      continue;
    }
    if (typeof handler !== 'function') {
      console.warn(`[EventBus] Plugin "${plugin.name}" hook "${hookName}" must be a function.`);
      continue;
    }
    _registry.get(hookName).push(_wrap(plugin.name, hookName, handler));
    registered++;
  }

  _plugins.set(plugin.name, { name: plugin.name, version: plugin.version });
  console.info(`[EventBus] Plugin "${plugin.name}" v${plugin.version} registered (${registered} hooks).`);
  return true;
}

/**
 * Subscribes an internal handler to a hook.
 * Prefer this for core feature modules over registerPlugin.
 *
 * @param {string} hookName - One of the HOOKS values.
 * @param {function(*): void} handler
 * @returns {function(): void} Unsubscribe function.
 */
export function on(hookName, handler) {
  if (!_registry.has(hookName)) {
    console.warn(`[EventBus] on: unknown hook "${hookName}"`);
    return () => {};
  }
  const wrapped = _wrap('internal', hookName, handler);
  _registry.get(hookName).push(wrapped);
  return () => off(hookName, wrapped);
}

/**
 * Removes a specific handler from a hook.
 *
 * @param {string} hookName
 * @param {Function} handler - Must be the exact reference returned by on().
 */
export function off(hookName, handler) {
  if (!_registry.has(hookName)) return;
  const handlers = _registry.get(hookName);
  const idx = handlers.indexOf(handler);
  if (idx !== -1) handlers.splice(idx, 1);
}

/**
 * Emits an event, calling all registered handlers for that hook in order.
 * Errors thrown by handlers are caught and logged — they do not propagate.
 *
 * @param {string} hookName - One of the HOOKS values.
 * @param {*} [payload={}] - Data passed to every handler.
 * @returns {number} Number of handlers that were called.
 */
export function emit(hookName, payload = {}) {
  const handlers = _registry.get(hookName);
  if (!handlers || handlers.length === 0) return 0;
  for (const handler of handlers) {
    handler(payload); // errors are already caught inside _wrap
  }
  return handlers.length;
}

/**
 * Returns a snapshot of all registered plugins.
 *
 * @returns {{ name: string, version: string }[]}
 */
export function listPlugins() {
  return [..._plugins.values()];
}

/**
 * Returns the number of handlers registered on a hook.
 * Useful for debugging and tests.
 *
 * @param {string} hookName
 * @returns {number}
 */
export function handlerCount(hookName) {
  return _registry.get(hookName)?.length ?? 0;
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Wraps a handler with a try/catch so a crashing plugin cannot break the bus.
 *
 * @param {string} source - Plugin or module name, for error context.
 * @param {string} hookName
 * @param {Function} fn
 * @returns {Function}
 */
function _wrap(source, hookName, fn) {
  return function safeHandler(payload) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[EventBus] Handler error in "${source}" on hook "${hookName}":`, err);
    }
  };
}

/**
 * @typedef {Object} PluginDefinition
 * @property {string} name - Unique plugin identifier.
 * @property {string} version - Semver string.
 * @property {Object.<string, function>} hooks - Map of HOOKS values to handlers.
 */
