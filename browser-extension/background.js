/**
 * TimeLens Browser Extension – background service worker
 *
 * Tracking rules:
 *  - Only records time while the browser window is focused AND the user is "active"
 *    (not idle/locked according to chrome.idle).
 *  - Closes (and syncs) the current session immediately when:
 *      · The focused window changes to WINDOW_ID_NONE (browser minimised / another app focused)
 *      · chrome.idle fires "idle" or "locked"
 *      · The active tab changes URL / is replaced
 *  - Resumes tracking when the window regains focus and the user becomes active again.
 */

import { getLocale, t } from "./i18n.js";

const STORAGE_KEYS = {
  activeSession:   "timelens.activeSession",
  recentSessions:  "timelens.recentSessions",
  apiStatus:       "timelens.apiStatus",
  lastSyncError:   "timelens.lastSyncError",
  pendingSessions: "timelens.pendingSessions",
  windowFocused:   "timelens.windowFocused",
  userActive:      "timelens.userActive",
};

const MAX_RECENT_SESSIONS   = 100;
const MAX_PENDING_SESSIONS  = 200;
const API_BASE              = "http://127.0.0.1:49152";

// Consider the user idle after 60 s without mouse/keyboard input.
const IDLE_THRESHOLD_SECONDS = 60;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("timelens-api-heartbeat", { periodInMinutes: 1 });
  safeConfigureIdleDetection();
  initState();
  pingApiStatus();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("timelens-api-heartbeat", { periodInMinutes: 1 });
  safeConfigureIdleDetection();
  initState();
  flushPendingSessions();
});

function safeConfigureIdleDetection() {
  try {
    if (chrome.idle && typeof chrome.idle.setDetectionInterval === "function") {
      chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);
    }
  } catch {
    // Fallback to focus/tab based tracking when idle API is unavailable.
  }
}

async function initState() {
  // Reset focus/active flags to safe defaults.
  await chrome.storage.local.set({
    [STORAGE_KEYS.windowFocused]: true,
    [STORAGE_KEYS.userActive]:    true,
  });
  refreshActiveTabSession();
}

// ── Alarms ────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "timelens-api-heartbeat") {
    pingApiStatus();
    flushPendingSessions();
  }
});

// ── Idle detection ────────────────────────────────────────────
if (chrome.idle && chrome.idle.onStateChanged) {
  chrome.idle.onStateChanged.addListener(async (newState) => {
    const isActive = newState === "active";
    await chrome.storage.local.set({ [STORAGE_KEYS.userActive]: isActive });

    if (!isActive) {
      await pauseTracking();
    } else {
      const { [STORAGE_KEYS.windowFocused]: focused } = await chrome.storage.local.get(STORAGE_KEYS.windowFocused);
      if (focused !== false) {
        await refreshActiveTabSession();
      }
    }
  });
}

// ── Window focus ──────────────────────────────────────────────
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const focused = windowId !== chrome.windows.WINDOW_ID_NONE;
  await chrome.storage.local.set({ [STORAGE_KEYS.windowFocused]: focused });

  if (!focused) {
    await pauseTracking();
  } else {
    const { [STORAGE_KEYS.userActive]: active } = await chrome.storage.local.get(STORAGE_KEYS.userActive);
    if (active !== false) {
      await refreshActiveTabSession();
    }
  }
});

// ── Tab events ────────────────────────────────────────────────
chrome.tabs.onActivated.addListener(async () => {
  if (await isTrackingAllowed()) {
    await refreshActiveTabSession();
  } else {
    await pauseTracking();
  }
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    if (await isTrackingAllowed()) {
      await refreshActiveTabSession(tab);
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { [STORAGE_KEYS.activeSession]: current } = await chrome.storage.local.get(STORAGE_KEYS.activeSession);
  if (current && current.tabId === tabId) {
    await closeSession(current, Date.now());
  }
});

chrome.windows.onRemoved.addListener(async () => {
  await pauseTracking();
});

chrome.runtime.onSuspend.addListener(() => {
  // Fire-and-forget best-effort finalization before service worker unload.
  void (async () => {
    const { [STORAGE_KEYS.activeSession]: current } = await chrome.storage.local.get(STORAGE_KEYS.activeSession);
    if (current) {
      await closeSession(current, Date.now());
    }
  })();
});

// ── Core session logic ────────────────────────────────────────

/** Returns true only when the window is focused AND the user is not idle. */
async function isTrackingAllowed() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.windowFocused,
    STORAGE_KEYS.userActive,
  ]);
  return data[STORAGE_KEYS.windowFocused] !== false && data[STORAGE_KEYS.userActive] !== false;
}

/** Close the active session without starting a new one. */
async function pauseTracking() {
  const { [STORAGE_KEYS.activeSession]: current } = await chrome.storage.local.get(STORAGE_KEYS.activeSession);
  if (current) {
    await closeSession(current, Date.now());
  }
}

