use std::sync::{Arc, Mutex};
use chrono::Local;
use tauri::State;

use crate::db;
use crate::models::{AppUsageSummary, HourlyDistribution, DailyUsage, TodoItem, WidgetConfig};

pub type DbState = Arc<Mutex<rusqlite::Connection>>;

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

// ── Screen time queries ───────────────────────────────────────

/// Returns per-app totals for today, sorted by usage descending.
#[tauri::command]
pub fn get_today_app_totals(db: State<DbState>) -> Result<Vec<AppUsageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let rows = db::get_daily_app_totals(&conn, &today()).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(app_name, total_seconds)| AppUsageSummary { app_name, total_seconds })
        .collect())
}

/// Returns per-app totals for a specific date.
#[tauri::command]
pub fn get_app_totals_for_date(date: String, db: State<DbState>) -> Result<Vec<AppUsageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let rows = db::get_daily_app_totals(&conn, &date).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(app_name, total_seconds)| AppUsageSummary { app_name, total_seconds })
        .collect())
}

/// Returns hourly usage distribution for today (hour 0-23 → seconds).
#[tauri::command]
pub fn get_today_hourly(db: State<DbState>) -> Result<Vec<HourlyDistribution>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let rows = db::get_hourly_distribution(&conn, &today()).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(hour, seconds)| HourlyDistribution { hour, seconds })
        .collect())
}

/// Returns daily total usage for the last `days` days.
#[tauri::command]
pub fn get_recent_daily_totals(days: u32, db: State<DbState>) -> Result<Vec<DailyUsage>, String> {
    let since = (Local::now() - chrono::Duration::days(days as i64))
        .format("%Y-%m-%d")
        .to_string();
    let conn = db.lock().map_err(|e| e.to_string())?;
    let rows = db::get_daily_totals(&conn, &since).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(date, total_seconds)| DailyUsage { date, total_seconds })
        .collect())
}

// ── Todo commands ─────────────────────────────────────────────

#[tauri::command]
pub fn get_todos(db: State<DbState>) -> Result<Vec<TodoItem>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_all_todos(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_todo(content: String, db: State<DbState>) -> Result<TodoItem, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    // Place at the end
    let max_order: i64 = conn
        .query_row("SELECT COALESCE(MAX(order_index), -1) FROM todos", [], |r| r.get(0))
        .unwrap_or(-1);
    let id = db::insert_todo(&conn, &content, max_order + 1).map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    Ok(TodoItem {
        id: Some(id),
        content,
        done: false,
        created_at: now,
        order_index: max_order + 1,
    })
}

#[tauri::command]
pub fn toggle_todo(id: i64, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::toggle_todo(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_todo(id: i64, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::delete_todo(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_todos(ordered_ids: Vec<i64>, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    for (idx, id) in ordered_ids.iter().enumerate() {
        db::reorder_todo(&conn, *id, idx as i64).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Widget config commands ────────────────────────────────────

#[tauri::command]
pub fn get_all_widgets(db: State<DbState>) -> Result<Vec<WidgetConfig>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_all_widget_configs(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_widget_config(config: WidgetConfig, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::upsert_widget_config(&conn, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_widget_config(id: String, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::delete_widget_config(&conn, &id).map_err(|e| e.to_string())
}
