import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useStatsStore } from "@/stores/statsStore";
import { formatDuration, appColor } from "@/utils/format";

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const { app_name, total_seconds } = payload[0].payload;
    return (
      <div className="glass-card px-3 py-2 text-xs">
        <p className="text-text-primary font-medium">{app_name}</p>
        <p className="text-text-secondary">{formatDuration(total_seconds)}</p>
      </div>
    );
  }
  return null;
};

export default function AppRankingChart() {
  const { t } = useTranslation("dashboard");
  const { todayTotals } = useStatsStore();

  const top = todayTotals.slice(0, 8).map((r) => ({
    ...r,
    minutes: Math.round(r.total_seconds / 60),
  }));

  if (top.length === 0) {
    return (
      <div className="glass-card p-5 flex items-center justify-center h-48 text-text-muted text-sm">
        {t("noActivity")}
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-medium text-text-secondary mb-4">{t("topApps")}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={top}
          layout="vertical"
          margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
        >
          <XAxis
            type="number"
            dataKey="minutes"
            tick={{ fill: "#6b7280", fontSize: 11 }}
            tickFormatter={(v) => `${v}m`}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="app_name"
            width={90}
            tick={{ fill: "#9ca3b0", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="minutes" radius={[0, 6, 6, 0]} maxBarSize={18}>
            {top.map((entry) => (
              <Cell key={entry.app_name} fill={appColor(entry.app_name)} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
