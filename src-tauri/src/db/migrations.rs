use crate::db;
use rusqlite::{params, Connection, OptionalExtension, Result};
use std::path::{Path, PathBuf};

/// A single numbered schema migration.
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub up: fn(&Connection) -> Result<()>,
}

impl Migration {
    pub const fn new(version: i64, name: &'static str, up: fn(&Connection) -> Result<()>) -> Self {
        Self { version, name, up }
    }
}

/// Baseline schema creation (migration 1).
///
/// All `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements
/// from the original `initialize()` are reproduced here. Running this on a new
/// database brings it to the historical schema version 5.
fn migration_001_baseline(conn: &Connection) -> Result<()> {
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

        CREATE TABLE IF NOT EXISTS app_usage_archive (
            id              INTEGER PRIMARY KEY,
            date            TEXT    NOT NULL,
            app_name        TEXT    NOT NULL,
            exe_path        TEXT    NOT NULL DEFAULT '',
            window_title    TEXT    NOT NULL DEFAULT '',
            active_seconds  INTEGER NOT NULL DEFAULT 0,
            first_seen_at   TEXT    NOT NULL,
            last_seen_at    TEXT    NOT NULL,
            archived_at     TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_app_usage_archive_date ON app_usage_archive(date);

        CREATE TABLE IF NOT EXISTS daily_app_usage_archive (
            date            TEXT    NOT NULL,
            app_name        TEXT    NOT NULL,
            exe_path        TEXT    NOT NULL DEFAULT '',
            total_seconds   INTEGER NOT NULL DEFAULT 0,
            first_seen_at   TEXT    NOT NULL,
            last_seen_at    TEXT    NOT NULL,
            archived_at     TEXT    NOT NULL,
            PRIMARY KEY (date, app_name, exe_path, archived_at)
        );

        CREATE INDEX IF NOT EXISTS idx_daily_app_usage_archive_date ON daily_app_usage_archive(date);

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
            start_on_launch     INTEGER NOT NULL DEFAULT 1,
            data_json           TEXT
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
            updated_at  TEXT    NOT NULL
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

        CREATE TABLE IF NOT EXISTS widget_permissions (
            widget_id       TEXT    NOT NULL,
            permission      TEXT    NOT NULL,
            granted_at      TEXT    NOT NULL,
            capability      TEXT    NOT NULL DEFAULT 'read_metrics',
            risk_label      TEXT    NOT NULL DEFAULT 'low',
            last_access_at  TEXT,
            PRIMARY KEY (widget_id, permission)
        );

        CREATE TABLE IF NOT EXISTS widget_permission_audit_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            widget_id    TEXT    NOT NULL,
            permission   TEXT    NOT NULL,
            action       TEXT    NOT NULL,
            actor        TEXT    NOT NULL DEFAULT 'system',
            occurred_at  TEXT    NOT NULL,
            detail       TEXT    NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_widget_permission_audit_widget_time
            ON widget_permission_audit_log(widget_id, occurred_at DESC);

        CREATE TABLE IF NOT EXISTS vscode_sessions (
            session_id       TEXT PRIMARY KEY,
            date             TEXT    NOT NULL,
            started_at       TEXT    NOT NULL,
            ended_at         TEXT    NOT NULL,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            project_name     TEXT    NOT NULL DEFAULT '',
            project_path     TEXT    NOT NULL DEFAULT '',
            synced_at        TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_vscode_sessions_date ON vscode_sessions(date);
        CREATE INDEX IF NOT EXISTS idx_vscode_sessions_project_path ON vscode_sessions(project_path);

        CREATE TABLE IF NOT EXISTS vscode_session_languages (
            session_id       TEXT    NOT NULL,
            language         TEXT    NOT NULL,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (session_id, language),
            FOREIGN KEY (session_id) REFERENCES vscode_sessions(session_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_vscode_session_languages_language ON vscode_session_languages(language);

        CREATE TABLE IF NOT EXISTS api_tokens (
            id              TEXT    PRIMARY KEY,
            label           TEXT    NOT NULL,
            token_hash      TEXT    NOT NULL UNIQUE,
            scopes_json     TEXT    NOT NULL DEFAULT '[]',
            created_at      TEXT    NOT NULL,
            expires_at      TEXT,
            revoked_at      TEXT,
            last_used_at    TEXT,
            last_client_id  TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_api_tokens_revoked_at ON api_tokens(revoked_at);

        CREATE TABLE IF NOT EXISTS api_client_allowlist (
            client_id   TEXT PRIMARY KEY,
            created_at  TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS api_audit_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            occurred_at  TEXT    NOT NULL,
            client_id    TEXT    NOT NULL DEFAULT '',
            endpoint     TEXT    NOT NULL,
            method       TEXT    NOT NULL,
            status_code  INTEGER NOT NULL,
            detail       TEXT    NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_api_audit_log_occurred_at ON api_audit_log(occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_api_audit_log_client_id ON api_audit_log(client_id);
        CREATE INDEX IF NOT EXISTS idx_api_audit_log_endpoint ON api_audit_log(endpoint);
        
        CREATE TABLE IF NOT EXISTS _migration_log (
            version     INTEGER PRIMARY KEY,
            name        TEXT    NOT NULL,
            applied_at  TEXT    NOT NULL
        );
        ")?;

    Ok(())
}

/// Migration 002: add missing columns to existing tables.
fn migration_002_add_columns(conn: &Connection) -> Result<()> {
    let add_if_missing = |table: &str, column: &str, ddl: &str| -> Result<()> {
        let cols = super::table_columns(conn, table)?;
        if !cols.iter().any(|c| c == column) {
            conn.execute(ddl, [])?;
        }
        Ok(())
    };

    add_if_missing(
        "app_usage",
        "exe_path",
        "ALTER TABLE app_usage ADD COLUMN exe_path TEXT NOT NULL DEFAULT ''",
    )?;
    add_if_missing(
        "widget_configs",
        "start_on_launch",
        "ALTER TABLE widget_configs ADD COLUMN start_on_launch INTEGER NOT NULL DEFAULT 1",
    )?;
    add_if_missing(
        "widget_configs",
        "monitor_index",
        "ALTER TABLE widget_configs ADD COLUMN monitor_index INTEGER NOT NULL DEFAULT -1",
    )?;
    add_if_missing(
        "widget_configs",
        "data_json",
        "ALTER TABLE widget_configs ADD COLUMN data_json TEXT",
    )?;
    add_if_missing(
        "widget_permissions",
        "capability",
        "ALTER TABLE widget_permissions ADD COLUMN capability TEXT NOT NULL DEFAULT 'read_metrics'",
    )?;
    add_if_missing(
        "widget_permissions",
        "risk_label",
        "ALTER TABLE widget_permissions ADD COLUMN risk_label TEXT NOT NULL DEFAULT 'low'",
    )?;
    add_if_missing(
        "widget_permissions",
        "last_access_at",
        "ALTER TABLE widget_permissions ADD COLUMN last_access_at TEXT",
    )?;
    add_if_missing(
        "widget_permission_audit_log",
        "actor",
        "ALTER TABLE widget_permission_audit_log ADD COLUMN actor TEXT NOT NULL DEFAULT 'system'",
    )?;
    add_if_missing(
        "widget_permission_audit_log",
        "detail",
        "ALTER TABLE widget_permission_audit_log ADD COLUMN detail TEXT NOT NULL DEFAULT ''",
    )?;

    Ok(())
}

/// Migration 003: backfill daily aggregates from raw app_usage rows.
fn migration_003_backfill_daily_app_usage(conn: &Connection) -> Result<()> {
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
    Ok(())
}

/// Migration 004: archive tables tier / compression columns and primary key fix.
fn migration_004_archive_tier_compression(conn: &Connection) -> Result<()> {
    let add_if_missing = |table: &str, column: &str, ddl: &str| -> Result<()> {
        let cols = super::table_columns(conn, table)?;
        if !cols.iter().any(|c| c == column) {
            conn.execute(ddl, [])?;
        }
        Ok(())
    };

    add_if_missing(
        "app_usage_archive",
        "tier",
        "ALTER TABLE app_usage_archive ADD COLUMN tier TEXT NOT NULL DEFAULT 'archive'",
    )?;
    add_if_missing(
        "app_usage_archive",
        "compression",
        "ALTER TABLE app_usage_archive ADD COLUMN compression TEXT NOT NULL DEFAULT 'none'",
    )?;
    add_if_missing(
        "app_usage_archive",
        "compressed_bytes",
        "ALTER TABLE app_usage_archive ADD COLUMN compressed_bytes INTEGER",
    )?;
    add_if_missing(
        "daily_app_usage_archive",
        "tier",
        "ALTER TABLE daily_app_usage_archive ADD COLUMN tier TEXT NOT NULL DEFAULT 'archive'",
    )?;
    add_if_missing(
        "daily_app_usage_archive",
        "compression",
        "ALTER TABLE daily_app_usage_archive ADD COLUMN compression TEXT NOT NULL DEFAULT 'none'",
    )?;
    add_if_missing(
        "daily_app_usage_archive",
        "compressed_bytes",
        "ALTER TABLE daily_app_usage_archive ADD COLUMN compressed_bytes INTEGER",
    )?;

    // The original primary key included archived_at, which can create duplicate
    // aggregate rows if the same data is archived again. Re-create the table
    // with a stable primary key (date, app_name, exe_path) and keep archived_at
    // as a regular column. Data is preserved.
    let cols = super::table_columns(conn, "daily_app_usage_archive")?;
    if cols.contains(&"archived_at".to_string()) {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS _daily_app_usage_archive_new (
                date            TEXT    NOT NULL,
                app_name        TEXT    NOT NULL,
                exe_path        TEXT    NOT NULL DEFAULT '',
                total_seconds   INTEGER NOT NULL DEFAULT 0,
                first_seen_at   TEXT    NOT NULL,
                last_seen_at    TEXT    NOT NULL,
                archived_at     TEXT    NOT NULL,
                tier            TEXT    NOT NULL DEFAULT 'archive',
                compression     TEXT    NOT NULL DEFAULT 'none',
                compressed_bytes INTEGER,
                PRIMARY KEY (date, app_name, exe_path)
            )",
            [],
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO _daily_app_usage_archive_new
                (date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at,
                 archived_at, tier, compression, compressed_bytes)
             SELECT date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at,
                    MAX(archived_at), COALESCE(MAX(tier), 'archive'),
                    COALESCE(MAX(compression), 'none'), MAX(compressed_bytes)
             FROM daily_app_usage_archive
             GROUP BY date, app_name, exe_path",
            [],
        )?;
        conn.execute("DROP TABLE daily_app_usage_archive", [])?;
        conn.execute(
            "ALTER TABLE _daily_app_usage_archive_new RENAME TO daily_app_usage_archive",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_daily_app_usage_archive_date ON daily_app_usage_archive(date)",
            [],
        )?;
    }

    Ok(())
}

/// Migration 005: derived metrics tables for local intelligence.
fn migration_005_derived_metrics(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS app_switch_density (
            date            TEXT    NOT NULL,
            hour            INTEGER NOT NULL,
            switch_count    INTEGER NOT NULL DEFAULT 0,
            app_switch_count INTEGER NOT NULL DEFAULT 0,
            updated_at      TEXT    NOT NULL,
            PRIMARY KEY (date, hour)
        );

        CREATE INDEX IF NOT EXISTS idx_app_switch_density_date ON app_switch_density(date);

        CREATE TABLE IF NOT EXISTS focus_streaks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at      TEXT    NOT NULL,
            ended_at        TEXT,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            category        TEXT    NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_focus_streaks_started_at ON focus_streaks(started_at DESC);

        CREATE TABLE IF NOT EXISTS interruption_summary (
            date                TEXT    NOT NULL,
            hour                INTEGER NOT NULL,
            interruption_count  INTEGER NOT NULL DEFAULT 0,
            fragment_score_avg  REAL    NOT NULL DEFAULT 0.0,
            updated_at          TEXT    NOT NULL,
            PRIMARY KEY (date, hour)
        );

        CREATE INDEX IF NOT EXISTS idx_interruption_summary_date ON interruption_summary(date);

        CREATE TABLE IF NOT EXISTS archive_scheduler_state (
            id                  INTEGER PRIMARY KEY CHECK (id = 1),
            enabled             INTEGER NOT NULL DEFAULT 0,
            daily_run_hour      INTEGER NOT NULL DEFAULT 2,
            last_run_at         TEXT,
            run_on_battery      INTEGER NOT NULL DEFAULT 1
        );
        ",
    )?;
    Ok(())
}

/// Migration 006: focus rule automation model.
fn migration_006_focus_rules(conn: &Connection) -> Result<()> {
    let cols = super::table_columns(conn, "focus_triggers")?;
    if cols.contains(&"match_type".to_string()) && !cols.contains(&"rule_type".to_string()) {
        // Migrate the legacy keyword-based table to the new rule model.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS focus_rules (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                name                TEXT    NOT NULL,
                enabled             INTEGER NOT NULL DEFAULT 1,
                rule_type           TEXT    NOT NULL DEFAULT 'keyword',
                condition_json      TEXT    NOT NULL DEFAULT '{}',
                action              TEXT    NOT NULL DEFAULT 'enter_focus',
                auto_start          INTEGER NOT NULL DEFAULT 1,
                quiet_hours_respect INTEGER NOT NULL DEFAULT 1,
                created_at          TEXT    NOT NULL
            )",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_focus_rules_enabled ON focus_rules(enabled)",
            [],
        )?;
        conn.execute(
            "INSERT INTO focus_rules (name, enabled, rule_type, condition_json, action, auto_start, quiet_hours_respect, created_at)
             SELECT name,
                    enabled,
                    'keyword',
                    json_object('match_type', match_type, 'keyword', keyword),
                    CASE WHEN auto_enter_focus = 1 THEN 'enter_focus' ELSE 'leave_focus' END,
                    1,
                    1,
                    datetime('now')
             FROM focus_triggers",
            [],
        )?;
        conn.execute("DROP TABLE focus_triggers", [])?;
    } else {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS focus_rules (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                name                TEXT    NOT NULL,
                enabled             INTEGER NOT NULL DEFAULT 1,
                rule_type           TEXT    NOT NULL DEFAULT 'keyword',
                condition_json      TEXT    NOT NULL DEFAULT '{}',
                action              TEXT    NOT NULL DEFAULT 'enter_focus',
                auto_start          INTEGER NOT NULL DEFAULT 1,
                quiet_hours_respect INTEGER NOT NULL DEFAULT 1,
                created_at          TEXT    NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_focus_rules_enabled ON focus_rules(enabled);
            ",
        )?;
    }
    Ok(())
}

/// Migration 007: goal notification settings.
fn migration_007_goal_notification_settings(conn: &Connection) -> Result<()> {
    conn.execute(
        "ALTER TABLE usage_goals ADD COLUMN notify_risk INTEGER NOT NULL DEFAULT 1",
        [],
    )?;
    Ok(())
}

/// Migration 008: encryption metadata.
fn migration_008_encryption_metadata(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS encryption_metadata (
            id                  INTEGER PRIMARY KEY CHECK (id = 1),
            enabled             INTEGER NOT NULL DEFAULT 0,
            key_source          TEXT    NOT NULL DEFAULT 'none',
            key_salt            TEXT,
            created_at          TEXT,
            rotated_at          TEXT
        );
        ",
    )?;
    Ok(())
}

/// Migration 009: profile settings.
fn migration_009_profile_settings(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS profiles (
            id              TEXT    PRIMARY KEY,
            name            TEXT    NOT NULL,
            is_default      INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT    NOT NULL
        );

        INSERT OR IGNORE INTO profiles (id, name, is_default, created_at)
        VALUES ('default', 'Default', 1, datetime('now'));
        ",
    )?;
    Ok(())
}

/// Migration 010: compressed historical archive storage.
fn migration_010_compressed_archive(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS app_usage_archive_compressed (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            date            TEXT    NOT NULL,
            app_name        TEXT    NOT NULL,
            exe_path        TEXT    NOT NULL DEFAULT '',
            compression     TEXT    NOT NULL DEFAULT 'zstd',
            compressed_bytes INTEGER NOT NULL,
            payload         BLOB    NOT NULL,
            archived_at     TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_app_usage_archive_compressed_date
            ON app_usage_archive_compressed(date);
        CREATE INDEX IF NOT EXISTS idx_app_usage_archive_compressed_app
            ON app_usage_archive_compressed(app_name);
        ",
    )?;
    Ok(())
}

/// Migration 011: widget runtime v2.2.0
/// - Per-widget scoped state persistence
/// - Per-widget subscription event set
/// - Per-widget error log with recovery hints
/// - Runtime lifecycle/control columns on widget_configs
fn migration_011_widget_runtime_v220(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS widget_state (
            widget_id   TEXT    NOT NULL,
            key         TEXT    NOT NULL,
            value       TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL,
            PRIMARY KEY (widget_id, key)
        );

        CREATE INDEX IF NOT EXISTS idx_widget_state_widget_id
            ON widget_state(widget_id);

        CREATE TABLE IF NOT EXISTS widget_subscriptions (
            widget_id   TEXT    PRIMARY KEY,
            events_json TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS widget_error_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            widget_id       TEXT    NOT NULL,
            occurred_at     TEXT    NOT NULL,
            error           TEXT    NOT NULL,
            recovery_hint   TEXT    NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_widget_error_log_widget_time
            ON widget_error_log(widget_id, occurred_at DESC);
        ",
    )?;

    let add_if_missing = |table: &str, column: &str, ddl: &str| -> Result<()> {
        let cols = super::table_columns(conn, table)?;
        if !cols.iter().any(|c| c == column) {
            conn.execute(ddl, [])?;
        }
        Ok(())
    };

    add_if_missing(
        "widget_configs",
        "paused",
        "ALTER TABLE widget_configs ADD COLUMN paused INTEGER NOT NULL DEFAULT 0",
    )?;
    add_if_missing(
        "widget_configs",
        "consecutive_failures",
        "ALTER TABLE widget_configs ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0",
    )?;
    add_if_missing(
        "widget_configs",
        "suspended_until",
        "ALTER TABLE widget_configs ADD COLUMN suspended_until TEXT",
    )?;

    Ok(())
}

pub const DEFAULT_PROFILE_ID: &str = "default";

/// Compute the database file path for a given profile.
/// The default profile lives at the legacy root path so existing low-version
/// data remains accessible without moving into a separate folder.
pub fn db_path_for_profile(data_dir: &Path, profile_id: &str) -> PathBuf {
    if profile_id == DEFAULT_PROFILE_ID {
        data_dir.join("timelens.db")
    } else {
        data_dir.join("profiles").join(profile_id).join("timelens.db")
    }
}

/// Path used by the 2.0.0 release to store the default profile. Kept so
/// upgrades can migrate any data created there back into the legacy root.
pub fn old_default_profile_db_path(data_dir: &Path) -> PathBuf {
    data_dir.join("profiles").join("default").join("timelens.db")
}

/// Move a database file and its WAL/SHM sidecars from `src` to `dst`.
fn move_db_with_sidecars(src: &Path, dst: &Path) -> std::io::Result<()> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(src, dst)?;
    for ext in ["-wal", "-shm"] {
        let src_sidecar = PathBuf::from(format!("{}{}", src.display(), ext));
        let dst_sidecar = PathBuf::from(format!("{}{}", dst.display(), ext));
        if src_sidecar.exists() {
            std::fs::rename(&src_sidecar, &dst_sidecar)?;
        }
    }
    Ok(())
}

