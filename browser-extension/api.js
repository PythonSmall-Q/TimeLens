const STORAGE_KEYS = {
  apiPort: "timelens.apiPort",
  apiCacheMode: "timelens.apiCacheMode",
  apiCacheSeconds: "timelens.apiCacheSeconds",
};

const DEFAULT_API_PORT = 49152;
const API_PORT_FALLBACK_COUNT = 1000;
const DEFAULT_CACHE_SECONDS = 60;
const FALLBACK_CACHE_MS = 5_000;
const MANUAL_PORT_FAILURE_THRESHOLD = 5;

let discoveredApiBaseCache = null;
let manualPortFailureCount = 0;
let manualPortDisabledUntil = 0;

function log(...args) {
  console.log("[TimeLens API]", ...args);
}

function logWarn(...args) {
  console.warn("[TimeLens API]", ...args);
}

async function getConnectionSettings() {
  const {
    [STORAGE_KEYS.apiPort]: port,
    [STORAGE_KEYS.apiCacheMode]: cacheMode,
    [STORAGE_KEYS.apiCacheSeconds]: cacheSeconds,
  } = await chrome.storage.local.get([
    STORAGE_KEYS.apiPort,
    STORAGE_KEYS.apiCacheMode,
    STORAGE_KEYS.apiCacheSeconds,
  ]);

  const manualPort = parseInt(port, 10) || 0;
  const settings = {
    manualPort,
    cacheMode: cacheMode === "startup" ? "startup" : "duration",
    cacheSeconds: parseInt(cacheSeconds, 10) || DEFAULT_CACHE_SECONDS,
  };
  log("Loaded connection settings:", settings);
  return settings;
}

/**
 * Discover the actual local API port. The desktop backend may bind to a
 * fallback port when 49152 is unavailable (e.g. blocked by Windows / AV).
 * If the user has set a manual port, that port is tried first.
 *
 * If the manual port fails repeatedly, it is temporarily ignored and the
 * fallback range is scanned automatically. This handles the case where the
 * user entered a wrong port or the desktop moved to a different port.
 */
export async function discoverApiBaseUrl() {
  const now = Date.now();
  if (discoveredApiBaseCache && discoveredApiBaseCache.expiresAt > now) {
    return discoveredApiBaseCache.value;
  }

  const { manualPort, cacheMode, cacheSeconds } = await getConnectionSettings();
  const cacheMs = cacheMode === "startup" ? Number.MAX_SAFE_INTEGER : Math.max(0, cacheSeconds) * 1000;

  const portsToTry = [];
  const manualPortAllowed =
    manualPort > 0 &&
    manualPort <= 65535 &&
    now > manualPortDisabledUntil &&
    manualPortFailureCount < MANUAL_PORT_FAILURE_THRESHOLD;

  if (manualPortAllowed) {
    portsToTry.push(manualPort);
  }
  for (let offset = 0; offset <= API_PORT_FALLBACK_COUNT; offset += 1) {
    const port = DEFAULT_API_PORT + offset;
    if (!portsToTry.includes(port)) {
      portsToTry.push(port);
    }
  }

  let manualPortTried = false;
  for (const port of portsToTry) {
    if (port === manualPort) {
      manualPortTried = true;
    }
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);
      const response = await fetch(`${baseUrl}/api/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        const data = await response.json();
        if (data && typeof data.version === "string") {
          if (port === manualPort) {
            manualPortFailureCount = 0;
            manualPortDisabledUntil = 0;
          }
          discoveredApiBaseCache = { value: baseUrl, expiresAt: now + cacheMs };
          return baseUrl;
        }
      }
    } catch {
      // port not reachable — try next
    }
  }

  if (manualPortTried) {
    manualPortFailureCount += 1;
    if (manualPortFailureCount >= MANUAL_PORT_FAILURE_THRESHOLD) {
      // Temporarily ignore the manual port for 5 minutes so the fallback scan can work.
      manualPortDisabledUntil = now + 5 * 60 * 1000;
    }
  }

  discoveredApiBaseCache = { value: "", expiresAt: now + FALLBACK_CACHE_MS };
  return null;
}

export function getApiBaseUrl() {
  return discoveredApiBaseCache?.value || `http://127.0.0.1:${DEFAULT_API_PORT}`;
}

export function clearApiBaseUrlCache() {
  discoveredApiBaseCache = null;
}

export function resetManualPortFailureTracking() {
  manualPortFailureCount = 0;
  manualPortDisabledUntil = 0;
}

export const API_STORAGE_KEYS = STORAGE_KEYS;
export const DEFAULT_CACHE_SECONDS_VALUE = DEFAULT_CACHE_SECONDS;
export const MANUAL_PORT_FAILURE_THRESHOLD_VALUE = MANUAL_PORT_FAILURE_THRESHOLD;
