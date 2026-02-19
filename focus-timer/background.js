// =============================================================================
// Focus Timer — Background Service Worker (Phase 4)
// =============================================================================

// ─── Constants ────────────────────────────────────────────────────────────────
const ALARM_COMPLETE = 'focusComplete';
const ALARM_TICK     = 'focusTick';
const KEY_STATE      = 'focusState';
const KEY_STATS      = 'focusStats';
const KEY_SESSIONS   = 'sessions';
const KEY_SITES      = 'distractingSites';
const KEY_WEEKLY     = 'weeklyData';
const KEY_PATTERNS   = 'patterns';
const KEY_REFLECTIONS = 'reflections';

const DEFAULT_SITES = [
  'youtube.com','twitter.com','x.com','facebook.com','instagram.com',
  'reddit.com','tiktok.com','netflix.com','twitch.tv','hulu.com',
  'pinterest.com','snapchat.com','linkedin.com',
];

const DEFAULT_STATE = {
  status: 'idle',
  duration: 25 * 60,
  remaining: 25 * 60,
  startedAt: null,
  pausedAt: null,
  elapsedBeforePause: 0,
  currentSession: null,
  pendingReflection: null,
};

// ─── Date / ID Helpers ────────────────────────────────────────────────────────
function todayKey() { return new Date().toISOString().slice(0, 10); }

function weekKey() {
  const d = new Date();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return mon.toISOString().slice(0, 10);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Storage ──────────────────────────────────────────────────────────────────
async function getState() {
  const r = await chrome.storage.local.get(KEY_STATE);
  return r[KEY_STATE] || { ...DEFAULT_STATE };
}

async function setState(patch) {
  const cur = await getState();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [KEY_STATE]: next });
  return next;
}

async function getStats() {
  const r = await chrome.storage.local.get(KEY_STATS);
  const s = r[KEY_STATS];
  const today = todayKey();
  if (!s || s.date !== today) {
    const streak = calcStreak(s);
    const fresh = { date: today, totalFocusMinutes: 0, sessionsCompleted: 0,
      totalTabSwitches: 0, totalDistractionVisits: 0, totalDistractionSeconds: 0, streak };
    await chrome.storage.local.set({ [KEY_STATS]: fresh });
    return fresh;
  }
  return s;
}

async function patchStats(patch) {
  const cur = await getStats();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [KEY_STATS]: next });
  return next;
}

async function getDistracting() {
  const r = await chrome.storage.local.get(KEY_SITES);
  return r[KEY_SITES] || DEFAULT_SITES;
}

async function getPatterns() {
  const r = await chrome.storage.local.get(KEY_PATTERNS);
  return r[KEY_PATTERNS] || {
    focusMinutesByHour: Array(24).fill(0),
    focusMinutesByDay:  Array(7).fill(0),
    distractionByHour:  Array(24).fill(0),
    sessionsByHour:     Array(24).fill(0),
    scoresByHour:       Array(24).fill(0),
  };
}

async function getWeeklyData() {
  const r = await chrome.storage.local.get(KEY_WEEKLY);
  const wk = weekKey();
  const data = r[KEY_WEEKLY];
  if (!data || data.weekStart !== wk) {
    const fresh = { weekStart: wk, days: {} };
    await chrome.storage.local.set({ [KEY_WEEKLY]: fresh });
    return fresh;
  }
  return data;
}

// ─── Domain ───────────────────────────────────────────────────────────────────
function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

async function isDistractingUrl(url) {
  const domain = extractDomain(url);
  if (!domain) return false;
  const sites = await getDistracting();
  return sites.some(s => domain === s || domain.endsWith('.' + s));
}

