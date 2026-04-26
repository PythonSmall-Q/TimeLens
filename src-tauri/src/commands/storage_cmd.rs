use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::sync::OnceLock;
use chrono::Local;
use rusqlite::params;
use tauri::State;

use crate::db;
use crate::models::{
    AppUsageComparison, AppUsageSummary, DailyUsage, ExecutableOption, HourlyDistribution,
    TodoItem, WidgetConfig,
};

pub type DbState = Arc<Mutex<rusqlite::Connection>>;

static RUNNING_EXE_CACHE: OnceLock<Mutex<Option<(Instant, Vec<ExecutableOption>)>>> = OnceLock::new();

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
        const CACHE_TTL: Duration = Duration::from_secs(20);
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let cache = RUNNING_EXE_CACHE.get_or_init(|| Mutex::new(None));
        if let Ok(guard) = cache.lock() {
            if let Some((ts, items)) = &*guard {
                if ts.elapsed() < CACHE_TTL {
                    return Ok(items.clone());
                }
            }
        }

        use std::collections::BTreeSet;
        use std::process::Command;
        use std::os::windows::process::CommandExt;

        let output = Command::new("tasklist")
            .args(["/fo", "csv", "/nh"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Ok(vec![]);
        }

        let text = String::from_utf8_lossy(&output.stdout);
        let mut set = BTreeSet::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let first = line
                .trim_matches('"')
                .split("\",\"")
                .next()
                .unwrap_or("")
                .trim();
            if first.is_empty() {
                continue;
            }
            set.insert(first.to_string());
        }

        let items = set
            .into_iter()
            .map(|exe| ExecutableOption {
                app_name: exe.clone(),
                exe_path: exe,
            })
            .collect::<Vec<_>>();

        if let Ok(mut guard) = cache.lock() {
            *guard = Some((Instant::now(), items.clone()));
        }

        return Ok(items);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportBundle {
    app_usage: Vec<AppUsageRow>,
    todos: Vec<TodoRow>,
    widget_configs: Vec<WidgetConfig>,
    ignored_apps: Vec<String>,
    app_settings: Vec<SettingRow>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AppUsageRow {
    id: Option<i64>,
    date: String,
    app_name: String,
    exe_path: String,
    window_title: String,
    active_seconds: i64,
    first_seen_at: String,
    last_seen_at: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct TodoRow {
    id: Option<i64>,
    content: String,
    done: bool,
    created_at: String,
    order_index: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SettingRow {
    key: String,
    value: String,
}

fn escape_csv(value: &str) -> String {
    let escaped = value.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

#[tauri::command]
pub fn export_data_csv(db: State<DbState>) -> Result<String, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at
             FROM app_usage
             ORDER BY first_seen_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut csv = String::from("date,app_name,exe_path,window_title,active_seconds,first_seen_at,last_seen_at\n");

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let date: String = row.get(0).map_err(|e| e.to_string())?;
        let app_name: String = row.get(1).map_err(|e| e.to_string())?;
        let exe_path: String = row.get(2).map_err(|e| e.to_string())?;
        let window_title: String = row.get(3).map_err(|e| e.to_string())?;
        let active_seconds: i64 = row.get(4).map_err(|e| e.to_string())?;
        let first_seen_at: String = row.get(5).map_err(|e| e.to_string())?;
        let last_seen_at: String = row.get(6).map_err(|e| e.to_string())?;

        csv.push_str(&format!(
            "{},{},{},{},{},{},{}\n",
            escape_csv(&date),
            escape_csv(&app_name),
            escape_csv(&exe_path),
            escape_csv(&window_title),
            active_seconds,
            escape_csv(&first_seen_at),
            escape_csv(&last_seen_at),
        ));
    }

    Ok(csv)
}

#[tauri::command]
pub fn export_data_json(db: State<DbState>) -> Result<String, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let app_usage = {
        let mut stmt = conn
            .prepare(
                "SELECT id, date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at
                 FROM app_usage
                 ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AppUsageRow {
                    id: row.get(0)?,
                    date: row.get(1)?,
                    app_name: row.get(2)?,
                    exe_path: row.get(3)?,
                    window_title: row.get(4)?,
                    active_seconds: row.get(5)?,
                    first_seen_at: row.get(6)?,
                    last_seen_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    let todos = {
        let mut stmt = conn
            .prepare("SELECT id, content, done, created_at, order_index FROM todos ORDER BY order_index ASC, id ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TodoRow {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    done: row.get::<_, i32>(2)? != 0,
                    created_at: row.get(3)?,
                    order_index: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    let widget_configs = db::get_all_widget_configs(&conn).map_err(|e| e.to_string())?;
    let ignored_apps = db::get_ignored_apps(&conn).map_err(|e| e.to_string())?;

    let app_settings = {
        let mut stmt = conn
            .prepare("SELECT key, value FROM app_settings ORDER BY key ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SettingRow {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    let bundle = ExportBundle {
        app_usage,
        todos,
        widget_configs,
        ignored_apps,
        app_settings,
    };

    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_data_json(payload: String, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let bundle: ExportBundle = serde_json::from_str(&payload).map_err(|e| e.to_string())?;

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    for row in bundle.app_usage {
        tx.execute(
            "INSERT INTO app_usage (date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                row.date,
                row.app_name,
                row.exe_path,
                row.window_title,
                row.active_seconds,
                row.first_seen_at,
                row.last_seen_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for row in bundle.todos {
        tx.execute(
            "INSERT INTO todos (id, content, done, created_at, order_index)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               content = excluded.content,
               done = excluded.done,
               created_at = excluded.created_at,
               order_index = excluded.order_index",
            params![row.id, row.content, row.done as i32, row.created_at, row.order_index],
        )
        .map_err(|e| e.to_string())?;
    }

    for cfg in bundle.widget_configs {
        tx.execute(
            "INSERT INTO widget_configs
             (id, widget_type, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                         ON CONFLICT(id) DO UPDATE SET
                             widget_type = excluded.widget_type,
                             x = excluded.x,
                             y = excluded.y,
                             width = excluded.width,
                             height = excluded.height,
                             opacity = excluded.opacity,
                             always_on_top_mode = excluded.always_on_top_mode,
                             pinned = excluded.pinned,
                             start_on_launch = excluded.start_on_launch",
            params![
                cfg.id,
                cfg.widget_type,
                cfg.x,
                cfg.y,
                cfg.width,
                cfg.height,
                cfg.opacity,
                cfg.always_on_top_mode,
                cfg.pinned as i32,
                cfg.start_on_launch as i32,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for exe in bundle.ignored_apps {
        tx.execute(
            "INSERT OR IGNORE INTO ignored_apps (exe_path) VALUES (?1)",
            params![exe],
        )
        .map_err(|e| e.to_string())?;
    }

    for setting in bundle.app_settings {
        tx.execute(
            "INSERT INTO app_settings (key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![setting.key, setting.value],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
