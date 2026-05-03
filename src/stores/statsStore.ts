import { create } from "zustand";
import type {
  CategoryDailyUsage,
  CategoryUsageSummary,
  AppUsageComparison,
  AppUsageSummary,
  DailyUsage,
  HourlyDistribution,
  MonitorStatus,
  ProductivityScore,
  InterruptionPeriod,
  VsCodeLanguageStats,
  VsCodeProjectStats,
  VsCodeStatsSummary,
} from "@/types";
import * as api from "@/services/tauriApi";

export type PeriodMode = "day" | "week" | "month";

interface StatsState {
  todayTotals: AppUsageSummary[];
  todayHourly: HourlyDistribution[];
  totalSecondsToday: number;
  sidebarTodaySeconds: number;
  weeklyTotals: DailyUsage[];
  monitorStatus: MonitorStatus;
  currentApp: string;
  loading: boolean;
  selectedDate: string;
  periodMode: PeriodMode;
  weekComparison: AppUsageComparison[];
  categoryTotals: CategoryUsageSummary[];
  categoryDailyTotals: CategoryDailyUsage[];
  heatmapDailyTotals: DailyUsage[];
  comparisonResults: AppUsageComparison[];

  fetchToday: () => Promise<void>;
  fetchTodaySummary: () => Promise<void>;
  fetchForDate: (date: string) => Promise<void>;
  fetchForRange: (startDate: string, endDate: string) => Promise<void>;
  fetchCategoryForRange: (startDate: string, endDate: string) => Promise<void>;
  fetchDailyTotalsRange: (startDate: string, endDate: string) => Promise<void>;
  fetchWeekComparison: (
    currentStart: string,
    currentEnd: string,
    previousStart: string,
    previousEnd: string
  ) => Promise<void>;
  fetchComparison: (
    currentStart: string,
    currentEnd: string,
    previousStart: string,
    previousEnd: string
  ) => Promise<void>;
  fetchWeekly: () => Promise<void>;
  fetchMonitorStatus: () => Promise<void>;
  setMonitorActive: (active: boolean) => void;
  setCurrentApp: (app: string) => void;
  setSelectedDate: (date: string) => void;
  setPeriodMode: (mode: PeriodMode) => void;
  // Phase D+E
  productivityScores: ProductivityScore[];
  interruptionPeriods: InterruptionPeriod[];
  fetchProductivityRange: (startDate: string, endDate: string) => Promise<void>;
  fetchInterruptionPeriods: (date: string) => Promise<void>;

