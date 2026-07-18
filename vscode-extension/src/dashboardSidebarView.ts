import * as vscode from "vscode";
import { t } from "./i18n";
import { resolveApiBaseUrl } from "./api/timelensApi";

interface VsCodeStatsSummary {
  total_seconds: number;
  session_count: number;
}

interface VsCodeLanguageStat {
  language: string;
  total_seconds: number;
}

interface VsCodeProjectStat {
  project_name: string;
  project_path: string;
  total_seconds: number;
}

interface AppUsageSummary {
  app_name: string;
  total_seconds: number;
}

interface StatusResponse {
  version: string;
  focus_active: boolean;
  extension_bridge_auth_required?: boolean;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getProjectDisplayName(row: VsCodeProjectStat): string {
  if (row.project_name?.trim()) return row.project_name.trim();
  if (row.project_path?.trim()) {
    const parts = row.project_path.split(/[\\/]/);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return t().unknownProject;
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Client-Id": "timelens-vscode-extension",
  };
  const apiToken = vscode.workspace.getConfiguration("timelens").get<string>("apiToken", "").trim();
  if (apiToken) {
    headers["X-Api-Token"] = apiToken;
  }
  return headers;
}

export class DashboardSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "timelens.homeView";
  private view?: vscode.WebviewView;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly flushFn?: () => Promise<void>,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.buildLoadingHtml();

    webviewView.webview.onDidReceiveMessage(async (msg: { command: string; payload?: unknown }) => {
      if (msg.command === "refresh") {
        await this.refresh();
      }
      if (msg.command === "openDashboard") {
        await vscode.commands.executeCommand("timelens.openDashboard");
      }
      if (msg.command === "configureBridgeKey") {
        await vscode.commands.executeCommand("timelens.setExtensionBridgeKey");
        setTimeout(() => this.refresh(), 500);
      }
      if (msg.command === "toggleTracking") {
        const p = msg.payload as { enabled: boolean };
        await vscode.workspace
          .getConfiguration("timelens")
          .update("enabled", p.enabled, vscode.ConfigurationTarget.Global);
        await this.pushSettingsToBackend();
        await this.refresh();
      }
      if (msg.command === "setLevel") {
        const p = msg.payload as { level: "basic" | "standard" | "detailed" };
        await vscode.workspace
          .getConfiguration("timelens")
          .update("trackingLevel", p.level, vscode.ConfigurationTarget.Global);
        await this.pushSettingsToBackend();
        await this.refresh();
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
        this.startTimer();
      } else {
        this.stopTimer();
      }
    });

    webviewView.onDidDispose(() => {
      this.stopTimer();
    });

    this.startTimer();

