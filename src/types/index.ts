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

export interface TodoItem {
  id: number;
  content: string;
  done: boolean;
  created_at: string;
  order_index: number;
}

export interface WidgetConfig {
  id: string;
  widget_type: "clock" | "todo" | "timer" | "note" | "status";
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  always_on_top_mode: "always" | "focus" | "never";
  pinned: boolean;
  start_on_launch: boolean;
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

export type WidgetType = "clock" | "todo" | "timer" | "note" | "status";

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
  shortcuts: ShortcutSettings;
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
