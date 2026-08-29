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
  WidgetRuntimeHealth,
  MonitorStatus,
  ActiveWindowInfo,
  AppSettingsPayload,
  BrowserExtensionStatus,
  BrowserHourDomainStats,
  BrowserDomainStats,
  BrowserDomainLimit,
  VsCodeLanguageStats,
  VsCodeProjectStats,
  VsCodeSessionPayload,
  VsCodeStatsSummary,
  VsCodeTrackingStatus,
  InstallChannelInfo,
  BackupApplyResult,
  BackupManifest,
  BackupPreview,
  DataHealthSummary,
  RepairAssistantResult,
  ShortcutSettings,
  RetentionPolicyInfo,
  RetentionRunResult,
  TrackingTransparencyReport,
  DataIntegrityResult,
  DataGapResult,
  OrphanRowResult,
  MigrationRehearsalReport,
  MigrationStatus,
  ArchiveSchedulerSettings,
  CompressionResult,
  ProfileInfo,
  LegacyDataInfo,
  EncryptionStatus,
  WidgetRegistryResponse,
  WidgetRegistryItem,
  ProductivityScore,
  InterruptionPeriod,
  FocusWindowSuggestion,
  GoalAdjustmentSuggestion,
  UsageAnomalyMarker,
  DistractionHotspot,
  CategoryComparison,
  ProjectComparison,
  GoalRiskAlert,
  FocusRule,
  FocusRuleMatch,
  ApiTokenMetadata,
  IssuedApiToken,
  ApiAuditLogEntry,
  LocalApiSecuritySettings,
  WidgetPermissionEntry,
  WidgetPermissionAuditEntry,
  WidgetQueryRequest,
  WidgetErrorLogEntry,
  WidgetLifecycleEvent,
  WidgetGatewayRequest,
  WidgetGatewayResponse,
} from "@/types";

let localApiBaseUrl = "http://127.0.0.1:49152";
let localApiBaseUrlPromise: Promise<string> | null = null;
const unsupportedLocalApiPaths = new Set<string>();
let vscodeApiUnavailable = false;
let vscodeUnavailableNotified = false;

export const VSCODE_EXTENSION_UNAVAILABLE_EVENT = "timelens-vscode-extension-unavailable";

/**
 * Resolve the actual local API base URL from the backend. The backend may bind
 * to a fallback port when the default port (49152) is blocked, so the URL is
 * fetched from the Tauri command and cached for the rest of the session.
 */
export async function getLocalApiBaseUrl(): Promise<string> {
  if (localApiBaseUrlPromise) {
    return localApiBaseUrlPromise;
  }
  localApiBaseUrlPromise = (async () => {
    try {
      const url = await invoke<string>("get_local_api_base_url");
      if (url) {
        localApiBaseUrl = url;
      }
    } catch {
      // Fall back to the default URL if the command is unavailable.
    }
    return localApiBaseUrl;
  })();
  return localApiBaseUrlPromise;
}
export async function importSkinImage(source: string): Promise<string> {
  return invoke<string>("import_skin_image", { source });
}

function localApiPathKey(path: string): string {
  const idx = path.indexOf("?");
  return idx >= 0 ? path.slice(0, idx) : path;
}

function isVsCodeApiPath(path: string): boolean {
  return localApiPathKey(path).startsWith("/api/vscode/");
}

function emitVsCodeUnavailableOnce() {
  if (vscodeUnavailableNotified) return;
  vscodeUnavailableNotified = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(VSCODE_EXTENSION_UNAVAILABLE_EVENT));
  }
}

async function localApiRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const baseUrl = await getLocalApiBaseUrl();
  const resp = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!resp.ok) {
    throw new Error(`Local API request failed: ${resp.status}`);
  }
  if (resp.status === 204) {
    return undefined as T;
  }
  return (await resp.json()) as T;
}

async function localApiRequestWith404Fallback<T>(
  path: string,
  fallback: T,
  init?: RequestInit
): Promise<T> {
  const key = localApiPathKey(path);
  if (isVsCodeApiPath(path) && vscodeApiUnavailable) {
    return fallback;
  }

  if (unsupportedLocalApiPaths.has(key)) {
    return fallback;
  }

  try {
    return await localApiRequest<T>(path, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("404")) {
      unsupportedLocalApiPaths.add(key);
      if (isVsCodeApiPath(path)) {
        vscodeApiUnavailable = true;
        emitVsCodeUnavailableOnce();
      }
      return fallback;
    }

    // The VS Code extension endpoints are optional. Network errors such as
    // "Failed to fetch" (server not yet started or extension not connected)
    // should be treated as "unavailable" rather than crashing the dashboard.
    if (
      isVsCodeApiPath(path) &&
      (error instanceof TypeError ||
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.includes("fetch"))
    ) {
      vscodeApiUnavailable = true;
      emitVsCodeUnavailableOnce();
      return fallback;
    }

    throw error;
  }
}

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