fn remove_db_with_sidecars(path: &Path) -> std::io::Result<()> {
    for ext in ["", "-wal", "-shm"] {
        let p = PathBuf::from(format!("{}{}", path.display(), ext));
        if p.exists() {
            std::fs::remove_file(p)?;
        }
    }
    Ok(())
}

fn table_columns_in_schema(
    conn: &Connection,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!("PRAGMA {}.table_info({})", schema, table))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    rows.collect()
}

fn merge_table(conn: &Connection, table: &str, exclude_cols: &[&str]) -> Result<(), rusqlite::Error> {
    let source_cols = table_columns_in_schema(conn, "source", table)?;
    if source_cols.is_empty() {
        return Ok(());
    }
    let target_cols = super::table_columns(conn, table)?;
    let common_cols: Vec<String> = source_cols
        .into_iter()
        .filter(|c| target_cols.contains(c) && !exclude_cols.contains(&c.as_str()))
        .collect();
    if common_cols.is_empty() {
        return Ok(());
    }
    let cols = common_cols.join(", ");
    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO {table} ({cols}) SELECT {cols} FROM source.{table}",
        ),
        [],
    )?;
    Ok(())
}

/// Copy a single setting from the source (old default profile) `app_settings`
/// table into the target, overwriting the target value if one already exists.
/// Empty source values are ignored so the target does not lose an existing key.
fn copy_source_app_setting(conn: &Connection, key: &str) -> Result<(), rusqlite::Error> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM source.app_settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .optional()?;
    let Some(value) = value else { return Ok(()) };
    if value.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Rebuild `daily_app_usage` from the raw `app_usage` rows so that merged
