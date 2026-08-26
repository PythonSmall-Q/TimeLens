use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Local;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::storage_cmd::DbState;
use crate::db::{self, WidgetErrorLogEntry};
use crate::models::{AppUsageSummary, CategoryUsageSummary, GoalProgress, UsageGoal};

// ── Resource quotas ───────────────────────────────────────────

const MAX_WIDGET_STATE_ENTRIES: i64 = 100;
const MAX_WIDGET_STATE_VALUE_BYTES: usize = 64 * 1024;
const MAX_CHANNEL_CALLS_PER_MIN: u32 = 60;
const MAX_EVENTS_PER_MIN: u32 = 60;
const SUSPEND_FAILURE_THRESHOLD: i64 = 5;
const SUSPEND_DURATION_MINUTES: i64 = 60;

/// Per-widget in-memory call rate limiter.
#[derive(Default, Clone)]
pub struct WidgetCallRateLimiter {
    inner: Arc<Mutex<HashMap<String, Vec<std::time::Instant>>>>,
}

impl WidgetCallRateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn clone_inner(&self) -> Arc<Mutex<HashMap<String, Vec<std::time::Instant>>>> {
        self.inner.clone()
    }

    fn prune_before(cutoff: std::time::Instant, vec: &mut Vec<std::time::Instant>) {
        vec.retain(|&t| t >= cutoff);
    }

    pub fn check(&self, widget_id: &str, max_per_min: u32) -> bool {
        let now = std::time::Instant::now();
        let cutoff = now - std::time::Duration::from_secs(60);
        let mut map = self.inner.lock().unwrap();
        let entries = map.entry(widget_id.to_string()).or_default();
        Self::prune_before(cutoff, entries);
        if entries.len() >= max_per_min as usize {
            return false;
        }
        entries.push(now);
        true
    }
}

/// Per-widget in-memory event rate limiter.
pub type WidgetEventRateLimiter = WidgetCallRateLimiter;

// ── Typed query API ───────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct WidgetQueryRequest {
    pub widget_id: String,
    pub namespace: String,
    pub payload: Option<Value>,
}

/// Permission required for each query namespace.
fn namespace_permission(namespace: &str) -> Option<&'static str> {
    match namespace {
        "metrics" | "sessions" | "categories" | "projects" | "tags" | "goals" | "rules"
            => Some("screen-time:read"),
        _ => None,
    }
}

