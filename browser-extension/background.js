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
import { discoverApiBaseUrl, clearApiBaseUrlCache, resetManualPortFailureTracking } from "./api.js";

function log(...args) {
  console.log("[TimeLens BG]", ...args);
}

function logWarn(...args) {
  console.warn("[TimeLens BG]", ...args);
}

function logError(...args) {
  console.error("[TimeLens BG]", ...args);
}

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
let authRequiredCache = { value: false, expiresAt: 0 };

// Consider the user idle after 60 s without mouse/keyboard input.
const IDLE_THRESHOLD_SECONDS = 60;

chrome.runtime.onInstalled.addListener((details) => {
  log("Extension installed/updated:", details.reason);
  chrome.alarms.create("timelens-api-heartbeat", { periodInMinutes: 1 });
  safeConfigureIdleDetection();
  initState();
  clearApiBaseUrlCache();
  resetManualPortFailureTracking();
  pingApiStatus();
});

chrome.runtime.onStartup.addListener(() => {
  log("Browser startup");
  chrome.alarms.create("timelens-api-heartbeat", { periodInMinutes: 1 });
  safeConfigureIdleDetection();
  initState();
  clearApiBaseUrlCache();
  resetManualPortFailureTracking();
  flushPendingSessions();
});

function safeConfigureIdleDetection() {
  try {
    if (chrome.idle && typeof chrome.idle.setDetectionInterval === "function") {
      chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);
      log("Idle detection interval set to", IDLE_THRESHOLD_SECONDS, "seconds");
    } else {
      logWarn("chrome.idle unavailable; falling back to focus/tab based tracking");
    }
  } catch (error) {
    logError("Failed to configure idle detection:", error);
  }
}

async function initState() {
  // Reset focus/active flags to safe defaults.
  await chrome.storage.local.set({
    [STORAGE_KEYS.windowFocused]: true,
    [STORAGE_KEYS.userActive]:    true,
  });
  log("State initialized");
  refreshActiveTabSession();
}

// ── Alarms ────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  log("Alarm fired:", alarm.name);
  if (alarm.name === "timelens-api-heartbeat") {
    pingApiStatus();
    flushPendingSessions();
  }
});