/// segments are reflected in daily totals. This mirrors migration 003.
fn rebuild_daily_app_usage_from_raw(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM daily_app_usage", [])?;
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
    Ok(())
}

/// Merge data from the 2.0.0 default-profile folder (`profiles/default`)
/// into the legacy root database (`timelens.db`). If the root database does not
/// exist yet, the default-profile database is moved there instead. Conflicting
/// rows are skipped (INSERT OR IGNORE). This runs automatically on startup for
/// the default profile.
pub fn merge_default_profile_into_legacy_db(data_dir: &Path) -> Result<(), String> {
    let old_default_path = old_default_profile_db_path(data_dir);
    let legacy_path = db_path_for_profile(data_dir, DEFAULT_PROFILE_ID);

    if !old_default_path.exists() {
        return Ok(());
    }

    // If the source is encrypted, we cannot safely merge it here. Leave it in
    // place; the user can still switch profiles or use backup restore.
    if crate::db_encryption::is_database_encrypted(&old_default_path) {
        log::warn!(
            "Old default profile database at {} is encrypted; skipping automatic merge",
            old_default_path.display()
        );
        return Ok(());
    }

    // Make sure the source schema is current before merging.
    let _source_conn = db::open(&old_default_path).map_err(|e| {
        format!("Failed to open old default profile database: {}", e)
    })?;
    drop(_source_conn);

    if !legacy_path.exists() {
        move_db_with_sidecars(&old_default_path, &legacy_path).map_err(|e| {
            format!("Failed to move default profile database to legacy path: {}", e)
        })?;
        log::info!(
            "Moved default profile database to legacy storage path: {}",
            legacy_path.display()
        );
        cleanup_old_default_profile_dir(data_dir);
        return Ok(());
    }

    let target_conn = db::open(&legacy_path).map_err(|e| {
        format!("Failed to open legacy database for merge: {}", e)
    })?;

    target_conn
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|e| format!("Failed to disable foreign keys for merge: {}", e))?;

    target_conn
        .execute("ATTACH ? AS source", params![old_default_path.to_string_lossy().as_ref()])
        .map_err(|e| format!("Failed to attach old default profile database: {}", e))?;

    // Tables whose primary key is a synthetic rowid are merged without the id
    // column so that rows from the source database are not lost just because the
    // auto-increment counters happen to overlap. Daily aggregates are rebuilt
    // afterwards so the displayed totals stay correct.
    let tables = [
        ("app_usage", &["id"][..]),
        ("app_usage_archive", &["id"][..]),
        ("app_usage_archive_compressed", &["id"][..]),
        ("daily_app_usage", &[][..]),
        ("daily_app_usage_archive", &[][..]),
        ("todos", &[][..]),
        ("widget_configs", &[][..]),
        ("ignored_apps", &[][..]),
        ("app_settings", &[][..]),
        ("app_categories", &[][..]),
        ("usage_goals", &[][..]),
        ("focus_sessions", &[][..]),
        ("focus_rules", &[][..]),
        ("browser_sessions", &[][..]),
        ("browser_ignored_domains", &[][..]),
        ("browser_domain_limits", &[][..]),
        ("widget_permissions", &[][..]),
        ("widget_permission_audit_log", &[][..]),
        ("widget_state", &[][..]),
        ("widget_subscriptions", &[][..]),
        ("widget_error_log", &[][..]),
        ("vscode_sessions", &[][..]),
        ("vscode_session_languages", &[][..]),
        ("api_tokens", &[][..]),
        ("api_client_allowlist", &[][..]),
        ("api_audit_log", &[][..]),
        ("app_switch_density", &[][..]),
        ("focus_streaks", &[][..]),
        ("interruption_summary", &[][..]),
        ("archive_scheduler_state", &[][..]),
        ("encryption_metadata", &[][..]),
    ];

    for (table, exclude) in tables {
        if let Err(e) = merge_table(&target_conn, table, exclude) {
            log::warn!("Failed to merge table {} from old default profile: {}", table, e);
        }
    }

    // The generic INSERT OR IGNORE above would keep the legacy root's
    // extension_bridge_key (if any) and skip the v2.0.0 default-profile key.
    // That breaks browser/VS Code extensions that were paired with the key
    // generated by v2.0.0. Copy it explicitly so those extensions stay
    // authenticated after the migration back to the legacy storage path.
    if let Err(e) = copy_source_app_setting(&target_conn, "extension_bridge_key") {
        log::warn!("Failed to preserve extension_bridge_key from old default profile: {}", e);
    }
    if let Err(e) = copy_source_app_setting(&target_conn, "extension_bridge_key_rotated_at") {
        log::warn!("Failed to preserve extension_bridge_key_rotated_at from old default profile: {}", e);
    }

    if let Err(e) = rebuild_daily_app_usage_from_raw(&target_conn) {
        log::warn!("Failed to rebuild daily totals after merge: {}", e);
    }

    let _ = target_conn.execute("DETACH source", []);
    drop(target_conn);

    // Back up the old default database so it is not merged again.
    let mut backup_path = old_default_path.clone();
    backup_path.set_extension("db.migrated");
    let _ = remove_db_with_sidecars(&backup_path);
    let _ = move_db_with_sidecars(&old_default_path, &backup_path);

    cleanup_old_default_profile_dir(data_dir);

    log::info!(
        "Merged default profile database into legacy storage path: {}",
        legacy_path.display()
    );
    Ok(())
}