export interface QuietHoursSettings {
  enabled: boolean;
  start: string;
  end: string;
}

export const getQuietHours = (): Promise<QuietHoursSettings> =>
  invoke("get_quiet_hours");

export const setQuietHours = (settings: QuietHoursSettings): Promise<void> =>
  invoke("set_quiet_hours", { settings });

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

// ── Data reliability / v1.2.0 ─────────────────────────────────
export const getDataHealthSummary = (): Promise<DataHealthSummary> =>
  invoke("get_data_health_summary");

export const repairDataIssues = (dryRun: boolean): Promise<RepairAssistantResult> =>
  invoke("repair_data_issues", { dryRun });

export const exportBackupV2 = (
  path: string,
  passphrase?: string,
  layoutPresets?: unknown
): Promise<BackupManifest> =>
  invoke("export_backup_v2", { path, passphrase, layoutPresets });

export const importBackupV2Validate = (
  path: string,
  passphrase?: string
): Promise<BackupPreview> =>
  passphrase === undefined
    ? invoke("import_backup_v2_validate", { path })
    : invoke("import_backup_v2_validate", { path, passphrase });

export const importBackupV2Apply = (
  path: string,
  strategy: "overwrite" | "merge" | "new_profile",
  passphrase?: string
): Promise<BackupApplyResult> =>
  passphrase === undefined
    ? invoke("import_backup_v2_apply", { path, strategy })
    : invoke("import_backup_v2_apply", { path, strategy, passphrase });

export const getRetentionPolicyInfo = (): Promise<RetentionPolicyInfo> =>
  invoke("get_retention_policy_info");

export const setRetentionPolicy = (
  policy: "keep_all" | "3m" | "6m" | "12m"
): Promise<void> =>
  invoke("set_retention_policy", { policy });

export const runLocalArchiveNow = (): Promise<RetentionRunResult> =>
  invoke("run_local_archive_now");

export const getArchiveSchedulerSettings = (): Promise<ArchiveSchedulerSettings> =>
  invoke("get_archive_scheduler_settings");

export const setArchiveSchedulerSettings = (
  settings: ArchiveSchedulerSettings
): Promise<void> => invoke("set_archive_scheduler_settings", { settings });

export const compressArchiveOlderThanDays = (days: number): Promise<CompressionResult> =>
  invoke("compress_archive_older_than_days", { days });

export const getTrackingTransparency = (): Promise<TrackingTransparencyReport> =>
  invoke("get_tracking_transparency");

// ── Data health / migration ────────────────────────────────────

export const checkDataIntegrity = (): Promise<DataIntegrityResult> =>
  invoke("check_data_integrity");

export const scanDataGaps = (): Promise<DataGapResult> => invoke("scan_data_gaps");

export const checkOrphanRows = (): Promise<OrphanRowResult[]> =>
  invoke("check_orphan_rows");

export const runMigrationRehearsal = (): Promise<MigrationRehearsalReport> =>
  invoke("run_migration_rehearsal");

export const getMigrationStatus = (): Promise<MigrationStatus> =>
  invoke("get_migration_status");

// ── Profiles ───────────────────────────────────────────────────

export const listProfiles = (): Promise<ProfileInfo[]> => invoke("list_profiles");

export const createProfile = (name: string): Promise<ProfileInfo> =>
  invoke("create_profile", { name });

export const switchProfile = (profileId: string): Promise<void> =>
  invoke("switch_profile", { profileId });

export const getCurrentProfile = (): Promise<string> => invoke("get_current_profile");

export const detectLegacyData = (): Promise<LegacyDataInfo> =>
  invoke("detect_legacy_data");

export const importLegacyData = (): Promise<void> => invoke("import_legacy_data");

// ── Database encryption ────────────────────────────────────────

export const enableDatabaseEncryption = (passphrase: string): Promise<void> =>
  invoke("enable_database_encryption", { passphrase });