// ── Idle detection ────────────────────────────────────────────
if (chrome.idle && chrome.idle.onStateChanged) {
  chrome.idle.onStateChanged.addListener(async (newState) => {
    log("Idle state changed:", newState);
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
  log("Window focus changed, focused:", focused, "windowId:", windowId);
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
  log("Tab activated");
  if (await isTrackingAllowed()) {
    await refreshActiveTabSession();
  } else {
    await pauseTracking();
  }
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    log("Tab updated:", { tabId: _tabId, status: changeInfo.status, url: changeInfo.url, title: tab?.title });
    if (await isTrackingAllowed()) {
      await refreshActiveTabSession(tab);
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  log("Tab removed:", tabId);
  const { [STORAGE_KEYS.activeSession]: current } = await chrome.storage.local.get(STORAGE_KEYS.activeSession);
  if (current && current.tabId === tabId) {
    await closeSession(current, Date.now());
  }
});

chrome.windows.onRemoved.addListener(async () => {
  log("Window removed");
  await pauseTracking();
});

chrome.runtime.onSuspend.addListener(() => {
  log("Extension suspending");
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
  const allowed = data[STORAGE_KEYS.windowFocused] !== false && data[STORAGE_KEYS.userActive] !== false;
  log("isTrackingAllowed:", allowed, { windowFocused: data[STORAGE_KEYS.windowFocused], userActive: data[STORAGE_KEYS.userActive] });
  return allowed;
}

/** Close the active session without starting a new one. */
async function pauseTracking() {
  const { [STORAGE_KEYS.activeSession]: current } = await chrome.storage.local.get(STORAGE_KEYS.activeSession);
  if (current) {
    log("Pausing tracking for session:", current.url);
    await closeSession(current, Date.now());
  }
}

async function refreshActiveTabSession(tabFromEvent) {
  const allowed = await isTrackingAllowed();
  const tab  = tabFromEvent ?? await getActiveTab();
  const next = normalizeTab(tab);

  const { [STORAGE_KEYS.activeSession]: current } = await chrome.storage.local.get(STORAGE_KEYS.activeSession);

  log("refreshActiveTabSession:", { allowed, nextUrl: next?.url, currentUrl: current?.url });

  // Close stale session if the tab/URL changed.
  if (current && (!next || current.url !== next.url || current.tabId !== next.tabId)) {
    log("Closing stale session:", current.url);
    await closeSession(current, Date.now());
  }

  if (!allowed || !next) {
    await chrome.storage.local.set({ [STORAGE_KEYS.activeSession]: null });
    return;
  }

  // Only open a new session if there isn't one already for this tab/URL.
  const { [STORAGE_KEYS.activeSession]: afterClose } = await chrome.storage.local.get(STORAGE_KEYS.activeSession);
  if (!afterClose) {
    const newSession = { ...next, startedAt: Date.now() };
    log("Starting new session:", newSession.url);
    await chrome.storage.local.set({
      [STORAGE_KEYS.activeSession]: newSession,
    });
  }
}

async function closeSession(session, endedAt) {
  const durationMs = Math.max(0, endedAt - session.startedAt);
  log("Closing session:", session.url, "durationMs:", durationMs);

  // Discard sessions shorter than 2 s to ignore rapid tab switches.
  if (durationMs < 2000) {
    log("Session too short, discarding");
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

  log("Session queued for sync. Pending count:", pendingSessions.length);
  await flushPendingSessions();
}

// ── Helpers ───────────────────────────────────────────────────

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  log("getActiveTab returned:", tabs[0]?.url);
  return tabs[0];
}

function normalizeTab(tab) {
  if (!tab || !tab.url) {
    log("normalizeTab: no tab or no URL");
    return null;
  }
  if (!/^https?:/i.test(tab.url)) {
    log("normalizeTab: skipping non-http(s) URL:", tab.url);
    return null;   // skip chrome://, about:, etc.
  }

  let host = "";
  let path = "";
  let query = "";
  let hash = "";
  let protocol = "";
  try { host = new URL(tab.url).host; } catch { host = ""; }
  try {
    const parsed = new URL(tab.url);
    path = parsed.pathname || "";
    query = parsed.search || "";
    hash = parsed.hash || "";
    protocol = parsed.protocol || "";
  } catch {
    path = "";
    query = "";
    hash = "";
    protocol = "";
  }

  const normalized = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title || host || t("untitledTab"),
    host,
    path,
    query,
    hash,
    protocol,
    incognito: Boolean(tab.incognito),
    pinned: Boolean(tab.pinned),
    audible: Boolean(tab.audible),
    muted: Boolean(tab.mutedInfo?.muted),
    discarded: Boolean(tab.discarded),
    favIconUrl: tab.favIconUrl || "",
  };
  log("normalizeTab:", normalized.url, normalized.host);
  return normalized;
}

async function detectBrowserName() {
  if (typeof navigator.brave?.isBrave === "function") {
    try { if (await navigator.brave.isBrave()) {
      log("Browser detected: Brave");
      return "Brave";
    } } catch { /* ignore */ }
  }
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) {
    log("Browser detected: Edge");
    return "Edge";
  }
  if (ua.includes("Chrome/")) {
    log("Browser detected: Chrome");
    return "Chrome";
  }
  log("Browser detected: Chromium (fallback)");
  return "Chromium";
}

async function flushPendingSessions() {
  const { [STORAGE_KEYS.pendingSessions]: pending = [] } = await chrome.storage.local.get(STORAGE_KEYS.pendingSessions);
  log("flushPendingSessions:", pending.length, "pending");
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
  log("flushPendingSessions complete, remaining:", remaining.length);
}

async function syncSessionToDesktop(session) {
  try {
    log("syncSessionToDesktop:", session.url, "duration:", session.durationMs);
    const bridgeKey = await getBridgeKey();
    const body = JSON.stringify({
      browser_name: session.browserName,
      tab_url: session.url,
      host: session.host || "",
      title: session.title || "",
      started_at: new Date(session.startedAt).toISOString(),
      ended_at: new Date(session.endedAt).toISOString(),
      duration_seconds: Math.max(0, Math.round((session.durationMs || 0) / 1000)),
      locale: session.locale || getLocale(),
      window_id: Number.isFinite(session.windowId) ? session.windowId : null,
      tab_id: Number.isFinite(session.tabId) ? session.tabId : null,
      path: session.path || "",
      query: session.query || "",
      hash: session.hash || "",
      protocol: session.protocol || "",
      incognito: Boolean(session.incognito),
      pinned: Boolean(session.pinned),
      audible: Boolean(session.audible),
      muted: Boolean(session.muted),
      discarded: Boolean(session.discarded),
    });

    const headers = {
      "Content-Type": "application/json",
    };

    // Only attach signature when desktop API explicitly requires bridge auth.
    const attachSignature = bridgeKey && await shouldAttachBridgeSignature();
    log("Bridge signature required:", attachSignature, "bridgeKey present:", Boolean(bridgeKey));
    if (attachSignature) {
      headers["X-Extension-Signature"] = await signRequestBody(body, bridgeKey);
    }

    const baseUrl = await discoverApiBaseUrl();
    if (!baseUrl) {
      logError("Cannot sync session: desktop unreachable");
      await chrome.storage.local.set({
        [STORAGE_KEYS.lastSyncError]: {
          at: Date.now(),
          host: session.host || "",
          error: "desktop_unreachable",
        },
      });
      return false;
    }

    log("Sending session to:", `${baseUrl}/api/browser/session`);
    const response = await fetch(`${baseUrl}/api/browser/session`, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = `HTTP ${response.status}`;
      logError("Session sync failed:", errorText);
      await chrome.storage.local.set({
        [STORAGE_KEYS.lastSyncError]: {
          at: Date.now(),
          host: session.host || "",
          error: errorText,
        },
      });
      return false;
    }

    log("Session synced successfully:", session.url);
    await chrome.storage.local.remove(STORAGE_KEYS.lastSyncError);
    await pingApiStatus();
    return true;
  } catch (error) {
    logError("syncSessionToDesktop exception:", error);
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
    log("pingApiStatus start");
    const baseUrl = await discoverApiBaseUrl();
    if (!baseUrl) {
      throw new Error("desktop_unreachable");
    }
    const response = await fetch(`${baseUrl}/api/status`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    log("pingApiStatus ok, version:", data?.version);
    await chrome.storage.local.set({
      [STORAGE_KEYS.apiStatus]: {
        ok: true,
        checkedAt: Date.now(),
        data,
      },
    });
  } catch (error) {
    logError("pingApiStatus failed:", error);
    await chrome.storage.local.set({
      [STORAGE_KEYS.apiStatus]: {
        ok: false,
        checkedAt: Date.now(),
        error: String(error),
      },
    });
  }
}

/**
 * Old desktop APIs do not expose auth capability. In that case default to false
 * and do not send key/signature headers.
 */
async function shouldAttachBridgeSignature() {
  const now = Date.now();
  if (authRequiredCache.expiresAt > now) {
    log("shouldAttachBridgeSignature: using cache:", authRequiredCache.value);
    return authRequiredCache.value;
  }

  try {
    const baseUrl = await discoverApiBaseUrl();
    if (!baseUrl) {
      authRequiredCache = { value: false, expiresAt: now + 15_000 };
      log("shouldAttachBridgeSignature: desktop unreachable, assuming no signature required");
      return false;
    }
    const response = await fetch(`${baseUrl}/api/status`);
    if (!response.ok) {
      authRequiredCache = { value: false, expiresAt: now + 30_000 };
      logWarn("shouldAttachBridgeSignature: status fetch failed, assuming no signature required");
      return false;
    }
    const data = await response.json();
    const required = data?.extension_bridge_auth_required === true;
    authRequiredCache = { value: required, expiresAt: now + 30_000 };
    log("shouldAttachBridgeSignature: required:", required);
    return required;
  } catch (error) {
    logError("shouldAttachBridgeSignature exception:", error);
    authRequiredCache = { value: false, expiresAt: now + 15_000 };
    return false;
  }
}

/**
 * Get the stored extension bridge key from local storage
 */
async function getBridgeKey() {
  const { "timelens.bridgeKey": key } = await chrome.storage.local.get("timelens.bridgeKey");
  log("getBridgeKey: present:", Boolean(key));
  return key || "";
}

/**
 * Sign a request body using HMAC-SHA256
 * @param {string} body - The request body JSON string
 * @param {string} key - The bridge key
 * @returns {Promise<string>} The hex-encoded HMAC signature
 */
async function signRequestBody(body, key) {
  // Use SubtleCrypto API available in Service Workers
  log("signRequestBody: signing request");
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const bodyData = encoder.encode(body);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, bodyData);
  const signatureArray = new Uint8Array(signature);
  const signatureHex = Array.from(signatureArray)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  log("signRequestBody: signature length:", signatureHex.length);
  return signatureHex;
}
