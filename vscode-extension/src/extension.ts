import * as vscode from "vscode";
import { postVsCodeSession, resolveApiBaseUrl } from "./api/timelensApi";
import { SessionTracker } from "./sessionTracker";
import { DashboardPanel } from "./dashboardPanel";
import { DashboardSidebarViewProvider } from "./dashboardSidebarView";
import { t } from "./i18n";

let tracker: SessionTracker | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let sidebarProvider: DashboardSidebarViewProvider | null = null;
export let outputChannel: vscode.OutputChannel | null = null;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("TimeLens");
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine(`[${new Date().toISOString()}] TimeLens extension activated`);

  tracker = new SessionTracker(context, outputChannel);
  tracker.start();

  const promptSetBridgeKey = async () => {
    const current = vscode.workspace
      .getConfiguration("timelens")
      .get<string>("bridgeKey", "");
    const value = await vscode.window.showInputBox({
      title: t().setKeyTitle,
      prompt: t().setKeyPromptText,
      password: false,
      value: current,
      ignoreFocusOut: true,
    });
    if (value !== undefined) {
      await vscode.workspace
        .getConfiguration("timelens")
        .update("bridgeKey", value, vscode.ConfigurationTarget.Global);
      if (value.trim()) {
        void vscode.window.showInformationMessage(t().keySaved);
      } else {
        void vscode.window.showWarningMessage(t().keyCleared);
      }
    }
  };

  sidebarProvider = new DashboardSidebarViewProvider(
    context,
    () => tracker?.snapshotAndFlush() ?? Promise.resolve(),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardSidebarViewProvider.viewType,
      sidebarProvider
    )
  );

  // Sync current tracking level to backend on startup
  void syncTrackingLevelToBackend();

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "timelens.openDashboard";
  context.subscriptions.push(statusBarItem);

  const updateStatusBar = () => {
    const enabled = vscode.workspace.getConfiguration("timelens").get<boolean>("enabled", true);
    const level = vscode.workspace.getConfiguration("timelens").get<string>("trackingLevel", "standard");
    const pending = tracker?.getQueueSize() ?? 0;
    statusBarItem!.text = enabled ? `TimeLens: On [${level}] (${pending})` : "TimeLens: Off";
    statusBarItem!.tooltip = "TimeLens local tracking status";
    statusBarItem!.show();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("timelens")) {
        tracker?.start();
        updateStatusBar();
        void sidebarProvider?.refresh();
        if (event.affectsConfiguration("timelens.trackingLevel") || event.affectsConfiguration("timelens.enabled")) {
          void syncTrackingLevelToBackend();
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("timelens.openSidebar", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.timelens");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("timelens.enableTracking", async () => {
      await vscode.workspace
        .getConfiguration("timelens")
        .update("enabled", true, vscode.ConfigurationTarget.Global);
      updateStatusBar();
      void vscode.window.showInformationMessage(t().trackingEnabled);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("timelens.disableTracking", async () => {
      await vscode.workspace
        .getConfiguration("timelens")
        .update("enabled", false, vscode.ConfigurationTarget.Global);
      updateStatusBar();
      void vscode.window.showInformationMessage(t().trackingDisabled);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("timelens.setTrackingLevel", async () => {
      const current = vscode.workspace
        .getConfiguration("timelens")
        .get<string>("trackingLevel", "standard");
      const items: vscode.QuickPickItem[] = [
        {
          label: "basic",
          description: t().basicDesc,
          detail: t().basicDetail,
          picked: current === "basic",
        },
        {
          label: "standard",
          description: t().standardDesc,
          detail: t().standardDetail,
          picked: current === "standard",
        },
        {
          label: "detailed",
          description: t().detailedDesc,
          detail: t().detailedDetail,
          picked: current === "detailed",
        },
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: t().selectLevelTitle,
        placeHolder: t().selectLevelPlaceholder,
      });
      if (picked) {
        await vscode.workspace
          .getConfiguration("timelens")
          .update("trackingLevel", picked.label, vscode.ConfigurationTarget.Global);
        updateStatusBar();
        void vscode.window.showInformationMessage(t().levelSet(picked.label));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("timelens.openDashboard", async () => {
      // Snapshot and flush in-progress session data before showing so both
      // panel and sidebar display up-to-date numbers without ending the session.
      await tracker?.snapshotAndFlush();
      DashboardPanel.createOrShow(context);
      void sidebarProvider?.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("timelens.setExtensionBridgeKey", async () => {
      await promptSetBridgeKey();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("timelens.showStatus", () => {
      const enabled = vscode.workspace.getConfiguration("timelens").get<boolean>("enabled", true);
      const pending = tracker?.getQueueSize() ?? 0;
      const msg = enabled
        ? t().statusEnabled(pending)
        : t().statusDisabled;
      void vscode.window.showInformationMessage(msg);
      outputChannel?.show(true);
    })
  );

  // Log startup configuration to output channel
  const startupBridgeKey = vscode.workspace.getConfiguration("timelens").get<string>("bridgeKey", "").trim();
  const startupApiBase = vscode.workspace.getConfiguration("timelens").get<string>("apiBaseUrl", "http://127.0.0.1:49152");
  const startupEnabled = vscode.workspace.getConfiguration("timelens").get<boolean>("enabled", true);
  const startupLevel = vscode.workspace.getConfiguration("timelens").get<string>("trackingLevel", "standard");
  outputChannel?.appendLine(`[${new Date().toISOString()}] Config: apiBaseUrl=${startupApiBase}, enabled=${startupEnabled}, level=${startupLevel}, bridgeKey=${startupBridgeKey ? "set (" + startupBridgeKey.slice(0, 4) + "\u2026)" : "NOT SET"}`);

  updateStatusBar();

  const bridgeKey = startupBridgeKey;
  if (!bridgeKey) {
    void vscode.window
      .showInformationMessage(
        t().configureKeyPrompt,
        t().configureNow
      )
      .then((picked) => {
        if (picked === t().configureNow) {
          void promptSetBridgeKey();
        }
      });
  }
}

export async function deactivate(): Promise<void> {
  if (tracker) {
    await tracker.flushNow();
    tracker.stop();
  }
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}

async function syncTrackingLevelToBackend(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("timelens");
  const enabled = cfg.get<boolean>("enabled", true);
  const level = cfg.get<string>("trackingLevel", "standard");
  const apiBase = cfg.get<string>("apiBaseUrl", "http://127.0.0.1:49152");
  try {
    const resolvedBase = await resolveApiBaseUrl(apiBase);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    await fetch(`${resolvedBase}/api/vscode/enabled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, tracking_level: level }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch {
    // Desktop app may not be running yet — silently ignore
  }
}
