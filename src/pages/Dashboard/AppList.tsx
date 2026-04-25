import { useTranslation } from "react-i18next";
import { useStatsStore } from "@/stores/statsStore";
import { formatDuration, appColor } from "@/utils/format";

export default function AppList() {
  const { t } = useTranslation("dashboard");
  const { todayTotals, totalSecondsToday } = useStatsStore();

  if (todayTotals.length === 0) {
    return (
      <p className="text-text-muted text-sm text-center py-8">{t("noActivity")}</p>
    );
  }

  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-medium text-text-secondary mb-4">{t("allApps")}</h3>
      <div className="space-y-3">
        {todayTotals.map((app, idx) => {
          const pct = totalSecondsToday > 0
            ? Math.round((app.total_seconds / totalSecondsToday) * 100)
            : 0;
          const color = appColor(app.app_name);
          return (
            <div key={app.app_name} className="group">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-text-muted text-xs w-5 text-right flex-shrink-0">
                    {idx + 1}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className="text-sm text-text-primary truncate"
                    title={app.exe_path || app.app_name}
                  >
                    {app.app_name}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                  <span className="text-xs text-text-secondary">{pct}%</span>
                  <span className="text-sm font-medium text-text-primary w-16 text-right">
                    {formatDuration(app.total_seconds)}
                  </span>
                </div>
              </div>
              <div className="h-1 bg-surface-hover rounded-full overflow-hidden ml-7">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.7 }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
