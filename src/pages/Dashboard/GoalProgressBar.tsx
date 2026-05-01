import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import * as api from "@/services/tauriApi";
import type { GoalProgress } from "@/types";
import { formatDuration } from "@/utils/format";

function widthClass(ratio: number) {
  if (ratio <= 0) return "w-0";
  if (ratio <= 0.08) return "w-1/12";
  if (ratio <= 0.16) return "w-2/12";
  if (ratio <= 0.25) return "w-3/12";
  if (ratio <= 0.33) return "w-4/12";
  if (ratio <= 0.42) return "w-5/12";
  if (ratio <= 0.5) return "w-6/12";
  if (ratio <= 0.58) return "w-7/12";
  if (ratio <= 0.66) return "w-8/12";
  if (ratio <= 0.75) return "w-9/12";
  if (ratio <= 0.83) return "w-10/12";
  if (ratio <= 0.92) return "w-11/12";
  return "w-full";
}

export default function GoalProgressBar() {
  const { t } = useTranslation(["dashboard", "goals", "categories"]);
  const { weekStartDay } = useSettingsStore();
  const [rows, setRows] = useState<GoalProgress[]>([]);

  const categoryLabel = (category: string) =>
    t(`categories:presets.${category}`, { defaultValue: category } as Record<string, unknown>);

  const goalLabel = (row: GoalProgress) => {
    if (row.goal.scope_type === "category") {
      return categoryLabel(row.goal.scope_value);
    }
    return row.goal.scope_value;
  };

  useEffect(() => {
    api.getGoalProgress(weekStartDay)
      .then(setRows)
      .catch(() => setRows([]));
  }, [weekStartDay]);

  const summary = useMemo(() => {
    if (rows.length === 0) {
      return { completed: 0, total: 0, ratio: 0 };
    }
    const completed = rows.filter((r) => r.is_completed).length;
    const total = rows.length;
    return { completed, total, ratio: completed / total };
  }, [rows]);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-text-secondary">{t("goalProgress")}</h3>
        <span className="text-xs text-text-muted">
          {summary.completed}/{summary.total}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-hover overflow-hidden mb-4">
        <div className={`h-full bg-accent-blue transition-all ${widthClass(summary.ratio)}`} />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t("goalEmpty")}</p>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 5).map((row, idx) => {
            const pct = Math.min(100, Math.round(row.progress_ratio * 100));
            return (
              <div key={`${row.goal.scope_type}-${row.goal.scope_value}-${idx}`}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-text-primary truncate" title={row.goal.scope_value}>
                    {t(`goals:scopeType_${row.goal.scope_type}`)}: {goalLabel(row)}
                  </span>
                  <span className={row.is_completed ? "text-accent-green" : "text-text-secondary"}>
                    {formatDuration(row.used_seconds)} / {formatDuration(row.goal.target_seconds)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
                  <div className={`h-full bg-accent-blue ${widthClass(pct / 100)}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
