import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUsageSummary, MonitorStatus } from "@/types";
import { todayString } from "@/utils/format";
import { useStatsStore } from "./statsStore";

const mockGetTodayAppTotals = vi.fn();
const mockGetTodayHourly = vi.fn();
const mockGetAppTotalsForDate = vi.fn();
const mockGetMonitorStatus = vi.fn();

vi.mock("@/services/tauriApi", () => ({
  getTodayAppTotals: (...args: unknown[]) => mockGetTodayAppTotals(...args),
  getTodayHourly: (...args: unknown[]) => mockGetTodayHourly(...args),
  getAppTotalsForDate: (...args: unknown[]) => mockGetAppTotalsForDate(...args),
  getMonitorStatus: (...args: unknown[]) => mockGetMonitorStatus(...args),
}));

const makeTotal = (app_name: string, total_seconds: number): AppUsageSummary => ({
  app_name,
  exe_path: `C:\\apps\\${app_name}.exe`,
  total_seconds,
});

const monitorStatus: MonitorStatus = {
  active: false,
  current_app: "Code.exe",
  current_exe_path: "C:\\apps\\Code.exe",
  current_title: "statsStore.ts",
};

const initialState = useStatsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useStatsStore.setState(initialState, false);
});

describe("statsStore initial state", () => {
  it("starts empty with monitoring defaults and day period mode", () => {
    const state = useStatsStore.getState();
    expect(state.todayTotals).toEqual([]);
    expect(state.todayHourly).toEqual([]);
    expect(state.totalSecondsToday).toBe(0);
    expect(state.sidebarTodaySeconds).toBe(0);
    expect(state.monitorStatus).toEqual({
      active: true,
      current_app: "",
      current_exe_path: "",
      current_title: "",
    });
    expect(state.currentApp).toBe("");
    expect(state.loading).toBe(false);
    expect(state.hasLoaded).toBe(false);
    expect(state.periodMode).toBe("day");
    expect(state.selectedDate).toBe(todayString());
    expect(state.vscodeStats).toEqual({ total_seconds: 0, session_count: 0 });
  });
});

describe("statsStore fetchToday", () => {
  it("loads totals and hourly, summing sidebarTodaySeconds alongside totalSecondsToday", async () => {
    const totals = [makeTotal("Code", 3600), makeTotal("Browser", 600)];
    const hourly = [{ hour: 9, seconds: 1200 }, { hour: 10, seconds: 3000 }];
    mockGetTodayAppTotals.mockResolvedValue(totals);
    mockGetTodayHourly.mockResolvedValue(hourly);

    await useStatsStore.getState().fetchToday();

    const state = useStatsStore.getState();
    expect(state.todayTotals).toEqual(totals);
    expect(state.todayHourly).toEqual(hourly);
    expect(state.totalSecondsToday).toBe(4200);
    expect(state.sidebarTodaySeconds).toBe(4200);
    expect(state.loading).toBe(false);
    expect(state.hasLoaded).toBe(true);
  });

  it("marks hasLoaded and still clears loading when the backend fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetTodayAppTotals.mockRejectedValue(new Error("db locked"));

    await useStatsStore.getState().fetchToday();

    expect(errorSpy).toHaveBeenCalledWith("fetchToday failed", expect.any(Error));
    const state = useStatsStore.getState();
    expect(state.todayTotals).toEqual([]);
    expect(state.totalSecondsToday).toBe(0);
    expect(state.loading).toBe(false);
    expect(state.hasLoaded).toBe(true);
  });
});

describe("statsStore fetchTodaySummary", () => {
  it("updates only sidebarTodaySeconds, leaving dashboard totals untouched", async () => {
    mockGetTodayAppTotals.mockResolvedValue([makeTotal("Code", 900)]);

    await useStatsStore.getState().fetchTodaySummary();

    const state = useStatsStore.getState();
    expect(state.sidebarTodaySeconds).toBe(900);
    expect(state.todayTotals).toEqual([]);
    expect(state.totalSecondsToday).toBe(0);
    expect(mockGetTodayHourly).not.toHaveBeenCalled();
  });
});