fn cleanup_old_default_profile_dir(data_dir: &Path) {
    let old_dir = data_dir.join("profiles").join("default");
    if old_dir.exists() && old_dir.read_dir().map(|mut d| d.next().is_none()).unwrap_or(false) {
        let _ = std::fs::remove_dir(&old_dir);
    }
}

/// Path to the unencrypted application state database.
pub fn app_state_db_path(data_dir: &Path) -> PathBuf {
    data_dir.join("app_state.db")
}

/// Open (or create) the unencrypted app state database and initialize the
/// global profile metadata schema.
pub fn open_app_state_db(data_dir: &Path) -> Result<Connection> {
    let path = app_state_db_path(data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;
    }
    let conn = Connection::open(&path)?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO profiles (id, name, is_default, created_at) VALUES ('default', 'Default', 1, datetime('now'));
        CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        ",
    )?;
    Ok(conn)
}

/// Read the current profile id from the app state database.
pub fn current_profile_id_from_app_state(conn: &Connection) -> String {
    db::get_setting(conn, "current_profile_id")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_PROFILE_ID.to_string())
}

/// Set the current profile id in the app state database.
pub fn set_current_profile_id_in_app_state(conn: &Connection, profile_id: &str) -> Result<()> {
    db::set_setting(conn, "current_profile_id", profile_id)
}

