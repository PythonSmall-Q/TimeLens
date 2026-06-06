import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "@/services/tauriApi";
import type {
  FocusWindowSuggestion,
  GoalAdjustmentSuggestion,
  UsageAnomalyMarker,
} from "@/types";
import { formatDuration } from "@/utils/format";

interface Props {
  selectedDate: string;
  periodMode: "day" | "week" | "month";
}

function recommendationKey(rec: string) {
  if (rec === "increase_target") return "increase";
  if (rec === "decrease_target") return "decrease";
  return "keep";
}

export default function InsightWorkspace({ selectedDate, periodMode }: Props) {
  const { t } = useTranslation("dashboard");
  const [loading, setLoading] = useState(true);
  const [focusWindows, setFocusWindows] = useState<FocusWindowSuggestion[]>([]);
  const [goalAdjustments, setGoalAdjustments] = useState<GoalAdjustmentSuggestion[]>([]);
  const [anomalies, setAnomalies] = useState<UsageAnomalyMarker[]>([]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      try {
        const [focus, goals, anomalyRows] = await Promise.all([
          api.suggestFocusWindows(21),
          api.suggestGoalAdjustments(),
          api.detectUsageAnomalies(selectedDate, 14),
        ]);
        if (disposed) return;
        setFocusWindows(focus);
        setGoalAdjustments(goals);
        setAnomalies(anomalyRows);
      } catch {
        if (disposed) return;
        setFocusWindows([]);
        setGoalAdjustments([]);
        setAnomalies([]);
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [selectedDate]);

  const topFocusWindow = useMemo(() => focusWindows[0] ?? null, [focusWindows]);
  const topGoalSuggestion = useMemo(() => goalAdjustments[0] ?? null, [goalAdjustments]);
  const topAnomaly = useMemo(() => anomalies[0] ?? null, [anomalies]);

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{t("insightWorkspace.title")}</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {t("insightWorkspace.subtitle", { mode: t(`period${periodMode[0].toUpperCase()}${periodMode.slice(1)}`) })}
          </p>
        </div>
        <span className="text-xs text-text-muted">{selectedDate}</span>
      </div>

      {loading ? (
        <div className="text-xs text-text-muted">{t("insightWorkspace.loading")}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-text-primary">{t("insightWorkspace.dailyReviewTitle")}</p>
            {topAnomaly ? (
              <>
                <p className="text-xs text-text-secondary">
                  {topAnomaly.direction === "spike"
                    ? t("insightWorkspace.dailySpike", { ratio: Math.round(topAnomaly.delta_ratio * 100) })
                    : t("insightWorkspace.dailyDrop", { ratio: Math.round(Math.abs(topAnomaly.delta_ratio) * 100) })}
                </p>
                <p className="text-xs text-text-muted">
                  {t("insightWorkspace.baseline", {
                    current: formatDuration(topAnomaly.current_seconds),
                    baseline: formatDuration(topAnomaly.baseline_seconds),
                  })}
                </p>
              </>
            ) : (
              <p className="text-xs text-text-muted">{t("insightWorkspace.dailyStable")}</p>
            )}
          </div>

          <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-text-primary">{t("insightWorkspace.weeklyReflectionTitle")}</p>
            {topFocusWindow ? (
              <>
                <p className="text-xs text-text-secondary">
                  {t("insightWorkspace.bestFocusWindow", {
                    start: `${String(topFocusWindow.start_hour).padStart(2, "0")}:00`,
                    end: `${String(topFocusWindow.end_hour).padStart(2, "0")}:59`,
                  })}
                </p>
                <p className="text-xs text-text-muted">
                  {t("insightWorkspace.confidence", { value: Math.round(topFocusWindow.confidence * 100) })}
                </p>
              </>
            ) : (
              <p className="text-xs text-text-muted">{t("insightWorkspace.notEnoughData")}</p>
            )}
          </div>

          <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-text-primary">{t("insightWorkspace.goalHealthTitle")}</p>
            {topGoalSuggestion ? (
              <>
                <p className="text-xs text-text-secondary">
                  {t(`insightWorkspace.goalRecommendation.${recommendationKey(topGoalSuggestion.recommendation)}`)}
                </p>
                <p className="text-xs text-text-muted truncate" title={topGoalSuggestion.scope_value}>
                  {t("insightWorkspace.scope", {
                    scopeType: topGoalSuggestion.scope_type,
                    scopeValue: topGoalSuggestion.scope_value,
                  })}
                </p>
              </>
            ) : (
              <p className="text-xs text-text-muted">{t("insightWorkspace.noGoals")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
