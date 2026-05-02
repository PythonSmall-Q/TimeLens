import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RotateCcw, Undo2, Trash2 } from "lucide-react";
import { DASHBOARD_WINDOW_IDS, type DashboardWindowId, useDashboardLayoutStore } from "@/stores/dashboardLayoutStore";

const WINDOW_LABEL_KEY: Record<DashboardWindowId, string> = {
  goalProgress: "dashboard:windowGoalProgress",
  todayOverview: "dashboard:windowTodayOverview",
  productivity: "dashboard:windowProductivity",
  appRanking: "dashboard:windowAppRanking",
  hourlyTimeline: "dashboard:windowHourlyTimeline",
  categoryInsights: "dashboard:windowCategoryInsights",
  usageHeatmap: "dashboard:windowUsageHeatmap",
  trendCompare: "dashboard:windowTrendCompare",
  appList: "dashboard:windowAppList",
  avgDailyUsage: "dashboard:windowAvgDailyUsage",
  weeklyCompare: "dashboard:windowWeeklyCompare",
};

export default function HomeCustomize() {
  const navigate = useNavigate();
  const { t } = useTranslation(["common", "dashboard"]);
  const { layout, hideWindow, restoreWindow, restoreDefault } = useDashboardLayoutStore();

  const hiddenCount = useMemo(() => layout.filter((item) => !item.visible).length, [layout]);

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("dashboard:customizeTitle")}</h1>
          <p className="text-text-muted text-xs mt-1">{t("dashboard:customizeDesc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={restoreDefault}
            className="ui-btn-secondary !text-xs !px-3 !py-2 inline-flex items-center gap-1.5"
            title={t("dashboard:restoreDefault")}
          >
            <RotateCcw size={14} />
            {t("dashboard:restoreDefault")}
          </button>
          <button
            onClick={() => navigate("/dashboard")}
            className="ui-btn-primary !text-xs !px-3 !py-2"
          >
            {t("dashboard:backToDashboard")}
          </button>
        </div>
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary">{t("dashboard:manageWindows")}</h2>
          <span className="text-xs text-text-muted">
            {t("dashboard:hiddenCount", { count: hiddenCount, total: DASHBOARD_WINDOW_IDS.length })}
          </span>
        </div>

        <div className="space-y-2">
          {layout.map((item, idx) => (
            <VisibilityRow
              key={item.id}
              idx={idx}
              label={t(WINDOW_LABEL_KEY[item.id])}
              visible={item.visible}
              onHide={() => hideWindow(item.id)}
              onRestore={() => restoreWindow(item.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface VisibilityRowProps {
  idx: number;
  label: string;
  visible: boolean;
  onHide: () => void;
  onRestore: () => void;
}

function VisibilityRow({ idx, label, visible, onHide, onRestore }: VisibilityRowProps) {
  const { t } = useTranslation(["dashboard"]);

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-surface-border bg-surface-light px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-text-muted w-7">#{idx + 1}</span>
        <span className="text-sm text-text-primary truncate">{label}</span>
        <span
          className={visible ? "text-[11px] px-2 py-0.5 rounded-full bg-accent-green/15 text-accent-green" : "text-[11px] px-2 py-0.5 rounded-full bg-surface-hover text-text-muted"}
        >
          {visible ? t("dashboard:visible") : t("dashboard:hidden")}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {visible ? (
          <button
            onClick={onHide}
            className="ui-btn-ghost !text-xs !px-2 !py-1 text-accent-red"
            title={t("dashboard:removeFromHome")}
          >
            <Trash2 size={14} />
          </button>
        ) : (
          <button
            onClick={onRestore}
            className="ui-btn-ghost !text-xs !px-2 !py-1 text-accent-blue"
            title={t("dashboard:restoreToHome")}
          >
            <Undo2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
