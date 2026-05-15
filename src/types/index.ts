// Global type definitions shared across the app
export interface AppUsageSummary {
  app_name: string;
  exe_path: string;
  total_seconds: number;
}

export interface AppUsageComparison {
  app_name: string;
  exe_path: string;
  current_seconds: number;
  previous_seconds: number;
  delta_seconds: number;
  delta_ratio: number;
}

export interface ExecutableOption {
  app_name: string;
  exe_path: string;
}

export interface HourlyDistribution {
  hour: number;
  seconds: number;
}

export interface DailyUsage {
  date: string;
  total_seconds: number;
}

export interface CategoryUsageSummary {
  category: string;
  total_seconds: number;
}

export interface CategoryDailyUsage {
  date: string;
  category: string;
  total_seconds: number;
}

export interface AppCategoryRule {
  app_name: string;
  exe_path: string;
  category: string;
  source: string;
  updated_at: string;
}

export interface CategorySuggestion {
  category: string;
  confidence: number;
  reason: string;
}

export interface UsageGoal {
  id?: number;
  scope_type: "category" | "app";
  scope_value: string;
  period: "daily" | "weekly";
  operator: "at_least" | "at_most";
  target_seconds: number;
  enabled: boolean;
}

export interface GoalProgress {
  goal: UsageGoal;
  used_seconds: number;
  progress_ratio: number;
  is_completed: boolean;
}

export interface FocusSession {
  id?: number;
  started_at: string;
  ended_at: string | null;
  trigger_type: string;
  reason: string;
}