  vscodeStats: VsCodeStatsSummary;
  vscodeLanguageStats: VsCodeLanguageStats[];
  vscodeProjectStats: VsCodeProjectStats[];
  fetchVsCodeStatsForRange: (startDate: string, endDate: string) => Promise<void>;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export const useStatsStore = create<StatsState>((set, get) => ({
  todayTotals: [],
  todayHourly: [],
  totalSecondsToday: 0,
  sidebarTodaySeconds: 0,
  weeklyTotals: [],
  monitorStatus: { active: true, current_app: "", current_exe_path: "", current_title: "" },
  currentApp: "",
  loading: false,
  selectedDate: todayStr(),
  periodMode: "day",
  weekComparison: [],
  categoryTotals: [],
  categoryDailyTotals: [],
  heatmapDailyTotals: [],
  comparisonResults: [],
  productivityScores: [],
  interruptionPeriods: [],
  vscodeStats: { total_seconds: 0, session_count: 0 },
  vscodeLanguageStats: [],
  vscodeProjectStats: [],

  fetchToday: async () => {
    set({ loading: true });
    try {
      const [totals, hourly] = await Promise.all([
        api.getTodayAppTotals(),
        api.getTodayHourly(),
      ]);
      const total = totals.reduce((s, r) => s + r.total_seconds, 0);
      set({
        todayTotals: totals,
        todayHourly: hourly,
        totalSecondsToday: total,
        sidebarTodaySeconds: total,
      });
    } catch (e) {
      console.error("fetchToday failed", e);
    } finally {
      set({ loading: false });
    }
  },

  fetchTodaySummary: async () => {
    try {
      const totals = await api.getTodayAppTotals();
      const total = totals.reduce((s, r) => s + r.total_seconds, 0);
      set({ sidebarTodaySeconds: total });
    } catch (e) {
      console.error("fetchTodaySummary failed", e);
    }
  },

  fetchForDate: async (date: string) => {
    set({
      loading: true,
      selectedDate: date,
      todayTotals: [],
      todayHourly: [],
      totalSecondsToday: 0,
    });
    try {
      const [totals, hourly] = await Promise.all([
        api.getAppTotalsForDate(date),
        date === todayStr() ? api.getTodayHourly() : Promise.resolve([]),
      ]);
      const total = totals.reduce((s, r) => s + r.total_seconds, 0);
      set({ todayTotals: totals, todayHourly: hourly, totalSecondsToday: total });
    } catch (e) {
      console.error("fetchForDate failed", e);
      set({ todayTotals: [], todayHourly: [], totalSecondsToday: 0 });
    } finally {
      set({ loading: false });
    }
  },

  fetchForRange: async (startDate: string, endDate: string) => {
    set({ loading: true });
    try {
      const [totals, categoryTotals, categoryDailyTotals, heatmapDailyTotals] = await Promise.all([
        api.getAppTotalsInRange(startDate, endDate),
        api.getCategoryTotalsInRange(startDate, endDate),
        api.getCategoryDailyTotalsInRange(startDate, endDate),
        api.getDailyTotalsInRange(startDate, endDate),
      ]);
      const total = totals.reduce((s, r) => s + r.total_seconds, 0);
      set({
        todayTotals: totals,
        totalSecondsToday: total,
        todayHourly: [],
        categoryTotals,
        categoryDailyTotals,
        heatmapDailyTotals,
      });
    } catch (e) {
      console.error("fetchForRange failed", e);
    } finally {
      set({ loading: false });
    }
  },

  fetchCategoryForRange: async (startDate: string, endDate: string) => {
    try {
      const [categoryTotals, categoryDailyTotals] = await Promise.all([
        api.getCategoryTotalsInRange(startDate, endDate),
        api.getCategoryDailyTotalsInRange(startDate, endDate),
      ]);
      set({ categoryTotals, categoryDailyTotals });
    } catch (e) {
      console.error("fetchCategoryForRange failed", e);
      set({ categoryTotals: [], categoryDailyTotals: [] });
    }
  },

  fetchDailyTotalsRange: async (startDate: string, endDate: string) => {
    try {
      const rows = await api.getDailyTotalsInRange(startDate, endDate);
      set({ heatmapDailyTotals: rows });
    } catch (e) {
      console.error("fetchDailyTotalsRange failed", e);
      set({ heatmapDailyTotals: [] });
    }
  },

  fetchWeekComparison: async (currentStart, currentEnd, previousStart, previousEnd) => {
    try {
      const rows = await api.getAppComparisonInRanges(
        currentStart,
        currentEnd,
        previousStart,
        previousEnd
      );
      set({ weekComparison: rows });
    } catch (e) {
      console.error("fetchWeekComparison failed", e);
      set({ weekComparison: [] });
    }
  },

  fetchComparison: async (currentStart, currentEnd, previousStart, previousEnd) => {
    try {
      const rows = await api.getAppComparisonInRanges(
        currentStart,
        currentEnd,
        previousStart,
        previousEnd
      );
      set({ comparisonResults: rows });
    } catch (e) {
      console.error("fetchComparison failed", e);
      set({ comparisonResults: [] });
    }
  },

  fetchWeekly: async () => {
    try {
      const weekly = await api.getRecentDailyTotals(7);
      set({ weeklyTotals: weekly });
    } catch (e) {
      console.error("fetchWeekly failed", e);
    }
  },

  fetchMonitorStatus: async () => {
    try {
      const status = await api.getMonitorStatus();
      set({ monitorStatus: status, currentApp: status.current_app });
    } catch (e) {
      console.error("fetchMonitorStatus failed", e);
    }
  },

  setMonitorActive: (active: boolean) =>
    set((s) => ({ monitorStatus: { ...s.monitorStatus, active } })),

  setCurrentApp: (app: string) => set({ currentApp: app }),
  setSelectedDate: (date: string) => {
    const { fetchForDate } = get();
    fetchForDate(date);
  },
  setPeriodMode: (periodMode) => set({ periodMode }),

  fetchProductivityRange: async (startDate: string, endDate: string) => {
    try {
      const scores = await api.getProductivityScoreRange(startDate, endDate);
      set({ productivityScores: scores });
    } catch (_) {}
  },

  fetchInterruptionPeriods: async (date: string) => {
    try {
      const periods = await api.getInterruptionPeriods(date);
      set({ interruptionPeriods: periods });
    } catch (_) {}
  },

  fetchVsCodeStatsForRange: async (startDate: string, endDate: string) => {
    try {
      const [stats, languageRows, projectRows] = await Promise.all([
        api.getVsCodeStatsInRange(startDate, endDate),
        api.getVsCodeLanguageStatsInRange(startDate, endDate),
        api.getVsCodeProjectStatsInRange(startDate, endDate),
      ]);
      set({
        vscodeStats: stats,
        vscodeLanguageStats: languageRows,
        vscodeProjectStats: projectRows,
      });
    } catch (e) {
      console.error("fetchVsCodeStatsForRange failed", e);
      set({
        vscodeStats: { total_seconds: 0, session_count: 0 },
        vscodeLanguageStats: [],
        vscodeProjectStats: [],
      });
    }
  },
}));
