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
  const bodyJson = JSON.stringify(payload);
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
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
    throw new Error(`TimeLens API error: ${resp.status}`);
  }
}
