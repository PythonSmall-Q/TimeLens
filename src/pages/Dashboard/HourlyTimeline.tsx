import { useTranslation } from "react-i18next";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useStatsStore } from "@/stores/statsStore";

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const minutes = Math.round((payload[0].value as number) / 60);
    return (
      <div className="glass-card px-3 py-2 text-xs">
        <p className="text-text-primary font-medium">{`${label}:00`}</p>
        <p className="text-accent-blue">{`${minutes} min`}</p>
      </div>
    );
  }
  return null;
};

/** Build a full 0-23 hour array, filling missing hours with 0. */
function buildHourlyData(raw: { hour: number; seconds: number }[]) {
  const map = new Map(raw.map((r) => [r.hour, r.seconds]));
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    seconds: map.get(h) ?? 0,
  }));
}

export default function HourlyTimeline() {
  const { t } = useTranslation("dashboard");
  const { todayHourly } = useStatsStore();
  const data = buildHourlyData(todayHourly);
  const currentHour = new Date().getHours();

  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-medium text-text-secondary mb-4">
        {t("hourlyDistribution")}
      </h3>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6c8ebf" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#6c8ebf" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="hour"
            tick={{ fill: "#6b7280", fontSize: 10 }}
            tickFormatter={(h) => (h % 6 === 0 ? `${h}h` : "")}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(108,142,191,0.3)" }} />
          <Area
            type="monotone"
            dataKey="seconds"
            stroke="#6c8ebf"
            strokeWidth={2}
            fill="url(#blueGrad)"
            dot={(props: any) => {
              if (props.payload.hour === currentHour) {
                return (
                  <circle
                    key="cur"
                    cx={props.cx}
                    cy={props.cy}
                    r={4}
                    fill="#6c8ebf"
                    stroke="#1a1b2e"
                    strokeWidth={2}
                  />
                );
              }
              return <></>;
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