    void this.refresh().catch((error) => {
      if (this.view) {
        this.view.webview.html = this.buildErrorHtml(error);
      }
    });
  }

  private startTimer(): void {
    this.stopTimer();
    this.refreshTimer = setInterval(() => {
      if (this.view?.visible) {
        void this.refresh();
      }
    }, 10_000);
  }

  private stopTimer(): void {
    if (this.refreshTimer !== undefined) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  async refresh(): Promise<void> {
    if (!this.view) return;

    if (this.flushFn) {
      await this.flushFn().catch(() => undefined);
    }

    const cfg = vscode.workspace.getConfiguration("timelens");
    const enabled = cfg.get<boolean>("enabled", true);
    const level = cfg.get<string>("trackingLevel", "standard");
    const bridgeKey = cfg.get<string>("bridgeKey", "").trim();
    const configuredApiBase = cfg.get<string>("apiBaseUrl", "http://127.0.0.1:49152").replace(/\/$/, "");
    const apiBase = await resolveApiBaseUrl(configuredApiBase);
    const today = new Date().toISOString().slice(0, 10);
    const authHeaders = getAuthHeaders();

    try {
      const [status, vscodeToday, languages, projects, appToday] = await Promise.all([
        fetchJson<StatusResponse>(`${apiBase}/api/status`, { headers: authHeaders }),
        fetchJson<VsCodeStatsSummary>(`${apiBase}/api/vscode/stats/today`, { headers: authHeaders }),
        fetchJson<VsCodeLanguageStat[]>(`${apiBase}/api/vscode/languages/range?start=${today}&end=${today}`, { headers: authHeaders }),
        fetchJson<VsCodeProjectStat[]>(`${apiBase}/api/vscode/projects/range?start=${today}&end=${today}`, { headers: authHeaders }),
        fetchJson<AppUsageSummary[]>(`${apiBase}/api/screen-time/today`, { headers: authHeaders }),
      ]);

      const connected = !!status;
      const sortedLanguages = (languages ?? [])
        .filter((x) => x.total_seconds > 0)
        .sort((a, b) => b.total_seconds - a.total_seconds);
      const sortedProjects = (projects ?? [])
        .filter((x) => x.total_seconds > 0)
        .sort((a, b) => b.total_seconds - a.total_seconds);
      const sortedApps = (appToday ?? [])
        .filter((x) => x.total_seconds > 0)
        .sort((a, b) => b.total_seconds - a.total_seconds)
        .slice(0, 5);

      const langMax = sortedLanguages[0]?.total_seconds ?? 1;
      const projectMax = sortedProjects[0]?.total_seconds ?? 1;
      const appMax = sortedApps[0]?.total_seconds ?? 1;

      const renderMeter = (label: string, seconds: number, max: number) => {
        const pct = max > 0 ? Math.round((seconds / max) * 100) : 0;
        return `
          <div class="meter-row">
            <div class="meter-label">
              <span class="meter-name">${escapeHtml(label)}</span>
              <span class="meter-value">${formatDuration(seconds)}</span>
            </div>
            <div class="meter-track"><div class="meter-fill" style="width:${pct}%"></div></div>
          </div>`;
      };

      const languageList =
        sortedLanguages.length === 0
          ? `<div class="empty">${t().noData}</div>`
          : sortedLanguages.slice(0, 6).map((x) => renderMeter(x.language, x.total_seconds, langMax)).join("");

      const projectList =
        sortedProjects.length === 0
          ? `<div class="empty">${t().noData}</div>`
          : sortedProjects.slice(0, 6).map((x) => renderMeter(getProjectDisplayName(x), x.total_seconds, projectMax)).join("");

      const appList =
        sortedApps.length === 0
          ? `<div class="empty">${t().noData}</div>`
          : sortedApps.map((x) => renderMeter(x.app_name, x.total_seconds, appMax)).join("");

      this.view.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 12px;
    margin: 0;
    line-height: 1.4;
  }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  .brand { font-size: 18px; font-weight: 800; letter-spacing: -0.2px; }
  .badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .badge.connected { background: rgba(45, 164, 78, 0.14); color: #3fb950; }
  .badge.disconnected { background: rgba(139, 148, 158, 0.14); color: #8b949e; }
  .badge.focus { background: rgba(88, 166, 255, 0.14); color: #58a6ff; }
  .pill { font-size: 10px; padding: 2px 7px; border-radius: 999px; background: rgba(139,148,158,0.14); color: var(--vscode-descriptionForeground); text-transform: uppercase; font-weight: 600; }
  .subtitle { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 10px;
    padding: 10px;
    background: var(--vscode-sideBar-background);
    margin-bottom: 10px;
  }
  .stat { display: flex; flex-direction: column; gap: 2px; }
  .stat .label { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .stat .value { font-size: 22px; font-weight: 800; color: var(--vscode-textLink-foreground); }
  .stat .value-sm { font-size: 14px; font-weight: 700; color: var(--vscode-foreground); }
  .stat .muted { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .section-title { font-size: 12px; font-weight: 700; margin-bottom: 8px; color: var(--vscode-foreground); }
  .control-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 8px 0; }
  .control-row span { color: var(--vscode-descriptionForeground); font-size: 12px; }
  button {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 5px 10px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  button:hover { opacity: 0.9; }
  button.secondary { background: transparent; color: var(--vscode-foreground); font-weight: 500; }
  select {
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
  }
  .meter-row { margin: 7px 0; }
  .meter-label { display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 3px; }
  .meter-name { color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }
  .meter-value { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  .meter-track { height: 5px; background: var(--vscode-progressBar-background); opacity: 0.35; border-radius: 999px; overflow: hidden; }
  .meter-fill { height: 100%; background: var(--vscode-textLink-foreground); border-radius: 999px; }
  .empty { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 6px 0; }
  .warn { color: #d29922; font-size: 11px; margin-top: 8px; }
  .actions { display: flex; gap: 8px; margin-top: 4px; }
  .actions button { flex: 1; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">TimeLens</div>
    <div class="badges">
      <span class="badge ${connected ? "connected" : "disconnected"}">${connected ? t().statusConnected : t().statusDisconnected}</span>
      ${status?.focus_active ? `<span class="badge focus">${t().focusActive}</span>` : ""}
      <span class="pill">${level}</span>
    </div>
  </div>
  <div class="subtitle">${t().extensionHome}</div>

  <div class="grid">
    <div class="card stat">
      <div class="label">${t().todayVsCode}</div>
      <div class="value">${formatDuration(vscodeToday?.total_seconds ?? 0)}</div>
      <div class="muted">${vscodeToday?.session_count ?? 0} ${t().sessions}</div>
    </div>
    <div class="card stat">
      <div class="label">${t().desktopVersion}</div>
      <div class="value-sm">${escapeHtml(status?.version ?? "-")}</div>
      <div class="muted">${connected ? t().statusConnected : t().statusDisconnected}</div>
    </div>
  </div>

  <div class="card">
    <div class="section-title">${t().trackingToggle}</div>
    <div class="control-row">
      <span>${enabled ? t().disableTracking : t().enableTracking}</span>
      <button onclick="toggleTracking()">${enabled ? t().disableTracking : t().enableTracking}</button>
    </div>
    <div class="control-row">
      <span>${t().detailLevel}</span>
      <select id="level" onchange="setLevel(this.value)">
        <option value="basic" ${level === "basic" ? "selected" : ""}>basic</option>
        <option value="standard" ${level === "standard" ? "selected" : ""}>standard</option>
        <option value="detailed" ${level === "detailed" ? "selected" : ""}>detailed</option>
      </select>
    </div>
    <div class="control-row">
      <span>${t().apiKey}</span>
      <button class="secondary" onclick="configureBridgeKey()">${bridgeKey ? t().changeKey : t().configureKey}</button>
    </div>
    ${!bridgeKey ? `<div class="warn">${t().noKeyWarning}</div>` : ""}
    ${!status ? `<div class="warn">${t().notConnected}</div>` : ""}
  </div>

  <div class="card">
    <div class="section-title">${t().languagesTitle}</div>
    ${languageList}
  </div>

  <div class="card">
    <div class="section-title">${t().projectsTitle}</div>
    ${projectList}
  </div>

  <div class="card">
    <div class="section-title">${t().topAppsTitle}</div>
    ${appList}
  </div>

  <div class="actions">
    <button onclick="openDashboard()">${t().openDashboard}</button>
    <button class="secondary" onclick="refresh()">${t().refresh}</button>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  function refresh(){ vscode.postMessage({ command: 'refresh' }); }
  function openDashboard(){ vscode.postMessage({ command: 'openDashboard' }); }
  function toggleTracking(){ vscode.postMessage({ command: 'toggleTracking', payload: { enabled: ${!enabled} } }); }
  function setLevel(level){ vscode.postMessage({ command: 'setLevel', payload: { level } }); }
  function configureBridgeKey(){ vscode.postMessage({ command: 'configureBridgeKey' }); }
</script>
</body>
</html>`;
    } catch (error) {
      this.view.webview.html = this.buildErrorHtml(error);
    }
  }

  private buildLoadingHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 10px; background: var(--vscode-sideBar-background); }
  .title { font-size: 18px; font-weight: 800; margin-bottom: 6px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
</style>
</head>
<body>
  <div class="card">
    <div class="title">TimeLens</div>
    <div class="muted">${t().loading}</div>
  </div>
</body>
</html>`;
  }

  private buildErrorHtml(error: unknown): string {
    const msg = error instanceof Error ? error.message : "Unknown error";
    const safe = escapeHtml(String(msg));
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 10px; background: var(--vscode-sideBar-background); }
  .title { font-size: 18px; font-weight: 800; margin-bottom: 6px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
  button { margin-top: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 5px 10px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
</style>
</head>
<body>
  <div class="card">
    <div class="title">TimeLens</div>
    <div class="muted">${t().loadFailed}</div>
    <div class="muted">${safe}</div>
    <button onclick="refresh()">${t().retry}</button>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  function refresh(){ vscode.postMessage({ command: 'refresh' }); }
</script>
</body>
</html>`;
  }

  async pushSettingsToBackend(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("timelens");
    const enabled = cfg.get<boolean>("enabled", true);
    const level = cfg.get<string>("trackingLevel", "standard");
    const configuredApiBase = cfg.get<string>("apiBaseUrl", "http://127.0.0.1:49152").replace(/\/$/, "");
    try {
      const apiBase = await resolveApiBaseUrl(configuredApiBase);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      await fetch(`${apiBase}/api/vscode/enabled`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ enabled, tracking_level: level }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
    } catch {
      // Desktop app may not be running — silently ignore
    }
  }
}