async function refreshActiveTabSession(tabFromEvent) {
  const allowed = await isTrackingAllowed();
  const tab  = tabFromEvent ?? await getActiveTab();
  const next = normalizeTab(tab);

  const { [STORAGE_KEYS.activeSession]: current } = await chrome.storage.local.get(STORAGE_KEYS.activeSession);

  // Close stale session if the tab/URL changed.
  if (current && (!next || current.url !== next.url || current.tabId !== next.tabId)) {
    await closeSession(current, Date.now());
  }

  if (!allowed || !next) {
    await chrome.storage.local.set({ [STORAGE_KEYS.activeSession]: null });
    return;
  }

  // Only open a new session if there isn't one already for this tab/URL.
  const { [STORAGE_KEYS.activeSession]: afterClose } = await chrome.storage.local.get(STORAGE_KEYS.activeSession);
  if (!afterClose) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.activeSession]: { ...next, startedAt: Date.now() },
    });
  }
}

async function closeSession(session, endedAt) {
  const durationMs = Math.max(0, endedAt - session.startedAt);

  // Discard sessions shorter than 2 s to ignore rapid tab switches.
  if (durationMs < 2000) {
    await chrome.storage.local.set({ [STORAGE_KEYS.activeSession]: null });
    return;
  }

  const record = {
    ...session,
    endedAt,
    durationMs,
    browserName: await detectBrowserName(),
    locale: getLocale(),
  };

  const {
    [STORAGE_KEYS.recentSessions]:  existing = [],
    [STORAGE_KEYS.pendingSessions]: pending  = [],
  } = await chrome.storage.local.get([STORAGE_KEYS.recentSessions, STORAGE_KEYS.pendingSessions]);

  const recentSessions  = [record, ...existing].slice(0, MAX_RECENT_SESSIONS);
  const pendingSessions = [record, ...pending ].slice(0, MAX_PENDING_SESSIONS);

  await chrome.storage.local.set({
    [STORAGE_KEYS.activeSession]:   null,
    [STORAGE_KEYS.recentSessions]:  recentSessions,
    [STORAGE_KEYS.pendingSessions]: pendingSessions,
  });

  await flushPendingSessions();
}

// ── Helpers ───────────────────────────────────────────────────

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0];
}

function normalizeTab(tab) {
  if (!tab || !tab.url) return null;
  if (!/^https?:/i.test(tab.url)) return null;   // skip chrome://, about:, etc.

  let host = "";
  try { host = new URL(tab.url).host; } catch { host = ""; }

  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title || host || t("untitledTab"),
    host,
    favIconUrl: tab.favIconUrl || "",
  };
}

async function detectBrowserName() {
  if (typeof navigator.brave?.isBrave === "function") {
    try { if (await navigator.brave.isBrave()) return "Brave"; } catch { /* ignore */ }
  }
  const ua = navigator.userAgent;
  if (ua.includes("Edg/"))    return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  return "Chromium";
}

async function flushPendingSessions() {
  const { [STORAGE_KEYS.pendingSessions]: pending = [] } = await chrome.storage.local.get(STORAGE_KEYS.pendingSessions);
  if (!pending.length) {
    return;
  }

  const remaining = [];
  for (const session of pending) {
    const ok = await syncSessionToDesktop(session);
    if (!ok) {
      remaining.push(session);
    }
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.pendingSessions]: remaining,
  });
}

async function syncSessionToDesktop(session) {
  try {
    const response = await fetch(`${API_BASE}/api/browser/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        browser_name: session.browserName,
        tab_url: session.url,
        host: session.host || "",
        title: session.title || "",
        started_at: new Date(session.startedAt).toISOString(),
        ended_at: new Date(session.endedAt).toISOString(),
        duration_seconds: Math.max(0, Math.round((session.durationMs || 0) / 1000)),
        locale: session.locale || getLocale(),
      }),
    });

    if (!response.ok) {
      const errorText = `HTTP ${response.status}`;
      await chrome.storage.local.set({
        [STORAGE_KEYS.lastSyncError]: {
          at: Date.now(),
          host: session.host || "",
          error: errorText,
        },
      });
      return false;
    }

    await chrome.storage.local.remove(STORAGE_KEYS.lastSyncError);
    await pingApiStatus();
    return true;
  } catch {
    await chrome.storage.local.set({
      [STORAGE_KEYS.lastSyncError]: {
        at: Date.now(),
        host: session.host || "",
        error: "network_error",
      },
    });
    return false;
  }
}

async function pingApiStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/status`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    await chrome.storage.local.set({
      [STORAGE_KEYS.apiStatus]: {
        ok: true,
        checkedAt: Date.now(),
        data,
      },
    });
  } catch (error) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.apiStatus]: {
        ok: false,
        checkedAt: Date.now(),
        error: String(error),
      },
    });
  }
}
