// =============================================================================
// Focus Timer — Popup Script (Phase 4)
// Reflection is now handled by the in-page session overlay (content.js).
// Popup only shows the pending reflection modal as a fallback if the user
// opens the popup before visiting any page after session completion.
// =============================================================================

let state = null;
let stats = null;
let tickId = null;

const $ = id => document.getElementById(id);
const CIRCUMFERENCE = 534;
const SCORE_CIRC    = 201;
const DAY_NAMES     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_SHORT     = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const timeDisplay       = $('timeDisplay');
const timerLabel        = $('timerLabel');
const sessionMeta       = $('sessionMeta');
const distractionChip   = $('distractionChip');
const distractionCount  = $('distractionCount');
const tabSwitchCount    = $('tabSwitchCount');
const scorePreview      = $('scorePreview');
const scoreBarFill      = $('scoreBarFill');
const scoreLive         = $('scoreLive');
const ringEl            = document.querySelector('.ring');
const ringProgress      = $('ringProgress');
const ringGlow          = $('ringGlow');
const mainBtn           = $('mainBtn');
const resetBtn          = $('resetBtn');
const presetsRow        = $('presetsRow');
const customBtn         = $('customBtn');
const customRow         = $('customRow');
const customMins        = $('customMins');
const setCustom         = $('setCustom');
const streakCount       = $('streakCount');
const streakBadge       = $('streakBadge');
const todayMinutes      = $('todayMinutes');
const todaySessions     = $('todaySessions');
const todayDistractions = $('todayDistractions');

// Weekly tab
const wkFocusTotal      = $('wkFocusTotal');
const wkDistractTotal   = $('wkDistractTotal');
const wkAvgScore        = $('wkAvgScore');
const wkBestDay         = $('wkBestDay');
const weekRange         = $('weekRange');
const chartBars         = $('chartBars');
const chartLabels       = $('chartLabels');
const qualityBars       = $('qualityBars');
const sessionsList      = $('sessionsList');

// Insights
const iPeakHour         = $('iPeakHour');
const iPeakDay          = $('iPeakDay');
const iAvgScore         = $('iAvgScore');
const heatmap           = $('heatmap');
const heatmapAxis       = $('heatmapAxis');
const suggestionsList   = $('suggestionsList');

// Settings
const siteInput         = $('siteInput');
const siteAddBtn        = $('siteAddBtn');
const sitesList         = $('sitesList');

// Reflection modal (fallback only)
const reflectionModal   = $('reflectionModal');
const modalScoreNum     = $('modalScoreNum');
const modalQualityLabel = $('modalQualityLabel');
const mscoreFill        = $('mscore-fill');
const reflectionText    = $('reflectionText');
const saveReflectionBtn = $('saveReflectionBtn');
const skipReflectionBtn = $('skipReflectionBtn');

// ─── Utils ────────────────────────────────────────────────────────────────────
function fmt(secs) {
  const m = Math.floor(Math.max(0, secs) / 60);
  const s = Math.max(0, secs) % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtMins(mins) {
  if (!mins) return '0m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins/60)}h ${mins%60 ? mins%60+'m' : ''}`.trim();
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function fmtHour(h) {
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

function msg(action, extra = {}) {
  return new Promise(r => chrome.runtime.sendMessage({ action, ...extra }, r));
}

function calcLiveScore(s) {
  if (!s) return 100;
  let score = 100;
  score -= (s.tabSwitchCount    || 0) * 5;
  score -= (s.distractionVisits || 0) * 10;
  score -= Math.round((s.distractionSeconds || 0) / 60);
  if (!s.interrupted) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function qualityColor(label) {
  return { 'Deep Work':'#818cf8', 'Focused':'#4ade80',
           'Fragmented':'#fbbf24', 'Distracted':'#f87171' }[label] || '#5a6080';
}

function scoreColor(s) {
  return s >= 70 ? '#818cf8' : s >= 40 ? '#fbbf24' : '#f87171';
}

// ─── Tab Navigation ───────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'stats')    loadWeekly();
    if (btn.dataset.tab === 'insights') loadInsights();
    if (btn.dataset.tab === 'settings') loadSites();
  });
});

