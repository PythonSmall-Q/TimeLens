import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStatsStore } from "@/stores/statsStore";
import { formatDuration } from "@/utils/format";

function monthRange(offset: number) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export default function TrendComparePanel() {
  const { t } = useTranslation("dashboard");
  const { comparisonResults, fetchComparison } = useStatsStore();

  const [a, setA] = useState(monthRange(0));
  const [b, setB] = useState(monthRange(-1));

  useEffect(() => {
    fetchComparison(a.start, a.end, b.start, b.end);
  }, [a.start, a.end, b.start, b.end, fetchComparison]);

  const topIncrease = useMemo(
    () => comparisonResults.filter((r) => r.delta_seconds > 0).slice(0, 5),
    [comparisonResults]
  );
  const topDecrease = useMemo(
    () => comparisonResults.filter((r) => r.delta_seconds < 0).slice(0, 5),
    [comparisonResults]
  );

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-text-secondary">{t("trendCompare")}</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="space-y-1">
          <p className="text-xs text-text-muted">{t("periodA")}</p>
          <div className="flex gap-2">
            <input
              type="date"
              className="ui-field !text-xs"
              value={a.start}
              title={`${t("periodA")} start`}
              aria-label={`${t("periodA")} start`}
              onChange={(e) => setA((s) => ({ ...s, start: e.target.value }))}
            />
            <input
              type="date"
              className="ui-field !text-xs"
              value={a.end}
              title={`${t("periodA")} end`}
              aria-label={`${t("periodA")} end`}
              onChange={(e) => setA((s) => ({ ...s, end: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-text-muted">{t("periodB")}</p>
          <div className="flex gap-2">
            <input
              type="date"
              className="ui-field !text-xs"
              value={b.start}
              title={`${t("periodB")} start`}
              aria-label={`${t("periodB")} start`}
              onChange={(e) => setB((s) => ({ ...s, start: e.target.value }))}
            />
            <input
              type="date"
              className="ui-field !text-xs"
              value={b.end}
              title={`${t("periodB")} end`}
              aria-label={`${t("periodB")} end`}
              onChange={(e) => setB((s) => ({ ...s, end: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs text-accent-green mb-2">{t("topIncrease")}</h4>
          <div className="space-y-1">
            {topIncrease.length === 0 && <p className="text-xs text-text-muted">{t("noData")}</p>}
            {topIncrease.map((row) => (
              <div key={`inc-${row.app_name}`} className="flex items-center justify-between text-xs">
                <span className="text-text-primary truncate" title={row.exe_path || row.app_name}>{row.app_name}</span>
                <span className="text-accent-green">+{formatDuration(row.delta_seconds)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-xs text-accent-red mb-2">{t("topDecrease")}</h4>
          <div className="space-y-1">
            {topDecrease.length === 0 && <p className="text-xs text-text-muted">{t("noData")}</p>}
            {topDecrease.map((row) => (
              <div key={`dec-${row.app_name}`} className="flex items-center justify-between text-xs">
                <span className="text-text-primary truncate" title={row.exe_path || row.app_name}>{row.app_name}</span>
                <span className="text-accent-red">-{formatDuration(Math.abs(row.delta_seconds))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