export interface AppUsageRow {
  id?: number;
  date: string;
  app_name: string;
  exe_path: string;
  window_title: string;
  active_seconds: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AppUsagePage {
  rows: AppUsageRow[];
  total: number;
  next_offset: number | null;
}

export interface TodoItem {
  id: number;
  content: string;
  done: boolean;
  created_at: string;
  order_index: number;
}

export interface WidgetConfig {
  id: string;
  widget_type: string;
  monitor_index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  always_on_top_mode: "always" | "focus" | "never";
  pinned: boolean;
  start_on_launch: boolean;
  data_json?: string | null;
}

export interface WidgetRegistryItem {
  widget_type: string;
  display_name: string;
  source: "official" | "third-party";
  description: string | null;
  entry: string | null;
  icon: string | null;
  default_width: number;
  default_height: number;
  permissions: string[];
}

export interface WidgetRegistryLoadError {
  path: string;
  message: string;
}

export interface WidgetRegistryResponse {
  items: WidgetRegistryItem[];
  errors: WidgetRegistryLoadError[];
}

export type DesktopPetStateKey = "idle" | "focus" | "rest";

export interface DesktopPetPackState {
  label: string;
  messages: string[];
  accent_color?: string;
  avatar_emoji?: string;
}

export interface DesktopPetPackManifest {
  manifest_version: string;
  pack_id: string;
  name: string;
  description?: string;
  character_name: string;
  default_avatar_emoji: string;
  states: Record<DesktopPetStateKey, DesktopPetPackState>;
  interactions?: {
    tap_messages?: string[];
  };
}

export interface MonitorStatus {
  active: boolean;
  current_app: string;
  current_exe_path: string;
  current_title: string;
}

export interface ActiveWindowInfo {
  app_name: string;
  exe_path: string;
  window_title: string;
  timestamp: string;
}

export type WidgetType = string;

export interface ShortcutSettings {
  open_widget_center: string;
  toggle_widget_visibility: string;
  start_recording: string;
  pause_recording: string;
}

export interface AppSettingsPayload {
  launch_at_startup: boolean;
  silent_startup: boolean;
  auto_open_widgets: boolean;
  ignore_system_processes: boolean;
  idle_time_policy: "count" | "exclude";
  track_window_titles: boolean;
  browser_extension_enabled: boolean;
  shortcuts: ShortcutSettings;
}

export interface BrowserSession {
  id?: number;
  browser_name: string;
  tab_url: string;
  host: string;
  title: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  locale: string;
  synced_at: string;
}

export interface BrowserExtensionStatus {
  enabled: boolean;
  api_base_url: string;
  connected: boolean;
  last_sync_at: string | null;
  last_browser_name: string | null;
  last_locale: string | null;
  recent_session_count: number;
  recent_sessions: BrowserSession[];
}

export interface InstallChannelInfo {
  platform: "windows" | "macos" | "linux" | "unknown";
  channel: "microsoft-store" | "direct";
  should_trigger_update: boolean;
}

export interface BackupBundleCounts {
  app_usage: number;
  browser_sessions: number;
  todos: number;
  widget_configs: number;
  ignored_apps: number;
  app_settings: number;
}

export interface BackupManifest {
  version: string;
  app_version: string;
  schema_version: string;
  locale: string;
  created_at: string;
  checksum: string;
  counts: BackupBundleCounts;
}

export interface DataHealthIssue {
  code: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  count: number;
}

export interface DataHealthSummary {
  schema_version: string;
  integrity_ok: boolean;
  foreign_key_ok: boolean;
  index_ok: boolean;
  app_usage_rows: number;
  daily_app_usage_rows: number;
  archive_rows: number;
  missing_days: string[];
  zero_usage_days: string[];
  issues: DataHealthIssue[];
}

export interface RepairActionPreview {
  code: string;
  description: string;
}

export interface RepairAssistantResult {
  dry_run: boolean;
  actions: RepairActionPreview[];
  rebuilt_daily_rows: number;
}

export interface BackupPreview {
  manifest: BackupManifest;
  compatible: boolean;
  supported_strategies: Array<"overwrite" | "merge" | "new_profile">;
  warnings: string[];
}

export interface BackupApplyResult {
  manifest: BackupManifest;
  strategy: "overwrite" | "merge" | "new_profile";
  imported_rows: number;
  warnings: string[];
}

export interface RetentionPolicyInfo {
  policy: "keep_all" | "3m" | "6m" | "12m";
  label: string;
  cutoff_date: string | null;
  estimated_rows: number;
  estimated_storage_bytes: number;
}

export interface RetentionRunResult {
  policy: "keep_all" | "3m" | "6m" | "12m";
  cutoff_date: string | null;
  archived_app_usage_rows: number;
  archived_daily_rows: number;
}

export interface TrackingFieldInfo {
  field: string;
  description: string;
}

export interface TrackingWriteEntry {
  date: string;
  app_name: string;
  exe_path: string;
  window_title: string;
  active_seconds: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface TrackingTransparencyReport {
  status: MonitorStatus;
  paused_at: string | null;
  paused_by: string | null;
  pause_reason: string | null;
  tracked_fields: TrackingFieldInfo[];
  writes_last_24h: number;
  writes_last_7d: number;
  recent_writes: TrackingWriteEntry[];
}

export interface AppLimit {
  exePath: string;
  appName: string;
  dailyLimitSeconds: number;
  enabled: boolean;
}

export interface LimitToast {
  id: number;
  appName: string;
  level: 80 | 90;
  used: number;
  limit: number;
}

export interface BrowserDomainStats {
  host: string;
  total_seconds: number;
  visit_count: number;
  last_visited_at: string;
}

export interface BrowserDomainLimit {
  host: string;
  daily_limit_seconds: number;
  enabled: boolean;
  updated_at: string;
}

export interface VsCodeStatsSummary {
  total_seconds: number;
  session_count: number;
}

export interface VsCodeTrackingStatus {
  enabled: boolean;
  tracking_level?: string;
}

export interface VsCodeLanguageStats {
  language: string;
  total_seconds: number;
}

export interface VsCodeProjectStats {
  project_name: string;
  project_path: string;
  total_seconds: number;
  session_count: number;
}

export interface VsCodeLanguageDuration {
  language: string;
  seconds: number;
}

export interface VsCodeSessionPayload {
  session_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  project_name?: string;
  project_path?: string;
  language_durations?: VsCodeLanguageDuration[];
}

export interface ProductivityScore {
  date: string;
  total_seconds: number;
  focus_seconds: number;
  switch_count: number;
  score: number;
}

export interface InterruptionPeriod {
  hour: number;
  switch_count: number;
  fragment_score: number;
}
