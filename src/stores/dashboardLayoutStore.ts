import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DASHBOARD_WINDOW_IDS = [
  "goalProgress",
  "todayOverview",
  "productivity",
  "appRanking",
  "hourlyTimeline",
  "categoryInsights",
  "usageHeatmap",
  "trendCompare",
  "appList",
  "avgDailyUsage",
  "weeklyCompare",
] as const;

export type DashboardWindowId = (typeof DASHBOARD_WINDOW_IDS)[number];

export interface DashboardWindowConfig {
  id: DashboardWindowId;
  visible: boolean;
}

export interface TodayOverviewCardVisibility {
  mostUsed: boolean;
  vscode: boolean;
}

const defaultTodayOverviewCards = (): TodayOverviewCardVisibility => ({
  mostUsed: true,
  vscode: true,
});

const defaultLayout = (): DashboardWindowConfig[] => DASHBOARD_WINDOW_IDS.map((id) => ({
  id,
  visible: true,
}));

function normalizeLayout(layout?: DashboardWindowConfig[]): DashboardWindowConfig[] {
  const incoming = Array.isArray(layout) ? layout : [];
  const next: DashboardWindowConfig[] = [];
  const seen = new Set<DashboardWindowId>();

  for (const item of incoming) {
    if (!DASHBOARD_WINDOW_IDS.includes(item.id)) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push({ id: item.id, visible: !!item.visible });
  }

  for (const id of DASHBOARD_WINDOW_IDS) {
    if (!seen.has(id)) {
      next.push({ id, visible: true });
    }
  }

  return next;
}

interface DashboardLayoutState {
  layout: DashboardWindowConfig[];
  todayOverviewCards: TodayOverviewCardVisibility;
  moveWindow: (activeId: DashboardWindowId, overId: DashboardWindowId) => void;
  moveUp: (id: DashboardWindowId) => void;
  moveDown: (id: DashboardWindowId) => void;
  hideWindow: (id: DashboardWindowId) => void;
  restoreWindow: (id: DashboardWindowId) => void;
  setTodayOverviewCardVisibility: (card: keyof TodayOverviewCardVisibility, visible: boolean) => void;
  restoreDefault: () => void;
}

export const useDashboardLayoutStore = create<DashboardLayoutState>()(
  persist(
    (set) => ({
      layout: defaultLayout(),
      todayOverviewCards: defaultTodayOverviewCards(),
      moveWindow: (activeId, overId) => {
        if (activeId === overId) return;
        set((state) => {
          const next = [...state.layout];
          const from = next.findIndex((item) => item.id === activeId);
          const to = next.findIndex((item) => item.id === overId);
          if (from < 0 || to < 0 || from === to) return state;
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { layout: next };
        });
      },
      moveUp: (id) => {
        set((state) => {
          const next = [...state.layout];
          const idx = next.findIndex((item) => item.id === id);
          if (idx <= 0) return state;
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          return { layout: next };
        });
      },
      moveDown: (id) => {
        set((state) => {
          const next = [...state.layout];
          const idx = next.findIndex((item) => item.id === id);
          if (idx < 0 || idx >= next.length - 1) return state;
          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
          return { layout: next };
        });
      },
      hideWindow: (id) => {
        set((state) => ({
          layout: state.layout.map((item) => (item.id === id ? { ...item, visible: false } : item)),
        }));
      },
      restoreWindow: (id) => {
        set((state) => ({
          layout: state.layout.map((item) => (item.id === id ? { ...item, visible: true } : item)),
        }));
      },
      setTodayOverviewCardVisibility: (card, visible) => {
        set((state) => ({
          todayOverviewCards: {
            ...state.todayOverviewCards,
            [card]: visible,
          },
        }));
      },
      restoreDefault: () => set({
        layout: defaultLayout(),
        todayOverviewCards: defaultTodayOverviewCards(),
      }),
    }),
    {
      name: "timelens-dashboard-layout",
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<DashboardLayoutState> | undefined;
        return {
          ...currentState,
          ...persisted,
          layout: normalizeLayout(persisted?.layout),
        };
      },
    }
  )
);