// ─── Fallback Reflection Modal ────────────────────────────────────────────────
// Only shown when user opens popup while pendingReflection exists and no page
// is available to show the in-page overlay (e.g. only chrome:// tabs open)
let pendingSessionId = null;

function showReflectionModal(reflection) {
  pendingSessionId = reflection.sessionId;
  const score = reflection.score;
  const ql    = reflection.qualityLabel;

  modalScoreNum.textContent     = score;
  modalQualityLabel.textContent = ql;
  modalQualityLabel.style.color = qualityColor(ql);

  const offset = SCORE_CIRC * (1 - score / 100);
  mscoreFill.style.stroke           = qualityColor(ql);
  mscoreFill.style.strokeDashoffset = offset;

  reflectionText.value = '';
  reflectionModal.style.display = 'flex';
  setTimeout(() => reflectionText.focus(), 100);
}

function hideReflectionModal() {
  reflectionModal.style.display = 'none';
  pendingSessionId = null;
}

saveReflectionBtn.addEventListener('click', async () => {
  const text = reflectionText.value.trim();
  if (!pendingSessionId) { hideReflectionModal(); return; }
  await msg('saveReflection', { sessionId: pendingSessionId, text });
  hideReflectionModal();
  const r = await msg('getState');
  if (r) { state = r.state; stats = r.stats; renderTimer(); }
});

skipReflectionBtn.addEventListener('click', async () => {
  if (pendingSessionId) await msg('skipReflection', { sessionId: pendingSessionId });
  hideReflectionModal();
});

reflectionText.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveReflectionBtn.click();
});

// ─── Timer Render ─────────────────────────────────────────────────────────────
function renderTimer() {
  if (!state || !stats) return;
  const { status, remaining, duration, currentSession: cs } = state;

  timeDisplay.textContent = fmt(remaining);

  const frac   = duration > 0 ? Math.max(0, Math.min(1, remaining / duration)) : 1;
  const offset = CIRCUMFERENCE * (1 - frac);
  ringProgress.style.strokeDashoffset = offset;
  ringGlow.style.strokeDashoffset     = offset;
  ringEl.className = `ring ring-${status}`;

  timerLabel.textContent = { idle:'READY', running:'FOCUS', paused:'PAUSED' }[status] || 'READY';

  if (status !== 'idle' && cs) {
    sessionMeta.style.display = 'flex';
    tabSwitchCount.textContent = cs.tabSwitchCount || 0;
    if ((cs.distractionVisits || 0) > 0) {
      distractionChip.style.display = 'inline-flex';
      distractionCount.textContent  = cs.distractionVisits;
    } else {
      distractionChip.style.display = 'none';
    }
  } else {
    sessionMeta.style.display = 'none';
  }

  if (status === 'running' && cs) {
    scorePreview.style.display = 'flex';
    const score = calcLiveScore(cs);
    scoreLive.textContent         = score;
    scoreBarFill.style.width      = score + '%';
    scoreBarFill.style.background = scoreColor(score);
  } else {
    scorePreview.style.display = 'none';
  }

  const cfgs = {
    running: { text:'Pause',  cls:'btn-primary btn-pause'  },
    paused:  { text:'Resume', cls:'btn-primary btn-resume' },
    idle:    { text:'Start',  cls:'btn-primary'            },
  };
  const cfg = cfgs[status] || cfgs.idle;
  mainBtn.textContent = cfg.text;
  mainBtn.className   = cfg.cls;

  presetsRow.querySelectorAll('.preset').forEach(b => { b.disabled = status !== 'idle'; });

  const h = Math.floor(stats.totalFocusMinutes / 60);
  const m = stats.totalFocusMinutes % 60;
  todayMinutes.textContent      = h > 0 ? `${h}h ${m}m` : `${m}m`;
  todaySessions.textContent     = stats.sessionsCompleted;
  todayDistractions.textContent = stats.totalDistractionVisits || 0;

  streakCount.textContent    = stats.streak;
  streakBadge.style.opacity  = stats.streak > 0 ? '1' : '0.3';
}