function isInjectableUrl(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

// ─── Scoring / Classification ─────────────────────────────────────────────────
function calcFocusScore(session) {
  let score = 100;
  score -= (session.tabSwitchCount    || 0) * 5;
  score -= (session.distractionVisits || 0) * 10;
  score -= Math.round((session.distractionSeconds || 0) / 60);
  if (!session.interrupted) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function qualityLabel(score) {
  if (score >= 90) return 'Deep Work';
  if (score >= 70) return 'Focused';
  if (score >= 40) return 'Fragmented';
  return 'Distracted';
}

function calcStreak(prev) {
  if (!prev) return 0;
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  return (prev.date === yest.toISOString().slice(0, 10) && prev.totalFocusMinutes >= 30)
    ? (prev.streak || 0) + 1 : 0;
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function updateBadge(status, remaining) {
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

// ─── Content Script Communication ─────────────────────────────────────────────
// Send a message to a tab's content script, silently ignoring errors
async function msgTab(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch { /* tab not ready or content script not loaded */ }
}

// Ensure content.js is loaded in a tab (for tabs opened before extension)
async function ensureContentScript(tabId, url) {
  if (!isInjectableUrl(url)) return false;
  try {
    // Ping first — if content script responds, it's loaded
    const resp = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return resp?.loaded === true;
  } catch {
    // Not loaded — inject it now
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
      return true;
    } catch { return false; }
  }
}

// Broadcast focus state to all open tabs with content scripts
async function broadcastFocusState(state, sites) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!isInjectableUrl(tab.url)) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'applyFocusMode',
        state,
        sites,
      });
    } catch { /* tab has no content script */ }
  }
}

// Inject content script into ALL open tabs when session starts
async function injectContentScriptAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!isInjectableUrl(tab.url)) continue;
    try {
      // Ping — if no response, inject
      await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      } catch { /* skip non-injectable tabs */ }
    }
  }
}

// ─── Distraction Tracking ─────────────────────────────────────────────────────
let distractionStart = null;
let distractionTabId = null;

async function onEnterDistraction(tabId, url) {
  distractionStart = Date.now();
  distractionTabId = tabId;
  const state = await getState();
  if (!state.currentSession) return;
  const s = state.currentSession;
  await setState({
    currentSession: {
      ...s,
      distractionVisits: (s.distractionVisits || 0) + 1,
      lastDistractionDomain: extractDomain(url),
    },
  });
}

async function onLeaveDistraction() {
  if (distractionStart === null) return;
  const elapsed = Math.round((Date.now() - distractionStart) / 1000);
  distractionStart = null;
  distractionTabId = null;
  const state = await getState();
  if (state.currentSession) {
    const s = state.currentSession;
    await setState({
      currentSession: { ...s, distractionSeconds: (s.distractionSeconds || 0) + elapsed },
    });
  }
}

// ─── Pattern Recording ────────────────────────────────────────────────────────
async function recordPattern(session, score) {
  const d     = new Date(session.startTime);
  const hour  = d.getHours();
  const day   = d.getDay();
  const focusMins    = Math.round((session.duration || 0) / 60);
  const distractMins = Math.round((session.distractionSeconds || 0) / 60);
  const p = await getPatterns();
  p.focusMinutesByHour[hour] = (p.focusMinutesByHour[hour] || 0) + focusMins;
  p.focusMinutesByDay[day]   = (p.focusMinutesByDay[day]   || 0) + focusMins;
  p.distractionByHour[hour]  = (p.distractionByHour[hour]  || 0) + distractMins;
  p.sessionsByHour[hour]     = (p.sessionsByHour[hour]      || 0) + 1;
  p.scoresByHour[hour]       = (p.scoresByHour[hour]        || 0) + score;
  await chrome.storage.local.set({ [KEY_PATTERNS]: p });
}

// ─── Weekly Data ──────────────────────────────────────────────────────────────
async function recordSessionToWeekly(session, score) {
  const weekly = await getWeeklyData();
  const day = todayKey();
  const e = weekly.days[day] || {
    focusMinutes: 0, sessions: 0, distractionMinutes: 0,
    totalScore: 0, scoreCount: 0,
    qualityCounts: { 'Deep Work':0,'Focused':0,'Fragmented':0,'Distracted':0 },
  };
  const ql = qualityLabel(score);
  const qc = { ...e.qualityCounts };
  qc[ql] = (qc[ql] || 0) + 1;
  weekly.days[day] = {
    focusMinutes:      e.focusMinutes + Math.round((session.duration || 0) / 60),
    sessions:          e.sessions + 1,
    distractionMinutes: e.distractionMinutes + Math.round((session.distractionSeconds || 0) / 60),
    totalScore:        e.totalScore + score,
    scoreCount:        e.scoreCount + 1,
    qualityCounts:     qc,
  };
  await chrome.storage.local.set({ [KEY_WEEKLY]: weekly });
}

