import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import InsightWorkspace from "@/pages/Dashboard/InsightWorkspace";
import UnifiedTimeline from "@/pages/Dashboard/UnifiedTimeline";
import * as api from "@/services/tauriApi";
import type {
  AppUsageComparison,
  CategoryComparison,
  ProjectComparison,
  DistractionHotspot,
} from "@/types";
import { formatDuration, todayString, daysAgo } from "@/utils/format";
import AsyncStateCard from "@/components/AsyncStateCard";

type PeriodMode = "day" | "week" | "month";
type ComparisonTab = "apps" | "categories" | "projects";

const SAVED_VIEWS_KEY = "timelens.dashboardInsights.savedViews.v1";

interface DashboardInsightsSavedView {
  id: string;
  name: string;
  mode: PeriodMode;
  selectedDate: string;
  weekValue: string;
  monthValue: string;
  createdAt: string;
}

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

function loadSavedViews(): DashboardInsightsSavedView[] {
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DashboardInsightsSavedView[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => Boolean(v?.id && v?.name && v?.mode));
  } catch {
    return [];
  }
}

interface ComparisonSummary {
  current: number;
  previous: number;
  delta: number;
  topIncreaseName: string | null;
  topIncreaseDelta: number;
  topDecreaseName: string | null;
  topDecreaseDelta: number;
  newCount: number;
  stoppedCount: number;
}