export const disableDatabaseEncryption = (passphrase: string): Promise<void> =>
  invoke("disable_database_encryption", { passphrase });

export const getDatabaseEncryptionStatus = (): Promise<EncryptionStatus> =>
  invoke("get_database_encryption_status");

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

export const getWidgetRegistry = (): Promise<WidgetRegistryResponse> =>
  invoke("get_widget_registry");

export const startJvmWidget = (widgetId: string, widgetType: string): Promise<void> =>
  invoke("start_jvm_widget", { widgetId, widgetType });

export const stopJvmWidget = (widgetId: string): Promise<void> =>
  invoke("stop_jvm_widget", { widgetId });

// ── Widget DB config ──────────────────────────────────────────
export const getAllWidgets = (): Promise<WidgetConfig[]> =>
  invoke("get_all_widgets");

export const getWidgetRuntimeHealth = (widgetId: string): Promise<WidgetRuntimeHealth | null> =>
  invoke("get_widget_runtime_health", { widgetId });

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

export const getTrayIconStyle = (): Promise<string> =>
  invoke("get_tray_icon_style");

export const setTrayIconStyle = (style: "auto" | "color" | "black" | "white"): Promise<void> =>
  invoke("set_tray_icon_style", { style });

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

export const openLogDirectory = (): Promise<string> =>
  invoke("open_log_directory");

export const appendFrontendLog = (
  level: "error" | "warn" | "info" | "debug",
  message: string,
  context?: string
): Promise<void> =>
  invoke("append_frontend_log", { level, message, context });

// ── Browser domain usage ──────────────────────────────────────

export const getBrowserDomainStats = (
  startDate?: string,
  endDate?: string
): Promise<BrowserDomainStats[]> =>
  invoke("get_browser_domain_stats", { startDate, endDate });

export const getBrowserDomainStatsForHour = (
  date: string,
  hour: number,
  limit = 5
): Promise<BrowserHourDomainStats[]> =>
  invoke("get_browser_domain_stats_for_hour", { date, hour, limit });

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

// ── Phase C: extra data channel ───────────────────────────────

export const getHourlyDistributionForDate = (date: string): Promise<HourlyDistribution[]> =>
  invoke("get_hourly_distribution_for_date", { date });

export const getRecentDailyTotalsRange = (startDate: string, endDate: string): Promise<DailyUsage[]> =>
  invoke("get_recent_daily_totals_range", { startDate, endDate });

export const getAppCategoryMap = (): Promise<Record<string, string>> =>
  invoke("get_app_category_map");

// ── Phase A: widget permissions ───────────────────────────────

export const getWidgetPermissions = (widgetId: string): Promise<string[]> =>
  invoke("get_widget_permissions", { widgetId });

export const setWidgetPermissions = (
  widgetId: string,
  permissions: string[],
  actor?: string
): Promise<void> =>
  invoke("set_widget_permissions", { widgetId, permissions, actor });

export const getWidgetPermissionMatrix = (widgetId: string): Promise<WidgetPermissionEntry[]> =>
  invoke("get_widget_permission_matrix", { widgetId });

export const getWidgetPermissionAuditLog = (
  widgetId: string,
  limit = 50
): Promise<WidgetPermissionAuditEntry[]> =>
  invoke("get_widget_permission_audit_log", { widgetId, limit });

export const recordWidgetPermissionAccess = (
  widgetId: string,
  permission: string
): Promise<void> =>
  invoke("record_widget_permission_access", { widgetId, permission });

export const revokeAllWidgetPermissions = (widgetId: string, actor?: string): Promise<void> =>
  invoke("revoke_all_widget_permissions", { widgetId, actor });

export const importLocalWidget = (srcDir: string): Promise<WidgetRegistryItem> =>
  invoke("import_local_widget", { srcDir });

export const importPetPack = (widgetId: string, srcDir: string): Promise<WidgetConfig> =>
  invoke("import_pet_pack", { widgetId, srcDir });

export const setWidgetPaused = (widgetId: string, paused: boolean): Promise<void> =>
  invoke("set_widget_paused", { widgetId, paused });

export const recoverWidget = (widgetId: string): Promise<void> =>
  invoke("recover_widget", { widgetId });

export const widgetQuery = <T = unknown>(
  request: WidgetQueryRequest
): Promise<T> => invoke("widget_query", { request });

export const widgetSubscribe = (
  widgetId: string,
  events: string[]
): Promise<void> => invoke("widget_subscribe", { widgetId, events });

