import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";

/** Fetch JSON from the TimeLens local API, returns null on any error. */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private static readonly viewType = "timelens.dashboard";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  public static createOrShow(extensionContext: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      DashboardPanel.currentPanel.refresh();
      return;
    }

    const iconPath = vscode.Uri.joinPath(extensionContext.extensionUri, "icons", "icon.png");

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      "TimeLens Dashboard",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionContext.extensionUri],
      }
    );

    try {
      panel.iconPath = iconPath;
    } catch {
      // icon may not exist yet during development
    }

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionContext);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.extensionUri = context.extensionUri;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (msg: { command: string; payload?: unknown }) => {
        await this.handleMessage(msg);
      },
      null,
      this.disposables
    );

    // Auto-refresh every 30 s while panel is visible
    this.refreshTimer = setInterval(() => {
      if (this.panel.visible) {
        this.refresh();
      }
    }, 30_000);

    this.refresh();
  }

  public async refresh(): Promise<void> {
    const apiBase = vscode.workspace
      .getConfiguration("timelens")
      .get<string>("apiBaseUrl", "http://127.0.0.1:49152");

    const [todayStats, todayApps, langStats, projectStats, trackingStatus, appStatus] =
      await Promise.all([
        fetchJson<{ total_seconds: number; session_count: number }>(
          `${apiBase}/api/vscode/stats/today`
        ),
        fetchJson<{ app_name: string; exe_name: string; total_seconds: number; category: string }[]>(
          `${apiBase}/api/screen-time/today`
        ),
        fetchJson<{ language: string; total_seconds: number }[]>(
          `${apiBase}/api/vscode/languages/range?start=${today()}&end=${today()}`
        ),
        fetchJson<{ project_name: string; project_path: string; total_seconds: number; session_count: number }[]>(
          `${apiBase}/api/vscode/projects/range?start=${today()}&end=${today()}`
        ),
        fetchJson<{ enabled: boolean; tracking_level?: string }>(
          `${apiBase}/api/vscode/enabled`
        ),
        fetchJson<{ version: string; focus_active: boolean }>(
          `${apiBase}/api/status`
        ),
      ]);

    this.panel.webview.html = buildHtml({
      todayStats,
      todayApps: todayApps ?? [],
      langStats: langStats ?? [],
      projectStats: projectStats ?? [],
      trackingStatus,
      appStatus,
    });
  }

  private async handleMessage(msg: { command: string; payload?: unknown }): Promise<void> {
    const apiBase = vscode.workspace
      .getConfiguration("timelens")
      .get<string>("apiBaseUrl", "http://127.0.0.1:49152");

    if (msg.command === "setEnabled") {
      const p = msg.payload as { enabled: boolean };
      try {
        await fetch(`${apiBase}/api/vscode/enabled`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: p.enabled }),
        });
        await this.refresh();
      } catch {
        void vscode.window.showErrorMessage("TimeLens: Failed to update tracking setting");
      }
    } else if (msg.command === "setLevel") {
      const p = msg.payload as { level: string };
      // Update VS Code config (canonical source)
      await vscode.workspace
        .getConfiguration("timelens")
        .update("trackingLevel", p.level, vscode.ConfigurationTarget.Global);
      // Also persist to backend so app can show it
      const currentEnabled = vscode.workspace
        .getConfiguration("timelens")
        .get<boolean>("enabled", true);
      try {
        await fetch(`${apiBase}/api/vscode/enabled`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: currentEnabled, tracking_level: p.level }),
        });
      } catch {
        // non-fatal
      }
      await this.refresh();
    } else if (msg.command === "refresh") {
      await this.refresh();
    }
  }

  public dispose(): void {
    DashboardPanel.currentPanel = undefined;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface BuildHtmlOptions {
  todayStats: { total_seconds: number; session_count: number } | null;
  todayApps: { app_name: string; exe_name: string; total_seconds: number; category: string }[];
  langStats: { language: string; total_seconds: number }[];
  projectStats: { project_name: string; project_path: string; total_seconds: number; session_count: number }[];
  trackingStatus: { enabled: boolean; tracking_level?: string } | null;
  appStatus: { version: string; focus_active: boolean } | null;
}

function buildHtml(opts: BuildHtmlOptions): string {
  const { todayStats, todayApps, langStats, projectStats, trackingStatus, appStatus } = opts;
  const appOnline = appStatus !== null;
  const level = trackingStatus?.tracking_level ?? "standard";
  const trackingEnabled = trackingStatus?.enabled ?? true;

  const vscodeTime = todayStats ? fmtDuration(todayStats.total_seconds) : "—";
  const vscodeSessions = todayStats?.session_count ?? 0;

  const topApps = todayApps
    .slice()
    .sort((a, b) => b.total_seconds - a.total_seconds)
    .slice(0, 10);

  const totalAppSeconds = topApps.reduce((s, r) => s + r.total_seconds, 0);

  const appRows = topApps
    .map((app) => {
      const pct = totalAppSeconds > 0 ? Math.round((app.total_seconds / totalAppSeconds) * 100) : 0;
      return `<div class="bar-row">
        <div class="bar-label">
          <span class="app-name" title="${esc(app.exe_name)}">${esc(app.app_name || app.exe_name)}</span>
          <span class="bar-dur">${fmtDuration(app.total_seconds)}</span>
        </div>
        <div class="bar-track"><div class="bar-fill bar-fill-blue" style="width:${pct}%"></div></div>
      </div>`;
    })
    .join("");

  const langRows =
    langStats.length > 0
      ? langStats
          .slice(0, 8)
          .map((row) => {
            const total = langStats.reduce((s, r) => s + r.total_seconds, 0);
            const pct = total > 0 ? Math.round((row.total_seconds / total) * 100) : 0;
            return `<div class="bar-row">
              <div class="bar-label">
                <span>${esc(row.language || "unknown")}</span>
                <span class="bar-dur">${fmtDuration(row.total_seconds)}</span>
              </div>
              <div class="bar-track"><div class="bar-fill bar-fill-accent" style="width:${pct}%"></div></div>
            </div>`;
          })
          .join("")
      : `<div class="empty-hint">${level === "basic" ? "Language data not recorded at basic level" : "No data yet"}</div>`;

  const projectRows =
    projectStats.length > 0
      ? projectStats
          .slice(0, 8)
          .map((row) => {
            const total = projectStats.reduce((s, r) => s + r.total_seconds, 0);
            const pct = total > 0 ? Math.round((row.total_seconds / total) * 100) : 0;
            return `<div class="bar-row">
              <div class="bar-label">
                <span title="${esc(row.project_path || row.project_name)}">${esc(row.project_name || "unknown")}</span>
                <span class="bar-dur">${fmtDuration(row.total_seconds)}</span>
              </div>
              <div class="bar-track"><div class="bar-fill bar-fill-green" style="width:${pct}%"></div></div>
            </div>`;
          })
          .join("")
      : `<div class="empty-hint">${level !== "detailed" ? "Project data only recorded at detailed level" : "No data yet"}</div>`;

  const levelBadgeClass = level === "basic" ? "badge-muted" : level === "detailed" ? "badge-green" : "badge-accent";

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>TimeLens Dashboard</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --fg2: var(--vscode-descriptionForeground);
    --fg3: var(--vscode-disabledForeground, #6e7681);
    --border: var(--vscode-panel-border, #30363d);
    --card: var(--vscode-sideBar-background, #161b22);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hov: var(--vscode-button-hoverBackground);
    --accent: #58a6ff;
    --green: #3fb950;
    --orange: #d29922;
    --red: #f85149;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: 13px; background: var(--bg); color: var(--fg); padding: 16px; }
  h2 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg2); margin-bottom: 10px; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .header-title { display: flex; align-items: center; gap: 8px; }
  .header-title span { font-size: 16px; font-weight: 700; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fg3); flex-shrink: 0; }
  .status-dot.online { background: var(--green); }
  .btn { cursor: pointer; border: 1px solid var(--border); border-radius: 4px; padding: 4px 10px; font-size: 12px; background: var(--btn-bg); color: var(--btn-fg); }
  .btn:hover { background: var(--btn-hov); }
  .btn-secondary { background: transparent; color: var(--fg2); border-color: var(--border); }
  .btn-secondary:hover { color: var(--fg); border-color: var(--fg2); }
  .badge { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 9999px; font-size: 11px; font-weight: 500; }
  .badge-muted { background: rgba(110,118,129,0.15); color: var(--fg3); }
  .badge-accent { background: rgba(88,166,255,0.12); color: var(--accent); }
  .badge-green { background: rgba(63,185,80,0.12); color: var(--green); }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
  @media (max-width: 500px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
  .stat-val { font-size: 22px; font-weight: 700; color: var(--accent); margin: 6px 0 2px; }
  .stat-sub { font-size: 11px; color: var(--fg3); }
  .bar-row { margin-bottom: 8px; }
  .bar-label { display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px; }
  .app-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%; }
  .bar-dur { color: var(--fg2); flex-shrink: 0; }
  .bar-track { height: 4px; background: rgba(255,255,255,0.06); border-radius: 9999px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 9999px; }
  .bar-fill-blue { background: var(--accent); opacity: 0.7; }
  .bar-fill-accent { background: #bc8cff; opacity: 0.7; }
  .bar-fill-green { background: var(--green); opacity: 0.7; }
  .empty-hint { font-size: 12px; color: var(--fg3); font-style: italic; padding: 8px 0; }
  .offline-banner { background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); border-radius: 6px; padding: 10px 14px; color: var(--red); margin-bottom: 14px; font-size: 12px; }
  .section { margin-bottom: 12px; }
  .settings-rows { display: flex; flex-direction: column; gap: 12px; }
  .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .setting-label { font-size: 12px; color: var(--fg2); }
  .select { background: var(--card); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; padding: 3px 6px; font-size: 12px; cursor: pointer; }
  .focus-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; }
  .focus-on { background: rgba(63,185,80,0.15); color: var(--green); }
  .focus-off { background: rgba(110,118,129,0.1); color: var(--fg3); }
  .divider { height: 1px; background: var(--border); margin: 12px 0; }
  .refresh-btn { opacity: 0.6; font-size: 11px; cursor: pointer; background: none; border: none; color: var(--fg2); padding: 0; }
  .refresh-btn:hover { opacity: 1; }
</style>
</head>
<body>
<div class="header">
  <div class="header-title">
    <div class="status-dot ${appOnline ? "online" : ""}"></div>
    <span>TimeLens</span>
    ${appOnline ? `<span class="badge badge-muted">v${esc(appStatus!.version)}</span>` : ""}
  </div>
  <button class="refresh-btn" onclick="refresh()">↺ Refresh</button>
</div>

${!appOnline ? `<div class="offline-banner">⚠ TimeLens desktop app is not running. Start it to see your data.</div>` : ""}

<div class="section">
  <h2>Today</h2>
  <div class="grid-3">
    <div class="card">
      <div class="stat-sub">VS Code time</div>
      <div class="stat-val">${vscodeTime}</div>
      <div class="stat-sub">${vscodeSessions} session${vscodeSessions !== 1 ? "s" : ""}</div>
    </div>
    <div class="card">
      <div class="stat-sub">Total screen time</div>
      <div class="stat-val">${totalAppSeconds > 0 ? fmtDuration(totalAppSeconds) : "—"}</div>
      <div class="stat-sub">${topApps.length} apps</div>
    </div>
    <div class="card">
      <div class="stat-sub">Focus mode</div>
      <div class="stat-val" style="font-size:14px;margin-top:10px;">
        ${appStatus ? `<span class="focus-badge ${appStatus.focus_active ? "focus-on" : "focus-off"}">${appStatus.focus_active ? "● Active" : "○ Off"}</span>` : "—"}
      </div>
    </div>
  </div>
</div>

${topApps.length > 0 ? `
<div class="section">
  <h2>App Usage — Today</h2>
  <div class="card">${appRows}</div>
</div>` : ""}

<div class="grid-2">
  <div class="section">
    <h2>Languages — Today</h2>
    <div class="card">${langRows}</div>
  </div>
  <div class="section">
    <h2>Projects — Today</h2>
    <div class="card">${projectRows}</div>
  </div>
</div>

<div class="divider"></div>

<div class="section">
  <h2>Settings</h2>
  <div class="card settings-rows">
    <div class="setting-row">
      <span class="setting-label">VS Code tracking</span>
      <button class="btn ${trackingEnabled ? "btn-secondary" : ""}" onclick="setEnabled(${!trackingEnabled})">
        ${trackingEnabled ? "Disable" : "Enable"}
      </button>
    </div>
    <div class="setting-row">
      <span class="setting-label">Detail level</span>
      <select class="select" onchange="setLevel(this.value)">
        <option value="basic" ${level === "basic" ? "selected" : ""}>Basic — duration only</option>
        <option value="standard" ${level === "standard" ? "selected" : ""}>Standard — + language</option>
        <option value="detailed" ${level === "detailed" ? "selected" : ""}>Detailed — + project path</option>
      </select>
    </div>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function setEnabled(val) { vscode.postMessage({ command: 'setEnabled', payload: { enabled: val } }); }
  function setLevel(val) { vscode.postMessage({ command: 'setLevel', payload: { level: val } }); }
  function refresh() { vscode.postMessage({ command: 'refresh' }); }
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