function summarizeComparisons(
  rows: Array<{ current_seconds: number; previous_seconds: number; delta_seconds: number }>,
  nameOf: (row: unknown) => string | null
): ComparisonSummary | null {
  if (rows.length === 0) return null;

  let current = 0;
  let previous = 0;
  let topIncreaseName: string | null = null;
  let topIncreaseDelta = 0;
  let topDecreaseName: string | null = null;
  let topDecreaseDelta = 0;
  let newCount = 0;
  let stoppedCount = 0;

  for (const row of rows) {
    current += row.current_seconds;
    previous += row.previous_seconds;
    if (row.delta_seconds > 0 && row.delta_seconds > topIncreaseDelta) {
      topIncreaseDelta = row.delta_seconds;
      topIncreaseName = nameOf(row);
    }
    if (row.delta_seconds < 0 && row.delta_seconds < topDecreaseDelta) {
      topDecreaseDelta = row.delta_seconds;
      topDecreaseName = nameOf(row);
    }
    if (row.previous_seconds === 0 && row.current_seconds > 0) newCount += 1;
    if (row.current_seconds === 0 && row.previous_seconds > 0) stoppedCount += 1;
  }

  return {
    current,
    previous,
    delta: current - previous,
    topIncreaseName,
    topIncreaseDelta,
    topDecreaseName,
    topDecreaseDelta,
    newCount,
    stoppedCount,
  };
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
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonTab, setComparisonTab] = useState<ComparisonTab>("apps");
  const [appComparisonRows, setAppComparisonRows] = useState<AppUsageComparison[]>([]);
  const [categoryComparisonRows, setCategoryComparisonRows] = useState<CategoryComparison[]>([]);
  const [projectComparisonRows, setProjectComparisonRows] = useState<ProjectComparison[]>([]);
  const [hotspots, setHotspots] = useState<DistractionHotspot[]>([]);
  const [hotspotsLoading, setHotspotsLoading] = useState(false);
  const [viewName, setViewName] = useState("");
  const [savedViews, setSavedViews] = useState<DashboardInsightsSavedView[]>(loadSavedViews);

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

  const comparisonSummary = useMemo((): ComparisonSummary | null => {
    if (comparisonTab === "categories") {
      return summarizeComparisons(categoryComparisonRows, (r) => (r as CategoryComparison).category);
    }
    if (comparisonTab === "projects") {
      return summarizeComparisons(projectComparisonRows, (r) => (r as ProjectComparison).project_name);
    }
    return summarizeComparisons(appComparisonRows, (r) => (r as AppUsageComparison).app_name);
  }, [comparisonTab, appComparisonRows, categoryComparisonRows, projectComparisonRows]);

  const topAppIncreaseRow = useMemo(() => {
    if (comparisonTab !== "apps") return null;
    return appComparisonRows.reduce<AppUsageComparison | null>(
      (best, row) => (row.delta_seconds > 0 && (!best || row.delta_seconds > best.delta_seconds) ? row : best),
      null
    );
  }, [comparisonTab, appComparisonRows]);

  useEffect(() => {
    setSearchParams({
      mode: periodMode,
      date: selectedDate,
      week: weekValue,
      month: monthValue,
    });
  }, [periodMode, selectedDate, weekValue, monthValue, setSearchParams]);

  useEffect(() => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews));
  }, [savedViews]);

  useEffect(() => {
    const loadComparisons = async () => {
      let currentStart = selectedDate;
      let currentEnd = selectedDate;
      let days = 1;

      if (periodMode !== "day") {
        if (!rangeDays) {
          setAppComparisonRows([]);
          setCategoryComparisonRows([]);
          setProjectComparisonRows([]);
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
      const prevStart = fmt(prevStartDate);
      const prevEnd = fmt(prevEndDate);

      setComparisonLoading(true);
      try {
        const apps = await api.getAppComparisonInRanges(currentStart, currentEnd, prevStart, prevEnd);
        setAppComparisonRows(apps);
      } catch {
        setAppComparisonRows([]);
      }

      if (comparisonTab === "categories") {
        try {
          const categories = await api.getCategoryComparisonInRanges(currentStart, currentEnd, prevStart, prevEnd);
          setCategoryComparisonRows(categories);
        } catch {
          setCategoryComparisonRows([]);
        }
      }

      if (comparisonTab === "projects") {
        try {
          const projects = await api.getProjectComparisonInRanges(currentStart, currentEnd, prevStart, prevEnd);
          setProjectComparisonRows(projects);
        } catch {
          setProjectComparisonRows([]);
        }
      }

      setComparisonLoading(false);
    };

    void loadComparisons();
  }, [periodMode, selectedDate, rangeDays, comparisonTab]);

  useEffect(() => {
    const loadHotspots = async () => {
      let start = selectedDate;
      let end = selectedDate;
      if (periodMode !== "day" && rangeDays) {
        start = rangeDays.start;
        end = rangeDays.end;
      }
      setHotspotsLoading(true);
      try {
        const rows = await api.getDistractionHotspots(start, end, 5);
        setHotspots(rows);
      } catch {
        setHotspots([]);
      } finally {
        setHotspotsLoading(false);
      }
    };

    void loadHotspots();
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

  const handleSaveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const next: DashboardInsightsSavedView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      mode: periodMode,
      selectedDate,
      weekValue,
      monthValue,
      createdAt: new Date().toISOString(),
    };
    setSavedViews((prev) => [next, ...prev].slice(0, 12));
    setViewName("");
  };

  const handleApplyView = (view: DashboardInsightsSavedView) => {
    setPeriodMode(view.mode);
    setSelectedDate(view.selectedDate);
    setWeekValue(view.weekValue);
    setMonthValue(view.monthValue);
  };

  const handleDeleteView = (id: string) => {
    setSavedViews((prev) => prev.filter((v) => v.id !== id));
  };

  const isViewActive = (view: DashboardInsightsSavedView) =>
    view.mode === periodMode &&
    view.selectedDate === selectedDate &&
    view.weekValue === weekValue &&
    view.monthValue === monthValue;

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between min-h-[52px] gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("dashboard:insightWorkspace.title")}</h1>
          <p className="text-text-muted text-xs mt-0.5">{t("dashboard:timeline.title")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
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

      {/* Saved views */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-text-primary">{t("dashboard:savedViewsTitle")}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_auto] gap-2">
          <input
            type="text"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder={t("dashboard:savedViewNamePlaceholder")}
            className="ui-field !text-xs"
          />
          <button
            onClick={handleSaveView}
            disabled={!viewName.trim()}
            className="ui-btn-secondary !text-xs disabled:opacity-40"
          >
            {t("dashboard:saveCurrentView")}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {savedViews.length === 0 && (
            <p className="text-xs text-text-muted">{t("dashboard:noSavedViews")}</p>
          )}
          {savedViews.map((view) => (
            <div
              key={view.id}
              className={[
                "inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs",
                isViewActive(view)
                  ? "border-accent-blue/50 text-accent-blue bg-accent-blue/10"
                  : "border-surface-border text-text-secondary bg-surface-hover/40",
              ].join(" ")}
            >
              <button
                onClick={() => handleApplyView(view)}
                className="hover:text-text-primary transition-colors"
                title={t("dashboard:applyView")}
              >
                {view.name}
              </button>
              <button
                onClick={() => handleDeleteView(view.id)}
                className="text-text-muted hover:text-accent-red transition-colors"
                title={t("dashboard:deleteView")}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* What changed */}
      {comparisonLoading ? (
        <AsyncStateCard variant="loading" title={t("common:loading")} compact />
      ) : comparisonSummary ? (
        <div className="glass-card p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-text-primary">{t("dashboard:whatChangedTitle")}</h3>
              <div className="flex gap-1 bg-surface-hover rounded-lg p-0.5">
                {(["apps", "categories", "projects"] as ComparisonTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setComparisonTab(tab)}
                    className={[
                      "px-2 py-1 rounded-md text-xs font-medium transition-colors",
                      comparisonTab === tab
                        ? "bg-accent-blue text-white"
                        : "text-text-secondary hover:text-text-primary",
                    ].join(" ")}
                  >
                    {t(`dashboard:comparisonTab${tab[0].toUpperCase()}${tab.slice(1)}`)}
                  </button>
                ))}
              </div>
            </div>
            <span className={comparisonSummary.delta >= 0 ? "text-xs text-accent-red" : "text-xs text-accent-green"}>
              {t("dashboard:whatChangedDelta", {
                sign: comparisonSummary.delta >= 0 ? "+" : "-",
                value: formatDuration(Math.abs(comparisonSummary.delta)),
              })}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-text-muted">{t("dashboard:whatChangedTopIncrease")}</p>
              <p className="text-text-primary mt-1 font-medium truncate">
                {comparisonSummary.topIncreaseName ?? t("dashboard:noDataShort")}
              </p>
              <p className="text-accent-red mt-0.5">
                {comparisonSummary.topIncreaseName ? `+${formatDuration(comparisonSummary.topIncreaseDelta)}` : "-"}
              </p>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-text-muted">{t("dashboard:whatChangedTopDecrease")}</p>
              <p className="text-text-primary mt-1 font-medium truncate">
                {comparisonSummary.topDecreaseName ?? t("dashboard:noDataShort")}
              </p>
              <p className="text-accent-green mt-0.5">
                {comparisonSummary.topDecreaseName ? `-${formatDuration(Math.abs(comparisonSummary.topDecreaseDelta))}` : "-"}
              </p>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-text-muted">{t("dashboard:whatChangedNewApps")}</p>
              <p className="text-text-primary mt-1 font-medium">{comparisonSummary.newCount}</p>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-text-muted">{t("dashboard:whatChangedStoppedApps")}</p>
              <p className="text-text-primary mt-1 font-medium">{comparisonSummary.stoppedCount}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {topAppIncreaseRow && (
              <button
                onClick={() => navigate(`/categories?appName=${encodeURIComponent(topAppIncreaseRow.app_name)}&exePath=${encodeURIComponent(topAppIncreaseRow.exe_path || "")}`)}
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

      {/* Distraction hotspots */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{t("dashboard:distractionHotspotsTitle")}</h3>
            <p className="text-xs text-text-muted mt-0.5">{t("dashboard:distractionHotspotsSubtitle")}</p>
          </div>
        </div>
        {hotspotsLoading ? (
          <AsyncStateCard variant="loading" title={t("common:loading")} compact />
        ) : hotspots.length === 0 ? (
          <AsyncStateCard variant="empty" title={t("dashboard:distractionHotspotsEmpty")} compact />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {hotspots.map((spot, i) => (
              <div
                key={`${spot.app_name}-${spot.exe_path || i}`}
                className="rounded-xl border border-surface-border bg-surface-hover/40 p-3 space-y-1.5"
              >
                <p className="text-sm font-medium text-text-primary truncate">{spot.app_name}</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-text-muted">{t("dashboard:hotspotSwitchCount")}</p>
                    <p className="text-text-primary font-medium">{spot.switch_count}</p>
                  </div>
                  <div>
                    <p className="text-text-muted">{t("dashboard:hotspotShortSessionRatio")}</p>
                    <p className="text-text-primary font-medium">{Math.round(spot.short_session_ratio * 100)}%</p>
                  </div>
                  <div>
                    <p className="text-text-muted">{t("dashboard:hotspotFragmentScore")}</p>
                    <p className="text-text-primary font-medium">{spot.fragment_score.toFixed(2)}</p>
                  </div>
                </div>
                <p className="text-xs text-text-secondary">{spot.reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>

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
