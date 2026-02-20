# Code Style Guide

Focus Timer uses vanilla ES2020+ JavaScript with no transpiler. The goal is code that reads like well-written prose: obvious structure, explicit intent, no clever tricks.

---

## Language

- **ES2020+** — optional chaining (`?.`), nullish coalescing (`??`), `Promise.allSettled`, dynamic `import()`.
- **No TypeScript** — type safety via JSDoc `@typedef` and `@param` annotations.
- **No bundler** — native ES modules, no webpack/rollup/vite.
- **`'use strict'`** — at the top of every module.

---

## Module Structure

Every file follows this order:

```js
/**
 * @fileoverview Short description of the module.
 * @module path/to/module
 */

'use strict';

// 1. Imports (external/chrome APIs first, then core, then features)
import * as storage from '../../core/storageAdapter.js';

// 2. Constants (SCREAMING_SNAKE_CASE)
const MAX_SESSIONS = 200;

// 3. Exported types (JSDoc @typedef only)

// 4. Public API (exported functions, documented with JSDoc)

// 5. Private helpers (underscore-prefixed, not exported)
function _helperFn() { ... }
```

---

## Naming

| Thing | Convention | Example |
|-------|------------|---------|
| Files | `camelCase.js` | `storageAdapter.js` |
| Directories | `camelCase/` | `distractionTracking/` |
| Constants | `SCREAMING_SNAKE_CASE` | `ALARM_COMPLETE` |
| Functions | `camelCase` | `calcFocusScore()` |
| Private fns | `_camelCase` | `_weekKey()` |
| Classes | `PascalCase` | `EventBus` (if ever needed) |
| JSDoc params | `lowerCamelCase` | `@param {number} duration` |

---

## Functions

- **Named exports only** — no default exports from core modules.
- **Async/await** — never `.then()/.catch()` chains in new code.
- **Single responsibility** — if a function does two things, split it.
- **Pure functions** — prefer side-effect-free functions, especially in `scoringEngine.js`.

```js
// ✅ Good
export async function getDailyStats() {
  const today = _todayKey();
  const stored = await storage.getValue(KEYS.STATS, null);
  if (!stored || stored.date !== today) {
    return _createFreshStats(today);
  }
  return stored;
}

// ❌ Bad — mixed concerns, no JSDoc, imperative
export async function getStatsAndUpdateStreak(reset) {
  let s = await chrome.storage.local.get('focusStats');
  if (reset) s = {};
  s.streak = s.streak + 1;
  chrome.storage.local.set(s);
  return s;
}
```

---

## Comments

- **JSDoc on every exported function** — `@param`, `@returns`, one-line description minimum.
- **Inline comments** for non-obvious logic — `why`, not `what`.
- **Section headers** — use the `// ─── Section Name ──` pattern for readability in long files.
- **No TODO without an issue number** — `// TODO(#42): fix edge case when …`

```js
/**
 * Calculates the focus score for a completed session.
 *
 * @param {SessionMetrics} session
 * @returns {number} Integer in [0, 100].
 */
export function calcFocusScore(session) {
  let score = 100;
  // Tab switches penalise context switching even on productive sites
  score -= (session.tabSwitchCount || 0) * 5;
  ...
}
```

---

## Formatting

- **2-space indentation** — no tabs.
- **Single quotes** — `'string'`, not `"string"` (except in HTML attributes).
- **No semicolons** — except where required to avoid ASI edge cases.
- **80-character soft limit** — break long lines at logical boundaries.
- **Trailing comma** on multi-line objects and arrays.

---

## Chrome APIs

- **Always `await`** async Chrome APIs — never fire-and-forget.
- **Wrap in try/catch** when calling APIs that can fail (tab messaging, scripting inject).
- **Never call `chrome.storage` directly outside `storageAdapter.js`** — all storage access goes through the adapter.

```js
// ✅ Good — uses storageAdapter
const sessions = await storage.getSessions();

// ❌ Bad — direct storage access in a feature module
const r = await chrome.storage.local.get('sessions');
```

---

## Error Handling

- Log errors with a consistent prefix: `[ModuleName] description: error`
- Do not silently swallow errors unless the failure is explicitly non-critical (e.g. tab messaging to a tab that may have closed).
- Propagate errors upward from core modules; handle them at the call site.

```js
// ✅ Good
try {
  await chrome.tabs.sendMessage(tabId, payload);
} catch {
  // Tab closed before message was delivered — not a bug
}

// ❌ Bad — hides real errors
try {
  await doSomethingImportant();
} catch { }
```

---

## Git

- Follow the commit message format in [CONTRIBUTING.md](CONTRIBUTING.md).
- One logical change per commit.
- Squash fixup commits before opening a PR.
