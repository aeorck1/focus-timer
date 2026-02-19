// =============================================================================
// Focus Timer — Content Script (Phase 4)
// Runs at document_start on every page. Syncs with background state via
// chrome.storage.onChanged and responds to messages from the background.
// =============================================================================

(function () {
  'use strict';

  // Guard: only run once per document
  if (window.__focusTimerContentLoaded) return;
  window.__focusTimerContentLoaded = true;

  // ─── IDs & classnames ─────────────────────────────────────────────────────
  const INDICATOR_ID      = '__ft_indicator__';
  const DISTRACT_ID       = '__ft_distract__';
  const SESSION_OVERLAY_ID = '__ft_session_overlay__';
  const BLUR_CLASS        = '__ft_blurred__';
  const FADE_CLASS        = '__ft_faded__';

  // ─── State ────────────────────────────────────────────────────────────────
  let currentFocusStatus = 'idle';   // 'idle' | 'running' | 'paused'
  let isDistractingSite  = false;
  let continueAnyway     = false;    // user dismissed distract overlay for this page load

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function extractDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  }

  function currentDomain() {
    return extractDomain(window.location.href);
  }

  // ─── Focus Indicator Bar (productive sites) ───────────────────────────────
  function showIndicator(remaining) {
    removeIndicator();
    if (isDistractingSite || currentFocusStatus !== 'running') return;

    const bar = document.createElement('div');
    bar.id = INDICATOR_ID;
    const mins = Math.ceil((remaining || 0) / 60);
    bar.innerHTML = `
      <span class="ft-ind-dot"></span>
      <span class="ft-ind-text">Focus Mode · ${mins}m left</span>
    `;
    document.documentElement.appendChild(bar);
  }

  function updateIndicator(remaining) {
    const bar = document.getElementById(INDICATOR_ID);
    if (!bar) { showIndicator(remaining); return; }
    const mins = Math.ceil((remaining || 0) / 60);
    const textEl = bar.querySelector('.ft-ind-text');
    if (textEl) textEl.textContent = `Focus Mode · ${mins}m left`;
  }

  function removeIndicator() {
    document.getElementById(INDICATOR_ID)?.remove();
  }

  // ─── Page Fading (productive sites, subtle) ───────────────────────────────
  function applyFade() {
    document.documentElement.classList.add(FADE_CLASS);
  }

  function removeFade() {
    document.documentElement.classList.remove(FADE_CLASS);
    document.documentElement.classList.remove(BLUR_CLASS);
  }

  // ─── Distraction Overlay ──────────────────────────────────────────────────
  function showDistractionOverlay() {
    if (document.getElementById(DISTRACT_ID)) return;
    if (continueAnyway) return;

    // Blur page
    document.documentElement.classList.add(BLUR_CLASS);

    const el = document.createElement('div');
    el.id = DISTRACT_ID;
    el.innerHTML = `
      <div class="ft-d-backdrop"></div>
      <div class="ft-d-card">
        <div class="ft-d-icon">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="17" stroke="#818cf8" stroke-width="2" stroke-dasharray="5 4"/>
            <circle cx="20" cy="20" r="6" fill="#818cf8"/>
          </svg>
        </div>
        <h2 class="ft-d-title">Focus Mode Active</h2>
        <p class="ft-d-sub">This site is on your distraction list.<br>Every visit reduces your focus score.</p>
        <div class="ft-d-actions">
          <button class="ft-d-btn ft-d-primary" id="ft-return-btn">← Return to focus</button>
          <button class="ft-d-btn ft-d-ghost" id="ft-continue-btn">Continue anyway</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(el);

    document.getElementById('ft-return-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'contentOverlayReturn' });
      removeDistractionOverlay();
      window.history.back();
    });

    document.getElementById('ft-continue-btn').addEventListener('click', () => {
      continueAnyway = true;
      removeDistractionOverlay();
      chrome.runtime.sendMessage({ action: 'contentOverlayContinue' });
    });
  }

  function removeDistractionOverlay() {
    document.getElementById(DISTRACT_ID)?.remove();
    document.documentElement.classList.remove(BLUR_CLASS);
  }

  // ─── Session Complete Overlay ─────────────────────────────────────────────
  function showSessionOverlay(data) {
    // data: { sessionId, score, qualityLabel, duration }
    if (document.getElementById(SESSION_OVERLAY_ID)) return;

    const mins   = Math.round((data.duration || 0) / 60);
    const score  = data.score ?? '—';
    const ql     = data.qualityLabel || 'Complete';
    const colors = { 'Deep Work':'#818cf8', 'Focused':'#4ade80',
                     'Fragmented':'#fbbf24', 'Distracted':'#f87171' };
    const qlColor = colors[ql] || '#818cf8';
    // Score ring (circumference of r=30 circle ≈ 188)
    const CIRC  = 188;
    const offset = CIRC * (1 - Math.max(0, Math.min(100, score)) / 100);

    const el = document.createElement('div');
    el.id = SESSION_OVERLAY_ID;
    el.innerHTML = `
      <div class="ft-so-backdrop"></div>
      <div class="ft-so-card">
        <div class="ft-so-header">
          <div class="ft-so-ring-wrap">
            <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
              <circle class="ft-so-ring-track" cx="45" cy="45" r="30"/>
              <circle class="ft-so-ring-fill" cx="45" cy="45" r="30"
                stroke="${qlColor}"
                stroke-dasharray="${CIRC}"
                stroke-dashoffset="${offset}"
                style="transform:rotate(-90deg);transform-origin:center"/>
            </svg>
            <div class="ft-so-score">${score}</div>
          </div>
          <div class="ft-so-meta">
            <div class="ft-so-complete">Session Complete ✓</div>
            <div class="ft-so-ql" style="color:${qlColor}">${ql}</div>
            <div class="ft-so-duration">${mins} minute session</div>
          </div>
        </div>
        <div class="ft-so-divider"></div>
        <p class="ft-so-prompt">What did you accomplish?</p>
        <textarea
          id="ft-so-textarea"
          class="ft-so-textarea"
          placeholder="Finished the auth module, reviewed pull requests…"
          rows="3"
          maxlength="500"
        ></textarea>
        <div class="ft-so-hint">Cmd+Enter to save</div>
        <div class="ft-so-actions">
          <button class="ft-so-btn ft-so-save" id="ft-so-save">Save reflection</button>
          <button class="ft-so-btn ft-so-skip" id="ft-so-skip">Skip</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(el);

    // Focus textarea
    setTimeout(() => document.getElementById('ft-so-textarea')?.focus(), 120);

    // Save
    document.getElementById('ft-so-save').addEventListener('click', () => {
      const text = document.getElementById('ft-so-textarea')?.value?.trim() || '';
      chrome.runtime.sendMessage({
        action: 'saveReflection',
        sessionId: data.sessionId,
        text,
      });
      removeSessionOverlay();
    });

    // Skip
    document.getElementById('ft-so-skip').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'skipReflection', sessionId: data.sessionId });
      removeSessionOverlay();
    });

    // Cmd/Ctrl+Enter saves
    document.getElementById('ft-so-textarea')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        document.getElementById('ft-so-save')?.click();
      }
    });
  }

  function removeSessionOverlay() {
    document.getElementById(SESSION_OVERLAY_ID)?.remove();
  }

  // ─── Apply / Remove focus enforcement ─────────────────────────────────────
  function applyFocusMode(state, sites) {
    currentFocusStatus = state.status;
    const domain = currentDomain();

    if (!domain || domain === 'newtab' || window.location.protocol === 'chrome:') {
      return cleanup();
    }

    isDistractingSite = sites.some(s => domain === s || domain.endsWith('.' + s));

    if (state.status === 'running') {
      if (isDistractingSite) {
        removeIndicator();
        removeFade();
        if (!continueAnyway) showDistractionOverlay();
      } else {
        removeDistractionOverlay();
        applyFade();
        showIndicator(state.remaining);
      }
    } else {
      cleanup();
    }
  }

  function cleanup() {
    removeIndicator();
    removeFade();
    removeDistractionOverlay();
    removeSessionOverlay();
    continueAnyway = false;
  }

  // ─── Initial sync from storage ────────────────────────────────────────────
  async function syncState() {
    const data = await chrome.storage.local.get(['focusState', 'distractingSites']);
    const state = data.focusState || { status: 'idle', remaining: 0 };
    const sites = data.distractingSites || [];
    applyFocusMode(state, sites);
  }

  // ─── Listen for storage changes (real-time) ───────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.focusState || changes.distractingSites) {
      chrome.storage.local.get(['focusState', 'distractingSites'], (data) => {
        const state = data.focusState || { status: 'idle', remaining: 0 };
        const sites = data.distractingSites || [];
        applyFocusMode(state, sites);

        // Tick: update indicator time
        if (state.status === 'running' && !isDistractingSite) {
          updateIndicator(state.remaining);
        }

        // Session complete overlay: background sets pendingReflection
        if (state.pendingReflection && state.status === 'idle') {
          // Only show on the active tab — background handles targeting
          // We get the signal via message instead (see below)
        }
      });
    }
  });

  // ─── Listen for messages from background ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case 'showSessionOverlay':
        removeDistractionOverlay();
        removeFade();
        removeIndicator();
        showSessionOverlay(msg.data);
        sendResponse({ ok: true });
        break;

      case 'cleanupFocusMode':
        cleanup();
        sendResponse({ ok: true });
        break;

      case 'applyFocusMode':
        applyFocusMode(msg.state, msg.sites);
        sendResponse({ ok: true });
        break;

      case 'ping':
        sendResponse({ ok: true, loaded: true });
        break;
    }
    return false;
  });

  // ─── Handle SPA navigation (pushState / replaceState) ────────────────────
  const _pushState    = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);

  function onNavigate() {
    // Small delay to let the page settle its URL
    setTimeout(syncState, 100);
  }

  history.pushState = function (...args) {
    _pushState(...args);
    onNavigate();
  };

  history.replaceState = function (...args) {
    _replaceState(...args);
    onNavigate();
  };

  window.addEventListener('popstate', onNavigate);

  // ─── Bootstrap ────────────────────────────────────────────────────────────
  // Run immediately (document_start), then again on DOMContentLoaded to
  // ensure the body/html are available for class manipulation
  syncState();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncState);
  }

})();
