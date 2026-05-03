import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { register as registerGlobalShortcut, unregisterAll as unregisterAllGlobalShortcuts } from "@tauri-apps/plugin-global-shortcut";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { check } from "@tauri-apps/plugin-updater";
import MainLayout from "./components/layout/MainLayout";
import Dashboard from "./pages/Dashboard";
import WidgetCenter from "./pages/WidgetCenter";
import Settings from "./pages/Settings";
import Limits from "./pages/Limits";
import Categories from "./pages/Categories";
import Goals from "./pages/Goals";
import FocusMode from "./pages/FocusMode";
import BrowserUsage from "./pages/BrowserUsage";
import HomeCustomize from "./pages/HomeCustomize";
import VsCodeInsights from "./pages/VsCodeInsights";
import { useStatsStore } from "./stores/statsStore";
import { useSettingsStore } from "./stores/settingsStore";
import type { ActiveWindowInfo, AppLimit } from "./types";
import * as api from "@/services/tauriApi";
import { formatDuration } from "@/utils/format";
import { useTranslation } from "react-i18next";
import { todayString } from "@/utils/format";

const CURRENT_VERSION = "1.0.0";
const LIMIT_WARNED_KEY = "timelens-limit-warned";
const LIMIT_STORAGE_KEY = "timelens-app-limits";

