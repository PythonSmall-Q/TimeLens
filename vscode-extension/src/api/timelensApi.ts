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

export async function postVsCodeSession(
  apiBaseUrl: string,
  payload: VsCodeSessionPayload,
  timeoutMs = 5000
): Promise<void> {
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/vscode/sessions`;
  const request = fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const resp = await withTimeout(request, timeoutMs);
  if (!resp.ok) {
    throw new Error(`TimeLens API error: ${resp.status}`);
  }
}