// ─── Timer: Start ─────────────────────────────────────────────────────────────
async function startTimer(duration) {
  const now = Date.now();
  const newState = await setState({
    status: 'running',
    duration,
    remaining: duration,
    startedAt: now,
    pausedAt: null,
    elapsedBeforePause: 0,
    pendingReflection: null,
    currentSession: {
      id: uid(),
      startTime: now,
      duration,
      tabSwitchCount: 0,
      distractionVisits: 0,
      distractionSeconds: 0,
      lastDistractionDomain: null,
      interrupted: false,
    },
  });

  chrome.alarms.create(ALARM_COMPLETE, { delayInMinutes: duration / 60 });
  chrome.alarms.create(ALARM_TICK,     { periodInMinutes: 1 });
  updateBadge('running', duration);

  // Inject content script into all existing tabs, then broadcast state
  await injectContentScriptAllTabs();
  const sites = await getDistracting();
  await broadcastFocusState(newState, sites);
}

// ─── Timer: Pause ─────────────────────────────────────────────────────────────
async function pauseTimer() {
  const state = await getState();
  if (state.status !== 'running') return;
  await onLeaveDistraction();
  const now     = Date.now();
  const elapsed = Math.floor((now - state.startedAt) / 1000) + state.elapsedBeforePause;
  const remaining = Math.max(0, state.duration - elapsed);
  const newState = await setState({
    status: 'paused', pausedAt: now, remaining, elapsedBeforePause: elapsed,
    currentSession: state.currentSession ? { ...state.currentSession, interrupted: true } : null,
  });
  chrome.alarms.clear(ALARM_COMPLETE);
  chrome.alarms.clear(ALARM_TICK);
  updateBadge('paused', remaining);
  const sites = await getDistracting();
  await broadcastFocusState(newState, sites);
}

// ─── Timer: Resume ────────────────────────────────────────────────────────────
async function resumeTimer() {
  const state = await getState();
  if (state.status !== 'paused') return;
  const now = Date.now();
  const newState = await setState({ status: 'running', startedAt: now, pausedAt: null });
  chrome.alarms.create(ALARM_COMPLETE, { delayInMinutes: state.remaining / 60 });
  chrome.alarms.create(ALARM_TICK,     { periodInMinutes: 1 });
  updateBadge('running', state.remaining);
  await injectContentScriptAllTabs();
  const sites = await getDistracting();
  await broadcastFocusState(newState, sites);
}

// ─── Timer: Reset ─────────────────────────────────────────────────────────────
async function resetTimer() {
  await onLeaveDistraction();
  chrome.alarms.clear(ALARM_COMPLETE);
  chrome.alarms.clear(ALARM_TICK);
  const state = await getState();
  const newState = await setState({
    ...DEFAULT_STATE, duration: state.duration, remaining: state.duration,
  });
  updateBadge('idle', 0);
  await broadcastCleanup();
}