/// One-time migration: copy profile metadata from the default profile DB into
/// the unencrypted app state DB. This is safe to call repeatedly; once the
/// app state has a current_profile_id it becomes a no-op.
pub fn migrate_profile_state_from_default_db(
    app_state_conn: &Connection,
    default_db_path: &Path,
) -> Result<()> {
    // Already migrated?
    if db::get_setting(app_state_conn, "current_profile_id")?.is_some() {
        return Ok(());
    }

    if !default_db_path.exists() {
        return Ok(());
    }

    // Open the default profile DB through the regular initializer so its
    // schema (including the legacy profiles table) is up to date. If it is
    // encrypted we cannot read the legacy metadata and will fall back to the
    // default profile; the user can switch profiles manually.
    let default_conn = match db::open(default_db_path) {
        Ok(c) => c,
        Err(e) => {
            log::warn!(
                "Skipping profile metadata migration; default profile DB at {} could not be opened: {}",
                default_db_path.display(),
                e
            );
            return Ok(());
        }
    };

    if let Ok(Some(current)) = db::get_setting(&default_conn, "current_profile_id") {
        if !current.trim().is_empty() {
            set_current_profile_id_in_app_state(app_state_conn, &current)?;
            log::info!(
                "Migrated current_profile_id from default profile DB: {}",
                current
            );
        }
    }

    let mut stmt = default_conn
        .prepare("SELECT id, name, is_default, created_at FROM profiles")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i32>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    for row in rows {
        let (id, name, is_default, created_at) = row?;
        app_state_conn.execute(
            "INSERT OR IGNORE INTO profiles (id, name, is_default, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![&id, &name, is_default, &created_at],
        )?;
    }

    Ok(())
}

