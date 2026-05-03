import { useTranslation } from "react-i18next";
import { useStatsStore } from "@/stores/statsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDashboardLayoutStore } from "@/stores/dashboardLayoutStore";
import { formatDuration } from "@/utils/format";
import { todayString } from "@/utils/format";
import { Monitor, Zap, TrendingUp, PauseCircle, Play, Pause, Code2 } from "lucide-react";
import clsx from "clsx";

export default function TodayOverview() {
  const { t } = useTranslation(["common", "dashboard"]);
  const {
    totalSecondsToday,
    currentApp,
    todayTotals,
    monitorStatus,
    setMonitorActive,
    selectedDate,
    periodMode,
    vscodeStats,
    vscodeLanguageStats,
    vscodeProjectStats,
  } = useStatsStore();
  const { setMonitoringActive } = useSettingsStore();
  const { todayOverviewCards } = useDashboardLayoutStore();
  const showCurrentApp = periodMode === "day" && selectedDate === todayString();

  const topApp = todayTotals[0];
  const toggleMonitoring = () => {
    const next = !monitorStatus.active;
    setMonitoringActive(next);
    setMonitorActive(next);
  };
  const topLanguage = vscodeLanguageStats[0];
  const topProject = vscodeProjectStats[0];
  const appNameLabel = topApp?.app_name?.trim() || t("dashboard:unknownApp");
  const langLabel = topLanguage?.language?.trim() || t("dashboard:noDataShort");
  const projectLabel = topProject?.project_name?.trim() || t("dashboard:noDataShort");

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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

      {/* Current app (today only) */}
      {showCurrentApp && (
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
      )}

      {todayOverviewCards.mostUsed && (
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 text-text-muted text-xs mb-3">
            <TrendingUp size={13} />
            <span>{t("dashboard:mostUsed")}</span>
          </div>
          <div className="text-xl font-semibold text-text-primary truncate">
            {appNameLabel}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            {topApp ? formatDuration(topApp.total_seconds) : formatDuration(0)}
          </div>
        </div>
      )}

      {todayOverviewCards.vscode && (
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 text-text-muted text-xs mb-3">
            <Code2 size={13} />
            <span>{t("dashboard:vscodeTitle")}</span>
          </div>
          <div className="text-xl font-semibold text-text-primary truncate">
            {formatDuration(vscodeStats.total_seconds)}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            {t("dashboard:vscodeSessions", { count: vscodeStats.session_count })}
          </div>
          <div className="mt-2 text-xs text-text-muted truncate">
            {t("dashboard:vscodeLang")} {topLanguage ? `${langLabel} (${formatDuration(topLanguage.total_seconds)})` : t("dashboard:noDataShort")}
          </div>
          <div className="mt-1 text-xs text-text-muted truncate" title={topProject?.project_path || ""}>
            {t("dashboard:vscodeProject")} {projectLabel}
          </div>
        </div>
      )}
    </div>
  );
}
