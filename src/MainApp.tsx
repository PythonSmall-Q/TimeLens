import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { register as registerGlobalShortcut, unregisterAll as unregisterAllGlobalShortcuts } from "@tauri-apps/plugin-global-shortcut";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import MainLayout from "./components/layout/MainLayout";
import Dashboard from "./pages/Dashboard";
import WidgetCenter from "./pages/WidgetCenter";
import Settings from "./pages/Settings";
import Limits from "./pages/Limits";
import { useStatsStore } from "./stores/statsStore";
import { useSettingsStore } from "./stores/settingsStore";
import type { ActiveWindowInfo, AppLimit, LimitToast } from "./types";
import * as api from "@/services/tauriApi";
import { formatDuration } from "@/utils/format";
import { useTranslation } from "react-i18next";

const CURRENT_VERSION = "0.4.0";
const LIMIT_WARNED_KEY = "timelens-limit-warned";
const LIMIT_STORAGE_KEY = "timelens-app-limits";

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
  const { fetchToday, fetchWeekly, fetchMonitorStatus, setCurrentApp, setMonitorActive } = useStatsStore();
  const { setMonitoringActive } = useSettingsStore();
  const { t } = useTranslation(["common", "limits"]);

  const [updateInfo, setUpdateInfo] = useState<{ version: string; notes: string; url: string } | null>(null);
  const [toasts, setToasts] = useState<LimitToast[]>([]);
  const [limitModal, setLimitModal] = useState<{ appName: string; used: number; limit: number } | null>(null);

  const dismissToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const focusMainAndNavigate = useCallback(async (hash: string) => {
    const win = getCurrentWebviewWindow();
    window.location.hash = hash;
    await win.show().catch(() => {});
    await win.setFocus().catch(() => {});
  }, []);

  const notifyWithNavigate = useCallback(
    async (title: string, body: string, hash: string) => {
      let permission = "default";
      try {
        permission = (await isPermissionGranted()) ? "granted" : await requestPermission();
      } catch {
        permission = "denied";
      }
      if (permission !== "granted") return;

      if (typeof Notification !== "undefined") {
        const n = new Notification(title, { body });
        n.onclick = () => {
          void focusMainAndNavigate(hash);
        };
        return;
      }

      try {
        sendNotification({ title, body });
      } catch {
        // ignore notification failures
      }
    },
    [focusMainAndNavigate]
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
    const newToasts: LimitToast[] = [];
    let newModal: { appName: string; used: number; limit: number } | null = null;
    for (const lim of enabled) {
      const used = totals.find((u) => u.exe_path === lim.exePath)?.total_seconds ?? 0;
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
      await notifyWithNavigate(title, body, "#/limits");

      if (threshold === 100) newModal = { appName: lim.appName, used, limit: lim.dailyLimitSeconds };
      else newToasts.push({ id: Date.now() + Math.random(), appName: lim.appName, level: threshold as 80 | 90, used, limit: lim.dailyLimitSeconds });
    }
    localStorage.setItem(LIMIT_WARNED_KEY, JSON.stringify(warned));
    if (newToasts.length) setToasts((prev) => [...prev, ...newToasts]);
    if (newModal) setLimitModal(newModal);
  }, [notifyWithNavigate, t]);

  useEffect(() => {
    // Initial data load
    fetchToday();
    fetchWeekly();
    fetchMonitorStatus();

    // Refresh every 30 s + limit check every 60 s
    const interval = setInterval(() => {
      fetchToday();
      fetchMonitorStatus();
    }, 30_000);
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

    return () => {
      clearInterval(interval);
        clearInterval(limitInterval);
      unlistenPromise.then((u) => u());
      unlistenMonitor.then((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkLimits]);

  // Update check – once after 4 s
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("https://api.github.com/repos/PythonSmall-Q/TimeLens/releases/latest");
        if (!res.ok) return;
        const data = await res.json() as { tag_name?: string; body?: string; html_url?: string };
        const latest = (data.tag_name ?? "").replace(/^v/, "");
        if (latest && compareVersions(latest, CURRENT_VERSION) > 0)
          setUpdateInfo({ version: latest, notes: data.body ?? "", url: data.html_url ?? "" });
      } catch { /* offline */ }
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

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
          <Route path="/widgets" element={<WidgetCenter />} />
          <Route path="/settings" element={<Settings />} />
                  <Route path="/limits" element={<Limits />} />
        </Routes>
      </MainLayout>

      {/* ── Limit toasts (80 / 90 %) ── */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 space-y-2 max-w-xs pointer-events-none">
          {toasts.map((toast) => (
            <div key={toast.id} className="glass-card flex items-start gap-3 p-3 shadow-lg border border-surface-border animate-fade-in pointer-events-auto">
              <span className={toast.level === 90 ? "text-accent-red" : "text-yellow-400"}>⚠</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-text-primary">
                  {toast.level === 80 ? t("limits:limitReached80") : t("limits:limitReached90")}
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  {t(toast.level === 80 ? "limits:limitReached80Body" : "limits:limitReached90Body", { app: toast.appName, used: formatDuration(toast.used), limit: formatDuration(toast.limit) })}
                </p>
              </div>
              <button onClick={() => dismissToast(toast.id)} className="text-text-muted hover:text-text-primary text-xs flex-shrink-0">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Limit 100% modal ── */}
      {limitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card max-w-sm w-full mx-4 p-6 space-y-4 text-center shadow-2xl">
            <div className="text-4xl">🚨</div>
            <h2 className="text-lg font-bold text-text-primary">{t("limits:limitReached100Title")}</h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              {t("limits:limitReached100Body", { app: limitModal.appName, used: formatDuration(limitModal.used), limit: formatDuration(limitModal.limit) })}
            </p>
            <button onClick={() => setLimitModal(null)} className="w-full py-2.5 rounded-xl text-sm font-medium bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30 transition-colors border border-accent-blue/30">
              {t("limits:dismiss")}
            </button>
          </div>
        </div>
      )}

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
