use chrono::Timelike;
use rusqlite::{params, Connection, OptionalExtension, Result};
use std::path::Path;

pub mod llm_conversations;
pub mod migrations;

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

/// Create all tables if they don't exist yet and run any pending migrations.
pub fn initialize(conn: &Connection) -> Result<()> {
    migrations::initialize(conn)?;
    Ok(())
}


pub(crate) fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
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
        params![
            date,
            app_name,
            exe_path,
            window_title,
            seconds,
            first_seen,
            last_seen
        ],
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

// ── Derived metrics ───────────────────────────────────────────

/// Increment app_switch_density when the active window changes.
/// `previous_*` may be empty/None for the first observation.
pub fn update_derived_metrics_for_switch(
    conn: &Connection,
    previous_app: Option<&str>,
    previous_title: Option<&str>,
    current_app: &str,
    current_title: &str,
    switch_time: &str,
) -> Result<()> {
    let prev_app = previous_app.filter(|s| !s.is_empty());
    let prev_title = previous_title.filter(|s| !s.is_empty());

    let changed_app = prev_app.map(|p| p != current_app).unwrap_or(false);
    let changed_title = if changed_app {
        true
    } else {
        prev_title.map(|t| t != current_title).unwrap_or(false)
    };

    if !changed_app && !changed_title {
        return Ok(());
    }

    let date = switch_time.get(..10).unwrap_or("");
    let hour: i32 = switch_time
        .get(11..13)
        .and_then(|h| h.parse().ok())
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO app_switch_density (date, hour, switch_count, app_switch_count, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(date, hour) DO UPDATE SET
            switch_count = switch_count + excluded.switch_count,
            app_switch_count = app_switch_count + excluded.app_switch_count,
            updated_at = excluded.updated_at",
        params![
            date,
            hour,
            if changed_app { 1 } else { 0 },
            if changed_title { 1 } else { 0 },
            switch_time
        ],
    )?;
    Ok(())
}

