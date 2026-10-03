import { beforeEach, describe, expect, it } from "vitest";
import {
  DASHBOARD_WINDOW_IDS,
  useDashboardLayoutStore,
  type DashboardWindowConfig,
} from "./dashboardLayoutStore";

const PERSIST_KEY = "timelens-dashboard-layout";
const initialState = useDashboardLayoutStore.getState();

const expectedDefaultLayout = (): DashboardWindowConfig[] =>
  DASHBOARD_WINDOW_IDS.map((id) => ({ id, visible: true }));

const readPersisted = () =>
  JSON.parse(window.localStorage.getItem(PERSIST_KEY) ?? "null") as {
    state: { layout: DashboardWindowConfig[]; todayOverviewCards: Record<string, boolean> };
    version: number;
  } | null;

beforeEach(() => {
  window.localStorage.clear();
  useDashboardLayoutStore.setState(initialState, false);
});

describe("dashboardLayoutStore defaults", () => {
  it("shows every dashboard window and both today overview cards by default", () => {
    const state = useDashboardLayoutStore.getState();
    expect(state.layout).toEqual(expectedDefaultLayout());
    expect(state.todayOverviewCards).toEqual({ mostUsed: true, vscode: true });
  });
});

describe("dashboardLayoutStore card visibility", () => {
  it("hides a single window and persists the change", () => {
    useDashboardLayoutStore.getState().hideWindow("appRanking");

    const layout = useDashboardLayoutStore.getState().layout;
    expect(layout.find((item) => item.id === "appRanking")).toEqual({ id: "appRanking", visible: false });
    expect(layout.filter((item) => item.visible)).toHaveLength(DASHBOARD_WINDOW_IDS.length - 1);

    const persisted = readPersisted();
    expect(persisted?.state.layout.find((item) => item.id === "appRanking")?.visible).toBe(false);
  });

  it("restores a hidden window and persists the change", () => {
    useDashboardLayoutStore.getState().hideWindow("usageHeatmap");
    useDashboardLayoutStore.getState().restoreWindow("usageHeatmap");

    const layout = useDashboardLayoutStore.getState().layout;
    expect(layout).toEqual(expectedDefaultLayout());
    expect(readPersisted()?.state.layout).toEqual(expectedDefaultLayout());
  });

  it("toggles today overview cards and persists them", () => {
    useDashboardLayoutStore.getState().setTodayOverviewCardVisibility("mostUsed", false);

    expect(useDashboardLayoutStore.getState().todayOverviewCards).toEqual({ mostUsed: false, vscode: true });
    expect(readPersisted()?.state.todayOverviewCards).toEqual({ mostUsed: false, vscode: true });

    useDashboardLayoutStore.getState().setTodayOverviewCardVisibility("vscode", false);
    expect(useDashboardLayoutStore.getState().todayOverviewCards).toEqual({ mostUsed: false, vscode: false });
  });
});

describe("dashboardLayoutStore restoreDefault", () => {
  it("restores the exact default layout and card visibility after customization", () => {
    const store = useDashboardLayoutStore.getState();
    store.hideWindow("goalProgress");
    store.hideWindow("trendCompare");
    store.setTodayOverviewCardVisibility("mostUsed", false);
    expect(useDashboardLayoutStore.getState().layout).not.toEqual(expectedDefaultLayout());

    useDashboardLayoutStore.getState().restoreDefault();

    const state = useDashboardLayoutStore.getState();
    expect(state.layout).toEqual(expectedDefaultLayout());
    expect(state.todayOverviewCards).toEqual({ mostUsed: true, vscode: true });
    expect(readPersisted()?.state.layout).toEqual(expectedDefaultLayout());
  });
});

describe("dashboardLayoutStore ordering", () => {
  it("moveDown swaps a window with the one below it", () => {
    useDashboardLayoutStore.getState().moveDown("goalProgress");

    const ids = useDashboardLayoutStore.getState().layout.map((item) => item.id);
    expect(ids[0]).toBe("todayOverview");
    expect(ids[1]).toBe("goalProgress");
  });

  it("moveUp on the first window is a no-op", () => {
    useDashboardLayoutStore.getState().moveUp("goalProgress");

    expect(useDashboardLayoutStore.getState().layout).toEqual(expectedDefaultLayout());
  });

  it("moveWindow reinserts the active window at the target position", () => {
    useDashboardLayoutStore.getState().moveWindow("goalProgress", "appList");

    const ids = useDashboardLayoutStore.getState().layout.map((item) => item.id);
    expect(ids).toHaveLength(DASHBOARD_WINDOW_IDS.length);
    expect(ids[0]).toBe("todayOverview");
    // goalProgress is spliced into appList's slot; appList stays ahead of it.
    expect(ids[7]).toBe("appList");
    expect(ids[8]).toBe("goalProgress");
    expect(ids[9]).toBe("avgDailyUsage");
    expect(new Set(ids)).toEqual(new Set(DASHBOARD_WINDOW_IDS));
  });

  it("keeps visibility flags while reordering", () => {
    useDashboardLayoutStore.getState().hideWindow("goalProgress");
    useDashboardLayoutStore.getState().moveDown("goalProgress");

    const layout = useDashboardLayoutStore.getState().layout;
    expect(layout.find((item) => item.id === "goalProgress")?.visible).toBe(false);
  });
});

describe("dashboardLayoutStore persisted payload normalization", () => {
  it("drops unknown ids and duplicates and back-fills missing windows on rehydrate", async () => {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify({
      version: 0,
      state: {
        layout: [
          { id: "bogus", visible: false },
          { id: "appRanking", visible: false },
          { id: "appRanking", visible: false },
        ],
      },
    }));

    await useDashboardLayoutStore.persist.rehydrate();

    const layout = useDashboardLayoutStore.getState().layout;
    expect(layout).toHaveLength(DASHBOARD_WINDOW_IDS.length);
    const appRanking = layout.filter((item) => item.id === "appRanking");
    expect(appRanking).toEqual([{ id: "appRanking", visible: false }]);
    expect(layout.map((item) => item.id)).not.toContain("bogus");
    expect(layout.filter((item) => item.visible)).toHaveLength(DASHBOARD_WINDOW_IDS.length - 1);
  });

  it("keeps defaults when the persisted payload is not an object", async () => {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ version: 99, state: 42 }));

    await useDashboardLayoutStore.persist.rehydrate();

    const state = useDashboardLayoutStore.getState();
    expect(state.layout).toEqual(expectedDefaultLayout());
    expect(state.todayOverviewCards).toEqual({ mostUsed: true, vscode: true });
  });
});