/// Read the current profile id from a connection's app_settings.
pub fn current_profile_id_from_conn(conn: &Connection) -> String {
    db::get_setting(conn, "current_profile_id")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_PROFILE_ID.to_string())
}

/// Migration 012: widget runtime rewrite foundation tables.
/// Supports kernel/gateway/consent/audit/network policy/health/crash/stream tracking.
fn migration_012_widget_runtime_rewrite(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS widget_runtime_hosts (
            host_id         TEXT    PRIMARY KEY,
            language        TEXT    NOT NULL,
            version         TEXT    NOT NULL,
            path            TEXT,
            health          TEXT    NOT NULL DEFAULT 'unknown',
            created_at      TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS widget_gateway_policies (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            scope           TEXT    NOT NULL,
            decision        TEXT    NOT NULL,
            policy_source   TEXT    NOT NULL DEFAULT 'system',
            created_at      TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_widget_gateway_policies_scope
            ON widget_gateway_policies(scope);

        CREATE TABLE IF NOT EXISTS widget_consent_decisions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            widget_id       TEXT    NOT NULL,
            scope           TEXT    NOT NULL,
            decision        TEXT    NOT NULL,
            remembered      INTEGER NOT NULL DEFAULT 0,
            risk_level      TEXT    NOT NULL DEFAULT 'low',
            source          TEXT    NOT NULL DEFAULT 'runtime_prompt',
            granted_at      TEXT,
            revoked_at      TEXT,
            UNIQUE(widget_id, scope)
        );

        CREATE INDEX IF NOT EXISTS idx_widget_consent_decisions_widget
            ON widget_consent_decisions(widget_id);

        CREATE TABLE IF NOT EXISTS widget_access_audit (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            widget_id       TEXT    NOT NULL,
            scope           TEXT    NOT NULL,
            request_type    TEXT    NOT NULL,
            decision        TEXT    NOT NULL,
            resource_hint   TEXT    NOT NULL DEFAULT '',
            payload_class   TEXT    NOT NULL DEFAULT '',
            occurred_at     TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_widget_access_audit_widget_time
            ON widget_access_audit(widget_id, occurred_at DESC);

        CREATE TABLE IF NOT EXISTS widget_network_domain_rules (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            widget_id       TEXT    NOT NULL,
            domain_pattern  TEXT    NOT NULL,
            decision        TEXT    NOT NULL,
            policy_source   TEXT    NOT NULL DEFAULT 'user',
            created_at      TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_widget_network_domain_rules_widget
            ON widget_network_domain_rules(widget_id);

        CREATE TABLE IF NOT EXISTS widget_runtime_health (
            widget_id       TEXT    PRIMARY KEY,
            host_id         TEXT,
            memory_used_mb  INTEGER NOT NULL DEFAULT 0,
            cpu_used_ms     INTEGER NOT NULL DEFAULT 0,
            last_heartbeat_at TEXT,
            status          TEXT    NOT NULL DEFAULT 'unknown'
        );

        CREATE TABLE IF NOT EXISTS widget_runtime_crashes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            widget_id       TEXT    NOT NULL,
            host_id         TEXT,
            error           TEXT    NOT NULL,
            stack_hint      TEXT    NOT NULL DEFAULT '',
            occurred_at     TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_widget_runtime_crashes_widget_time
            ON widget_runtime_crashes(widget_id, occurred_at DESC);

        CREATE TABLE IF NOT EXISTS widget_stream_sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            widget_id       TEXT    NOT NULL,
            stream_type     TEXT    NOT NULL,
            resource_hint   TEXT    NOT NULL DEFAULT '',
            started_at      TEXT    NOT NULL,
            ended_at        TEXT,
            status          TEXT    NOT NULL DEFAULT 'active'
        );

        CREATE INDEX IF NOT EXISTS idx_widget_stream_sessions_widget
            ON widget_stream_sessions(widget_id);
        ",
    )?;
    Ok(())
}

/// Migration 013: persist LLM assistant conversations and optional summaries.
fn migration_013_llm_conversations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS llm_conversations (
            id          TEXT    PRIMARY KEY,
            title       TEXT    NOT NULL,
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL,
            archived    INTEGER NOT NULL DEFAULT 0,
            pinned      INTEGER NOT NULL DEFAULT 0,
            messages    TEXT    NOT NULL,
            summary     TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_llm_conversations_updated
            ON llm_conversations(updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_llm_conversations_pinned
            ON llm_conversations(pinned, updated_at DESC);
        ",
    )?;
    Ok(())
}

/// The ordered list of all migrations.
const MIGRATIONS: &[Migration] = &[
    Migration::new(1, "baseline_schema", migration_001_baseline),
    Migration::new(2, "add_columns", migration_002_add_columns),
    Migration::new(
        3,
        "backfill_daily_app_usage",
        migration_003_backfill_daily_app_usage,
    ),
    Migration::new(
        4,
        "archive_tier_compression",
        migration_004_archive_tier_compression,
    ),
    Migration::new(5, "derived_metrics", migration_005_derived_metrics),
    Migration::new(6, "focus_rules", migration_006_focus_rules),
    Migration::new(
        7,
        "goal_notification_settings",
        migration_007_goal_notification_settings,
    ),
    Migration::new(8, "encryption_metadata", migration_008_encryption_metadata),
    Migration::new(9, "profile_settings", migration_009_profile_settings),
    Migration::new(10, "compressed_archive", migration_010_compressed_archive),
    Migration::new(11, "widget_runtime_v220", migration_011_widget_runtime_v220),
    Migration::new(
        12,
        "widget_runtime_rewrite",
        migration_012_widget_runtime_rewrite,
    ),
    Migration::new(
        13,
        "llm_conversations",
        migration_013_llm_conversations,
    ),
];

/// Returns the highest migration version defined.
pub fn latest_version() -> i64 {
    MIGRATIONS.last().map(|m| m.version).unwrap_or(0)
}

/// Bootstrap the migration tracker for databases created before the migration
/// framework existed. Those DBs stored their schema version in `app_settings`
/// under `schema_version`. We map that to `PRAGMA user_version`.
fn bootstrap_user_version(conn: &Connection) -> Result<()> {
    let user_version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if user_version == 0 {
        if let Ok(Some(schema_version_str)) = super::get_setting(conn, "schema_version") {
            if let Ok(schema_version) = schema_version_str.parse::<i64>() {
                let target = schema_version.max(1);
                conn.pragma_update(None, "user_version", target)?;
                log::info!(
                    "Bootstrapped migration user_version from schema_version setting: {}",
                    target
                );
            }
        }
    }
    Ok(())
}

/// Run all pending migrations in order. Each migration is wrapped in a
/// transaction and logged to `_migration_log`.
pub fn run_migrations(conn: &Connection) -> Result<()> {
    bootstrap_user_version(conn)?;

    // If the database was bootstrapped from a legacy schema_version setting,
    // the _migration_log table may not exist yet. Ensure it exists before
    // inserting migration log rows.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS _migration_log (
            version     INTEGER PRIMARY KEY,
            name        TEXT    NOT NULL,
            applied_at  TEXT    NOT NULL
        )",
        [],
    )?;

    let mut current: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let target = latest_version();

    if current == target {
        return Ok(());
    }

    for migration in MIGRATIONS {
        if migration.version <= current {
            continue;
        }

        log::info!(
            "Running migration {}: {} ({} -> {})",
            migration.version,
            migration.name,
            current,
            migration.version
        );

        let tx = conn.unchecked_transaction()?;

        // Pre-check: ensure migration version is sequential.
        if migration.version != current + 1 {
            return Err(rusqlite::Error::InvalidQuery);
        }

        (migration.up)(conn)?;

        conn.pragma_update(None, "user_version", migration.version)?;

        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO _migration_log (version, name, applied_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(version) DO UPDATE SET applied_at = excluded.applied_at",
            params![migration.version, migration.name, now],
        )?;

        tx.commit()?;
        current = migration.version;
    }

    // Keep the legacy schema_version setting in sync for downgrade safety.
    super::set_setting(conn, "schema_version", &target.to_string())?;

    log::info!("Database migrations complete at version {}", target);
    Ok(())
}

