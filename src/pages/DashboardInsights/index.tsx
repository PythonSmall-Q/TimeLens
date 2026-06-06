import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import InsightWorkspace from "@/pages/Dashboard/InsightWorkspace";
import UnifiedTimeline from "@/pages/Dashboard/UnifiedTimeline";
import * as api from "@/services/tauriApi";
import type { AppUsageComparison } from "@/types";
import { formatDuration, todayString, daysAgo } from "@/utils/format";
import AsyncStateCard from "@/components/AsyncStateCard";

type PeriodMode = "day" | "week" | "month";

const toDate = (s: string) => new Date(`${s}T00:00:00`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

function getWeekRange(weekValue: string, weekStartDay: 0 | 1 = 1): { start: string; end: string } {
  const [y, w] = weekValue.split("-W").map(Number);
  const jan4 = new Date(y, 0, 4);
  const day = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - day + 1 + (w - 1) * 7);
  if (weekStartDay === 0) {
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() - 1);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return { start: fmt(sunday), end: fmt(saturday) };
  }
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: fmt(monday), end: fmt(sunday) };
}

function formatWeekLabel(weekValue: string, weekStartDay: 0 | 1): string {
  const { start, end } = getWeekRange(weekValue, weekStartDay);
  const s = toDate(start);
  const e = toDate(end);
  const md = (d: Date) => d.toLocaleDateString("en", { month: "short", day: "numeric" });
  const [, wPart] = weekValue.split("-");
  return `${wPart}: ${md(s)} – ${md(e)}`;
}

