const STORAGE_KEYS = {
  apiPort: "timelens.apiPort",
  apiCacheSeconds: "timelens.apiCacheSeconds",
};

const DEFAULT_API_PORT = 49152;
const API_PORT_FALLBACK_COUNT = 1000;
const DEFAULT_CACHE_SECONDS = 60;
const FALLBACK_CACHE_MS = 5_000;

let discoveredApiBaseCache = null;

async function getConnectionSettings() {
  const { [STORAGE_KEYS.apiPort]: port, [STORAGE_KEYS.apiCacheSeconds]: cacheSeconds } =
    await chrome.storage.local.get([STORAGE_KEYS.apiPort, STORAGE_KEYS.apiCacheSeconds]);
  return {
    manualPort: typeof port === "number" ? port : (parseInt(port, 10) || 0),
    cacheSeconds: typeof cacheSeconds === "number" ? cacheSeconds : (parseInt(cacheSeconds, 10) || DEFAULT_CACHE_SECONDS),
  };
}

/**
 * Discover the actual local API port. The desktop backend may bind to a
 * fallback port when 49152 is unavailable (e.g. blocked by Windows / AV).
 * If the user has set a manual port, that port is tried first.
 */
export async function discoverApiBaseUrl() {
  const now = Date.now();
  if (discoveredApiBaseCache && discoveredApiBaseCache.expiresAt > now) {
    return discoveredApiBaseCache.value;
  }

  const { manualPort, cacheSeconds } = await getConnectionSettings();
  const cacheMs = Math.max(0, cacheSeconds) * 1000;

  const portsToTry = [];
  if (manualPort > 0 && manualPort <= 65535) {
    portsToTry.push(manualPort);
  }
  for (let offset = 0; offset <= API_PORT_FALLBACK_COUNT; offset += 1) {
    const port = DEFAULT_API_PORT + offset;
    if (!portsToTry.includes(port)) {
      portsToTry.push(port);
    }
  }

  for (const port of portsToTry) {
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
          discoveredApiBaseCache = { value: baseUrl, expiresAt: now + cacheMs };
          return baseUrl;
        }
      }
    } catch {
      // port not reachable — try next
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

export const API_STORAGE_KEYS = STORAGE_KEYS;
export const DEFAULT_CACHE_SECONDS_VALUE = DEFAULT_CACHE_SECONDS;
