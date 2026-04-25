import { useTranslation } from "react-i18next";
import { useStatsStore } from "@/stores/statsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatDuration } from "@/utils/format";
import { Monitor, Zap, TrendingUp, PauseCircle, Play, Pause } from "lucide-react";
import clsx from "clsx";

export default function TodayOverview() {
  const { t } = useTranslation(["common", "dashboard"]);
  const { totalSecondsToday, currentApp, todayTotals, monitorStatus, setMonitorActive } = useStatsStore();
  const { setMonitoringActive } = useSettingsStore();

  const topApp = todayTotals[0];
  const toggleMonitoring = () => {
    const next = !monitorStatus.active;
    setMonitoringActive(next);
    setMonitorActive(next);
  };

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Total time */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 text-text-muted text-xs mb-3">
          <Monitor size={13} />
          <span>{t("dashboard:todayTotal")}</span>
        </div>
        <div className="text-3xl font-bold text-gradient mb-1">
          {formatDuration(totalSecondsToday)}
        </div>
        <div
          className={clsx(
            "flex items-center gap-1.5 text-xs",
            monitorStatus.active ? "text-accent-green" : "text-text-muted"
          )}
        >
          {monitorStatus.active ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
              {t("common:tracking")}
            </>
          ) : (
            <>
              <PauseCircle size={12} />
              {t("common:paused")}
            </>
          )}
        </div>
        <button
          onClick={toggleMonitoring}
          className={clsx(
            "mt-3 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors",
            monitorStatus.active
              ? "border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
              : "border-accent-green/40 text-accent-green hover:bg-accent-green/10"
          )}
        >
          {monitorStatus.active ? <Pause size={12} /> : <Play size={12} />}
          {monitorStatus.active ? t("common:pause") : t("common:resume")}
        </button>
      </div>

      {/* Current app */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 text-text-muted text-xs mb-3">
          <Zap size={13} />
          <span>{t("dashboard:currentApp")}</span>
        </div>
        <div className="text-xl font-semibold text-text-primary truncate">
          {currentApp || "—"}
        </div>
        <div className="text-xs text-text-muted mt-1">{t("dashboard:screenTime")}</div>
      </div>

      {/* Most used */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 text-text-muted text-xs mb-3">
          <TrendingUp size={13} />
          <span>{t("dashboard:mostUsed")}</span>
        </div>
        {topApp ? (
          <>
            <div className="text-xl font-semibold text-text-primary truncate">
              {topApp.app_name}
            </div>
            <div className="text-xs text-text-secondary mt-1">
              {formatDuration(topApp.total_seconds)}
            </div>
          </>
        ) : (
          <div className="text-text-muted text-sm">{t("common:noData")}</div>
        )}
      </div>
    </div>
  );
}
