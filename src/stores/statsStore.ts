import { create } from "zustand";
import type {
  AppUsageComparison,
  AppUsageSummary,
  DailyUsage,
  HourlyDistribution,
  MonitorStatus,
} from "@/types";
import * as api from "@/services/tauriApi";

export type PeriodMode = "day" | "week" | "month";

interface StatsState {
  todayTotals: AppUsageSummary[];
  todayHourly: HourlyDistribution[];
  totalSecondsToday: number;
  weeklyTotals: DailyUsage[];
  monitorStatus: MonitorStatus;
  currentApp: string;
  loading: boolean;
  selectedDate: string;
  periodMode: PeriodMode;
  weekComparison: AppUsageComparison[];

  fetchToday: () => Promise<void>;
  fetchForDate: (date: string) => Promise<void>;
  fetchForRange: (startDate: string, endDate: string) => Promise<void>;
  fetchWeekComparison: (
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
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export const useStatsStore = create<StatsState>((set, get) => ({
  todayTotals: [],
  todayHourly: [],
  totalSecondsToday: 0,
  weeklyTotals: [],
  monitorStatus: { active: true, current_app: "", current_exe_path: "", current_title: "" },
  currentApp: "",
  loading: false,
  selectedDate: todayStr(),
  periodMode: "day",
  weekComparison: [],

  fetchToday: async () => {
    set({ loading: true });
    try {
      const [totals, hourly] = await Promise.all([
        api.getTodayAppTotals(),
        api.getTodayHourly(),
      ]);
      const total = totals.reduce((s, r) => s + r.total_seconds, 0);
      set({ todayTotals: totals, todayHourly: hourly, totalSecondsToday: total });
    } catch (e) {
      console.error("fetchToday failed", e);
    } finally {
      set({ loading: false });
    }
  },

  fetchForDate: async (date: string) => {
    set({ loading: true, selectedDate: date });
    try {
      const [totals, hourly] = await Promise.all([
        api.getAppTotalsForDate(date),
        date === todayStr() ? api.getTodayHourly() : Promise.resolve([]),
      ]);
      const total = totals.reduce((s, r) => s + r.total_seconds, 0);
      set({ todayTotals: totals, todayHourly: hourly, totalSecondsToday: total });
    } catch (e) {
      console.error("fetchForDate failed", e);
    } finally {
      set({ loading: false });
    }
  },

  fetchForRange: async (startDate: string, endDate: string) => {
    set({ loading: true });
    try {
      const totals = await api.getAppTotalsInRange(startDate, endDate);
      const total = totals.reduce((s, r) => s + r.total_seconds, 0);
      set({ todayTotals: totals, totalSecondsToday: total, todayHourly: [] });
    } catch (e) {
      console.error("fetchForRange failed", e);
    } finally {
      set({ loading: false });
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
}));
