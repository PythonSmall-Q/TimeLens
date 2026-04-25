use std::sync::{Arc, Mutex};
use chrono::Local;
use tauri::State;

use crate::db;
use crate::models::{
    AppUsageComparison, AppUsageSummary, DailyUsage, ExecutableOption, HourlyDistribution,
    TodoItem, WidgetConfig,
};

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
        .map(|(app_name, exe_path, total_seconds)| AppUsageSummary {
            app_name,
            exe_path,
            total_seconds,
        })
        .collect())
}

/// Returns per-app totals for a specific date.
#[tauri::command]
pub fn get_app_totals_for_date(date: String, db: State<DbState>) -> Result<Vec<AppUsageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let rows = db::get_daily_app_totals(&conn, &date).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(app_name, exe_path, total_seconds)| AppUsageSummary {
            app_name,
            exe_path,
            total_seconds,
        })
        .collect())
}

#[tauri::command]
pub fn get_app_totals_in_range(
    start_date: String,
    end_date: String,
    db: State<DbState>,
) -> Result<Vec<AppUsageSummary>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let rows = db::get_app_totals_in_range(&conn, &start_date, &end_date).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(app_name, exe_path, total_seconds)| AppUsageSummary {
            app_name,
            exe_path,
            total_seconds,
        })
        .collect())
}

#[tauri::command]
pub fn get_app_comparison_in_ranges(
    current_start: String,
    current_end: String,
    previous_start: String,
    previous_end: String,
    db: State<DbState>,
) -> Result<Vec<AppUsageComparison>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let current = db::get_app_totals_in_range(&conn, &current_start, &current_end)
        .map_err(|e| e.to_string())?;
    let previous = db::get_app_totals_in_range(&conn, &previous_start, &previous_end)
        .map_err(|e| e.to_string())?;

    let mut map: std::collections::BTreeMap<String, (String, i64, i64)> =
        std::collections::BTreeMap::new();
    for (name, exe_path, secs) in current {
        map.insert(name, (exe_path, secs, 0));
    }
    for (name, exe_path, secs) in previous {
        if let Some(v) = map.get_mut(&name) {
            v.2 = secs;
            if v.0.is_empty() {
                v.0 = exe_path;
            }
        } else {
            map.insert(name, (exe_path, 0, secs));
        }
    }

    let mut rows: Vec<AppUsageComparison> = map
        .into_iter()
        .map(|(app_name, (exe_path, current_seconds, previous_seconds))| {
            let delta_seconds = current_seconds - previous_seconds;
            let delta_ratio = if previous_seconds > 0 {
                delta_seconds as f64 / previous_seconds as f64
            } else if current_seconds > 0 {
                1.0
            } else {
                0.0
            };

            AppUsageComparison {
                app_name,
                exe_path,
                current_seconds,
                previous_seconds,
                delta_seconds,
                delta_ratio,
            }
        })
        .collect();

    rows.sort_by(|a, b| b.current_seconds.cmp(&a.current_seconds));
    Ok(rows)
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

#[tauri::command]
pub fn get_ignored_apps(db: State<DbState>) -> Result<Vec<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::get_ignored_apps(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_ignored_apps(exe_paths: Vec<String>, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_ignored_apps(&conn, &exe_paths).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_executables(limit: Option<u32>, db: State<DbState>) -> Result<Vec<ExecutableOption>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let rows = db::get_recent_executables(&conn, limit.unwrap_or(200) as i64)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(app_name, exe_path)| ExecutableOption { app_name, exe_path })
        .collect())
}

#[tauri::command]
pub fn get_running_executables() -> Result<Vec<ExecutableOption>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::collections::BTreeMap;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::ProcessStatus::{EnumProcesses, GetModuleFileNameExW};
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
        };

        const MAX_PIDS: usize = 16384;
        let pids: Vec<u32> = unsafe {
            // Retry with a larger buffer until EnumProcesses fills less than the whole buffer,
            // which guarantees we received all process IDs.
            let mut buf = vec![0u32; 1024];
            loop {
                let buf_bytes = (buf.len() * std::mem::size_of::<u32>()) as u32;
                let mut bytes_returned = 0u32;
                if let Err(e) = EnumProcesses(buf.as_mut_ptr(), buf_bytes, &mut bytes_returned) {
                    log::warn!("EnumProcesses failed: {e}");
                    return Ok(vec![]);
                }
                let used = bytes_returned as usize / std::mem::size_of::<u32>();
                if used < buf.len() {
                    buf.truncate(used);
                    break buf;
                }
                // Buffer was too small — double it and retry, up to the hard cap.
                let next = (buf.len() * 2).min(MAX_PIDS);
                if next <= buf.len() {
                    buf.truncate(used);
                    break buf;
                }
                buf.resize(next, 0);
            }
        };

        let mut map: BTreeMap<String, ExecutableOption> = BTreeMap::new();

        for pid in pids {
            if pid == 0 {
                continue;
            }

            unsafe {
                let handle = match OpenProcess(
                    PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                    false,
                    pid,
                ) {
                    Ok(h) if !h.is_invalid() => h,
                    _ => continue,
                };

                let mut path_buf = [0u16; 260];
                let path_len = GetModuleFileNameExW(handle, None, &mut path_buf);
                let _ = CloseHandle(handle);

                if path_len == 0 {
                    continue;
                }

                let exe_path =
                    String::from_utf16_lossy(&path_buf[..path_len as usize]).to_string();
                if exe_path.is_empty() {
                    continue;
                }

                map.entry(exe_path.clone()).or_insert_with(|| {
                    let stem = std::path::Path::new(&exe_path)
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| exe_path.clone());
                    ExecutableOption {
                        app_name: stem,
                        exe_path,
                    }
                });
            }
        }

        Ok(map.into_values().collect())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}