describe("statsStore date selection", () => {
  it("fetchForDate loads totals for the date without hourly data", async () => {
    const totals = [makeTotal("Code", 120)];
    mockGetAppTotalsForDate.mockResolvedValue(totals);

    await useStatsStore.getState().fetchForDate("2024-01-15");

    expect(mockGetAppTotalsForDate).toHaveBeenCalledWith("2024-01-15");
    expect(mockGetTodayHourly).not.toHaveBeenCalled();
    const state = useStatsStore.getState();
    expect(state.selectedDate).toBe("2024-01-15");
    expect(state.todayTotals).toEqual(totals);
    expect(state.totalSecondsToday).toBe(120);
    expect(state.todayHourly).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.hasLoaded).toBe(true);
  });

  it("fetchForDate reuses today hourly data when the date is today", async () => {
    const hourly = [{ hour: 8, seconds: 60 }];
    mockGetAppTotalsForDate.mockResolvedValue([]);
    mockGetTodayHourly.mockResolvedValue(hourly);

    await useStatsStore.getState().fetchForDate(todayString());

    expect(mockGetTodayHourly).toHaveBeenCalledTimes(1);
    expect(useStatsStore.getState().todayHourly).toEqual(hourly);
  });

  it("fetchForDate resets totals to empty when the backend fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetAppTotalsForDate.mockRejectedValue(new Error("db locked"));

    await useStatsStore.getState().fetchForDate("2024-01-15");

    expect(errorSpy).toHaveBeenCalledWith("fetchForDate failed", expect.any(Error));
    const state = useStatsStore.getState();
    expect(state.selectedDate).toBe("2024-01-15");
    expect(state.todayTotals).toEqual([]);
    expect(state.totalSecondsToday).toBe(0);
    expect(state.loading).toBe(false);
    expect(state.hasLoaded).toBe(true);
  });

  it("setSelectedDate delegates to fetchForDate", async () => {
    const totals = [makeTotal("Code", 30)];
    mockGetAppTotalsForDate.mockResolvedValue(totals);

    useStatsStore.getState().setSelectedDate("2024-02-20");

    expect(mockGetAppTotalsForDate).toHaveBeenCalledWith("2024-02-20");
    expect(useStatsStore.getState().selectedDate).toBe("2024-02-20");
  });

  it("setPeriodMode switches the mode without touching data", async () => {
    useStatsStore.getState().setPeriodMode("week");
    expect(useStatsStore.getState().periodMode).toBe("week");

    useStatsStore.getState().setPeriodMode("month");
    expect(useStatsStore.getState().periodMode).toBe("month");

    expect(mockGetAppTotalsForDate).not.toHaveBeenCalled();
    expect(useStatsStore.getState().selectedDate).toBe(todayString());
  });
});

describe("statsStore monitor state", () => {
  it("fetchMonitorStatus syncs monitorStatus and currentApp from the backend", async () => {
    mockGetMonitorStatus.mockResolvedValue(monitorStatus);

    await useStatsStore.getState().fetchMonitorStatus();

    const state = useStatsStore.getState();
    expect(state.monitorStatus).toEqual(monitorStatus);
    expect(state.currentApp).toBe("Code.exe");
  });

  it("setMonitorActive flips active while keeping the rest of the status", async () => {
    useStatsStore.setState({ monitorStatus });

    useStatsStore.getState().setMonitorActive(true);

    expect(useStatsStore.getState().monitorStatus).toEqual({ ...monitorStatus, active: true });
  });

  it("setCurrentApp updates the current app name", () => {
    useStatsStore.getState().setCurrentApp("Browser.exe");
    expect(useStatsStore.getState().currentApp).toBe("Browser.exe");
  });
});
