import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink, Clock, TrendingUp, BarChart2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import * as api from "@/services/tauriApi";
import { formatDuration, todayString } from "@/utils/format";
import type { AppUsageSummary, AppCategoryRule } from "@/types";

interface Props {
  app: AppUsageSummary;
  onBack: () => void;
  onClose: () => void;
}

interface DailyPoint {
  label: string;
  seconds: number;
  dateStr: string;
}

export default function AppDetailModal({ app, onBack, onClose }: Props) {
  const { t } = useTranslation(["common", "dashboard"]);
  const navigate = useNavigate();

  const [todaySeconds, setTodaySeconds] = useState<number>(0);
  const [weekTotal, setWeekTotal] = useState<number>(0);
  const [dailyPoints, setDailyPoints] = useState<DailyPoint[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = todayString();
    const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      days.push(d.toISOString().slice(0, 10));
    }

    const fetchDay = async (date: string): Promise<number> => {
      const result: AppUsageSummary[] = await api.getAppTotalsInRange(date, date).catch(() => []);
      const found = result.find((a) => a.app_name === app.app_name);
      return found?.total_seconds ?? 0;
    };

    Promise.all([
      // Single 7-day query for accurate week total (same range as chart days)
      api.getAppTotalsInRange(weekStart, today).catch(() => [] as AppUsageSummary[]),
      api.getAppCategories().catch(() => [] as AppCategoryRule[]),
      // Per-day queries for the chart (skip today — reuse week total's today slice)
      ...days.map(fetchDay),
    ]).then(([weekList, cats, ...daySecs]) => {
      // Week total: from single range query (authoritative)
      const weekFound = (weekList as AppUsageSummary[]).find((a) => a.app_name === app.app_name);
      setWeekTotal(weekFound?.total_seconds ?? 0);

      // Today: reuse today's per-day fetch (last element, i=0)
      setTodaySeconds((daySecs as number[])[6] ?? 0);

      const catEntry = (cats as AppCategoryRule[]).find((c) => c.app_name === app.app_name);
      setCategory(catEntry?.category ?? null);

      const points: DailyPoint[] = days.map((d, i) => ({
        dateStr: d,
        label: d.slice(5), // MM-DD
        seconds: (daySecs as number[])[i],
      }));
      setDailyPoints(points);
      setLoading(false);
    });
  }, [app.app_name]);

  const avgPerDay = dailyPoints.length > 0
    ? Math.round(weekTotal / dailyPoints.filter((p) => p.seconds > 0).length || 1)
    : 0;
  const maxSeconds = Math.max(...dailyPoints.map((p) => p.seconds), 1);
  const todayLabel = todayString();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border bg-surface-light">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t("common:previous")}
        >
          <ArrowLeft size={15} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{app.app_name}</p>
          <p className="text-[10px] text-text-muted font-mono truncate">{app.exe_path}</p>
        </div>
        {category && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue flex-shrink-0">
            {category}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-surface-light">
        {loading ? (
          <p className="text-center py-8 text-xs text-text-muted">{t("common:loading")}</p>
        ) : (
          <>
            {/* Big today stat */}
            <div className="grid grid-cols-2 gap-3">
              <div className="glass-card p-4 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-xs text-text-muted mb-1">
                  <Clock size={11} /> {t("common:today")}
                </div>
                <p className="text-2xl font-bold text-accent-blue">
                  {todaySeconds > 0 ? formatDuration(todaySeconds) : "—"}
                </p>
                <p className="text-[10px] text-text-muted">
                  {todaySeconds > 0
                    ? t("dashboard:percentOfDay", { pct: Math.round((todaySeconds / 86400) * 100) })
                    : t("dashboard:noActivity")}
                </p>
              </div>
              <div className="glass-card p-4 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-xs text-text-muted mb-1">
                  <TrendingUp size={11} /> {t("dashboard:weeklyTrend")}
                </div>
                <p className="text-2xl font-bold text-text-primary">
                  {weekTotal > 0 ? formatDuration(weekTotal) : "—"}
                </p>
                <p className="text-[10px] text-text-muted">
                  {avgPerDay > 0
                    ? t("dashboard:avgPerDay", { duration: formatDuration(avgPerDay) })
                    : t("dashboard:noDataShort")}
                </p>
              </div>
            </div>

            {/* 7-day bar chart */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-1.5 text-xs text-text-muted mb-3">
                <BarChart2 size={11} /> {t("dashboard:appDetailWeekChart")}
              </div>
              {weekTotal === 0 ? (
                <p className="text-center py-4 text-xs text-text-muted">{t("common:noData")}</p>
              ) : (
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={dailyPoints} barSize={18} margin={{ top: 4, right: 0, left: -24, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => v > 0 ? formatDuration(v) : ""}
                      tick={{ fontSize: 9, fill: "var(--text-muted)" }}
                      axisLine={false}
                      tickLine={false}
                      width={44}
                    />
                    <Tooltip
                      formatter={(v: number) => [formatDuration(v), app.app_name]}
                      contentStyle={{
                        background: "var(--surface-light)",
                        border: "1px solid var(--surface-border)",
                        borderRadius: 8,
                        fontSize: 11,
                        color: "var(--text-primary)",
                      }}
                      cursor={{ fill: "var(--surface-hover)" }}
                    />
                    <Bar dataKey="seconds" radius={[4, 4, 0, 0]}>
                      {dailyPoints.map((p) => (
                        <Cell
                          key={p.dateStr}
                          fill={p.dateStr === todayLabel ? "var(--accent-blue)" : "var(--surface-hover)"}
                          fillOpacity={p.seconds > 0 ? 1 : 0.3}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              {/* mini legend for max bar */}
              {weekTotal > 0 && (
                <div className="flex items-center justify-between mt-1 px-1">
                  <span className="text-[10px] text-text-muted">
                    {t("dashboard:peakDay", { duration: formatDuration(maxSeconds) })}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {t("dashboard:activeDays", { count: dailyPoints.filter((p) => p.seconds > 0).length })}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-surface-border bg-surface-light">
        <button
          onClick={() => { navigate("/dashboard"); onClose(); }}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs
                     bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 transition-colors font-medium"
        >
          <ExternalLink size={12} /> {t("dashboard:title")} →
        </button>
      </div>
    </div>
  );
}