/// Recompute all derived metrics from scratch. Useful for repair and for the
/// periodic scheduler that keeps interruption_summary and focus_streaks in sync.
pub fn rebuild_derived_metrics(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM app_switch_density", [])?;
    conn.execute("DELETE FROM interruption_summary", [])?;
    conn.execute("DELETE FROM focus_streaks", [])?;

    #[derive(Debug)]
    struct Row {
        date: String,
        hour: i32,
        app_name: String,
        exe_path: String,
        window_title: String,
        active_seconds: i64,
        first_seen_at: String,
        last_seen_at: String,
    }

    let mut stmt = conn.prepare(
        "SELECT date,
                CAST(substr(first_seen_at, 12, 2) AS INTEGER) as hour,
                app_name,
                exe_path,
                window_title,
                active_seconds,
                first_seen_at,
                last_seen_at
         FROM app_usage
         ORDER BY first_seen_at",
    )?;

    let rows: Vec<Row> = stmt
        .query_map([], |row| {
            Ok(Row {
                date: row.get(0)?,
                hour: row.get(1)?,
                app_name: row.get(2)?,
                exe_path: row.get(3)?,
                window_title: row.get(4)?,
                active_seconds: row.get(5)?,
                first_seen_at: row.get(6)?,
                last_seen_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    // app_switch_density + interruption_summary
    let mut density: std::collections::BTreeMap<(String, i32), (i64, i64)> =
        std::collections::BTreeMap::new();
    let mut interruption: std::collections::BTreeMap<(String, i32), (i64, i64)> =
        std::collections::BTreeMap::new();

    let mut prev_app: Option<String> = None;
    let mut prev_title: Option<String> = None;

    for row in &rows {
        let key = (row.date.clone(), row.hour);

        if let Some(ref p) = prev_app {
            let changed_app = p != &row.app_name;
            let changed_title =
                changed_app || prev_title.as_deref().unwrap_or("") != row.window_title;
            let entry = density.entry(key.clone()).or_insert((0, 0));
            if changed_app {
                entry.0 += 1;
            }
            if changed_title {
                entry.1 += 1;
            }
        }

        let ientry = interruption.entry(key).or_insert((0, 0));
        ientry.0 += 1; // total segments
        if row.active_seconds < 300 {
            ientry.1 += 1; // short segments
        }

        prev_app = Some(row.app_name.clone());
        prev_title = Some(row.window_title.clone());
    }

    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    for ((date, hour), (switch_count, app_switch_count)) in density {
        conn.execute(
            "INSERT INTO app_switch_density (date, hour, switch_count, app_switch_count, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(date, hour) DO UPDATE SET
                switch_count = excluded.switch_count,
                app_switch_count = excluded.app_switch_count,
                updated_at = excluded.updated_at",
            params![date, hour, switch_count, app_switch_count, &now],
        )?;
    }

    for ((date, hour), (total, short)) in interruption {
        let fragment_score = if total > 0 {
            short as f64 / total as f64
        } else {
            0.0
        };
        conn.execute(
            "INSERT INTO interruption_summary (date, hour, interruption_count, fragment_score_avg, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(date, hour) DO UPDATE SET
                interruption_count = excluded.interruption_count,
                fragment_score_avg = excluded.fragment_score_avg,
                updated_at = excluded.updated_at",
            params![date, hour, short, fragment_score, &now],
        )?;
    }

    // focus_streaks: merge consecutive same-app segments with small gaps.
    const GAP_SECONDS: i64 = 60;
    const MIN_STREAK_SECONDS: i64 = 300;

    let mut streak_start: Option<String> = None;
    let mut streak_end: Option<String> = None;
    let mut streak_app: Option<String> = None;
    let mut streak_exe: Option<String> = None;
    let mut streak_seconds: i64 = 0;

    fn parse_ts(ts: &str) -> Option<chrono::NaiveDateTime> {
        chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S").ok()
    }

    fn streak_category(conn: &Connection, exe_path: &str) -> Result<String> {
        let cat: Option<String> = conn
            .query_row(
                "SELECT category FROM app_categories WHERE lower(exe_path) = lower(?1) LIMIT 1",
                params![exe_path],
                |row| row.get(0),
            )
            .optional()?;
        Ok(cat.unwrap_or_default())
    }

    fn save_streak(
        conn: &Connection,
        start: &str,
        end: &str,
        seconds: i64,
        exe_path: &str,
    ) -> Result<()> {
        let category = streak_category(conn, exe_path).unwrap_or_default();
        conn.execute(
            "INSERT INTO focus_streaks (started_at, ended_at, duration_seconds, category)
             VALUES (?1, ?2, ?3, ?4)",
            params![start, end, seconds, category],
        )?;
        Ok(())
    }

    for row in &rows {
        let continue_streak = if let (Some(ref app), Some(ref end)) = (&streak_app, &streak_end) {
            app == &row.app_name
                && parse_ts(end)
                    .zip(parse_ts(&row.first_seen_at))
                    .map(|(e, s)| (s - e).num_seconds() <= GAP_SECONDS)
                    .unwrap_or(false)
        } else {
            false
        };

        if continue_streak {
            streak_end = Some(row.last_seen_at.clone());
            streak_seconds += row.active_seconds;
        } else {
            if let (Some(start), Some(end), Some(_app), Some(exe), secs) = (
                streak_start.take(),
                streak_end.take(),
                streak_app.take(),
                streak_exe.take(),
                streak_seconds,
            ) {
                if secs >= MIN_STREAK_SECONDS {
                    let _ = save_streak(conn, &start, &end, secs, &exe);
                }
            }
            streak_start = Some(row.first_seen_at.clone());
            streak_end = Some(row.last_seen_at.clone());
            streak_app = Some(row.app_name.clone());
            streak_exe = Some(row.exe_path.clone());
            streak_seconds = row.active_seconds;
        }
    }

    if let (Some(start), Some(end), Some(_app), Some(exe), secs) = (
        streak_start,
        streak_end,
        streak_app,
        streak_exe,
        streak_seconds,
    ) {
        if secs >= MIN_STREAK_SECONDS {
            let _ = save_streak(conn, &start, &end, secs, &exe);
        }
    }

    Ok(())
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
    let day_start = match chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(d) => d.and_hms_opt(0, 0, 0),
        Err(_) => None,
    };
    let Some(day_start) = day_start else {
        return Ok(Vec::new());
    };
    let day_end = day_start + chrono::Duration::days(1);

    let sql = format!(
        "SELECT first_seen_at,
                active_seconds
         FROM app_usage
         WHERE date = ?1
           AND lower(COALESCE(exe_path, '')) NOT IN (SELECT exe_path FROM ignored_apps)
           AND {}
         ORDER BY first_seen_at",
        system_process_filter_sql_with_param(2)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date, ignore_system], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;

    let mut buckets = [0i64; 24];

    for row in rows {
        let (first_seen_at, active_seconds) = row?;
        if active_seconds <= 0 {
            continue;
        }

        let Ok(start_raw) =
            chrono::NaiveDateTime::parse_from_str(&first_seen_at, "%Y-%m-%dT%H:%M:%S")
        else {
            continue;
        };
        let seg_end_raw = start_raw + chrono::Duration::seconds(active_seconds);

        let seg_start = if start_raw < day_start {
            day_start
        } else {
            start_raw
        };
        let seg_end = if seg_end_raw > day_end {
            day_end
        } else {
            seg_end_raw
        };
        if seg_end <= seg_start {
            continue;
        }

        let mut cursor = seg_start;
        while cursor < seg_end {
            let hour_start = cursor
                .date()
                .and_hms_opt(cursor.time().hour(), 0, 0)
                .unwrap_or(cursor);
            let next_hour = hour_start + chrono::Duration::hours(1);
            let chunk_end = if next_hour < seg_end {
                next_hour
            } else {
                seg_end
            };
            let chunk_secs = (chunk_end - cursor).num_seconds();
            if chunk_secs > 0 {
                let hour_idx = cursor.time().hour() as usize;
                if hour_idx < 24 {
                    buckets[hour_idx] += chunk_secs;
                }
            }
            cursor = chunk_end;
        }
    }

    Ok(buckets
        .iter()
        .enumerate()
        .filter_map(|(hour, secs)| (*secs > 0).then_some((hour as i32, *secs)))
        .collect())
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
        "SELECT id, scope_type, scope_value, period, operator, target_seconds, enabled, notify_risk
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
            notify_risk: row.get::<_, Option<i32>>(7)?.unwrap_or(1) != 0,
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
        "category" => conn.query_row(
            "SELECT COALESCE(SUM(d.total_seconds), 0)
                 FROM daily_app_usage d
                 LEFT JOIN app_categories c ON lower(COALESCE(d.exe_path, '')) = c.exe_path
                 WHERE d.date >= ?1 AND d.date <= ?2
                   AND COALESCE(c.category, 'uncategorized') = ?3",
            params![start_date, end_date, goal.scope_value],
            |row| row.get::<_, i64>(0),
        ),
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

pub fn get_active_focus_session_id(conn: &Connection) -> Result<Option<i64>> {
    let id: Option<i64> = conn
        .query_row(
            "SELECT id FROM focus_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(id)
}

// ── Focus rules ───────────────────────────────────────────────

pub fn get_focus_rules(conn: &Connection) -> Result<Vec<crate::models::FocusRule>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, enabled, rule_type, condition_json, action, auto_start, quiet_hours_respect, created_at
         FROM focus_rules
         ORDER BY id DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(crate::models::FocusRule {
            id: Some(row.get(0)?),
            name: row.get(1)?,
            enabled: row.get::<_, i32>(2)? != 0,
            rule_type: row.get(3)?,
            condition_json: row.get(4)?,
            action: row.get(5)?,
            auto_start: row.get::<_, i32>(6)? != 0,
            quiet_hours_respect: row.get::<_, i32>(7)? != 0,
            created_at: row.get(8).ok(),
        })
    })?;
    rows.collect()
}

pub fn upsert_focus_rule(conn: &Connection, rule: &crate::models::FocusRule) -> Result<i64> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    if let Some(id) = rule.id {
        conn.execute(
            "UPDATE focus_rules
             SET name = ?1,
                 enabled = ?2,
                 rule_type = ?3,
                 condition_json = ?4,
                 action = ?5,
                 auto_start = ?6,
                 quiet_hours_respect = ?7
             WHERE id = ?8",
            params![
                rule.name,
                rule.enabled as i32,
                rule.rule_type,
                rule.condition_json,
                rule.action,
                rule.auto_start as i32,
                rule.quiet_hours_respect as i32,
                id
            ],
        )?;
        return Ok(id);
    }

    conn.execute(
        "INSERT INTO focus_rules (name, enabled, rule_type, condition_json, action, auto_start, quiet_hours_respect, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            rule.name,
            rule.enabled as i32,
            rule.rule_type,
            rule.condition_json,
            rule.action,
            rule.auto_start as i32,
            rule.quiet_hours_respect as i32,
            now,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_focus_rule(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM focus_rules WHERE id = ?1", params![id])?;
    Ok(())
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

pub fn get_widget_config(
    conn: &Connection,
    id: &str,
) -> Result<Option<crate::models::WidgetConfig>> {
    let mut stmt = conn.prepare(
        "SELECT id, widget_type, monitor_index, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch, data_json,
                paused, consecutive_failures, suspended_until
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
            data_json: row.get(11)?,
            paused: row.get::<_, i32>(12)? != 0,
            consecutive_failures: row.get(13)?,
            suspended_until: row.get(14)?,
        })
    })?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn get_all_widget_configs(conn: &Connection) -> Result<Vec<crate::models::WidgetConfig>> {
    let mut stmt = conn.prepare(
        "SELECT id, widget_type, monitor_index, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch, data_json,
                paused, consecutive_failures, suspended_until
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
            data_json: row.get(11)?,
            paused: row.get::<_, i32>(12)? != 0,
            consecutive_failures: row.get(13)?,
            suspended_until: row.get(14)?,
        })
    })?;
    rows.collect()
}

