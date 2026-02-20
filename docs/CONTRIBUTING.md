# Contributing to Focus Timer

Thank you for your interest in contributing! Focus Timer is designed from the ground up for community extension. Whether you're fixing a bug, adding a feature, or writing a plugin, this document will get you oriented quickly.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Ways to Contribute](#ways-to-contribute)
3. [Development Setup](#development-setup)
4. [Branch Strategy](#branch-strategy)
5. [Pull Request Process](#pull-request-process)
6. [Commit Message Format](#commit-message-format)
7. [Code Style](#code-style)
8. [Where Things Live](#where-things-live)

---

## Code of Conduct

Be kind, be patient, be constructive. We follow the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

---

## Ways to Contribute

| Type | Description |
|------|-------------|
| 🐛 Bug fix | Open an issue first describing the behaviour; then submit a PR |
| ✨ Feature | Discuss in an issue before starting; check the roadmap for alignment |
| 🔌 Plugin | No issue needed — plugins are standalone; add to `src/plugins/` |
| 📝 Docs | Spelling, clarity, missing examples — all welcome |
| 🧪 Tests | We always need more coverage on pure utility functions |
| 🎨 UI / CSS | Keep the dark theme aesthetic; test at 340px popup width |

---

## Development Setup

1. **Clone the repo:**
   ```bash
   git clone https://github.com/your-org/focus-timer.git
   cd focus-timer/focus-timer-v5
   ```

2. **Load the unpacked extension in Chrome:**
   - Navigate to `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** → select the `focus-timer-v5/` directory

3. **After making changes:**
   - Click the reload icon on `chrome://extensions` to pick up background.js changes
   - Content script and popup changes take effect immediately on the next page load / popup open

4. **Inspect the service worker:**
   On `chrome://extensions`, click **"service worker"** next to Focus Timer to open DevTools for the background script.

---

## Branch Strategy

```
main          ← stable releases only
dev           ← integration branch for features
feature/<name> ← your feature branch, forked from dev
fix/<name>    ← bug fix branch, forked from dev
```

Please fork from `dev`, not `main`.

---

## Pull Request Process

1. Open an issue or comment on an existing one to signal your intent.
2. Fork the repo and create your branch from `dev`.
3. Make your changes following the [Code Style](docs/CODE_STYLE.md) guide.
4. Test locally: load the extension, run a session end-to-end.
5. Write a clear PR description: what changed, why, and how to test it.
6. A maintainer will review within 7 days. Expect at least one round of feedback.

**PR checklist:**
- [ ] No business logic in `background.js` (belongs in a module)
- [ ] New public functions have JSDoc comments
- [ ] No hardcoded strings that belong in `storageAdapter.KEYS`
- [ ] Extension loads without errors on `chrome://extensions`
- [ ] A full session (start → complete → reflection) works end-to-end

---

## Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
**Scopes:** `core`, `timer`, `scoring`, `distraction`, `visual`, `insights`, `reflection`, `plugin`, `ui`, `manifest`

Examples:
```
feat(scoring): add bonus for sessions with zero tab switches
fix(visual): ensure content script re-applies after SPA navigation
docs(plugin): add example for onTick hook
```

---

## Code Style

See [CODE_STYLE.md](CODE_STYLE.md) for the full style guide.

Short version:
- ES2020+, no transpiler
- `'use strict'` in every module
- Async/await over `.then()` chains
- JSDoc on every exported function
- 2-space indentation
- Single quotes

---

## Where Things Live

| What | Where |
|------|-------|
| Timer state machine | `src/core/timerEngine.js` |
| Session objects & streaks | `src/core/sessionManager.js` |
| Score formula | `src/core/scoringEngine.js` |
| All `chrome.storage` calls | `src/core/storageAdapter.js` |
| Event hook system | `src/core/eventBus.js` |
| Distraction visit tracking | `src/features/distractionTracking/` |
| Reflection save/load | `src/features/reflectionSystem/` |
| Tab messaging / content inject | `src/features/visualEnforcement/` |
| Pattern analysis & suggestions | `src/features/insightsEngine/` |
| In-page overlays & indicator | `content.js` / `content.css` |
| Popup UI | `popup.js` / `popup.html` / `styles.css` |
| Chrome event wiring | `background.js` |
| Example plugin | `src/plugins/consoleLogger.js` |