fn namespace_display(namespace: &str) -> String {
    match namespace {
        "metrics" => "usage metrics".to_string(),
        "sessions" => "focus sessions".to_string(),
        "categories" => "app categories".to_string(),
        "projects" => "project usage".to_string(),
        "tags" => "usage tags".to_string(),
        "goals" => "usage goals".to_string(),
        "rules" => "focus rules".to_string(),
        _ => namespace.to_string(),
    }
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn require_permission(
    conn: &rusqlite::Connection,
    widget_id: &str,
    namespace: &str,
) -> Result<(), String> {
    let required = namespace_permission(namespace)
        .ok_or_else(|| format!("unknown widget query namespace: {}", namespace))?;
    let perms = db::get_widget_permissions(conn, widget_id).map_err(|e| e.to_string())?;
    if !perms.iter().any(|p| p == required) {
        return Err(format!(
            "permission denied: {} required for {}",
            required,
            namespace_display(namespace)
        ));
    }
    db::touch_widget_permission_access(conn, widget_id, required).map_err(|e| e.to_string())?;
    Ok(())
}

fn query_metrics(conn: &rusqlite::Connection, payload: &Option<Value>) -> Result<Value, String> {
    let today_str = today();
    let start = payload
        .as_ref()
        .and_then(|p| p.get("start"))
        .and_then(|v| v.as_str())
        .unwrap_or(&today_str);
    let end = payload
        .as_ref()
        .and_then(|p| p.get("end"))
        .and_then(|v| v.as_str())
        .unwrap_or(start);

    let rows = db::get_app_totals_in_range(conn, start, end).map_err(|e| e.to_string())?;
    let summaries: Vec<AppUsageSummary> = rows
        .into_iter()
        .map(|(app_name, exe_path, total_seconds)| AppUsageSummary {
            app_name,
            exe_path,
            total_seconds,
        })
        .collect();
    Ok(serde_json::to_value(summaries).unwrap_or(Value::Array(vec![])))
}

fn query_sessions(conn: &rusqlite::Connection, payload: &Option<Value>) -> Result<Value, String> {
    let today_str = today();
    let start_at = payload
        .as_ref()
        .and_then(|p| p.get("start_at"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let end_at = payload
        .as_ref()
        .and_then(|p| p.get("end_at"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let start = start_at.unwrap_or_else(|| format!("{}T00:00:00", today_str));
    let end = end_at.unwrap_or_else(|| format!("{}T23:59:59", today_str));

    let rows = db::list_focus_sessions(conn, Some(&start), Some(&end)).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(rows).unwrap_or(Value::Array(vec![])))
}

fn query_categories(
    conn: &rusqlite::Connection,
    payload: &Option<Value>,
) -> Result<Value, String> {
    let today_str = today();
    let start = payload
        .as_ref()
        .and_then(|p| p.get("start"))
        .and_then(|v| v.as_str())
        .unwrap_or(&today_str);
    let end = payload
        .as_ref()
        .and_then(|p| p.get("end"))
        .and_then(|v| v.as_str())
        .unwrap_or(start);

    let rows = db::get_category_totals_in_range(conn, start, end).map_err(|e| e.to_string())?;
    let summaries: Vec<CategoryUsageSummary> = rows
        .into_iter()
        .map(|(category, total_seconds)| CategoryUsageSummary {
            category,
            total_seconds,
        })
        .collect();
    Ok(serde_json::to_value(summaries).unwrap_or(Value::Array(vec![])))
}

fn query_projects(conn: &rusqlite::Connection, _payload: &Option<Value>) -> Result<Value, String> {
    // Projects are derived from VS Code sessions. Return project totals for the last 7 days.
    let end = today();
    let start = (Local::now() - chrono::Duration::days(6))
        .format("%Y-%m-%d")
        .to_string();
    let rows = db::get_vscode_project_stats_in_range(conn, &start, &end).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(rows).unwrap_or(Value::Array(vec![])))
}

fn query_tags(_conn: &rusqlite::Connection, _payload: &Option<Value>) -> Result<Value, String> {
    // Tags are not yet a first-class concept; return an empty array.
    Ok(Value::Array(vec![]))
}

fn query_goals(conn: &rusqlite::Connection, _payload: &Option<Value>) -> Result<Value, String> {
    let goals = db::get_usage_goals(conn).map_err(|e| e.to_string())?;
    let today_str = today();
    let week_start = (Local::now() - chrono::Duration::days(6))
        .format("%Y-%m-%d")
        .to_string();
    let progress = db::get_goal_progress(conn, &today_str, &week_start, &today_str)
        .map_err(|e| e.to_string())?;

    #[derive(serde::Serialize)]
    struct GoalsResult {
        goals: Vec<UsageGoal>,
        progress: Vec<GoalProgress>,
    }

    Ok(serde_json::to_value(GoalsResult { goals, progress }).unwrap_or(Value::Null))
}

fn query_rules(conn: &rusqlite::Connection, _payload: &Option<Value>) -> Result<Value, String> {
    let rules = db::get_focus_rules(conn).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(rules).unwrap_or(Value::Array(vec![])))
}

fn dispatch_query(
    conn: &rusqlite::Connection,
    namespace: &str,
    payload: &Option<Value>,
) -> Result<Value, String> {
    match namespace {
        "metrics" => query_metrics(conn, payload),
        "sessions" => query_sessions(conn, payload),
        "categories" => query_categories(conn, payload),
        "projects" => query_projects(conn, payload),
        "tags" => query_tags(conn, payload),
        "goals" => query_goals(conn, payload),
        "rules" => query_rules(conn, payload),
        _ => Err(format!("unknown widget query namespace: {}", namespace)),
    }
}

fn widget_query_inner(
    request: WidgetQueryRequest,
    db: &DbState,
    rate_limiter: &WidgetCallRateLimiter,
) -> Result<Value, String> {
    if !rate_limiter.check(&request.widget_id, MAX_CHANNEL_CALLS_PER_MIN) {
        return Err("widget query rate limit exceeded".to_string());
    }

    let conn = db.lock().map_err(|e| e.to_string())?;

    if db::is_widget_suspended(&conn, &request.widget_id).unwrap_or(false) {
        return Err("widget is suspended due to repeated failures".to_string());
    }

    require_permission(&conn, &request.widget_id, &request.namespace)?;
    let result = dispatch_query(&conn, &request.namespace, &request.payload);

    if result.is_ok() {
        let _ = db::reset_widget_consecutive_failures(&conn, &request.widget_id);
    }
    result
}

/// Run a namespaced query for a widget after checking permissions and resource limits.
#[tauri::command]
pub fn widget_query(
    request: WidgetQueryRequest,
    db: State<'_, DbState>,
    rate_limiter: State<'_, WidgetCallRateLimiter>,
) -> Result<Value, String> {
    widget_query_inner(request, &db, &rate_limiter)
}

// ── Subscriptions ─────────────────────────────────────────────

fn widget_subscribe_inner(
    widget_id: String,
    events: Vec<String>,
    db: &DbState,
) -> Result<(), String> {
    let allowed: Vec<String> = events
        .into_iter()
        .filter(|e| is_known_widget_event(e))
        .collect();
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_widget_subscriptions(&conn, &widget_id, &allowed).map_err(|e| e.to_string())
}

fn widget_unsubscribe_inner(widget_id: String, db: &DbState) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::clear_widget_subscriptions(&conn, &widget_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn widget_subscribe(
    widget_id: String,
    events: Vec<String>,
    db: State<'_, DbState>,
) -> Result<(), String> {
    widget_subscribe_inner(widget_id, events, &db)
}

#[tauri::command]
pub fn widget_unsubscribe(widget_id: String, db: State<'_, DbState>) -> Result<(), String> {
    widget_unsubscribe_inner(widget_id, &db)
}

fn is_known_widget_event(event: &str) -> bool {
    matches!(
        event,
        "focus-session-changed"
            | "goal-tick"
            | "idle-return"
            | "rule-triggered"
            | "interruption-signal"
    )
}

/// Emit a widget event to every subscribed widget, respecting per-widget rate limits.
pub fn emit_widget_event(
    app_handle: &AppHandle,
    rate_limiter: &WidgetEventRateLimiter,
    event_name: &str,
    payload: Value,
) {
    if !rate_limiter.check("__emitter__", MAX_EVENTS_PER_MIN * 10) {
        // Global emitter rate limit; skip this burst.
        return;
    }

    let db_state: State<'_, DbState> = match app_handle.try_state() {
        Some(s) => s,
        None => return,
    };
    let Ok(conn) = db_state.lock() else {
        return;
    };
    let Ok(subs) = db::get_all_widget_subscriptions(&conn) else {
        return;
    };
    drop(conn);

    for (widget_id, subscribed_event) in subs {
        if subscribed_event != event_name {
            continue;
        }
        if !rate_limiter.check(&widget_id, MAX_EVENTS_PER_MIN) {
            continue;
        }
        let event_label = format!("widget:{}", event_name);
        let _ = app_handle.emit(&event_label, &payload);
    }
}

// ── Scoped state persistence ──────────────────────────────────

#[tauri::command]
pub fn get_widget_state(
    widget_id: String,
    key: String,
    db: State<'_, DbState>,
) -> Result<Option<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_widget_state(&conn, &widget_id, &key).map_err(|e| e.to_string())
}

fn set_widget_state_inner(
    widget_id: String,
    key: String,
    value: String,
    db: &DbState,
) -> Result<(), String> {
    if value.len() > MAX_WIDGET_STATE_VALUE_BYTES {
        return Err(format!(
            "widget state value exceeds {} byte limit",
            MAX_WIDGET_STATE_VALUE_BYTES
        ));
    }
    let conn = db.lock().map_err(|e| e.to_string())?;
    let count = db::count_widget_state_entries(&conn, &widget_id).map_err(|e| e.to_string())?;
    if count >= MAX_WIDGET_STATE_ENTRIES {
        return Err(format!(
            "widget state exceeds {} entry limit",
            MAX_WIDGET_STATE_ENTRIES
        ));
    }
    db::set_widget_state(&conn, &widget_id, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_widget_state(
    widget_id: String,
    key: String,
    value: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    set_widget_state_inner(widget_id, key, value, &db)
}

#[tauri::command]
pub fn delete_widget_state(
    widget_id: String,
    key: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::delete_widget_state(&conn, &widget_id, &key).map_err(|e| e.to_string())
}

// ── Lifecycle events ──────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct WidgetLifecycleEvent {
    pub widget_id: String,
    pub event: String,
}

#[tauri::command]
pub fn emit_widget_lifecycle(
    request: WidgetLifecycleEvent,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let known = ["mount", "foreground", "background", "suspend", "resume", "uninstall"];
    if !known.contains(&request.event.as_str()) {
        return Err(format!("unknown lifecycle event: {}", request.event));
    }

    let conn = db.lock().map_err(|e| e.to_string())?;
    if request.event == "uninstall" {
        db::clear_widget_runtime_data(&conn, &request.widget_id).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Error logs and runtime control ────────────────────────────

fn record_widget_error_inner(
    widget_id: String,
    error: String,
    recovery_hint: Option<String>,
    db: &DbState,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let count = db::increment_widget_consecutive_failures(&conn, &widget_id)
        .map_err(|e| e.to_string())?;
    if count >= SUSPEND_FAILURE_THRESHOLD {
        let until = (Local::now() + chrono::Duration::minutes(SUSPEND_DURATION_MINUTES))
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();
        let _ = db::suspend_widget_until(&conn, &widget_id, &until);
    }
    db::insert_widget_error_log(
        &conn,
        &widget_id,
        &error,
        recovery_hint.as_deref().unwrap_or(""),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn record_widget_error(
    widget_id: String,
    error: String,
    recovery_hint: Option<String>,
    db: State<'_, DbState>,
) -> Result<(), String> {
    record_widget_error_inner(widget_id, error, recovery_hint, &db)
}

#[tauri::command]
pub fn get_widget_error_log(
    widget_id: String,
    limit: Option<i64>,
    db: State<'_, DbState>,
) -> Result<Vec<WidgetErrorLogEntry>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_widget_error_log(&conn, &widget_id, limit.unwrap_or(20)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_widget_error_log(
    widget_id: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::clear_widget_error_log(&conn, &widget_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_widget_paused(
    widget_id: String,
    paused: bool,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_widget_paused(&conn, &widget_id, paused).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reset_widget_permissions_and_state(
    widget_id: String,
    actor: Option<String>,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::revoke_all_widget_permissions(&conn, &widget_id, actor.as_deref())
        .map_err(|e| e.to_string())?;
    db::clear_widget_runtime_data(&conn, &widget_id).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Helpers used by other backend modules ─────────────────────

/// Convenience wrapper that records an error if a widget command fails.
pub fn with_widget_crash_isolation<F>(
    app_handle: &AppHandle,
    widget_id: &str,
    operation: &str,
    f: F,
) -> Result<Value, String>
where
    F: FnOnce() -> Result<Value, String>,
{
    match f() {
        Ok(v) => {
            let _ = reset_widget_consecutive_failures_for(app_handle, widget_id);
            Ok(v)
        }
        Err(e) => {
            let hint = format!("Check {} permission and arguments.", operation);
            let _ = record_widget_failure(app_handle, widget_id, &e, &hint);
            Err(e)
        }
    }
}

fn reset_widget_consecutive_failures_for(app_handle: &AppHandle, widget_id: &str) {
    let Some(db_state) = app_handle.try_state::<DbState>() else {
        return;
    };
    let Ok(conn) = db_state.lock() else {
        return;
    };
    let _ = db::reset_widget_consecutive_failures(&conn, widget_id);
}

fn record_widget_failure(app_handle: &AppHandle, widget_id: &str, error: &str, hint: &str) {
    let Some(db_state) = app_handle.try_state::<DbState>() else {
        return;
    };
    let Ok(conn) = db_state.lock() else {
        return;
    };
    let Ok(count) = db::increment_widget_consecutive_failures(&conn, widget_id) else {
        return;
    };
    if count >= SUSPEND_FAILURE_THRESHOLD {
        let until = (Local::now() + chrono::Duration::minutes(SUSPEND_DURATION_MINUTES))
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();
        let _ = db::suspend_widget_until(&conn, widget_id, &until);
    }
    let _ = db::insert_widget_error_log(&conn, widget_id, error, hint);
}

/// Public helper to emit a widget event from backend modules that have an AppHandle.
pub fn broadcast_widget_event(app_handle: &AppHandle, event_name: &str, payload: Value) {
    let rate_limiter = match app_handle.try_state::<WidgetEventRateLimiter>() {
        Some(s) => s.inner().clone(),
        None => WidgetEventRateLimiter::new(),
    };
    emit_widget_event(app_handle, &rate_limiter, event_name, payload);
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::db;
    use crate::models::WidgetConfig;

    fn test_db() -> DbState {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::initialize(&conn).unwrap();
        Arc::new(Mutex::new(conn))
    }

    fn sample_widget_config(id: &str) -> WidgetConfig {
        WidgetConfig {
            id: id.to_string(),
            widget_type: "pet".to_string(),
            monitor_index: -1,
            x: 100.0,
            y: 100.0,
            width: 320.0,
            height: 220.0,
            opacity: 0.88,
            always_on_top_mode: "focus".to_string(),
            pinned: false,
            start_on_launch: false,
            data_json: None,
            paused: false,
            consecutive_failures: 0,
            suspended_until: None,
        }
    }

    #[test]
    fn namespace_permission_maps_read_namespaces() {
        assert_eq!(namespace_permission("metrics"), Some("screen-time:read"));
        assert_eq!(namespace_permission("goals"), Some("screen-time:read"));
        assert_eq!(namespace_permission("rules"), Some("screen-time:read"));
        assert_eq!(namespace_permission("unknown"), None);
    }

    #[test]
    fn require_permission_denies_without_grant() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("deny-test")).unwrap();

        let err = require_permission(&conn, "deny-test", "metrics").unwrap_err();
        assert!(err.contains("permission denied"));
    }

    #[test]
    fn require_permission_allows_with_grant_and_records_access() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("grant-test")).unwrap();
        db::set_widget_permissions(
            &conn,
            "grant-test",
            &["screen-time:read".to_string()],
            None,
        )
        .unwrap();

        assert!(require_permission(&conn, "grant-test", "metrics").is_ok());

        let entries = db::get_widget_permission_entries(&conn, "grant-test").unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].last_access_at.is_some());
    }

    #[test]
    fn dispatch_query_metrics_returns_inserted_data() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        db::upsert_app_usage(
            &conn,
            &today,
            "TestApp",
            "test.exe",
            "Window",
            125,
            &format!("{}T10:00:00", today),
            &format!("{}T10:02:05", today),
        )
        .unwrap();

        let result = dispatch_query(&conn, "metrics", &None).unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_value(result).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["app_name"], "TestApp");
        assert_eq!(rows[0]["total_seconds"], 125);
    }

    #[test]
    fn dispatch_query_tags_returns_empty_array() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let result = dispatch_query(&conn, "tags", &None).unwrap();
        assert_eq!(result, serde_json::Value::Array(vec![]));
    }

    #[test]
    fn is_known_widget_event_filters_subscriptions() {
        assert!(is_known_widget_event("focus-session-changed"));
        assert!(is_known_widget_event("goal-tick"));
        assert!(!is_known_widget_event("some-random-event"));
    }

    #[test]
    fn widget_call_rate_limiter_allows_then_blocks() {
        let limiter = WidgetCallRateLimiter::new();
        let widget = "rate-test";
        for _ in 0..MAX_CHANNEL_CALLS_PER_MIN {
            assert!(limiter.check(widget, MAX_CHANNEL_CALLS_PER_MIN));
        }
        assert!(!limiter.check(widget, MAX_CHANNEL_CALLS_PER_MIN));
    }

    #[test]
    fn scoped_state_persists_and_cleans_up() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("state-test")).unwrap();

        db::set_widget_state(&conn, "state-test", "key1", "value1").unwrap();
        assert_eq!(
            db::get_widget_state(&conn, "state-test", "key1").unwrap(),
            Some("value1".to_string())
        );

        db::delete_widget_state(&conn, "state-test", "key1").unwrap();
        assert_eq!(db::get_widget_state(&conn, "state-test", "key1").unwrap(), None);
    }

    #[test]
    fn error_log_and_runtime_cleanup_remove_all_data() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("cleanup-test")).unwrap();
        db::set_widget_permissions(
            &conn,
            "cleanup-test",
            &["screen-time:read".to_string()],
            None,
        )
        .unwrap();

        db::set_widget_state(&conn, "cleanup-test", "key", "value").unwrap();
        db::set_widget_subscriptions(&conn, "cleanup-test", &["goal-tick".to_string()]).unwrap();
        db::insert_widget_error_log(&conn, "cleanup-test", "boom", "restart").unwrap();

        db::revoke_all_widget_permissions(&conn, "cleanup-test", Some("test")).unwrap();
        db::clear_widget_runtime_data(&conn, "cleanup-test").unwrap();

        assert!(db::get_widget_permissions(&conn, "cleanup-test").unwrap().is_empty());
        assert!(db::get_widget_state(&conn, "cleanup-test", "key").unwrap().is_none());
        assert!(db::get_widget_subscriptions(&conn, "cleanup-test").unwrap().is_empty());
        assert!(db::get_widget_error_log(&conn, "cleanup-test", 10).unwrap().is_empty());
    }

    // ── Validation gate: contract tests ─────────────────────────

    #[test]
    fn widget_query_contract_denies_without_permission() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("query-deny")).unwrap();
        drop(conn);

        let result = widget_query_inner(
            WidgetQueryRequest {
                widget_id: "query-deny".to_string(),
                namespace: "metrics".to_string(),
                payload: None,
            },
            &db,
            &WidgetCallRateLimiter::new(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("permission denied"));
    }

    #[test]
    fn widget_query_contract_allows_and_returns_metrics() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("query-allow")).unwrap();
        db::set_widget_permissions(
            &conn,
            "query-allow",
            &["screen-time:read".to_string()],
            None,
        )
        .unwrap();

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db::upsert_app_usage(
            &conn,
            &today,
            "ContractApp",
            "contract.exe",
            "Window",
            60,
            &format!("{}T10:00:00", today),
            &format!("{}T10:01:00", today),
        )
        .unwrap();
        drop(conn);

        let result = widget_query_inner(
            WidgetQueryRequest {
                widget_id: "query-allow".to_string(),
                namespace: "metrics".to_string(),
                payload: None,
            },
            &db,
            &WidgetCallRateLimiter::new(),
        )
        .unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_value(result).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["app_name"], "ContractApp");
    }

    #[test]
    fn widget_query_contract_respects_suspension() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("query-suspended")).unwrap();
        db::set_widget_permissions(
            &conn,
            "query-suspended",
            &["screen-time:read".to_string()],
            None,
        )
        .unwrap();
        let until = (chrono::Local::now() + chrono::Duration::minutes(5))
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string();
        db::suspend_widget_until(&conn, "query-suspended", &until).unwrap();
        drop(conn);

        let result = widget_query_inner(
            WidgetQueryRequest {
                widget_id: "query-suspended".to_string(),
                namespace: "metrics".to_string(),
                payload: None,
            },
            &db,
            &WidgetCallRateLimiter::new(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("suspended"));
    }

    #[test]
    fn widget_subscribe_contract_filters_unknown_events() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("sub-test")).unwrap();
        drop(conn);

        widget_subscribe_inner(
            "sub-test".to_string(),
            vec![
                "focus-session-changed".to_string(),
                "goal-tick".to_string(),
                "unknown-event".to_string(),
            ],
            &db,
        )
        .unwrap();

        {
            let conn = db.lock().unwrap();
            let subs = db::get_widget_subscriptions(&conn, "sub-test").unwrap();
            assert!(subs.contains(&"focus-session-changed".to_string()));
            assert!(subs.contains(&"goal-tick".to_string()));
            assert!(!subs.contains(&"unknown-event".to_string()));
        }

        widget_unsubscribe_inner("sub-test".to_string(), &db).unwrap();

        let conn = db.lock().unwrap();
        let subs = db::get_widget_subscriptions(&conn, "sub-test").unwrap();
        assert!(subs.is_empty());
    }

    #[test]
    fn revoke_after_grant_clears_permission_and_blocks_query() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("revoke-test")).unwrap();
        db::set_widget_permissions(
            &conn,
            "revoke-test",
            &["screen-time:read".to_string()],
            None,
        )
        .unwrap();
        drop(conn);

        assert!(widget_query_inner(
            WidgetQueryRequest {
                widget_id: "revoke-test".to_string(),
                namespace: "metrics".to_string(),
                payload: None,
            },
            &db,
            &WidgetCallRateLimiter::new(),
        )
        .is_ok());

        let conn = db.lock().unwrap();
        db::revoke_all_widget_permissions(&conn, "revoke-test", Some("audit")).unwrap();
        drop(conn);

        let result = widget_query_inner(
            WidgetQueryRequest {
                widget_id: "revoke-test".to_string(),
                namespace: "metrics".to_string(),
                payload: None,
            },
            &db,
            &WidgetCallRateLimiter::new(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("permission denied"));

        let conn = db.lock().unwrap();
        assert!(db::get_widget_permissions(&conn, "revoke-test").unwrap().is_empty());
        let audit = db::get_widget_permission_audit_log(&conn, "revoke-test", 10).unwrap();
        assert_eq!(audit.len(), 2);
        assert!(audit.iter().any(|e| e.action == "grant"));
        assert!(audit.iter().any(|e| e.action == "revoke"));
    }

    #[test]
    fn state_value_quota_rejects_oversized_value() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("state-quota")).unwrap();
        drop(conn);

        let oversized = "x".repeat(MAX_WIDGET_STATE_VALUE_BYTES + 1);
        let result = set_widget_state_inner(
            "state-quota".to_string(),
            "big".to_string(),
            oversized,
            &db,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("byte limit"));
    }

    #[test]
    fn state_entry_quota_rejects_too_many_entries() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("state-quota")).unwrap();
        drop(conn);

        for i in 0..MAX_WIDGET_STATE_ENTRIES {
            set_widget_state_inner(
                "state-quota".to_string(),
                format!("key-{}", i),
                "v".to_string(),
                &db,
            )
            .unwrap();
        }

        let result = set_widget_state_inner(
            "state-quota".to_string(),
            "extra".to_string(),
            "v".to_string(),
            &db,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("entry limit"));
    }

    #[test]
    fn repeated_failures_suspend_widget_and_block_query() {
        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("crash-test")).unwrap();
        db::set_widget_permissions(
            &conn,
            "crash-test",
            &["screen-time:read".to_string()],
            None,
        )
        .unwrap();
        drop(conn);

        for i in 0..SUSPEND_FAILURE_THRESHOLD {
            record_widget_error_inner(
                "crash-test".to_string(),
                format!("failure {}", i),
                Some("restart".to_string()),
                &db,
            )
            .unwrap();
        }

        let conn = db.lock().unwrap();
        assert!(db::is_widget_suspended(&conn, "crash-test").unwrap());
        assert_eq!(
            db::get_widget_error_log(&conn, "crash-test", 10).unwrap().len(),
            SUSPEND_FAILURE_THRESHOLD as usize
        );
        drop(conn);

        let result = widget_query_inner(
            WidgetQueryRequest {
                widget_id: "crash-test".to_string(),
                namespace: "metrics".to_string(),
                payload: None,
            },
            &db,
            &WidgetCallRateLimiter::new(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("suspended"));
    }

    #[test]
    fn all_query_namespaces_work_offline() {
        use crate::models::{FocusRule, UsageGoal, VsCodeLanguageDuration, VsCodeSession};

        let db = test_db();
        let conn = db.lock().unwrap();
        db::upsert_widget_config(&conn, &sample_widget_config("offline-test")).unwrap();
        db::set_widget_permissions(
            &conn,
            "offline-test",
            &["screen-time:read".to_string()],
            None,
        )
        .unwrap();

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db::upsert_app_usage(
            &conn,
            &today,
            "OfflineApp",
            "offline.exe",
            "Window",
            120,
            &format!("{}T10:00:00", today),
            &format!("{}T10:02:00", today),
        )
        .unwrap();
        db::upsert_app_category_rule(
            &conn,
            "OfflineApp",
            "offline.exe",
            "work",
            "manual",
        )
        .unwrap();
        db::start_focus_session(&conn, "manual", "offline").unwrap();
        db::upsert_vscode_session(
            &conn,
            &VsCodeSession {
                session_id: "offline-1".to_string(),
                date: today.clone(),
                started_at: format!("{}T10:00:00", today),
                ended_at: format!("{}T10:30:00", today),
                duration_seconds: 1800,
                project_name: "offline-project".to_string(),
                project_path: "/offline".to_string(),
                synced_at: format!("{}T10:30:00", today),
                language_durations: vec![VsCodeLanguageDuration {
                    language: "rust".to_string(),
                    seconds: 1800,
                }],
            },
        )
        .unwrap();
        db::upsert_usage_goal(
            &conn,
            &UsageGoal {
                id: None,
                scope_type: "category".to_string(),
                scope_value: "work".to_string(),
                period: "daily".to_string(),
                operator: "at_least".to_string(),
                target_seconds: 3600,
                enabled: true,
                notify_risk: true,
            },
        )
        .unwrap();
        db::upsert_focus_rule(
            &conn,
            &FocusRule {
                id: None,
                name: "Offline rule".to_string(),
                enabled: true,
                rule_type: "keyword".to_string(),
                condition_json: serde_json::json!({ "match_type": "app_name", "keyword": "offline" })
                    .to_string(),
                action: "enter_focus".to_string(),
                auto_start: false,
                quiet_hours_respect: false,
                created_at: Some(chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()),
            },
        )
        .unwrap();
        drop(conn);

        let namespaces = vec!["metrics", "sessions", "categories", "projects", "tags", "goals", "rules"];
        for ns in namespaces {
            let result = widget_query_inner(
                WidgetQueryRequest {
                    widget_id: "offline-test".to_string(),
                    namespace: ns.to_string(),
                    payload: None,
                },
                &db,
                &WidgetCallRateLimiter::new(),
            );
            assert!(result.is_ok(), "namespace {} failed: {:?}", ns, result);
        }
    }
}
