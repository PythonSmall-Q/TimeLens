import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import MainLayout from "./components/layout/MainLayout";
import Dashboard from "./pages/Dashboard";
import WidgetCenter from "./pages/WidgetCenter";
import Settings from "./pages/Settings";
import { useStatsStore } from "./stores/statsStore";
import { useSettingsStore } from "./stores/settingsStore";
import type { ActiveWindowInfo } from "./types";
import * as api from "@/services/tauriApi";

export default function MainApp() {
  const { fetchToday, fetchWeekly, fetchMonitorStatus, setCurrentApp, setMonitorActive } = useStatsStore();
  const { setMonitoringActive } = useSettingsStore();

  useEffect(() => {
    // Initial data load
    fetchToday();
    fetchWeekly();
    fetchMonitorStatus();

    // Refresh every 30 s
    const interval = setInterval(() => {
      fetchToday();
      fetchMonitorStatus();
    }, 30_000);

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
      unlistenPromise.then((u) => u());
      unlistenMonitor.then((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let mounted = true;
    let removeKeydown: (() => void) | null = null;
    let removeShortcutChanged: (() => void) | null = null;

    const normalize = (s: string) =>
      s
        .split("+")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const low = x.toLowerCase();
          if (low === "control" || low === "ctrl") return "Ctrl";
          if (low === "alt" || low === "option") return "Alt";
          if (low === "shift") return "Shift";
          if (low === "meta" || low === "cmd" || low === "command") return "Meta";
          return x.length === 1 ? x.toUpperCase() : x[0].toUpperCase() + x.slice(1).toLowerCase();
        })
        .join("+");

    const eventToCombo = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Meta");
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
        parts.push(key);
      }
      return parts.join("+");
    };

    const toggleWidgets = async () => {
      const all = await getAllWebviewWindows();
      const widgets = all.filter((w) => /^(clock|todo|timer|note|status)-/.test(w.label));
      const visibleFlags = await Promise.all(
        widgets.map((w) => w.isVisible().catch(() => false))
      );
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
      } else {
        const configs = await api.getAllWidgets();
        await Promise.all(configs.map((cfg) => api.openWidget(cfg).catch(() => {})));
      }
    };

    const init = async () => {
      const settings = await api.getAppSettings().catch(() => null);
      if (!mounted || !settings) return;
      let shortcutMap = {
        openWidgetCenter: normalize(settings.shortcuts.open_widget_center),
        toggleWidgetVisibility: normalize(settings.shortcuts.toggle_widget_visibility),
        startRecording: normalize(settings.shortcuts.start_recording),
        pauseRecording: normalize(settings.shortcuts.pause_recording),
      };

      const onKeyDown = async (e: KeyboardEvent) => {
        const combo = eventToCombo(e);
        const win = getCurrentWebviewWindow();
        if (combo === shortcutMap.openWidgetCenter) {
          e.preventDefault();
          window.location.hash = "#/widgets";
          await win.show().catch(() => {});
          await win.setFocus().catch(() => {});
        } else if (combo === shortcutMap.toggleWidgetVisibility) {
          e.preventDefault();
          await toggleWidgets().catch(() => {});
        } else if (combo === shortcutMap.startRecording) {
          e.preventDefault();
          setMonitoringActive(true);
          setMonitorActive(true);
        } else if (combo === shortcutMap.pauseRecording) {
          e.preventDefault();
          setMonitoringActive(false);
          setMonitorActive(false);
        }
      };

      window.addEventListener("keydown", onKeyDown);
      removeKeydown = () => window.removeEventListener("keydown", onKeyDown);

      const onShortcutChanged = (e: Event) => {
        const ce = e as CustomEvent<{
          open_widget_center: string;
          toggle_widget_visibility: string;
          start_recording: string;
          pause_recording: string;
        }>;
        if (!ce.detail) return;
        shortcutMap = {
          openWidgetCenter: normalize(ce.detail.open_widget_center),
          toggleWidgetVisibility: normalize(ce.detail.toggle_widget_visibility),
          startRecording: normalize(ce.detail.start_recording),
          pauseRecording: normalize(ce.detail.pause_recording),
        };
      };

      window.addEventListener("timelens-shortcuts-changed", onShortcutChanged);
      removeShortcutChanged = () =>
        window.removeEventListener("timelens-shortcuts-changed", onShortcutChanged);
    };

    init();

    return () => {
      mounted = false;
      if (removeKeydown) removeKeydown();
      if (removeShortcutChanged) removeShortcutChanged();
    };
  }, [setMonitoringActive, setMonitorActive]);

  return (
    <HashRouter>
      <MainLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/widgets" element={<WidgetCenter />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </MainLayout>
    </HashRouter>
  );
}
