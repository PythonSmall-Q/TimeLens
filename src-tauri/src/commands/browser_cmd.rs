use tauri::State;
use crate::commands::storage_cmd::DbState;
use crate::models::{BrowserDomainStats, BrowserDomainLimit};

#[tauri::command]
pub fn get_browser_domain_stats(
    db: State<DbState>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<BrowserDomainStats>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let start = start_date.as_deref().unwrap_or(&today).to_string();
    let end = end_date.as_deref().unwrap_or(&today).to_string();
    crate::db::get_browser_domain_stats(&conn, &start, &end).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_browser_ignored_domains(db: State<DbState>) -> Result<Vec<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::get_browser_ignored_domains(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_browser_ignored_domains(
    db: State<DbState>,
    hosts: Vec<String>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_browser_ignored_domains(&conn, &hosts).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_browser_domain_limits(db: State<DbState>) -> Result<Vec<BrowserDomainLimit>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::get_browser_domain_limits(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_browser_domain_limit(
    db: State<DbState>,
    host: String,
    daily_limit_seconds: i64,
    enabled: bool,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let limit = BrowserDomainLimit {
        host,
        daily_limit_seconds,
        enabled,
        updated_at: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
    };
    crate::db::upsert_browser_domain_limit(&conn, &limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_browser_domain_limit(db: State<DbState>, host: String) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::remove_browser_domain_limit(&conn, &host).map_err(|e| e.to_string())
}