function currentIsoWeek(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getMonthRange(monthValue: string): { start: string; end: string } {
  const [y, m] = monthValue.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  return { start: fmt(start), end: fmt(end) };
}

export default function DashboardInsights() {
  const { t } = useTranslation(["common", "dashboard"]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialMode = (searchParams.get("mode") as PeriodMode) || "day";
  const initialDate = searchParams.get("date") || todayString();
  const initialWeek = searchParams.get("week") || currentIsoWeek();
  const initialMonth = searchParams.get("month") || todayString().slice(0, 7);

  const [periodMode, setPeriodMode] = useState<PeriodMode>(initialMode);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [weekValue, setWeekValue] = useState(initialWeek);
  const [monthValue, setMonthValue] = useState(initialMonth);
  const [loading, setLoading] = useState(false);
  const [periodComparisonRows, setPeriodComparisonRows] = useState<AppUsageComparison[]>([]);

  const weekStartDay: 0 | 1 = 1;

  const weekOptions = useMemo(() => {
    const rows: string[] = [];
    const base = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i * 7);
      const iso = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = iso.getUTCDay() || 7;
      iso.setUTCDate(iso.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(iso.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((iso.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      rows.push(`${iso.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`);
    }
    return Array.from(new Set(rows));
  }, []);

  const monthOptions = useMemo(() => {
    const rows: string[] = [];
    const base = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      rows.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return rows;
  }, []);

  const rangeDays = useMemo(() => {
    if (periodMode === "week") {
      const { start, end } = getWeekRange(weekValue, weekStartDay);
      const days = Math.max(1, Math.round((toDate(end).getTime() - toDate(start).getTime()) / 86400000) + 1);
      return { start, end, days };
    }
    if (periodMode === "month") {
      const { start, end } = getMonthRange(monthValue);
      const days = Math.max(1, Math.round((toDate(end).getTime() - toDate(start).getTime()) / 86400000) + 1);
      return { start, end, days };
    }
    return null;
  }, [periodMode, weekValue, monthValue]);

  const timelineRange = useMemo(() => {
    if (periodMode === "day") {
      return { start: selectedDate, end: selectedDate };
    }
    if (!rangeDays) {
      return { start: selectedDate, end: selectedDate };
    }
    return { start: rangeDays.start, end: rangeDays.end };
  }, [periodMode, selectedDate, rangeDays]);

  const whatChangedSummary = useMemo(() => {
    if (periodComparisonRows.length === 0) return null;

    const totals = periodComparisonRows.reduce(
      (acc, row) => {
        acc.current += row.current_seconds;
        acc.previous += row.previous_seconds;
        if (row.delta_seconds > 0) {
          if (!acc.topIncrease || row.delta_seconds > acc.topIncrease.delta_seconds) {
            acc.topIncrease = row;
          }
        }
        if (row.delta_seconds < 0) {
          if (!acc.topDecrease || row.delta_seconds < acc.topDecrease.delta_seconds) {
            acc.topDecrease = row;
          }
        }
        if (row.previous_seconds === 0 && row.current_seconds > 0) acc.newApps += 1;
        if (row.current_seconds === 0 && row.previous_seconds > 0) acc.stoppedApps += 1;
        return acc;
      },
      {
        current: 0,
        previous: 0,
        topIncrease: null as AppUsageComparison | null,
        topDecrease: null as AppUsageComparison | null,
        newApps: 0,
        stoppedApps: 0,
      }
    );

    return {
      ...totals,
      delta: totals.current - totals.previous,
    };
  }, [periodComparisonRows]);

  useEffect(() => {
    setSearchParams({
      mode: periodMode,
      date: selectedDate,
      week: weekValue,
      month: monthValue,
    });
  }, [periodMode, selectedDate, weekValue, monthValue, setSearchParams]);

  useEffect(() => {
    const loadPeriodComparison = async () => {
      let currentStart = selectedDate;
      let currentEnd = selectedDate;
      let days = 1;

      if (periodMode !== "day") {
        if (!rangeDays) {
          setPeriodComparisonRows([]);
          return;
        }
        currentStart = rangeDays.start;
        currentEnd = rangeDays.end;
        days = rangeDays.days;
      }

      const prevEndDate = new Date(`${currentStart}T00:00:00`);
      prevEndDate.setDate(prevEndDate.getDate() - 1);
      const prevStartDate = new Date(prevEndDate);
      prevStartDate.setDate(prevEndDate.getDate() - (days - 1));

      setLoading(true);
      try {
        const rows = await api.getAppComparisonInRanges(
          currentStart,
          currentEnd,
          fmt(prevStartDate),
          fmt(prevEndDate)
        );
        setPeriodComparisonRows(rows);
      } catch {
        setPeriodComparisonRows([]);
      } finally {
        setLoading(false);
      }
    };

    void loadPeriodComparison();
  }, [periodMode, selectedDate, rangeDays]);

  const isToday = selectedDate === todayString();
  const displayDate = isToday
    ? t("common:today")
    : selectedDate === daysAgo(1)
    ? t("common:yesterday")
    : selectedDate;

  const goBack = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const goForward = () => {
    if (isToday) return;
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const applyModePreset = (mode: PeriodMode) => {
    setPeriodMode(mode);
    if (mode === "day") {
      setSelectedDate(todayString());
    } else if (mode === "week") {
      setWeekValue(currentIsoWeek());
    } else {
      setMonthValue(todayString().slice(0, 7));
    }
  };

  const resetToToday = () => {
    setSelectedDate(todayString());
    setWeekValue(currentIsoWeek());
    setMonthValue(todayString().slice(0, 7));
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between min-h-[52px] gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("dashboard:insightWorkspace.title")}</h1>
          <p className="text-text-muted text-xs mt-0.5">{t("dashboard:timeline.title")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="ui-btn-secondary !text-xs !px-3 !py-2"
            onClick={() => navigate("/dashboard")}
          >
            {t("dashboard:backToDashboard")}
          </button>
          <button
            className="ui-btn-secondary !text-xs !px-3 !py-2"
            onClick={resetToToday}
          >
            {t("dashboard:insightFilters.backToToday")}
          </button>
          <div className="flex gap-1.5 bg-surface-hover rounded-xl p-1">
            {(["day", "week", "month"] as PeriodMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => applyModePreset(mode)}
                className={[
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  periodMode === mode
                    ? "bg-accent-blue text-white shadow"
                    : "text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {t(`dashboard:insightFilters.${mode}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-surface-card rounded-xl px-2.5 py-1.5 border border-surface-border min-h-[40px]">
            <div className="relative w-[24rem] h-8">
              <div
                className={[
                  "absolute inset-0 flex items-center gap-2 transition-opacity",
                  periodMode === "day" ? "opacity-100" : "opacity-0 pointer-events-none",
                ].join(" ")}
              >
                <button
                  onClick={goBack}
                  className="text-text-secondary hover:text-text-primary transition-colors p-0.5"
                  title={t("common:previous")}
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="text-sm text-text-primary font-medium w-24 text-center">{displayDate}</span>
                <button
                  onClick={goForward}
                  disabled={isToday}
                  className="text-text-secondary hover:text-text-primary transition-colors p-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t("common:next")}
                >
                  <ChevronRight size={15} />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  className="ui-field !w-36 !py-1.5 !text-xs"
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>

              <div
                className={[
                  "absolute inset-0 flex items-center transition-opacity",
                  periodMode === "week" ? "opacity-100" : "opacity-0 pointer-events-none",
                ].join(" ")}
              >
                <select
                  value={weekValue}
                  className="ui-select !w-full !py-1.5 !text-xs"
                  onChange={(e) => setWeekValue(e.target.value)}
                >
                  {weekOptions.map((w) => (
                    <option key={w} value={w}>{formatWeekLabel(w, weekStartDay)}</option>
                  ))}
                </select>
              </div>

              <div
                className={[
                  "absolute inset-0 flex items-center transition-opacity",
                  periodMode === "month" ? "opacity-100" : "opacity-0 pointer-events-none",
                ].join(" ")}
              >
                <select
                  value={monthValue}
                  className="ui-select !w-36 !py-1.5 !text-xs"
                  onChange={(e) => setMonthValue(e.target.value)}
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <AsyncStateCard variant="loading" title={t("common:loading")} compact />
      ) : whatChangedSummary ? (
        <div className="glass-card p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h3 className="text-sm font-semibold text-text-primary">{t("dashboard:whatChangedTitle")}</h3>
            <span className={whatChangedSummary.delta >= 0 ? "text-xs text-accent-red" : "text-xs text-accent-green"}>
              {t("dashboard:whatChangedDelta", {
                sign: whatChangedSummary.delta >= 0 ? "+" : "-",
                value: formatDuration(Math.abs(whatChangedSummary.delta)),
              })}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-text-muted">{t("dashboard:whatChangedTopIncrease")}</p>
              <p className="text-text-primary mt-1 font-medium truncate">
                {whatChangedSummary.topIncrease?.app_name ?? t("dashboard:noDataShort")}
              </p>
              <p className="text-accent-red mt-0.5">
                {whatChangedSummary.topIncrease ? `+${formatDuration(whatChangedSummary.topIncrease.delta_seconds)}` : "-"}
              </p>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-text-muted">{t("dashboard:whatChangedTopDecrease")}</p>
              <p className="text-text-primary mt-1 font-medium truncate">
                {whatChangedSummary.topDecrease?.app_name ?? t("dashboard:noDataShort")}
              </p>
              <p className="text-accent-green mt-0.5">
                {whatChangedSummary.topDecrease ? `-${formatDuration(Math.abs(whatChangedSummary.topDecrease.delta_seconds))}` : "-"}
              </p>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-text-muted">{t("dashboard:whatChangedNewApps")}</p>
              <p className="text-text-primary mt-1 font-medium">{whatChangedSummary.newApps}</p>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-text-muted">{t("dashboard:whatChangedStoppedApps")}</p>
              <p className="text-text-primary mt-1 font-medium">{whatChangedSummary.stoppedApps}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {whatChangedSummary.topIncrease && (
              <button
                onClick={() => navigate(`/categories?appName=${encodeURIComponent(whatChangedSummary.topIncrease!.app_name)}&exePath=${encodeURIComponent(whatChangedSummary.topIncrease!.exe_path || "")}`)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-surface-border text-text-muted hover:text-accent-blue"
              >
                {t("dashboard:openTopIncreaseCategory")}
              </button>
            )}
            <button
              onClick={() => navigate(`/browser?preset=custom&start=${encodeURIComponent(timelineRange.start)}&end=${encodeURIComponent(timelineRange.end)}`)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-surface-border text-text-muted hover:text-accent-blue"
            >
              {t("dashboard:openRangeInBrowser")}
            </button>
          </div>
        </div>
      ) : (
        <AsyncStateCard variant="empty" title={t("dashboard:noDataShort")} compact />
      )}

      <InsightWorkspace selectedDate={selectedDate} periodMode={periodMode} />
      <UnifiedTimeline
        selectedDate={selectedDate}
        periodMode={periodMode}
        rangeStart={timelineRange.start}
        rangeEnd={timelineRange.end}
      />
    </div>
  );
}
