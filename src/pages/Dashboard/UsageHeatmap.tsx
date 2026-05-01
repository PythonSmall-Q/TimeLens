import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStatsStore } from "@/stores/statsStore";
import { formatDuration } from "@/utils/format";

function intensityClass(value: number, max: number) {
  if (value <= 0 || max <= 0) return "bg-surface-hover";
  const ratio = value / max;
  if (ratio < 0.2) return "bg-accent-blue/20";
  if (ratio < 0.4) return "bg-accent-blue/35";
  if (ratio < 0.6) return "bg-accent-blue/50";
  if (ratio < 0.8) return "bg-accent-blue/70";
  return "bg-accent-blue";
}

export default function UsageHeatmap() {
  const { t } = useTranslation("dashboard");
  const { heatmapDailyTotals } = useStatsStore();

  const { days, max } = useMemo(() => {
    const map = new Map(heatmapDailyTotals.map((r) => [r.date, r.total_seconds]));
    const end = new Date();
    const rows: { date: string; value: number }[] = [];
    for (let i = 364; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      rows.push({ date: key, value: map.get(key) ?? 0 });
    }
    const m = rows.reduce((acc, cur) => Math.max(acc, cur.value), 0);
    return { days: rows, max: m };
  }, [heatmapDailyTotals]);

  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-medium text-text-secondary mb-3">{t("usageHeatmap")}</h3>
      <div className="grid grid-cols-[repeat(53,minmax(0,1fr))] gap-1">
        {days.map((d) => (
          <div
            key={d.date}
            className={`w-2.5 h-2.5 rounded-sm ${intensityClass(d.value, max)}`}
            title={`${d.date}: ${formatDuration(d.value)}`}
          />
        ))}
      </div>
    </div>
  );
}
