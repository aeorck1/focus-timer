/**
 * @fileoverview Background Service Worker — Focus Timer v5
 *
 * This is the MV3 service worker entry point. Its only responsibilities are:
 *   1. Bootstrap all core modules and features in the correct order
 *   2. Register Chrome event listeners (alarms, tabs, webNavigation, messages)
 *   3. Delegate all real work to the appropriate module
 *
 * No business logic lives here. If you find yourself writing logic in this file,
 * it belongs in a core module or feature module instead.
 *
 * Architecture: src/core/ + src/features/ → background.js (wiring only)
 */

'use strict';

// ─── Core modules ─────────────────────────────────────────────────────────────
import * as storage      from './src/core/storageAdapter.js';
import * as timer        from './src/core/timerEngine.js';
import * as sessionMgr   from './src/core/sessionManager.js';
import { emit, HOOKS }   from './src/core/eventBus.js';

// ─── Feature modules ──────────────────────────────────────────────────────────
import * as distraction  from './src/features/distractionTracking/index.js';
import * as reflection   from './src/features/reflectionSystem/index.js';
import * as visual       from './src/features/visualEnforcement/index.js';
import * as insights     from './src/features/insightsEngine/index.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Runs once when the service worker starts.
 * Initialises features, runs storage migrations, ensures today is in weekly data.
 */
async function bootstrap() {
  await storage.migrate();
  await sessionMgr.ensureTodayInWeekly();

  distraction.init();
  insights.init();
  visual.init();

  console.info('[FocusTimer] Service worker bootstrapped.');
}

bootstrap().catch(err => console.error('[FocusTimer] Bootstrap failed:', err));

// ─── Alarm Handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === timer.ALARMS.COMPLETE) {
    const { state, completedSession } = await timer.complete();
    const sites = await storage.getDistractingSites();
    await visual.showSessionOverlay(state.pendingReflection);
    await visual.broadcastState(state, sites);
  } else if (name === timer.ALARMS.TICK) {
    const { state, expired } = await timer.tick();
    if (!expired) {
      const sites = await storage.getDistractingSites();
      await visual.broadcastState(state, sites);
    }
  }
});

// ─── Tab Activation ───────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const state = await storage.getState();
  if (state.status !== 'running' || !state.currentSession) return;

  // Record the switch and update session in storage
  const { patchState, getState: gs } = storage;
  const current = await gs();
  if (!current.currentSession) return;

  const updated = sessionMgr.recordTabSwitch(current.currentSession);
  const newState = await patchState({ currentSession: updated });

  // Flush any open distraction timing and re-evaluate the newly active tab
  await distraction.leaveDistraction();

  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  const url   = tab.url || tab.pendingUrl || '';
  const sites = await storage.getDistractingSites();

  await visual.ensureContentScript(tabId, url);
  await visual.broadcastState(newState, sites);

  if (distraction.isDistracting(url, sites)) {
    await distraction.enterDistraction(tabId, url);
    // Re-broadcast with updated distraction visit count
    const latestState = await storage.getState();
    await visual.broadcastState(latestState, sites);
  }
});

// ─── Web Navigation ───────────────────────────────────────────────────────────

chrome.webNavigation.onCommitted.addListener(async ({ tabId, url, frameId }) => {
  if (frameId !== 0) return;
  const state = await storage.getState();
  if (state.status !== 'running' || !state.currentSession) return;
  if (!visual.isInjectableUrl(url)) return;

  const sites         = await storage.getDistractingSites();
  const wasDistracting = distraction.getDistractionTabId() === tabId;
  const nowDistracting = distraction.isDistracting(url, sites);

  if (wasDistracting && !nowDistracting) await distraction.leaveDistraction();
  else if (!wasDistracting && nowDistracting) await distraction.enterDistraction(tabId, url);
});

chrome.webNavigation.onCompleted.addListener(async ({ tabId, url, frameId }) => {
  if (frameId !== 0) return;
  const state = await storage.getState();
  if (state.status !== 'running') return;
  if (!visual.isInjectableUrl(url)) return;

  const sites = await storage.getDistractingSites();
  // Short delay so the page DOM is settled before content script applies enforcement
  setTimeout(async () => {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'applyFocusMode', state, sites });
    } catch { /* content script not yet ready; it will self-sync via storage.onChanged */ }
  }, 150);
});

// ─── Startup Recovery ─────────────────────────────────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  await bootstrap();
  const state = await timer.recover();
  if (state.status === 'running') {
    await visual.injectIntoAllTabs();
    const sites = await storage.getDistractingSites();
    await visual.broadcastState(state, sites);
  }
});

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  _handleMessage(msg).then(sendResponse).catch(err => {
    console.error('[FocusTimer] Message handler error:', err);
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async response
});

/**
 * Central async message handler. Returns an object sent back to the caller.
 *
 * @param {{ action: string, [key: string]: * }} msg
 * @returns {Promise<Object>}
 */
async function _handleMessage(msg) {
  switch (msg.action) {

    // ── Timer controls ──────────────────────────────────────────────────────
    case 'start': {
      const state = await timer.start(msg.duration);
      const stats = await sessionMgr.getDailyStats();
      return { state, stats };
    }
    case 'pause': {
      const state = await timer.pause();
      const sites = await storage.getDistractingSites();
      await visual.broadcastState(state, sites);
      const stats = await sessionMgr.getDailyStats();
      return { state, stats };
    }
    case 'resume': {
      const state = await timer.resume();
      await visual.injectIntoAllTabs();
      const sites = await storage.getDistractingSites();
      await visual.broadcastState(state, sites);
      const stats = await sessionMgr.getDailyStats();
      return { state, stats };
    }
    case 'reset': {
      await distraction.leaveDistraction();
      const state = await timer.reset();
      const stats = await sessionMgr.getDailyStats();
      return { state, stats };
    }

    // ── Content script callbacks ────────────────────────────────────────────
    case 'contentOverlayReturn':
      await distraction.leaveDistraction();
      return { ok: true };

    case 'contentOverlayContinue':
      return { ok: true };

    // ── Reflection ──────────────────────────────────────────────────────────
    case 'saveReflection':
      await reflection.save(msg.sessionId, msg.text);
      return { ok: true };

    case 'skipReflection':
      await reflection.skip(msg.sessionId);
      return { ok: true };

    case 'getReflections':
      return { reflections: await reflection.getAll() };

    // ── Sites management ────────────────────────────────────────────────────
    case 'addSite': {
      const sites = await storage.getDistractingSites();
      const domain = msg.domain.toLowerCase().replace(/^www\./, '').trim();
      if (domain && !sites.includes(domain)) {
        sites.push(domain);
        await storage.setValue(storage.KEYS.SITES, sites);
      }
      return { sites };
    }
    case 'removeSite': {
      const sites = (await storage.getDistractingSites()).filter(s => s !== msg.domain);
      await storage.setValue(storage.KEYS.SITES, sites);
      return { sites };
    }
    case 'getSites':
      return { sites: await storage.getDistractingSites() };

    // ── Data queries ────────────────────────────────────────────────────────
    case 'getWeekly':
      return { weekly: await storage.getWeeklyData() };

    case 'getSessions':
      return { sessions: await storage.getSessions() };

    case 'getPatterns':
      return { patterns: await storage.getPatterns() };

    case 'getSuggestions':
      return { suggestions: await insights.generateSuggestions() };

    // ── State query (default for popup init) ────────────────────────────────
    default: {
      const [state, stats] = await Promise.all([
        storage.getState(),
        sessionMgr.getDailyStats(),
      ]);
      return { state, stats };
    }
  }
}