// ─── Timer: Complete ──────────────────────────────────────────────────────────
async function completeSession() {
  await onLeaveDistraction();
  chrome.alarms.clear(ALARM_COMPLETE);
  chrome.alarms.clear(ALARM_TICK);

  const state     = await getState();
  const session   = state.currentSession || {};
  const score     = calcFocusScore(session);
  const ql        = qualityLabel(score);
  const focusMins = Math.round(state.duration / 60);
  const sessionId = session.id || uid();

  // Persist session
  const sr = await chrome.storage.local.get(KEY_SESSIONS);
  const sessions = sr[KEY_SESSIONS] || [];
  sessions.push({
    ...session, id: sessionId, endTime: Date.now(),
    duration: state.duration, score, qualityLabel: ql, completed: true,
  });
  if (sessions.length > 200) sessions.splice(0, sessions.length - 200);
  await chrome.storage.local.set({ [KEY_SESSIONS]: sessions });

  // Stats
  const stats = await getStats();
  await patchStats({
    totalFocusMinutes:       stats.totalFocusMinutes + focusMins,
    sessionsCompleted:       stats.sessionsCompleted + 1,
    totalTabSwitches:        stats.totalTabSwitches + (session.tabSwitchCount || 0),
    totalDistractionVisits:  stats.totalDistractionVisits + (session.distractionVisits || 0),
    totalDistractionSeconds: stats.totalDistractionSeconds + (session.distractionSeconds || 0),
  });

  await recordPattern(session, score);
  await recordSessionToWeekly(session, score);

  const reflectionData = { sessionId, score, qualityLabel: ql, duration: state.duration };

  await setState({
    ...DEFAULT_STATE, duration: state.duration, remaining: state.duration,
    pendingReflection: reflectionData,
  });

  updateBadge('idle', 0);

  // Try to show session overlay in the active tab
  const shown = await showSessionOverlayInActiveTab(reflectionData);

  // Fallback: Chrome notification if overlay couldn't be injected
  if (!shown) {
    try {
      chrome.notifications.create('focusComplete_' + sessionId, {
        type: 'basic',
        iconUrl: 'icon128.png',
        title: `Focus Session Complete — ${ql}`,
        message: `${focusMins}m session · Score: ${score}. Open the extension to save your reflection.`,
        priority: 2,
      });
    } catch { /* notifications may be unavailable */ }
  }

  // Broadcast cleanup to all other tabs
  await broadcastCleanup();
}

// Show session overlay in the currently active tab
async function showSessionOverlayInActiveTab(data) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !isInjectableUrl(activeTab.url)) return false;

    await ensureContentScript(activeTab.id, activeTab.url);
    await chrome.tabs.sendMessage(activeTab.id, {
      action: 'showSessionOverlay',
      data,
    });
    return true;
  } catch {
    return false;
  }
}

// Clean up visual enforcement on all tabs
async function broadcastCleanup() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!isInjectableUrl(tab.url)) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'cleanupFocusMode' });
    } catch { /* tab not ready */ }
  }
}

// ─── Tick ─────────────────────────────────────────────────────────────────────
async function tick() {
  const state = await getState();
  if (state.status !== 'running') return;
  const elapsed   = Math.floor((Date.now() - state.startedAt) / 1000) + state.elapsedBeforePause;
  const remaining = Math.max(0, state.duration - elapsed);
  const newState  = await setState({ remaining });
  updateBadge('running', remaining);

  // Broadcast tick so content scripts can update the indicator countdown
  const sites = await getDistracting();
  await broadcastFocusState(newState, sites);

  if (remaining <= 0) await completeSession();
}

// ─── Tab Activation ───────────────────────────────────────────────────────────
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const state = await getState();
  if (state.status !== 'running' || !state.currentSession) return;

  // Count tab switch
  const s = state.currentSession;
  const newState = await setState({
    currentSession: { ...s, tabSwitchCount: (s.tabSwitchCount || 0) + 1 },
  });
  const stats = await getStats();
  await patchStats({ totalTabSwitches: stats.totalTabSwitches + 1 });
  await onLeaveDistraction();

  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  const url = tab.url || tab.pendingUrl || '';

  if (!isInjectableUrl(url)) return;

  // Ensure content script is present (tab may have been open before session)
  await ensureContentScript(tabId, url);

  if (await isDistractingUrl(url)) {
    await onEnterDistraction(tabId, url);
  }

  // Send current state to newly focused tab
  const sites = await getDistracting();
  await msgTab(tabId, { action: 'applyFocusMode', state: newState, sites });
});

