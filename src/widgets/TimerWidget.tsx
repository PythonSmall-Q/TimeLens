import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { X, Play, Pause, RotateCcw } from "lucide-react";
import { pad2 } from "@/utils/format";
import clsx from "clsx";

type Mode = "pomodoro" | "countdown" | "stopwatch";
type Phase = "work" | "break";

const POMODORO_WORK = 25 * 60;
const POMODORO_BREAK = 5 * 60;

interface Props {
  widgetId: string;
}

export default function TimerWidget({ widgetId: _widgetId }: Props) {
  const { t } = useTranslation("widgets");
  const [mode, setMode] = useState<Mode>("pomodoro");
  const [phase, setPhase] = useState<Phase>("work");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);       // for stopwatch
  const [remaining, setRemaining] = useState(POMODORO_WORK); // for countdown/pomodoro
  const [customMin, setCustomMin] = useState(10);
  const [notification, setNotification] = useState("");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const ensureWindowSize = async () => {
      try {
        const win = getCurrentWebviewWindow();
        await win.setMinSize(new LogicalSize(320, 280));
        const size = await win.innerSize();
        const targetW = Math.max(size.width, 360);
        const targetH = Math.max(size.height, 320);
        if (targetW !== size.width || targetH !== size.height) {
          await win.setSize(new LogicalSize(targetW, targetH));
        }
      } catch {
        // No-op: widget still works even if resize API is unavailable.
      }
    };

    ensureWindowSize();
  }, []);

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const reset = useCallback(() => {
    clearTimer();
    setRunning(false);
    setElapsed(0);
    setNotification("");
    if (mode === "pomodoro") setRemaining(phase === "work" ? POMODORO_WORK : POMODORO_BREAK);
    else if (mode === "countdown") setRemaining(customMin * 60);
    else setElapsed(0);
  }, [mode, phase, customMin]);

  useEffect(() => {
    reset();
  }, [mode, phase]);

  useEffect(() => {
    if (!running) {
      clearTimer();
      return;
    }

    intervalRef.current = setInterval(() => {
      if (mode === "stopwatch") {
        setElapsed((e) => e + 1);
      } else {
        setRemaining((r) => {
          if (r <= 1) {
            clearTimer();
            setRunning(false);
            if (mode === "pomodoro") {
              const nextPhase: Phase = phase === "work" ? "break" : "work";
              setNotification(
                phase === "work" ? t("timer.pomodoroComplete") : t("timer.breakComplete")
              );
              setTimeout(() => {
                setPhase(nextPhase);
                setNotification("");
              }, 4000);
            } else {
              setNotification("Time's up!");
            }
            return 0;
          }
          return r - 1;
        });
      }
    }, 1000);

    return clearTimer;
  }, [running, mode, phase, t]);

  const toggle = () => setRunning((r) => !r);

  const displaySeconds = mode === "stopwatch" ? elapsed : remaining;
  const h = Math.floor(displaySeconds / 3600);
  const m = Math.floor((displaySeconds % 3600) / 60);
  const s = displaySeconds % 60;
  const timeStr = h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;

  const maxSec =
    mode === "pomodoro"
      ? phase === "work" ? POMODORO_WORK : POMODORO_BREAK
      : mode === "countdown"
      ? customMin * 60
      : null;

  const progress =
    maxSec && maxSec > 0
      ? Math.round(((maxSec - remaining) / maxSec) * 100)
      : null;

  const TABS: { label: string; value: Mode }[] = [
    { label: t("timer.pomodoro"), value: "pomodoro" },
    { label: t("timer.countdown"), value: "countdown" },
    { label: t("timer.stopwatch"), value: "stopwatch" },
  ];

  return (
    <div className="w-full h-full glass-card flex flex-col p-3 select-none overflow-hidden">
      {/* Drag + close */}
      <div data-tauri-drag-region className="flex items-center justify-between mb-2">
        <span className="text-text-muted text-xs">{t("timer.title")}</span>
        <button
          onClick={() => getCurrentWebviewWindow().close()}
          className="text-text-muted hover:text-accent-red transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 mb-2 bg-surface-hover rounded-lg p-1">
        {TABS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={clsx(
              "flex-1 text-xs py-1 rounded-md transition-colors",
              mode === value
                ? "bg-accent-blue text-white font-medium"
                : "text-text-muted hover:text-text-secondary"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Phase for pomodoro */}
      {mode === "pomodoro" && (
        <div className="flex gap-2 mb-2 justify-center">
          {(["work", "break"] as Phase[]).map((p) => (
            <button
              key={p}
              onClick={() => setPhase(p)}
              className={clsx(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                phase === p
                  ? "border-accent-blue text-accent-blue"
                  : "border-surface-border text-text-muted hover:text-text-secondary"
              )}
            >
              {p === "work" ? t("timer.workTime") : t("timer.breakTime")}
            </button>
          ))}
        </div>
      )}

      {/* Custom duration for countdown */}
      {mode === "countdown" && !running && remaining === customMin * 60 && (
        <div className="flex items-center gap-2 mb-2 justify-center">
          <input
            type="number"
            min={1}
            max={999}
            value={customMin}
            onChange={(e) => {
              setCustomMin(Number(e.target.value));
              setRemaining(Number(e.target.value) * 60);
            }}
            className="ui-field w-20 text-center"
            title={t("timer.minutes")}
            aria-label={t("timer.minutes")}
          />
          <span className="text-text-muted text-xs">{t("timer.minutes")}</span>
        </div>
      )}

      {/* Main time display */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
        {/* Progress ring */}
        {progress !== null && (
          <div className="relative mb-1">
            <svg width="108" height="108" className="-rotate-90">
              <circle cx="54" cy="54" r="46" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
              <circle
                cx="54" cy="54" r="46" fill="none"
                stroke={phase === "break" ? "#4caf7d" : "#6c8ebf"}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 46}`}
                strokeDashoffset={`${2 * Math.PI * 46 * (1 - progress / 100)}`}
                style={{ transition: "stroke-dashoffset 0.8s linear" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[1.4rem] font-bold font-mono text-text-primary">{timeStr}</span>
            </div>
          </div>
        )}
        {progress === null && (
          <span className="text-3xl font-bold font-mono text-text-primary mb-2 widget-prominent">{timeStr}</span>
        )}

        {notification && (
          <p className="text-xs text-accent-green text-center px-2 mt-1">{notification}</p>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2.5 mt-1 pt-1 shrink-0">
        <button
          onClick={reset}
          className="p-2 rounded-full text-text-muted hover:text-text-primary
                     hover:bg-surface-hover transition-colors"
        >
            <RotateCcw size={14} />
        </button>
        <button
          onClick={toggle}
          className="px-5 py-1.5 rounded-full bg-accent-blue hover:bg-accent-glow
                     text-white text-sm font-medium transition-colors flex items-center gap-1.5"
        >
          {running ? <Pause size={13} /> : <Play size={13} />}
          {running ? t("timer.pause") : t("timer.start")}
        </button>
      </div>
    </div>
  );
}
