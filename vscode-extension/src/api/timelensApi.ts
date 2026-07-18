import { workspace } from "vscode";

const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:49152";
const LOCAL_API_PORT_FALLBACK_COUNT = 1000;

let resolvedApiBaseUrlCache: { url: string; expiresAt: number } | null = null;

/**
 * Resolve the actual local API base URL. When the configured URL is the
 * default `http://127.0.0.1:49152`, the desktop backend may have bound to a
 * fallback port (e.g. when 49152 is blocked by Windows / AV). Scan the
 * fallback range and return the first reachable TimeLens API. A custom URL set
 * by the user is returned unchanged.
 */
export async function resolveApiBaseUrl(configuredUrl: string): Promise<string> {
  if (configuredUrl !== DEFAULT_LOCAL_API_URL) {
    return configuredUrl;
  }

  const now = Date.now();
  if (resolvedApiBaseUrlCache && resolvedApiBaseUrlCache.expiresAt > now) {
    return resolvedApiBaseUrlCache.url;
  }

  const cacheSeconds = workspace.getConfiguration("timelens").get<number>("apiBaseUrlCacheSeconds", 60);
  const cacheMs = Math.max(0, cacheSeconds) * 1000;

  for (let offset = 0; offset <= LOCAL_API_PORT_FALLBACK_COUNT; offset += 1) {
    const port = 49152 + offset;
    const url = `http://127.0.0.1:${port}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);
      const resp = await fetch(`${url}/api/status`, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = (await resp.json()) as { version?: string };
        if (data && typeof data.version === "string") {
          resolvedApiBaseUrlCache = { url, expiresAt: now + cacheMs };
          return url;
        }
      }
    } catch {
      // try next port
    }
  }

  return DEFAULT_LOCAL_API_URL;
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
