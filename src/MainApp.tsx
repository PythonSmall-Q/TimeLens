import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { listen } from "@tauri-apps/api/event";
import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { register as registerGlobalShortcut, unregisterAll as unregisterAllGlobalShortcuts } from "@tauri-apps/plugin-global-shortcut";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { check } from "@tauri-apps/plugin-updater";
import type { Update, DownloadEvent } from "@tauri-apps/plugin-updater";
import MainLayout from "./components/layout/MainLayout";
import Loading from "./components/Loading";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const WidgetCenter = lazy(() => import("./pages/WidgetCenter"));
const Settings = lazy(() => import("./pages/Settings"));
const Limits = lazy(() => import("./pages/Limits"));
const Categories = lazy(() => import("./pages/Categories"));
const Goals = lazy(() => import("./pages/Goals"));
const FocusMode = lazy(() => import("./pages/FocusMode"));
const BrowserUsage = lazy(() => import("./pages/BrowserUsage"));
const HomeCustomize = lazy(() => import("./pages/HomeCustomize"));
const VsCodeInsights = lazy(() => import("./pages/VsCodeInsights"));
const DashboardInsights = lazy(() => import("./pages/DashboardInsights"));
const InterruptionDetail = lazy(() => import("./pages/InterruptionDetail"));
const WidgetDevHarness = lazy(() => import("./pages/WidgetDevHarness"));
import { useStatsStore } from "./stores/statsStore";
import { useSettingsStore } from "./stores/settingsStore";
import type { ActiveWindowInfo, AppLimit, GoalRiskAlert } from "./types";
import * as api from "@/services/tauriApi";
import { formatDuration } from "@/utils/format";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n/config";
import { todayString } from "@/utils/format";
import { APP_VERSION } from "./version";

const CURRENT_VERSION = APP_VERSION;
const LIMIT_WARNED_KEY = "timelens-limit-warned";
const LIMIT_STORAGE_KEY = "timelens-app-limits";
const NOTIFICATION_COOLDOWN_KEY = "timelens-notification-cooldown.v1";

