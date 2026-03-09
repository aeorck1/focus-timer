# Roadmap

This document tracks the planned evolution of Focus Timer. It is updated after each major release.

Items marked 🎯 are the highest-priority contributions we are actively looking for from the community.

---

## v1.x — Stability & Polish (current)

- [x] Modular ES module architecture
- [x] Plugin system with safe hook execution
- [x] Visual enforcement (blur / indicator bar / session overlay)
- [x] Pattern detection and rule-based insights
- [x] Session reflections stored locally
- [x] Storage schema migration framework
- [x] Open-source documentation suite
- [ ] 🎯 Unit tests for `scoringEngine.js` and `sessionManager.js`
- [ ] 🎯 Integration test for full session lifecycle
- [ ] Community plugin registry (README section)

---

## v2.0 — Data & Export

- [ ] 🎯 Export sessions as CSV / JSON
- [ ] Import sessions from CSV (data recovery)
- [ ] Session tagging (e.g. "Project X", "Writing")
- [ ] Tag-based filtering in weekly analytics
- [ ] Longer history view (monthly / all-time)

---

## v3.0 — Customisation

- [ ] 🎯 Configurable scoring weights (via settings UI)
- [ ] Custom quality tier thresholds
- [ ] Per-site "allow list" (sites that are never blocked)
- [ ] Focus indicator bar position (top / bottom / off)
- [ ] Theme selector (light mode)

---

## v4.0 — Focus Goals

- [ ] 🎯 Daily focus goal (e.g. "4 hours / day")
- [ ] Goal progress ring in popup header
- [ ] Weekly goal with streak tracking
- [ ] Goal completion notification

---

## v5.1 — Integrations (Plugin Opportunities)

- [ ] 🎯 Todoist plugin — create a task on session start
- [ ] Notion plugin — log sessions to a Notion database
- [ ] Toggl plugin — sync focus time to a Toggl project
- [ ] Google Calendar plugin — block time for focus sessions

---

## v6.0 — Multi-device Sync (Optional)

- [x] Optional `api.storage.sync` backend (for cross-device stats)
- [ ] Privacy-first: sync only aggregates, never raw session content
- [ ] Sync toggle in settings (off by default)

---

## Long-term Ideas

- Focus mode schedule ("block distracting sites 9am–12pm automatically")
- Browser-native ambient sound (white noise, binaural beats)
- Website-level analytics ("how much time on GitHub vs YouTube this week")
- Firefox port (WebExtensions API compatible)

---

## How to Influence the Roadmap

Open a [GitHub Discussion](https://github.com/aeorck1/focus-timer/discussions) with your proposal. Features with clear community demand and a volunteer implementer get prioritised. Patches welcome for any roadmap item — check CONTRIBUTING.md first.
