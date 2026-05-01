import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Focus, Play, Square, Clock } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { FocusSession } from "@/types";
import clsx from "clsx";

function durationLabel(started: string, ended: string | null): string {
  const s = new Date(started).getTime();
  const e = ended ? new Date(ended).getTime() : Date.now();
  const secs = Math.max(0, Math.floor((e - s) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function FocusModePage() {
  const { t } = useTranslation(["focus", "common"]);
  const [active, setActive] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [tick, setTick] = useState(0);

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const [isActive, history] = await Promise.all([
        api.getFocusModeActive(),
        api.listFocusSessions(),
      ]);
      setActive(isActive);
      setSessions(history);
      const open = history.find((s) => s.ended_at == null);
      setActiveSessionId(open?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadState(); }, [loadState]);

  // Live timer tick every second while active
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [active]);

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (!active) {
        const id = await api.startFocusSession(undefined, "manual");
        await api.setFocusModeActive(true);
        setActive(true);
        setActiveSessionId(id);
      } else {
        if (activeSessionId != null) {
          await api.stopFocusSession(activeSessionId);
        }
        await api.setFocusModeActive(false);
        setActive(false);
        setActiveSessionId(null);
        await loadState();
      }
    } finally {
      setToggling(false);
    }
  };

  const activeSession = sessions.find((s) => s.ended_at == null);
  const pastSessions = sessions.filter((s) => s.ended_at != null);

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <Focus size={22} className="text-accent-purple" />
          {t("focus:title")}
        </h1>
        <p className="text-text-secondary text-sm mt-1">{t("focus:subtitle")}</p>
      </div>

      {/* Toggle card */}
      <div className={clsx(
        "glass-card p-6 flex items-center gap-5 transition-all",
        active && "ring-2 ring-accent-purple/40"
      )}>
        <div className={clsx(
          "w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-colors",
          active ? "bg-accent-purple" : "bg-surface-hover"
        )}>
          <Focus size={26} className={active ? "text-white" : "text-text-muted"} />
        </div>
        <div className="flex-1">
          <p className="text-base font-semibold text-text-primary">
            {active ? t("focus:activeTitle") : t("focus:inactiveTitle")}
          </p>
          {active && activeSession ? (
            <p className="text-sm text-text-secondary mt-0.5">
              <Clock size={12} className="inline mr-1" />
              {/* tick used to force re-render */}
              {durationLabel(activeSession.started_at, null)}
              {/* eslint-disable-next-line @typescript-eslint/no-unused-expressions */}
              {void tick}
            </p>
          ) : (
            <p className="text-sm text-text-secondary mt-0.5">{t("focus:hint")}</p>
          )}
        </div>
        <button
          className={clsx(
            "flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-colors",
            active
              ? "bg-accent-red/20 text-accent-red hover:bg-accent-red/30"
              : "btn-primary"
          )}
          onClick={handleToggle}
          disabled={toggling || loading}
        >
          {active ? <Square size={14} /> : <Play size={14} />}
          {active ? t("focus:stop") : t("focus:start")}
        </button>
      </div>

      {/* Session history */}
      <div>
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          {t("focus:history")}
        </h2>
        <div className="glass-card divide-y divide-surface-border">
          {loading ? (
            <div className="p-6 text-center text-text-muted text-sm">{t("common:loading")}</div>
          ) : pastSessions.length === 0 ? (
            <div className="p-6 text-center text-text-muted text-sm">{t("focus:noHistory")}</div>
          ) : (
            pastSessions.slice(0, 20).map((s, i) => (
              <div key={s.id ?? i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-accent-purple/10 flex items-center justify-center flex-shrink-0">
                  <Focus size={14} className="text-accent-purple" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary">
                    {new Date(s.started_at).toLocaleString()}
                  </p>
                  <p className="text-xs text-text-muted">
                    {s.trigger_type === "manual" ? t("focus:triggerManual") : t("focus:triggerAuto")}
                    {s.reason ? ` · ${s.reason}` : ""}
                  </p>
                </div>
                <span className="text-sm text-text-secondary font-mono">
                  {durationLabel(s.started_at, s.ended_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
