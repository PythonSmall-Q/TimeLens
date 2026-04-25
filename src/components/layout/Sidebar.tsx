import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Layers, Settings, Clock, Activity, Bell } from "lucide-react";
import { useStatsStore } from "@/stores/statsStore";
import { formatDuration } from "@/utils/format";
import clsx from "clsx";

const NAV_ITEMS = [
  { to: "/dashboard", icon: LayoutDashboard, labelKey: "dashboard:title" },
  { to: "/widgets", icon: Layers, labelKey: "widgets:widgetCenter" },
  { to: "/limits", icon: Bell, labelKey: "limits:title" },
  { to: "/settings", icon: Settings, labelKey: "settings:title" },
];

export default function Sidebar() {
  const { t } = useTranslation(["common", "dashboard", "widgets", "settings"]);
  const { totalSecondsToday, currentApp, monitorStatus } = useStatsStore();

  return (
    <aside className="flex flex-col h-full w-56 bg-surface-light border-r border-surface-border select-none">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-surface-border">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center shadow-glow">
          <Clock size={16} className="text-white" />
        </div>
        <span className="font-bold text-text-primary text-lg tracking-tight">TimeLens</span>
      </div>

      {/* Today quick stat */}
      <div className="px-5 py-4 border-b border-surface-border">
        <div className="text-text-muted text-xs uppercase tracking-wide mb-1">
          {t("dashboard:todayTotal")}
        </div>
        <div className="text-2xl font-bold text-gradient">
          {formatDuration(totalSecondsToday)}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          <span
            className={clsx(
              "w-2 h-2 rounded-full",
              monitorStatus.active ? "bg-accent-green animate-pulse" : "bg-text-muted"
            )}
          />
          <span className="text-xs text-text-secondary">
            {monitorStatus.active ? t("common:tracking") : t("common:paused")}
          </span>
        </div>
        {currentApp && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary">
            <Activity size={11} />
            <span className="truncate max-w-[130px]">{currentApp}</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ to, icon: Icon, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors",
                isActive
                  ? "bg-accent-blue/20 text-accent-blue font-medium"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              )
            }
          >
            <Icon size={17} />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
