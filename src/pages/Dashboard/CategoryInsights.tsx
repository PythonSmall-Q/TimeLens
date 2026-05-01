import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStatsStore } from "@/stores/statsStore";
import { formatDuration } from "@/utils/format";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"];
const DOT_CLASSES = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-red-500", "bg-violet-500", "bg-cyan-500", "bg-lime-500", "bg-orange-500"];

export default function CategoryInsights() {
  const { t } = useTranslation(["dashboard", "categories"]);
  const { categoryTotals, categoryDailyTotals } = useStatsStore();

  const localizeCategory = (category: string) =>
    t(`categories:presets.${category}`, { defaultValue: category } as Record<string, unknown>);

  const pieData = useMemo(
    () => categoryTotals.slice(0, 8).map((row) => ({
      ...row,
      categoryLabel: localizeCategory(row.category),
    })),
    [categoryTotals]
  );

  const trendData = useMemo(() => {
    const dateMap = new Map<string, Record<string, string | number>>();
    for (const row of categoryDailyTotals) {
      if (!dateMap.has(row.date)) {
        dateMap.set(row.date, { date: row.date } as Record<string, string | number>);
      }
      const item = dateMap.get(row.date)!;
      item[row.category] = row.total_seconds;
    }
    return Array.from(dateMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [categoryDailyTotals]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const row of categoryDailyTotals) {
      set.add(row.category);
    }
    return Array.from(set).slice(0, 6);
  }, [categoryDailyTotals]);

  if (pieData.length === 0) {
    return (
      <div className="glass-card p-5 flex items-center justify-center h-72 text-text-muted text-sm">
        {t("noCategoryData")}
      </div>
    );
  }

  return (
    <div className="glass-card p-5 space-y-4">
      <h3 className="text-sm font-medium text-text-secondary">{t("categoryView")}</h3>

      <div className="grid grid-cols-2 gap-3">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="total_seconds" nameKey="categoryLabel" cx="50%" cy="50%" outerRadius={72}>
                {pieData.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => formatDuration(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-2">
          {pieData.map((row, idx) => (
            <div key={row.category} className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-2 text-text-secondary truncate">
                <span className={`w-2 h-2 rounded-full ${DOT_CLASSES[idx % DOT_CLASSES.length]}`} />
                {row.categoryLabel}
              </span>
              <span className="text-text-primary">{formatDuration(row.total_seconds)}</span>
            </div>
          ))}
        </div>
      </div>

      {trendData.length > 0 && categories.length > 0 && (
        <div>
          <h4 className="text-xs text-text-muted mb-2">{t("categoryTrend")}</h4>
          <ResponsiveContainer width="100%" height={190}>
            <AreaChart data={trendData} margin={{ top: 6, right: 12, left: -20, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip formatter={(v: number, name: string) => [formatDuration(v), localizeCategory(name)]} />
              {categories.map((c, idx) => (
                <Area
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stackId="1"
                  stroke={COLORS[idx % COLORS.length]}
                  fill={COLORS[idx % COLORS.length]}
                  fillOpacity={0.2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