function normalizeExePath(path: string): string {
  return path.trim().toLowerCase().replace(/\//g, "\\");
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export default function MainApp() {
  const {
    fetchToday,
    fetchTodaySummary,
    fetchWeekly,
    fetchMonitorStatus,
    setCurrentApp,
    setMonitorActive,
    selectedDate,
    periodMode,
  } = useStatsStore();
  const { setMonitoringActive } = useSettingsStore();
  const { t } = useTranslation(["common", "limits", "browserUsage"]);

  const [updateInfo, setUpdateInfo] = useState<{ version: string; notes: string; url: string } | null>(null);

  const focusMainAndNavigate = useCallback(async (hash: string) => {
    const win = getCurrentWebviewWindow();
    window.location.hash = hash;
    await win.show().catch(() => {});
    await win.setFocus().catch(() => {});
  }, []);

  const notifyWithNavigate = useCallback(
    async (title: string, body: string, hash: string, alarm = false) => {
      void hash;
      let permission = "default";
      try {
        permission = (await isPermissionGranted()) ? "granted" : await requestPermission();
      } catch {
        permission = "denied";
      }
      if (permission !== "granted") return;

      try {
        await api.sendNativeNotification(title, body, alarm);
      } catch {
        try {
          await sendNotification({ title, body, ongoing: alarm });
        } catch {
          // ignore notification failures
        }
      }
    },
    []
  );

  const toggleWidgetsVisibility = useCallback(async () => {
    const all = await getAllWebviewWindows();
    const widgets = all.filter((w) => /^(clock|todo|timer|note|status)-/.test(w.label));
    const visibleFlags = await Promise.all(widgets.map((w) => w.isVisible().catch(() => false)));
    const hasVisible = visibleFlags.some(Boolean);

    if (hasVisible) {
      await Promise.all(
        widgets.map((w) =>
          w
            .hide()
            .then(() => w.emit("timelens-widget-hidden", {}))
            .catch(() => {})
        )
      );
      return;
    }

    const configs = await api.getAllWidgets();
    await Promise.all(configs.map((cfg) => api.openWidget(cfg).catch(() => {})));
  }, []);

  const checkLimits = useCallback(async () => {
    let limits: AppLimit[] = [];
    try { limits = JSON.parse(localStorage.getItem(LIMIT_STORAGE_KEY) || "[]"); } catch { return; }
    const enabled = limits.filter((l) => l.enabled);
    if (!enabled.length) return;
    const today = new Date().toISOString().slice(0, 10);
    let warned: { date: string; warned: Record<string, number[]> } = { date: "", warned: {} };
    try { warned = JSON.parse(localStorage.getItem(LIMIT_WARNED_KEY) || '{"date":"","warned":{}}'); } catch { /* */ }
    if (warned.date !== today) warned = { date: today, warned: {} };
    const totals = await api.getTodayAppTotals().catch(() => []);
    const totalsMap = new Map<string, number>();
    for (const row of totals) {
      const key = normalizeExePath(row.exe_path);
      totalsMap.set(key, (totalsMap.get(key) ?? 0) + row.total_seconds);
    }

    for (const lim of enabled) {
      const used = totalsMap.get(normalizeExePath(lim.exePath)) ?? 0;
      if (lim.dailyLimitSeconds <= 0) continue;
      const ratio = used / lim.dailyLimitSeconds;
      const threshold = ratio >= 1.0 ? 100 : ratio >= 0.9 ? 90 : ratio >= 0.8 ? 80 : 0;
      if (!threshold) continue;
      const aw = warned.warned[lim.exePath] ?? [];
      if (aw.includes(threshold)) continue;
      warned.warned[lim.exePath] = [...aw, threshold];
      const title =
        threshold === 100
          ? t("limits:limitReached100Title")
          : threshold === 90
          ? t("limits:limitReached90")
          : t("limits:limitReached80");
      const body =
        threshold === 100
          ? t("limits:limitReached100Body", {
              app: lim.appName,
              used: formatDuration(used),
              limit: formatDuration(lim.dailyLimitSeconds),
            })
          : t(threshold === 90 ? "limits:limitReached90Body" : "limits:limitReached80Body", {
              app: lim.appName,
              used: formatDuration(used),
              limit: formatDuration(lim.dailyLimitSeconds),
            });
      await notifyWithNavigate(title, body, "#/limits", true);
    }
    localStorage.setItem(LIMIT_WARNED_KEY, JSON.stringify(warned));
  }, [notifyWithNavigate, t]);

  useEffect(() => {
    // Initial data load
    fetchTodaySummary();
    if (periodMode === "day" && selectedDate === todayString()) {
      fetchToday();
    }
    fetchWeekly();
    fetchMonitorStatus();

    // Refresh monitor state every 30 s, and refresh daily stats only when viewing today.
    const interval = setInterval(() => {
      fetchTodaySummary();
      if (periodMode === "day" && selectedDate === todayString()) {
        fetchToday();
      }
      fetchMonitorStatus();
    }, 30_000);
    void checkLimits();
    const limitInterval = setInterval(checkLimits, 60_000);

    // Listen to real-time window changes
    const unlistenPromise = listen<ActiveWindowInfo>("active-window-changed", (e) => {
      setCurrentApp(e.payload.app_name);
    });

    // Listen to backend monitoring state changes from tray menu
    const unlistenMonitor = listen<boolean>("monitoring-changed", (e) => {
      const active = !!e.payload;
      setMonitoringActive(active);
      setMonitorActive(active);
    });

    // Listen to browser domain limit notifications from backend
    const unlistenDomainLimit = listen<{ host: string; percent: number; used_seconds: number; limit_seconds: number }>(
      "browser-domain-limit-reached",
      async (e) => {
        const { host, percent, used_seconds, limit_seconds } = e.payload;
        const title = percent >= 100
          ? t("browserUsage:limitReached100", { host })
          : t("browserUsage:limitReached90", { host });
        const body = percent >= 100
          ? t("browserUsage:limitReached100Body", { host, used: formatDuration(used_seconds), limit: formatDuration(limit_seconds) })
          : t("browserUsage:limitReached90Body", { host, used: formatDuration(used_seconds), limit: formatDuration(limit_seconds) });
        await notifyWithNavigate(title, body, "#/browser", percent >= 100);
      }
    );

    return () => {
      clearInterval(interval);
      clearInterval(limitInterval);
      unlistenPromise.then((u) => u());
      unlistenMonitor.then((u) => u());
      unlistenDomainLimit.then((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkLimits, fetchMonitorStatus, fetchToday, fetchTodaySummary, periodMode, selectedDate]);

  // Update check – once after 4 s
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("https://api.github.com/repos/PythonSmall-Q/TimeLens/releases/latest");
        if (!res.ok) return;
        const data = await res.json() as { tag_name?: string; body?: string; html_url?: string };
        const latest = (data.tag_name ?? "").replace(/^v/, "");
        if (!(latest && compareVersions(latest, CURRENT_VERSION) > 0)) return;

        const channel = await api.getInstallChannelInfo();
        setUpdateInfo({ version: latest, notes: data.body ?? "", url: data.html_url ?? "" });

        if (!channel.should_trigger_update) {
          await notifyWithNavigate(
            t("common:updateAvailableTitle"),
            t("common:updateAvailableBody", { version: latest, current: CURRENT_VERSION }),
            "#/settings"
          );
          return;
        }

        try {
          const update = await check();
          if (update) {
            await update.downloadAndInstall();
            await notifyWithNavigate(
              t("common:updateAvailableTitle"),
              t("common:updateInstallReady", { version: latest }),
              "#/settings"
            );
            return;
          }
        } catch {
          // fallback to release page
        }

        if (data.html_url) window.open(data.html_url, "_blank", "noopener,noreferrer");

        await notifyWithNavigate(
          t("common:updateAvailableTitle"),
          t("common:updateAvailableBody", { version: latest, current: CURRENT_VERSION }),
          "#/settings"
        );
      } catch { /* offline */ }
    }, 4000);
    return () => clearTimeout(timer);
  }, [notifyWithNavigate, t]);

  useEffect(() => {
    let mounted = true;

    const registerShortcuts = async (shortcuts: {
      open_widget_center: string;
      toggle_widget_visibility: string;
      start_recording: string;
      pause_recording: string;
    }) => {
      await unregisterAllGlobalShortcuts().catch(() => {});

      await registerGlobalShortcut(shortcuts.open_widget_center, () => {
        void focusMainAndNavigate("#/widgets");
      }).catch(() => {});

      await registerGlobalShortcut(shortcuts.toggle_widget_visibility, () => {
        void toggleWidgetsVisibility();
      }).catch(() => {});

      await registerGlobalShortcut(shortcuts.start_recording, () => {
        setMonitoringActive(true);
        setMonitorActive(true);
        void api.setMonitoringActive(true);
      }).catch(() => {});

      await registerGlobalShortcut(shortcuts.pause_recording, () => {
        setMonitoringActive(false);
        setMonitorActive(false);
        void api.setMonitoringActive(false);
      }).catch(() => {});
    };

    const init = async () => {
      const settings = await api.getAppSettings().catch(() => null);
      if (!mounted || !settings) return;
      await registerShortcuts(settings.shortcuts);
    };

    const onShortcutChanged = (e: Event) => {
      const ce = e as CustomEvent<{
        open_widget_center: string;
        toggle_widget_visibility: string;
        start_recording: string;
        pause_recording: string;
      }>;
      if (!ce.detail) return;
      void registerShortcuts(ce.detail);
    };

    init();
    window.addEventListener("timelens-shortcuts-changed", onShortcutChanged);

    return () => {
      mounted = false;
      window.removeEventListener("timelens-shortcuts-changed", onShortcutChanged);
      void unregisterAllGlobalShortcuts();
    };
  }, [focusMainAndNavigate, setMonitorActive, setMonitoringActive, toggleWidgetsVisibility]);

  return (
    <HashRouter>
      <MainLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/vscode" element={<VsCodeInsights />} />
          <Route path="/dashboard-customize" element={<HomeCustomize />} />
          <Route path="/widgets" element={<WidgetCenter />} />
          <Route path="/settings" element={<Settings />} />
                  <Route path="/limits" element={<Limits />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/focus" element={<FocusMode />} />
          <Route path="/browser" element={<BrowserUsage />} />
        </Routes>
      </MainLayout>

      {/* ── Update available modal ── */}
      {updateInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card max-w-md w-full mx-4 p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-text-primary">{t("common:updateAvailableTitle")}</h2>
                <p className="text-sm text-text-secondary mt-1">{t("common:updateAvailableBody", { version: updateInfo.version, current: CURRENT_VERSION })}</p>
              </div>
              <button onClick={() => setUpdateInfo(null)} className="text-text-muted hover:text-text-primary flex-shrink-0">✕</button>
            </div>
            {updateInfo.notes && (
              <div className="bg-surface-light rounded-xl p-3 max-h-52 overflow-y-auto">
                <p className="text-xs font-semibold text-text-secondary mb-1">{t("common:whatsNew")}</p>
                <pre className="text-xs text-text-muted whitespace-pre-wrap font-sans leading-relaxed">{updateInfo.notes}</pre>
              </div>
            )}
            <div className="flex gap-3">
              <a href={updateInfo.url} target="_blank" rel="noopener noreferrer" className="flex-1 py-2.5 rounded-xl text-sm font-medium text-center bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30 transition-colors border border-accent-blue/30">
                {t("common:viewOnGitHub")}
              </a>
              <button onClick={() => setUpdateInfo(null)} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-surface-border text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors">
                {t("common:remindLater")}
              </button>
            </div>
          </div>
        </div>
      )}
    </HashRouter>
  );
}
