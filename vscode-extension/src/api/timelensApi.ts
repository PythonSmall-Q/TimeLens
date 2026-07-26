import { workspace } from "vscode";

const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:49152";
const LOCAL_API_PORT_FALLBACK_COUNT = 1000;
const MANUAL_PORT_FAILURE_THRESHOLD = 5;

let resolvedApiBaseUrlCache: { url: string; configuredUrl: string; expiresAt: number } | null = null;
let manualPortFailureCount = 0;
let manualPortDisabledUntil = 0;

function isLocalhostApiUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function parsePortFromUrl(urlString: string): number {
  try {
    const url = new URL(urlString);
    const port = parseInt(url.port, 10);
    return Number.isNaN(port) ? 0 : port;
  } catch {
    return 0;
  }
}

/**
 * Resolve the actual local API base URL. The configured URL is tried first;
 * when it points at localhost and is unreachable, the desktop backend may have
 * bound to a fallback port (e.g. when the port is blocked by Windows / AV). We
 * then scan the fallback range and return the first reachable TimeLens API.
 * Non-localhost URLs configured by the user are returned unchanged.
 *
 * If the configured localhost port fails repeatedly, it is temporarily ignored
 * so the fallback scan can take over. This handles wrong ports or ports that
 * the desktop app no longer uses.
 */
export async function resolveApiBaseUrl(configuredUrl: string): Promise<string> {
  const now = Date.now();

  // Use cached discovery if it matches the current configuration and hasn't expired.
  if (
    resolvedApiBaseUrlCache &&
    resolvedApiBaseUrlCache.configuredUrl === configuredUrl &&
    resolvedApiBaseUrlCache.expiresAt > now
  ) {
    return resolvedApiBaseUrlCache.url;
  }

  const cfg = workspace.getConfiguration("timelens");
  const cacheMode = cfg.get<string>("apiBaseUrlCacheMode", "duration");
  const cacheSeconds = cfg.get<number>("apiBaseUrlCacheSeconds", 60);
  const cacheMs =
    cacheMode === "startup"
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, cacheSeconds) * 1000;

  // Non-localhost URLs are treated as custom remote servers and returned as-is.
  if (!isLocalhostApiUrl(configuredUrl)) {
    return configuredUrl;
  }

  const manualPort = parsePortFromUrl(configuredUrl);
  const manualPortAllowed =
    manualPort > 0 &&
    manualPort <= 65535 &&
    now > manualPortDisabledUntil &&
    manualPortFailureCount < MANUAL_PORT_FAILURE_THRESHOLD;

  const portsToTry: number[] = [];
  if (manualPortAllowed) {
    portsToTry.push(manualPort);
  }
  for (let offset = 0; offset <= LOCAL_API_PORT_FALLBACK_COUNT; offset += 1) {
    const port = 49152 + offset;
    if (!portsToTry.includes(port)) {
      portsToTry.push(port);
    }
  }

  let manualPortTried = false;
  for (const port of portsToTry) {
    if (port === manualPort) {
      manualPortTried = true;
    }
    const url = `http://127.0.0.1:${port}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);
      const resp = await fetch(`${url}/api/status`, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = (await resp.json()) as { version?: string };
        if (data && typeof data.version === "string") {
          if (port === manualPort) {
            manualPortFailureCount = 0;
            manualPortDisabledUntil = 0;
          }
          resolvedApiBaseUrlCache = { url, configuredUrl, expiresAt: now + cacheMs };
          return url;
        }
      }
    } catch {
      // try next port
    }
  }

  if (manualPortTried) {
    manualPortFailureCount += 1;
    if (manualPortFailureCount >= MANUAL_PORT_FAILURE_THRESHOLD) {
      manualPortDisabledUntil = now + 5 * 60 * 1000;
    }
  }

  return configuredUrl;
}

export interface VsCodeLanguageDuration {
  language: string;
  seconds: number;
}

export interface VsCodeSessionPayload {
  session_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  project_name?: string;
  project_path?: string;
  language_durations?: VsCodeLanguageDuration[];
}

interface StatusProbeResponse {
  extension_bridge_auth_required?: boolean;
}

let authRequiredCache:
  | { apiBaseUrl: string; value: boolean; expiresAt: number }
  | null = null;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`TimeLens request timeout (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Sign a request body using HMAC-SHA256
 */
function signRequestBody(body: string, key: string): string {
  const crypto = require("crypto");
  return crypto.createHmac("sha256", key).update(body).digest("hex");
}

async function shouldAttachBridgeSignature(apiBaseUrl: string): Promise<boolean> {
  const now = Date.now();
  if (
    authRequiredCache &&
    authRequiredCache.apiBaseUrl === apiBaseUrl &&
    authRequiredCache.expiresAt > now
  ) {
    return authRequiredCache.value;
  }

  try {
    const statusUrl = `${apiBaseUrl.replace(/\/$/, "")}/api/status`;
    const resp = await withTimeout(fetch(statusUrl), 2500);
    if (!resp.ok) {
      authRequiredCache = { apiBaseUrl, value: false, expiresAt: now + 30_000 };
      return false;
    }
    const data = (await resp.json()) as StatusProbeResponse;
    const required = data.extension_bridge_auth_required === true;
    authRequiredCache = { apiBaseUrl, value: required, expiresAt: now + 30_000 };
    return required;
  } catch {
    authRequiredCache = { apiBaseUrl, value: false, expiresAt: now + 15_000 };
    return false;
  }
}

export async function postVsCodeSession(
  apiBaseUrl: string,
  payload: VsCodeSessionPayload,
  bridgeKey?: string,
  timeoutMs = 5000
): Promise<void> {
  const resolvedBaseUrl = await resolveApiBaseUrl(apiBaseUrl);
  const url = `${resolvedBaseUrl.replace(/\/$/, "")}/api/vscode/sessions`;

  // Build canonical JSON matching serde_json's re-serialization of VsCodeSessionInput.
  // The server verifies the signature against serde_json::to_string(&deserialized_payload),
  // which always includes optional fields as explicit null and uses the struct field order.
  // Without this normalization the HMAC never matches.
  const canonical = {
    session_id: payload.session_id,
    started_at: payload.started_at,
    ended_at: payload.ended_at,
    duration_seconds: payload.duration_seconds,
    project_name: payload.project_name ?? null,
    project_path: payload.project_path ?? null,
    language_durations: payload.language_durations
      ? payload.language_durations.map((l) => ({ language: l.language, seconds: l.seconds }))
      : null,
  };
  const bodyJson = JSON.stringify(canonical);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Attach API token if the user has configured one (required when local API
  // token mode is enabled).
  const apiToken = workspace.getConfiguration("timelens").get<string>("apiToken", "").trim();
  if (apiToken) {
    headers["X-Api-Token"] = apiToken;
  }

  // Only attach signature when desktop API explicitly requires bridge auth.
  if (bridgeKey && await shouldAttachBridgeSignature(resolvedBaseUrl)) {
    headers["X-Extension-Signature"] = signRequestBody(bodyJson, bridgeKey);
  }
  
  const request = fetch(url, {
    method: "POST",
    headers,
    body: bodyJson,
  });

  const resp = await withTimeout(request, timeoutMs);
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`TimeLens API error ${resp.status} - authentication failed`);
    }
    throw new Error(`TimeLens API error: ${resp.status}`);
  }
}
