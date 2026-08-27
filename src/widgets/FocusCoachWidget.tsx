import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { X, Play, Square, Target, Zap, AlertCircle } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { FocusSession } from "@/types";
import { formatDuration, todayString } from "@/utils/format";
import { useWidgetErrorReporter } from "@/hooks/useWidgetErrorReporter";
import { useWidgetClient } from "@/hooks/useWidgetClient";
import clsx from "clsx";

interface Props {
  widgetId: string;
}

function sessionSeconds(session: FocusSession, now: Date): number {
  const start = parseLocalDateTime(session.started_at).getTime();
  const end = session.ended_at ? parseLocalDateTime(session.ended_at).getTime() : now.getTime();
  return Math.max(0, Math.floor((end - start) / 1000));
}

function parseLocalDateTime(dt: string): Date {
  // Backend stores local datetimes as "YYYY-MM-DDTHH:MM:SS" without a timezone.
  // Parsing that directly with new Date() can interpret it as UTC and shift by
  // the user's UTC offset, producing negative durations. Build the Date from
  // explicit local components instead.
  const [datePart, timePart] = dt.split("T");
  const [y, m, d] = datePart.split("-").map((v) => Number(v));
  const [h, min, s] = (timePart ?? "00:00:00").split(":").map((v) => Number(v));
  return new Date(y, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0, s ?? 0);
}

export default function FocusCoachWidget({ widgetId }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  useWidgetErrorReporter(widgetId);
  const client = useWidgetClient({ widgetId, widgetType: "focus-coach" });

  const [activeSession, setActiveSession] = useState<FocusSession | null>(null);
  const [todaySessions, setTodaySessions] = useState<FocusSession[]>([]);
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayString();

  const refresh = useCallback(async () => {
    try {
      const sessions = await client.query<FocusSession[]>("sessions", {
        start_at: `${today}T00:00:00`,
        end_at: `${today}T23:59:59`,
      });
      setTodaySessions(sessions);
      setActiveSession(sessions.find((s) => !s.ended_at) ?? null);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, [client, today]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Keep the widget in sync when focus is started/stopped by rules or other surfaces.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      try {
        unlisten = await api.listenWidgetEvent<{ session_id?: number; active: boolean }>(
          "focus-session-changed",
          () => {
            void refresh();
          }
        );
      } catch {
        // Older runtimes may not expose widget events; refresh interval covers it.
      }
    };
    void setup();
    return () => {
      unlisten?.();
    };
  }, [refresh]);

  const todaySeconds = useMemo(
    () => todaySessions.reduce((sum, s) => sum + sessionSeconds(s, now), 0),
    [todaySessions, now]
  );

  const activeSeconds = useMemo(() => {
    if (!activeSession) return 0;
    return Math.max(
      0,
      Math.floor((now.getTime() - parseLocalDateTime(activeSession.started_at).getTime()) / 1000)
    );
  }, [activeSession, now]);

  const handleToggle = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      if (activeSession?.id != null) {
        await api.stopFocusSession(activeSession.id);
        setActiveSession(null);
      } else {
        const reason = t("focusCoach.manualReason");
        const id = await api.startFocusSession(reason, "manual");
        const startedAt = new Date().toISOString();
        setActiveSession({
          id,
          started_at: startedAt,
          ended_at: null,
          trigger_type: "manual",
          reason,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      // Re-sync with backend state so the button label is never misleading.
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const buttonLabel = activeSession ? t("focusCoach.stop") : t("focusCoach.start");
  const buttonIcon = activeSession ? <Square size={14} /> : <Play size={14} />;

  return (
    <div className="w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden">
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-text-muted text-xs">
          <Target size={13} />
          <span>{t("focusCoach.title")}</span>
        </div>
        <button
          onClick={() => getCurrentWebviewWindow().close()}
          className="text-text-muted hover:text-accent-red transition-colors"
          title={t("common:close")}
          aria-label={t("common:close")}
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div
          className={clsx(
            "w-20 h-20 rounded-2xl flex items-center justify-center border transition-colors",
            activeSession
              ? "bg-accent-blue/15 border-accent-blue/40 text-accent-blue"
              : "bg-surface-hover border-surface-border text-text-muted"
          )}
        >
          <Zap size={32} />
        </div>

        <div className="text-center">
          <div
            className={clsx(
              "text-sm font-medium",
              activeSession ? "text-accent-blue" : "text-text-secondary"
            )}
          >
            {activeSession ? t("focusCoach.focusActive") : t("focusCoach.focusInactive")}
          </div>
          {activeSession && (
            <div className="text-3xl font-bold text-text-primary font-mono mt-1 widget-prominent">
              {formatDuration(activeSeconds)}
            </div>
          )}
        </div>

        <div className="w-full grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3 text-center">
            <div className="text-[11px] text-text-muted uppercase tracking-wider">
              {t("focusCoach.todayTotal")}
            </div>
            <div className="text-lg font-semibold text-text-primary mt-0.5">
              {formatDuration(todaySeconds)}
            </div>
          </div>
          <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3 text-center">
            <div className="text-[11px] text-text-muted uppercase tracking-wider">
              {t("focusCoach.sessions")}
            </div>
            <div className="text-lg font-semibold text-text-primary mt-0.5">
              {todaySessions.length}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-accent-red/10 border border-accent-red/20 px-3 py-2 text-xs text-accent-red">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <button
        onClick={handleToggle}
        disabled={loading}
        className={clsx(
          "mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors",
          activeSession
            ? "bg-accent-red/15 text-accent-red hover:bg-accent-red/25"
            : "bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25",
          loading && "opacity-70 cursor-wait"
        )}
      >
        {loading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : buttonIcon}
        {buttonLabel}
      </button>
    </div>
  );
}
