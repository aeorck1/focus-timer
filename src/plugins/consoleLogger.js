/**
 * @fileoverview ConsoleLogger Plugin — Example Plugin for Focus Timer
 *
 * A reference implementation showing how to write a Focus Timer plugin.
 * This plugin logs all lifecycle events to the browser console, making it
 * ideal for debugging and as a starting template for new plugins.
 *
 * HOW TO REGISTER:
 *   import { registerPlugin } from '../../core/eventBus.js';
 *   import ConsoleLoggerPlugin from './consoleLogger.js';
 *   registerPlugin(ConsoleLoggerPlugin);
 *
 * See PLUGIN_DEVELOPMENT.md for the full authoring guide.
 *
 * @module plugins/consoleLogger
 */

'use strict';

import { HOOKS } from '../core/eventBus.js';

/**
 * @type {import('../core/eventBus.js').PluginDefinition}
 */
const ConsoleLoggerPlugin = {
  name:    'console-logger',
  version: '1.0.0',

  hooks: {
    /**
     * Fires when a focus session begins.
     * @param {{ session: Object, duration: number }} data
     */
    [HOOKS.SESSION_START]: ({ session, duration }) => {
      const mins = Math.round(duration / 60);
      console.log(`[ConsoleLogger] 🚀 Session started — ${mins}m | id: ${session.id}`);
    },

    /**
     * Fires when a session completes.
     * @param {{ session: Object, score: number, qualityLabel: string }} data
     */
    [HOOKS.SESSION_END]: ({ session, score, qualityLabel }) => {
      const mins = Math.round((session.duration || 0) / 60);
      console.log(
        `[ConsoleLogger] ✅ Session ended — ${mins}m | Score: ${score} (${qualityLabel})`
      );
    },

    /**
     * Fires when the user visits a distracting site.
     * @param {{ domain: string, tabId: number }} data
     */
    [HOOKS.DISTRACTION]: ({ domain }) => {
      console.warn(`[ConsoleLogger] ⚡ Distraction detected — ${domain}`);
    },

    /**
     * Fires after focus score is calculated.
     * @param {{ score: number, qualityLabel: string }} data
     */
    [HOOKS.SCORE_CALCULATED]: ({ score, qualityLabel }) => {
      console.log(`[ConsoleLogger] 📊 Score calculated — ${score} / 100 (${qualityLabel})`);
    },

    /**
     * Fires when a reflection is saved.
     * @param {{ sessionId: string, text: string }} data
     */
    [HOOKS.REFLECTION_SAVED]: ({ sessionId, text }) => {
      const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
      console.log(`[ConsoleLogger] 📝 Reflection saved for ${sessionId}: "${preview}"`);
    },

    /**
     * Fires when visual focus mode is enabled on all tabs.
     */
    [HOOKS.FOCUS_MODE_ENABLED]: () => {
      console.log('[ConsoleLogger] 👁 Focus mode enabled on all tabs.');
    },

    /**
     * Fires when visual focus mode is removed from all tabs.
     */
    [HOOKS.FOCUS_MODE_DISABLED]: () => {
      console.log('[ConsoleLogger] 💤 Focus mode disabled.');
    },

    /**
     * Fires every background tick (approximately every minute).
     * @param {{ remaining: number }} data
     */
    [HOOKS.TICK]: ({ remaining }) => {
      const mins = Math.ceil(remaining / 60);
      console.debug(`[ConsoleLogger] ⏱ Tick — ${mins}m remaining`);
    },
  },
};

export default ConsoleLoggerPlugin;
