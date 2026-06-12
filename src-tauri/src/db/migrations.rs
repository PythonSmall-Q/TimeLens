use crate::db;
use rusqlite::{params, Connection, Result};
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
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

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

pub const DEFAULT_PROFILE_ID: &str = "default";

/// Compute the database file path for a given profile.
pub fn db_path_for_profile(data_dir: &Path, profile_id: &str) -> PathBuf {
    data_dir
        .join("profiles")
        .join(profile_id)
        .join("timelens.db")
}

/// Read the current profile id from a connection's app_settings.
pub fn current_profile_id_from_conn(conn: &Connection) -> String {
    db::get_setting(conn, "current_profile_id")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_PROFILE_ID.to_string())
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