// ─── Weekly Stats ─────────────────────────────────────────────────────────────
async function loadWeekly() {
  const [wRes, sRes] = await Promise.all([msg('getWeekly'), msg('getSessions')]);
  const weekly   = wRes?.weekly;
  const sessions = sRes?.sessions || [];
  if (!weekly) return;

  const wStart = new Date(weekly.weekStart + 'T00:00:00');
  const wEnd   = new Date(wStart); wEnd.setDate(wEnd.getDate() + 6);
  weekRange.textContent = `${fmtDate(weekly.weekStart)} – ${fmtDate(wEnd.toISOString().slice(0,10))}`;

  let totalFocus = 0, totalDistract = 0, totalScore = 0, scoreCount = 0;
  let bestDay = null, bestDayMins = 0;
  const qualityTotals = { 'Deep Work':0, 'Focused':0, 'Fragmented':0, 'Distracted':0 };

  Object.entries(weekly.days).forEach(([date, d]) => {
    totalFocus    += d.focusMinutes       || 0;
    totalDistract += d.distractionMinutes || 0;
    totalScore    += d.totalScore         || 0;
    scoreCount    += d.scoreCount         || 0;
    if ((d.focusMinutes||0) > bestDayMins) { bestDayMins = d.focusMinutes; bestDay = date; }
    Object.entries(d.qualityCounts || {}).forEach(([ql, cnt]) => {
      qualityTotals[ql] = (qualityTotals[ql] || 0) + cnt;
    });
  });

  wkFocusTotal.textContent    = fmtMins(totalFocus);
  wkDistractTotal.textContent = fmtMins(totalDistract);
  wkAvgScore.textContent      = scoreCount > 0 ? Math.round(totalScore / scoreCount) : '—';
  wkBestDay.textContent       = bestDay ? DAY_NAMES[new Date(bestDay+'T00:00:00').getDay()] : '—';

  const totalSessions = Object.values(qualityTotals).reduce((a,b) => a+b, 0);
  if (totalSessions > 0) {
    qualityBars.innerHTML = Object.entries(qualityTotals).map(([ql, cnt]) => {
      const pct = Math.round((cnt / totalSessions) * 100);
      return `<div class="quality-row">
        <span class="quality-name">${ql}</span>
        <div class="quality-track"><div class="quality-fill" style="width:${pct}%;background:${qualityColor(ql)}"></div></div>
        <span class="quality-pct">${pct}%</span>
      </div>`;
    }).join('');
  } else {
    qualityBars.innerHTML = '<div class="no-data-msg">No sessions this week</div>';
  }

  const bars = [], labelItems = [];
  const maxMins  = Math.max(...Object.values(weekly.days).map(d => d.focusMinutes||0), 1);
  const todayIso = new Date().toISOString().slice(0,10);

  for (let i = 0; i < 7; i++) {
    const d   = new Date(weekly.weekStart + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const key  = d.toISOString().slice(0,10);
    const data = weekly.days[key];
    const mins = data?.focusMinutes || 0;
    bars.push({ pct: Math.round((mins / maxMins) * 100), mins, isToday: key === todayIso });
    labelItems.push({ label: DAY_SHORT[d.getDay()], isToday: key === todayIso });
  }

  chartBars.innerHTML = bars.map(b => `
    <div class="bar-col"><div class="bar-track">
      <div class="bar-fill${b.isToday?' bar-today':''}" style="height:${Math.max(b.pct,2)}%" title="${b.mins}m"></div>
    </div></div>`).join('');
  chartLabels.innerHTML = labelItems.map((l,i) =>
    `<span class="${l.isToday?'label-today':''}">${l.label}</span>`).join('');

  const refs = (await msg('getReflections'))?.reflections || {};
  const recent = [...sessions].reverse().slice(0, 10);

  if (recent.length === 0) {
    sessionsList.innerHTML = '<div class="sessions-empty">No sessions yet</div>';
  } else {
    sessionsList.innerHTML = recent.map(s => {
      const d       = new Date(s.startTime || 0);
      const timeStr = d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
      const dateStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
      const score   = s.score ?? '—';
      const sc      = typeof score === 'number' ? scoreColor(score) : '#5a6080';
      const ql      = s.qualityLabel || '';   
      const qlColor = qualityColor(ql);
      const ref     = refs[s.id];
      return `<div class="session-row">
        <div class="session-info">
          <div class="session-top-row">
            <span class="session-dur">${Math.round((s.duration||0)/60)}m</span>
            ${ql ? `<span class="session-ql" style="color:${qlColor}">${ql}</span>` : ''}
          </div>
          <span class="session-date">${dateStr} ${timeStr}</span>
          ${ref ? `<span class="session-reflection">"${ref.text.slice(0,60)}${ref.text.length>60?'…':''}"</span>` : ''}
        </div>
        <div class="session-right">
          ${!s.distractionVisits ? `<span class="session-dist">⚡${s.distractionVisits}</span>` : ''}
          <span class="session-score" style="color:${sc}">${score}</span>
        </div>
      </div>`;
    }).join('');
  }
}

// ─── Insights ─────────────────────────────────────────────────────────────────
async function loadInsights() {
  const [pRes, sugRes, sRes] = await Promise.all([
    msg('getPatterns'), msg('getSuggestions'), msg('getSessions'),
  ]);
  const p = pRes?.patterns;
  const suggestions = sugRes?.suggestions || [];
  const sessions    = sRes?.sessions || [];
  if (!p) return;

  const focusHours = p.focusMinutesByHour;
  const peakHour   = focusHours.indexOf(Math.max(...focusHours));
  iPeakHour.textContent = focusHours[peakHour] > 0 ? fmtHour(peakHour) : '—';

  const focusDays = p.focusMinutesByDay;
  const peakDay   = focusDays.indexOf(Math.max(...focusDays));
  iPeakDay.textContent = focusDays[peakDay] > 0 ? DAY_NAMES[peakDay].slice(0,3) : '—';

  const scored = sessions.filter(s => s.score != null);
  const avg    = scored.length > 0 ? Math.round(scored.reduce((a,s)=>a+s.score,0) / scored.length) : null;
  iAvgScore.textContent = avg !== null ? avg : '—';

  const maxFocus = Math.max(...focusHours, 1);
  heatmap.innerHTML = focusHours.map((mins, h) => {
    const opacity = Math.max(0.04, mins / maxFocus);
    const isBest  = h === peakHour && mins > 0;
    return `<div class="heat-cell${isBest?' heat-best':''}" style="opacity:${opacity.toFixed(2)}" title="${fmtHour(h)}: ${mins}m"></div>`;
  }).join('');
  heatmapAxis.innerHTML = [0,4,8,12,16,20].map(h=>`<span>${fmtHour(h)}</span>`).join('');

  if (suggestions.length === 0) {
    suggestionsList.innerHTML = '<div class="no-data-msg">Complete more sessions to unlock personalised recommendations.</div>';
  } else {
    suggestionsList.innerHTML = suggestions.map(s => `
      <div class="suggestion-card">
        <div class="suggestion-icon">${s.icon}</div>
        <div class="suggestion-body">
          <div class="suggestion-title">${s.title}</div>
          <div class="suggestion-text">${s.body}</div>
        </div>
      </div>`).join('');
  }
}

// ─── Sites ────────────────────────────────────────────────────────────────────
async function loadSites() {
  const res = await msg('getSites');
  renderSites(res?.sites || []);
}

function renderSites(sites) {
  sitesList.innerHTML = '';
  sites.forEach(site => {
    const row = document.createElement('div');
    row.className = 'site-row';
    row.innerHTML = `
      <span class="site-domain">${site}</span>
      <button class="site-remove" title="Remove">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;
    row.querySelector('.site-remove').addEventListener('click', async () => {
      const r = await msg('removeSite', { domain: site });
      if (r?.sites) renderSites(r.sites);
    });
    sitesList.appendChild(row);
  });
}

siteAddBtn.addEventListener('click', async () => {
  const val = siteInput.value.trim().toLowerCase()
    .replace(/^www\./, '').replace(/^https?:\/\//, '').split('/')[0];
  if (!val) return;
  const r = await msg('addSite', { domain: val });
  if (r?.sites) { renderSites(r.sites); siteInput.value = ''; }
});

siteInput.addEventListener('keydown', e => { if (e.key === 'Enter') siteAddBtn.click(); });

// ─── Timer Controls ───────────────────────────────────────────────────────────
mainBtn.addEventListener('click', async () => {
  if (state?.status === 'running') {
    stopTick();
    const r = await msg('pause');
    state = r?.state; stats = r?.stats;
    renderTimer();
  } else if (state?.status === 'paused') {
    const r = await msg('resume');
    state = r?.state; stats = r?.stats;
    renderTimer();
    startTick();
  } else {
    const duration = state?.duration || 25 * 60;
    const r = await msg('start', { duration });
    state = r?.state; stats = r?.stats;
    renderTimer();
    startTick();
  }
});

resetBtn.addEventListener('click', async () => {
  stopTick();
  const r = await msg('reset');
  state = r?.state; stats = r?.stats;
  renderTimer();
});

presetsRow.querySelectorAll('.preset:not(.custom-preset)').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state?.status !== 'idle') return;
    presetsRow.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.duration = parseInt(btn.dataset.mins) * 60;
    state.remaining = state.duration;
    customRow.style.display = 'none';
    renderTimer();
  });
});

customBtn.addEventListener('click', () => {
  if (state?.status !== 'idle') return;
  customRow.style.display = customRow.style.display === 'none' ? 'flex' : 'none';
  if (customRow.style.display === 'flex') customMins.focus();
});

setCustom.addEventListener('click', () => {
  const mins = parseInt(customMins.value);
  if (!mins || mins < 1 || mins > 180) return;
  presetsRow.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
  customBtn.classList.add('active');
  customBtn.textContent = `${mins}m`;
  state.duration  = mins * 60;
  state.remaining = mins * 60;
  customRow.style.display = 'none';
  renderTimer();
});

customMins.addEventListener('keydown', e => { if (e.key === 'Enter') setCustom.click(); });

// ─── 1-second tick ────────────────────────────────────────────────────────────
function startTick() {
  stopTick();
  tickId = setInterval(async () => {
    if (!state || state.status !== 'running') { stopTick(); return; }
    const elapsed   = Math.floor((Date.now() - state.startedAt) / 1000) + (state.elapsedBeforePause || 0);
    const remaining = Math.max(0, state.duration - elapsed);
    state.remaining = remaining;
    renderTimer();
    if (remaining <= 0) {
      stopTick();
      const r = await new Promise(resolve =>
        chrome.runtime.sendMessage({ action: 'getState' }, resolve));
      if (r) { state = r.state; stats = r.stats; renderTimer(); }
      if (state?.pendingReflection) showReflectionModal(state.pendingReflection);
    }
  }, 1000);
}

function stopTick() {
  if (tickId) { clearInterval(tickId); tickId = null; }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const r = await new Promise(resolve =>
    chrome.runtime.sendMessage({ action: 'getState' }, resolve));
  if (!r) return;

  state = r.state;
  stats = r.stats;

  const durMins = (state.duration || 1500) / 60;
  presetsRow.querySelectorAll('.preset').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.mins) === durMins);
  });

  renderTimer();

  if (state.status === 'running') startTick();

  // Show fallback reflection modal if in-page overlay couldn't run
  if (state.pendingReflection) showReflectionModal(state.pendingReflection);
}

document.addEventListener('DOMContentLoaded', init);
window.addEventListener('unload', stopTick);