pub fn upsert_widget_config(conn: &Connection, cfg: &crate::models::WidgetConfig) -> Result<()> {
    conn.execute(
        "INSERT INTO widget_configs
            (id, widget_type, monitor_index, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch, data_json,
             paused, consecutive_failures, suspended_until)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
         ON CONFLICT(id) DO UPDATE SET
            monitor_index=excluded.monitor_index,
            x=excluded.x, y=excluded.y,
            width=excluded.width, height=excluded.height,
            opacity=excluded.opacity,
            always_on_top_mode=excluded.always_on_top_mode,
            pinned=excluded.pinned,
            start_on_launch=excluded.start_on_launch,
            data_json=excluded.data_json,
            paused=excluded.paused,
            consecutive_failures=excluded.consecutive_failures,
            suspended_until=excluded.suspended_until",
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
            cfg.data_json,
            cfg.paused as i32,
            cfg.consecutive_failures,
            cfg.suspended_until,
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

fn parse_scopes_json(raw: String) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
}

pub fn insert_api_token(
    conn: &Connection,
    id: &str,
    nickname: &str,
    label: &str,
    token_hash: &str,
    data_scopes: &[String],
    operation_scopes: &[String],
    scopes: &[String],
    created_at: &str,
    expires_at: Option<&str>,
) -> Result<()> {
    let data_scopes_json = serde_json::to_string(data_scopes).unwrap_or_else(|_| "[]".to_string());
    let operation_scopes_json = serde_json::to_string(operation_scopes).unwrap_or_else(|_| "[]".to_string());
    let scopes_json = serde_json::to_string(scopes).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO api_tokens
         (id, nickname, label, token_hash, data_scopes_json, operation_scopes_json, scopes_json, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, nickname, label, token_hash, data_scopes_json, operation_scopes_json, scopes_json, created_at, expires_at],
    )?;
    Ok(())
}

pub fn get_api_token_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<crate::models::ApiTokenMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT id, nickname, label, token_hash, data_scopes_json, operation_scopes_json, scopes_json, created_at, expires_at, revoked_at, last_used_at, last_client_id
         FROM api_tokens
         WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        let scopes_json: String = row.get(6)?;
        return Ok(Some(crate::models::ApiTokenMetadata {
            id: row.get(0)?,
            nickname: row.get(1)?,
            label: row.get(2)?,
            token_hash: row.get(3)?,
            data_scopes: parse_scopes_json(row.get(4)?),
            operation_scopes: parse_scopes_json(row.get(5)?),
            scopes: parse_scopes_json(scopes_json),
            created_at: row.get(7)?,
            expires_at: row.get(8)?,
            revoked_at: row.get(9)?,
            last_used_at: row.get(10)?,
            last_client_id: row.get(11)?,
        }));
    }
    Ok(None)
}

