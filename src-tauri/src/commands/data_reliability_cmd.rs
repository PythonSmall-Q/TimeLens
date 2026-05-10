use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{Read, Write};

use chrono::{Duration, Local, NaiveDate};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use zip::{write::FileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::commands::storage_cmd::DbState;
use crate::db;
use crate::monitor::{MonitorStatus, SharedMonitorStatus};
use crate::models::{AppUsageRecord, BrowserSession, TodoItem, WidgetConfig};

const BACKUP_VERSION: &str = "v2";
const BACKUP_PACKAGE_FILE: &str = "backup.json";
const BACKUP_MANIFEST_FILE: &str = "manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupBundleCounts {
    pub app_usage: usize,
    pub browser_sessions: usize,
    pub todos: usize,
    pub widget_configs: usize,
    pub ignored_apps: usize,
    pub app_settings: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub version: String,
    pub app_version: String,
    pub schema_version: String,
    pub locale: String,
    pub created_at: String,
    pub checksum: String,
    pub counts: BackupBundleCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SettingEntry {
    key: String,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupBundle {
    app_usage: Vec<AppUsageRecord>,
    browser_sessions: Vec<BrowserSession>,
    todos: Vec<TodoItem>,
    widget_configs: Vec<WidgetConfig>,
    ignored_apps: Vec<String>,
    app_settings: Vec<SettingEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DataHealthIssue {
    pub code: String,
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DataHealthSummary {
    pub schema_version: String,
    pub integrity_ok: bool,
    pub foreign_key_ok: bool,
    pub index_ok: bool,
    pub app_usage_rows: i64,
    pub daily_app_usage_rows: i64,
    pub archive_rows: i64,
    pub missing_days: Vec<String>,
    pub zero_usage_days: Vec<String>,
    pub issues: Vec<DataHealthIssue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepairActionPreview {
    pub code: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepairAssistantResult {
    pub dry_run: bool,
    pub actions: Vec<RepairActionPreview>,
    pub rebuilt_daily_rows: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupPreview {
    pub manifest: BackupManifest,
    pub compatible: bool,
    pub supported_strategies: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupApplyResult {
    pub manifest: BackupManifest,
    pub strategy: String,
    pub imported_rows: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetentionPolicyInfo {
    pub policy: String,
    pub label: String,
    pub cutoff_date: Option<String>,
    pub estimated_rows: i64,
    pub estimated_storage_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetentionRunResult {
    pub policy: String,
    pub cutoff_date: Option<String>,
    pub archived_app_usage_rows: i64,
    pub archived_daily_rows: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrackingFieldInfo {
    pub field: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrackingWriteEntry {
    pub date: String,
    pub app_name: String,
    pub exe_path: String,
    pub window_title: String,
    pub active_seconds: i64,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrackingTransparencyReport {
    pub status: MonitorStatus,
    pub paused_at: Option<String>,
    pub paused_by: Option<String>,
    pub pause_reason: Option<String>,
    pub tracked_fields: Vec<TrackingFieldInfo>,
    pub writes_last_24h: i64,
    pub writes_last_7d: i64,
    pub recent_writes: Vec<TrackingWriteEntry>,
}

fn now_ts() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

fn system_locale() -> String {
    std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LANGUAGE"))
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_else(|_| "unknown".to_string())
}

fn current_schema_version(conn: &rusqlite::Connection) -> String {
    db::get_setting(conn, "schema_version")
        .ok()
        .flatten()
        .unwrap_or_else(|| "unknown".to_string())
}

fn manifest_to_json(manifest: &BackupManifest) -> Result<String, String> {
    serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())
}

fn bundle_to_json(bundle: &BackupBundle) -> Result<String, String> {
    serde_json::to_string_pretty(bundle).map_err(|e| e.to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn build_bundle(conn: &rusqlite::Connection) -> Result<BackupBundle, String> {
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
                Ok(AppUsageRecord {
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
                Ok(TodoItem {
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

    let browser_sessions = db::get_recent_browser_sessions(conn, 100_000).map_err(|e| e.to_string())?;
    let widget_configs = db::get_all_widget_configs(conn).map_err(|e| e.to_string())?;
    let ignored_apps = db::get_ignored_apps(conn).map_err(|e| e.to_string())?;

    let app_settings = {
        let mut stmt = conn
            .prepare("SELECT key, value FROM app_settings ORDER BY key ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SettingEntry {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    Ok(BackupBundle {
        app_usage,
        browser_sessions,
        todos,
        widget_configs,
        ignored_apps,
        app_settings,
    })
}

fn build_manifest(conn: &rusqlite::Connection, bundle: &BackupBundle, payload_json: &str) -> BackupManifest {
    let checksum = sha256_hex(payload_json.as_bytes());
    BackupManifest {
        version: BACKUP_VERSION.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version: current_schema_version(conn),
        locale: system_locale(),
        created_at: now_ts(),
        checksum,
        counts: BackupBundleCounts {
            app_usage: bundle.app_usage.len(),
            browser_sessions: bundle.browser_sessions.len(),
            todos: bundle.todos.len(),
            widget_configs: bundle.widget_configs.len(),
            ignored_apps: bundle.ignored_apps.len(),
            app_settings: bundle.app_settings.len(),
        },
    }
}

fn write_backup_package(path: &str, manifest: &BackupManifest, payload_json: &str) -> Result<(), String> {
    let file = File::create(path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file(BACKUP_MANIFEST_FILE, options).map_err(|e| e.to_string())?;
    zip.write_all(manifest_to_json(manifest)?.as_bytes()).map_err(|e| e.to_string())?;

    zip.start_file(BACKUP_PACKAGE_FILE, options).map_err(|e| e.to_string())?;
    zip.write_all(payload_json.as_bytes()).map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn read_backup_package(path: &str) -> Result<(BackupManifest, BackupBundle, String), String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut manifest_text = String::new();
    zip.by_name(BACKUP_MANIFEST_FILE)
        .map_err(|e| e.to_string())?
        .read_to_string(&mut manifest_text)
        .map_err(|e| e.to_string())?;
    let manifest: BackupManifest = serde_json::from_str(&manifest_text).map_err(|e| e.to_string())?;

    let mut payload_text = String::new();
    zip.by_name(BACKUP_PACKAGE_FILE)
        .map_err(|e| e.to_string())?
        .read_to_string(&mut payload_text)
        .map_err(|e| e.to_string())?;
    let payload_checksum = sha256_hex(payload_text.as_bytes());
    if payload_checksum != manifest.checksum {
        return Err("backup checksum mismatch".to_string());
    }
    let bundle: BackupBundle = serde_json::from_str(&payload_text).map_err(|e| e.to_string())?;

    Ok((manifest, bundle, payload_text))
}

fn supported_strategies() -> Vec<String> {
    vec!["overwrite".to_string(), "merge".to_string(), "new_profile".to_string()]
}

fn clear_all_user_data(tx: &rusqlite::Transaction<'_>) -> Result<(), String> {
    for table in [
        "app_usage",
        "daily_app_usage",
        "app_usage_archive",
        "daily_app_usage_archive",
        "todos",
        "browser_sessions",
        "widget_configs",
        "ignored_apps",
        "app_settings",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), []).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn apply_bundle(tx: &rusqlite::Transaction<'_>, bundle: BackupBundle) -> Result<usize, String> {
    let mut imported_rows = 0usize;

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
        imported_rows += 1;
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
        imported_rows += 1;
    }

    for session in bundle.browser_sessions {
        tx.execute(
            "INSERT INTO browser_sessions
             (id, browser_name, tab_url, host, title, started_at, ended_at, duration_seconds, locale, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               browser_name = excluded.browser_name,
               tab_url = excluded.tab_url,
               host = excluded.host,
               title = excluded.title,
               started_at = excluded.started_at,
               ended_at = excluded.ended_at,
               duration_seconds = excluded.duration_seconds,
               locale = excluded.locale,
               synced_at = excluded.synced_at",
            params![
                session.id,
                session.browser_name,
                session.tab_url,
                session.host,
                session.title,
                session.started_at,
                session.ended_at,
                session.duration_seconds,
                session.locale,
                session.synced_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for cfg in bundle.widget_configs {
        tx.execute(
            "INSERT INTO widget_configs
             (id, widget_type, monitor_index, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
                 widget_type = excluded.widget_type,
                 monitor_index = excluded.monitor_index,
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
                cfg.monitor_index,
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
        imported_rows += 1;
    }

    tx.execute("DELETE FROM ignored_apps", []).map_err(|e| e.to_string())?;
    for p in bundle.ignored_apps {
        tx.execute("INSERT OR IGNORE INTO ignored_apps(exe_path) VALUES(?1)", params![p])
            .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for setting in bundle.app_settings {
        tx.execute(
            "INSERT INTO app_settings (key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![setting.key, setting.value],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    Ok(imported_rows)
}

fn date_days_ago(days: i64) -> String {
    (Local::now() - Duration::days(days)).format("%Y-%m-%d").to_string()
}

fn retention_days(policy: &str) -> Option<i64> {
    match policy {
        "3m" => Some(90),
        "6m" => Some(180),
        "12m" => Some(365),
        _ => None,
    }
}

fn retention_label(policy: &str) -> String {
    match policy {
        "3m" => "3 months".to_string(),
        "6m" => "6 months".to_string(),
        "12m" => "12 months".to_string(),
        _ => "Keep all".to_string(),
    }
}

fn missing_and_zero_days(conn: &rusqlite::Connection) -> Result<(Vec<String>, Vec<String>), String> {
    let mut stmt = conn
        .prepare("SELECT date, COALESCE(SUM(total_seconds), 0) FROM daily_app_usage GROUP BY date ORDER BY date")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut day_map = BTreeMap::new();
    for row in rows {
        let (date, total) = row.map_err(|e| e.to_string())?;
        day_map.insert(date, total);
    }

    if day_map.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    let min_date = NaiveDate::parse_from_str(day_map.keys().next().unwrap(), "%Y-%m-%d").map_err(|e| e.to_string())?;
    let max_date = NaiveDate::parse_from_str(day_map.keys().last().unwrap(), "%Y-%m-%d").map_err(|e| e.to_string())?;

    let mut missing_days = Vec::new();
    let mut zero_usage_days = Vec::new();
    let mut current = min_date;
    while current <= max_date {
        let key = current.format("%Y-%m-%d").to_string();
        match day_map.get(&key).copied() {
            Some(total) if total <= 0 => zero_usage_days.push(key),
            Some(_) => {}
            None => missing_days.push(key),
        }
        current += chrono::Duration::days(1);
    }

    Ok((missing_days, zero_usage_days))
}

fn index_ok(conn: &rusqlite::Connection) -> Result<bool, String> {
    let expected = [
        "idx_app_usage_date",
        "idx_app_usage_app_date",
        "idx_daily_app_usage_date",
    ];
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut existing = BTreeSet::new();
    for row in rows {
        existing.insert(row.map_err(|e| e.to_string())?);
    }
    Ok(expected.iter().all(|name| existing.contains(*name)))
}

fn ensure_core_indexes(conn: &rusqlite::Connection) -> Result<i64, String> {
    let specs = [
        ("idx_app_usage_date", "CREATE INDEX IF NOT EXISTS idx_app_usage_date ON app_usage(date)"),
        (
            "idx_app_usage_app_date",
            "CREATE INDEX IF NOT EXISTS idx_app_usage_app_date ON app_usage(app_name, date)",
        ),
        (
            "idx_daily_app_usage_date",
            "CREATE INDEX IF NOT EXISTS idx_daily_app_usage_date ON daily_app_usage(date)",
        ),
    ];

    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut existing = BTreeSet::new();
    for row in rows {
        existing.insert(row.map_err(|e| e.to_string())?);
    }

    let mut repaired = 0_i64;
    for (name, ddl) in specs {
        if !existing.contains(name) {
            conn.execute(ddl, []).map_err(|e| e.to_string())?;
            repaired += 1;
        }
    }

    Ok(repaired)
}

#[tauri::command]
pub fn get_data_health_summary(db: State<DbState>) -> Result<DataHealthSummary, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let integrity_ok = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        == "ok";

    let fk_rows: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA foreign_key_check").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |_| Ok(String::new())).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    let index_ok = index_ok(&conn)?;
    let app_usage_rows = conn
        .query_row("SELECT COUNT(1) FROM app_usage", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let daily_app_usage_rows = conn
        .query_row("SELECT COUNT(1) FROM daily_app_usage", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let archive_rows = conn
        .query_row(
            "SELECT (SELECT COUNT(1) FROM app_usage_archive) + (SELECT COUNT(1) FROM daily_app_usage_archive)",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let (missing_days, zero_usage_days) = missing_and_zero_days(&conn)?;

    let mut issues = Vec::new();
    if !integrity_ok {
        issues.push(DataHealthIssue {
            code: "integrity_check".to_string(),
            severity: "error".to_string(),
            title: "SQLite integrity check failed".to_string(),
            detail: "PRAGMA integrity_check returned a non-ok result".to_string(),
            count: 1,
        });
    }
    if !fk_rows.is_empty() {
        issues.push(DataHealthIssue {
            code: "foreign_key_check".to_string(),
            severity: "error".to_string(),
            title: "Foreign key violations found".to_string(),
            detail: "One or more rows failed PRAGMA foreign_key_check".to_string(),
            count: fk_rows.len() as i64,
        });
    }
    if !index_ok {
        issues.push(DataHealthIssue {
            code: "index_check".to_string(),
            severity: "warning".to_string(),
            title: "Expected indexes are missing".to_string(),
            detail: "One or more core app_usage indexes are absent".to_string(),
            count: 1,
        });
    }
    if !missing_days.is_empty() {
        issues.push(DataHealthIssue {
            code: "missing_days".to_string(),
            severity: "warning".to_string(),
            title: "Missing timeline days".to_string(),
            detail: "Detected gaps in the daily usage timeline".to_string(),
            count: missing_days.len() as i64,
        });
    }
    if !zero_usage_days.is_empty() {
        issues.push(DataHealthIssue {
            code: "zero_usage_days".to_string(),
            severity: "info".to_string(),
            title: "Zero-usage days detected".to_string(),
            detail: "Days with no tracked usage were found in the timeline".to_string(),
            count: zero_usage_days.len() as i64,
        });
    }

    Ok(DataHealthSummary {
        schema_version: current_schema_version(&conn),
        integrity_ok,
        foreign_key_ok: fk_rows.is_empty(),
        index_ok,
        app_usage_rows,
        daily_app_usage_rows,
        archive_rows,
        missing_days,
        zero_usage_days,
        issues,
    })
}

#[tauri::command]
pub fn export_backup_v2(path: String, db: State<DbState>) -> Result<BackupManifest, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let bundle = build_bundle(&conn)?;
    let payload_json = bundle_to_json(&bundle)?;
    let manifest = build_manifest(&conn, &bundle, &payload_json);
    write_backup_package(&path, &manifest, &payload_json)?;
    Ok(manifest)
}

#[tauri::command]
pub fn import_backup_v2_validate(path: String, db: State<DbState>) -> Result<BackupPreview, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let (manifest, _bundle, _payload_json) = read_backup_package(&path)?;
    let current_schema = current_schema_version(&conn);
    let compatible = manifest.schema_version == current_schema || manifest.schema_version == "unknown";
    let mut warnings = Vec::new();
    if manifest.schema_version != current_schema {
        warnings.push(format!("backup schema {} does not match current schema {}", manifest.schema_version, current_schema));
    }
    if manifest.version != BACKUP_VERSION {
        warnings.push(format!("backup version {} is not the expected {}", manifest.version, BACKUP_VERSION));
    }

    Ok(BackupPreview {
        manifest,
        compatible,
        supported_strategies: supported_strategies(),
        warnings,
    })
}

#[tauri::command]
pub fn import_backup_v2_apply(
    path: String,
    strategy: String,
    db: State<DbState>,
) -> Result<BackupApplyResult, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let (manifest, bundle, _payload_json) = read_backup_package(&path)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let strategy_name = match strategy.as_str() {
        "overwrite" => {
            clear_all_user_data(&tx)?;
            "overwrite"
        }
        "merge" => "merge",
        "new_profile" => {
            return Err("new_profile restore is not supported yet".to_string());
        }
        _ => return Err("invalid backup restore strategy".to_string()),
    };

    let imported_rows = apply_bundle(&tx, bundle)?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(BackupApplyResult {
        manifest,
        strategy: strategy_name.to_string(),
        imported_rows,
        warnings: Vec::new(),
    })
}

#[tauri::command]
pub fn get_retention_policy_info(db: State<DbState>) -> Result<RetentionPolicyInfo, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let policy = db::get_setting(&conn, "retention_policy")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "keep_all".to_string());
    let days = retention_days(&policy);
    let cutoff_date = days.map(date_days_ago);
    let estimated_rows = if let Some(days) = days {
        let cutoff = date_days_ago(days);
        let app_rows: i64 = conn
            .query_row("SELECT COUNT(1) FROM app_usage WHERE date < ?1", params![cutoff], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let daily_rows: i64 = conn
            .query_row("SELECT COUNT(1) FROM daily_app_usage WHERE date < ?1", params![cutoff], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        app_rows + daily_rows
    } else {
        0
    };
    Ok(RetentionPolicyInfo {
        policy: policy.clone(),
        label: retention_label(&policy),
        cutoff_date,
        estimated_rows,
        estimated_storage_bytes: estimated_rows.saturating_mul(256),
    })
}

#[tauri::command]
pub fn set_retention_policy(policy: String, db: State<DbState>) -> Result<(), String> {
    let policy = match policy.as_str() {
        "keep_all" | "3m" | "6m" | "12m" => policy,
        _ => return Err("invalid retention policy".to_string()),
    };
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "retention_policy", &policy).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_local_archive_now(db: State<DbState>) -> Result<RetentionRunResult, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let policy = db::get_setting(&conn, "retention_policy")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "keep_all".to_string());
    let Some(days) = retention_days(&policy) else {
        return Ok(RetentionRunResult {
            policy,
            cutoff_date: None,
            archived_app_usage_rows: 0,
            archived_daily_rows: 0,
        });
    };

    let cutoff = date_days_ago(days);
    let archived_at = now_ts();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let archived_app_usage_rows = tx
        .execute(
            "INSERT OR IGNORE INTO app_usage_archive
             (id, date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at, archived_at)
             SELECT id, date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at, ?1
             FROM app_usage
             WHERE date < ?2",
            params![archived_at, cutoff],
        )
        .map_err(|e| e.to_string())? as i64;
    tx.execute("DELETE FROM app_usage WHERE date < ?1", params![cutoff])
        .map_err(|e| e.to_string())?;

    let archived_daily_rows = tx
        .execute(
            "INSERT OR IGNORE INTO daily_app_usage_archive
             (date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at, archived_at)
             SELECT date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at, ?1
             FROM daily_app_usage
             WHERE date < ?2",
            params![archived_at, cutoff],
        )
        .map_err(|e| e.to_string())? as i64;
    tx.execute("DELETE FROM daily_app_usage WHERE date < ?1", params![cutoff])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(RetentionRunResult {
        policy,
        cutoff_date: Some(cutoff),
        archived_app_usage_rows,
        archived_daily_rows,
    })
}

#[tauri::command]
pub fn get_tracking_transparency(status: State<SharedMonitorStatus>, db: State<DbState>) -> Result<TrackingTransparencyReport, String> {
    let monitor_status = status.lock().map_err(|e| e.to_string())?.clone();
    let conn = db.lock().map_err(|e| e.to_string())?;
    let paused_at = db::get_setting(&conn, "tracking_paused_at")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty());
    let paused_by = db::get_setting(&conn, "tracking_paused_by")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty());
    let pause_reason = db::get_setting(&conn, "tracking_pause_reason")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty());

    let tracked_fields = vec![
        TrackingFieldInfo { field: "app_name".to_string(), description: "Human-readable application name".to_string() },
        TrackingFieldInfo { field: "exe_path".to_string(), description: "Executable path used for grouping and exclusions".to_string() },
        TrackingFieldInfo { field: "window_title".to_string(), description: "Current foreground window title".to_string() },
        TrackingFieldInfo { field: "active_seconds".to_string(), description: "Tracked duration for the usage slice".to_string() },
        TrackingFieldInfo { field: "first_seen_at".to_string(), description: "Timestamp when the slice started".to_string() },
        TrackingFieldInfo { field: "last_seen_at".to_string(), description: "Timestamp when the slice ended".to_string() },
    ];

    let recent_writes = {
        let mut stmt = conn
            .prepare(
                "SELECT date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at
                 FROM app_usage
                 ORDER BY id DESC
                 LIMIT 8",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TrackingWriteEntry {
                    date: row.get(0)?,
                    app_name: row.get(1)?,
                    exe_path: row.get(2)?,
                    window_title: row.get(3)?,
                    active_seconds: row.get(4)?,
                    first_seen_at: row.get(5)?,
                    last_seen_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    let now = now_ts();
    let writes_last_24h = conn
        .query_row(
            "SELECT COUNT(1) FROM app_usage WHERE first_seen_at >= ?1",
            params![(Local::now() - Duration::hours(24)).format("%Y-%m-%dT%H:%M:%S").to_string()],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let writes_last_7d = conn
        .query_row(
            "SELECT COUNT(1) FROM app_usage WHERE first_seen_at >= ?1",
            params![(Local::now() - Duration::days(7)).format("%Y-%m-%dT%H:%M:%S").to_string()],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let _ = now;

    Ok(TrackingTransparencyReport {
        status: monitor_status,
        paused_at,
        paused_by,
        pause_reason,
        tracked_fields,
        writes_last_24h,
        writes_last_7d,
        recent_writes,
    })
}

#[tauri::command]
pub fn repair_data_issues(
    dry_run: bool,
    db: State<DbState>,
    status: State<SharedMonitorStatus>,
) -> Result<RepairAssistantResult, String> {
    let mut restore_monitor = false;
    if !dry_run {
        if let Ok(mut monitor) = status.lock() {
            restore_monitor = monitor.active;
            monitor.active = false;
        }
    }

    let run_result: Result<RepairAssistantResult, String> = (|| {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let actions = vec![
            RepairActionPreview {
                code: "rebuild_daily_aggregates".to_string(),
                description: "Rebuild daily_app_usage from app_usage to restore aggregate consistency"
                    .to_string(),
            },
            RepairActionPreview {
                code: "ensure_core_indexes".to_string(),
                description: "Ensure missing core indexes are present for stable query performance"
                    .to_string(),
            },
        ];

        if dry_run {
            let rebuilt_daily_rows = conn
                .query_row(
                    "SELECT COUNT(1)
                     FROM (
                        SELECT 1
                        FROM app_usage
                        GROUP BY date, app_name, COALESCE(exe_path, '')
                     )",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            return Ok(RepairAssistantResult {
                dry_run: true,
                actions,
                rebuilt_daily_rows,
            });
        }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM daily_app_usage", [])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO daily_app_usage (date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at)
             SELECT date,
                    app_name,
                    COALESCE(exe_path, '') as exe_path,
                    SUM(active_seconds) as total_seconds,
                    MIN(first_seen_at) as first_seen_at,
                    MAX(last_seen_at) as last_seen_at
             FROM app_usage
             GROUP BY date, app_name, COALESCE(exe_path, '')",
            [],
        )
        .map_err(|e| e.to_string())?;
        let rebuilt_daily_rows = tx
            .query_row("SELECT COUNT(1) FROM daily_app_usage", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;

        let _ = ensure_core_indexes(&conn)?;

        Ok(RepairAssistantResult {
            dry_run: false,
            actions,
            rebuilt_daily_rows,
        })
    })();

    if restore_monitor {
        if let Ok(mut monitor) = status.lock() {
            monitor.active = true;
        }
    }

    run_result
}