// ─── Web Navigation ───────────────────────────────────────────────────────────
chrome.webNavigation.onCommitted.addListener(async ({ tabId, url, frameId }) => {
  if (frameId !== 0) return;
  const state = await getState();
  if (state.status !== 'running' || !state.currentSession) return;
  if (!isInjectableUrl(url)) return;

  const wasDistracting = distractionTabId === tabId;
  const nowDistracting = await isDistractingUrl(url);

  if (wasDistracting && !nowDistracting) await onLeaveDistraction();
  else if (!wasDistracting && nowDistracting) await onEnterDistraction(tabId, url);
});

// On navigation complete, ensure content script and re-apply state
// (handles page reloads — content script gets re-injected by manifest, but
//  this is the safety net for programmatic injection)
chrome.webNavigation.onCompleted.addListener(async ({ tabId, url, frameId }) => {
  if (frameId !== 0) return;
  const state = await getState();
  if (state.status !== 'running') return;
  if (!isInjectableUrl(url)) return;

  const sites = await getDistracting();
  // Small delay for document to be ready
  setTimeout(async () => {
    try {
      await msgTab(tabId, { action: 'applyFocusMode', state, sites });
    } catch { /* content script not yet ready */ }
  }, 150);
});

// ─── Alarms ───────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === ALARM_COMPLETE) await completeSession();
  else if (name === ALARM_TICK) await tick();
});

// ─── Smart Suggestions ────────────────────────────────────────────────────────
async function generateSuggestions() {
  const p           = await getPatterns();
  const suggestions = [];
  const sr          = await chrome.storage.local.get(KEY_SESSIONS);
  const sessions    = (sr[KEY_SESSIONS] || []).filter(s => s.score != null);

  const maxFocusHour = p.focusMinutesByHour.indexOf(Math.max(...p.focusMinutesByHour));
  if (p.focusMinutesByHour[maxFocusHour] > 0) {
    const h = maxFocusHour;
    const label = h < 12 ? `${h || 12}am` : `${h === 12 ? 12 : h - 12}pm`;
    suggestions.push({ type:'peak_time', icon:'⏰',
      title:'Your peak focus hour',
      body:`You do your best deep work around ${label}. Schedule your hardest tasks then.` });
  }

  const maxDistractHour = p.distractionByHour.indexOf(Math.max(...p.distractionByHour));
  if (p.distractionByHour[maxDistractHour] > 5) {
    const h = maxDistractHour;
    const label = h < 12 ? `${h || 12}am` : `${h === 12 ? 12 : h - 12}pm`;
    suggestions.push({ type:'distraction_spike', icon:'⚡',
      title: maxDistractHour >= 12 ? 'Afternoon distraction spike' : 'Morning distraction spike',
      body:`You get most distracted around ${label}. Try scheduling low-stakes tasks for this window.` });
  }

  const DAY_LABELS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const maxDay = p.focusMinutesByDay.indexOf(Math.max(...p.focusMinutesByDay));
  if (p.focusMinutesByDay[maxDay] > 0) {
    suggestions.push({ type:'best_day', icon:'📅',
      title:'Most productive day',
      body:`${DAY_LABELS[maxDay]}s are your strongest focus days. Protect that time.` });
  }

  if (sessions.length >= 6) {
    const recent = sessions.slice(-3).reduce((a, s) => a + s.score, 0) / 3;
    const older  = sessions.slice(-6, -3).reduce((a, s) => a + s.score, 0) / 3;
    if (recent < older - 10) {
      suggestions.push({ type:'declining_score', icon:'📉',
        title:'Focus score declining',
        body:'Your recent sessions score lower. Try a shorter 25-min sprint to rebuild momentum.' });
    } else if (recent > older + 10) {
      suggestions.push({ type:'improving_score', icon:'🚀',
        title:'Focus improving!',
        body:'Your recent sessions show a clear upward trend. Keep the streak going.' });
    }
  }

  if (sessions.length >= 4) {
    const long = sessions.filter(s => (s.duration || 0) >= 3600);
    if (long.length / sessions.length > 0.6) {
      const avg = long.reduce((a, s) => a + s.score, 0) / long.length;
      if (avg < 65) {
        suggestions.push({ type:'session_length', icon:'⏱',
          title:'Long sessions dragging scores down',
          body:'Your 90-min sessions score lower on average. Try alternating with 25-min sprints.' });
      }
    }
  }

  return suggestions.slice(0, 4);
}

