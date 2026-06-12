use crate::commands::storage_cmd::DbState;
use crate::db;
use crate::monitor::{MonitorStatus, SharedMonitorStatus};
use chrono::Local;
use tauri::State;

/// Get the current monitoring status (active/paused) and last known app.
#[tauri::command]
pub fn get_monitor_status(status: State<SharedMonitorStatus>) -> MonitorStatus {
    status.lock().unwrap().clone()
}

/// Pause or resume tracking.
#[tauri::command]
pub fn set_monitoring_active(active: bool, status: State<SharedMonitorStatus>, db: State<DbState>) {
    let mut s = status.lock().unwrap();
    s.active = active;

    if let Ok(conn) = db.lock() {
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let _ = db::set_bool_setting(&conn, "tracking_monitoring_active", active);
        let _ = db::set_setting(&conn, "tracking_last_state_change_at", &now);
        if !active {
            let _ = db::set_setting(&conn, "tracking_paused_by", "user");
            let _ = db::set_setting(&conn, "tracking_pause_reason", "Manual pause from Settings");
            let _ = db::set_setting(&conn, "tracking_paused_at", &now);
        }
    }
}