function parseHmToMinutes(hm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function isWithinQuietHours(nowMinutes: number, startHm: string, endHm: string): boolean {
  const start = parseHmToMinutes(startHm);
  const end = parseHmToMinutes(endHm);
  if (start === null || end === null) return false;
  if (start === end) return true;
  if (start < end) {
    return nowMinutes >= start && nowMinutes < end;
  }
  return nowMinutes >= start || nowMinutes < end;
}

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
  const {
    setMonitoringActive,
    updateMode,
    notificationQuietHoursEnabled,
    notificationQuietStart,
    notificationQuietEnd,
    notificationCooldownMin,
  } = useSettingsStore();
  const { t } = useTranslation(["common", "limits", "browserUsage"]);

  const [updateInfo, setUpdateInfo] = useState<{ version: string; notes: string; url: string; update: Update | null } | null>(null);
  const [updatePhase, setUpdatePhase] = useState<"available" | "downloading" | "downloaded" | "installing">("available");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const updateCloseButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleLanguageChanged = (lng: string) => {
      document.documentElement.lang = lng;
    };
    document.documentElement.lang = i18n.language || "en";
    i18n.on("languageChanged", handleLanguageChanged);
    return () => {
      i18n.off("languageChanged", handleLanguageChanged);
    };
  }, []);

  const focusMainAndNavigate = useCallback(async (hash: string) => {
    const win = getCurrentWebviewWindow();
    window.location.hash = hash;
    await win.show().catch(() => {});
    await win.setFocus().catch(() => {});
  }, []);

  const notifyWithNavigate = useCallback(
    async (title: string, body: string, hash: string, alarm = false) => {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      if (
        notificationQuietHoursEnabled
        && isWithinQuietHours(nowMinutes, notificationQuietStart, notificationQuietEnd)
      ) {
        return;
      }

      const cooldownMs = Math.max(0, notificationCooldownMin) * 60_000;
      if (cooldownMs > 0) {
        const dedupeKey = `${hash}|${title}`;
        try {
          const raw = localStorage.getItem(NOTIFICATION_COOLDOWN_KEY);
          const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
          const lastTs = map[dedupeKey] ?? 0;
          const nowTs = now.getTime();
          if (nowTs - lastTs < cooldownMs) {
            return;
          }
          map[dedupeKey] = nowTs;
          localStorage.setItem(NOTIFICATION_COOLDOWN_KEY, JSON.stringify(map));
        } catch {
          // Ignore cooldown storage failures and continue with notifications.
        }
      }

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
    [notificationCooldownMin, notificationQuietEnd, notificationQuietHoursEnabled, notificationQuietStart]
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

    // Listen to goal risk alerts from backend intelligence
    const unlistenGoalRisk = listen<GoalRiskAlert>("goal-risk-alert", async (e) => {
      const { scope_value, message, severity } = e.payload;
      const title = t("dashboard:goalRiskAlertTitle", { scope: scope_value });
      await notifyWithNavigate(title, message, "#/goals", severity === "critical");
    });

    return () => {
      clearInterval(interval);
      clearInterval(limitInterval);
      unlistenPromise.then((u) => u());
      unlistenMonitor.then((u) => u());
      unlistenDomainLimit.then((u) => u());
      unlistenGoalRisk.then((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkLimits, fetchMonitorStatus, fetchToday, fetchTodaySummary, periodMode, selectedDate]);

  useEffect(() => {
    const onVsCodeExtensionUnavailable = () => {
      void notifyWithNavigate(
        t("common:vscodeExtensionOfflineTitle"),
        t("common:vscodeExtensionOfflineBody"),
        "#/vscode"
      );
    };

    window.addEventListener(api.VSCODE_EXTENSION_UNAVAILABLE_EVENT, onVsCodeExtensionUnavailable);
    return () => {
      window.removeEventListener(api.VSCODE_EXTENSION_UNAVAILABLE_EVENT, onVsCodeExtensionUnavailable);
    };
  }, [notifyWithNavigate, t]);

  // Update check – once after 4 s
  useEffect(() => {
    if (updateMode === "off") return;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch("https://api.github.com/repos/PythonSmall-Q/TimeLens/releases/latest");
        if (!res.ok) return;
        const data = await res.json() as { tag_name?: string; body?: string; html_url?: string };
        const latest = (data.tag_name ?? "").replace(/^v/, "");
        if (!(latest && compareVersions(latest, CURRENT_VERSION) > 0)) return;

        const channel = await api.getInstallChannelInfo();

        if (!channel.should_trigger_update) {
          const storeUpdateUrl = channel.update_url ?? "ms-windows-store://downloadsandupdates";
          try {
            await openExternal(storeUpdateUrl);
          } catch {
            // Fallback to web store homepage if URI scheme is unavailable.
            window.open("https://apps.microsoft.com/", "_blank", "noopener,noreferrer");
          }
          await notifyWithNavigate(
            t("common:updateAvailableTitle"),
            t("common:updateAvailableStoreBody", { version: latest, current: CURRENT_VERSION }),
            "#/settings"
          );
          return;
        }

        if (updateMode === "auto") {
          try {
            const update = await check();
            if (update) {
              await update.downloadAndInstall();
              await api.relaunchApp();
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
          return;
        }

        // notify mode: show the manual download/install dialog
        try {
          const update = await check();
          if (update) {
            setUpdateInfo({ version: latest, notes: data.body ?? "", url: data.html_url ?? "", update });
            setUpdatePhase("available");
            setDownloadProgress(0);
            return;
          }
        } catch {
          // fallback to release page modal
        }

        setUpdateInfo({ version: latest, notes: data.body ?? "", url: data.html_url ?? "", update: null });
        setUpdatePhase("available");
        setDownloadProgress(0);
      } catch { /* offline */ }
    }, 4000);
    return () => clearTimeout(timer);
  }, [updateMode, notifyWithNavigate, t]);

  useEffect(() => {
    if (updateInfo) {
      updateCloseButtonRef.current?.focus();
    }
  }, [updateInfo]);

  useEffect(() => {
    let mounted = true;

    const safeUnregisterAllGlobalShortcuts = async () => {
      try {
        await unregisterAllGlobalShortcuts();
      } catch {
        // Some channels/environments may not grant unregister_all permission.
      }
    };

    const registerShortcuts = async (shortcuts: {
      open_widget_center: string;
      toggle_widget_visibility: string;
      start_recording: string;
      pause_recording: string;
    }) => {
      await safeUnregisterAllGlobalShortcuts();

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
      void safeUnregisterAllGlobalShortcuts();
    };
  }, [focusMainAndNavigate, setMonitorActive, setMonitoringActive, toggleWidgetsVisibility]);

  const closeUpdateModal = useCallback(() => {
    if (updateInfo?.update && updatePhase === "available") {
      updateInfo.update.close().catch(() => {});
    }
    setUpdateInfo(null);
    setUpdatePhase("available");
    setDownloadProgress(0);
  }, [updateInfo, updatePhase]);

  const handleDownloadUpdate = useCallback(async () => {
    if (!updateInfo?.update) return;
    setUpdatePhase("downloading");
    setDownloadProgress(0);
    let downloaded = 0;
    let contentLength = 0;
    try {
      await updateInfo.update.download((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setDownloadProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
          }
        }
      });
      setUpdatePhase("downloaded");
    } catch (err) {
      setUpdatePhase("available");
      setDownloadProgress(0);
      const message = err instanceof Error ? err.message : "";
      await notifyWithNavigate(t("common:downloadUpdateFailed"), message, "#/settings");
    }
  }, [updateInfo, notifyWithNavigate, t]);

  const handleInstallUpdate = useCallback(async () => {
    if (!updateInfo?.update) return;
    setUpdatePhase("installing");
    try {
      await updateInfo.update.install();
      await api.relaunchApp();
    } catch (err) {
      setUpdatePhase("downloaded");
      const message = err instanceof Error ? err.message : "";
      await notifyWithNavigate(t("common:error"), message, "#/settings");
    }
  }, [updateInfo, notifyWithNavigate, t]);

  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MainLayout>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard-insights" element={<DashboardInsights />} />
            <Route path="/vscode" element={<VsCodeInsights />} />
            <Route path="/dashboard-customize" element={<HomeCustomize />} />
            <Route path="/widgets" element={<WidgetCenter />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/limits" element={<Limits />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/focus" element={<FocusMode />} />
            <Route path="/browser" element={<BrowserUsage />} />
            <Route path="/interruptions/detail" element={<InterruptionDetail />} />
            <Route path="/widget-dev-harness" element={<WidgetDevHarness />} />
          </Routes>
        </Suspense>
      </MainLayout>

      {/* ── Update available modal ── */}
      {updateInfo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <div className="glass-card max-w-md w-full mx-4 p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="update-dialog-title" className="text-lg font-bold text-text-primary">{t("common:updateAvailableTitle")}</h2>
                <p className="text-sm text-text-secondary mt-1">{t("common:updateAvailableBody", { version: updateInfo.version, current: CURRENT_VERSION })}</p>
              </div>
              <button
                ref={updateCloseButtonRef}
                onClick={closeUpdateModal}
                aria-label={t("common:close")}
                title={t("common:close")}
                className="text-text-muted hover:text-text-primary flex-shrink-0"
              >
                ✕
              </button>
            </div>

            {updateInfo.notes && updatePhase === "available" && (
              <div className="bg-surface-light rounded-xl p-3 max-h-52 overflow-y-auto">
                <p className="text-xs font-semibold text-text-secondary mb-1">{t("common:whatsNew")}</p>
                <pre className="text-xs text-text-muted whitespace-pre-wrap font-sans leading-relaxed">{updateInfo.notes}</pre>
              </div>
            )}

            {updatePhase === "downloading" && (
              <div className="space-y-2">
                <div className="w-full bg-surface-hover rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-accent-blue h-full transition-all duration-150"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-text-muted">
                  {t("common:downloadingUpdate")}
                  {downloadProgress > 0 ? ` ${downloadProgress}%` : ""}
                </p>
              </div>
            )}

            {updatePhase === "downloaded" && (
              <p className="text-sm text-text-secondary">{t("common:updateDownloadReady")}</p>
            )}

            {updatePhase === "installing" && (
              <p className="text-sm text-text-secondary">{t("common:installingUpdate")}</p>
            )}

            <div className="flex gap-3">
              {updatePhase === "available" && updateInfo.update && (
                <button
                  onClick={handleDownloadUpdate}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-center bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30 transition-colors border border-accent-blue/30"
                >
                  {t("common:downloadUpdate")}
                </button>
              )}
              {updatePhase === "available" && !updateInfo.update && updateInfo.url && (
                <a
                  href={updateInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-center bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30 transition-colors border border-accent-blue/30"
                >
                  {t("common:viewOnGitHub")}
                </a>
              )}
              {updatePhase === "downloaded" && updateInfo.update && (
                <button
                  onClick={handleInstallUpdate}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-center bg-accent-green/20 text-accent-green hover:bg-accent-green/30 transition-colors border border-accent-green/30"
                >
                  {t("common:installUpdate")}
                </button>
              )}
              {(updatePhase === "available" || updatePhase === "downloaded") && (
                <button
                  onClick={closeUpdateModal}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-surface-border text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {updatePhase === "downloaded" ? t("common:installLater") : t("common:remindLater")}
                </button>
              )}
              {(updatePhase === "downloading" || updatePhase === "installing") && (
                <button
                  disabled
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-surface-border text-text-muted opacity-50 cursor-not-allowed"
                >
                  {updatePhase === "downloading" ? t("common:downloadingUpdate") : t("common:installingUpdate")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </HashRouter>
  );
}