pub fn list_api_tokens(conn: &Connection) -> Result<Vec<crate::models::ApiTokenMetadata>> {
    let mut stmt = conn.prepare(
        "SELECT id, nickname, label, token_hash, data_scopes_json, operation_scopes_json, scopes_json, created_at, expires_at, revoked_at, last_used_at, last_client_id
         FROM api_tokens
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let scopes_json: String = row.get(6)?;
        Ok(crate::models::ApiTokenMetadata {
            id: row.get(0)?,
            nickname: row.get(1)?,
            label: row.get(2)?,
            token_hash: row.get(3)?,
            data_scopes: parse_scopes_json(row.get(4)?),
            operation_scopes: parse_scopes_json(row.get(5)?),
            scopes: parse_scopes_json(scopes_json),
            created_at: row.get(7)?,
            expires_at: row.get(8)?,
            revoked_at: row.get(9)?,
            last_used_at: row.get(10)?,
            last_client_id: row.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn revoke_api_token(conn: &Connection, id: &str, revoked_at: &str) -> Result<()> {
    conn.execute(
        "UPDATE api_tokens
         SET revoked_at = ?2
         WHERE id = ?1",
        params![id, revoked_at],
    )?;
    Ok(())
}

pub fn find_active_api_token_id_by_hash(
    conn: &Connection,
    token_hash: &str,
    now: &str,
) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT id
         FROM api_tokens
         WHERE token_hash = ?1
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?2)
         LIMIT 1",
    )?;
    let mut rows = stmt.query(params![token_hash, now])?;
    if let Some(row) = rows.next()? {
        return Ok(Some(row.get(0)?));
    }
    Ok(None)
}

pub fn find_active_api_token_by_hash(
    conn: &Connection,
    token_hash: &str,
    now: &str,
) -> Result<Option<crate::models::ApiTokenMetadata>> {
    let mut stmt = conn.prepare(
                "SELECT id, nickname, label, token_hash, data_scopes_json, operation_scopes_json, scopes_json, created_at, expires_at, revoked_at, last_used_at, last_client_id
         FROM api_tokens
         WHERE token_hash = ?1
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?2)
         LIMIT 1",
    )?;
    let mut rows = stmt.query(params![token_hash, now])?;
    if let Some(row) = rows.next()? {
        let scopes_json: String = row.get(6)?;
        return Ok(Some(crate::models::ApiTokenMetadata {
            id: row.get(0)?,
            nickname: row.get(1)?,
            label: row.get(2)?,
            token_hash: row.get(3)?,
            data_scopes: parse_scopes_json(row.get(4)?),
            operation_scopes: parse_scopes_json(row.get(5)?),
            scopes: parse_scopes_json(scopes_json),
            created_at: row.get(7)?,
            expires_at: row.get(8)?,
            revoked_at: row.get(9)?,
            last_used_at: row.get(10)?,
            last_client_id: row.get(11)?,
        }));
    }
    Ok(None)
}

pub fn touch_api_token_use(
    conn: &Connection,
    id: &str,
    used_at: &str,
    client_id: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE api_tokens
         SET last_used_at = ?2,
             last_client_id = ?3
         WHERE id = ?1",
        params![id, used_at, client_id],
    )?;
    Ok(())
}

