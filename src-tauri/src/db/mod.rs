use rusqlite::{params, Connection, Result};
use std::path::Path;

/// Create all tables if they don't exist yet.
pub fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS app_usage (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            date            TEXT    NOT NULL,
            app_name        TEXT    NOT NULL,
            exe_path        TEXT    NOT NULL DEFAULT '',
            window_title    TEXT    NOT NULL DEFAULT '',
            active_seconds  INTEGER NOT NULL DEFAULT 0,
            first_seen_at   TEXT    NOT NULL,
            last_seen_at    TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_app_usage_date     ON app_usage(date);
        CREATE INDEX IF NOT EXISTS idx_app_usage_app_date ON app_usage(app_name, date);

        CREATE TABLE IF NOT EXISTS todos (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            content     TEXT    NOT NULL,
            done        INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT    NOT NULL,
            order_index INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS widget_configs (
            id                  TEXT PRIMARY KEY,
            widget_type         TEXT    NOT NULL,
            x                   REAL    NOT NULL DEFAULT 100,
            y                   REAL    NOT NULL DEFAULT 100,
            width               REAL    NOT NULL DEFAULT 320,
            height              REAL    NOT NULL DEFAULT 220,
            opacity             REAL    NOT NULL DEFAULT 0.85,
            always_on_top_mode  TEXT    NOT NULL DEFAULT 'focus',
            pinned              INTEGER NOT NULL DEFAULT 0,
            start_on_launch     INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS ignored_apps (
            exe_path    TEXT PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key     TEXT PRIMARY KEY,
            value   TEXT NOT NULL
        );
        ",
    )?;

    // Lightweight migrations for existing DB files.
    let columns = table_columns(conn, "app_usage")?;
    if !columns.iter().any(|c| c == "exe_path") {
        conn.execute(
            "ALTER TABLE app_usage ADD COLUMN exe_path TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    let widget_columns = table_columns(conn, "widget_configs")?;
    if !widget_columns.iter().any(|c| c == "start_on_launch") {
        conn.execute(
            "ALTER TABLE widget_configs ADD COLUMN start_on_launch INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }

    Ok(())
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    rows.collect()
}

/// Open (or create) the database at the given path and run migrations.
pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;
    }
    let conn = Connection::open(path)?;
    initialize(&conn)?;
    Ok(conn)
}

// ── App usage queries ─────────────────────────────────────────

/// Upsert: add seconds to an existing (date, app_name) row or create it.
pub fn upsert_app_usage(
    conn: &Connection,
    date: &str,
    app_name: &str,
    exe_path: &str,
    window_title: &str,
    seconds: i64,
    first_seen: &str,
    last_seen: &str,
) -> Result<()> {
    conn.execute(
        "
        INSERT INTO app_usage (date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(rowid) DO NOTHING
        ",
        params![date, app_name, exe_path, window_title, seconds, first_seen, last_seen],
    )?;
    Ok(())
}

/// Insert a new app usage segment.
pub fn insert_app_usage(
    conn: &Connection,
    date: &str,
    app_name: &str,
    exe_path: &str,
    window_title: &str,
    seconds: i64,
    first_seen: &str,
    last_seen: &str,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO app_usage
            (date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![date, app_name, exe_path, window_title, seconds, first_seen, last_seen],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Get per-app totals for a given date, sorted descending.
pub fn get_daily_app_totals(conn: &Connection, date: &str) -> Result<Vec<(String, String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT app_name,
                COALESCE(MAX(exe_path), '') as exe_path,
                SUM(active_seconds) as total
         FROM app_usage
         WHERE date = ?1
           AND COALESCE(exe_path, '') NOT IN (SELECT exe_path FROM ignored_apps)
         GROUP BY app_name
         ORDER BY total DESC",
    )?;
    let rows = stmt.query_map(params![date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    rows.collect()
}

pub fn get_app_totals_in_range(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<(String, String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT app_name,
                COALESCE(MAX(exe_path), '') as exe_path,
                SUM(active_seconds) as total
         FROM app_usage
         WHERE date >= ?1 AND date <= ?2
           AND COALESCE(exe_path, '') NOT IN (SELECT exe_path FROM ignored_apps)
         GROUP BY app_name
         ORDER BY total DESC",
    )?;
    let rows = stmt.query_map(params![start_date, end_date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    rows.collect()
}

/// Get hourly distribution (hour 0-23, seconds) for a given date.
pub fn get_hourly_distribution(conn: &Connection, date: &str) -> Result<Vec<(i32, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT CAST(strftime('%H', first_seen_at) AS INTEGER) as hour,
                SUM(active_seconds) as seconds
         FROM app_usage
         WHERE date = ?1
           AND COALESCE(exe_path, '') NOT IN (SELECT exe_path FROM ignored_apps)
         GROUP BY hour
         ORDER BY hour",
    )?;
    let rows = stmt.query_map(params![date], |row| {
        Ok((row.get::<_, i32>(0)?, row.get::<_, i64>(1)?))
    })?;
    rows.collect()
}

/// Get total seconds for each of the past N days.
pub fn get_daily_totals(conn: &Connection, since_date: &str) -> Result<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT date, SUM(active_seconds) as total
         FROM app_usage
         WHERE date >= ?1
           AND COALESCE(exe_path, '') NOT IN (SELECT exe_path FROM ignored_apps)
         GROUP BY date
         ORDER BY date",
    )?;
    let rows = stmt.query_map(params![since_date], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    rows.collect()
}

pub fn get_recent_executables(conn: &Connection, limit: i64) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT app_name, exe_path
         FROM app_usage
         WHERE COALESCE(exe_path, '') <> ''
         GROUP BY exe_path
         ORDER BY MAX(last_seen_at) DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

// ── Todo queries ──────────────────────────────────────────────

pub fn get_all_todos(conn: &Connection) -> Result<Vec<crate::models::TodoItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, content, done, created_at, order_index
         FROM todos ORDER BY order_index ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(crate::models::TodoItem {
            id: Some(row.get(0)?),
            content: row.get(1)?,
            done: row.get::<_, i32>(2)? != 0,
            created_at: row.get(3)?,
            order_index: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn insert_todo(conn: &Connection, content: &str, order_index: i64) -> Result<i64> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO todos (content, done, created_at, order_index) VALUES (?1, 0, ?2, ?3)",
        params![content, now, order_index],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn toggle_todo(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE todos SET done = CASE WHEN done = 0 THEN 1 ELSE 0 END WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn delete_todo(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM todos WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn reorder_todo(conn: &Connection, id: i64, order_index: i64) -> Result<()> {
    conn.execute(
        "UPDATE todos SET order_index = ?1 WHERE id = ?2",
        params![order_index, id],
    )?;
    Ok(())
}

// ── Widget config queries ─────────────────────────────────────

pub fn get_widget_config(conn: &Connection, id: &str) -> Result<Option<crate::models::WidgetConfig>> {
    let mut stmt = conn.prepare(
        "SELECT id, widget_type, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch
         FROM widget_configs WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(crate::models::WidgetConfig {
            id: row.get(0)?,
            widget_type: row.get(1)?,
            x: row.get(2)?,
            y: row.get(3)?,
            width: row.get(4)?,
            height: row.get(5)?,
            opacity: row.get(6)?,
            always_on_top_mode: row.get(7)?,
            pinned: row.get::<_, i32>(8)? != 0,
            start_on_launch: row.get::<_, i32>(9)? != 0,
        })
    })?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn get_all_widget_configs(conn: &Connection) -> Result<Vec<crate::models::WidgetConfig>> {
    let mut stmt = conn.prepare(
        "SELECT id, widget_type, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch
         FROM widget_configs",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(crate::models::WidgetConfig {
            id: row.get(0)?,
            widget_type: row.get(1)?,
            x: row.get(2)?,
            y: row.get(3)?,
            width: row.get(4)?,
            height: row.get(5)?,
            opacity: row.get(6)?,
            always_on_top_mode: row.get(7)?,
            pinned: row.get::<_, i32>(8)? != 0,
            start_on_launch: row.get::<_, i32>(9)? != 0,
        })
    })?;
    rows.collect()
}

pub fn upsert_widget_config(conn: &Connection, cfg: &crate::models::WidgetConfig) -> Result<()> {
    conn.execute(
        "INSERT INTO widget_configs
            (id, widget_type, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET
            x=excluded.x, y=excluded.y,
            width=excluded.width, height=excluded.height,
            opacity=excluded.opacity,
            always_on_top_mode=excluded.always_on_top_mode,
            pinned=excluded.pinned,
            start_on_launch=excluded.start_on_launch",
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
            cfg.start_on_launch as i32
        ],
    )?;
    Ok(())
}

pub fn delete_widget_config(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM widget_configs WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Ignored apps ──────────────────────────────────────────────

pub fn get_ignored_apps(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT exe_path FROM ignored_apps ORDER BY exe_path ASC")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

pub fn set_ignored_apps(conn: &Connection, exe_paths: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM ignored_apps", [])?;
    for p in exe_paths {
        if p.trim().is_empty() {
            continue;
        }
        tx.execute(
            "INSERT OR IGNORE INTO ignored_apps(exe_path) VALUES(?1)",
            params![p],
        )?;
    }
    tx.commit()?;
    Ok(())
}

// ── App settings ─────────────────────────────────────────────

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO app_settings (key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_bool_setting(conn: &Connection, key: &str, default_value: bool) -> Result<bool> {
    let value = get_setting(conn, key)?;
    Ok(match value.as_deref() {
        Some("1") | Some("true") | Some("TRUE") => true,
        Some("0") | Some("false") | Some("FALSE") => false,
        Some(v) => v.parse::<bool>().unwrap_or(default_value),
        None => default_value,
    })
}

pub fn set_bool_setting(conn: &Connection, key: &str, value: bool) -> Result<()> {
    set_setting(conn, key, if value { "1" } else { "0" })
}
