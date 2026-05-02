import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { useStatsStore } from "@/stores/statsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { type DashboardWindowId, useDashboardLayoutStore } from "@/stores/dashboardLayoutStore";
import TodayOverview from "./TodayOverview";
import AppRankingChart from "./AppRankingChart";
import HourlyTimeline from "./HourlyTimeline";
import AppList from "./AppList";
import GoalProgressBar from "./GoalProgressBar";
import CategoryInsights from "./CategoryInsights";
import UsageHeatmap from "./UsageHeatmap";
import TrendComparePanel from "./TrendComparePanel";
import ProductivityScoreCard from "./ProductivityScoreCard";
import ProductivityTrendChart from "./ProductivityTrendChart";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { todayString, daysAgo } from "@/utils/format";
import { formatDuration } from "@/utils/format";

const toDate = (s: string) => new Date(`${s}T00:00:00`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

function getWeekRange(weekValue: string, weekStartDay: 0 | 1 = 1): { start: string; end: string } {
  const [y, w] = weekValue.split("-W").map(Number);
  const jan4 = new Date(y, 0, 4);
  const day = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - day + 1 + (w - 1) * 7);
  if (weekStartDay === 0) {
    // Sunday-start: shift back 1 day from Monday
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
  const md = (d: Date) =>
    d.toLocaleDateString("en", { month: "short", day: "numeric" });
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

export default function Dashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation(["common", "dashboard"]);
  const { weekStartDay } = useSettingsStore();
  const { layout, moveWindow } = useDashboardLayoutStore();
  const {
    selectedDate,
    setSelectedDate,
    fetchToday,
    fetchForDate,
    fetchForRange,
    fetchCategoryForRange,
    fetchDailyTotalsRange,
    fetchWeekComparison,
    loading,
    periodMode,
    setPeriodMode,
    todayTotals,
    weekComparison,
    productivityScores,
    interruptionPeriods,
    fetchProductivityRange,
    fetchInterruptionPeriods,
  } = useStatsStore();
  const [weekValue, setWeekValue] = useState(currentIsoWeek());
  const [monthValue, setMonthValue] = useState(todayString().slice(0, 7));
  const [activeDragId, setActiveDragId] = useState<DashboardWindowId | null>(null);
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

  useEffect(() => {
    if (periodMode !== "day") return;
    if (selectedDate === todayString()) {
      fetchToday();
      return;
    }
    fetchForDate(selectedDate);
  }, [fetchForDate, fetchToday, periodMode, selectedDate]);

  useEffect(() => {
    const end = todayString();
    const startDate = new Date(`${end}T00:00:00`);
    startDate.setDate(startDate.getDate() - 364);
    const start = startDate.toISOString().slice(0, 10);
    fetchDailyTotalsRange(start, end);
  }, [fetchDailyTotalsRange]);

  const isToday = selectedDate === todayString();

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

  const displayDate = isToday
    ? t("common:today")
    : selectedDate === daysAgo(1)
    ? t("common:yesterday")
    : selectedDate;

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
  }, [periodMode, weekValue, monthValue, weekStartDay]);

  useEffect(() => {
    if (periodMode === "day") return;

    if (!rangeDays) return;
    fetchForRange(rangeDays.start, rangeDays.end);

    if (periodMode === "week") {
      const prevEnd = new Date(`${rangeDays.start}T00:00:00`);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevEnd.getDate() - 6);
      fetchWeekComparison(rangeDays.start, rangeDays.end, fmt(prevStart), fmt(prevEnd));
    }
  }, [periodMode, rangeDays, fetchForRange, fetchWeekComparison]);

  useEffect(() => {
    if (periodMode !== "day") return;
    fetchCategoryForRange(selectedDate, selectedDate);
    fetchInterruptionPeriods(selectedDate);
  }, [periodMode, selectedDate, fetchCategoryForRange, fetchInterruptionPeriods]);

  // Productivity scores
  useEffect(() => {
    if (periodMode === "day") {
      const start = new Date(`${selectedDate}T00:00:00`);
      start.setDate(start.getDate() - 6);
      fetchProductivityRange(start.toISOString().slice(0, 10), selectedDate);
    } else if (rangeDays) {
      fetchProductivityRange(rangeDays.start, rangeDays.end);
    }
  }, [periodMode, selectedDate, rangeDays, fetchProductivityRange]);

  const visibleWindowIds = useMemo(
    () => layout.filter((item) => item.visible).map((item) => item.id),
    [layout]
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const windowColSpan: Record<DashboardWindowId, "col-span-1" | "col-span-2"> = {
    goalProgress: "col-span-2",
    todayOverview: "col-span-2",
    productivity: "col-span-2",
    appRanking: "col-span-1",
    hourlyTimeline: "col-span-1",
    categoryInsights: "col-span-2",
    usageHeatmap: "col-span-2",
    trendCompare: "col-span-2",
    appList: "col-span-2",
    avgDailyUsage: "col-span-2",
    weeklyCompare: "col-span-2",
  };

  const renderWindow = (id: DashboardWindowId) => {
    switch (id) {
      case "goalProgress":
        return <GoalProgressBar />;
      case "todayOverview":
        return <TodayOverview />;
      case "productivity":
        if (periodMode === "day") {
          const todayScore = productivityScores.find((s) => s.date === selectedDate);
          return todayScore ? <ProductivityScoreCard score={todayScore} /> : null;
        }
        return productivityScores.length > 0 ? <ProductivityTrendChart scores={productivityScores} /> : null;
      case "appRanking":
        return <AppRankingChart />;
      case "hourlyTimeline":
        return <HourlyTimeline />;
      case "categoryInsights":
        return <CategoryInsights />;
      case "usageHeatmap":
        return <UsageHeatmap />;
      case "trendCompare":
        return <TrendComparePanel />;
      case "appList":
        return <AppList />;
      case "avgDailyUsage":
        if (periodMode === "day" || !rangeDays) return null;
        return (
          <div className="glass-card p-5">
            <h3 className="text-sm font-medium text-text-secondary mb-3">
              {t("dashboard:avgDailyUsage", { mode: t(`dashboard:period${periodMode[0].toUpperCase()}${periodMode.slice(1)}`) })}
            </h3>
            <div className="space-y-2">
              {todayTotals.slice(0, 8).map((row) => (
                <div key={row.app_name} className="flex items-center justify-between text-sm">
                  <span className="text-text-primary truncate" title={row.exe_path || row.app_name}>
                    {row.app_name}
                  </span>
                  <span className="text-text-secondary">
                    {formatDuration(Math.round(row.total_seconds / rangeDays.days))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      case "weeklyCompare":
        if (periodMode !== "week" || weekComparison.length === 0) return null;
        return (
          <div className="glass-card p-5">
            <h3 className="text-sm font-medium text-text-secondary mb-3">{t("dashboard:weeklyCompare")}</h3>
            <div className="space-y-2">
              {weekComparison.slice(0, 8).map((row) => {
                const sign = row.delta_seconds >= 0 ? "+" : "";
                return (
                  <div key={row.app_name} className="flex items-center justify-between text-sm">
                    <span className="text-text-primary truncate" title={row.exe_path || row.app_name}>
                      {row.app_name}
                    </span>
                    <span className={row.delta_seconds >= 0 ? "text-accent-red" : "text-accent-green"}>
                      {sign}{formatDuration(Math.abs(row.delta_seconds))}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderedWindowIds = useMemo(
    () => visibleWindowIds.filter((id) => renderWindow(id) !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleWindowIds, periodMode, selectedDate, productivityScores, todayTotals, weekComparison, rangeDays]
  );

  const onDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id) as DashboardWindowId;
    const overId = event.over?.id ? (String(event.over.id) as DashboardWindowId) : null;
    setActiveDragId(null);
    if (!overId || activeId === overId) return;
    moveWindow(activeId, overId);
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id) as DashboardWindowId);
  };

  const onDragCancel = () => {
    setActiveDragId(null);
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("dashboard:title")}</h1>
          <p className="text-text-muted text-xs mt-0.5">{t("dashboard:screenTime")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="ui-btn-secondary !text-xs !px-3 !py-2"
            onClick={() => navigate("/dashboard-customize")}
          >
            {t("dashboard:customizeEntry")}
          </button>
          {/* Date / Period navigator */}
          <div className="flex items-center gap-2 bg-surface-card rounded-xl px-2.5 py-1.5 border border-surface-border">
          <select
            className="ui-select !w-24 !py-1.5 !text-xs"
            value={periodMode}
            onChange={(e) => setPeriodMode(e.target.value as "day" | "week" | "month")}
            title={t("dashboard:selectDate")}
            aria-label={t("dashboard:selectDate")}
          >
            <option value="day">{t("dashboard:periodDay")}</option>
            <option value="week">{t("dashboard:periodWeek")}</option>
            <option value="month">{t("dashboard:periodMonth")}</option>
          </select>

          {periodMode === "day" && (
            <>
              <button
                onClick={goBack}
                className="text-text-secondary hover:text-text-primary transition-colors p-0.5"
                title={t("common:previous")}
              >
                <ChevronLeft size={15} />
              </button>
              <span className="text-sm text-text-primary font-medium w-24 text-center">
                {displayDate}
              </span>
              <button
                onClick={goForward}
                disabled={isToday}
                className="text-text-secondary hover:text-text-primary transition-colors p-0.5
                           disabled:opacity-30 disabled:cursor-not-allowed"
                title={t("common:next")}
              >
                <ChevronRight size={15} />
              </button>
              <input
                type="date"
                value={selectedDate}
                className="ui-field !w-36 !py-1.5 !text-xs"
                onChange={(e) => setSelectedDate(e.target.value)}
                title={t("dashboard:selectDate")}
                aria-label={t("dashboard:selectDate")}
              />
            </>
          )}

          {periodMode === "week" && (
            <select
              value={weekValue}
              className="ui-select !w-52 !py-1.5 !text-xs"
              onChange={(e) => setWeekValue(e.target.value)}
              title={t("dashboard:periodWeek")}
              aria-label={t("dashboard:periodWeek")}
            >
              {weekOptions.map((w) => (
                <option key={w} value={w}>{formatWeekLabel(w, weekStartDay)}</option>
              ))}
            </select>
          )}

          {periodMode === "month" && (
            <select
              value={monthValue}
              className="ui-select !w-36 !py-1.5 !text-xs"
              onChange={(e) => setMonthValue(e.target.value)}
              title={t("dashboard:periodMonth")}
              aria-label={t("dashboard:periodMonth")}
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="text-center py-4 text-text-muted text-sm">{t("common:loading")}</div>
      )}

      {visibleWindowIds.length === 0 && (
        <div className="glass-card p-6 text-sm text-text-muted">
          {t("dashboard:noVisibleWindows")}
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}>
        <SortableContext items={renderedWindowIds} strategy={verticalListSortingStrategy}>
          <div className="grid grid-cols-2 gap-4">
            {renderedWindowIds.map((id) => {
              const content = renderWindow(id);
              if (!content) return null;
              return (
                <SortableDashboardCard key={id} id={id} colSpanClass={windowColSpan[id]}>
                  {content}
                </SortableDashboardCard>
              );
            })}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeDragId ? (
            <div className="w-[32rem] max-w-[90vw] opacity-95 rounded-2xl pointer-events-none scale-[1.01] drop-shadow-[0_20px_50px_rgba(0,0,0,0.45)] ring-2 ring-accent-blue/45">
              {renderWindow(activeDragId)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function SortableDashboardCard({
  id,
  colSpanClass,
  children,
}: {
  id: DashboardWindowId;
  colSpanClass: "col-span-1" | "col-span-2";
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging, isOver } = useSortable({ id });

  const cardStateClass = isDragging
    ? "opacity-55 scale-[0.985]"
    : isOver
    ? "ring-2 ring-accent-blue/50 bg-accent-blue/5 shadow-[0_0_0_1px_rgba(59,130,246,0.35),0_16px_30px_rgba(59,130,246,0.16)]"
    : "";

  return (
    <div
      ref={setNodeRef}
      className={[
        colSpanClass,
        "transition-all duration-150",
        cardStateClass,
      ].join(" ")}
    >
      <div className="relative rounded-2xl transition-all duration-150">
        <button
          className="absolute right-2 top-2 z-10 ui-btn-ghost !text-xs !px-2 !py-1 cursor-grab active:cursor-grabbing hover:bg-accent-blue/20"
          title="Drag"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        {children}
      </div>
    </div>
  );
}