/// Run migrations on a temporary copy of the database without mutating the
/// original. Returns a rehearsal report.
pub fn run_migration_rehearsal(
    source_path: &Path,
) -> Result<MigrationRehearsalReport, Box<dyn std::error::Error + Send + Sync>> {
    let temp_dir = std::env::temp_dir().join(format!(
        "timelens_migration_rehearsal_{}",
        chrono::Local::now().timestamp_millis()
    ));
    std::fs::create_dir_all(&temp_dir)?;
    let temp_db = temp_dir.join("timelens_rehearse.db");

    // Copy main DB and WAL sidecars if present.
    std::fs::copy(source_path, &temp_db)?;
    let _ = std::fs::copy(
        format!("{}-wal", source_path.display()),
        format!("{}-wal", temp_db.display()),
    );
    let _ = std::fs::copy(
        format!("{}-shm", source_path.display()),
        format!("{}-shm", temp_db.display()),
    );

    let conn = Connection::open(&temp_db)?;
    let start_version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    let result = run_migrations(&conn);
    let end_version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    let mut report = MigrationRehearsalReport {
        source_path: source_path.to_path_buf(),
        temp_path: temp_db.clone(),
        start_version,
        end_version,
        success: result.is_ok(),
        error: result.err().map(|e| e.to_string()),
        migration_log: Vec::new(),
        integrity_check: String::new(),
    };

    if report.success {
        let integrity: String =
            conn.pragma_query_value(None, "integrity_check", |row| row.get(0))?;
        report.integrity_check = integrity;

        let mut stmt =
            conn.prepare("SELECT version, name, applied_at FROM _migration_log ORDER BY version")?;
        let rows = stmt.query_map([], |row| {
            Ok(MigrationLogEntry {
                version: row.get(0)?,
                name: row.get(1)?,
                applied_at: row.get(2)?,
            })
        })?;
        report.migration_log = rows.collect::<Result<Vec<_>, _>>()?;
    }

    // Clean up temp files (best effort).
    let _ = std::fs::remove_dir_all(&temp_dir);

    Ok(report)
}

/// Report returned by `run_migration_rehearsal`.
#[derive(Debug, serde::Serialize)]
pub struct MigrationRehearsalReport {
    pub source_path: PathBuf,
    pub temp_path: PathBuf,
    pub start_version: i64,
    pub end_version: i64,
    pub success: bool,
    pub error: Option<String>,
    pub migration_log: Vec<MigrationLogEntry>,
    pub integrity_check: String,
}

#[derive(Debug, serde::Serialize)]
pub struct MigrationLogEntry {
    pub version: i64,
    pub name: String,
    pub applied_at: String,
}

/// Ensure the core indexes required by the app exist.
pub fn ensure_core_indexes(conn: &Connection) -> Result<i64> {
    let specs = [
        (
            "idx_app_usage_date",
            "CREATE INDEX IF NOT EXISTS idx_app_usage_date ON app_usage(date)",
        ),
        (
            "idx_app_usage_app_date",
            "CREATE INDEX IF NOT EXISTS idx_app_usage_app_date ON app_usage(app_name, date)",
        ),
        (
            "idx_daily_app_usage_date",
            "CREATE INDEX IF NOT EXISTS idx_daily_app_usage_date ON daily_app_usage(date)",
        ),
    ];

    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'index'")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;

    let mut existing = std::collections::BTreeSet::new();
    for row in rows {
        existing.insert(row?);
    }

    let mut repaired = 0_i64;
    for (name, ddl) in specs {
        if !existing.contains(name) {
            conn.execute(ddl, [])?;
            repaired += 1;
        }
    }

    Ok(repaired)
}

