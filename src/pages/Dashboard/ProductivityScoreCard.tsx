import { useTranslation } from "react-i18next";
import type { ProductivityScore } from "@/types";
import { formatDuration } from "@/utils/format";

interface Props {
  score: ProductivityScore;
}

const RING_R = 36;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

function ringColor(score: number): string {
  if (score < 60) return "#ef4444";
  if (score < 80) return "#f59e0b";
  return "#22c55e";
}

export default function ProductivityScoreCard({ score }: Props) {
  const { t } = useTranslation("dashboard");
  const pct = score.score / 100;
  const color = ringColor(score.score);
  const dashOffset = CIRCUMFERENCE * (1 - pct);

  return (
    <div className="glass-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{t("productivityScore")}</h3>
          <p className="text-xs text-text-muted mt-0.5">{t("productivityDesc")}</p>
        </div>
        {/* SVG ring */}
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle
            cx="40" cy="40" r={RING_R}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-surface-border"
          />
          <circle
            cx="40" cy="40" r={RING_R}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 40 40)"
            className="transition-[stroke-dashoffset] duration-500 ease-in-out"
          />
          <text
            x="40" y="44"
            textAnchor="middle"
            fontSize="16"
            fontWeight="700"
            fill={color}
          >
            {score.score}
          </text>
        </svg>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-3">
        <MetricRow label={t("focusTime")} value={formatDuration(score.focus_seconds)} />
        <MetricRow label={t("score")} value={formatDuration(score.total_seconds)} />
        <MetricRow label={t("switchCount")} value={String(score.switch_count)} />
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-sm font-semibold text-text-primary">{value}</span>
      <span className="text-[10px] text-text-muted text-center leading-tight">{label}</span>
    </div>
  );
}
