import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppUsageSummary,
  AppUsageComparison,
  AppCategoryRule,
  AppUsagePage,
  CategoryDailyUsage,
  CategorySuggestion,
  CategoryUsageSummary,
  ExecutableOption,
  FocusSession,
  GoalProgress,
  HourlyDistribution,
  DailyUsage,
  TodoItem,
  UsageGoal,
  WidgetConfig,
  MonitorStatus,
  ActiveWindowInfo,
  AppSettingsPayload,
  BrowserExtensionStatus,
  BrowserDomainStats,
  BrowserDomainLimit,
  InstallChannelInfo,
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

export const getCategoryTotalsInRange = (
  startDate: string,
  endDate: string
): Promise<CategoryUsageSummary[]> =>
  invoke("get_category_totals_in_range", { startDate, endDate });

export const getDailyTotalsInRange = (
  startDate: string,
  endDate: string
): Promise<DailyUsage[]> =>
  invoke("get_daily_totals_in_range", { startDate, endDate });

export const getCategoryDailyTotalsInRange = (
  startDate: string,
  endDate: string
): Promise<CategoryDailyUsage[]> =>
  invoke("get_category_daily_totals_in_range", { startDate, endDate });

export const getAppCategories = (): Promise<AppCategoryRule[]> =>
  invoke("get_app_categories");

export const upsertAppCategory = (
  appName: string,
  exePath: string,
  category: string,
  source: "manual" | "suggested" = "manual"
): Promise<void> =>
  invoke("upsert_app_category", { appName, exePath, category, source });

export const removeAppCategory = (exePath: string): Promise<void> =>
  invoke("remove_app_category", { exePath });

export const suggestCategoryForApp = (
  appName: string,
  exePath: string
): Promise<CategorySuggestion> =>
  invoke("suggest_category_for_app", { appName, exePath });

export const getUsageGoals = (): Promise<UsageGoal[]> =>
  invoke("get_usage_goals");

export const saveUsageGoal = (goal: UsageGoal): Promise<UsageGoal> =>
  invoke("save_usage_goal", { goal });

export const removeUsageGoal = (id: number): Promise<void> =>
  invoke("remove_usage_goal", { id });

export const getGoalProgress = (weekStartDay = 1): Promise<GoalProgress[]> =>
  invoke("get_goal_progress", { weekStartDay });

export const setFocusModeActive = (active: boolean): Promise<void> =>
  invoke("set_focus_mode_active", { active });

export const getFocusModeActive = (): Promise<boolean> =>
  invoke("get_focus_mode_active");

export const startFocusSession = (
  reason?: string,
  triggerType: "manual" | "rule" = "manual"
): Promise<number> =>
  invoke("start_focus_session", { reason, triggerType });

export const stopFocusSession = (id: number): Promise<void> =>
  invoke("stop_focus_session", { id });

export const listFocusSessions = (
  startAt?: string,
  endAt?: string
): Promise<FocusSession[]> =>
  invoke("list_focus_sessions", { startAt, endAt });

export const getRecentExecutables = (limit = 200): Promise<ExecutableOption[]> =>
  invoke("get_recent_executables", { limit });

export const getRunningExecutables = (): Promise<ExecutableOption[]> =>
  invoke("get_running_executables");

export const getAppUsagePage = (
  startDate?: string,
  endDate?: string,
  limit = 1000,
  offset = 0
): Promise<AppUsagePage> =>
  invoke("get_app_usage_page", { startDate, endDate, limit, offset });

export const getIgnoredApps = (): Promise<string[]> =>
  invoke("get_ignored_apps");

export const setIgnoredApps = (exePaths: string[]): Promise<void> =>
  invoke("set_ignored_apps", { exePaths });

export const exportDataCsv = (): Promise<string> =>
  invoke("export_data_csv");

export const exportDataJson = (): Promise<string> =>
  invoke("export_data_json");

export const importDataJson = (payload: string): Promise<void> =>
  invoke("import_data_json", { payload });

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

export const setIgnoreSystemProcesses = (enabled: boolean): Promise<void> =>
  invoke("set_ignore_system_processes", { enabled });

export const setIdleTimePolicy = (policy: "count" | "exclude"): Promise<void> =>
  invoke("set_idle_time_policy", { policy });

export const setTrackWindowTitles = (enabled: boolean): Promise<void> =>
  invoke("set_track_window_titles", { enabled });

export const getInstallChannelInfo = (): Promise<InstallChannelInfo> =>
  invoke("get_install_channel_info");

export const getBrowserExtensionStatus = (): Promise<BrowserExtensionStatus> =>
  invoke("get_browser_extension_status");

export const setBrowserExtensionEnabled = (enabled: boolean): Promise<void> =>
  invoke("set_browser_extension_enabled", { enabled });

export const sendNativeNotification = (
  title: string,
  body: string,
  alarm = false
): Promise<void> =>
  invoke("send_native_notification", { title, body, alarm });

// ── Browser domain usage ──────────────────────────────────────

export const getBrowserDomainStats = (
  startDate?: string,
  endDate?: string
): Promise<BrowserDomainStats[]> =>
  invoke("get_browser_domain_stats", { startDate, endDate });

export const getBrowserIgnoredDomains = (): Promise<string[]> =>
  invoke("get_browser_ignored_domains");

export const setBrowserIgnoredDomains = (hosts: string[]): Promise<void> =>
  invoke("set_browser_ignored_domains", { hosts });

export const getBrowserDomainLimits = (): Promise<BrowserDomainLimit[]> =>
  invoke("get_browser_domain_limits");

export const saveBrowserDomainLimit = (
  host: string,
  dailyLimitSeconds: number,
  enabled: boolean
): Promise<void> =>
  invoke("save_browser_domain_limit", { host, dailyLimitSeconds, enabled });

export const removeBrowserDomainLimit = (host: string): Promise<void> =>
  invoke("remove_browser_domain_limit", { host });
