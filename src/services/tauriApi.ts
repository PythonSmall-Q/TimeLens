import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppUsageSummary,
  AppUsageComparison,
  ExecutableOption,
  HourlyDistribution,
  DailyUsage,
  TodoItem,
  WidgetConfig,
  MonitorStatus,
  ActiveWindowInfo,
  AppSettingsPayload,
  ShortcutSettings,
} from "@/types";

// ── Monitor ───────────────────────────────────────────────────
export const getMonitorStatus = (): Promise<MonitorStatus> =>
  invoke("get_monitor_status");

export const setMonitoringActive = (active: boolean): Promise<void> =>
  invoke("set_monitoring_active", { active });

export const onActiveWindowChanged = (
  cb: (info: ActiveWindowInfo) => void
): Promise<UnlistenFn> =>
  listen<ActiveWindowInfo>("active-window-changed", (e) => cb(e.payload));

// ── Screen time ───────────────────────────────────────────────
export const getTodayAppTotals = (): Promise<AppUsageSummary[]> =>
  invoke("get_today_app_totals");

export const getAppTotalsForDate = (date: string): Promise<AppUsageSummary[]> =>
  invoke("get_app_totals_for_date", { date });

export const getAppTotalsInRange = (
  startDate: string,
  endDate: string
): Promise<AppUsageSummary[]> =>
  invoke("get_app_totals_in_range", { startDate, endDate });

export const getAppComparisonInRanges = (
  currentStart: string,
  currentEnd: string,
  previousStart: string,
  previousEnd: string
): Promise<AppUsageComparison[]> =>
  invoke("get_app_comparison_in_ranges", {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
  });

export const getTodayHourly = (): Promise<HourlyDistribution[]> =>
  invoke("get_today_hourly");

export const getRecentDailyTotals = (days: number): Promise<DailyUsage[]> =>
  invoke("get_recent_daily_totals", { days });

export const getRecentExecutables = (limit = 200): Promise<ExecutableOption[]> =>
  invoke("get_recent_executables", { limit });

export const getRunningExecutables = (): Promise<ExecutableOption[]> =>
  invoke("get_running_executables");

export const getIgnoredApps = (): Promise<string[]> =>
  invoke("get_ignored_apps");

export const setIgnoredApps = (exePaths: string[]): Promise<void> =>
  invoke("set_ignored_apps", { exePaths });

// ── Todos ─────────────────────────────────────────────────────
export const getTodos = (): Promise<TodoItem[]> => invoke("get_todos");

export const addTodo = (content: string): Promise<TodoItem> =>
  invoke("add_todo", { content });

export const toggleTodo = (id: number): Promise<void> =>
  invoke("toggle_todo", { id });

export const deleteTodo = (id: number): Promise<void> =>
  invoke("delete_todo", { id });

export const reorderTodos = (orderedIds: number[]): Promise<void> =>
  invoke("reorder_todos", { orderedIds });

// ── Widget windows ────────────────────────────────────────────
export const createWidget = (widgetType: string): Promise<WidgetConfig> =>
  invoke("create_widget", { widgetType });

export const openWidget = (config: WidgetConfig): Promise<void> =>
  invoke("open_widget", { config });

export const closeWidget = (id: string): Promise<void> =>
  invoke("close_widget", { id });

export const setWidgetAlwaysOnTop = (id: string, mode: string): Promise<void> =>
  invoke("set_widget_always_on_top", { id, mode });

// ── Widget DB config ──────────────────────────────────────────
export const getAllWidgets = (): Promise<WidgetConfig[]> =>
  invoke("get_all_widgets");

export const saveWidgetConfig = (config: WidgetConfig): Promise<void> =>
  invoke("save_widget_config", { config });

export const removeWidgetConfig = (id: string): Promise<void> =>
  invoke("remove_widget_config", { id });

// ── App settings / startup / shortcuts ───────────────────────
export const getAppSettings = (): Promise<AppSettingsPayload> =>
  invoke("get_app_settings");

export const setLaunchAtStartup = (enabled: boolean): Promise<void> =>
  invoke("set_launch_at_startup", { enabled });

export const setSilentStartup = (enabled: boolean): Promise<void> =>
  invoke("set_silent_startup", { enabled });

export const setShortcuts = (shortcuts: ShortcutSettings): Promise<void> =>
  invoke("set_shortcuts", { shortcuts });

export const setAutoOpenWidgets = (enabled: boolean): Promise<void> =>
  invoke("set_auto_open_widgets", { enabled });
