use serde::{Deserialize, Serialize};

// ── App usage ──────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppUsageRecord {
    pub id: Option<i64>,
    pub date: String,
    pub app_name: String,
    pub exe_path: String,
    pub window_title: String,
    pub active_seconds: i64,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppUsageSummary {
    pub app_name: String,
    pub exe_path: String,
    pub total_seconds: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppUsageComparison {
    pub app_name: String,
    pub exe_path: String,
    pub current_seconds: i64,
    pub previous_seconds: i64,
    pub delta_seconds: i64,
    pub delta_ratio: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecutableOption {
    pub app_name: String,
    pub exe_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HourlyDistribution {
    pub hour: i32,
    pub seconds: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyUsage {
    pub date: String,
    pub total_seconds: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryUsageSummary {
    pub category: String,
    pub total_seconds: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryDailyUsage {
    pub date: String,
    pub category: String,
    pub total_seconds: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppCategoryRule {
    pub app_name: String,
    pub exe_path: String,
    pub category: String,
    pub source: String, // "manual" | "suggested"
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategorySuggestion {
    pub category: String,
    pub confidence: f64,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageGoal {
    pub id: Option<i64>,
    pub scope_type: String, // "category" | "app"
    pub scope_value: String,
    pub period: String,     // "daily" | "weekly"
    pub operator: String,   // "at_least" | "at_most"
    pub target_seconds: i64,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoalProgress {
    pub goal: UsageGoal,
    pub used_seconds: i64,
    pub progress_ratio: f64,
    pub is_completed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FocusSession {
    pub id: Option<i64>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub trigger_type: String, // "manual" | "rule"
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrowserSession {
    pub id: Option<i64>,
    pub browser_name: String,
    pub tab_url: String,
    pub host: String,
    pub title: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_seconds: i64,
    pub locale: String,
    pub synced_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrowserExtensionStatus {
    pub enabled: bool,
    pub api_base_url: String,
    pub connected: bool,
    pub last_sync_at: Option<String>,
    pub last_browser_name: Option<String>,
    pub last_locale: Option<String>,
    pub recent_session_count: i64,
    pub recent_sessions: Vec<BrowserSession>,
}

// ── Todo ───────────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TodoItem {
    pub id: Option<i64>,
    pub content: String,
    pub done: bool,
    pub created_at: String,
    pub order_index: i64,
}

// ── Widget config ──────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetConfig {
    pub id: String,
    pub widget_type: String,
    pub monitor_index: i32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub opacity: f64,
    pub always_on_top_mode: String, // "always" | "focus" | "never"
    pub pinned: bool,
    pub start_on_launch: bool,
}

impl Default for WidgetConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            widget_type: String::new(),
            monitor_index: -1,
            x: 100.0,
            y: 100.0,
            width: 320.0,
            height: 220.0,
            opacity: 0.85,
            always_on_top_mode: "focus".to_string(),
            pinned: false,
            start_on_launch: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrowserDomainStats {
    pub host: String,
    pub total_seconds: i64,
    pub visit_count: i64,
    pub last_visited_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrowserDomainLimit {
    pub host: String,
    pub daily_limit_seconds: i64,
    pub enabled: bool,
    pub updated_at: String,
}

// ── Active window info emitted by monitor ─────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActiveWindowInfo {
    pub app_name: String,
    pub exe_path: String,
    pub window_title: String,
    pub timestamp: String,
}
