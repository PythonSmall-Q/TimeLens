import * as vscode from "vscode";
import { SessionTracker } from "./sessionTracker";
import { DashboardPanel } from "./dashboardPanel";
import { DashboardSidebarViewProvider } from "./dashboardSidebarView";

let tracker: SessionTracker | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let sidebarProvider: DashboardSidebarViewProvider | null = null;

export function activate(context: vscode.ExtensionContext): void {
  tracker = new SessionTracker(context);
  tracker.start();

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
      void vscode.window.showInformationMessage("TimeLens tracking enabled");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("timelens.disableTracking", async () => {
      await vscode.workspace
        .getConfiguration("timelens")
        .update("enabled", false, vscode.ConfigurationTarget.Global);
      updateStatusBar();
      void vscode.window.showInformationMessage("TimeLens tracking disabled");
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
          description: "Session duration only",
          detail: "No language or project information is recorded.",
          picked: current === "basic",
        },
        {
          label: "standard",
          description: "Duration + language distribution (recommended)",
          detail: "Records which languages you use and how long.",
          picked: current === "standard",
        },
        {
          label: "detailed",
          description: "Duration + language + project path",
          detail: "Also records the project folder path for each session.",
          picked: current === "detailed",
        },
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: "TimeLens: Select Detail Level",
        placeHolder: "Choose how much data to record per session",
      });
      if (picked) {
        await vscode.workspace
          .getConfiguration("timelens")
          .update("trackingLevel", picked.label, vscode.ConfigurationTarget.Global);
        updateStatusBar();
        void vscode.window.showInformationMessage(`TimeLens detail level set to: ${picked.label}`);
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
    vscode.commands.registerCommand("timelens.showStatus", () => {
      const enabled = vscode.workspace.getConfiguration("timelens").get<boolean>("enabled", true);
      const pending = tracker?.getQueueSize() ?? 0;
      const msg = enabled
        ? `TimeLens tracking is enabled. Pending uploads: ${pending}.`
        : "TimeLens tracking is disabled.";
      void vscode.window.showInformationMessage(msg);
    })
  );

  updateStatusBar();
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
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    await fetch(`${apiBase}/api/vscode/enabled`, {
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
