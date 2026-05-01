import { useEffect, useRef, useState } from "react";
import { availableMonitors, monitorFromPoint, type Monitor } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import ClockWidget from "./ClockWidget";
import TodoWidget from "./TodoWidget";
import TimerWidget from "./TimerWidget";
import NoteWidget from "./NoteWidget";
import StatusWidget from "./StatusWidget";
import * as api from "@/services/tauriApi";

interface Props {
  widgetId: string;
  widgetType: "clock" | "todo" | "timer" | "note" | "status";
}

/**
 * Wrapper rendered in floating widget windows.
 * - Registers focus/blur handlers for "focus" always-on-top mode.
 * - Saves window position to DB on move.
 */
export default function WidgetWindow({ widgetId, widgetType }: Props) {
  const win = getCurrentWebviewWindow();
  const positionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topModeRef = useRef<"always" | "focus" | "never">("focus");
  const [isBlurred, setIsBlurred] = useState(false);

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
    // Load widget opacity preset once.
    api.getAllWidgets()
      .then((ws) => {
        const cfg = ws.find((w) => w.id === widgetId);
        if (cfg) {
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
        } catch (_) {}
      }, 600);
    });

    return () => {
      unlistenFocus.then((u) => u());
      unlistenMove.then((u) => u());
      window.removeEventListener("mousedown", restoreOnMouseDown);
      if (positionSaveTimer.current) clearTimeout(positionSaveTimer.current);
    };
  }, [widgetId]);

  return (
    <div
      className={`widget-root ${isBlurred && widgetType !== "clock" ? "widget-root--faded" : ""}`}
    >
      {widgetType === "clock" && <ClockWidget widgetId={widgetId} isBlurred={isBlurred} />}
      {widgetType === "todo" && <TodoWidget widgetId={widgetId} />}
      {widgetType === "timer" && <TimerWidget widgetId={widgetId} />}
      {widgetType === "note" && <NoteWidget widgetId={widgetId} />}
      {widgetType === "status" && <StatusWidget widgetId={widgetId} />}
    </div>
  );
}
