use tauri::State;
use crate::monitor::{MonitorStatus, SharedMonitorStatus};

/// Get the current monitoring status (active/paused) and last known app.
#[tauri::command]
pub fn get_monitor_status(status: State<SharedMonitorStatus>) -> MonitorStatus {
    status.lock().unwrap().clone()
}

/// Pause or resume tracking.
#[tauri::command]
pub fn set_monitoring_active(active: bool, status: State<SharedMonitorStatus>) {
    let mut s = status.lock().unwrap();
    s.active = active;
}
