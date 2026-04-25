import { create } from "zustand";
import type { AppUsageSummary, HourlyDistribution, DailyUsage, MonitorStatus } from "@/types";
import * as api from "@/services/tauriApi";

interface StatsState {
  // Today
  todayTotals: AppUsageSummary[];
  todayHourly: HourlyDistribution[];
  totalSecondsToday: number;
  // Week
  weeklyTotals: DailyUsage[];
  // Monitor status
  monitorStatus: MonitorStatus;
  currentApp: string;
  // Loading
  loading: boolean;
  // Selected date
  selectedDate: string;

  fetchToday: () => Promise<void>;
  fetchForDate: (date: string) => Promise<void>;
  fetchWeekly: () => Promise<void>;
  fetchMonitorStatus: () => Promise<void>;
  setMonitorActive: (active: boolean) => void;
  setCurrentApp: (app: string) => void;
  setSelectedDate: (date: string) => void;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export const useStatsStore = create<StatsState>((set, get) => ({
  todayTotals: [],
  todayHourly: [],
  totalSecondsToday: 0,
  weeklyTotals: [],
  monitorStatus: { active: true, current_app: "", current_title: "" },
  currentApp: "",
  loading: false,
  selectedDate: todayStr(),

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
}));
