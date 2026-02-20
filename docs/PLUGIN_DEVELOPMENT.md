# Plugin Development Guide

Focus Timer exposes a hook-based plugin API that lets you extend or react to any session lifecycle event without modifying any core code. Plugins run inside the service worker context and have access to the full Chrome extension API.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Plugin Structure](#plugin-structure)
3. [Available Hooks](#available-hooks)
4. [Hook Payloads Reference](#hook-payloads-reference)
5. [Registering Your Plugin](#registering-your-plugin)
6. [Error Handling](#error-handling)
7. [Accessing Storage](#accessing-storage)
8. [Complete Example: Streak Notifier](#complete-example-streak-notifier)
9. [Plugin Limitations](#plugin-limitations)
10. [Publishing Your Plugin](#publishing-your-plugin)

---

## Quick Start

```js
// src/plugins/my-plugin.js
import { HOOKS } from '../core/eventBus.js';

const MyPlugin = {
  name:    'my-plugin',     // unique string — must not conflict with other plugins
  version: '1.0.0',         // semver
  hooks: {
    [HOOKS.SESSION_END]: ({ score, qualityLabel, session }) => {
      console.log(`Session done! ${score}/100 — ${qualityLabel}`);
    },
  },
};

export default MyPlugin;
```

Then register it in `background.js`:

```js
import { registerPlugin } from './src/core/eventBus.js';
import MyPlugin from './src/plugins/my-plugin.js';

registerPlugin(MyPlugin);
```

---

## Plugin Structure

A plugin is a plain JavaScript object with three fields:

```ts
{
  name:    string,           // Unique identifier. Use kebab-case.
  version: string,           // Semver (e.g. "1.2.0").
  hooks:   {                 // One or more hook handlers.
    [hookName]: (payload) => void,
  }
}
```

- Hook handlers may be `async` functions.
- A plugin that throws inside a hook **will not crash the extension** — errors are caught and logged.
- A plugin can only be registered once. Attempting to register the same `name` twice is a no-op.

---

## Available Hooks

Import hook name constants from `eventBus.js`:

```js
import { HOOKS } from '../core/eventBus.js';
```

| Constant | Emitted when |
|----------|-------------|
| `HOOKS.SESSION_START` | A new session begins |
| `HOOKS.SESSION_END` | A session completes (naturally or via reset) |
| `HOOKS.DISTRACTION` | The user navigates to a distracting domain |
| `HOOKS.SCORE_CALCULATED` | The focus score is calculated (after session end) |
| `HOOKS.REFLECTION_SAVED` | The user saves a post-session reflection |
| `HOOKS.FOCUS_MODE_ENABLED` | Visual enforcement is applied to all tabs |
| `HOOKS.FOCUS_MODE_DISABLED` | Visual enforcement is removed from all tabs |
| `HOOKS.TICK` | Approximately every 1 minute while a session is running |

---

## Hook Payloads Reference

### `HOOKS.SESSION_START`
```ts
{
  session: SessionObject,  // the new session object (id, startTime, duration, …)
  duration: number,        // planned duration in seconds
}
```

### `HOOKS.SESSION_END`
```ts
{
  session:      SessionObject,  // completed session with score and qualityLabel
  score:        number,         // 0–100
  qualityLabel: string,         // 'Deep Work' | 'Focused' | 'Fragmented' | 'Distracted'
}
```

### `HOOKS.DISTRACTION`
```ts
{
  domain: string,  // e.g. 'youtube.com'
  tabId:  number,
}
```

### `HOOKS.SCORE_CALCULATED`
```ts
{
  score:        number,
  qualityLabel: string,
  session:      SessionObject,
}
```

### `HOOKS.REFLECTION_SAVED`
```ts
{
  sessionId: string,
  text:      string,
  savedAt:   number,  // Unix ms
}
```

### `HOOKS.FOCUS_MODE_ENABLED` / `HOOKS.FOCUS_MODE_DISABLED`
```ts
{}  // empty payload
```

### `HOOKS.TICK`
```ts
{
  remaining: number,  // seconds remaining in the session
}
```

---

## Registering Your Plugin

Plugins must be registered in `background.js` after the bootstrap call:

```js
// background.js (bottom of file)
import { registerPlugin } from './src/core/eventBus.js';
import MyPlugin from './src/plugins/my-plugin.js';

// Register after bootstrap
bootstrap().then(() => {
  registerPlugin(MyPlugin);
});
```

Or register inline at the top of the file:

```js
import MyPlugin from './src/plugins/my-plugin.js';
registerPlugin(MyPlugin); // safe to call before bootstrap
```

---

## Error Handling

Every hook invocation is wrapped in a try/catch:

```
[EventBus] Handler error in "my-plugin" on hook "onSessionEnd": TypeError: …
```

This means:
- Your plugin **will not crash** the extension if it throws.
- Error details are logged to the service worker console.
- Other plugins on the same hook are unaffected.

Best practice — still handle your own errors for clarity:

```js
[HOOKS.SESSION_END]: async (payload) => {
  try {
    await doSomethingAsync(payload);
  } catch (err) {
    console.error('[MyPlugin] Failed:', err);
  }
},
```

---

## Accessing Storage

Plugins have full access to `storageAdapter.js` for reading data:

```js
import * as storage from '../core/storageAdapter.js';

[HOOKS.SESSION_END]: async () => {
  const sessions = await storage.getSessions();
  const total = sessions.reduce((acc, s) => acc + (s.duration || 0), 0);
  console.log('Total focus time ever:', Math.round(total / 60), 'minutes');
},
```

**Rules:**
- ✅ Read any data you need via `storageAdapter`
- ✅ Write your own plugin-namespaced data via `storage.setValue('plugin:my-plugin:…', data)`
- ❌ Do not write to core state keys (`focusState`, `sessions`, etc.) — use hooks, not direct writes

---

## Complete Example: Streak Notifier

A plugin that sends a Chrome notification when the user completes their third consecutive Deep Work session:

```js
// src/plugins/streakNotifier.js
import { HOOKS }    from '../core/eventBus.js';
import * as storage from '../core/storageAdapter.js';

const PLUGIN_KEY = 'plugin:streakNotifier:deepWorkCount';

const StreakNotifierPlugin = {
  name:    'streak-notifier',
  version: '1.0.0',

  hooks: {
    [HOOKS.SESSION_END]: async ({ qualityLabel }) => {
      if (qualityLabel !== 'Deep Work') {
        // Reset streak if session wasn't Deep Work
        await storage.setValue(PLUGIN_KEY, 0);
        return;
      }

      const prev  = (await storage.getValue(PLUGIN_KEY, 0)) || 0;
      const count = prev + 1;
      await storage.setValue(PLUGIN_KEY, count);

      if (count % 3 === 0) {
        chrome.notifications.create(`streak-notifier-${Date.now()}`, {
          type:     'basic',
          iconUrl:  'icons/icon128.png',
          title:    '🔥 Deep Work Streak!',
          message:  `${count} Deep Work sessions in a row. Outstanding focus.`,
          priority: 1,
        });
      }
    },

    [HOOKS.FOCUS_MODE_DISABLED]: async () => {
      // Optionally reset count when focus mode is completely disabled
    },
  },
};

export default StreakNotifierPlugin;
```

---

## Plugin Limitations

| Limitation | Reason |
|------------|--------|
| Cannot modify core state directly | Stability — use hooks to react, not to mutate |
| Cannot intercept or cancel events | Bus is emit-only; hooks are observers, not interceptors |
| Cannot register new hook types | HOOKS enum is defined in eventBus.js; open a PR to add official hooks |
| Must use ES module syntax | Service worker uses `"type": "module"` |
| No DOM access | Runs in service worker context; use content.js messaging for page-level actions |

---

## Publishing Your Plugin

There is no central plugin registry yet (see ROADMAP.md). For now:

1. Publish to npm with the `focus-timer-plugin` keyword.
2. Include `"peerDependencies": { "focus-timer": "^5.0.0" }`.
3. Document how to add `registerPlugin(YourPlugin)` to `background.js`.
4. Open a PR to add your plugin to the Community Plugins section of README.md.
