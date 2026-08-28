import { useEffect, useRef, useState } from "react";
import { availableMonitors, monitorFromPoint, type Monitor } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import ClockWidget from "./ClockWidget";
import TodoWidget from "./TodoWidget";
import TimerWidget from "./TimerWidget";
import NoteWidget from "./NoteWidget";
import StatusWidget from "./StatusWidget";
import PetWidget from "./PetWidget";
import FocusCoachWidget from "./FocusCoachWidget";
import QuickCaptureWidget from "./QuickCaptureWidget";
import SessionPulseWidget from "./SessionPulseWidget";
import GoalProgressWidget from "./GoalProgressWidget";
import BrowserActivityWidget from "./BrowserActivityWidget";
import { FocusStreakWidget, LayoutSwitcherWidget, SkinPreviewWidget, WidgetHealthWidget } from "./OfficialExperienceWidgets";
import ExternalWidgetHost from "./ExternalWidgetHost";
import * as api from "@/services/tauriApi";
import { widgetSkinStorageKey } from "@/pages/WidgetCenter/widgetExperience";

interface Props {
  widgetId: string;
}

/**
 * Wrapper rendered in floating widget windows.
 * - Registers focus/blur handlers for "focus" always-on-top mode.
 * - Saves window position to DB on move.
 */
