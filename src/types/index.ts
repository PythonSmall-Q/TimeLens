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
