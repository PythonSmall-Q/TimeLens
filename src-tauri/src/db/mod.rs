use rusqlite::{params, Connection, Result};
use std::path::Path;

const SYSTEM_INTERACTIVE_EXE_WHITELIST_SQL: &str = "
    lower(COALESCE(exe_path, '')) LIKE '%\\explorer.exe'
    OR lower(COALESCE(exe_path, '')) LIKE '%\\taskmgr.exe'
    OR lower(COALESCE(exe_path, '')) LIKE '%\\notepad.exe'
    OR lower(COALESCE(exe_path, '')) LIKE '%\\mspaint.exe'
    OR lower(COALESCE(exe_path, '')) LIKE '%\\calc.exe'
    OR lower(COALESCE(exe_path, '')) LIKE '%\\cmd.exe'
    OR lower(COALESCE(exe_path, '')) LIKE '%\\powershell.exe'
";

const SYSTEM_PROCESS_FILTER_SQL: &str = "
    (?X = 0 OR NOT (
        (
            lower(replace(COALESCE(exe_path, ''), '/', '\\')) LIKE '%\\windows\\system32\\%'
            OR lower(replace(COALESCE(exe_path, ''), '/', '\\')) LIKE '%\\windows\\syswow64\\%'
        )
        AND NOT (
            __WHITELIST__
        )
    ))
";

fn system_process_filter_sql_with_param(param_index: i32) -> String {
    SYSTEM_PROCESS_FILTER_SQL
        .replace("?X", &format!("?{param_index}"))
        .replace("__WHITELIST__", SYSTEM_INTERACTIVE_EXE_WHITELIST_SQL)
}

