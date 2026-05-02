import { useTranslation } from "react-i18next";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { ProductivityScore } from "@/types";

interface Props {
  scores: ProductivityScore[];
}

export default function ProductivityTrendChart({ scores }: Props) {
  const { t } = useTranslation("dashboard");

  if (scores.length === 0) return null;

  const data = scores.map((s) => ({
    date: s.date.slice(5),   // MM-DD
    score: s.score,
  }));

  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-3">{t("productivityTrend")}</h3>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            stroke="rgba(255,255,255,0.15)"
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10 }}
            stroke="rgba(255,255,255,0.15)"
          />
          <Tooltip
            contentStyle={{ background: "var(--surface-raised)", border: "none", borderRadius: 8, fontSize: 12 }}
            formatter={(v: number) => [v, t("score")]}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={{ r: 3, fill: "#60a5fa" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
