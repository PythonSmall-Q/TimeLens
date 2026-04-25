import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { X, RotateCcw } from "lucide-react";
import { pad2 } from "@/utils/format";

interface Props {
  widgetId: string;
  isBlurred?: boolean;
}

export default function ClockWidget({ widgetId, isBlurred = false }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  const [time, setTime] = useState(new Date());
  const [is24h, setIs24h] = useState(() => localStorage.getItem(`${widgetId}-24h`) !== "false");
  const [isAnalog, setIsAnalog] = useState(
    () => localStorage.getItem(`${widgetId}-analog`) === "true"
  );
  const [showSeconds, setShowSeconds] = useState(
    () => localStorage.getItem(`${widgetId}-show-seconds`) !== "false"
  );

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const toggleHour = () => {
    setIs24h((v) => {
      localStorage.setItem(`${widgetId}-24h`, String(!v));
      return !v;
    });
  };

  const toggleAnalog = () => {
    setIsAnalog((v) => {
      localStorage.setItem(`${widgetId}-analog`, String(!v));
      return !v;
    });
  };

  const toggleSeconds = () => {
    setShowSeconds((v) => {
      localStorage.setItem(`${widgetId}-show-seconds`, String(!v));
      return !v;
    });
  };

  const closeWidget = () => getCurrentWebviewWindow().close();

  const h = is24h ? time.getHours() : time.getHours() % 12 || 12;
  const ampm = !is24h ? (time.getHours() < 12 ? "AM" : "PM") : "";

  const timeStr = showSeconds
    ? `${pad2(h)}:${pad2(time.getMinutes())}:${pad2(time.getSeconds())}`
    : `${pad2(h)}:${pad2(time.getMinutes())}`;
  const dateStr = time.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  // Analog clock angles
  const secDeg = time.getSeconds() * 6;
  const minDeg = time.getMinutes() * 6 + time.getSeconds() * 0.1;
  const hrDeg = (time.getHours() % 12) * 30 + time.getMinutes() * 0.5;

  return (
    <div
      className={`w-full h-full glass-card flex flex-col items-center justify-between p-4 select-none clock-widget ${isBlurred ? "clock-widget--blurred" : ""}`}
    >
      {/* Title bar / drag region */}
      <div
        data-tauri-drag-region
        className="w-full flex items-center justify-between mb-2 clock-widget__chrome"
      >
        <span className="text-text-muted text-xs">{t("clock.title")}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleAnalog}
            title={isAnalog ? t("clock.digital") : t("clock.analog")}
            className="text-text-muted hover:text-text-primary transition-colors p-1 rounded"
          >
            <RotateCcw size={12} />
          </button>
          <button
            onClick={closeWidget}
            title={t("common:close")}
            aria-label={t("common:close")}
            className="text-text-muted hover:text-accent-red transition-colors p-1 rounded"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {isAnalog ? (
        /* Analog clock */
        <svg width="120" height="120" viewBox="0 0 120 120" className="clock-widget__analog">
          <circle cx="60" cy="60" r="56" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
          {/* Hour markers */}
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i * 30 * Math.PI) / 180;
            const x1 = 60 + 48 * Math.sin(angle);
            const y1 = 60 - 48 * Math.cos(angle);
            const x2 = 60 + 52 * Math.sin(angle);
            const y2 = 60 - 52 * Math.cos(angle);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" />;
          })}
          {/* Hour hand */}
          <line x1="60" y1="60" x2={60 + 28 * Math.sin((hrDeg * Math.PI) / 180)} y2={60 - 28 * Math.cos((hrDeg * Math.PI) / 180)}
            stroke="#e8eaf0" strokeWidth="3" strokeLinecap="round" />
          {/* Minute hand */}
          <line x1="60" y1="60" x2={60 + 38 * Math.sin((minDeg * Math.PI) / 180)} y2={60 - 38 * Math.cos((minDeg * Math.PI) / 180)}
            stroke="#9ca3b0" strokeWidth="2" strokeLinecap="round" />
          {/* Second hand */}
          <line x1="60" y1="60" x2={60 + 44 * Math.sin((secDeg * Math.PI) / 180)} y2={60 - 44 * Math.cos((secDeg * Math.PI) / 180)}
            stroke="#6c8ebf" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="60" cy="60" r="3" fill="#6c8ebf" />
        </svg>
      ) : (
        /* Digital clock */
        <div className="flex flex-col items-center">
          <div className="text-5xl font-bold text-text-primary tracking-tight font-mono clock-widget__time">
            {timeStr}
            {ampm && <span className="text-xl text-text-secondary ml-1">{ampm}</span>}
          </div>
        </div>
      )}

      {/* Date & controls */}
      <div className="w-full flex items-center justify-between mt-2 clock-widget__chrome">
        <span className="text-text-secondary text-xs">{dateStr}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleSeconds}
            className="text-text-muted hover:text-accent-blue text-xs transition-colors px-1.5 py-0.5
                       rounded border border-surface-border hover:border-accent-blue"
          >
            {showSeconds ? t("clock.hideSeconds") : t("clock.showSeconds")}
          </button>
          <button
            onClick={toggleHour}
            className="text-text-muted hover:text-accent-blue text-xs transition-colors px-1.5 py-0.5
                       rounded border border-surface-border hover:border-accent-blue"
          >
            {is24h ? t("clock.switchTo12h") : t("clock.switchTo24h")}
          </button>
        </div>
      </div>
    </div>
  );
}