fn normalized_exe_path(input: &str) -> String {
    input.trim().replace('/', "\\").to_ascii_lowercase()
}

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

        CREATE TABLE IF NOT EXISTS daily_app_usage (
            date            TEXT    NOT NULL,
            app_name        TEXT    NOT NULL,
            exe_path        TEXT    NOT NULL DEFAULT '',
            total_seconds   INTEGER NOT NULL DEFAULT 0,
            first_seen_at   TEXT    NOT NULL,
            last_seen_at    TEXT    NOT NULL,
            PRIMARY KEY (date, app_name, exe_path)
        );

        CREATE INDEX IF NOT EXISTS idx_daily_app_usage_date ON daily_app_usage(date);

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
            monitor_index       INTEGER NOT NULL DEFAULT -1,
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

        CREATE TABLE IF NOT EXISTS app_categories (
            exe_path    TEXT PRIMARY KEY,
            app_name    TEXT NOT NULL DEFAULT '',
            category    TEXT NOT NULL,
            source      TEXT NOT NULL DEFAULT 'manual',
            updated_at  TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_app_categories_category ON app_categories(category);

        CREATE TABLE IF NOT EXISTS usage_goals (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            scope_type      TEXT    NOT NULL,
            scope_value     TEXT    NOT NULL,
            period          TEXT    NOT NULL,
            operator        TEXT    NOT NULL,
            target_seconds  INTEGER NOT NULL,
            enabled         INTEGER NOT NULL DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_usage_goals_scope ON usage_goals(scope_type, scope_value);

        CREATE TABLE IF NOT EXISTS focus_sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at      TEXT    NOT NULL,
            ended_at        TEXT,
            trigger_type    TEXT    NOT NULL DEFAULT 'manual',
            reason          TEXT    NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_focus_sessions_started_at ON focus_sessions(started_at DESC);

        CREATE TABLE IF NOT EXISTS focus_triggers (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            name                TEXT    NOT NULL,
            match_type          TEXT    NOT NULL,
            keyword             TEXT    NOT NULL,
            auto_enter_focus    INTEGER NOT NULL DEFAULT 1,
            enabled             INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS browser_sessions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            browser_name        TEXT    NOT NULL,
            tab_url             TEXT    NOT NULL,
            host                TEXT    NOT NULL DEFAULT '',
            title               TEXT    NOT NULL DEFAULT '',
            started_at          TEXT    NOT NULL,
            ended_at            TEXT    NOT NULL,
            duration_seconds    INTEGER NOT NULL DEFAULT 0,
            locale              TEXT    NOT NULL DEFAULT '',
            synced_at           TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_browser_sessions_ended_at ON browser_sessions(ended_at DESC);
        CREATE INDEX IF NOT EXISTS idx_browser_sessions_host    ON browser_sessions(host);

        CREATE TABLE IF NOT EXISTS browser_ignored_domains (
            host    TEXT PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS browser_domain_limits (
            host                TEXT    PRIMARY KEY,
            daily_limit_seconds INTEGER NOT NULL DEFAULT 3600,
            enabled             INTEGER NOT NULL DEFAULT 1,
            updated_at          TEXT    NOT NULL
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
    if !widget_columns.iter().any(|c| c == "monitor_index") {
        conn.execute(
            "ALTER TABLE widget_configs ADD COLUMN monitor_index INTEGER NOT NULL DEFAULT -1",
            [],
        )?;
    }

    // Backfill daily aggregates for existing records.
    conn.execute(
        "INSERT INTO daily_app_usage (date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at)
         SELECT date,
                app_name,
                COALESCE(exe_path, '') as exe_path,
                SUM(active_seconds) as total_seconds,
                MIN(first_seen_at) as first_seen_at,
                MAX(last_seen_at) as last_seen_at
         FROM app_usage
         GROUP BY date, app_name, COALESCE(exe_path, '')
         ON CONFLICT(date, app_name, exe_path) DO UPDATE SET
            total_seconds = excluded.total_seconds,
            first_seen_at = excluded.first_seen_at,
            last_seen_at = excluded.last_seen_at",
        [],
    )?;

    set_setting(conn, "schema_version", "2")?;

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
    conn.execute(
        "INSERT INTO daily_app_usage (date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(date, app_name, exe_path) DO UPDATE SET
            total_seconds = total_seconds + excluded.total_seconds,
            first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
            last_seen_at = MAX(last_seen_at, excluded.last_seen_at)",
        params![date, app_name, exe_path, seconds, first_seen, last_seen],
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
    conn.execute(
        "INSERT INTO daily_app_usage (date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(date, app_name, exe_path) DO UPDATE SET
            total_seconds = total_seconds + excluded.total_seconds,
            first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
            last_seen_at = MAX(last_seen_at, excluded.last_seen_at)",
        params![date, app_name, exe_path, seconds, first_seen, last_seen],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Get per-app totals for a given date, sorted descending.
pub fn get_daily_app_totals(conn: &Connection, date: &str) -> Result<Vec<(String, String, i64)>> {
        let ignore_system = get_bool_setting(conn, "ignore_system_processes", false)? as i32;
        let sql = format!(
                "SELECT app_name,
                                COALESCE(MAX(exe_path), '') as exe_path,
                                SUM(total_seconds) as total
                 FROM daily_app_usage
                 WHERE date = ?1
                     AND lower(COALESCE(exe_path, '')) NOT IN (SELECT exe_path FROM ignored_apps)
                     AND {}
                 GROUP BY app_name
                 ORDER BY total DESC",
                system_process_filter_sql_with_param(2)
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![date, ignore_system], |row| {
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
        let ignore_system = get_bool_setting(conn, "ignore_system_processes", false)? as i32;
        let sql = format!(
                "SELECT app_name,
                                COALESCE(MAX(exe_path), '') as exe_path,
                                SUM(total_seconds) as total
                 FROM daily_app_usage
                 WHERE date >= ?1 AND date <= ?2
                     AND lower(COALESCE(exe_path, '')) NOT IN (SELECT exe_path FROM ignored_apps)
                     AND {}
                 GROUP BY app_name
                 ORDER BY total DESC",
                system_process_filter_sql_with_param(3)
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![start_date, end_date, ignore_system], |row| {
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
    let ignore_system = get_bool_setting(conn, "ignore_system_processes", false)? as i32;
    let sql = format!(
        "SELECT CAST(strftime('%H', first_seen_at) AS INTEGER) as hour,
                SUM(active_seconds) as seconds
         FROM app_usage
         WHERE date = ?1
           AND lower(COALESCE(exe_path, '')) NOT IN (SELECT exe_path FROM ignored_apps)
           AND {}
         GROUP BY hour
         ORDER BY hour",
        system_process_filter_sql_with_param(2)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date, ignore_system], |row| {
        Ok((row.get::<_, i32>(0)?, row.get::<_, i64>(1)?))
    })?;
    rows.collect()
}

/// Get total seconds for each of the past N days.
pub fn get_daily_totals(conn: &Connection, since_date: &str) -> Result<Vec<(String, i64)>> {
    let ignore_system = get_bool_setting(conn, "ignore_system_processes", false)? as i32;
    let sql = format!(
        "SELECT date, SUM(total_seconds) as total
         FROM daily_app_usage
         WHERE date >= ?1
           AND lower(COALESCE(exe_path, '')) NOT IN (SELECT exe_path FROM ignored_apps)
           AND {}
         GROUP BY date
         ORDER BY date",
        system_process_filter_sql_with_param(2)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![since_date, ignore_system], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    rows.collect()
}

pub fn get_recent_executables(conn: &Connection, limit: i64) -> Result<Vec<(String, String)>> {
    let ignore_system = get_bool_setting(conn, "ignore_system_processes", false)? as i32;
    let sql = format!(
        "SELECT app_name, exe_path
         FROM app_usage
         WHERE COALESCE(exe_path, '') <> ''
           AND {}
         GROUP BY exe_path
         ORDER BY MAX(last_seen_at) DESC
         LIMIT ?1",
        system_process_filter_sql_with_param(2)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit, ignore_system], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

pub fn get_category_totals_in_range(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<(String, i64)>> {
    let ignore_system = get_bool_setting(conn, "ignore_system_processes", false)? as i32;
    let mut stmt = conn.prepare(
        "SELECT COALESCE(c.category, 'uncategorized') as category,
                SUM(d.total_seconds) as total
         FROM daily_app_usage d
         LEFT JOIN app_categories c
           ON lower(COALESCE(d.exe_path, '')) = c.exe_path
         WHERE d.date >= ?1 AND d.date <= ?2
           AND lower(COALESCE(d.exe_path, '')) NOT IN (SELECT exe_path FROM ignored_apps)
           AND (?3 = 0 OR NOT (
                (
                    lower(replace(COALESCE(d.exe_path, ''), '/', '\\')) LIKE '%\\windows\\system32\\%'
                    OR lower(replace(COALESCE(d.exe_path, ''), '/', '\\')) LIKE '%\\windows\\syswow64\\%'
                )
                AND NOT (
                    lower(COALESCE(d.exe_path, '')) LIKE '%\\explorer.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\taskmgr.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\notepad.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\mspaint.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\calc.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\cmd.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\powershell.exe'
                )
           ))
         GROUP BY COALESCE(c.category, 'uncategorized')
         ORDER BY total DESC",
    )?;
    let rows = stmt.query_map(params![start_date, end_date, ignore_system], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    rows.collect()
}

pub fn get_daily_totals_in_range(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<(String, i64)>> {
    let ignore_system = get_bool_setting(conn, "ignore_system_processes", false)? as i32;
    let sql = format!(
        "SELECT date, SUM(total_seconds) as total
         FROM daily_app_usage
         WHERE date >= ?1 AND date <= ?2
           AND lower(COALESCE(exe_path, '')) NOT IN (SELECT exe_path FROM ignored_apps)
           AND {}
         GROUP BY date
         ORDER BY date",
        system_process_filter_sql_with_param(3)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![start_date, end_date, ignore_system], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    rows.collect()
}

pub fn get_category_daily_totals_in_range(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<(String, String, i64)>> {
    let ignore_system = get_bool_setting(conn, "ignore_system_processes", false)? as i32;
    let mut stmt = conn.prepare(
        "SELECT d.date,
                COALESCE(c.category, 'uncategorized') as category,
                SUM(d.total_seconds) as total
         FROM daily_app_usage d
         LEFT JOIN app_categories c
           ON lower(COALESCE(d.exe_path, '')) = c.exe_path
         WHERE d.date >= ?1 AND d.date <= ?2
           AND lower(COALESCE(d.exe_path, '')) NOT IN (SELECT exe_path FROM ignored_apps)
           AND (?3 = 0 OR NOT (
                (
                    lower(replace(COALESCE(d.exe_path, ''), '/', '\\')) LIKE '%\\windows\\system32\\%'
                    OR lower(replace(COALESCE(d.exe_path, ''), '/', '\\')) LIKE '%\\windows\\syswow64\\%'
                )
                AND NOT (
                    lower(COALESCE(d.exe_path, '')) LIKE '%\\explorer.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\taskmgr.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\notepad.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\mspaint.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\calc.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\cmd.exe'
                    OR lower(COALESCE(d.exe_path, '')) LIKE '%\\powershell.exe'
                )
           ))
         GROUP BY d.date, COALESCE(c.category, 'uncategorized')
         ORDER BY d.date, category",
    )?;
    let rows = stmt.query_map(params![start_date, end_date, ignore_system], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    rows.collect()
}

// ── App categories ───────────────────────────────────────────

pub fn get_all_app_categories(conn: &Connection) -> Result<Vec<crate::models::AppCategoryRule>> {
    let mut stmt = conn.prepare(
        "SELECT app_name, exe_path, category, source, updated_at
         FROM app_categories
         ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(crate::models::AppCategoryRule {
            app_name: row.get(0)?,
            exe_path: row.get(1)?,
            category: row.get(2)?,
            source: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn upsert_app_category_rule(
    conn: &Connection,
    app_name: &str,
    exe_path: &str,
    category: &str,
    source: &str,
) -> Result<()> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let normalized = normalized_exe_path(exe_path);
    conn.execute(
        "INSERT INTO app_categories (app_name, exe_path, category, source, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(exe_path) DO UPDATE SET
            app_name = excluded.app_name,
            category = excluded.category,
            source = excluded.source,
            updated_at = excluded.updated_at",
        params![app_name, normalized, category, source, now],
    )?;
    Ok(())
}

pub fn delete_app_category_rule(conn: &Connection, exe_path: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM app_categories WHERE exe_path = ?1",
        params![normalized_exe_path(exe_path)],
    )?;
    Ok(())
}

// ── Usage goals ──────────────────────────────────────────────

pub fn get_usage_goals(conn: &Connection) -> Result<Vec<crate::models::UsageGoal>> {
    let mut stmt = conn.prepare(
        "SELECT id, scope_type, scope_value, period, operator, target_seconds, enabled
         FROM usage_goals
         ORDER BY id DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(crate::models::UsageGoal {
            id: Some(row.get(0)?),
            scope_type: row.get(1)?,
            scope_value: row.get(2)?,
            period: row.get(3)?,
            operator: row.get(4)?,
            target_seconds: row.get(5)?,
            enabled: row.get::<_, i32>(6)? != 0,
        })
    })?;
    rows.collect()
}

pub fn upsert_usage_goal(conn: &Connection, goal: &crate::models::UsageGoal) -> Result<i64> {
    if let Some(id) = goal.id {
        conn.execute(
            "UPDATE usage_goals
             SET scope_type = ?1,
                 scope_value = ?2,
                 period = ?3,
                 operator = ?4,
                 target_seconds = ?5,
                 enabled = ?6
             WHERE id = ?7",
            params![
                goal.scope_type,
                goal.scope_value,
                goal.period,
                goal.operator,
                goal.target_seconds,
                goal.enabled as i32,
                id
            ],
        )?;
        return Ok(id);
    }

    conn.execute(
        "INSERT INTO usage_goals (scope_type, scope_value, period, operator, target_seconds, enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            goal.scope_type,
            goal.scope_value,
            goal.period,
            goal.operator,
            goal.target_seconds,
            goal.enabled as i32
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_usage_goal(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM usage_goals WHERE id = ?1", params![id])?;
    Ok(())
}

fn get_goal_used_seconds(
    conn: &Connection,
    goal: &crate::models::UsageGoal,
    start_date: &str,
    end_date: &str,
) -> Result<i64> {
    match goal.scope_type.as_str() {
        "category" => {
            conn.query_row(
                "SELECT COALESCE(SUM(d.total_seconds), 0)
                 FROM daily_app_usage d
                 LEFT JOIN app_categories c ON lower(COALESCE(d.exe_path, '')) = c.exe_path
                 WHERE d.date >= ?1 AND d.date <= ?2
                   AND COALESCE(c.category, 'uncategorized') = ?3",
                params![start_date, end_date, goal.scope_value],
                |row| row.get::<_, i64>(0),
            )
        }
        _ => conn.query_row(
            "SELECT COALESCE(SUM(total_seconds), 0)
             FROM daily_app_usage
             WHERE date >= ?1 AND date <= ?2
               AND (app_name = ?3 OR lower(COALESCE(exe_path, '')) = lower(?3))",
            params![start_date, end_date, goal.scope_value],
            |row| row.get::<_, i64>(0),
        ),
    }
}

pub fn get_goal_progress(
    conn: &Connection,
    today: &str,
    week_start: &str,
    week_end: &str,
) -> Result<Vec<crate::models::GoalProgress>> {
    let goals = get_usage_goals(conn)?;
    let mut out = Vec::with_capacity(goals.len());

    for goal in goals.into_iter().filter(|g| g.enabled) {
        let (start_date, end_date) = if goal.period == "weekly" {
            (week_start, week_end)
        } else {
            (today, today)
        };
        let used = get_goal_used_seconds(conn, &goal, start_date, end_date)?;
        let target = goal.target_seconds.max(1);
        let ratio = used as f64 / target as f64;
        let is_completed = if goal.operator == "at_most" {
            used <= goal.target_seconds
        } else {
            used >= goal.target_seconds
        };
        out.push(crate::models::GoalProgress {
            goal,
            used_seconds: used,
            progress_ratio: ratio,
            is_completed,
        });
    }

    Ok(out)
}

// ── Focus sessions ───────────────────────────────────────────

pub fn start_focus_session(conn: &Connection, trigger_type: &str, reason: &str) -> Result<i64> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO focus_sessions (started_at, trigger_type, reason)
         VALUES (?1, ?2, ?3)",
        params![now, trigger_type, reason],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn stop_focus_session(conn: &Connection, id: i64) -> Result<()> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "UPDATE focus_sessions SET ended_at = ?1 WHERE id = ?2 AND ended_at IS NULL",
        params![now, id],
    )?;
    Ok(())
}

pub fn list_focus_sessions(
    conn: &Connection,
    start_at: Option<&str>,
    end_at: Option<&str>,
) -> Result<Vec<crate::models::FocusSession>> {
    let mut out = Vec::new();
    match (start_at, end_at) {
        (Some(start), Some(end)) => {
            let mut stmt = conn.prepare(
                "SELECT id, started_at, ended_at, trigger_type, reason
                 FROM focus_sessions
                 WHERE started_at >= ?1 AND started_at <= ?2
                 ORDER BY started_at DESC",
            )?;
            let rows = stmt.query_map(params![start, end], |row| {
                Ok(crate::models::FocusSession {
                    id: Some(row.get(0)?),
                    started_at: row.get(1)?,
                    ended_at: row.get(2)?,
                    trigger_type: row.get(3)?,
                    reason: row.get(4)?,
                })
            })?;
            for row in rows {
                out.push(row?);
            }
        }
        _ => {
            let mut stmt = conn.prepare(
                "SELECT id, started_at, ended_at, trigger_type, reason
                 FROM focus_sessions
                 ORDER BY started_at DESC
                 LIMIT 200",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(crate::models::FocusSession {
                    id: Some(row.get(0)?),
                    started_at: row.get(1)?,
                    ended_at: row.get(2)?,
                    trigger_type: row.get(3)?,
                    reason: row.get(4)?,
                })
            })?;
            for row in rows {
                out.push(row?);
            }
        }
    }
    Ok(out)
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
        "SELECT id, widget_type, monitor_index, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch
         FROM widget_configs WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(crate::models::WidgetConfig {
            id: row.get(0)?,
            widget_type: row.get(1)?,
            monitor_index: row.get(2)?,
            x: row.get(3)?,
            y: row.get(4)?,
            width: row.get(5)?,
            height: row.get(6)?,
            opacity: row.get(7)?,
            always_on_top_mode: row.get(8)?,
            pinned: row.get::<_, i32>(9)? != 0,
            start_on_launch: row.get::<_, i32>(10)? != 0,
        })
    })?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn get_all_widget_configs(conn: &Connection) -> Result<Vec<crate::models::WidgetConfig>> {
    let mut stmt = conn.prepare(
        "SELECT id, widget_type, monitor_index, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch
         FROM widget_configs",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(crate::models::WidgetConfig {
            id: row.get(0)?,
            widget_type: row.get(1)?,
            monitor_index: row.get(2)?,
            x: row.get(3)?,
            y: row.get(4)?,
            width: row.get(5)?,
            height: row.get(6)?,
            opacity: row.get(7)?,
            always_on_top_mode: row.get(8)?,
            pinned: row.get::<_, i32>(9)? != 0,
            start_on_launch: row.get::<_, i32>(10)? != 0,
        })
    })?;
    rows.collect()
}

pub fn upsert_widget_config(conn: &Connection, cfg: &crate::models::WidgetConfig) -> Result<()> {
    conn.execute(
        "INSERT INTO widget_configs
            (id, widget_type, monitor_index, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(id) DO UPDATE SET
            monitor_index=excluded.monitor_index,
            x=excluded.x, y=excluded.y,
            width=excluded.width, height=excluded.height,
            opacity=excluded.opacity,
            always_on_top_mode=excluded.always_on_top_mode,
            pinned=excluded.pinned,
            start_on_launch=excluded.start_on_launch",
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
        let normalized = normalized_exe_path(p);
        if normalized.is_empty() {
            continue;
        }
        tx.execute(
            "INSERT OR IGNORE INTO ignored_apps(exe_path) VALUES(?1)",
            params![normalized],
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

pub fn insert_browser_session(
    conn: &Connection,
    session: &crate::models::BrowserSession,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO browser_sessions
         (browser_name, tab_url, host, title, started_at, ended_at, duration_seconds, locale, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
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
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_recent_browser_sessions(
    conn: &Connection,
    limit: i64,
) -> Result<Vec<crate::models::BrowserSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, browser_name, tab_url, host, title, started_at, ended_at, duration_seconds, locale, synced_at
         FROM browser_sessions
         ORDER BY ended_at DESC, id DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(crate::models::BrowserSession {
            id: row.get(0)?,
            browser_name: row.get(1)?,
            tab_url: row.get(2)?,
            host: row.get(3)?,
            title: row.get(4)?,
            started_at: row.get(5)?,
            ended_at: row.get(6)?,
            duration_seconds: row.get(7)?,
            locale: row.get(8)?,
            synced_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn count_browser_sessions(conn: &Connection) -> Result<i64> {
    conn.query_row("SELECT COUNT(1) FROM browser_sessions", [], |row| row.get(0))
}

/// Aggregate per-domain statistics for a date range, excluding ignored domains.
pub fn get_browser_domain_stats(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<crate::models::BrowserDomainStats>> {
    let mut stmt = conn.prepare(
        "SELECT host,
                SUM(duration_seconds) as total_seconds,
                COUNT(1) as visit_count,
                MAX(ended_at) as last_visited_at
         FROM browser_sessions
         WHERE ended_at >= ?1 AND ended_at < date(?2, '+1 day')
           AND host NOT IN (SELECT host FROM browser_ignored_domains)
           AND host != ''
         GROUP BY host
         ORDER BY total_seconds DESC",
    )?;
    let rows = stmt.query_map(params![start_date, end_date], |row| {
        Ok(crate::models::BrowserDomainStats {
            host: row.get(0)?,
            total_seconds: row.get(1)?,
            visit_count: row.get(2)?,
            last_visited_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

// ── Browser ignored domains ────────────────────────────────────

pub fn get_browser_ignored_domains(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT host FROM browser_ignored_domains ORDER BY host")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

pub fn set_browser_ignored_domains(conn: &Connection, hosts: &[String]) -> Result<()> {
    conn.execute("DELETE FROM browser_ignored_domains", [])?;
    for host in hosts {
        conn.execute(
            "INSERT OR IGNORE INTO browser_ignored_domains (host) VALUES (?1)",
            params![host.to_ascii_lowercase()],
        )?;
    }
    Ok(())
}

// ── Browser domain limits ──────────────────────────────────────

pub fn get_browser_domain_limits(conn: &Connection) -> Result<Vec<crate::models::BrowserDomainLimit>> {
    let mut stmt = conn.prepare(
        "SELECT host, daily_limit_seconds, enabled, updated_at
         FROM browser_domain_limits
         ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(crate::models::BrowserDomainLimit {
            host: row.get(0)?,
            daily_limit_seconds: row.get(1)?,
            enabled: row.get::<_, i32>(2)? != 0,
            updated_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn upsert_browser_domain_limit(conn: &Connection, limit: &crate::models::BrowserDomainLimit) -> Result<()> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO browser_domain_limits (host, daily_limit_seconds, enabled, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(host) DO UPDATE SET
            daily_limit_seconds = excluded.daily_limit_seconds,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at",
        params![
            limit.host.to_ascii_lowercase(),
            limit.daily_limit_seconds,
            limit.enabled as i32,
            now,
        ],
    )?;
    Ok(())
}

pub fn remove_browser_domain_limit(conn: &Connection, host: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM browser_domain_limits WHERE host = ?1",
        params![host.to_ascii_lowercase()],
    )?;
    Ok(())
}

/// Get today's usage seconds for a specific domain.
pub fn get_browser_domain_today_seconds(conn: &Connection, host: &str, date: &str) -> Result<i64> {
    let res: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration_seconds), 0)
         FROM browser_sessions
         WHERE host = ?1 AND ended_at >= ?2 AND ended_at < date(?2, '+1 day')",
        params![host, date],
        |row| row.get(0),
    )?;
    Ok(res)
}