export default function WidgetWindow({ widgetId }: Props) {
  const win = getCurrentWebviewWindow();
  const positionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topModeRef = useRef<"always" | "focus" | "never">("focus");
  const [isBlurred, setIsBlurred] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  const [widgetType, setWidgetType] = useState<string>(
    widgetId.includes("-") ? widgetId.substring(0, widgetId.lastIndexOf("-")) : ""
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [paused, setPaused] = useState(false);

  const getMonitorIndexForRect = async (x: number, y: number, width: number, height: number) => {
    try {
      const target = await monitorFromPoint(x + width / 2, y + height / 2);
      if (!target) return -1;
      const monitors = await availableMonitors();
      return monitors.findIndex((monitor: Monitor) => (
        monitor.position.x === target.position.x
        && monitor.position.y === target.position.y
        && monitor.size.width === target.size.width
        && monitor.size.height === target.size.height
      ));
    } catch {
      return -1;
    }
  };

  useEffect(() => {
    const heartbeatKey = `timelens-widget-heartbeat:${widgetId}`;
    const recordHeartbeat = (event: string) => {
      try {
        localStorage.setItem(heartbeatKey, JSON.stringify({ at: new Date().toISOString(), event }));
      } catch { /* local storage may be unavailable in an isolated window */ }
    };
    recordHeartbeat("mount");

    // Load widget opacity preset once.
    api.getAllWidgets()
      .then((ws) => {
        const cfg = ws.find((w) => w.id === widgetId);
        if (cfg) {
          setWidgetType(cfg.widget_type);
          setPaused(cfg.paused ?? false);
          topModeRef.current = cfg.always_on_top_mode;
          setIsBlurred(false);
          if (cfg.always_on_top_mode === "always") {
            win.setAlwaysOnTop(true).catch(() => {});
          } else if (cfg.always_on_top_mode === "never") {
            win.setAlwaysOnTop(false).catch(() => {});
          }
        }
      })
      .catch(() => {});

    // Focus/blur behavior: optionally fade on blur while keeping it visible.
    const unlistenFocus = win.onFocusChanged(({ payload: focused }) => {
      const fadeOnBlur = localStorage.getItem("timelens-widget-fade-on-blur") !== "0";

      if (topModeRef.current === "always") {
        win.setAlwaysOnTop(true).catch(() => {});
      } else if (topModeRef.current === "never") {
        win.setAlwaysOnTop(false).catch(() => {});
      } else if (fadeOnBlur) {
        // Keep focus-mode widgets visible when unfocused so opacity transition is meaningful.
        win.setAlwaysOnTop(true).catch(() => {});
      } else {
        win.setAlwaysOnTop(focused).catch(() => {});
      }

      if (fadeOnBlur) {
        setIsBlurred(!focused);
      } else {
        setIsBlurred(false);
      }
    });

    const restoreOnMouseDown = () => {
      setIsBlurred(false);
      if (topModeRef.current !== "never") {
        win.setAlwaysOnTop(true).catch(() => {});
      }
    };
    window.addEventListener("mousedown", restoreOnMouseDown);

    // Persist position when window stops moving (debounced)
    const unlistenMove = win.onMoved(({ payload: pos }) => {
      if (positionSaveTimer.current) clearTimeout(positionSaveTimer.current);
      positionSaveTimer.current = setTimeout(async () => {
        try {
          const size = await win.innerSize();
          const config = await api.getAllWidgets().then((ws) =>
            ws.find((w) => w.id === widgetId)
          );
          if (config) {
            const monitorIndex = await getMonitorIndexForRect(pos.x, pos.y, size.width, size.height);
            await api.saveWidgetConfig({
              ...config,
              monitor_index: monitorIndex,
              x: pos.x,
              y: pos.y,
              width: size.width,
              height: size.height,
            });
          }
        } catch { /* ignore */ }
      }, 600);
    });

    return () => {
      unlistenFocus.then((u) => u());
      unlistenMove.then((u) => u());
      window.removeEventListener("mousedown", restoreOnMouseDown);
      if (positionSaveTimer.current) clearTimeout(positionSaveTimer.current);
    };
  }, [widgetId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const heartbeatKey = `timelens-widget-heartbeat:${widgetId}`;
    const recordHeartbeat = (event: string) => {
      try {
        localStorage.setItem(heartbeatKey, JSON.stringify({ at: new Date().toISOString(), event }));
      } catch { /* local storage may be unavailable in an isolated window */ }
    };
    listen<{ widgetId?: string }>("timelens-widget-refresh", (event) => {
      if (!event.payload?.widgetId || event.payload.widgetId === widgetId) {
        recordHeartbeat("refresh");
        setRefreshKey((value) => value + 1);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    }).catch(() => {});
    const affectedEvents: Record<string, string[]> = {
      "focus-session-changed": ["clock", "timer", "focus-coach", "session-pulse", "status"],
      "goal-tick": ["goal-progress", "status", "session-pulse"],
      "active-window-changed": ["status", "browser-activity", "session-pulse"],
      "todo-changed": ["todo", "quick-capture", "status"],
    };
    const eventCleanups: Promise<() => void>[] = Object.entries(affectedEvents).map(([eventName, types]) => (
      listen(eventName, () => {
        if (types.includes(widgetType)) {
          recordHeartbeat(eventName);
          setRefreshKey((value) => value + 1);
        }
      })
    ));
    Promise.all(eventCleanups).catch(() => {});
    return () => {
      unlisten?.();
      eventCleanups.forEach((cleanup) => cleanup.then((cleanupEvent) => cleanupEvent()).catch(() => {}));
    };
  }, [widgetId, widgetType]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (image: string) => root.style.setProperty("--timelens-widget-instance-background-image", image ? `url("${image}")` : "none");
    apply(localStorage.getItem(widgetSkinStorageKey(widgetId)) ?? "");
    let unlisten: (() => void) | undefined;
    listen<{ widgetId?: string; image?: string }>("timelens-widget-skin-changed", (event) => {
      if (event.payload?.widgetId === widgetId) apply(event.payload.image ?? "");
    }).then((cleanup) => { unlisten = cleanup; }).catch(() => {});
    return () => unlisten?.();
  }, [widgetId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!paused) {
        try {
          localStorage.setItem(`timelens-widget-heartbeat:${widgetId}`, JSON.stringify({ at: new Date().toISOString(), event: "poll" }));
        } catch { /* ignore unavailable storage */ }
        setRefreshKey((value) => value + 1);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [paused, widgetId]);

  const handleMouseEnter = () => {
    clearTimeout(idleTimer.current);
    setIdle(false);
  };

  const handleMouseLeave = () => {
    idleTimer.current = setTimeout(() => setIdle(true), 2000);
  };

  // Cleanup idle timer on unmount
  useEffect(() => {
    return () => clearTimeout(idleTimer.current);
  }, []);

  return (
    <div
      className={`widget-root ${isBlurred && widgetType !== "clock" ? "widget-root--faded" : ""} ${idle ? "widget-idle" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {widgetType === "clock" && <ClockWidget key={refreshKey} widgetId={widgetId} isBlurred={isBlurred} />}
      {widgetType === "todo" && <TodoWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "timer" && <TimerWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "note" && <NoteWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "status" && <StatusWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "pet" && <PetWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "focus-coach" && <FocusCoachWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "quick-capture" && <QuickCaptureWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "session-pulse" && <SessionPulseWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "goal-progress" && <GoalProgressWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "browser-activity" && <BrowserActivityWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "skin-preview" && <SkinPreviewWidget key={refreshKey} />}
      {widgetType === "layout-switcher" && <LayoutSwitcherWidget key={refreshKey} />}
      {widgetType === "widget-health" && <WidgetHealthWidget key={refreshKey} widgetId={widgetId} />}
      {widgetType === "focus-streak" && <FocusStreakWidget key={refreshKey} />}
      {widgetType !== "clock"
        && widgetType !== "todo"
        && widgetType !== "timer"
        && widgetType !== "note"
        && widgetType !== "status"
        && widgetType !== "pet"
        && widgetType !== "focus-coach"
        && widgetType !== "quick-capture"
        && widgetType !== "session-pulse"
        && widgetType !== "goal-progress"
        && widgetType !== "browser-activity"
        && widgetType !== "skin-preview"
        && widgetType !== "layout-switcher"
        && widgetType !== "widget-health"
        && widgetType !== "focus-streak"
        && <ExternalWidgetHost key={refreshKey} widgetId={widgetId} widgetType={widgetType} />}
    </div>
  );
}
