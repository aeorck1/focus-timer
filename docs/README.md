# Focus Timer

**An open-source, plugin-based attention engine for Chrome.**

Focus Timer helps you build deep work habits by enforcing distraction-free sessions directly in the browser. Every session is tracked, scored, and analysed so you can understand your actual focus patterns — not just your intentions.

---

## Features

| Feature | Description |
|---------|-------------|
| ⏱ **Pomodoro-style timer** | 25 / 45 / 90 min presets or custom duration |
| 🛡 **Visual enforcement** | Blurs distracting sites; adds indicator bar on productive ones |
| ⚡ **Distraction tracking** | Records domain visits and time spent off-task |
| 📊 **Focus scoring** | 0–100 score based on interruptions and distraction time |
| 📝 **Session reflection** | Post-session prompts to capture what you accomplished |
| 📈 **Weekly analytics** | Bar charts, quality breakdown, session history |
| 💡 **Smart insights** | Rule-based recommendations from your own usage patterns |
| 🔌 **Plugin system** | Extend via event hooks without touching core code |
| 🔒 **100% local** | No account, no server, no telemetry — all data in `api.storage.local`  where api is `const api = typeof browser !== "undefined" ? browser : chrome |

---

## Architecture Overview

```
focus-timer-v5/
├── background.js              ← MV3 service worker (wiring only)
├── content.js                 ← Content script (visual enforcement UI)
├── content.css                ← Content script styles
├── popup.html / popup.js      ← Extension popup
├── styles.css                 ← Popup styles
├── manifest.json
├── icons/
└── src/
    ├── core/
    │   ├── timerEngine.js     ← Alarm management, session lifecycle
    │   ├── sessionManager.js  ← Session objects, streaks, daily stats
    │   ├── scoringEngine.js   ← Focus score, quality labels (pure functions)
    │   ├── storageAdapter.js  ← api.storage.local abstraction
    │   └── eventBus.js        ← Plugin hook system
    ├── features/
    │   ├── distractionTracking/  ← Tracks visits to distracting domains
    │   ├── reflectionSystem/     ← Post-session reflection prompts
    │   ├── visualEnforcement/    ← Tab messaging coordinator
    │   └── insightsEngine/       ← Pattern aggregation & suggestions
    ├── plugins/
    │   └── consoleLogger.js   ← Example plugin
    └── ui/                    ← (reserved for future component extraction)
```

### Core Principles

1. **Single responsibility** — each module owns exactly one concern.
2. **No cross-module tight coupling** — modules communicate through `eventBus` or explicit imports of their public API.
3. **Pure scoring** — `scoringEngine.js` has zero side effects and is trivially testable.
4. **Plugin safety** — all plugin hooks are wrapped in try/catch; a crashing plugin cannot bring down the extension.
5. **MV3 compliant** — uses `api.alarms` (no background `setInterval`), native ES modules via `"type": "module"`.

---

## Quick Start

### Load the extension locally

1. Clone this repository:
   ```bash
   git clone https://github.com/aeorck1/focus-timer.git
   cd focus-timer
   ```

2. Open Chrome and navigate to `chrome://extensions`

3. Enable **Developer mode** (top-right toggle)

4. Click **Load unpacked** and select the `focus-timer/` directory

5. The Focus Timer icon appears in your toolbar. Pin it and start a session.

### No build step required

Focus Timer uses native ES modules supported by Chrome's MV3 service worker. There is no bundler, transpiler, or `npm install` needed to run the extension. Just load the folder.

---

## Development Setup

```bash
# Clone
git clone https://github.com/aeorck1/focus-timer.git
cd focus-timer/focus-timer

# Open in your editor
code .

# Load in Chrome (see Quick Start above)
# After editing any file: go to chrome://extensions → click the refresh icon
```

### File watch (optional)

If you add a build step later, a simple file watcher avoids manual refreshes:

```bash
# Example with entr (brew install entr / apt install entr)
find . -name "*.js" | entr -r echo "Reload extension in Chrome"
```

---

## Running Tests

The `scoringEngine.js` module is a set of pure functions — test it with any runner:

```bash
# Example with Node's built-in test runner (Node 18+)
node --test tests/scoringEngine.test.js
```

A sample test file is provided in `tests/` to get you started.

---

## How Visual Enforcement Works

When a session is running:

- **Productive sites** → a slim indicator bar slides in at the top of the page showing remaining time. The page is subtly faded (opacity 0.82) to maintain awareness.
- **Distracting sites** → the page is blurred and a full-screen overlay appears with two options:
  - *Return to focus* — navigates back
  - *Continue anyway* — removes the blur for this page load (visit is still counted)

When the session ends:
- The in-page session overlay appears on the active tab with your score, quality label, and a reflection textarea.
- All enforcement is removed from all tabs.

---

## Plugin System

Focus Timer exposes a hook-based plugin API. See [PLUGIN_DEVELOPMENT.md](PLUGIN_DEVELOPMENT.md) for the full guide.

Quick example:

```js
import { registerPlugin, HOOKS } from './src/core/eventBus.js';

registerPlugin({
  name: 'my-plugin',
  version: '1.0.0',
  hooks: {
    [HOOKS.SESSION_END]: ({ score, qualityLabel }) => {
      console.log(`Session done! Score: ${score} — ${qualityLabel}`);
    },
  },
});
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to submit issues, PRs, and feature requests.

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features and the contribution wishlist.

---

## License

MIT — see `LICENSE`.