export const widgetUnsubscribe = (widgetId: string): Promise<void> =>
  invoke("widget_unsubscribe", { widgetId });

export const getWidgetState = (
  widgetId: string,
  key: string
): Promise<string | null> => invoke("get_widget_state", { widgetId, key });

export const setWidgetState = (
  widgetId: string,
  key: string,
  value: string
): Promise<void> => invoke("set_widget_state", { widgetId, key, value });

export const deleteWidgetState = (widgetId: string, key: string): Promise<void> =>
  invoke("delete_widget_state", { widgetId, key });

export const emitWidgetLifecycle = (request: WidgetLifecycleEvent): Promise<void> =>
  invoke("emit_widget_lifecycle", { request });

export const recordWidgetError = (
  widgetId: string,
  error: string,
  recoveryHint?: string
): Promise<void> => invoke("record_widget_error", { widgetId, error, recoveryHint });

export const getWidgetErrorLog = (
  widgetId: string,
  limit = 20
): Promise<WidgetErrorLogEntry[]> => invoke("get_widget_error_log", { widgetId, limit });

export const clearWidgetErrorLog = (widgetId: string): Promise<void> =>
  invoke("clear_widget_error_log", { widgetId });

export const resetWidgetPermissionsAndState = (
  widgetId: string,
  actor?: string
): Promise<void> => invoke("reset_widget_permissions_and_state", { widgetId, actor });

export const widgetGatewayRequest = (
  request: WidgetGatewayRequest
): Promise<WidgetGatewayResponse> => invoke("widget_gateway_request", { request });

export const widgetGrantConsent = (
  widgetId: string,
  scope: string,
  remembered = false,
  riskLevel = "low"
): Promise<void> =>
  invoke("widget_grant_consent", { widgetId, scope, remembered, riskLevel });

export const widgetDenyConsent = (
  widgetId: string,
  scope: string,
  remembered = false,
  riskLevel = "low"
): Promise<void> =>
  invoke("widget_deny_consent", { widgetId, scope, remembered, riskLevel });

export const widgetRevokeConsent = (widgetId: string, scope: string): Promise<void> =>
  invoke("widget_revoke_consent", { widgetId, scope });

export const issueWidgetApiToken = (
  widgetId: string,
  scopes: string[]
): Promise<IssuedApiToken> =>
  invoke("issue_widget_api_token", { widgetId, scopes });

// ── Phase D+E: productivity + interruption ────────────────────

export const getProductivityScore = (date: string): Promise<ProductivityScore> =>
  invoke("get_productivity_score", { date });

export const getProductivityScoreRange = (startDate: string, endDate: string): Promise<ProductivityScore[]> =>
  invoke("get_productivity_score_range", { startDate, endDate });

export const getInterruptionPeriods = (date: string): Promise<InterruptionPeriod[]> =>
  invoke("get_interruption_periods", { date });

export const suggestFocusWindows = (lookbackDays?: number): Promise<FocusWindowSuggestion[]> =>
  invoke("suggest_focus_windows", { lookbackDays });

export const suggestGoalAdjustments = (): Promise<GoalAdjustmentSuggestion[]> =>
  invoke("suggest_goal_adjustments");

export const detectUsageAnomalies = (
  date: string,
  baselineDays?: number
): Promise<UsageAnomalyMarker[]> =>
  invoke("detect_usage_anomalies", { date, baselineDays });

// ── Phase 4: backend intelligence + focus rules ───────────────

export const getDistractionHotspots = (
  startDate: string,
  endDate: string,
  limit = 10
): Promise<DistractionHotspot[]> =>
  invoke("get_distraction_hotspots", { startDate, endDate, limit });

export const getCategoryComparisonInRanges = (
  currentStart: string,
  currentEnd: string,
  previousStart: string,
  previousEnd: string
): Promise<CategoryComparison[]> =>
  invoke("get_category_comparison_in_ranges", {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
  });

export const getProjectComparisonInRanges = (
  currentStart: string,
  currentEnd: string,
  previousStart: string,
  previousEnd: string
): Promise<ProjectComparison[]> =>
  invoke("get_project_comparison_in_ranges", {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
  });

export const evaluateGoalRisks = (): Promise<GoalRiskAlert[]> =>
  invoke("evaluate_goal_risks");

export const getFocusRules = (): Promise<FocusRule[]> =>
  invoke("get_focus_rules");

export const saveFocusRule = (rule: FocusRule): Promise<FocusRule> =>
  invoke("save_focus_rule", { rule });

