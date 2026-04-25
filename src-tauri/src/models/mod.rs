use serde::{Deserialize, Serialize};

// ── App usage ──────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppUsageRecord {
    pub id: Option<i64>,
    pub date: String,
    pub app_name: String,
    pub window_title: String,
    pub active_seconds: i64,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppUsageSummary {
    pub app_name: String,
    pub total_seconds: i64,
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
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub opacity: f64,
    pub always_on_top_mode: String, // "always" | "focus" | "never"
    pub pinned: bool,
}

impl Default for WidgetConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            widget_type: String::new(),
            x: 100.0,
            y: 100.0,
            width: 320.0,
            height: 220.0,
            opacity: 0.85,
            always_on_top_mode: "focus".to_string(),
            pinned: false,
        }
    }
}

// ── Active window info emitted by monitor ─────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActiveWindowInfo {
    pub app_name: String,
    pub window_title: String,
    pub timestamp: String,
}
