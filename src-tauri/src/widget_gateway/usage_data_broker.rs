use chrono::Local;
use rusqlite::Connection;
use serde_json::Value;

use crate::db;
use crate::models::{AppUsageSummary, BrowserDomainStats, CategoryUsageSummary, FocusSession, GoalProgress, UsageGoal};

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn query_metrics(conn: &Connection, payload: &Option<Value>) -> Result<Value, String> {
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

fn query_sessions(conn: &Connection, payload: &Option<Value>) -> Result<Value, String> {
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

fn query_categories(conn: &Connection, payload: &Option<Value>) -> Result<Value, String> {
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

fn query_projects(conn: &Connection, _payload: &Option<Value>) -> Result<Value, String> {
    let end = today();
    let start = (Local::now() - chrono::Duration::days(6))
        .format("%Y-%m-%d")
        .to_string();
    let rows = db::get_vscode_project_stats_in_range(conn, &start, &end).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(rows).unwrap_or(Value::Array(vec![])))
}

fn query_tags(_conn: &Connection, _payload: &Option<Value>) -> Result<Value, String> {
    Ok(Value::Array(vec![]))
}

fn query_goals(conn: &Connection, _payload: &Option<Value>) -> Result<Value, String> {
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

fn query_rules(conn: &Connection, _payload: &Option<Value>) -> Result<Value, String> {
    let rules = db::get_focus_rules(conn).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(rules).unwrap_or(Value::Array(vec![])))
}

#[derive(serde::Serialize)]
struct FocusStateResult {
    active: bool,
    active_session: Option<FocusSession>,
}

fn query_focus(conn: &Connection, payload: &Option<Value>) -> Result<Value, String> {
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

    let active = db::get_bool_setting(conn, "focus_mode_active", false).unwrap_or(false);
    let sessions = db::list_focus_sessions(conn, Some(&start), Some(&end)).map_err(|e| e.to_string())?;
    let active_session = sessions.into_iter().find(|s| s.ended_at.is_none());

    Ok(serde_json::to_value(FocusStateResult { active, active_session }).unwrap_or(Value::Null))
}

fn query_todos(conn: &Connection, _payload: &Option<Value>) -> Result<Value, String> {
    let todos = db::get_all_todos(conn).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(todos).unwrap_or(Value::Array(vec![])))
}

#[derive(serde::Serialize)]
struct BrowserQueryResult {
    domains: Vec<BrowserDomainStats>,
    status: crate::models::BrowserExtensionStatus,
}

fn query_browser(conn: &Connection, payload: &Option<Value>) -> Result<Value, String> {
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

    let domains = db::get_browser_domain_stats(conn, start, end).map_err(|e| e.to_string())?;
    let enabled = db::get_bool_setting(conn, "browser_extension_enabled", true).unwrap_or(true);
    let last_sync_at = db::get_setting(conn, "browser_extension_last_sync_at").ok().flatten();
    let last_browser_name = db::get_setting(conn, "browser_extension_last_browser_name").ok().flatten();
    let last_locale = db::get_setting(conn, "browser_extension_last_locale").ok().flatten();
    let recent_sessions = db::get_recent_browser_sessions(conn, 6).unwrap_or_default();
    let recent_session_count = db::count_browser_sessions(conn).unwrap_or(0);

    let status = crate::models::BrowserExtensionStatus {
        enabled,
        api_base_url: crate::api_server::local_api_base_url(),
        connected: last_sync_at.is_some(),
        last_sync_at,
        last_browser_name,
        last_locale,
        recent_session_count,
        recent_sessions,
    };

    Ok(serde_json::to_value(BrowserQueryResult { domains, status }).unwrap_or(Value::Null))
}

pub fn handle_query(
    conn: &Connection,
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
        "focus" => query_focus(conn, payload),
        "todos" => query_todos(conn, payload),
        "browser" => query_browser(conn, payload),
        _ => Err(format!("unknown widget query namespace: {}", namespace)),
    }
}
