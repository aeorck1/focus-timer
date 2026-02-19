// overlay.js — Legacy distraction overlay (kept for backward compat)
// Phase 4: Main logic is now in content.js. This file is a no-op redirect.
(function () {
  if (document.getElementById('__focus_overlay__')) return;
  // Delegate to content script messaging system
  chrome.runtime.sendMessage({ action: 'ping' });
})();
