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
    pub period: String,   // "daily" | "weekly"
    pub operator: String, // "at_least" | "at_most"
    pub target_seconds: i64,
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub notify_risk: bool,
}

fn default_true() -> bool {
    true
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
pub struct FocusRule {
    pub id: Option<i64>,
    pub name: String,
    pub enabled: bool,
    pub rule_type: String, // "keyword" | "time_window" | "app"
    pub condition_json: String,
    pub action: String, // "enter_focus" | "leave_focus"
    pub auto_start: bool,
    pub quiet_hours_respect: bool,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DistractionHotspot {
    pub date: String,
    pub hour: i32,
    pub app_name: String,
    pub switch_count: i64,
    pub short_session_ratio: f64,
    pub fragment_score: f64,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryComparison {
    pub category: String,
    pub current_seconds: i64,
    pub previous_seconds: i64,
    pub delta_seconds: i64,
    pub delta_ratio: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectComparison {
    pub project_name: String,
    pub project_path: String,
    pub current_seconds: i64,
    pub previous_seconds: i64,
    pub delta_seconds: i64,
    pub delta_ratio: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoalRiskAlert {
    pub goal_id: i64,
    pub scope_value: String,
    pub message: String,
    pub severity: String, // "low" | "medium" | "high"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FocusRuleMatch {
    pub rule_id: i64,
    pub rule_name: String,
    pub action: String,
    pub matched: bool,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VsCodeLanguageDuration {
    pub language: String,
    pub seconds: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VsCodeSession {
    pub session_id: String,
    pub date: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_seconds: i64,
    pub project_name: String,
    pub project_path: String,
    pub synced_at: String,
    pub language_durations: Vec<VsCodeLanguageDuration>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VsCodeStatsSummary {
    pub total_seconds: i64,
    pub session_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VsCodeLanguageStats {
    pub language: String,
    pub total_seconds: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VsCodeProjectStats {
    pub project_name: String,
    pub project_path: String,
    pub total_seconds: i64,
    pub session_count: i64,
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
    #[serde(default)]
    pub data_json: Option<String>,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub consecutive_failures: i32,
    #[serde(default)]
    pub suspended_until: Option<String>,
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
            data_json: None,
            paused: false,
            consecutive_failures: 0,
            suspended_until: None,
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
pub struct BrowserHourDomainStats {
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiTokenMetadata {
    pub id: String,
    pub label: String,
    pub scopes: Vec<String>,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub revoked_at: Option<String>,
    pub last_used_at: Option<String>,
    pub last_client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssuedApiToken {
    pub id: String,
    pub token: String,
    pub label: String,
    pub scopes: Vec<String>,
    pub created_at: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiAuditLogEntry {
    pub id: i64,
    pub occurred_at: String,
    pub client_id: String,
    pub endpoint: String,
    pub method: String,
    pub status_code: i64,
    pub detail: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiClientAllowlistEntry {
    pub client_id: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalApiSecuritySettings {
    pub token_required: bool,
    pub allowlist_enforced: bool,
    pub rate_limit_per_min: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetPermissionEntry {
    pub permission: String,
    pub capability: String,
    pub risk_label: String,
    pub granted_at: String,
    pub last_access_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetPermissionAuditEntry {
    pub id: i64,
    pub widget_id: String,
    pub permission: String,
    pub action: String,
    pub actor: String,
    pub occurred_at: String,
    pub detail: String,
}
