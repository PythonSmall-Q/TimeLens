import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { X, Activity } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { FocusSession, HourlyDistribution, InterruptionPeriod } from "@/types";
import { todayString } from "@/utils/format";
import { useWidgetClient } from "@/hooks/useWidgetClient";
import clsx from "clsx";

interface Props {
  widgetId: string;
}

export default function SessionPulseWidget({ widgetId }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  const client = useWidgetClient({ widgetId, widgetType: "session-pulse" });
  const today = todayString();
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [hourly, setHourly] = useState<HourlyDistribution[]>([]);
  const [interruptions, setInterruptions] = useState<InterruptionPeriod[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, h, i] = await Promise.all([
          client.query<FocusSession[]>("sessions", { start_at: `${today}T00:00:00`, end_at: `${today}T23:59:59` }),
          api.getTodayHourly(),
          api.getInterruptionPeriods(today),
        ]);
        setSessions(s);
        setHourly(h);
        setInterruptions(i);
      } catch {
        // Keep current state on error.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [client, today]);

  const maxHourly = useMemo(
    () => Math.max(1, ...hourly.map((h) => h.seconds)),
    [hourly]
  );

  const totalFocusSeconds = useMemo(() => {
    const now = new Date();
    return sessions.reduce((sum, s) => {
      const start = new Date(s.started_at).getTime();
      const end = s.ended_at ? new Date(s.ended_at).getTime() : now.getTime();
      return sum + Math.max(0, end - start) / 1000;
    }, 0);
  }, [sessions]);

  const totalInterruptions = useMemo(
    () => interruptions.reduce((sum, i) => sum + i.switch_count, 0),
    [interruptions]
  );

  return (
    <div className="w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden">
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-text-muted text-xs">
          <Activity size={13} />
          <span>{t("sessionPulse.title")}</span>
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

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-2.5 text-center">
          <div className="text-[11px] text-text-muted uppercase tracking-wider">
            {t("sessionPulse.focusTime")}
          </div>
          <div className="text-base font-semibold text-text-primary mt-0.5">
            {Math.round(totalFocusSeconds / 60)}m
          </div>
        </div>
        <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-2.5 text-center">
          <div className="text-[11px] text-text-muted uppercase tracking-wider">
            {t("sessionPulse.interruptions")}
          </div>
          <div className="text-base font-semibold text-text-primary mt-0.5">
            {totalInterruptions}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="text-[11px] text-text-muted uppercase tracking-wider mb-2">
          {t("sessionPulse.hourlyBreakdown")}
        </div>
        <div className="flex-1 min-h-0 flex items-end gap-1">
          {hourly.length === 0 ? (
            <p className="text-xs text-text-muted w-full text-center py-4">
              {t("sessionPulse.empty")}
            </p>
          ) : (
            hourly.map((h) => {
              const pct = Math.max(4, (h.seconds / maxHourly) * 100);
              return (
                <div key={h.hour} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div
                    className={clsx(
                      "w-full rounded-t-md transition-all",
                      h.seconds > 0 ? "bg-accent-blue/60" : "bg-surface-border"
                    )}
                    style={{ height: `${pct}%` }}
                    title={`${h.hour}:00 — ${Math.round(h.seconds / 60)}m`}
                  />
                  <span className="text-[9px] text-text-muted">{h.hour}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-surface-border">
        <div className="text-[11px] text-text-muted uppercase tracking-wider mb-1.5">
          {t("sessionPulse.sessions")}
        </div>
        <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
          {sessions.length === 0 ? (
            <p className="text-xs text-text-muted">{t("sessionPulse.noSessions")}</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id ?? s.started_at}
                className="flex items-center justify-between text-xs px-2 py-1 rounded-lg border border-surface-border"
              >
                <span className="text-text-secondary">
                  {new Date(s.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span
                  className={clsx(
                    "text-[10px] px-1.5 py-0.5 rounded-full",
                    s.ended_at
                      ? "bg-surface-hover text-text-muted"
                      : "bg-accent-blue/15 text-accent-blue"
                  )}
                >
                  {s.ended_at ? t("sessionPulse.done") : t("sessionPulse.active")}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