/// Migration status summary.
#[derive(Debug, serde::Serialize)]
pub struct MigrationStatus {
    pub current_version: i64,
    pub latest_version: i64,
    pub pending: i64,
    pub is_bootstrapped: bool,
}

/// Get the current migration status for a connection.
pub fn get_status(conn: &Connection) -> Result<MigrationStatus> {
    let user_version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let is_bootstrapped = user_version > 0 || db::get_setting(conn, "schema_version")?.is_some();
    let latest = latest_version();
    Ok(MigrationStatus {
        current_version: user_version,
        latest_version: latest,
        pending: (latest - user_version).max(0),
        is_bootstrapped,
    })
}

/// Initialize a connection: apply migrations and keep legacy settings in sync.
pub fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;
    run_migrations(conn)?;
    let _ = ensure_core_indexes(conn)?;
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_db_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("timelens_migration_tests");
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(format!("{}.db", name))
    }

    #[test]
    fn test_rehearsal_on_fresh_unmigrated_db() {
        let path = temp_db_path("fresh_unmigrated");
        let _ = std::fs::remove_file(&path);
        // Create a raw connection without running migrations.
        let conn = rusqlite::Connection::open(&path).unwrap();
        drop(conn);

        let report = run_migration_rehearsal(&path).unwrap();
        assert!(
            report.success,
            "migration rehearsal failed: {:?}",
            report.error
        );
        assert_eq!(report.start_version, 0);
        assert_eq!(report.end_version, latest_version());
        assert_eq!(report.integrity_check, "ok");
    }

    fn temp_data_dir(name: &str) -> PathBuf {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let dir = std::env::temp_dir().join(format!("timelens_merge_test_{}_{}", name, ts));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_move_default_profile_when_legacy_missing() {
        use crate::db;
        let base = temp_data_dir("move_default");
        let old_default = old_default_profile_db_path(&base);
        let conn = db::open(&old_default).unwrap();
        db::upsert_app_usage(
            &conn,
            "2026-07-01",
            "AppA",
            "C:\\a.exe",
            "A",
            60,
            "2026-07-01T10:00:00",
            "2026-07-01T10:01:00",
        )
        .unwrap();
        drop(conn);

        merge_default_profile_into_legacy_db(&base).unwrap();

        let legacy = db_path_for_profile(&base, DEFAULT_PROFILE_ID);
        assert!(legacy.exists());
        let conn = db::open(&legacy).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(1) FROM app_usage", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        drop(conn);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_merge_default_profile_skips_conflicts() {
        use crate::db;
        let base = temp_data_dir("merge_default");

        let legacy = db_path_for_profile(&base, DEFAULT_PROFILE_ID);
        let conn = db::open(&legacy).unwrap();
        db::upsert_app_usage(
            &conn,
            "2026-07-01",
            "AppA",
            "C:\\a.exe",
            "A",
            60,
            "2026-07-01T10:00:00",
            "2026-07-01T10:01:00",
        )
        .unwrap();
        drop(conn);

        let old_default = old_default_profile_db_path(&base);
        let conn = db::open(&old_default).unwrap();
        // Source has two rows for different apps; with the id-less merge they
        // should both be inserted even though the first source id would have
        // conflicted with the target's row id=1.
        db::upsert_app_usage(
            &conn,
            "2026-07-02",
            "AppB",
            "C:\\b.exe",
            "B",
            600,
            "2026-07-02T10:00:00",
            "2026-07-02T10:10:00",
        )
        .unwrap();
        db::upsert_app_usage(
            &conn,
            "2026-07-03",
            "AppC",
            "C:\\c.exe",
            "C",
            60,
            "2026-07-03T10:00:00",
            "2026-07-03T10:01:00",
        )
        .unwrap();
        drop(conn);

        merge_default_profile_into_legacy_db(&base).unwrap();

        let conn = db::open(&legacy).unwrap();
        let app_usage_count: i64 = conn
            .query_row("SELECT COUNT(1) FROM app_usage", [], |r| r.get(0))
            .unwrap();
        assert_eq!(app_usage_count, 3, "all source raw rows should be preserved");

        let total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total_seconds), 0) FROM daily_app_usage",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total, 720, "daily totals should be rebuilt from merged raw rows");
        assert!(!old_default.exists());
        drop(conn);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn test_merge_default_profile_preserves_extension_bridge_key() {
        use crate::db;
        let base = temp_data_dir("merge_default_bridge_key");

        let legacy = db_path_for_profile(&base, DEFAULT_PROFILE_ID);
        let conn = db::open(&legacy).unwrap();
        db::set_setting(&conn, "extension_bridge_key", "legacy-root-key").unwrap();
        db::set_setting(&conn, "extension_bridge_key_rotated_at", "2026-07-01T00:00:00").unwrap();
        drop(conn);

        let old_default = old_default_profile_db_path(&base);
        let conn = db::open(&old_default).unwrap();
        db::set_setting(&conn, "extension_bridge_key", "v200-default-key").unwrap();
        db::set_setting(&conn, "extension_bridge_key_rotated_at", "2026-07-17T12:00:00").unwrap();
        drop(conn);

        merge_default_profile_into_legacy_db(&base).unwrap();

        let conn = db::open(&legacy).unwrap();
        let key: String = db::get_setting(&conn, "extension_bridge_key")
            .unwrap()
            .unwrap();
        assert_eq!(key, "v200-default-key", "v2.0.0 default profile bridge key should overwrite the legacy root key");
        let rotated_at: String = db::get_setting(&conn, "extension_bridge_key_rotated_at")
            .unwrap()
            .unwrap();
        assert_eq!(rotated_at, "2026-07-17T12:00:00");
        drop(conn);
        let _ = std::fs::remove_dir_all(&base);
    }
}