// ─── Message Handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {
        case 'start':  await startTimer(msg.duration); break;
        case 'pause':  await pauseTimer(); break;
        case 'resume': await resumeTimer(); break;
        case 'reset':  await resetTimer(); break;

        // Content script callbacks
        case 'contentOverlayReturn': {
          await onLeaveDistraction();
          sendResponse({ ok: true }); return;
        }

        case 'contentOverlayContinue': {
          // User chose to stay on distracting site — just note it, don't penalize twice
          sendResponse({ ok: true }); return;
        }

        // Legacy overlay messages (from overlay.js)
        case 'overlayReturn': {
          await onLeaveDistraction();
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const sites = await getDistracting();
          const ft = tabs.find(t => !sites.some(s => {
            const d = extractDomain(t.url || '');
            return d === s || d.endsWith('.' + s);
          }));
          if (ft) chrome.tabs.update(ft.id, { active: true });
          sendResponse({ ok: true }); return;
        }

        case 'overlayContinue': {
          sendResponse({ ok: true }); return;
        }

        case 'saveReflection': {
          const rr   = await chrome.storage.local.get(KEY_REFLECTIONS);
          const refs = rr[KEY_REFLECTIONS] || {};
          refs[msg.sessionId] = { text: msg.text, savedAt: Date.now() };
          await chrome.storage.local.set({ [KEY_REFLECTIONS]: refs });
          const st = await getState();
          if (st.pendingReflection?.sessionId === msg.sessionId) {
            await setState({ pendingReflection: null });
          }
          sendResponse({ ok: true }); return;
        }

        case 'skipReflection': {
          const st = await getState();
          if (st.pendingReflection?.sessionId === msg.sessionId) {
            await setState({ pendingReflection: null });
          }
          sendResponse({ ok: true }); return;
        }

        case 'getReflections': {
          const rr = await chrome.storage.local.get(KEY_REFLECTIONS);
          sendResponse({ reflections: rr[KEY_REFLECTIONS] || {} }); return;
        }

        case 'addSite': {
          const sites  = await getDistracting();
          const domain = msg.domain.toLowerCase().replace(/^www\./, '').trim();
          if (domain && !sites.includes(domain)) {
            sites.push(domain);
            await chrome.storage.local.set({ [KEY_SITES]: sites });
          }
          sendResponse({ sites }); return;
        }

        case 'removeSite': {
          let sites = await getDistracting();
          sites = sites.filter(s => s !== msg.domain);
          await chrome.storage.local.set({ [KEY_SITES]: sites });
          sendResponse({ sites }); return;
        }

        case 'getSites':       { sendResponse({ sites: await getDistracting() }); return; }
        case 'getWeekly':      { sendResponse({ weekly: await getWeeklyData() }); return; }
        case 'getPatterns':    { sendResponse({ patterns: await getPatterns() }); return; }
        case 'getSuggestions': { sendResponse({ suggestions: await generateSuggestions() }); return; }

        case 'getSessions': {
          const r = await chrome.storage.local.get(KEY_SESSIONS);
          sendResponse({ sessions: r[KEY_SESSIONS] || [] }); return;
        }
      }
    } catch (e) { console.error('[FocusTimer BG]', e); }

    const state = await getState();
    const stats = await getStats();
    sendResponse({ state, stats });
  })();
  return true;
});

// ─── Startup ──────────────────────────────────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  if (state.status === 'running') {
    const elapsed   = Math.floor((Date.now() - state.startedAt) / 1000) + state.elapsedBeforePause;
    const remaining = Math.max(0, state.duration - elapsed);
    if (remaining <= 0) {
      await completeSession();
    } else {
      const newState = await setState({ remaining });
      updateBadge('running', remaining);
      chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
      // Re-apply visual state to all tabs after browser restart
      await injectContentScriptAllTabs();
      const sites = await getDistracting();
      await broadcastFocusState(newState, sites);
    }
  }
});
