import { workspace } from "vscode";

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
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/vscode/sessions`;

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
  if (bridgeKey && await shouldAttachBridgeSignature(apiBaseUrl)) {
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