pub fn get_api_client_allowlist(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT client_id
         FROM api_client_allowlist
         ORDER BY client_id ASC",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

pub fn replace_api_client_allowlist(conn: &Connection, client_ids: &[String]) -> Result<()> {
    let now = chrono::Local::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM api_client_allowlist", [])?;
    for client_id in client_ids {
        let normalized = client_id.trim();
        if normalized.is_empty() {
            continue;
        }
        tx.execute(
            "INSERT OR IGNORE INTO api_client_allowlist (client_id, created_at)
             VALUES (?1, ?2)",
            params![normalized, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn is_api_client_allowed(conn: &Connection, client_id: &str) -> Result<bool> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(1)
         FROM api_client_allowlist
         WHERE client_id = ?1",
        params![client_id],
        |row| row.get(0),
    )?;
    Ok(exists > 0)
}

pub fn insert_api_audit_log(
    conn: &Connection,
    occurred_at: &str,
    client_id: &str,
    endpoint: &str,
    method: &str,
    status_code: i64,
    detail: &str,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO api_audit_log
         (occurred_at, client_id, endpoint, method, status_code, detail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            occurred_at,
            client_id,
            endpoint,
            method,
            status_code,
            detail
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn count_api_audit_log_since(conn: &Connection, client_id: &str, since: &str) -> Result<i64> {
    conn.query_row(
        "SELECT COUNT(1)
         FROM api_audit_log
         WHERE client_id = ?1 AND occurred_at >= ?2",
        params![client_id, since],
        |row| row.get(0),
    )
}

pub fn list_api_audit_log(
    conn: &Connection,
    limit: i64,
    offset: i64,
    client_id: Option<&str>,
    endpoint: Option<&str>,
) -> Result<Vec<crate::models::ApiAuditLogEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, occurred_at, client_id, endpoint, method, status_code, detail
         FROM api_audit_log
         WHERE (?1 IS NULL OR client_id = ?1)
           AND (?2 IS NULL OR endpoint = ?2)
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?3 OFFSET ?4",
    )?;
    let rows = stmt.query_map(
        params![client_id, endpoint, limit.max(1), offset.max(0)],
        |row| {
            Ok(crate::models::ApiAuditLogEntry {
                id: row.get(0)?,
                occurred_at: row.get(1)?,
                client_id: row.get(2)?,
                endpoint: row.get(3)?,
                method: row.get(4)?,
                status_code: row.get(5)?,
                detail: row.get(6)?,
            })
        },
    )?;
    rows.collect()
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
    conn.query_row("SELECT COUNT(1) FROM browser_sessions", [], |row| {
        row.get(0)
    })
}

pub fn upsert_vscode_session(
    conn: &Connection,
    session: &crate::models::VsCodeSession,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO vscode_sessions
         (session_id, date, started_at, ended_at, duration_seconds, project_name, project_path, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(session_id) DO UPDATE SET
            date = excluded.date,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            duration_seconds = excluded.duration_seconds,
            project_name = excluded.project_name,
            project_path = excluded.project_path,
            synced_at = excluded.synced_at",
        params![
            session.session_id,
            session.date,
            session.started_at,
            session.ended_at,
            session.duration_seconds,
            session.project_name,
            session.project_path,
            session.synced_at,
        ],
    )?;

    tx.execute(
        "DELETE FROM vscode_session_languages WHERE session_id = ?1",
        params![session.session_id],
    )?;

    for item in &session.language_durations {
        tx.execute(
            "INSERT INTO vscode_session_languages (session_id, language, duration_seconds)
             VALUES (?1, ?2, ?3)",
            params![session.session_id, item.language, item.seconds.max(0)],
        )?;
    }

    tx.commit()?;
    Ok(())
}

pub fn get_vscode_stats_in_range(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<crate::models::VsCodeStatsSummary> {
    let (total_seconds, session_count): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(duration_seconds), 0), COUNT(1)
         FROM vscode_sessions
         WHERE date >= ?1 AND date <= ?2",
        params![start_date, end_date],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    Ok(crate::models::VsCodeStatsSummary {
        total_seconds,
        session_count,
    })
}

pub fn get_vscode_language_stats_in_range(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<crate::models::VsCodeLanguageStats>> {
    let mut stmt = conn.prepare(
        "SELECT l.language, COALESCE(SUM(l.duration_seconds), 0) as total_seconds
         FROM vscode_session_languages l
         INNER JOIN vscode_sessions s ON s.session_id = l.session_id
         WHERE s.date >= ?1 AND s.date <= ?2
         GROUP BY l.language
         ORDER BY total_seconds DESC",
    )?;
    let rows = stmt.query_map(params![start_date, end_date], |row| {
        Ok(crate::models::VsCodeLanguageStats {
            language: row.get(0)?,
            total_seconds: row.get(1)?,
        })
    })?;
    rows.collect()
}

pub fn get_vscode_project_stats_in_range(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<crate::models::VsCodeProjectStats>> {
    let mut stmt = conn.prepare(
        "SELECT project_name,
                project_path,
                COALESCE(SUM(duration_seconds), 0) as total_seconds,
                COUNT(1) as session_count
         FROM vscode_sessions
         WHERE date >= ?1 AND date <= ?2
         GROUP BY project_name, project_path
         ORDER BY total_seconds DESC",
    )?;
    let rows = stmt.query_map(params![start_date, end_date], |row| {
        Ok(crate::models::VsCodeProjectStats {
            project_name: row.get(0)?,
            project_path: row.get(1)?,
            total_seconds: row.get(2)?,
            session_count: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// Aggregate per-domain statistics for a date range, excluding ignored domains.
/// `ended_at` is stored as UTC RFC3339; convert to local date before comparing
/// with the user-facing local date range.
pub fn get_browser_domain_stats(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<crate::models::BrowserDomainStats>> {
    let mut stmt = conn.prepare(
        "SELECT browser_name,
            host,
                SUM(duration_seconds) as total_seconds,
                COUNT(1) as visit_count,
                MAX(ended_at) as last_visited_at
         FROM browser_sessions
         WHERE date(ended_at, 'localtime') >= ?1
           AND date(ended_at, 'localtime') <= ?2
           AND host NOT IN (SELECT host FROM browser_ignored_domains)
           AND host != ''
         GROUP BY browser_name, host
         ORDER BY total_seconds DESC",
    )?;
    let rows = stmt.query_map(params![start_date, end_date], |row| {
        Ok(crate::models::BrowserDomainStats {
            browser_name: row.get(0)?,
            host: row.get(1)?,
            total_seconds: row.get(2)?,
            visit_count: row.get(3)?,
            last_visited_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn get_browser_domain_stats_for_hour(
    conn: &Connection,
    date: &str,
    hour: i32,
    limit: i64,
) -> Result<Vec<crate::models::BrowserHourDomainStats>> {
    let normalized_hour = hour.clamp(0, 23);
    let safe_limit = if limit <= 0 { 5 } else { limit.min(50) };
    let hour_text = format!("{:02}", normalized_hour);

    let mut stmt = conn.prepare(
        "SELECT browser_name,
            host,
                SUM(duration_seconds) as total_seconds,
                COUNT(1) as visit_count,
                MAX(ended_at) as last_visited_at
         FROM browser_sessions
         WHERE strftime('%Y-%m-%d', ended_at, 'localtime') = ?1
           AND strftime('%H', ended_at, 'localtime') = ?2
           AND host NOT IN (SELECT host FROM browser_ignored_domains)
           AND host != ''
         GROUP BY browser_name, host
         ORDER BY total_seconds DESC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![date, hour_text, safe_limit], |row| {
        Ok(crate::models::BrowserHourDomainStats {
            browser_name: row.get(0)?,
            host: row.get(1)?,
            total_seconds: row.get(2)?,
            visit_count: row.get(3)?,
            last_visited_at: row.get(4)?,
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

pub fn get_browser_domain_limits(
    conn: &Connection,
) -> Result<Vec<crate::models::BrowserDomainLimit>> {
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

pub fn upsert_browser_domain_limit(
    conn: &Connection,
    limit: &crate::models::BrowserDomainLimit,
) -> Result<()> {
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
         WHERE host = ?1 AND date(ended_at, 'localtime') = ?2",
        params![host, date],
        |row| row.get(0),
    )?;
    Ok(res)
}

// ── Widget permissions ─────────────────────────────────────────

pub fn get_widget_permissions(conn: &Connection, widget_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT permission FROM widget_permissions WHERE widget_id = ?1 ORDER BY permission",
    )?;
    let rows = stmt.query_map(params![widget_id], |row| row.get::<_, String>(0))?;
    rows.collect()
}

fn map_widget_permission_capability(permission: &str) -> &'static str {
    match permission {
        "todo:write" | "settings:write" => "write_data",
        "active-window:subscribe" => "automation_trigger",
        "local-api:call" | "api:call" => "local_api_call",
        _ => "read_metrics",
    }
}

fn map_widget_permission_risk(permission: &str) -> &'static str {
    match permission {
        "settings:write" => "high",
        "todo:write" | "active-window:subscribe" | "local-api:call" | "api:call" => "medium",
        _ => "low",
    }
}

pub fn set_widget_permissions(
    conn: &Connection,
    widget_id: &str,
    permissions: &[String],
    actor: Option<&str>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let existing: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT permission FROM widget_permissions WHERE widget_id = ?1 ORDER BY permission",
        )?;
        let rows = stmt.query_map(params![widget_id], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>>>()?
    };

    tx.execute(
        "DELETE FROM widget_permissions WHERE widget_id = ?1",
        params![widget_id],
    )?;

    let actor_value = actor
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("system");
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();

    for removed in &existing {
        if !permissions.iter().any(|p| p == removed) {
            tx.execute(
                "INSERT INTO widget_permission_audit_log
                 (widget_id, permission, action, actor, occurred_at, detail)
                 VALUES (?1, ?2, 'revoke', ?3, ?4, ?5)",
                params![widget_id, removed, actor_value, now, "permission removed"],
            )?;
        }
    }

    for perm in permissions {
        let capability = map_widget_permission_capability(perm);
        let risk_label = map_widget_permission_risk(perm);
        tx.execute(
            "INSERT OR IGNORE INTO widget_permissions
             (widget_id, permission, granted_at, capability, risk_label)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![widget_id, perm, now, capability, risk_label],
        )?;

        if !existing.iter().any(|p| p == perm) {
            tx.execute(
                "INSERT INTO widget_permission_audit_log
                 (widget_id, permission, action, actor, occurred_at, detail)
                 VALUES (?1, ?2, 'grant', ?3, ?4, ?5)",
                params![widget_id, perm, actor_value, now, "permission granted"],
            )?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn revoke_all_widget_permissions(
    conn: &Connection,
    widget_id: &str,
    actor: Option<&str>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let existing: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT permission FROM widget_permissions WHERE widget_id = ?1 ORDER BY permission",
        )?;
        let rows = stmt.query_map(params![widget_id], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>>>()?
    };

    tx.execute(
        "DELETE FROM widget_permissions WHERE widget_id = ?1",
        params![widget_id],
    )?;

    if !existing.is_empty() {
        let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let actor_value = actor
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .unwrap_or("system");
        for perm in existing {
            tx.execute(
                "INSERT INTO widget_permission_audit_log
                 (widget_id, permission, action, actor, occurred_at, detail)
                 VALUES (?1, ?2, 'revoke', ?3, ?4, ?5)",
                params![widget_id, perm, actor_value, now, "revoke all permissions"],
            )?;
        }
    }

    tx.commit()?;
    Ok(())
}

pub fn get_widget_permission_entries(
    conn: &Connection,
    widget_id: &str,
) -> Result<Vec<crate::models::WidgetPermissionEntry>> {
    let mut stmt = conn.prepare(
        "SELECT permission, capability, risk_label, granted_at, last_access_at
         FROM widget_permissions
         WHERE widget_id = ?1
         ORDER BY risk_label DESC, permission ASC",
    )?;
    let rows = stmt.query_map(params![widget_id], |row| {
        Ok(crate::models::WidgetPermissionEntry {
            permission: row.get(0)?,
            capability: row.get(1)?,
            risk_label: row.get(2)?,
            granted_at: row.get(3)?,
            last_access_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn touch_widget_permission_access(
    conn: &Connection,
    widget_id: &str,
    permission: &str,
) -> Result<()> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "UPDATE widget_permissions
         SET last_access_at = ?3
         WHERE widget_id = ?1 AND permission = ?2",
        params![widget_id, permission, now],
    )?;
    Ok(())
}

pub fn get_widget_permission_audit_log(
    conn: &Connection,
    widget_id: &str,
    limit: i64,
) -> Result<Vec<crate::models::WidgetPermissionAuditEntry>> {
    let safe_limit = limit.clamp(1, 200);
    let mut stmt = conn.prepare(
        "SELECT id, widget_id, permission, action, actor, occurred_at, detail
         FROM widget_permission_audit_log
         WHERE widget_id = ?1
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![widget_id, safe_limit], |row| {
        Ok(crate::models::WidgetPermissionAuditEntry {
            id: row.get(0)?,
            widget_id: row.get(1)?,
            permission: row.get(2)?,
            action: row.get(3)?,
            actor: row.get(4)?,
            occurred_at: row.get(5)?,
            detail: row.get(6)?,
        })
    })?;
    rows.collect()
}

// ── Widget runtime rewrite consent and audit ─────────────────

pub fn get_widget_consent_decisions(
    conn: &Connection,
    widget_id: &str,
) -> Result<Vec<crate::models::WidgetConsentDecision>> {
    let mut stmt = conn.prepare(
        "SELECT id, widget_id, scope, decision, remembered, risk_level, source, granted_at, revoked_at
         FROM widget_consent_decisions
         WHERE widget_id = ?1
         ORDER BY granted_at DESC",
    )?;
    let rows = stmt.query_map(params![widget_id], |row| {
        Ok(crate::models::WidgetConsentDecision {
            id: row.get(0)?,
            widget_id: row.get(1)?,
            scope: row.get(2)?,
            decision: row.get(3)?,
            remembered: row.get::<_, i32>(4)? != 0,
            risk_level: row.get(5)?,
            source: row.get(6)?,
            granted_at: row.get(7)?,
            revoked_at: row.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn set_widget_consent_decision(
    conn: &Connection,
    widget_id: &str,
    scope: &str,
    decision: &str,
    remembered: bool,
    risk_level: &str,
    source: &str,
) -> Result<()> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO widget_consent_decisions
         (widget_id, scope, decision, remembered, risk_level, source, granted_at, revoked_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)
         ON CONFLICT(widget_id, scope) DO UPDATE SET
            decision = excluded.decision,
            remembered = excluded.remembered,
            risk_level = excluded.risk_level,
            source = excluded.source,
            granted_at = excluded.granted_at,
            revoked_at = NULL",
        params![
            widget_id,
            scope,
            decision,
            if remembered { 1 } else { 0 },
            risk_level,
            source,
            now,
        ],
    )?;
    Ok(())
}

pub fn revoke_widget_consent_decision(conn: &Connection, widget_id: &str, scope: &str) -> Result<()> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "UPDATE widget_consent_decisions
         SET decision = 'denied', revoked_at = ?3
         WHERE widget_id = ?1 AND scope = ?2",
        params![widget_id, scope, now],
    )?;
    Ok(())
}

pub fn insert_widget_access_audit(
    conn: &Connection,
    entry: &crate::models::WidgetAccessAuditEntry,
) -> Result<()> {
    conn.execute(
        "INSERT INTO widget_access_audit
         (widget_id, scope, request_type, decision, resource_hint, payload_class, occurred_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            &entry.widget_id,
            &entry.scope,
            &entry.request_type,
            &entry.decision,
            &entry.resource_hint,
            &entry.payload_class,
            &entry.occurred_at,
        ],
    )?;
    Ok(())
}

pub fn get_widget_network_domain_rules(
    conn: &Connection,
    widget_id: &str,
) -> Result<Vec<crate::models::WidgetNetworkDomainRule>> {
    let mut stmt = conn.prepare(
        "SELECT id, widget_id, domain_pattern, decision, policy_source, created_at
         FROM widget_network_domain_rules
         WHERE widget_id = ?1
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![widget_id], |row| {
        Ok(crate::models::WidgetNetworkDomainRule {
            id: row.get(0)?,
            widget_id: row.get(1)?,
            domain_pattern: row.get(2)?,
            decision: row.get(3)?,
            policy_source: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn set_widget_network_domain_rule(
    conn: &Connection,
    widget_id: &str,
    domain_pattern: &str,
    decision: &str,
    policy_source: &str,
) -> Result<()> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO widget_network_domain_rules
         (widget_id, domain_pattern, decision, policy_source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![widget_id, domain_pattern, decision, policy_source, now],
    )?;
    Ok(())
}

pub fn insert_widget_runtime_crash(
    conn: &Connection,
    crash: &crate::models::WidgetRuntimeCrash,
) -> Result<()> {
    conn.execute(
        "INSERT INTO widget_runtime_crashes
         (widget_id, host_id, error, stack_hint, occurred_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            &crash.widget_id,
            &crash.host_id,
            &crash.error,
            &crash.stack_hint,
            &crash.occurred_at,
        ],
    )?;
    Ok(())
}

// ── Widget scoped state ───────────────────────────────────────

pub fn get_widget_state(conn: &Connection, widget_id: &str, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT value FROM widget_state WHERE widget_id = ?1 AND key = ?2",
    )?;
    let mut rows = stmt.query_map(params![widget_id, key], |row| row.get::<_, String>(0))?;
    rows.next().transpose()
}

pub fn set_widget_state(conn: &Connection, widget_id: &str, key: &str, value: &str) -> Result<()> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO widget_state (widget_id, key, value, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(widget_id, key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at",
        params![widget_id, key, value, now],
    )?;
    Ok(())
}

pub fn delete_widget_state(conn: &Connection, widget_id: &str, key: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM widget_state WHERE widget_id = ?1 AND key = ?2",
        params![widget_id, key],
    )?;
    Ok(())
}

pub fn clear_widget_state(conn: &Connection, widget_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM widget_state WHERE widget_id = ?1",
        params![widget_id],
    )?;
    Ok(())
}

pub fn count_widget_state_entries(conn: &Connection, widget_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT COUNT(1) FROM widget_state WHERE widget_id = ?1",
        params![widget_id],
        |row| row.get(0),
    )
}

// ── Widget subscriptions ──────────────────────────────────────

pub fn get_widget_subscriptions(conn: &Connection, widget_id: &str) -> Result<Vec<String>> {
    let events_json: Option<String> = conn
        .query_row(
            "SELECT events_json FROM widget_subscriptions WHERE widget_id = ?1",
            params![widget_id],
            |row| row.get(0),
        )
        .optional()?;
    match events_json {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(Vec::new()),
    }
}

pub fn set_widget_subscriptions(
    conn: &Connection,
    widget_id: &str,
    events: &[String],
) -> Result<()> {
    let events_json = serde_json::to_string(events).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO widget_subscriptions (widget_id, events_json)
         VALUES (?1, ?2)
         ON CONFLICT(widget_id) DO UPDATE SET events_json = excluded.events_json",
        params![widget_id, events_json],
    )?;
    Ok(())
}

pub fn clear_widget_subscriptions(conn: &Connection, widget_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM widget_subscriptions WHERE widget_id = ?1",
        params![widget_id],
    )?;
    Ok(())
}

/// Return all widget subscriptions as (widget_id, event_name) pairs.
pub fn get_all_widget_subscriptions(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT widget_id, events_json FROM widget_subscriptions",
    )?;
    let rows = stmt.query_map([], |row| {
        let widget_id: String = row.get(0)?;
        let events_json: String = row.get(1)?;
        let events: Vec<String> = serde_json::from_str(&events_json).unwrap_or_default();
        Ok((widget_id, events))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (widget_id, events) = row?;
        for event in events {
            out.push((widget_id.clone(), event));
        }
    }
    Ok(out)
}

// ── Widget error log ──────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WidgetErrorLogEntry {
    pub id: i64,
    pub widget_id: String,
    pub occurred_at: String,
    pub error: String,
    pub recovery_hint: String,
}

pub fn insert_widget_error_log(
    conn: &Connection,
    widget_id: &str,
    error: &str,
    recovery_hint: &str,
) -> Result<i64> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO widget_error_log (widget_id, occurred_at, error, recovery_hint)
         VALUES (?1, ?2, ?3, ?4)",
        params![widget_id, now, error, recovery_hint],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_widget_error_log(
    conn: &Connection,
    widget_id: &str,
    limit: i64,
) -> Result<Vec<WidgetErrorLogEntry>> {
    let safe_limit = limit.clamp(1, 200);
    let mut stmt = conn.prepare(
        "SELECT id, widget_id, occurred_at, error, recovery_hint
         FROM widget_error_log
         WHERE widget_id = ?1
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![widget_id, safe_limit], |row| {
        Ok(WidgetErrorLogEntry {
            id: row.get(0)?,
            widget_id: row.get(1)?,
            occurred_at: row.get(2)?,
            error: row.get(3)?,
            recovery_hint: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn clear_widget_error_log(conn: &Connection, widget_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM widget_error_log WHERE widget_id = ?1",
        params![widget_id],
    )?;
    Ok(())
}

// ── Widget runtime config helpers ─────────────────────────────

pub fn set_widget_paused(conn: &Connection, widget_id: &str, paused: bool) -> Result<()> {
    conn.execute(
        "UPDATE widget_configs SET paused = ?1 WHERE id = ?2",
        params![paused as i32, widget_id],
    )?;
    Ok(())
}

pub fn increment_widget_consecutive_failures(conn: &Connection, widget_id: &str) -> Result<i64> {
    conn.execute(
        "UPDATE widget_configs
         SET consecutive_failures = consecutive_failures + 1
         WHERE id = ?1",
        params![widget_id],
    )?;
    let count: i64 = conn.query_row(
        "SELECT consecutive_failures FROM widget_configs WHERE id = ?1",
        params![widget_id],
        |row| row.get(0),
    )?;
    Ok(count)
}

pub fn reset_widget_consecutive_failures(conn: &Connection, widget_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE widget_configs SET consecutive_failures = 0, suspended_until = NULL WHERE id = ?1",
        params![widget_id],
    )?;
    Ok(())
}

pub fn suspend_widget_until(conn: &Connection, widget_id: &str, until: &str) -> Result<()> {
    conn.execute(
        "UPDATE widget_configs SET suspended_until = ?1 WHERE id = ?2",
        params![until, widget_id],
    )?;
    Ok(())
}

pub fn is_widget_suspended(conn: &Connection, widget_id: &str) -> Result<bool> {
    let suspended_until: Option<String> = conn
        .query_row(
            "SELECT suspended_until FROM widget_configs WHERE id = ?1",
            params![widget_id],
            |row| row.get(0),
        )
        .optional()?;
    match suspended_until {
        Some(until) => {
            let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
            Ok(until > now)
        }
        None => Ok(false),
    }
}

/// Remove all runtime data for a widget (state, subscriptions, error log).
pub fn clear_widget_runtime_data(conn: &Connection, widget_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM widget_state WHERE widget_id = ?1",
        params![widget_id],
    )?;
    conn.execute(
        "DELETE FROM widget_subscriptions WHERE widget_id = ?1",
        params![widget_id],
    )?;
    conn.execute(
        "DELETE FROM widget_error_log WHERE widget_id = ?1",
        params![widget_id],
    )?;
    Ok(())
}