export const deleteFocusRule = (id: number): Promise<void> =>
  invoke("delete_focus_rule", { id });

export const evaluateFocusRules = (): Promise<FocusRuleMatch[]> =>
  invoke("evaluate_focus_rules");

// ── VS Code local API channel ────────────────────────────────

export const postVsCodeSession = (payload: VsCodeSessionPayload): Promise<void> =>
  localApiRequest<void>("/api/vscode/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const getVsCodeStatsToday = (): Promise<VsCodeStatsSummary> =>
  localApiRequest<VsCodeStatsSummary>("/api/vscode/stats/today");

export const getVsCodeStatsInRange = (
  startDate: string,
  endDate: string
): Promise<VsCodeStatsSummary> =>
  localApiRequestWith404Fallback<VsCodeStatsSummary>(
    `/api/vscode/stats/range?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`,
    { total_seconds: 0, session_count: 0 }
  );

export const getVsCodeLanguageStatsInRange = (
  startDate: string,
  endDate: string
): Promise<VsCodeLanguageStats[]> =>
  localApiRequestWith404Fallback<VsCodeLanguageStats[]>(
    `/api/vscode/languages/range?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`,
    []
  );

export const getVsCodeProjectStatsInRange = (
  startDate: string,
  endDate: string
): Promise<VsCodeProjectStats[]> =>
  localApiRequestWith404Fallback<VsCodeProjectStats[]>(
    `/api/vscode/projects/range?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`,
    []
  );

export const setVsCodeTrackingEnabled = (enabled: boolean, trackingLevel?: string): Promise<void> =>
  localApiRequestWith404Fallback<void>("/api/vscode/enabled", undefined, {
    method: "POST",
    body: JSON.stringify({ enabled, ...(trackingLevel ? { tracking_level: trackingLevel } : {}) }),
  });

export const getVsCodeTrackingEnabled = (): Promise<VsCodeTrackingStatus> =>
  localApiRequestWith404Fallback<VsCodeTrackingStatus>("/api/vscode/enabled", { enabled: false });

// ── Extension Bridge Commands ────────────────────────────────────────

export const getExtensionBridgeKey = (): Promise<string> =>
  invoke<string>("get_extension_bridge_key");

export const rotateExtensionBridgeKey = (): Promise<string> =>
  invoke<string>("rotate_extension_bridge_key");

export const issueApiToken = (
  label: string,
  dataScopes: string[],
  operationScopes: string[],
  expiresAt?: string
): Promise<IssuedApiToken> =>
  invoke("issue_api_token", { label, dataScopes, operationScopes, expiresAt });

export const rotateApiToken = (
  tokenId: string,
  expiresAt?: string
): Promise<IssuedApiToken> =>
  invoke("rotate_api_token", { tokenId, expiresAt });

export const revokeApiToken = (tokenId: string): Promise<void> =>
  invoke("revoke_api_token", { tokenId });

export const listApiTokens = (): Promise<ApiTokenMetadata[]> =>
  invoke("list_api_tokens");

export const getApiAuditLog = (
  limit = 100,
  offset = 0,
  clientId?: string,
  endpoint?: string
): Promise<ApiAuditLogEntry[]> =>
  invoke("get_api_audit_log", { limit, offset, clientId, endpoint });

export const getApiClientAllowlist = (): Promise<string[]> =>
  invoke("get_api_client_allowlist");

export const setApiClientAllowlist = (clientIds: string[]): Promise<void> =>
  invoke("set_api_client_allowlist", { clientIds });

export const getLocalApiSecuritySettings = (): Promise<LocalApiSecuritySettings> =>
  invoke("get_local_api_security_settings");

export const setLocalApiSecuritySettings = (
  patch: Partial<LocalApiSecuritySettings>
): Promise<void> =>
  invoke("set_local_api_security_settings", {
    tokenRequired: patch.token_required,
    allowlistEnforced: patch.allowlist_enforced,
    rateLimitPerMin: patch.rate_limit_per_min,
  });

// ── Widget runtime v2.2.0 event listener ──────────────────────

export const listenWidgetEvent = <T = unknown>(
  event: string,
  callback: (payload: T) => void
): Promise<UnlistenFn> =>
  listen<T>(`widget:${event}`, (e) => callback(e.payload));

// ── App lifecycle ─────────────────────────────────────────────

export const relaunchApp = (): Promise<void> => invoke("relaunch_app");
