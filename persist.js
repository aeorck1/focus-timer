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

  