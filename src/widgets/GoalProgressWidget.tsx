import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { X, Target, TrendingUp, TrendingDown } from "lucide-react";
import type { GoalProgress, UsageGoal } from "@/types";
import { formatDuration } from "@/utils/format";
import { useWidgetClient } from "@/hooks/useWidgetClient";
import clsx from "clsx";

interface Props {
  widgetId: string;
}

function goalLabel(goal: UsageGoal, t: (key: string, params?: Record<string, unknown>) => string) {
  const scope = goal.scope_value || goal.scope_type;
  const period = t(`goalProgress.period.${goal.period}`);
  const operator = t(`goalProgress.operator.${goal.operator}`);
  return `${scope} · ${operator} ${formatDuration(goal.target_seconds)} ${period}`;
}

export default function GoalProgressWidget({ widgetId }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  const client = useWidgetClient({ widgetId, widgetType: "goal-progress" });
  const [goals, setGoals] = useState<UsageGoal[]>([]);
  const [progress, setProgress] = useState<GoalProgress[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await client.query<{ goals: UsageGoal[]; progress: GoalProgress[] }>("goals");
        setGoals(result.goals.filter((goal) => goal.enabled));
        setProgress(result.progress);
      } catch {
        // Keep current state on error.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [client]);

  const progressByGoalId = new Map<number, GoalProgress>();
  progress.forEach((p) => {
    if (p.goal.id !== undefined) {
      progressByGoalId.set(p.goal.id, p);
    }
  });

  return (
    <div className="w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden">
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-text-muted text-xs">
          <Target size={13} />
          <span>{t("goalProgress.title")}</span>
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

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
        {goals.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-6">{t("goalProgress.empty")}</p>
        ) : (
          goals.map((goal) => {
            const gp = progressByGoalId.get(goal.id ?? -1);
            const used = gp?.used_seconds ?? 0;
            const ratio = gp?.progress_ratio ?? 0;
            const completed = gp?.is_completed ?? false;
            const pct = Math.min(100, Math.round(ratio * 100));
            const isAtMost = goal.operator === "at_most";

            return (
              <div
                key={goal.id ?? `${goal.scope_type}-${goal.scope_value}`}
                className="rounded-xl border border-surface-border bg-surface-hover/40 p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm text-text-primary truncate">
                    {goalLabel(goal, t)}
                  </span>
                  {completed ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green flex items-center gap-0.5">
                      <TrendingUp size={10} />
                      {t("goalProgress.done")}
                    </span>
                  ) : isAtMost && used > goal.target_seconds ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-red/15 text-accent-red flex items-center gap-0.5">
                      <TrendingDown size={10} />
                      {t("goalProgress.over")}
                    </span>
                  ) : null}
                </div>

                <div className="h-2 w-full rounded-full bg-surface-border overflow-hidden mb-1.5">
                  <div
                    className={clsx(
                      "h-full rounded-full transition-all",
                      completed
                        ? "bg-accent-green"
                        : isAtMost && used > goal.target_seconds
                        ? "bg-accent-red"
                        : "bg-accent-blue"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-text-muted">
                  <span>
                    {formatDuration(used)} / {formatDuration(goal.target_seconds)}
                  </span>
                  <span>{pct}%</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
