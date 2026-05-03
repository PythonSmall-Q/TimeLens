import * as vscode from "vscode";

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(url, { signal: ctrl.signal });
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

export class DashboardSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "timelens.homeView";
  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.onDidReceiveMessage(async (msg: { command: string; payload?: unknown }) => {
      if (msg.command === "refresh") {
        await this.refresh();
      }
      if (msg.command === "openDashboard") {
        await vscode.commands.executeCommand("timelens.openDashboard");
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

    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) return;

    const cfg = vscode.workspace.getConfiguration("timelens");
    const enabled = cfg.get<boolean>("enabled", true);
    const level = cfg.get<string>("trackingLevel", "standard");
    const apiBase = cfg.get<string>("apiBaseUrl", "http://127.0.0.1:49152");

    const [status, vscodeToday, appToday] = await Promise.all([
      fetchJson<{ version: string; focus_active: boolean }>(`${apiBase}/api/status`),
      fetchJson<{ total_seconds: number; session_count: number }>(`${apiBase}/api/vscode/stats/today`),
      fetchJson<Array<{ app_name: string; total_seconds: number }>>(`${apiBase}/api/screen-time/today`),
    ]);

    const topApp = (appToday ?? []).sort((a, b) => b.total_seconds - a.total_seconds)[0];

    this.view.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; }
  .title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 10px; margin-top: 10px; background: var(--vscode-sideBar-background); }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 8px 0; }
  .value { font-size: 20px; font-weight: 700; color: var(--vscode-textLink-foreground); }
  button { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 5px 10px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
  button.secondary { background: transparent; color: var(--vscode-foreground); }
  select { border: 1px solid var(--vscode-panel-border); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border-radius: 4px; padding: 4px 6px; }
  .pill { font-size: 11px; padding: 2px 7px; border-radius: 999px; background: rgba(88,166,255,0.12); color: #58a6ff; }
  .warn { margin-top: 8px; color: #d29922; font-size: 12px; }
</style>
</head>
<body>
  <div class="title">TimeLens</div>
  <div class="muted">扩展主页</div>

  <div class="card">
    <div class="row">
      <span class="muted">今日 VS Code 时长</span>
      <span class="pill">${level}</span>
    </div>
    <div class="value">${formatDuration(vscodeToday?.total_seconds ?? 0)}</div>
    <div class="muted">${vscodeToday?.session_count ?? 0} sessions</div>
  </div>

  <div class="card">
    <div class="row">
      <span class="muted">记录开关</span>
      <button class="secondary" onclick="toggleTracking()">${enabled ? "关闭记录" : "开启记录"}</button>
    </div>
    <div class="row">
      <span class="muted">记录级别</span>
      <select id="level" onchange="setLevel(this.value)">
        <option value="basic" ${level === "basic" ? "selected" : ""}>basic</option>
        <option value="standard" ${level === "standard" ? "selected" : ""}>standard</option>
        <option value="detailed" ${level === "detailed" ? "selected" : ""}>detailed</option>
      </select>
    </div>
    ${!status ? '<div class="warn">未连接到 TimeLens 桌面端</div>' : ""}
  </div>

  <div class="card">
    <div class="row"><span class="muted">今日最高应用</span><span>${topApp?.app_name ?? "-"}</span></div>
    <div class="row"><span class="muted">桌面端版本</span><span>${status?.version ?? "-"}</span></div>
    <div class="row">
      <button onclick="openDashboard()">打开完整仪表盘</button>
      <button class="secondary" onclick="refresh()">刷新</button>
    </div>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  function refresh(){ vscode.postMessage({ command: 'refresh' }); }
  function openDashboard(){ vscode.postMessage({ command: 'openDashboard' }); }
  function toggleTracking(){ vscode.postMessage({ command: 'toggleTracking', payload: { enabled: ${!enabled} } }); }
  function setLevel(level){ vscode.postMessage({ command: 'setLevel', payload: { level } }); }
</script>
</body>
</html>`;
  }

  async pushSettingsToBackend(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("timelens");
    const enabled = cfg.get<boolean>("enabled", true);
    const level = cfg.get<string>("trackingLevel", "standard");
    const apiBase = cfg.get<string>("apiBaseUrl", "http://127.0.0.1:49152");
    try {
      await fetch(`${apiBase}/api/vscode/enabled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, tracking_level: level }),
      });
    } catch {
      // ignore when desktop app is offline
    }
  }
}
